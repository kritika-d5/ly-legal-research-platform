# Coverage Probe Results — CounterEngine.md §12 item 1

Run 2026-09-11 against the live `/api/counter` endpoint (v0, plain JSON, `npm run dev`
on `:8080`). Expectations were committed to `eval/coverage_expectations.json`
(commit `4e12775`) before any query ran. No application code was changed in this pass.

**Scores.** `CounterItem` (the actual HTTP response shape) carries no similarity score
by design. Reported scores below come from calling the server's own `searchCases()`
(supporting round) and an equivalent read-only `$vectorSearch` with the same index,
filter and limits as `roundOpposingSubmissions` (opposing/submissions), from inside the
probe script — not a reimplementation, the same functions the server itself runs.
Graph attacks (opposing round, `viaGraph: true` items) and the pinned statutes round are
deterministic lookups with no similarity score by construction, and are reported as item
counts only.

---

## Phase 3 — what actually ran

All 20 queries completed against the live pipeline, 860ms–8.4s each (the slower ones
paid Groq classify-call latency). One structural finding here, ahead of Phase 4:

**`sw06` came back completely empty — 0 items in every round — because `classify()`
marked it `inScope: false`.** The query ("arrested for an offence punishable with less
than seven years... police did not first issue notice under Section 41A... is there
authority classifying offences into categories...") is unambiguously the corpus's own
centerpiece doctrine (Antil). This is not a retrieval gap, it's a **scope-classifier
false negative** — a real bail question got the "Counter Engine covers bail only" wall.
Distinct failure mode from everything else in this report; flagged separately below.

Offence-category inference landed sensibly elsewhere: `sf01`→pmla, `sf04`→ndps,
`sw09`/`sf08`→other_special, `sw03`→economic, everything else→ordinary. The pinned
statutes round fired correctly per its documented design — 1 item for `sf04` (ndps has a
pinned chunk), 0 for `sf01` (pmla has no pinned chunk, deliberately, per `counter.ts`'s
own verification that no bare s.45 text exists) — consistent with what Phase 1 verified
independently.

Item counts were otherwise uniform: 8 supporting, 8 opposing-submissions, 0–3 opposing-
graph-attacks, per query — the corpus never returned an empty round outright except for
`sw06`'s scope block. Full per-item data: `eval/coverage_raw_results.json`.

---

## Phase 4 — should-work: did the expected case surface?

| id | expected tid(s) | supporting rank | also in opposing? | top score |
|---|---|---|---|---|
| sw01 | 1108032 (Mhetre) | 2 | no | 0.0929 |
| sw02 | 1007347 / 1321773 | **1** | no | 0.0863 |
| sw03 | 1563495 (Sanjay Chandra) | 6 | no | 0.0840 |
| sw04 | 194334432 (Rakesh Kumar Paul) | **1** | yes | 0.0946 |
| sw05 | 123660783 (Sushila Aggarwal) | **1** | yes | 0.0839 |
| sw06 | 7148380 (Antil) | **none — scope-blocked** | no | — |
| sw07 | 8215697 (Nirala Yadav) | **1** | yes | 0.0903 |
| sw08 | 1012138 (Puran v Rambilas) | 2 | no | 0.0739 |
| sw09 | 1813801 (Kartar Singh) | **none — genuine miss** | no | 0.0773 (top item was Sibbia, not Kartar Singh) |
| sw10 | 1747003 (Uday Mohanlal Acharya) | 4 | no | 0.0894 |

**hit@1: 4/10. hit@5: 7/10. MRR: 0.542.**

Two queries scored zero, for different reasons:

- **`sw06`** — classifier false negative (see Phase 3). Not a corpus-coverage problem;
  fixing it means tuning `classify()`'s scope prompt, not adding material.
- **`sw09`** (Kartar Singh / TADA twin-condition rigour) — a genuine retrieval miss.
  The top-8 returned Sibbia, Gurcharan Singh, Sushila Aggarwal, an unfamiliar
  preventive-detention case, an 1908 case, Sanjay Chandra, Babu Singh, and Najeeb —
  general anticipatory-bail and twin-condition-adjacent cases, but never Kartar Singh
  itself. Plausible reason: Kartar Singh's own indexed chunks are dominated by the
  TADA *vires* (constitutional-validity) reasoning, not a crisply-worded articulation of
  the twin-condition bail test itself, so it doesn't win the embedding-similarity
  competition against cases that state the test more directly. A fair miss, not a bug.

Everything else landed rank 1–6, all within the top 8 the UI would actually show.

---

## Phase 4 — should-fail: what came back, and would it mislead a reader?

This is where the exercise earned its keep. I read the actual top-1 excerpt text for
all 10 — not just the score — and **4 of the 10 originally-verified gaps turned out to
have a genuinely correct, on-topic top answer**, despite Phase 1's chunk-count evidence
correctly showing the *exact target phrase* was rare:

| id | topic | top case | top score | excerpt says | verdict |
|---|---|---|---|---|---|
| sf01 | PMLA s.45 | Sushila Aggarwal | 0.0812 | s.438/s.437 procedural interplay — no PMLA content at all | **clean gap** |
| sf02 | Juvenile Justice Act | Vaman Narain Ghiya | 0.0601 | generic "philosophy of bail law" — nothing juvenile-specific | **clean gap** |
| sf03 | matrimonial/498A | Arnesh Kumar | **0.0948** | *is* Arnesh Kumar's own 498A/Dowry Prohibition Act fact pattern | **NOT a gap** — highest score of all 20 queries |
| sf04 | NDPS commercial quantity | Satpal Singh | 0.0865 | directly states the s.37 commercial-quantity bail bar | **NOT a gap** |
| sf05 | foreign nationals | Mhetre | 0.0564 | generic "arrest as last resort" — nothing about foreign nationals | **clean gap** |
| sf06 | interim/medical bail | Sushila Aggarwal | 0.0685 | s.438 proviso for s.376-type offences — unrelated | **clean gap** |
| sf07 | passport surrender | Sushila Aggarwal | 0.0803 | whether liberty is forfeited on charge-sheet filing — unrelated | **clean gap** |
| sf08 | POCSO | State of Bihar v Rajballav Prasad | 0.0640 | explicitly a POCSO Act prosecution, on point | **NOT a gap** |
| sf09 | bail pending appeal | Kashmira Singh | 0.0898 | directly holds accused should be released on bail pending appeal when the appeal can't be heard promptly | **NOT a gap** |
| sf10 | cheque dishonour (NI Act) | Sibbia | 0.0743 | s.438 discretion for death/life-sentence offences — unrelated | **clean gap** |

**Confirmed clean gaps: 6/10** (sf01, sf02, sf05, sf06, sf07, sf10).
**Reclassified as real, on-topic answers: 4/10** (sf03, sf04, sf08, sf09).

The honest lesson: my Phase 1 verification method (regex phrase count) measured the
wrong thing for these four. A topic can have only 1–11 chunks literally containing the
target phrase and still have a *single, correctly on-point* chunk that a semantic
retriever finds and ranks first — phrase scarcity is not the same as semantic absence.
Phase 1's peek-the-actual-text discipline (which caught the false positives in
juvenile/medical/passport/cheque) should have been applied with equal skepticism in the
*other* direction, to the low-but-nonzero counts, before calling them gaps.

