/**
 * How later judgments in the corpus treated a case — the data behind the
 * precedent check, the judges' timeline and the lawyers' brief.
 *
 * An edge src -> dst means `src` cites `dst`; its polarity is how src treated
 * dst (Indian Kanoon citation data). So "treatment of X" = edges with dst = X.
 */
import { edges, nodes } from '../config.js';
import type { EdgeDoc, NodeDoc } from '../types.js';

export type Polarity = NonNullable<EdgeDoc['polarity']> | 'unknown';
export type PolarityCounts = Record<Polarity, number>;

const empty = (): PolarityCounts => ({ pos: 0, neg: 0, mixed: 0, neutral: 0, unknown: 0 });

/** Treatment counts for many cases in one query. */
export async function treatmentCounts(tids: number[]) {
  const rows = await edges
    .aggregate<{ _id: { dst: number; p: Polarity }; n: number }>([
      { $match: { dst: { $in: tids } } },
      { $group: { _id: { dst: '$dst', p: { $ifNull: ['$polarity', 'unknown'] } }, n: { $sum: 1 } } },
    ])
    .toArray();
  const out = new Map<number, PolarityCounts>();
  for (const tid of tids) out.set(tid, empty());
  for (const r of rows) out.get(r._id.dst)![r._id.p] += r.n;
  return out;
}

/** The later judgments that disagreed with each case, wholly or in part. */
export async function disagreeingJudgments(tids: number[]) {
  const negative = await edges.find({ dst: { $in: tids }, polarity: { $in: ['neg', 'mixed'] } }).toArray();
  const srcNodes = await nodes
    .find({ _id: { $in: [...new Set(negative.map((e) => e.src))] } })
    .project<Pick<NodeDoc, '_id' | 'title' | 'publishdate'>>({ title: 1, publishdate: 1 })
    .toArray();
  const byId = new Map(srcNodes.map((n) => [n._id, n]));
  const out = new Map<number, { tid: number; title: string; year: number | null; polarity: 'neg' | 'mixed' }[]>();
  for (const tid of tids) out.set(tid, []);
  for (const e of negative) {
    const n = byId.get(e.src);
    out.get(e.dst)!.push({
      tid: e.src,
      title: n?.title ?? String(e.src),
      year: Number(String(n?.publishdate ?? '').slice(0, 4)) || null,
      polarity: e.polarity as 'neg' | 'mixed',
    });
  }
  return out;
}
