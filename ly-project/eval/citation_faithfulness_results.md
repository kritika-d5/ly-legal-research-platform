# Citation Review — 30 retrieved citations, read in full

Run 2026-11-01. Source: `legal-rag-data/src/dump_citations_for_review.py`,
seed 7, top-3 supporting items per query from `eval/coverage_raw_results.json`.
Each citation's full chunk text was read against the query it was retrieved for.

**This is a retrieval-precision check, not the §12 item 2 faithfulness check.**
§12 item 2 asks whether a cited paragraph supports a *claim the generated answer
makes*. The coverage probe predates `generate.ts`, so no stored answers exist.
This measures the weaker, prior question: does the retrieved passage address the
question at all? The stricter check still needs to be run.

## Integrity

`chunk id not found in chunks: 0`. Every retrieved id resolves to real stored
text. No broken references.

## Sample composition — read this before the numbers

| group | n |
|---|---|
| should_work | 12 |
| should_fail | 18 |

Random sampling drew 18 of 30 from `should_fail` — queries where Phase 4
already established the corpus has no answer. Those are *expected* to return
off-topic material; suppressing them is the relevance gate's job, not the
retriever's. **A single blended accuracy figure across all 30 would be
meaningless.** Scored separately below.

## should_work — 12 citations

| verdict | n | meaning |
|---|---|---|
| supports | 6 | passage states the rule the question asks for |
| partial | 3 | correct case and issue, but the passage doesn't state the rule |
| wrong | 3 | unrelated doctrine |

**6/12 squarely on point. 9/12 at least on the right case and issue.**

Squarely supporting: Mhetre paras 109–111 (sw01), Nirala Yadav paras 2–5 (sw04),
Sushila Aggarwal p.68 (sw05), Kalyan Chandra Sarkar (sw08), Puran v Rambilas
(sw08), Rakesh Kumar Paul p.51 (sw10).

Puran v Rambilas is the strongest in the set — it states the Dolat Ram
distinction and then the exact carve-out the question turns on (a perverse,
unreasoned order may be set aside, which is different from cancelling bail for
misconduct).

Wrong: Deoman Upadhyaya 1960 on s.27 Evidence Act returned for an
economic-offence custody question (sw03); two s.167(2)/police-custody passages
returned for an s.41A arrest-notice question (sw06).

## should_fail — 18 citations

| verdict | n |
|---|---|
| correctly irrelevant | 11 |
| partial | 6 |
| supports | 1 |

The one genuine answer is Satpal Singh (sf04), which states the s.37 NDPS
commercial-quantity bar directly — consistent with Phase 4 reclassifying sf04
as "NOT a gap".

Of note: Mhetre (sf05, foreign nationals) explicitly lists "seize either the
passport or such other related documents" among its suggestions. The Phase 4
table recorded this as "generic arrest as last resort — nothing about foreign
nationals". The passage is closer to the question than that note credits,
though still not about foreign nationals as such.

## Finding A — right case, wrong passage

The most common failure is not retrieving the wrong judgment. It is retrieving
the **wrong part of the right judgment**.

| id | case | what was returned | what was needed |
|---|---|---|---|
| sw01 r1 | Sushila Aggarwal | counsel's submissions + the referred questions | the holding |
| sw07 r2 | Hitendra Vishnu Thakur | the text of a bail application's grounds | the court's reasoning |
| sf03 r1 | Arnesh Kumar | the facts recital | the s.41A guidelines |
| sf08 r1 | Rajballav Prasad | the facts recital | the POCSO bail reasoning |

`section_primary` is already stored on every chunk. `CounterEngine.md` records
it at ~57% agreement and rules it out as a filter — correctly. But it is not
currently used as a **ranking boost** either. Preferring `reasoning`/`ratio`
over `facts`/`submissions` at equal similarity costs nothing and would address
every row above. Worth one experiment against the existing 20-query harness.

## Finding B — hub chunks that match everything

Sushila Aggarwal p.73 was returned for **both** sf02 (juvenile bail) and sf05
(foreign nationals). It contains bare statutory text of s.437(7) and s.438.
Sibbia and Sushila Aggarwal recur across unrelated queries generally.

These are low-information, high-recall passages: they quote the statute, so
they are weakly similar to every bail question and specific to none. Counting
how many distinct queries each chunk is retrieved for would identify them, and
a small penalty on chunks appearing across many unrelated queries would
sharpen the top-8 at no corpus cost.

