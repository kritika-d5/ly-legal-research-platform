#!/usr/bin/env python
"""
Demo runner for presentations.

    python demo.py                      # offline, scripted scenario (no API key needed)
    python demo.py --scenario theft_unknown_accused
    python demo.py --list               # show available scenarios
    python demo.py --live               # use the REAL LLM from your .env (user side still scripted)
    python demo.py --interactive        # you type the answers yourself (needs a real LLM in .env)

It prints:  user story -> extracted facts -> next question -> answer -> ... -> final CaseState JSON
and saves the final JSON to data/sample_cases/examples/<scenario_id>.json
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import textwrap

from app.config import Settings
from app.conversation.manager import ConversationManager
from app.llm.demo_provider import DemoProvider, load_scenarios
from app.llm.factory import build_llm_from_settings
from app.storage.repository import SQLiteRepository
from app.utils.logging import configure_logging

EXAMPLES_DIR = os.path.join("data", "sample_cases", "examples")


def wrap(text: str, prefix: str) -> str:
    return textwrap.indent(textwrap.fill(text, 96), prefix)


def banner(title: str) -> None:
    print("\n" + "=" * 100 + f"\n{title}\n" + "=" * 100)


async def run_scripted(scenario: dict, live: bool, save: bool = True) -> dict:
    settings = Settings(_env_file=".env") if live else Settings(llm_provider="demo", llm_question_wording=True,
                                                                 llm_contradiction_check=False)
    llm = build_llm_from_settings() if live else DemoProvider(scenario_id=scenario["id"])
    mgr = ConversationManager(SQLiteRepository(":memory:"), llm, settings)
    state, intro = mgr.create_case()
    banner(f"SCENARIO: {scenario['title']}   [{'LIVE ' + settings.llm_provider if live else 'offline demo'}]")
    print(wrap(intro, "BOT  > "))
    for turn in scenario["turns"]:
        print()
        print(wrap(turn["user"], "USER > "))
        result = await mgr.handle_message(state.case_id, turn["user"])
        if result.changes:
            print("       [extracted] " + "; ".join(result.changes[:6]) + (" ..." if len(result.changes) > 6 else ""))
        if result.state.open_contradictions():
            c = result.state.open_contradictions()[0]
            print(f"       [contradiction] {c.type.value}/{c.severity.value}: {c.explanation}")
        print(f"       [completeness] {result.completeness.completion_percentage}%  next_action={result.next_action}")
        print(wrap(result.assistant_message, "BOT  > "))
        if result.next_action == "complete":
            break
    final = mgr.repo.get_state(state.case_id)
    banner("FINAL CASE STATE (machine-readable output for Part 2)")
    data = json.loads(final.to_json())
    print(json.dumps({k: data[k] for k in ("case_id", "status", "user_confirmed", "completion_percentage")}, indent=2))
    print(f"accused={len(final.accused)} acts={len(final.acts)} injuries={len(final.injuries)} property={len(final.property)} "
          f"witnesses={len(final.witnesses)} evidence={len(final.evidence)} contradictions={len(final.contradictions)}")
    if save:
        os.makedirs(EXAMPLES_DIR, exist_ok=True)
        path = os.path.join(EXAMPLES_DIR, f"{scenario['id']}.json")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(final.to_json())
        print(f"\nSaved full CaseState JSON to {path}")
    return data


async def run_interactive() -> None:
    settings = Settings(_env_file=".env")
    llm = build_llm_from_settings()
    mgr = ConversationManager(SQLiteRepository(":memory:"), llm, settings)
    state, intro = mgr.create_case()
    banner(f"INTERACTIVE MODE  [{settings.llm_provider} / {settings.resolved_model}]  (type 'quit' to stop)")
    print(wrap(intro, "BOT  > "))
    while True:
        try:
            text = input("\nUSER > ").strip()
        except (EOFError, KeyboardInterrupt):
            break
        if text.lower() in {"quit", "exit"}:
            break
        result = await mgr.handle_message(state.case_id, text)
        if result.changes:
            print("       [extracted] " + "; ".join(result.changes[:6]))
        print(f"       [completeness] {result.completeness.completion_percentage}%  next_action={result.next_action}")
        print(wrap(result.assistant_message, "BOT  > "))
        if result.next_action == "complete":
            break
    final = mgr.repo.get_state(state.case_id)
    banner("FINAL CASE STATE")
    print(final.to_json())


def main() -> None:
    parser = argparse.ArgumentParser(description="FIR chatbot Part 1 demo")
    parser.add_argument("--scenario", default="assault_theft_station", help="scenario id from data/sample_cases/scenarios.json")
    parser.add_argument("--all", action="store_true", help="run every scenario (offline) and save all example JSONs")
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--live", action="store_true", help="use the real LLM configured in .env")
    parser.add_argument("--interactive", action="store_true", help="type your own answers (real LLM)")
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()
    configure_logging("INFO" if args.verbose else "WARNING")

    scenarios = load_scenarios()
    if args.list:
        for s in scenarios:
            print(f"{s['id']:34s} {s['title']}")
        return
    if args.interactive:
        asyncio.run(run_interactive())
        return
    if args.all:
        for s in scenarios:
            asyncio.run(run_scripted(s, args.live))
        return
    match = [s for s in scenarios if s["id"] == args.scenario]
    if not match:
        print(f"Unknown scenario '{args.scenario}'. Use --list.", file=sys.stderr)
        sys.exit(1)
    asyncio.run(run_scripted(match[0], args.live))


if __name__ == "__main__":
    main()
