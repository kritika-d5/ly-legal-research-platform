"""
Evaluation harness.

    python -m evaluation.run_eval            # offline: measures the deterministic pipeline (merge/questions/
                                             #          contradictions/completeness) with reference extractions
    python -m evaluation.run_eval --live     # uses the real LLM from .env: ALSO measures extraction quality
    python -m evaluation.run_eval --live --ids assault_theft_station,theft_unknown_accused

Metrics (see docs/EVALUATION.md):
  fact_extraction_accuracy   expected facts present in the final CaseState
  hallucination_rate         fields that must stay empty but were filled
  question_relevance         next question after a turn was in the acceptable set
  redundancy_rate            questions asked about fields that were already resolved / repeated
  contradiction_detection    intentionally inserted contradictions that were flagged
  completeness_detection     intentionally missing fields that were reported missing
  scenario_completion        scenarios that reached the expected final status
A markdown report is written to evaluation/reports/report_<mode>.md
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from datetime import date, timedelta
from typing import Any

from app.config import Settings
from app.conversation.manager import ConversationManager
from app.llm.demo_provider import DemoProvider, load_scenarios
from app.llm.factory import build_llm_from_settings
from app.storage.repository import SQLiteRepository
from app.utils.logging import configure_logging
from app.utils.text import normalize
from app.validation.completeness import RULES

REPORT_DIR = os.path.join("evaluation", "reports")
_PATH_RE = re.compile(r"([a-zA-Z_]+)(?:\[(-?\d+)\])?")


def get_path(obj: Any, path: str) -> Any:
    """Resolve 'accused[0].name.value' or 'incident.time.history[-1].value' against a dict."""
    cur = obj
    for part in path.split("."):
        m = _PATH_RE.fullmatch(part)
        if not m:
            return "<badpath>"
        key, idx = m.group(1), m.group(2)
        if not isinstance(cur, dict) or key not in cur:
            return "<missing>"
        cur = cur[key]
        if idx is not None:
            if not isinstance(cur, list) or not (-len(cur) <= int(idx) < len(cur)):
                return "<missing>"
            cur = cur[int(idx)]
    return cur


def resolve_expected(value: Any, ref: date) -> Any:
    if isinstance(value, str) and value.startswith("@"):
        if value == "@today":
            return ref.isoformat()
        if value == "@yesterday":
            return (ref - timedelta(days=1)).isoformat()
        if value == "@2daysago":
            return (ref - timedelta(days=2)).isoformat()
        if value == "@lastthursday":
            delta = (ref.weekday() - 3) % 7 or 7
            return (ref - timedelta(days=delta)).isoformat()
    return value


def matches(actual: Any, expected: Any) -> bool:
    if expected is None:
        return actual is None or actual == "<missing>"
    if isinstance(expected, bool) or isinstance(expected, (int, float)):
        return actual == expected
    if isinstance(expected, str):
        if actual is None or actual == "<missing>":
            return False
        return normalize(expected) in normalize(actual)
    return actual == expected


class Tally:
    def __init__(self):
        self.hit = 0
        self.total = 0
        self.failures: list[str] = []

    def add(self, ok: bool, label: str):
        self.total += 1
        if ok:
            self.hit += 1
        else:
            self.failures.append(label)

    @property
    def rate(self) -> float:
        return self.hit / self.total if self.total else float("nan")


async def run_scenario(sc: dict, live: bool, settings: Settings, tallies: dict[str, Tally]) -> dict:
    llm = build_llm_from_settings() if live else DemoProvider(scenario_id=sc["id"])
    mgr = ConversationManager(SQLiteRepository(":memory:"), llm, settings)
    state, _ = mgr.create_case()
    ref = date.fromisoformat(state.created_at[:10])
    expect = sc.get("expect", {})
    asked_fields_by_turn: dict[int, str] = {}
    questions = 0
    llm_errors = 0

    for i, turn in enumerate(sc["turns"], start=1):
        before = mgr.repo.get_state(state.case_id)
        resolved_before = {r.field for r in RULES if r.applies(before) and r.resolved(before)}
        result = await mgr.handle_message(state.case_id, turn["user"])
        if result.warning:
            llm_errors += 1
        s = result.state
        asked = s.asked_questions and max(s.asked_questions, key=lambda q: (q.turn, q.times_asked))
        asked_field = asked.field if asked and asked.turn == s.turn_count else None
        if result.next_action in ("ask_question", "clarify_contradiction") and asked_field:
            questions += 1
            asked_fields_by_turn[i] = asked_field
            # Redundant = asking about something that was already resolved before this turn.
            # (Re-asking a question the user skipped is legitimate and is bounded by max_repeat_per_field.)
            is_redundant = asked_field in resolved_before and not asked_field.startswith("clarify.")
            tallies["redundancy_rate"].add(not is_redundant, f"{sc['id']} turn {i}: redundant question about {asked_field}")
        if "expect_question_in" in turn:
            allowed = set(turn["expect_question_in"])
            tallies["question_relevance"].add(asked_field in allowed,
                                              f"{sc['id']} turn {i}: asked {asked_field}, expected one of {sorted(allowed)}")
        for t_key, fields in expect.get("missing_after_turn", {}).items():
            if int(t_key) == i:
                missing_now = {m.field for m in result.completeness.missing}
                for f in fields:
                    tallies["completeness_detection"].add(f in missing_now, f"{sc['id']} turn {i}: {f} not reported missing")
        if result.next_action == "complete":
            break

    final = mgr.repo.get_state(state.case_id)
    data = json.loads(final.to_json())
    for path, expected in expect.get("facts", {}).items():
        actual = get_path(data, path)
        exp = resolve_expected(expected, ref)
        tallies["fact_extraction_accuracy"].add(matches(actual, exp), f"{sc['id']}: {path} = {actual!r}, expected {exp!r}")
    for path in expect.get("must_be_null", []):
        actual = get_path(data, path)
        tallies["hallucination_rate"].add(actual in (None, "<missing>"), f"{sc['id']}: {path} unexpectedly = {actual!r}")
    for name in expect.get("empty_lists", []):
        tallies["hallucination_rate"].add(not data.get(name), f"{sc['id']}: list {name} unexpectedly non-empty")
    for name, n in expect.get("list_lengths", {}).items():
        tallies["fact_extraction_accuracy"].add(len(data.get(name, [])) == n, f"{sc['id']}: len({name}) = {len(data.get(name, []))}, expected {n}")
    for f in expect.get("declined", []):
        tallies["fact_extraction_accuracy"].add(f in data["declined_fields"], f"{sc['id']}: {f} not marked declined")
    for f in expect.get("unknown", []):
        tallies["fact_extraction_accuracy"].add(f in data["unknown_fields"], f"{sc['id']}: {f} not marked unknown")
    for f, mx in expect.get("max_times_asked", {}).items():
        n = sum(q.times_asked for q in final.asked_questions if q.field == f)
        tallies["redundancy_rate"].add(n <= mx, f"{sc['id']}: {f} asked {n} times (max {mx})")
    found_fields = {c.field for c in final.contradictions}
    for f in expect.get("contradiction_fields", []):
        tallies["contradiction_detection"].add(f in found_fields, f"{sc['id']}: contradiction on {f} not detected")
    if "contradiction_fields" in expect and not expect["contradiction_fields"]:
        tallies["contradiction_detection"].add(not found_fields, f"{sc['id']}: unexpected contradiction {sorted(found_fields)}")
    if live and settings.llm_contradiction_check:
        for group in [expect.get("llm_only_contradiction_fields", [])]:
            if group:
                tallies["contradiction_detection"].add(bool(found_fields & set(group)), f"{sc['id']}: timeline contradiction not detected")
    if expect.get("contradictions_resolved"):
        tallies["contradiction_detection"].add(all(c.resolved for c in final.contradictions), f"{sc['id']}: contradiction left unresolved")
    if "final_status" in expect:
        tallies["scenario_completion"].add(data["status"] == expect["final_status"],
                                           f"{sc['id']}: final status {data['status']}, expected {expect['final_status']}")
    return {"id": sc["id"], "status": data["status"], "completion": data["completion_percentage"],
            "questions": questions, "turns": final.turn_count, "contradictions": len(final.contradictions), "llm_errors": llm_errors}


def fmt(t: Tally, invert: bool = False) -> str:
    """invert=True reports the BAD cases (hallucinations, redundant questions) as the rate."""
    if not t.total:
        return "n/a"
    if invert:
        bad = t.total - t.hit
        return f"{bad}/{t.total} = {100 * bad / t.total:.0f}%"
    return f"{t.hit}/{t.total} = {100 * t.rate:.0f}%"


async def main_async(args) -> None:
    live = args.live
    if live:
        settings = Settings(_env_file=".env")
        settings.validate_for_llm()
    else:
        settings = Settings(llm_provider="demo", llm_question_wording=True, llm_contradiction_check=False)
    scenarios = load_scenarios()
    if args.ids:
        wanted = set(args.ids.split(","))
        scenarios = [s for s in scenarios if s["id"] in wanted]
    metric_names = ["fact_extraction_accuracy", "hallucination_rate", "question_relevance", "redundancy_rate",
                    "contradiction_detection", "completeness_detection", "scenario_completion"]
    tallies = {m: Tally() for m in metric_names}
    rows = []
    for sc in scenarios:
        print(f"running {sc['id']} ...", flush=True)
        rows.append(await run_scenario(sc, live, settings, tallies))

    mode = f"live ({settings.llm_provider} / {settings.resolved_model})" if live else "offline (reference extractions)"
    lines = [f"# Evaluation report - {mode}", "", f"Scenarios: {len(rows)}", "", "## Metrics", "",
             "| metric | result | meaning |", "|---|---|---|",
             f"| Fact extraction accuracy | {fmt(tallies['fact_extraction_accuracy'])} | expected facts found in final CaseState (higher is better) |",
             f"| Hallucination rate | {fmt(tallies['hallucination_rate'], invert=True)} | fields that should be empty but were filled (lower is better) |",
             f"| Question relevance | {fmt(tallies['question_relevance'])} | next question was in the acceptable set (higher is better) |",
             f"| Redundancy rate | {fmt(tallies['redundancy_rate'], invert=True)} | questions about fields that were already answered (lower is better) |",
             f"| Contradiction detection | {fmt(tallies['contradiction_detection'])} | inserted contradictions flagged, no false positives (higher is better) |",
             f"| Completeness detection | {fmt(tallies['completeness_detection'])} | intentionally missing fields reported (higher is better) |",
             f"| Scenario completion | {fmt(tallies['scenario_completion'])} | scenarios reaching the expected final status |",
             "", "## Per scenario", "", "| scenario | final status | completion % | questions asked | turns | contradictions | llm errors |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        lines.append(f"| {r['id']} | {r['status']} | {r['completion']} | {r['questions']} | {r['turns']} | {r['contradictions']} | {r['llm_errors']} |")
    failures = [(m, f) for m in metric_names for f in tallies[m].failures if f]
    lines += ["", "## Failures", ""] + ([f"- **{m}**: {f}" for m, f in failures] or ["None"])
    report = "\n".join(lines)
    os.makedirs(REPORT_DIR, exist_ok=True)
    out = os.path.join(REPORT_DIR, f"report_{'live' if live else 'offline'}.md")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(report + "\n")
    print("\n" + report)
    print(f"\nReport written to {out}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--live", action="store_true", help="use the real LLM from .env")
    parser.add_argument("--ids", default="", help="comma-separated scenario ids")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    configure_logging("INFO" if args.verbose else "WARNING")
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()