## Minor

- `court_tier` and `year` came back null for every sampled node — the field
  names in `nodes` differ from what the dump script looked for. Cosmetic here,
  but worth checking before anything relies on them.
- Keshav Dev (Rajasthan HC) and Banka Das (Orissa HC) appear in the sample,
  consistent with the known "43 nodes are not Supreme Court" limit.

## Still outstanding

The §12 item 2 check proper: generate answers for the 20 queries with
`generate.ts`, store them, and verify each claim against its cited paragraph.
That is the number an examiner will ask for; this document is not a substitute
for it.

---

# §12 item 2 — citation faithfulness (started 2026-11-02)

The stricter check the section above says is outstanding: real generated answers,
every citation checked automatically, and 30 citations dumped with the exact
sentence they are attached to, for review by hand.

## How the answer cites

Read from `server/src/lib/generate.ts`, not assumed. The model is given numbered
passages, `[1]`..`[n]`, built in round order (supporting, opposing, statutes); prompt
rule 11 requires every claim to be cited as a plain ASCII `[N]`. The answer ends
with a `## Sources` table mapping each number to a case name and locator. Passages
reach the model truncated to 1,200 characters.

## Method

- `server/src/scripts/faithfulness_run.ts` posts each of the 20 queries to the real
  `/api/counter` endpoint, stores the answer and the raw rounds, and derives each
  `[N]` with the server's own `selectForContext()`, so the eval's numbering cannot
  drift from the model's.
- Groq's free tier allows 200k tokens a day and 8,000 per request. The 20 queries
  therefore run in batches on separate days and are merged. A batch is aborted if the
  server logs a classify or relevance-gate fallback — the sign that a budget cap is
  contaminating the run — and is kept on disk marked invalid, never deleted.
- `server/src/scripts/faithfulness_check.ts` runs the automatable checks and draws the
  hand-review sample. It makes no Groq calls and records no verdicts.

**An operational lesson from the first attempt.** The first day-one batch treated a
generation failure as an abort and *deleted* the batch on abort. When `sw10` failed
(Finding 2), eight good answers went with it. Both rules were changed before the next
run: generation failures are now recorded on their query, and aborted batches are kept.

## Finding 1 — the server's own citation check was checking nothing

`generateAnswer` returns `invalidCitations`, documented as the automatable half of
Hard Rule 4: every `[N]` the model cites must be within the supplied range. It is
computed by `findInvalidCitations`, which matches `/\[(\d+)\]/g` — plain ASCII brackets
only.

In the `sw01` pilot the model wrote **every one of its 13 citations** as
`【1†para 7】` — fullwidth lenticular brackets, a dagger, and a locator, a format
`gpt-oss` models are known to produce, and the exact form rule 11 forbids by name
("never 【3】"). The regex matched none of them, found nothing to check, and returned
`invalidCitations: []`. To the UI, and to anyone reading the response, that reads as
"no fabricated citations". It was a check that silently passed because it never ran.
A safety check that passes on input it cannot parse is worse than no check: it
manufactures assurance.

The style is not stable across runs — `sw10`'s answer used plain `[N]` throughout —
so the blind spot is intermittent, which is what would let it survive casual testing.

**One-line fix, deliberately not applied in this task** (fixing the instrument while
measuring with it would invalidate the measurement): in `findInvalidCitations`, match
both bracket styles and an optional `†locator` tail —
`markdown.matchAll(/[\[【](\d+)(?:†[^\]】]*)?[\]】]/g)` — and treat any non-plain form as
a rule 11 violation in its own right. To be applied after the numbers below are in.

The eval's own extractor does not share the blind spot: it parses `[N]`, `【N】`,
`【N†locator】`, `[N, M]` and ranges, and counts format violations separately from
out-of-range numbers.

## Finding 2 — a should_work query was unanswerable, because retrieval worked

`sw10` failed generation on every run: `413 Request too large ... tokens per minute
(TPM): Limit 8000, Requested 8257`. The free tier's 8,000-token ceiling applies per
request; nothing is spent, and retrying cannot help because retrieval is deterministic
and rebuilds the same prompt every time. The user would see "summary could not be
produced" on a query the corpus answers well.

