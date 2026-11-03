/**
 * Counter Engine v0 — CounterEngine.md build order steps 2 and 6.
 *
 * NUMBERING NOTE for the next reader: there are 5 rounds in CounterEngine.md's
 * internal numbering (R1-R5, R4 skipped here) but only 3 user-facing panels.
 * R3 (graph attacks) is not its own panel — it folds into the 'opposing'
 * RoundResult per §5.3's `mergeOpposing`, because "an attack on an authority
 * you're relying on" is exactly the kind of thing the other side would raise.
 * So: R1 -> 'supporting' panel. R2 + R3 -> 'opposing' panel (R3 items carry
 * `viaGraph: true` to stay distinguishable). R5 -> 'statutes' panel. Do not
 * go looking for a fourth or fifth RoundResult — there are only three.
 *
 * Four rounds are implemented, R4 is not:
 *
 *   R1 supporting  — wraps searchCases() (lib/search.ts). No new retrieval.
 *   R2 opposing    — the §11 v0 fallback: vector search on `chunks` filtered
 *                    to section_primary "submissions", joined to `paragraphs`
 *                    for kanoon_structure. The `arguments` collection this
 *                    would eventually query does not exist (ARGUMENTS.md
 *                    Stages B/C unbuilt), so these items are UNLABELLED —
 *                    `stanceUndetermined: true`, never a fabricated stance.
 *   R3 attacks     — pure graph, no embedding: edges with polarity neg/mixed
 *                    pointing at an R1 authority, plus the paragraph that did
 *                    the disagreeing. Folded into 'opposing' (see above), each
 *                    flagged `viaGraph: true` with `becauseOf` set — an
 *                    unexplained graph result is worse than no result
 *                    (GRAPH_RETRIEVAL.md).
 *   R5 statutes    — a PINNED map of hand-verified chunk ids (STATUTE_CHUNK
 *                    below), only when offenceCategory !== 'ordinary'. Not a
 *                    search of any kind, on purpose: an earlier BM25 version
 *                    of this round returned UAPA s.43D(5) text for an NDPS
 *                    query, because both statutes' twin-condition clauses
 *                    share almost all their vocabulary ("reasonable grounds
 *                    for believing... not guilty... not likely to commit").
 *                    Verified directly against the corpus (2026-09-07): NDPS
 *                    s.37 and UAPA s.43D(5) are both genuinely present and
 *                    now pinned; PMLA s.45 and Companies Act s.212(6) are
 *                    NOT present anywhere in these 198 judgments as bare
 *                    quoted text (only as court paraphrase of what counsel
 *                    argued, which is not the same thing) — those categories
 *                    return an empty round rather than the wrong Act's text.
 *                    Returning nothing is recoverable; returning the wrong
 *                    provision, presented under a STATUTE badge, is not.
 *
 * R4 (rebuttals) is explicitly out of scope for this build: it needs
 * `outcome` labels ARGUMENTS.md Stage C has not produced yet.
 *
 * Plain JSON response, not SSE — streaming is a later step (build order 4).
 */
import { chunks, edges, nodes, paragraphs, VECTOR_INDEX } from '../config.js';
import { classify } from './classify.js';
import { embedQuery } from './embed.js';
import { generateAnswer } from './generate.js';
import { allIrrelevant } from './relevance.js';
import { deriveTier, searchCases } from './search.js';
import type {
  CounterItem, CounterRequest, CounterResponseBody, OffenceCategory, RoundResult,
} from '../types.js';

const SUPPORTING_LIMIT = 8;
const OPPOSING_SUBMISSIONS_LIMIT = 8;

/** R1 — supporting law. Flattens searchCases()'s case-level results down to
 *  passage-level cards (one per case, its best-scoring passage), because that
 *  is the unit the UI renders (CounterEngine.md §8.2). RRF itself is untouched
 *  — this only reshapes what searchCases() already returns.
 *
 *  NOT reranked. A cross-encoder rerank (Xenova/ms-marco-MiniLM-L-6-v2) was
 *  built and measured (eval/coverage_results.md, "Cross-encoder reranker"):
 *  hit@1 regressed 5/10 -> 1/10. Diagnosed cause: the model rewards lexical
 *  overlap with the query's own wording over genuine topical relevance on
 *  these long, paragraph-style legal fact patterns -- a wrong-tool result,
 *  not a tuning one, per that write-up. Do not re-add a reranker here
 *  without a different model or a fundamentally different query shape; see
 *  the report for what was already ruled out. */