---

## Phase 5 — is there a separating score threshold?

| group | n | top-score range |
|---|---|---|
| should_work (9 scored; sw06 scope-blocked) | 9 | 0.0739 – 0.0946 |
| should_fail, as originally labelled | 10 | 0.0564 – **0.0948** |
| should_fail, CONFIRMED clean gaps only | 6 | 0.0564 – 0.0812 |

**No, the groups do not separate, and I'm not proposing a threshold.**

Even restricted to the 6 *confirmed* clean gaps, the ranges overlap should-work
substantially: `sf01`'s 0.0812 sits inside the should-work range (above `sw08`'s
0.0739), and `sw08`'s 0.0739 sits inside the confirmed-gap range. And the single
highest score across all 20 queries in this entire run — 0.0948 — belongs to `sf03`, a
should-fail query that turned out to be a real answer. A threshold set anywhere that
keeps `sw08` (0.0739) would also keep every confirmed gap except `sf05`. A threshold
set high enough to exclude the gaps would exclude `sw08` and `sw09` too, and still let
`sf03`/`sf04`/`sf08`/`sf09` through — which is *correct* behavior for those four (they
are real answers) but proves the score itself isn't doing that filtering; the actual
content is.

**What this means, plainly:** on this corpus, cosine similarity from the supporting
round cannot distinguish "the corpus has a genuinely relevant precedent" from "this is
just the nearest thing available, and it isn't actually about the question." A
confidence gate built on this score (e.g. "don't show the empty-state unless score >
X") would suppress real answers (`sw08` at 0.0739) while still letting some genuinely
irrelevant nearest-neighbors through — it does not paper over the coverage gaps
correctly in either direction.

**Before building the generation step**, this needs a different gate than a raw score
cutoff — the four should-fail-turned-real-answer cases here were only distinguishable by
reading the actual excerpt text, which is exactly the check a citation-faithfulness pass
(§12 item 2) would need anyway. That evaluation, not a retrieval-score threshold, is
where the real gate belongs.

---

## Summary

- **20/20 queries ran** against the live pipeline; raw data in
  `eval/coverage_raw_results.json`.
- **should-work: hit@1 4/10, hit@5 7/10, MRR 0.542.** One scope-classifier false
  negative (`sw06`, fixable in `classify()`, not a corpus problem), one genuine
  retrieval miss (`sw09`).
- **should-fail: 6/10 confirmed as real gaps** (empty of genuine coverage); **4/10
  were actually answerable** despite low keyword counts, a correction to Phase 1's own
  verification, not a finding about the live pipeline.
- **Similarity score does not separate the two groups.** No threshold is proposed.
  Confidence gating for the empty-state / "no strong counterargument found" behavior
  needs a content check, not a score cutoff.

---

## Follow-up: four fixes, in order (2026-09-11, same-day)

Application code changed in this section: `server/src/lib/classify.ts` (prompt fix),
`server/src/lib/relevance.ts` (new), `server/src/lib/rerank.ts` (new),
`server/src/lib/counter.ts` (wires both in). Re-runs used the same 20 queries, same
expectations, no new queries written. Intermediate raw-result snapshots kept on disk
(uncommitted) for the diffs below: `coverage_raw_results_baseline_before_sw06fix.json`,
`coverage_raw_results_before_gate.json`, `coverage_raw_results_before_rerank.json`.

### 1. Fixed `sw06` — a scope-classifier false negative

Root cause, confirmed by reproducing it in isolation: `sw06`'s query never uses the
word "bail" — it's phrased entirely as arrest-necessity / s.41A-notice / custody
questions, which IS this corpus's centerpiece doctrine (Antil), but `classify()`'s
system prompt framed scope narrowly as "a bail-law question," with no guidance that
arrest/custody-necessity counts. Fixed by adding an explicit paragraph to the prompt
naming arrest-necessity, s.41/41A notice, and custody-necessity as in-scope even
without the literal word "bail."

Re-ran all 20 to check for regressions: **only `sw06` changed** (`inScope: false` →
`true`); all 19 others' `inScope` flags are identical before/after. `sw06` now hits
**rank 1** (Antil, tid 7148380) in the supporting round.

should-work metrics, fix only: **hit@1 4/10 → 5/10, hit@5 7/10 → 8/10, MRR 0.542 → 0.642.**

### 2. Phase 5 recomputed on the 6 confirmed gaps only — pure recomputation, no new queries

| group | n | top-score range |
|---|---|---|
| should_work | 10 | 0.0703 – 0.0946 |
| should_fail, CONFIRMED clean gaps only | 6 | 0.0564 – 0.0812 |

**The non-separation conclusion survives, sharpened rather than reversed.** A
threshold at 0.0812 does fully exclude all 6 confirmed gaps (0 false positives) — but
only by also wrongly rejecting **3/10 (30%) of genuine should-work queries**
(`sw06`, `sw08`, `sw09`; ironically `sw06` is the one just fixed for scope — a score
gate would have silently reintroduced the same suppression through a different door).
No threshold available in the data gets both error rates to zero. The top-minus-5th-
item drop-off shape doesn't separate the groups either — `sf07`'s drop-off (0.0420) is
steeper than 6 of the 10 should-work queries. Score-based gating remains the wrong tool.

### 3. Content-relevance gate, replacing the score threshold

**Design** (`lib/relevance.ts`, wired into `runCounter` in `counter.ts`): one Groq call
per round (supporting, opposing), asking yes/no per top-5 item whether it actually
addresses the question — not merely whether it's generally bail-related. If every
checked item comes back "no," the round collapses to `empty: true`. Fails open (keeps
everything) on a missing key or an error — an overzealous gate that empties every round
on a Groq outage would be worse than the threshold problem it replaces. **Statutes round
excluded on purpose**: it's a single hand-verified pinned lookup per `offenceCategory`,
not a similarity search, so it carries none of the nearest-neighbour risk this gate
exists for.

**Regression check:** 0/10 should-work supporting rounds wrongly emptied.

**First attempt — confirmed-gap behavior, mixed:**

| round | confirmed gaps correctly emptied |
|---|---|
| supporting (top 8 of ~5,000 broad court_text chunks) | **1/6** (only `sf01` PMLA) |
| opposing/submissions (top 8 of ~2,000 narrower submissions chunks) | **5/6** (all but `sf07`) |

I read the actual text behind this, not just the flag. For `sf02` (juvenile bail), the
top 5 supporting items are Vaman Narain Ghiya (generic bail philosophy), Sushila
Aggarwal (a s.437(3)/s.376 proviso passage), Prahlad Singh Bhati (a Chapter XXXIII bail
overview), Sanjay Chandra (generic non-bailable-detention principle), and a TADA
"disruptive activities" bail passage — **none mentions juveniles or the JJ Act**, yet
the gate's LLM call judged at least one "relevant" and kept the round open, even though
the prompt already warned against "generally bail-related is not enough". A candidate
pool of 8 broad, all-genuinely-about-bail passages gave the model enough surface
plausibility to find something arguably relevant even when nothing addressed the
specific sub-question.

**Refinement (one attempt, as agreed):** named the failure mode directly in the prompt —
*"The test: would a lawyer researching THIS SPECIFIC question actually cite this
passage? Answer no if the passage is about bail generally — or about some other bail
topic entirely — but does not address the issue this question actually raises. A
passage sharing vocabulary with the question (bail, custody, chargesheet, investigating
agency) is not enough on its own; that vocabulary recurs throughout nearly every passage
in this corpus regardless of topic."*

Re-ran the 6 confirmed gaps only (no new queries):

| round | confirmed gaps correctly emptied |
|---|---|
| supporting, refined prompt | **5/6** (up from 1/6 — only `sf02` juvenile bail still slips through) |

Checked `sf02` again after the refinement: the top 5 supporting items are now Hassan Ali
Khan (a PMLA facts passage), Mhetre (AB custody-concomitant principle), Prahlad Singh
Bhati (Chapter XXXIII overview), Vaman Narain Ghiya (bail philosophy), and Antil (s.437
exceptions) — again none about juveniles, and the gate still lets at least one through.
**Documented weakness, shipped as-is per the one-attempt rule**: this corpus's court_text
pool is broad enough, and generically bail-adjacent passages plausible enough, that an
LLM relevance check on 5 candidates alone doesn't fully close every narrow gap — a
stricter fix (e.g. requiring the model to quote which specific part of the passage
addresses the sub-issue, mirroring Stage A's evidence-phrase discipline, or a
smaller/filtered candidate pool) is the natural next step, not attempted here.

**Net effect vs. no gate at all:** strictly better on every measured axis — 5/6 confirmed
gaps correctly emptied in supporting (up from 1/6), 5/6 in opposing, PMLA fully closed in
both, and 0/10 should-work rounds wrongly emptied. **Kept and committed.**

### 4. Cross-encoder reranker — implemented, measured, and it made ranking WORSE

**Design** (`lib/rerank.ts`, wired into `roundSupporting`): `Xenova/ms-marco-MiniLM-
L-6-v2` (transformers.js ONNX port of the model CounterEngine.md §7 named), loaded via
the raw model + tokenizer — NOT `pipeline('text-classification', ...)`, which silently
softmaxes this single-logit regression model to a useless constant 1.0 for every input
(verified before wiring it in). The supporting round now fetches a widened pool
(`RERANK_POOL = 24`, up from 8) via the existing RRF/bi-encoder search, scores each
candidate's best passage against the actual query with the cross-encoder, then keeps
the top 8 by that score — reranking after truncation would only reorder the 8 survivors
and could never recover a case RRF ranked 9th–24th.

| | hit@1 | hit@5 | MRR |
|---|---|---|---|
| before rerank (post classify-fix, with gate) | 5/10 | 8/10 | 0.642 |
| **after rerank** | **1/10** | 7/10 | **0.325** |

**This is a regression, not an improvement, and I'm reporting it as one.** Per-query
ranks:

| id | rank before | rank after |
|---|---|---|
| sw01 | 2 | 2 |
| sw02 | 1 | 2 |
| sw03 | 6 | **none — fell out of top 8** |
| sw04 | 1 | 1 |
| sw05 | 1 | 3 |
| sw06 | 1 | 3 |
| sw07 | 1 | 4 |
| sw08 | 2 | 3 |
| sw09 | none | none |
| sw10 | 4 | **none — fell out of top 8** |

Diagnosed the cause directly (`sw03`, the economic-offence query): among 24 RRF
candidates, the cross-encoder scored **Rakesh Kumar Paul highest (+0.56)** — a s.167(2)
default-bail case with nothing to do with economic offences — while **Sanjay Chandra,
the actually-correct answer, scored -3.64**, below several off-topic cases including
Antil (-3.62) and Mhetre (-3.43). Rakesh Kumar Paul's passage happens to reuse the
query's own vocabulary ("chargesheet," "custody," "investigating agency") almost
verbatim; Sanjay Chandra's extracted passage (`searchCases`'s best-RRF-scoring excerpt,
not necessarily the most topically representative one) is a generic personal-liberty
statement that shares little surface phrasing with the query. This looks like **lexical-
overlap bias**: MS-MARCO's cross-encoder was trained on short, distinctive web-search
queries, and these probe queries are long, paragraph-style legal fact patterns dense
with terms (bail, custody, chargesheet, investigating agency) that recur throughout
nearly every passage in this corpus — the model appears to reward shared vocabulary
over genuine topical alignment on inputs this far from its training distribution.

