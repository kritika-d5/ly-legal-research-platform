# Counter-argument engine — what was fixed, what is left

Status as of 2026-11-02. Nothing committed.

## Done

| # | Fix | Where | Result |
|---|---|---|---|
| 1 | Passage cap of 12 applied at generation | `generate.ts` | sw10 went from failing every run (413, request over the 8,000-token limit) to generating cleanly. No query now exceeds ~7,000 tokens. |
| 2 | `findInvalidCitations` regex | `generate.ts` | Now matches `[N]`, `【N】` and `【N†locator】`. It previously read 0 of sw01's 13 citations and 5 of sw03's 12, and reported "no invalid citations" having checked almost nothing. |
| 3 | Deduplicate passages across rounds | `counter.ts` | One chunk can no longer reach the model twice under contradictory labels. 3 pairs collapsed in the stored answers. Where the rounds disagreed on speaker, the survivor is flagged `speakerUncertain` and prompt rule 12 forbids attributing a holding to it. |
| 4 | Section-primary ranking boost | `search.ts` | **Tried and reverted.** No change to hit@1, hit@5 or MRR; promoted a mislabelled passage to rank 1. Kept as a documented negative result. |
| 5 | UI renders `speakerUncertain` | `web/src/api.ts`, `Badges.tsx`, `ArgumentCard.tsx`, `SourceDrawer.tsx` | New `SpeakerUncertainBadge`, built like `SideUndeterminedBadge` (muted, tooltip explains the two-round disagreement). Shown **instead of** the speaker badge, never beside it — on the card and in the "view source" drawer, which showed the same badge. Affects the 3 passages fix 3 flagged, including record 6's. Web typecheck and build clean; checked by server-side render (uncertain item: 0 "THE COURT", 1 "speaker uncertain"; normal item unchanged), **not yet in a browser**. |

## Left to do, in priority order

### 2. Independent review of the 30 verdicts — ~1 hour, mostly not code

`claim_verdicts.json` was produced by an LLM reviewer. Nothing in the chapter
has been read by a person.

- `independent_review_blank.json` — the 30 records with verdicts stripped out,
  for a second, independent LLM reviewer
- `independent_review_INSTRUCTIONS.md` — the task for that reviewer
- Then the author should personally check ~5 records and record the agreement
  rate, so the result is not wholly machine-judged

Do not show the second reviewer the first reviewer's verdicts.

### 3. Enforce the plain `[N]` citation format — small, but changes generation

24 of 50 citations used `【N†locator】`, which prompt rule 11 forbids. The regex
fix above works around it rather than correcting it.

Not done because it changes generation behaviour, and the 17/9/4 faithfulness
result would no longer describe the shipped build. Needs a re-measurement run,
and there is no token budget for one.

Residual: the bundled form `[3, 5]` is still unmatched by the regex.

### 4. Make the passage labels true — the real fix, not a small one

Fix 3 stops one chunk arriving twice with two labels. It does **not** help a
chunk supplied **once** under a wrong label — records 2 and 3 in
`claim_verdicts.json` are exactly that case.

Two layers:

- **Cue-phrase check at serving time.** Indian judgments are formulaic: "it is
  submitted that" / "learned counsel contended" marks an argument; "we are of
  the view" / "we hold" marks the court. `ARGUMENTS.md` Stage A already proved
  this method on this corpus. Where cues conflict or are absent, mark the
  passage uncertain rather than guessing. Server-side only — no re-chunking, no
  re-embedding, no Atlas re-indexing.
- **`section_primary` accuracy.** Measured at ~57% agreement. This is the root
  cause and a data-pipeline job. Not worth starting at this stage.

### 5. Confabulation toward the query — identified, mitigation proposed

Records 1, 11 and 21 each added a proposition the cited passage does not
contain, and all three added the *same* one: time limits on anticipatory bail,
which is precisely what sw01 asked about.

The model supplied the disputed point because the question was looking for it.
This is distinct from the labelling problem and **will survive every fix above**.
It is the failure mode most likely to be probed in a viva, because it is the one
people intuitively fear from a legal AI.

**Proposed mitigation — untested, not implemented.** Require the answer to quote,
verbatim, the words in the cited passage that support each claim, and refuse the
claim when no supporting phrase can be quoted. This is the evidence-phrase
discipline `ARGUMENTS.md` Stage A ran on this corpus with this model: a verbatim
evidence phrase was required for every affirmative verdict, and 0 of 179 lacked
one. Stage C's design carries the same rule forward — "an outcome with no evidence
paragraph downgrades to `unclear` automatically" — but Stage C is unbuilt, so the
rule itself is proven only in Stage A, and there it shows the model complied with
the requirement, not that the requirement improved accuracy.

Records 1, 11 and 21 would all fail this test, because the words are simply not
in the passage: "the power to cancel or modify remains with the granting court"
(1), "within a prescribed timeframe" (11), "including time-limits" (21). The quote
can also be checked mechanically — `faithfulness_check.ts` already locates quoted
fragments in passage text. It changes generation, so like fix 3 it would need a
re-measurement run.

## Not planned

- Re-measuring faithfulness after fixes 1–3 (no token budget; the write-up
  states plainly that 17/9/4 describes the pre-fix build)
- Running the remaining 14 of 20 queries (budget; 6 answers already yielded 50
  citations against a target of 30 — more queries would add topical variety,
  not sample size)
- Tuning the section-primary weights (fix 4 is the principled route; weight
  tuning is not)
