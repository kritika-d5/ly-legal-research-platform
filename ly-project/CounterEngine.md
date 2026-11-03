# CounterEngine.md — adversarial case preparation in BailResearch

**Status: designed, not built.** Written 2026-09-07.

Counter Engine takes a legal position and the side you are on, and returns the
arguments the other side will make, the authorities behind them, and — where the corpus
supports it — how those arguments have failed before.

---

## 0. Two documents, two repos — read this first

This feature spans both repos, and they are **separate checkouts**. Claude Code working
in one cannot see the other.

| Repo | Document | Owns |
| --- | --- | --- |
| `legal-rag-data` | `ARGUMENTS.md` | the `arguments` collection, `stance`, `outcome`, `authorities` — how those fields are *produced* |
| `ly-project` (this repo) | `CounterEngine.md` | the API, the retrieval orchestration, the UI — how those fields are *consumed* |

**So: a session working in this repo reads only this file.** §3 below restates the exact
shape of every field consumed, so this document is self-sufficient. `ARGUMENTS.md` is
cited for provenance, never as required reading.

If a field here disagrees with `ARGUMENTS.md`, `ARGUMENTS.md` wins and this file is
stale — fix it.

**Build order across the repos:** the data repo must complete `ARGUMENTS.md` Stages
B and C before Counter Engine reaches v2. It does **not** block v0 — see §11.

---

## 1. What it is

Input: a position, and which side you are on. Output, in two panels:

```
YOUR CASE            arguments on your side that have succeeded, with authorities
THE OTHER SIDE       each opposing argument, with your rebuttal nested inside it
```

**Symmetric by construction.** Flipping the side toggle runs the whole thing for the
prosecution with no code change, because `PetArg` and `RespArg` are both in the corpus.
Say this in the report — "counterargument generation" undersells it.

### Scope, stated in the UI

- Supreme Court bail jurisprudence only, 198 judgments, 1912–2022
- 43 of those are not Supreme Court and are persuasive only
- Research aid, not legal advice — the existing footer disclaimer covers this and must
  remain visible on this page

### The name

**Counter Engine.** Route `/counter`, API `POST /api/counter`, nav label
`Counter Engine`.

Recorded so it does not get relitigated: it is short enough for the header beside
"Citation explorer", it describes the mechanism rather than claiming intelligence, and
it carries no "AI" in the name — the differentiator here is the citation graph, not the
model.

---

## 2. Why this is NOT a sixth tab on the case page

`GRAPH_RETRIEVAL.md` already decided this, and the reasoning transfers exactly:

> Do not feed expanded cases into the case-scoped chat. `POST /api/cases/:tid/chat` is
> deliberately about one judgment. Its whole attribution model — every passage tagged
> with whether it is the court speaking, quoted statute, or an SCR headnote — assumes a
> single source document. … Cross-case question answering is a **separate mode** with its
> own prompt, its own citation format, and its own UI.

Counter Engine spans the corpus. Putting it on `CasePage` would break the guarantee that
"this judgment held X" is checkable against the document on screen — the guarantee that
makes the case chat trustworthy.

**Do not add it as a tab.** If a future session proposes it, this section is the answer.

---

## 3. The data contract

Everything Counter Engine consumes. Produced by `ARGUMENTS.md`; restated here so this
repo is self-sufficient.

### 3.1 `arguments` collection (new)

```ts
type ArgumentDoc = {
  _id: string;                  // "7148380_a_053"
  tid: number;
  para_ids: string[];

  text: string;
  token_count: number;

  role: 'PetArg' | 'RespArg';
  stance: 'pro_bail' | 'anti_bail' | 'unknown';
  stance_source: string;

  outcome: 'accepted' | 'rejected' | 'not_addressed' | 'unclear';
  outcome_evidence_para: string | null;
  outcome_confidence: 'high' | 'low';

  authorities: number[];        // tids cited inside this argument (from PARTY spans)
  authority_titles: string[];

  title: string;
  year: number;
  court_tier: 'SC' | 'HC' | 'OTHER';
  locator: string;              // "para 25" | "p. 418"

  embedding: number[] | null;   // 768d, BAAI/bge-base-en-v1.5, no prefix
  embedding_model: string | null;
};
```