The mechanism is the uncomfortable part. `generate.ts` handed the model every item of
every round, capped only at 8 per round — up to 17 passages. A query with full rounds
is a query retrieval served well; `sw09`, where retrieval fails, supplied 0 passages
and answered instantly. **The better the retrieval, the larger the prompt, and the more
likely generation failed.** Three other should_work queries supplied the same 16
passages and passed below the ceiling — `sw04`, `sw07`, `sw08` — so `sw10` was the one
over the line, not an outlier.

**Fix (application code, `server/src/lib/generate.ts`), applied before measuring** —
an input-size guard, not the citation behaviour under test; and measuring first would
have measured a system that returns "generation failed" on a should_work query.
`CounterEngine.md` §5.4 already specified it and the code never applied it: quota
selection of 4 supporting / 5 opposing / 2 statutes, capped at 12. Items carry no
cross-round comparable score, so §5.4's "rest by score" is implemented as round-robin
by rank across rounds. Per-passage text was **not** additionally capped — not needed:

| | passages | prompt tokens (o200k count) | ≈ Groq's count |
|---|---|---|---|
| `sw10` before | 16 | ~6,060 | 8,257 (reported in the 413) |
| `sw10` after | 12 | 4,736 | ≈ 6,900 |

Groq counts the request ~2,200 tokens higher than an o200k tokenizer does on the text
alone (calibrated on the one request Groq reported); the right-hand column applies
that offset. `sw10` now generates (5,151 characters). Counts for every query, after the
fix, are measured by `server/src/scripts/measure_prompt_tokens.ts` and listed below
once the run is complete.

## Finding 3 — one passage, shown to the model twice under contradictory labels

In `sw10`, chunks `1376808_c014` and `123660783_c184` were retrieved by **both** the
supporting round (presented as `COURT'S REASONING`) and the opposing round's
submissions search (presented as `SUBMISSION, SIDE NOT DETERMINED`). After the cap,
`1376808_c014` was handed to the model twice, under two numbers, with labels that
contradict each other on the question the prompt treats as legally decisive — is this
the court speaking or counsel? The supporting round takes any `court_text` chunk; the
opposing round takes chunks whose `section_primary` is `submissions`; nothing stops one
chunk being both. Not fixed here. It also briefly broke this eval's own numbering
(keyed on chunk id), now keyed on position.

## Finding 4 — the relevance gate emptied a should_work query

`sw09` (Kartar Singh, TADA twin conditions) supplied **0 passages**: the gate emptied
both rounds and the answer is the stock "nothing was retrieved" notice. Consistent with
September — `sw09` is the one genuine retrieval miss, and Kartar Singh never surfaces —
so the gate's verdict that nothing retrieved addresses the question is, on that
evidence, correct. It contributes no citations to the check below.

## Finding 5 — the gate's verdict on a should_work query is not stable

`sw05` (Sushila Aggarwal, rank 1 for its expected case in every retrieval run on
record) supplied **8 passages** in the discarded day-one batch and **0** in batch 2
a few hours later: the gate judged every supporting and every opposing candidate
irrelevant, so the answer is the stock "nothing was retrieved" notice. Retrieval is
deterministic, so the candidates were the same; only the gate's LLM verdict changed,
at `temperature: 0`. September recorded 0/10 should_work rounds wrongly emptied; that
figure was one sample of a non-deterministic judgement, not a property of the gate.

Kept as measured, not re-run until it passes — re-running would measure the outcome I
wanted rather than the product. It removes `sw05` from the citation pool. `sw02` and
`sw03` also had their opposing rounds emptied, which on the September evidence may be
correct.

## Batches

| batch | queries | generated | under the §5.4 cap? |
|---|---|---|---|
| pilot | `sw01` | 2026-11-02 | **no** — 16 passages |
| verify | `sw10` | 2026-11-02 | yes — 12 passages |
| 2 | `sw02`–`sw05` | 2026-11-02 | yes |
| 3 | `sw01` regenerated, `sw06`–`sw09`, `sf01`–`sf10` | **not run** | — |

**Batch 3 was not run.** The evaluation was closed out on 2026-11-02 with the answers
already on disk, a budget decision on Groq's free tier: batch 3 needed roughly a further
150k tokens, a second day of the 200k daily allowance. `sw01` was therefore never
regenerated, and its pilot answer is included as it stands — **generated before the
§5.4 cap, from 16 passages rather than at most 12**, so under different conditions from
the other five.

## Results — 6 answers of 20