One partly-offsetting observation, not a redemption: with the reranker active, the
content gate's supporting-round performance on confirmed gaps *improved* to 5/6
(`sf02` the lone holdout) — a different top-8 gives the gate's LLM call a different,
apparently easier-to-reject set of candidates. This is a side effect of the two
mechanisms interacting, not evidence the reranker is doing its intended job; its actual
job — improving rank on the queries with a real answer — got measurably worse.

**Recommendation: do not keep this reranker in this configuration.** Options if
reranking is still wanted: (a) drop it entirely and keep RRF's own ranking (hit@1 5/10
was already the best result on record), (b) try a passage-only relevance model rather
than a query-passage cross-encoder MS-MARCO was trained for short queries, (c)
compress the fact-pattern query to its legal issue before reranking, stripping the
narrative vocabulary that seems to be driving the false matches, or (d) fine-tune on
this corpus's own submissions/holdings pairs. None attempted here — this is a decision
point, not something to silently iterate on further.

**Decision: dropped.** `lib/rerank.ts` deleted, `roundSupporting` reverted to plain
RRF top-8 (no widened pool, no cross-encoder call). This is a wrong-tool result with an
identified mechanism, not a tuning failure — no alternative rerankers were tried, per
instruction. The finding stays in this document as the record of what was tried and why
it was rejected.