### 3.2 Atlas indexes the data repo must create

`arguments_vector_index`:

```json
{"fields": [
  {"type": "vector", "path": "embedding", "numDimensions": 768, "similarity": "cosine"},
  {"type": "filter", "path": "stance"},
  {"type": "filter", "path": "outcome"},
  {"type": "filter", "path": "court_tier"},
  {"type": "filter", "path": "year"},
  {"type": "filter", "path": "tid"}
]}
```

**Note `tid` is declared.** `README.md` documents the cost of omitting it from
`chunks_vector_index`: case-scoped chat has to pull a case's chunks and cosine them in
memory because `$vectorSearch` cannot pre-filter by case. That workaround is fine at 428
chunks; do not create the same situation twice. Declare the filters now.

`arguments_text_index` — BM25 on `text`, for provision-number matching.

### 3.3 Existing collections used

- `chunks` — Round 1 supporting law, and restrictive statutes
  (`content_type: "quoted_statute"`)
- `edges` — `polarity ∈ {pos, neg, neutral, mixed}` for the graph rounds
- `paragraphs` — to fetch the passage that did the disagreeing, and for the v0 fallback
- `nodes` — titles, `court_tier`, `applicant_seeking_bail`

---

## 4. API

### 4.1 Endpoint

```
POST /api/counter
```

Streamed over **SSE**, matching the existing pattern in `routes/chat.ts`. Retrieval runs
five rounds; a spinner for eight seconds reads as a hang, whereas rounds appearing one by
one read as thoroughness. The extra code is one `res.write` helper you already have.

### 4.2 Request

```ts
type CounterRequest = {
  position: string;                        // free text, 20–2000 chars
  side: 'pro_bail' | 'anti_bail';          // which side the USER is on
  offenceCategory?: OffenceCategory;       // optional; inferred when absent
};

type OffenceCategory =
  | 'ordinary' | 'economic' | 'ndps' | 'pmla' | 'uapa' | 'other_special';
```

**Decision: `offenceCategory` is inferred, then shown back as an editable chip.**

Pure inference is smooth but silently wrong sometimes, and being wrong here means missing
the s.37 NDPS / s.45 PMLA / s.43D(5) UAPA rigours entirely — a serious miss, because
those provisions are the whole anti-bail case in such matters. A dropdown the user must
fill is friction on every query for a field that is usually obvious.

So: infer it in `classify()`, render it as a chip under the input
(`Detected: NDPS ✎`), and re-run on edit. Wrong inferences become visible and one click
to fix, instead of invisible and wrong.

### 4.3 SSE events

```ts
type CounterEvent =
  | { type: 'classified';  data: Classification }
  | { type: 'round';       data: RoundResult }        // emitted 1..n as each lands
  | { type: 'answer';      data: { markdown: string } }
  | { type: 'done';        data: { ms: number } }
  | { type: 'error';       data: { message: string } };

type Classification = {
  inScope: boolean;
  topics: string[];                  // ['delay_in_trial', 'article_21', 'section_436A']
  offenceCategory: OffenceCategory;
  offenceInferred: boolean;          // drives the "Detected:" chip
};

type RoundResult = {
  round: 'supporting' | 'opposing' | 'statutes';
  items: CounterItem[];
  empty: boolean;                    // true = nothing found; NOT an error
};
```

### 4.4 The item shape

One shape for every card the UI renders.

```ts
type CounterItem = {
  id: string;
  kind: 'court_holding' | 'argument' | 'statute';

  text: string;

  // badges — every one of these MUST reach the screen (see §8)
  speaker: 'THE COURT' | 'COUNSEL' | 'STATUTE' | 'HEADNOTE';
  stance?: 'pro_bail' | 'anti_bail';
  outcome?: 'accepted' | 'rejected' | 'not_addressed' | 'unclear';

  // provenance — every claim is checkable
  tid: number;
  caseTitle: string;
  year: number;
  courtTier: 'SC' | 'HC' | 'OTHER';
  locator: string;
  paraIds: string[];

  authorities?: { tid: number; title: string }[];

  // Round 3, nested inside an opposing argument
  responses?: CounterResponse[];

  // why this surfaced, when it was not a direct text match
  viaGraph?: boolean;
  becauseOf?: { tid: number; title: string; polarity: string }[];
};

type CounterResponse = {
  kind: 'argument_failed' | 'authority_doubted';
  text: string;
  tid: number;
  caseTitle: string;
  locator: string;
  polarity?: 'neg' | 'mixed';
};
```

