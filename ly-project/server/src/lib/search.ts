/**
 * Hybrid retrieval over the `chunks` collection.
 *
 * Two retrievers run in parallel and are fused with Reciprocal Rank Fusion:
 *
 *   - $vectorSearch on `embedding`  — semantic. Finds "when can bail be
 *     refused for financial crimes" against a paragraph that says none of
 *     those words.
 *   - $search (BM25) on `text`      — lexical. Finds the passage that names
 *     "Section 439" exactly, which the vector side reliably misses because
 *     provision numbers carry almost no semantic signal.
 *
 * Neither alone is sufficient, which is why the data phase built both indexes.
 *
 * DEFAULT CONTENT FILTER: only `court_text` and `editorial` are searched by
 * default (CHUNKING.md §3.1). The other 2,388 chunks are quoted statutes,
 * quoted judgments and dictionary extracts — real text the court reproduced,
 * but not the court's own words. They stay retrievable via `contentTypes`,
 * never by accident.
 */
import { chunks, edges, nodes, TEXT_INDEX, VECTOR_INDEX } from '../config.js';
import type { ContentType, CourtTier, Passage } from '../types.js';
import { embedQuery } from './embed.js';
import { findHighlights, queryTerms } from './highlight.js';

const RRF_K = 60;            // standard RRF damping constant
const CANDIDATES_PER_ARM = 50;

export interface SearchOptions {
  contentTypes?: ContentType[];
  courtTier?: CourtTier;
  yearFrom?: number;
  yearTo?: number;
  limit?: number;
}

const DEFAULT_CONTENT: ContentType[] = ['court_text', 'editorial'];

/** Rank individual passages across the whole corpus. */
export async function searchPassages(
  query: string,
  opts: SearchOptions = {},
): Promise<Passage[]> {
  const contentTypes = opts.contentTypes?.length ? opts.contentTypes : DEFAULT_CONTENT;
  const limit = opts.limit ?? 30;

  const vectorFilter: Record<string, unknown> = { content_type: { $in: contentTypes } };
  if (opts.courtTier) vectorFilter.court_tier = opts.courtTier;
  if (opts.yearFrom || opts.yearTo) {
    const range: Record<string, number> = {};
    if (opts.yearFrom) range.$gte = opts.yearFrom;
    if (opts.yearTo) range.$lte = opts.yearTo;
    vectorFilter.year = range;
  }

  // Post-filter for the BM25 arm: chunks_text_index maps only `text`
  // (dynamic: false), so metadata filtering can't happen inside $search.
  const postFilter: Record<string, unknown> = { content_type: { $in: contentTypes } };
  if (opts.courtTier) postFilter.court_tier = opts.courtTier;
  if (opts.yearFrom || opts.yearTo) postFilter.year = vectorFilter.year;

  const projection = {
    _id: 1, tid: 1, text: 1, locator: 1, content_type: 1,
    section_primary: 1, chunk_kind: 1, title: 1, year: 1, court_tier: 1,
  };

  const [vectorHits, textHits] = await Promise.all([
    embedQuery(query).then((queryVector) =>
      chunks.aggregate([
        {
          $vectorSearch: {
            index: VECTOR_INDEX,
            path: 'embedding',
            queryVector,
            numCandidates: CANDIDATES_PER_ARM * 10,
            limit: CANDIDATES_PER_ARM,
            filter: vectorFilter,
          },
        },
        { $project: { ...projection, rawScore: { $meta: 'vectorSearchScore' } } },
      ]).toArray(),
    ),
    chunks.aggregate([
      { $search: { index: TEXT_INDEX, text: { query, path: 'text' } } },
      { $limit: CANDIDATES_PER_ARM * 3 }, // over-fetch: the filter below is post-hoc
      { $match: postFilter },
      { $limit: CANDIDATES_PER_ARM },
      { $project: { ...projection, rawScore: { $meta: 'searchScore' } } },
    ]).toArray(),
  ]);

  const terms = queryTerms(query);
  return fuse(vectorHits, textHits)
    .slice(0, limit)
    .map((p) => ({ ...p, highlights: findHighlights(p.text, terms) }));
}

/** Reciprocal Rank Fusion: score = Σ 1/(k + rank). Rank-based rather than
 *  score-based, because a cosine similarity and a BM25 score are not on
 *  comparable scales and normalising them is guesswork.
 *
 *  The raw per-arm scores are still carried through for DISPLAY: cosine as-is
 *  (it already means the same thing across queries), BM25 divided by this
 *  query's best BM25 hit (raw BM25 grows with query length and is not). */