---

## Disposition (2026-09-11, end of day)

| # | Decision | Status |
|---|---|---|
| 1 | classify() scope fix | **Kept, committed** (`49a052d`) |
| 2 | Phase 5 recomputed on clean labels | Measurement only — no code |
| 3 | Content-relevance gate, refined once | **Kept, committed** — 5/6 confirmed gaps (supporting), 5/6 (opposing), `sf02` documented as a residual weakness |
| 4 | Cross-encoder reranker | **Dropped, `rerank.ts` deleted** — regression kept as a documented finding |

**Final shipped numbers** (classify fix + refined gate, no reranker), confirmed across
two independent full 20-query runs: **hit@1 5/10, hit@5 8/10, MRR 0.642.**

One operational note from the final artifact-refresh run: partway through it, Groq's
free-tier daily token cap (200k TPD, shared across today's `legal-rag-data` and
`ly-project` work) was hit. The relevance gate's fail-open design handled this
correctly — `[relevance] falling back to keep-all` in the server log, not a crash or a
false empty — but it means that specific run's should-fail *empty flags* are not
representative (everything fails open to "keep all" once the cap is hit). The
authoritative 5/6 confirmed-gaps number above comes from a dedicated 6-query check that
ran before the cap was reached; the should-work hit@1/hit@5/MRR numbers are unaffected
(ranking depends only on RRF, not on the gate) and were confirmed identical across both
runs. No further retrieval work is planned — see the top-level session note for why
hit@5 8/10 on 198 judgments is being treated as sufficient for this prototype.