`viaGraph` / `becauseOf` follow the rule already set in `GRAPH_RETRIEVAL.md`: *"an extra
result with no explanation reads as a bug, and in a legal tool an unexplained result is
worse than a missing one."*

---

## 5. Server implementation

### 5.1 Files

```
server/src/routes/counter.ts     the SSE route
server/src/lib/counter.ts        the five rounds + assembly
server/src/lib/classify.ts       the intent/offence LLM call
```

Register in `index.ts` alongside the others:

```ts
import { counterRouter } from './routes/counter.js';
app.use('/api', counterRouter);
```

### 5.2 Reuse, do not reimplement

Three things already exist and must not be re-written:

**`lib/embed.ts`** — verified at cosine 1.000000 against a real corpus chunk, with `cls`
pooling and the asymmetric query prefix. Call it. An embedding produced any other way is
a vector in a different space and silently returns noise. This is `README.md` rule 1.

**`lib/search.ts`** — RRF at k=60 is implemented. Round 1 wraps `searchCases()` rather
than duplicating the fusion.

**`lib/llm.ts`** — extend the existing `ATTRIBUTION` constant (§6). Do not write a
parallel prompt preamble that can drift from it.

### 5.3 The five rounds

```ts
// lib/counter.ts
export async function* runCounter(req: CounterRequest) {
  const cls = await classify(req.position);          // R0
  if (!cls.inScope) { yield outOfScope(cls); return; }
  yield { type: 'classified', data: cls };

  const qvec = await embedQuery(req.position);       // lib/embed.ts, WITH prefix
  const opposing = req.side === 'pro_bail' ? 'anti_bail' : 'pro_bail';

  const supporting = await roundSupporting(qvec, req.side, cls);
  yield { type: 'round', data: supporting };

  const theirs = await roundOpposing(qvec, opposing);
  const attacked = await roundAttacks(supporting.items);     // graph
  const rebutted = await roundRebuttals(theirs.items);       // graph + vector
  yield { type: 'round', data: mergeOpposing(theirs, attacked, rebutted) };

  const statutes = await roundStatutes(cls.offenceCategory);
  yield { type: 'round', data: statutes };

  const top = await rerank(req.position, allItems);
  for await (const tok of generate(req, top)) yield { type: 'answer', data: tok };
}
```

**R1 — supporting law.** `searchCases()` from `lib/search.ts`, filters
`content_type: 'court_text'`, `section_primary: {$in: ['reasoning','order']}`, plus a
vector query on `arguments` with `{ stance: req.side, outcome: 'accepted' }`.

**R2 — their arguments.** Vector on `arguments`, `{ stance: opposing }`, **no outcome
filter** — you must anticipate everything they might run.

**R3 — attacks on your authorities.** Pure graph, no embedding:

```ts
const myTids = [...new Set(supporting.items.map(i => i.tid))];
const attacks = await edges.find({
  dst: { $in: myTids },
  polarity: { $in: ['neg', 'mixed'] },
}).toArray();

for (const a of attacks) {
  const para = await paragraphs.findOne({
    tid: a.src,
    citations: { $elemMatch: { docid: a.dst, sentiment: 'Neg' } },
  });
  // -> CounterResponse { kind: 'authority_doubted', ... }
}
```

This is the citation-graph payoff and the thing to demonstrate in a viva. Plain RAG
cannot produce *"you are relying on X; X was distinguished in Y at para N"*.