function fuse(vectorHits: any[], textHits: any[]): Passage[] {
  const scores = new Map<string, { doc: any; score: number; via: Set<'vector' | 'text'> }>();
  // Atlas reports a cosine index's vectorSearchScore as (1 + cos) / 2; undo that.
  const semantic = new Map<string, number>(vectorHits.map((d) => [d._id, 2 * d.rawScore - 1]));
  const bestBm25 = Math.max(0, ...textHits.map((d) => d.rawScore ?? 0));
  const keyword = new Map<string, number>(
    textHits.map((d) => [d._id, bestBm25 > 0 ? d.rawScore / bestBm25 : 0]),
  );

  const add = (hits: any[], via: 'vector' | 'text') => {
    hits.forEach((doc, i) => {
      const existing = scores.get(doc._id);
      const inc = 1 / (RRF_K + i + 1);
      if (existing) {
        existing.score += inc;
        existing.via.add(via);
      } else {
        scores.set(doc._id, { doc, score: inc, via: new Set([via]) });
      }
    });
  };
  add(vectorHits, 'vector');
  add(textHits, 'text');

  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .map(({ doc, score, via }) => ({
      id: doc._id,
      tid: doc.tid,
      text: doc.text,
      locator: doc.locator ?? null,
      contentType: doc.content_type,
      sectionPrimary: doc.section_primary,
      chunkKind: doc.chunk_kind,
      score,
      via: [...via],
      semanticScore: semantic.get(doc._id) ?? null,
      keywordScore: keyword.get(doc._id) ?? null,
    }));
}

export interface CaseResult {
  tid: number;
  title: string;
  year: number;
  court: string;
  courtTier: CourtTier;
  layer: string;
  hasPdf: boolean;
  score: number;
  /** how many other cases in the corpus cite this one — a rough authority signal */
  citedByCount: number;
  /** the passages that made this case rank, for the result card */
  passages: Passage[];
}

/** Rank whole CASES, which is what the search screen shows. A case's score is
 *  the sum of its best three passages: one strong hit shouldn't outrank a case
 *  that is relevant throughout, and summing every passage would just reward
 *  long judgments for being long. */
export async function searchCases(
  query: string,
  opts: SearchOptions = {},
): Promise<CaseResult[]> {
  const passages = await searchPassages(query, { ...opts, limit: 120 });
  if (!passages.length) return [];

  const byCase = new Map<number, Passage[]>();
  for (const p of passages) {
    const list = byCase.get(p.tid) ?? [];
    list.push(p);
    byCase.set(p.tid, list);
  }

  const tids = [...byCase.keys()];
  const [nodeDocs, citedBy] = await Promise.all([
    nodes.find({ _id: { $in: tids } }).project({ kanoon_html: 0, text: 0 }).toArray(),
    edges.aggregate([
      { $match: { dst: { $in: tids } } },
      { $group: { _id: '$dst', n: { $sum: 1 } } },
    ]).toArray(),
  ]);

  const nodeById = new Map(nodeDocs.map((n: any) => [n._id, n]));
  const citedByCount = new Map(citedBy.map((r: any) => [r._id, r.n]));

  const results: CaseResult[] = tids.map((tid) => {
    const ps = byCase.get(tid)!.sort((a, b) => b.score - a.score);
    const node: any = nodeById.get(tid) ?? {};
    return {
      tid,
      title: node.title ?? ps[0]?.text.slice(0, 60) ?? String(tid),
      year: Number(String(node.publishdate ?? '').slice(0, 4)) || 0,
      court: node.docsource ?? 'unknown',
      courtTier: deriveTier(node.docsource),
      layer: node.layer ?? 'unknown',
      hasPdf: Boolean(node.s3_pdf_key),
      score: ps.slice(0, 3).reduce((s, p) => s + p.score, 0),
      citedByCount: citedByCount.get(tid) ?? 0,
      passages: ps.slice(0, 3),
    };
  });

  return results
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit ?? 20);
}

/** Same rule the chunking phase used (CHUNKING.md Stage 5): prefix match, so
 *  "Supreme Court - Daily Orders" counts as SC rather than falling to OTHER
 *  alongside the National Green Tribunal case. */
export function deriveTier(docsource?: string): CourtTier {
  if (!docsource) return 'OTHER';
  if (docsource.startsWith('Supreme Court')) return 'SC';
  if (docsource.includes('High Court')) return 'HC';
  return 'OTHER';
}