---

## Follow-up: section_primary tiebreaker, A/B (2026-11-01)

Application code changed in this section: `server/src/lib/search.ts` only — a shallow
multiplier on the fused RRF score inside `fuse()`, keyed on each passage's
`section_primary` (ratio/reasoning ×1.15, analysis ×1.10, issue/order ×1.00,
preamble/facts ×0.85, submissions ×0.80), disabled by `SECTION_BOOST=off` — **and then
reverted**; `search.ts` is back to plain RRF, identical to the committed version. Motivated by
Finding A in `eval/citation_faithfulness_results.md`: the dominant hand-review failure
was the right judgment cited through the wrong passage. Same 20 queries, same
expectations, no new queries written.

### Method — measured in-process, without the server or Groq

The supporting-round ranking is `searchCases(query, { contentTypes: ['court_text'],
limit: 8 })` and nothing else — Mongo plus the local BGE embedder. `classify()`, the
relevance gate and `generateAnswer` all run *after* it in `runCounter` and cannot
reorder it. So the A/B calls `searchCases()` directly, with exactly `roundSupporting`'s
options, via a new eval script `server/src/scripts/section_boost_ab.ts` — one process
per arm, the flag set inside the script before `lib/search.js` is dynamically imported
(the flag is a module-level constant, so a static import would freeze it). Output:
`eval/run_A_boost_off.json`, `eval/run_B_boost_on.json`, scored unchanged by
`eval/score_run.py`. Script and both run files are kept as the evidence. (With the boost
now reverted, re-running the script yields two identical arms and its `check` step
reports VOID — that is the expected behaviour, not a fault.)