**R4 — rebuttals.** For each opposing argument, a second embedding pass at query time
(embed the argument, not the user's position; at most ~15 of them) against
`{ stance: opposing, outcome: 'rejected' }`. Plus `edges` attacks on that argument's
`authorities`.

**R5 — restrictive statutes.** Only when `offenceCategory !== 'ordinary'`. BM25 on
`chunks` filtered to `content_type: 'quoted_statute'`.

### 5.4 Rerank

Five sources, five incomparable score scales, ~60 candidates.

Cross-encoder is the right answer, but this is a Node service and
`cross-encoder/ms-marco-MiniLM-L-6-v2` would mean a second ONNX model and another
~90 MB download on top of the BGE weights.

**Ship v1 without it:** normalise each round's scores to 0–1, take a fixed quota per
round (4 supporting / 5 opposing / 2 statute / rest by score), cap at 12. Quotas also
guarantee one round cannot crowd out the others, which a global rerank does not.

Add the cross-encoder later only if §12 evaluation shows quota selection is the
bottleneck.

### 5.5 Failure behaviour

An empty round is `empty: true`, **not** an error. Rounds are independent — if the graph
round throws, the others still stream. Log and continue; never fail the whole request
because one round found nothing.

---

## 6. Prompt contract

Extend `ATTRIBUTION` in `lib/llm.ts`. The existing content_type rules stay; these are
added:

1. Passages are labelled. **`COUNSEL` is not the court.** Never write "the Supreme Court
   held" when the source is an argument.
2. Never present `outcome: rejected` material as support. It appears only as *"this was
   argued and rejected in …"*.
3. Cite only the supplied passages, each by its `locator`. Any case name not in the
   supplied set is a failure.
4. `HC` and pre-1950 sources are persuasive, not binding — say so when relying on them.
5. Decompose the user's position into premises and target the **weakest**. Attacking the
   weak premise is what adversarial reasoning actually does.
6. If a round is empty, say so for that round. **Do not fill the gap.**
7. A passage retrieved by two rounds under different speakers is sent once, marked
   **`SOURCE UNCERTAIN`**. **Never attribute a holding to it** — say what it states and
   that its source is uncertain. (`dedupeAcrossRounds` in `lib/counter.ts`; motivated by
   record 6 of `eval/claim_verdicts.json`.)

### Context block format

```
[SUPPORTING LAW — Satender Kumar Antil v CBI (2022), Supreme Court, para 25, court's reasoning]
"..."

[OPPOSING ARGUMENT — counsel for the State in X v Y (2019) — court's response: REJECTED]
"..."

[REBUTTAL — the same argument was rejected in Z (2020), para 14]
"..."

[YOUR AUTHORITY WAS DOUBTED — W (2021), para 9, distinguished Antil]
"..."

[STATUTE — Section 37, NDPS Act — quoted text, not a holding]
"..."

[SOURCE UNCERTAIN — retrieved both as court reasoning and as a party submission — V (2020), para 7]
"..."
```

---

## 7. Frontend

### 7.1 Files

```
web/src/pages/CounterPage.tsx
web/src/components/counter/PositionForm.tsx
web/src/components/counter/RoundProgress.tsx
web/src/components/counter/ArgumentCard.tsx        // with nested responses
web/src/components/counter/ResponseBlock.tsx
web/src/components/counter/SourceDrawer.tsx
web/src/components/counter/EmptyState.tsx
```

Extend `Badges.tsx` and `Icon.tsx` — do not fork them.

### 7.2 Routing and nav

```tsx
// main.tsx
<Route path="/counter" element={<CounterPage />} />
```

`App.tsx` header, beside Citation explorer:

```tsx
<Link to="/counter" className="flex items-center gap-1.5 text-stone-600
      transition-colors hover:text-maroon-700">
  <Icon name="scales" size={14} />
  Counter Engine
</Link>
```

### 7.3 Secondary entry points

**On `CasePage`** — the counter-authority panel from `GRAPH_RETRIEVAL.md` §2, which
until now had nowhere to lead:

```
┌─ Counter-authority ───────────────────────┐
│ 3 later cases did not simply follow this. │
│   Sushila Aggarwal (2020)      mixed      │
│   ...                                      │
│   Build a case around this  →             │
└───────────────────────────────────────────┘
```

The link navigates to `/counter?authority=<tid>`, which pre-fills the position with that
case as the user's authority.

**On `SearchPage`** — one quiet line below the results, carrying `q` across:
*"Testing a position? Open it in Counter Engine →"*

---

## 8. UI

### 8.1 Input

One screen. No wizard.

```
┌──────────────────────────────────────────────────────────┐
│  Counter Engine                                          │
│  Test a position against the corpus.                     │
│                                                          │
│  ┌────────────────────────────────────────────────────┐ │
│  │ Accused in custody 2 years, trial has not          │ │
│  │ commenced, offence punishable up to 7 years.       │ │
│  │                                                    │ │
│  └────────────────────────────────────────────────────┘ │
│                                                          │
│  I am:   (•) Seeking bail      ( ) Opposing bail         │
│                                                          │
│                                     [ Run Counter → ]    │
└──────────────────────────────────────────────────────────┘
```

The side toggle is the whole reason the feature is symmetric — a prominent control, never
a settings item. After classification, the offence chip appears beneath it:

```
  Detected: NDPS  ✎
```

### 8.2 Results — nested, not three parallel columns

A rebuttal is meaningless three screens from the thing it rebuts.

```
YOUR CASE  ────────────────────────────────────────────────

  ┌──────────────────────────────────────────────────────┐
  │ ⚖ THE COURT                                    SC    │
  │ "Bail is the rule and jail is the exception…"        │
  │ Satender Kumar Antil (2022), para 25   view source ↗ │
  └──────────────────────────────────────────────────────┘


THE OTHER SIDE  ───────────────────────────────────────────

  ┌──────────────────────────────────────────────────────┐
  │ 🗣 COUNSEL FOR THE STATE        ✕ REJECTED      SC    │
  │                                                      │
  │ "Economic offences constitute a class apart and      │
  │  demand a stricter approach to bail…"                │
  │                                                      │
  │ relied on:  Y.S. Jagan Mohan Reddy · P. Chidambaram  │
  │ ────────────────────────────────────────────────────│
  │ ▾ Your response                                      │
  │   ↳ This framing was rejected in P. Chidambaram —    │
  │     gravity is a factor, not a bar.    para 23 ↗    │
  │   ↳ Their authority was distinguished in …  para 9 ↗│
  │                                                      │
  │ Sanjay Chandra (2012), para 39         view source ↗ │
  └──────────────────────────────────────────────────────┘
```

### 8.3 Badges

Every card carries all three. This is `README.md` rule 2 at its most load-bearing — an
argument rendered without its speaker and outcome is a correctness bug, not a styling
choice.

| Badge | Values | Tailwind |
| --- | --- | --- |
| Speaker | `THE COURT` · `COUNSEL` · `STATUTE` · `HEADNOTE` | `bg-stone-100 text-stone-600` |
| Outcome | `✓ ACCEPTED` | `bg-stone-100 text-stone-500` (quiet) |
| | `✕ REJECTED` | `bg-amber-50 text-amber-800 border-amber-200` |
| | `— NOT ADDRESSED` | `bg-stone-50 text-stone-400` |
| Court | `SC` | `text-stone-500` |
| | `HC` · `1923` | `bg-rose-50 text-rose-700` |

**Colour discipline follows the edge-colouring reasoning already in `README.md`:** 274 of
336 edges are `pos`, so colouring approval made everything uniformly green and nothing
stood out. Same here — most arguments are unremarkable. **Accepted is quiet; rejected and
doubted get the colour**, because those are the informative ones.

### 8.4 Source drawer

Clicking any locator slides a right-hand drawer: the passage in full, its labels, and a
link into `/case/:tid`.

**A drawer, never a modal.** The user is checking a source *against* the argument on
screen; a modal hides the thing they are checking.

### 8.5 Loading

Stream the rounds. Progress that names what it is doing reads as thoroughness:

```
✓ Classified — delay in trial, Article 21, s.436A
✓ 6 supporting authorities
✓ 4 opposing arguments
⋯ Checking whether those arguments have failed before…
```

### 8.6 Empty state

Given 198 judgments this will happen often, so design it deliberately.

```
No strong counterargument found for this position.

The corpus covers Supreme Court bail jurisprudence — 198 judgments,
1912–2022. Your position may fall outside it, or the corpus may simply
contain no opposing argument on this point.

This is not an indication that your position is unassailable.
```

That last line is not optional. Without it, silence reads as endorsement, which is the
most dangerous thing a legal tool can imply.

### 8.7 Out of scope

```
Counter Engine covers bail only.

This corpus is 198 Supreme Court bail judgments. It holds nothing on
property, contract, tax or matrimonial law, and answering from general
knowledge would not be grounded in any source.
```

---

## 9. What NOT to build

**No confidence percentages.** "87% likely to succeed" is indefensible on 198 judgments
and invites exactly the over-reliance the footer disclaims.

**No auto-drafting.** Counter Engine surfaces arguments and sources. Producing a
paragraph to file in court is a different product, and this corpus cannot support it.

**No graph visualisation on this page.** `/explore` and `CasePage` already do that well.
Here the graph works invisibly in R3/R4; a picture would be decoration competing with
dense text.

**No "similar cases" sidebar.** Search already exists. Do not rebuild it here.

---

## 10. Known limits, and where each belongs on screen

| Limit | Surface |
| --- | --- |
| 198 judgments, bail only | page subheading + empty state |
| `section_primary` measured at ~57% agreement | neither a filter nor a ranking signal: a ranking boost was measured and reverted, as it promotes mislabels as readily as correct labels (`eval/coverage_results.md`, 2026-11-01 section) — no UI |
| Polarity never validated by a lawyer; `pos` means "relied on", not "followed" | tooltip on any polarity badge; **do not strengthen the wording** |
| Only 33 of 336 edges are `neg`/`mixed` | next to every counter-authority badge: *absence of a warning is not evidence a case is good law* |
| 43 nodes are not Supreme Court | the `HC` badge, already specified |
| 418 chunks truncated at embedding time | no UI; note in the report |

---

## 11. Phasing — the UI is not blocked on the data repo

| Version | Needs from `legal-rag-data` | Delivers |
| --- | --- | --- |
| **v0** | nothing | opposing submissions, unlabelled |
| **v1** | Stage B (`stance`) | correctly-sided arguments |
| **v2** | Stage C (`outcome`) | Round 3 rebuttals — the real feature |

### v0 fallback query

`chunks` has no `kanoon_structure` (it lives on `paragraphs`), so v0 joins through
`para_ids`:

```ts
const submissions = await chunks.aggregate([
  { $vectorSearch: {
      index: 'chunks_vector_index', path: 'embedding', queryVector: qvec,
      numCandidates: 200, limit: 30,
      filter: { section_primary: 'submissions', court_tier: 'SC' },
  }},
  { $lookup: {
      from: 'paragraphs', localField: 'para_ids', foreignField: '_id', as: 'paras',
  }},
  { $addFields: { roles: '$paras.kanoon_structure' } },
]).toArray();
```

v0 cannot tell pro-bail from anti-bail reliably and **must** label its output
*"submissions on this issue — side not yet determined"*. Do not let a v0 build ship
claiming to know the stance.

`CounterPage`, `ArgumentCard`, `SourceDrawer` and every state in §8 can be built and
demoed against v0 while the data repo labels outcomes.

---

## 12. Evaluation

Enough to be a result rather than an assertion.

1. **Coverage.** 20 realistic bail questions across regular / anticipatory / default bail
   / economic offences / special statutes. For each, record whether each round returned
   anything. **Run this at v0.** If the opposing round is empty for most queries, the
   corpus is too thin and that must be known before v2 is built.
2. **Citation faithfulness.** Automatable half: every `locator` in the answer exists in
   the retrieved set. Hand-checked half: does the cited paragraph actually say it, on
   ~30 citations. This is the number an examiner will probe.
3. **Ablation.** Run 1 and 2 with the graph rounds (R3, R4) disabled. If citation-aware
   retrieval does not measurably improve the output, that is still a finding — and far
   better found by you.

---

## 13. Build order

```
1. web:    CounterPage + PositionForm + ArgumentCard against a hardcoded fixture
2. server: routes/counter.ts + lib/counter.ts, v0 rounds R1/R2/R5, no SSE (plain JSON)
3. web:    wire it up, all states from §8 — empty and out-of-scope included
4. server: SSE + RoundProgress
5. eval:   the 20-question coverage probe          ← gate before going further
6. server: R3 graph attacks (needs no data-repo work — edges.polarity is already there)
7. --- wait on ARGUMENTS.md Stages B and C ---
8. server: stance filtering (v1), then R4 rebuttals (v2)
9. eval:   faithfulness + ablation
```

Step 6 is worth noticing: **the graph attack round needs nothing from the data repo.**
`edges.polarity` is already populated. R3 can ship at v0 and is the most distinctive
thing in the feature.