async function roundSupporting(position: string): Promise<RoundResult> {
  const cases = await searchCases(position, {
    contentTypes: ['court_text'],
    limit: SUPPORTING_LIMIT,
  });

  const items: CounterItem[] = cases
    .filter((c) => c.passages.length > 0)
    .map((c) => {
      const p = c.passages[0];
      return {
        id: p.id,
        kind: 'court_holding',
        text: p.text,
        speaker: 'THE COURT',
        tid: c.tid,
        caseTitle: c.title,
        year: c.year,
        courtTier: c.courtTier,
        locator: p.locator,
        // Passage (lib/search.ts) does not carry the source paragraph ids,
        // only the chunk id — an acceptable v0 stand-in since the chunk id
        // and locator together are still enough to verify the claim.
        paraIds: [p.id],
      };
    });

  return { round: 'supporting', items, empty: items.length === 0 };
}

/** §11 v0 fallback query, run verbatim, plus the paragraphs $lookup for
 *  `kanoon_structure` that `chunks` alone cannot answer. */
async function roundOpposingSubmissions(queryVector: number[]): Promise<CounterItem[]> {
  const hits = await chunks.aggregate([
    {
      $vectorSearch: {
        index: VECTOR_INDEX,
        path: 'embedding',
        queryVector,
        numCandidates: 200,
        limit: 30,
        filter: { section_primary: 'submissions', court_tier: 'SC' },
      },
    },
    {
      $lookup: {
        from: 'paragraphs', localField: 'para_ids', foreignField: '_id', as: 'paras',
      },
    },
    { $addFields: { roles: '$paras.kanoon_structure' } },
    {
      $project: {
        _id: 1, tid: 1, text: 1, locator: 1, para_ids: 1,
        title: 1, year: 1, court_tier: 1, roles: 1,
      },
    },
    { $limit: OPPOSING_SUBMISSIONS_LIMIT },
  ]).toArray();

  return hits.map((c: any) => ({
    id: c._id,
    kind: 'argument',
    text: c.text,
    speaker: 'COUNSEL',
    // §11: v0 cannot tell pro-bail from anti-bail reliably. Never claim a
    // stance from `roles` (PetArg/RespArg) alone — that mapping needs
    // ARGUMENTS.md Stage B's applicant_seeking_bail, which does not exist.
    stanceUndetermined: true,
    tid: c.tid,
    caseTitle: c.title,
    year: c.year,
    courtTier: c.court_tier,
    locator: c.locator ?? null,
    paraIds: c.para_ids ?? [],
  }));
}

/** R3 — attacks on MY (round-1) authorities. Pure graph traversal, no
 *  embedding. CounterEngine.md: "the most distinctive thing in the feature." */
async function roundAttacks(supportingItems: CounterItem[]): Promise<CounterItem[]> {
  const myTids = [...new Set(supportingItems.map((i) => i.tid))];
  if (!myTids.length) return [];

  const attacks = await edges
    .find({ dst: { $in: myTids }, polarity: { $in: ['neg', 'mixed'] } })
    .toArray();
  if (!attacks.length) return [];

  const srcTids = [...new Set(attacks.map((a) => a.src))];
  const [srcNodes, myNodes] = await Promise.all([
    nodes.find({ _id: { $in: srcTids } }).project({ title: 1, publishdate: 1, docsource: 1 }).toArray(),
    nodes.find({ _id: { $in: myTids } }).project({ title: 1 }).toArray(),
  ]);
  const nodeById = new Map(srcNodes.map((n: any) => [n._id, n]));
  const titleById = new Map(myNodes.map((n: any) => [n._id, n.title as string]));

  const items: CounterItem[] = [];
  for (const a of attacks) {
    // The edge says neg/mixed in aggregate; find the actual paragraph that
    // did the disagreeing so the claim is checkable, not asserted from the
    // edge alone.
    const para = await paragraphs.findOne({
      tid: a.src,
      citations: { $elemMatch: { docid: a.dst, sentiment: 'Neg' } },
    });
    if (!para) continue; // no single locatable span — skip rather than assert without one

    const n: any = nodeById.get(a.src) ?? {};
    items.push({
      id: `attack_${a.src}_${a.dst}`,
      kind: 'court_holding',
      text: para.text,
      speaker: 'THE COURT',
      tid: a.src,
      caseTitle: n.title ?? String(a.src),
      year: Number(String(n.publishdate ?? '').slice(0, 4)) || 0,
      courtTier: deriveTier(n.docsource),
      locator: para.locator,
      paraIds: [para._id],
      viaGraph: true,
      becauseOf: [{
        tid: a.dst,
        title: titleById.get(a.dst) ?? String(a.dst),
        polarity: a.polarity as 'neg' | 'mixed',
      }],
    });
  }
  return items;
}