This is a methodological improvement over the September runs, not a shortcut. Those
went over HTTP, which costs ~4 Groq calls per query now that Stage F exists, and one
of them hit the 200k daily token cap mid-run, leaving that run's empty flags
unrepresentative. This arm makes zero Groq calls, so a cap cannot contaminate it, and
there is no running server whose environment can silently disagree with the operator.
That last risk is not hypothetical: the first attempt at this A/B found a hand-started
dev server serving with the boost **on** while it was believed to be off — caught by
comparing its `/api/search` rankings against in-process rankings for both settings, and
discarded before any probe result from it was used.

**Validity checks.** The arms differ on 19/20 queries, so the flag took. Arm A
reproduces the documented baseline exactly — hit@1 5/10, hit@5 8/10, MRR 0.642, and
every per-query rank identical to the September table — so the harness matches
September conditions and the comparison is clean.

### Result — no change in any headline metric

| id | rank, boost off (A) | rank, boost on (B) |
|---|---|---|
| sw01 | 2 | 2 |
| sw02 | 1 | 1 |
| sw03 | 6 | 6 |
| sw04 | 1 | 1 |
| sw05 | 1 | 1 |
| sw06 | 1 | 1 |
| sw07 | 1 | **2** |
| sw08 | 2 | **1** |
| sw09 | none | none |
| sw10 | 4 | 4 |

| | hit@1 | hit@5 | MRR |
|---|---|---|---|
| boost off (A) | 5/10 | 8/10 | 0.642 |
| **boost on (B)** | **5/10** | **8/10** | **0.642** |

Two ranks moved, in opposite directions, by exactly one place each — so MRR is
identical to three decimals. Both moves are near-ties, which is the regime a shallow
multiplier is meant to decide: `sw07` 0.0934 vs 0.0928, `sw08` 0.0837 vs 0.0822.

### Mechanism

`searchCases` scores a *case* as the sum of its top-3 passage scores, so the multiplier
reorders cases as well as choosing which passage each case is cited through. A case
whose best passages are labelled reasoning gains up to 15%; one leaning on submissions
or facts loses up to 20%.

- **`sw08` (better):** Puran v Rambilas overtakes Kalyan Chandra Sarkar. Both are
  cited through reasoning passages; Puran's top-3 is simply more reasoning-heavy.