> **These results describe the build of 2026-11-02 as it then ran.** One change made
> afterwards alters generation — duplicate passages collapsed to one copy, marked
> `SOURCE UNCERTAIN` where rounds disagreed — and it has not been re-measured. See
> "Changed after the numbers were in". Do not read the numbers below as describing the
> current build.

**What was measured.** Six answers, all `should_work`: `sw01` (anticipatory bail,
conditions and duration), `sw02` (undertrial delay, Article 21), `sw03` (economic
offences), `sw04` (default bail, s.167(2)), `sw05` (anticipatory bail, unlimited
duration) and `sw10` (default bail, timing of charge-sheet vs application). `sw05` is
the empty "nothing retrieved" answer of Finding 5 and contributes no citations — itself
a result. **Not generated: 14 queries** — `sw06`–`sw09` and all ten `should_fail`
queries `sf01`–`sf10`. Merged set: `eval/generated_answers.json`; every flagged
instance in full: `eval/citation_checks.json`.

### Step 2 — automatable checks, all 50 citations in the 5 answers that cite

| check | count | of 50 |
|---|---|---|
| citations in answer bodies | 50 | — |
| resolve to a passage actually supplied | **50** | 100% |
| **do not resolve (fabricated or malformed number)** | **0** | 0% |
| `## Sources` rows naming a number not supplied | 0 | — |
| format violations (not plain `[N]`, prompt rule 11) | **24** | 48% |
| locator in the marker contradicts the cited passage | **0** | 0% (of 14 carrying one) |
| body text and Sources table / passage disagree on the case | **2** | 4% |

**No fabricated citation.** Every one of the 50 numbers points to a passage the model
was actually given, and no Sources row names a number outside the supplied set. This is
the Hard Rule 4 result, and on this sample it holds.

**Format: 24 of 50 citations violate rule 11, in 3 of 5 answers.** `sw01` — all 13
(10 as `【N†locator】`, 3 as `【N】`); `sw03` — all 7 (`【N】`); `sw04` — 4 of 12, written
as `[N]¶2`, a locator appended outside the bracket. `sw02` and `sw10` are fully
compliant. This is what Finding 1 means in numbers: the server reported
`invalidCitations: []` for every answer, but its regex could read only 30 of the 50
citations. Its clean verdict on `sw01` and `sw03` was a verdict on nothing.