/**
 * R5 — restrictive statutes. PINNED chunk ids, not a search.
 *
 * Hand-verified against the live corpus on 2026-09-07 (see the module
 * docstring for why a search was abandoned). Each id was confirmed by
 * reading the full chunk text and, where available, the court's own next
 * paragraph explicitly naming the Act and section:
 *
 *   ndps  -- 26003907_c001 (Satpal Singh v State of Punjab, 2018), the
 *            complete NDPS s.37(1)(b) twin-condition clause plus s.37(2).
 *            The very next chunk in that judgment (26003907_c002) opens
 *            "Under Section 37 of the NDPS Act..." -- unambiguous.
 *   uapa  -- 117627977_c032 (NIA v Zahoor Ahmad Shah Watali, 2019), s.43D(5)
 *            in full: "no person accused... shall, if in custody, be
 *            released on bail... unless the Public Prosecutor has been
 *            given an opportunity of being heard...".
 *
 * NOT pinned, and deliberately empty rather than guessed:
 *
 *   pmla  -- searched the whole corpus (every chunk containing "Section 45"
 *            or "money laundering") and found no chunk that quotes the bare
 *            provision. tid 3764 (Union of India v Hassan Ali Khan)
 *            discusses s.45 at length but only as the court paraphrasing
 *            what the ASG argued ("the learned ASG also referred to the
 *            provisions of Section 45...") -- correctly content_type
 *            court_text, and not the same thing as the provision's actual
 *            words. Presenting that paraphrase under a STATUTE badge would
 *            misattribute it.
 *   economic / other_special -- no Companies Act s.212(6) text, or any
 *            single canonical provision, found anywhere in the corpus.
 *
 * Add an id here only after doing the same verification -- read the full
 * chunk, and ideally find corroborating text nearby that names the Act and
 * section number in so many words. A wrong id here is worse than a missing
 * one: it hands the user a real quotation under a STATUTE badge that is
 * quietly the wrong law.
 */
const STATUTE_CHUNK: Partial<Record<OffenceCategory, string>> = {
  ndps: '26003907_c001',
  uapa: '117627977_c032',
};

async function roundStatutes(offenceCategory: OffenceCategory): Promise<RoundResult> {
  const chunkId = STATUTE_CHUNK[offenceCategory];
  if (offenceCategory === 'ordinary' || !chunkId) {
    return { round: 'statutes', items: [], empty: true };
  }

  const c = await chunks.findOne(
    { _id: chunkId },
    { projection: { _id: 1, tid: 1, text: 1, locator: 1, para_ids: 1, title: 1, year: 1, court_tier: 1 } },
  );
  if (!c) {
    // The pinned id no longer resolves (corpus rebuilt?) -- empty, not a crash.
    console.error(`[counter] pinned statute chunk missing: ${chunkId} (${offenceCategory})`);
    return { round: 'statutes', items: [], empty: true };
  }

  const item: CounterItem = {
    id: c._id,
    kind: 'statute',
    text: c.text,
    speaker: 'STATUTE',
    tid: c.tid,
    caseTitle: c.title,
    year: c.year,
    courtTier: c.court_tier,
    locator: c.locator ?? null,
    paraIds: c.para_ids ?? [],
  };
  return { round: 'statutes', items: [item], empty: false };
}

export async function runCounter(req: CounterRequest): Promise<CounterResponseBody> {
  const t0 = Date.now();
  const cls = await classify(req.position, req.offenceCategory);

  if (!cls.inScope) {
    return {
      classification: cls,
      rounds: [
        { round: 'supporting', items: [], empty: true },
        { round: 'opposing', items: [], empty: true },
        { round: 'statutes', items: [], empty: true },
      ],
      answer: '',
      summary: null,
      sourceIds: [],
      generationFailed: false,
      invalidCitations: [],
      tookMs: Date.now() - t0,
    };
  }

  const supporting = await roundSupporting(req.position);

  const [queryVector, statutes] = await Promise.all([
    embedQuery(req.position), // lib/embed.ts — WITH the query prefix, never any other way
    roundStatutes(cls.offenceCategory),
  ]);

  const [submissionItems, attackItems] = await Promise.all([
    roundOpposingSubmissions(queryVector),
    roundAttacks(supporting.items),
  ]);
  // Graph attacks first: they are the most distinctive result and the reason
  // this is citation-aware retrieval rather than plain search.
  const opposingItems = [...attackItems, ...submissionItems];
  const opposing: RoundResult = {
    round: 'opposing',
    items: opposingItems,
    empty: opposingItems.length === 0,
  };

  // Content relevance gate (eval/coverage_results.md) — replaces a
  // similarity-score threshold, which was measured NOT to separate "real
  // answer" from "nearest available passage" on this corpus. Statutes is
  // deliberately excluded: it is a single hand-verified pinned lookup per
  // offenceCategory (roundStatutes above), not a similarity search, so it
  // carries none of the nearest-neighbour risk this gate exists for.
  const [gatedSupporting, gatedOpposing] = await Promise.all([
    gateRound(req.position, supporting),
    gateRound(req.position, opposing),
  ]);

  const { rounds: finalRounds } = dedupeAcrossRounds([gatedSupporting, gatedOpposing, statutes]);

  // Stage F (CounterEngine.md §6/§8.2): synthesise the retrieved passages
  // into an actual answer. Runs last, on whatever the gate left standing --
  // an empty round here is not an error, it is honest input ("say so for
  // that round, do not fill the gap").
  const { markdown, summary, sourceIds, generationFailed, invalidCitations } =
    await generateAnswer(req, cls, finalRounds);

  return {
    classification: cls,
    rounds: finalRounds,
    answer: markdown,
    summary,
    sourceIds,
    generationFailed,
    invalidCitations,
    tookMs: Date.now() - t0,
  };
}