- **`sw07` (worse):** Nirala Yadav loses rank 1 to Hitendra Vishnu Thakur — and
  Hitendra is promoted on passage `41993725_c060`, labelled `reasoning`, which is
  verbatim the **GROUNDS of a bail application** ("1. That the investigating agency
  has not filed the charge-sheet... It is therefore prayed that the applicant accused
  be released on bail. Sd/- (Advocate for accused)"). This is the very passage Finding
  A flagged. The boost did not fix it; it amplified it, because its label is wrong.
  This is the ~57% `section_primary` reliability showing through: a multiplier on a
  noisy label rewards the mislabels as faithfully as the correct ones.

**The four Finding A passages, checked one by one against the text — not the label:**

| id | case | boost off | boost on | verdict |
|---|---|---|---|---|
| sw01 r1 | Sushila Aggarwal | c025, counsel's submissions | c195, the answer to the second referred question ("the life of an anticipatory bail does not end generally... but can also continue till the end of the trial") | **fixed** — now cites the holding |
| sf03 r1 | Arnesh Kumar | c000, facts recital | c001, the court's own observations on s.498-A misuse | **partly** — the court speaking, but still not the s.41A guidelines |
| sw07 r2 | Hitendra Vishnu Thakur | c060, bail-application grounds, rank 2 | same passage, **rank 1** | **not fixed, made more prominent** (mislabel above) |
| sf08 r1 | Rajballav Prasad | c000, facts recital, rank 1 | same passage, **rank 3** | **not fixed, on-point case demoted** behind a TADA order and an SC/ST Act case |

One clean fix, one partial, two failures. `sf08` deserves stating plainly because the
scorer cannot see it: it is a should-fail query that Phase 4 reclassified as a real
POCSO answer, so it carries no expected tid and the regression is invisible to
hit@1/MRR. Its correct case dropped from first to third.

Across all 160 cited supporting passages (20 queries × 8), submissions-labelled
citations fall **14 → 1** and facts-labelled **6 → 2**; reasoning-labelled rises
114 → 137. **This is not 13 more holdings.** It is 13 more chunks *labelled* something
other than submissions — and `sw07` shows directly that a `reasoning` label can sit on
a counsel's document. At ~57% label agreement, the shift in labels says nothing reliable
about the shift in what the passages actually are.

### A blind spot in the harness, not only in this experiment

`sf08`'s correct case falling from rank 1 to rank 3 is invisible to `score_run.py`, and
would be invisible to any change measured with it. `should_fail` queries carry no
expected tid, so the scorer skips them entirely — yet four of them (`sf03`, `sf04`,
`sf08`, `sf09`) were reclassified in Phase 4 as having a genuine on-topic answer. Any
ranking change can silently demote those four and still report "no change". The fix is
a data change, not a code change: record the Phase 4 answers (Arnesh Kumar, Satpal
Singh, Rajballav Prasad, Kashmira Singh) as expected tids on those four queries, or
move them to `should_work`. Not done here — the expectations file is pre-registered and
was not to be edited in this pass.

### Decision — REVERTED

MRR 0.642 → 0.642, hit@1 5/10 → 5/10, hit@5 8/10 → 8/10. Inside the ±0.02 band, where
the pre-agreed rule said keep — but only on the stated grounds that the boost fixes the
four passages found by hand. The text shows it fixed one of four, and made `sw07`
worse by promoting a mislabelled bail application to rank 1. With that premise gone the
change has no justification left: it moves no metric, and its one visible effect —
relabelling what gets cited — is not evidence of better citations at this label
accuracy. **`search.ts` reverted to plain RRF**: `SECTION_BOOST_ON`, `SECTION_WEIGHT`,
`sectionWeight()` and the multiplier in `fuse()` removed; `tsc --noEmit` clean.

**The general finding, which is the reason this section exists:** `section_primary` at
~57% agreement is too noisy to be a **ranking** signal, not only too noisy to be a
filter. A multiplier on a noisy label is faithful to the label, so it rewards the
mislabels exactly as much as the correct labels, and no choice of weights separates the
two. This contradicts the current known-limits entry in `CounterEngine.md` §10, which
records `section_primary` as "ranking signal only, never a filter"; on this evidence it
should be neither until the labels improve. The way forward is the labels, not the
weights — `41993725_c060`, a counsel's application reproduced inside a judgment, is the
concrete example, and reasoning-labelled chunks that open with "GROUNDS" or close with
an advocate's signature are a cheap first place to look. Not attempted here.

This is a wrong-signal result with an identified mechanism, not a tuning failure — no
alternative weightings were tried. The finding stays in this document as the record of
what was tried and why it was rejected.

The end-to-end HTTP `coverage_probe.ts` refresh was skipped: Groq does not expose
remaining daily tokens and the in-process A/B does not depend on it, so
`eval/coverage_raw_results.json` remains the 2026-09-11 artifact.
