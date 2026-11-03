"""Score a coverage-probe run: hit@1, hit@5, MRR on the should_work queries.

    python eval/score_run.py eval/coverage_raw_results.json
    python eval/score_run.py runA.json runB.json      # compare two runs

Reads eval/coverage_expectations.json for the expected tids.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EXPECT = ROOT / "coverage_expectations.json"


def score(path):
    expect = {q["id"]: q for q in json.loads(EXPECT.read_text(encoding="utf-8"))["queries"]}
    results = json.loads(Path(path).read_text(encoding="utf-8"))

    rows, rr = [], []
    for rec in results:
        q = expect.get(rec["id"])
        if not q or q.get("group") != "should_work":
            continue
        wanted = {e["tid"] for e in q.get("expected", [])}
        items = (rec.get("supporting") or {}).get("items", [])
        rank = None
        for i, it in enumerate(items, start=1):
            if it.get("tid") in wanted:
                rank = i
                break
        rows.append((rec["id"], rank))
        rr.append(1 / rank if rank else 0.0)

    hit1 = sum(1 for _, r in rows if r == 1)
    hit5 = sum(1 for _, r in rows if r and r <= 5)
    n = len(rows)
    return {"name": Path(path).name, "n": n, "hit1": hit1, "hit5": hit5,
            "mrr": sum(rr) / n if n else 0.0, "rows": dict(rows)}


def main():
    paths = sys.argv[1:]
    if not paths:
        sys.exit("usage: python eval/score_run.py <raw_results.json> [<other.json>]")

    runs = [score(p) for p in paths]
    for r in runs:
        print(f"\n{r['name']}")
        print(f"  hit@1 {r['hit1']}/{r['n']}   hit@5 {r['hit5']}/{r['n']}   MRR {r['mrr']:.3f}")

    if len(runs) == 2:
        a, b = runs
        print("\n" + "=" * 54)
        print(f"{'query':<8} {'A':>5} {'B':>5}   change")
        print("=" * 54)
        for qid in sorted(set(a["rows"]) | set(b["rows"])):
            ra, rb = a["rows"].get(qid), b["rows"].get(qid)
            fa = str(ra) if ra else "-"
            fb = str(rb) if rb else "-"
            if ra == rb:
                note = ""
            elif rb and (not ra or rb < ra):
                note = "  BETTER"
            else:
                note = "  WORSE"
            print(f"{qid:<8} {fa:>5} {fb:>5} {note}")
        print("=" * 54)
        print(f"hit@1  {a['hit1']} -> {b['hit1']}")
        print(f"hit@5  {a['hit5']} -> {b['hit5']}")
        print(f"MRR    {a['mrr']:.3f} -> {b['mrr']:.3f}")
        d = b["mrr"] - a["mrr"]
        print("\nVERDICT:", "KEEP IT" if d > 0.02 else "REVERT IT" if d < -0.02 else
              "NO REAL CHANGE -- keep it, it fixes the 4 passages found by hand")


if __name__ == "__main__":
    main()