export interface CollapsedPassage {
  id: string;
  /** each copy as round/kind, e.g. "supporting/court_holding", "opposing/graph" */
  copies: string[];
  speakerUncertain: boolean;
  graphMerged: boolean;
}

/** One passage, one copy. The supporting and opposing rounds can retrieve the
 *  same chunk, each labelling it by round -- once as the court's holding, once
 *  as counsel's submission -- and the model then follows whichever copy it
 *  cites (eval/citation_faithfulness_results.md, Finding 3 and record 6).
 *
 *  - The earliest copy in round order keeps its position; later copies go.
 *  - If the copies disagree on speaker, neither label is trusted: the survivor
 *    is marked speakerUncertain, since the disagreement is itself the evidence.
 *  - A graph attack whose paragraph lies inside a retrieved chunk is the same
 *    text: the chunk survives once and takes over the attack's citation-edge
 *    meaning (viaGraph + becauseOf), so the edge is kept without resending text.
 *    An attack paragraph is the citing court speaking. */
export function dedupeAcrossRounds(rounds: RoundResult[]): { rounds: RoundResult[]; collapsed: CollapsedPassage[] } {
  const copies = rounds.flatMap((r) => r.items.map((item) => ({ round: r.round, item })));
  const groups = new Map<string, typeof copies>();
  for (const c of copies) {
    if (!c.item.viaGraph) groups.set(c.item.id, [...(groups.get(c.item.id) ?? []), c]);
  }
  for (const c of copies) {
    if (!c.item.viaGraph) continue;
    const para = c.item.text.trim();
    const host = copies.find((h) => !h.item.viaGraph && h.item.tid === c.item.tid
      && (h.item.paraIds.includes(c.item.paraIds[0]) || (para.length > 0 && h.item.text.includes(para))));
    if (host) groups.get(host.item.id)!.push(c);
  }

  const replace = new Map<CounterItem, CounterItem>();
  const drop = new Set<CounterItem>();
  const collapsed: CollapsedPassage[] = [];
  for (const [id, group] of groups) {
    if (group.length < 2) continue;
    const [first, ...rest] = group;
    const speakers = new Set(group.map((c) => (c.item.viaGraph ? 'court_holding' : c.item.kind)));
    const graph = group.filter((c) => c.item.viaGraph);
    const survivor: CounterItem = { ...first.item };
    if (speakers.size > 1) survivor.speakerUncertain = true;
    if (graph.length) {
      survivor.viaGraph = true;
      survivor.becauseOf = [...(first.item.becauseOf ?? []), ...graph.flatMap((g) => g.item.becauseOf ?? [])];
    }
    replace.set(first.item, survivor);
    for (const c of rest) drop.add(c.item);
    collapsed.push({
      id,
      copies: group.map((c) => `${c.round}/${c.item.viaGraph ? 'graph' : c.item.kind}`),
      speakerUncertain: speakers.size > 1,
      graphMerged: graph.length > 0,
    });
  }

  return {
    rounds: rounds.map((r) => {
      const items = r.items.filter((it) => !drop.has(it)).map((it) => replace.get(it) ?? it);
      return { ...r, items, empty: r.empty || items.length === 0 };
    }),
    collapsed,
  };
}

/** If every one of a round's top few items is judged, on its own content,
 *  not to address the question, the round collapses to empty: true. This
 *  only decides the empty flag — it does not filter individual items out of
 *  an otherwise-kept round, which is a different (unrequested) behaviour. */
async function gateRound(question: string, round: RoundResult): Promise<RoundResult> {
  if (!round.items.length) return round;
  const candidates = round.items.map((it) => ({ id: it.id, text: it.text }));
  const noneRelevant = await allIrrelevant(question, candidates);
  return noneRelevant ? { ...round, items: [], empty: true } : round;
}