**Locators: 14 citations wrote one inside the marker; none contradicts its passage.**
10 match the passage's stored locator. 4 — all in `sw01` — cite paragraph numbering
printed inside the passage's own text rather than the stored locator: `【1†para 6.2】`
and `【13†para 6.2‑6.3】` against stored `para 7` (the passage opens "6.2 It is further
submitted…"), and `【4†(vi)‑(viii)】` twice against a passage with no stored locator
whose text carries clauses (vi)–(viii). Traceable, so not counted as mismatches, but
listed so the reader can disagree. The §12 requirement "every locator in the answer
exists in the retrieved set" is met for all 14. The other 36 citations carry no locator
in the marker; for those the locator appears only in the Sources table.

**Body vs Sources: 2 disagreements, both in `sw01`, both the same error.** Passage
`[1]` is *Sushila Aggarwal* (2020), para 7, and the Sources table says so correctly —
but the body twice attributes it to *Sibbia*:

> | The **discretionary power** to **limit** the period of anticipatory bail is
> recognised by the Constitution Bench in *Gurbaksh Singh Sibbia*; the court can
> "limit the period of anticipatory bail" for justifiable reasons【1†para 7】. |

> - The Constitution Bench in *Sibbia* expressly **allows** courts to **limit** the
> period of anticipatory bail, contradicting any claim of an absolute prohibition on
> time‑limits【1†para 7】.

*Sibbia* itself was passage `[3]`, which the body never cites. Whether Sushila
Aggarwal's para 7 is quoting Sibbia is a question for the hand review; the automatic
finding is that the case the sentence names is not the case of the passage it cites.
The second instance is in the hand-review sample (record 6); the first, a table row,
was not drawn.

Minor: 4 Sources rows list passages never cited in the body (`sw01` [3], [15], [16];
`sw10` [9]) — the prompt asks for cited passages only. No body citation is missing from
its Sources table.

**The checker's own reliability.** Its first pass over these answers flagged 10
body-vs-Sources disagreements; 8 were the checker's errors, found by reading every
instance and fixed before these counts. Seven came from case names whose first party
is generic ("Union Of India vs K.A. Najeeb", "U.O.I. Thr. Cbi vs Nirala Yadav", "State
Of U. P vs Deoman Upadhyaya"), so no name was matched at all; one was a graph-attack
passage correctly described by the authority it attacks (*Kazmi*). Two extraction
faults were fixed alongside: sentences split at initials and "Thr.", and claims rebuilt
with a different space character than the answer used, so they were not verbatim. The
counts above are after those fixes. A checker flagging five times as many errors as
exist would have been its own Finding 1.

**Prompt size after the cap** (Finding 2's promised measurement, `measure_prompt_tokens.ts`):

| query | passages | prompt tokens (o200k) | ≈ Groq's count |
|---|---|---|---|
| `sw10` | 12 | 4,736 | ≈ 6,900 |
| `sw04` | 12 | 4,706 | ≈ 6,900 |
| `sw02` | 8 | 3,193 | ≈ 5,400 |
| `sw03` | 8 | 3,197 | ≈ 5,400 |
| `sw05` | 0 | 955 | ≈ 3,200 |

12 passages is the ceiling the cap allows and lands under ~7,000, so per-passage text
was not capped. `sw04`, a near-miss before the fix, now sits level with `sw10`.

### Step 3 — does the cited passage support the sentence? 30 citations

**The sample.** `eval/claims_to_review.json`: 30 records drawn from the 50 resolving
citations with a seeded generator (mulberry32, seed 7), round-robin across queries —
**6 each from `sw01`, `sw02`, `sw03`, `sw04`, `sw10`**. Each record carries the claim
sentence verbatim (checked: every one is an exact substring of its answer and contains
its own marker), the case, tid, chunk id, locator, the label the passage carried in the
model's context, and the **full** stored text of the passage. Verdicts, one per record
with a stated reason: `eval/claim_verdicts.json`.

**Who judged.** The verdicts were assigned by an LLM reviewer (Claude) reading each
claim against the full stored passage — **not by a lawyer, and not by the author.**
Recommended before this number goes in the report: the author independently re-judges
10 of the 30 (say records 1, 4, 5, 6, 12, 16, 21, 23, 24, 27, which cover all three
verdicts and all five queries) and records the agreement rate. That single number is
what would let the report say part of the review is author-verified.

**Definitions, as applied.**

| verdict | meaning |
|---|---|
| SUPPORTS | the passage states what the claim says, correctly attributed |
| PARTIAL | the substance is in the passage, but the claim adds something the passage does not say, or misattributes whose voice it is in |
| WRONG | the claim's content is not in the cited passage, or contradicts it |

**Result.**

| verdict | n | of 30 | 95% interval (Wilson) |
|---|---|---|---|
| SUPPORTS | 17 | **57%** | 39–73% |
| PARTIAL | 9 | 30% | — |
| WRONG | 4 | **13%** | 5–30% |
| SUPPORTS + PARTIAL ("grounded in the cited passage") | 26 | **87%** | 70–95% |

The intervals are wide because n is 30, and they are if anything optimistic: six
citations from one answer are not independent draws. Combined with step 2: **0
fabricated citations out of 50, 0 locator contradictions out of 14.**

**Per query.**

| query | SUPPORTS | PARTIAL | WRONG | fully supported |
|---|---|---|---|---|
| `sw02` undertrial delay, Art. 21 | 5 | 0 | 1 | 5/6 |
| `sw03` economic offences | 4 | 2 | 0 | 4/6 |
| `sw10` default bail, timing | 4 | 1 | 1 | 4/6 |
| `sw04` default bail, s.167(2) | 3 | 2 | 1 | 3/6 |
| **`sw01` anticipatory bail, duration** | **1** | **4** | **1** | **1/6** |

**The `sw01` outlier.** `sw01` is the only answer generated before the §5.4 cap — from
16 passages rather than at most 12 — and it scores 1/6, against 3/6 to 5/6 for the four
answers generated under the cap. That is **consistent with the cap improving
faithfulness as well as prompt size**, and it is **n = 1**: one answer, confounded three
ways. `sw01` is also the only answer on anticipatory-bail duration, the one topic where
two Constitution Benches pull in different directions; it is the only answer that wrote
citations as `【N†locator】` (10 of its 13); and two of its five errors trace to a chunk supplied twice
under contradictory labels (below), which the cap does not prevent — `sw10` received a
duplicated chunk after the cap too (Finding 3). Treat it as a reason to test, not a
result.

### What the errors are

**What the model did not do.** It did not invent references: 0 of 50 citation numbers
fall outside the passages it was given. And it did not invent quotations. Of the 24
fragments it put in quotation marks across the sample (excluding record 23, below), 20
match the cited passage exactly, ignoring punctuation, and the other 4 are light
rewordings that do not change the sense ("retard and obstruct" for "retarding and
obstructing", "the right" for "this right", "once bail is granted" for "once the bail
is granted", "the charge-sheet is" for "the charge-sheets are"). One quote shows the
truncation reaching the model directly: record 28 quotes "does not survive aft[er]" —
the passage's word "after" is cut at exactly character 1,200, the last character the
model was shown, and the model completed it in brackets.

**What the model did do.** Thirteen of the thirty citations are PARTIAL or WRONG, and
they are not one kind of error. Classified from the reviewer's stated reasons:

| error type | records | n |
|---|---|---|
| **attribution — whose voice the passage is in** | 2 P, 3 P, **6 W**, 26 P | 4 |
| adds a proposition the passage does not contain | 1 P, 11 P, 12 P, 21 P | 4 |
| claim not in the passage at all | 23 W, 27 W | 2 |
| accurate words, wrong context or weight | 10 P, 30 P | 2 |
| contradicts the passage | 24 W | 1 |

So the central finding is two-sided. **Text is quoted faithfully and nothing is cited
that was not supplied — but the model's own paraphrase and synthesis are not held to
the passage.** Four claims add a proposition that is not there, and three of those four
add precisely the contested point of the question: `sw01` asks whether anticipatory bail
can be time-limited, and records 1, 11 and 21 insert "does not prescribe a fixed
duration", "within a prescribed timeframe" and "including time-limits" into passages
that say nothing of the kind. The additions are
not random; they lean toward the answer the argument needs.

**Attribution is the largest single class, and the most serious single error.** The
four attribution errors share one mechanism, and it is visible in the data: **in every
one, the model's attribution matches the label the passage carried in its context — and
the label was wrong.**

- Record 6 (WRONG) and record 26 (PARTIAL), `sw01`: chunk `123660783_c025` is counsel's
  submission in *Sushila Aggarwal* (it opens "6.2 It is further submitted by the learned
  Counsel…"). It was supplied **twice in the same prompt** — as `[1]` under `COURT'S
  REASONING` (via the supporting round) and as `[13]` under `SUBMISSION, SIDE NOT
  DETERMINED` (via the opposing round). The model cited `[1]` and treated counsel's
  argument as law: record 26 states it as "the normal rule"; record 6 goes further,
  presenting it as a **Constitution Bench holding in *Sibbia*** — the wrong case as well
  as the wrong voice — and states the law backwards, since Sibbia held the opposite.
  This is the most serious error in the sample, and it is **Finding 3 operating**: one
  passage, two contradictory labels, and the model followed the wrong one.
- Records 2 and 3 (PARTIAL), `sw04` / `sw10`: the inverse. Passages supplied under
  `SUBMISSION, SIDE NOT DETERMINED` contain the court's own reasoning — record 3's
  passage introduces its proposition with "It is now settled that", a holding — and the
  model, following the label, reported settled law as "a party contended".
- Record 16 (SUPPORTS), `sw01`, is the control: a passage that really is a submission,
  correctly labelled, which the model correctly reported as "the same case records a
  submission". The model can attribute; it attributes to whatever the label says.

That makes these four a **context-label defect, not a model incapacity**. The labels
come from which retrieval round a chunk arrived through — supporting takes any
`court_text` chunk, opposing takes chunks whose `section_primary` is `submissions` —
and `section_primary` agrees with the truth only ~57% of the time
(`eval/coverage_results.md`, 2026-11-01). The other nine errors are not explained by
labels and would survive a perfect labelling.

**The four WRONG records in full** (reasons from `claim_verdicts.json`):

| # | query | cited | why WRONG |
|---|---|---|---|
| 6 | `sw01` | *Sushila Aggarwal* `【1†para 7】` | Presents counsel's submission (para 6.2) as a Constitution Bench holding, attributed to *Sibbia* rather than *Sushila Aggarwal*. Sibbia held the opposite. Wrong voice and wrong case. |
| 23 | `sw10` | *Nirala Yadav* `[7]` (graph attack) | The passage is a plain recitation of *Kazmi*'s procedural history; nothing about reliance being "disagreed with" appears in it. The quoted phrase is from the context block's own header for graph-attack items ("treats *Kazmi* (disagreed with)"), restated as if the passage said it. |
| 24 | `sw02` | *Sushila Aggarwal* `[7]` | Claims conditions are "not limited by a fixed time-frame"; the passage expressly permits conditions "including fixed nature of relief, or its being tied to an event or time bound". Contradicts the passage. |
| 27 | `sw04` | *Rakesh Kumar Paul* `[12]` | Passage 12 is counsel's argument on the 60-day period and the Lokpal amendment; neither half of the claim is in it. The marker sits in a bundled list ("e.g., [9], [10], [11], [12]") attached to a sentence this passage does not support. |

Only record 6 is an attribution error. Record 23 is a second context-block effect — the
graph-attack header is system metadata, and the model cited it as passage content.

### Limits of this sample — read the numbers with these

- **30 citations from 5 answers, not 20.** A budget decision on Groq's free tier
  (batch 3 needed a second day of the 200k-token allowance). Query diversity is
  correspondingly limited.
- **All 30 are should_work.** No should_fail answer was generated, so the sample says
  nothing about how the model cites when the corpus has little to offer — the condition
  where over-claiming is most likely. The 2026-11-01 retrieval review had the opposite
  skew (18/30 should_fail); neither covers both.
- **Five legal areas, two of them default bail** (`sw04`, `sw10`). Absent: arrest and
  s.41A notice (`sw06`), special-statute default bail (`sw07`), cancellation (`sw08`),
  special-statute twin conditions (`sw09`).
- **`sw01` was generated before the cap**, from 16 passages; 6 of the 30 come from it.
- **The model saw at most 1,200 characters of each passage; the reviewer saw the full
  text.** Record 28 shows the cut reaching the model mid-word. A claim the reviewer found
  unsupported may rest on text the model was never shown; one marked SUPPORTS may rest
  on text the model could not see — the quotation check above found no case of the
  latter.
- **Judged by an LLM reviewer, not a lawyer**, with no second rater yet (see above).

**For the report, in one sentence** — of the build as measured, before the duplicate-
passage fix described below, and not of the current one: on 30 citations from five should_work answers,
judged by an LLM reviewer, 57% were fully supported by the cited passage and 87% were at
least grounded in it; none of 50 citations pointed outside the supplied passages and
quotations were faithful, but 13% were wrong — and the most serious error came from a
passage supplied to the model under a label that said the court was speaking when it
was counsel.

### Changed after the numbers were in

**Finding 1's fix, applied** (`server/src/lib/generate.ts`, `findInvalidCitations`): the
pattern is now `/[\[【](\d+)(?:†[^\]】]*)?[\]】]/g`, matching `[N]`, `【N】` and
`【N†locator】`. A measurement fix, not a generation change — the prompt and the
passages sent are untouched, so none of the numbers above is affected. On the stored
answers it now reads all 13 of `sw01`'s markers (was 0) and 12 of `sw03`'s (was 5);
the others are unchanged. Not covered: the multi-number form `[3, 5]`, which no answer in
this sample used. `tsc --noEmit` clean.

**Duplicate passages collapsed to one copy (`server/src/lib/counter.ts`,
`dedupeAcrossRounds`) — this one does change generation, and it is not re-measured.**

The defect is Finding 3, confirmed as the mechanism of the worst error in the review. A
chunk retrieved by both the supporting and the opposing round was sent to the model
once per round, labelled by its round — once as `COURT'S REASONING`, once as
`SUBMISSION, SIDE NOT DETERMINED` — and the model followed whichever copy it cited. The
fix, applied after gating and before numbering:

- **Duplicates are collapsed by chunk id across all rounds.** The earliest copy in round
  order keeps its place; later copies are dropped.
- **Where the copies disagree on speaker, neither label is kept.** The surviving copy is
  marked `speakerUncertain` and reaches the model as `SOURCE UNCERTAIN — retrieved both
  as court reasoning and as a party submission`. The supporting copy is deliberately not
  trusted by default: in record 6 it was the wrong one. A new prompt rule (12 in
  `generate.ts`; item 7 of `CounterEngine.md` §6) forbids attributing a holding to such a
  passage.
- **A graph attack whose paragraph lies inside a retrieved chunk** is treated as the same
  text: the chunk is kept once and takes over the attack's citation edge (`viaGraph`,
  `becauseOf`), so "your authority was doubted" survives — in the prompt and in the UI's
  existing graph note — without the passage being sent twice. No stored answer contains
  this case; it was verified on a synthetic one only (`server/src/scripts/dedupe_check.ts`).
- Cue-phrase checking of labels — reading "It is submitted…" or "It is now settled…" in
  the text — was deliberately not added; it stays future work.

Replayed over the six stored answers (`dedupe_check.ts`), it collapses **3 duplicate
pairs**: one in `sw01` (`123660783_c025`) and two in `sw10` (`1376808_c014`,
`123660783_c184`), all supporting/court-holding against opposing/argument, so all three
become `SOURCE UNCERTAIN`. None in `sw02`–`sw05`.

**Three reviewed records cited a duplicated chunk:**

| record | query | chunk | verdict | the copy it cited |
|---|---|---|---|---|
| 6 | `sw01` | `123660783_c025` | WRONG | `COURT'S REASONING` — wrong: the text is counsel's |
| 26 | `sw01` | `123660783_c025` | PARTIAL | `COURT'S REASONING` — wrong, same chunk |
| 8 | `sw10` | `1376808_c014` | SUPPORTS | `COURT'S REASONING` — right: reviewed as correctly attributed |

Record 8 is the cost of the fix, and it is stated here because it cuts the other way.
Its supporting copy was the correct one, and the model attributed it correctly. Under
the fix that passage is `SOURCE UNCERTAIN` too, and the model may no longer attribute a
holding to it. Of the three duplicated chunks the review reached, the supporting label
was wrong for one and right for one — which is exactly why neither copy can be trusted
by default, and why the fix chooses caution over a coin toss. Collapsing also frees
context slots: in `sw10` the two removed copies let a different opposing passage into
the 12, so the model would see a slightly different set.

**What this means for the numbers above.** The 17 / 9 / 4 result, and every Step 2 count,
were measured **before** this fix, on the build that sent duplicate passages under
contradictory labels. They describe that build, not the current one. The fix is **not
re-measured**: there is no budget for another run on the free tier. It targets records 6
and 26 directly and puts record 8's correct attribution at risk; what it does to the
other 27, and to answers not in the sample, is unknown until it is re-run.

Not changed: the web UI. The surviving copy keeps its original `speaker` badge on its card
("THE COURT" in all three cases), and the API's new `speakerUncertain` flag is not yet
rendered. A reader of the UI can still be misled the way the model was; rendering the
flag is the follow-up, not attempted here because it cannot be checked in a browser in
this session.

### Recommended, not implemented

Both of these change what the model is given or asked for, so both would change the
numbers above, and there is no budget to re-measure. Not applied: the reported numbers
describe the system as it ships.

1. **Correct the speaker labels in the context block — the direct fix for the four
   attribution errors** (records 2, 3, 6, 26). The context block already labels every
   passage `COURT'S REASONING` or `SUBMISSION`; the defect is that the label is wrong,
   because it is inferred from the retrieval round. The fix is to label from the
   passage's own speaker — at minimum, never supply one chunk twice (since done: see the
   duplicate-passage entry above, which covers records 6 and 26 but not 2 and 3, whose
   passages were supplied once, wrongly labelled), and never call a chunk the court's
   reasoning when its own `section_primary` says `submissions` (record 6's chunk) — and,
   on the evidence of the section-boost A/B, from a better speaker signal than
   `section_primary` alone. Adding labels would not help; making them true would.
2. **Enforce plain `[N]`** — 24 of 50 citations broke rule 11 despite the prompt naming
   the forbidden form. Either reject and regenerate, or normalise after generation; the
   second is cheaper and leaves the measured text unchanged.

Out of scope of both, and worth a separate line: the nine non-attribution errors — added
propositions, the graph-attack header cited as passage content (record 23), a
contradiction (record 24), a bundled marker (record 27) — would survive perfect labels.
A per-claim check against the cited passage, or not exposing the graph header as
citable text, is where those would be addressed.

### Still outstanding

- The author's 10-record spot-check and agreement rate.
- `sw06`–`sw09` and `sf01`–`sf10`, if the evaluation is reopened: about 150k tokens, one
  more day on the free tier. Running them before or after recommendation 1 decides what
  they measure.
