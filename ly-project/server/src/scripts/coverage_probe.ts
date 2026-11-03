/**
 * CounterEngine.md §12 item 1 — the 20-question coverage probe. Phase 3+.
 *
 * This is an EVAL script, not application code — it changes nothing in
 * routes/, lib/, or types/. Its only job is to run the 20 queries in
 * eval/coverage_expectations.json against the REAL, running /api/counter
 * endpoint (same HTTP call a user's browser would make) and record what
 * came back.
 *
 * One wrinkle: CounterItem (types.ts) carries no similarity score, by
 * design — the API was never meant to leak retrieval internals to the
 * client. But Phase 3/5 need "top similarity score" and "5th-item score"
 * per round to look for a should-work/should-fail separation. Rather than
 * add a score field to the API (an application-code change this pass
 * explicitly forbids), this script calls the SAME functions counter.ts
 * itself calls -- searchCases() for the supporting round, an equivalent
 * read-only $vectorSearch for the submissions half of the opposing round
 * -- from inside this script, so the scores are the server's actual
 * scores, not a reimplementation. Graph attacks and the pinned statutes
 * round are deterministic lookups with no similarity score by
 * construction; they are reported as item counts only, never forced into
 * a fake score.
 *
 * Run from server/: npx tsx src/scripts/coverage_probe.ts
 * Requires the dev server already running on :8080 (npm run dev).
 */
import 'dotenv/config';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chunks, client, VECTOR_INDEX } from '../config.js';
import { embedQuery } from '../lib/embed.js';
import { searchCases } from '../lib/search.js';
import type { CounterRequest, CounterResponseBody } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../../'); // ly-project/
const EXPECT_PATH = path.join(ROOT, 'eval/coverage_expectations.json');
const RAW_PATH = path.join(ROOT, 'eval/coverage_raw_results.json');
const API_URL = 'http://localhost:8080/api/counter';

const SUPPORTING_LIMIT = 8;           // mirrors counter.ts's SUPPORTING_LIMIT
const OPPOSING_SUBMISSIONS_LIMIT = 8; // mirrors counter.ts's OPPOSING_SUBMISSIONS_LIMIT

interface ScoredHit { id: string; tid: number; score: number }

/** Read-only mirror of roundOpposingSubmissions's $vectorSearch (counter.ts),
 *  with the one addition of projecting the Atlas-computed similarity score.
 *  Same index, same filter, same limits -- not a different retrieval. */
async function scoreOpposingSubmissions(queryVector: number[]): Promise<ScoredHit[]> {
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
    { $project: { _id: 1, tid: 1, score: { $meta: 'vectorSearchScore' } } },
    { $limit: OPPOSING_SUBMISSIONS_LIMIT },
  ]).toArray();
  return hits as unknown as ScoredHit[];
}

interface QueryExpectation {
  id: string;
  group: 'should_work' | 'should_fail';
  query: string;
  area: string;
  expected?: { tid: number; title: string; reason: string }[];
  evidence?: string;
}

async function runOne(q: QueryExpectation) {
  const body: CounterRequest = { position: q.query, side: 'pro_bail' };
  const t0 = Date.now();
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${q.id}: HTTP ${res.status} -- ${text}`);
  }
  const data = (await res.json()) as CounterResponseBody;
  const httpMs = Date.now() - t0;

  // Recover scores the HTTP layer strips, via the server's own functions.
  const qvec = await embedQuery(q.query);
  const supportingCases = await searchCases(q.query, { contentTypes: ['court_text'], limit: SUPPORTING_LIMIT });
  const submissionScores = await scoreOpposingSubmissions(qvec);
  const scoreById = new Map(submissionScores.map((h) => [h.id, h.score]));
  const scoreByCaseTid = new Map(supportingCases.map((c) => [c.tid, c.score]));

  const supportingRound = data.rounds.find((r) => r.round === 'supporting');
  const opposingRound = data.rounds.find((r) => r.round === 'opposing');
  const statutesRound = data.rounds.find((r) => r.round === 'statutes');

  const supportingItems = (supportingRound?.items ?? []).map((it) => ({
    tid: it.tid, caseTitle: it.caseTitle, id: it.id,
    score: scoreByCaseTid.get(it.tid) ?? null,
  }));

  const opposingAttacks = (opposingRound?.items ?? [])
    .filter((it) => it.viaGraph)
    .map((it) => ({ tid: it.tid, caseTitle: it.caseTitle, id: it.id, score: null as number | null }));
  const opposingSubmissions = (opposingRound?.items ?? [])
    .filter((it) => !it.viaGraph)
    .map((it) => ({ tid: it.tid, caseTitle: it.caseTitle, id: it.id, score: scoreById.get(it.id) ?? null }));

  const statuteItems = (statutesRound?.items ?? []).map((it) => ({ tid: it.tid, caseTitle: it.caseTitle, id: it.id }));

  const scoresOf = (arr: { score: number | null }[]) =>
    arr.map((x) => x.score).filter((s): s is number => s !== null);

  return {
    id: q.id, group: q.group, area: q.area, query: q.query,
    classification: data.classification,
    httpMs, tookMs: data.tookMs,
    supporting: {
      empty: supportingRound?.empty ?? true,
      itemCount: supportingItems.length,
      items: supportingItems,
      topScore: scoresOf(supportingItems)[0] ?? null,
      fifthScore: scoresOf(supportingItems)[4] ?? null,
    },
    opposing_attacks: {
      itemCount: opposingAttacks.length,
      items: opposingAttacks,
    },
    opposing_submissions: {
      itemCount: opposingSubmissions.length,
      items: opposingSubmissions,
      topScore: scoresOf(opposingSubmissions)[0] ?? null,
      fifthScore: scoresOf(opposingSubmissions)[4] ?? null,
    },
    opposing_empty: opposingRound?.empty ?? true,
    statutes: {
      empty: statutesRound?.empty ?? true,
      itemCount: statuteItems.length,
      items: statuteItems,
    },
  };
}

async function main() {
  await client.connect();
  const expectations = JSON.parse(readFileSync(EXPECT_PATH, 'utf-8')) as {
    queries: QueryExpectation[];
  };

  const results = [];
  for (const q of expectations.queries) {
    process.stdout.write(`${q.id} (${q.group})... `);
    const r = await runOne(q);
    console.log(`ok, ${r.tookMs}ms, offence=${r.classification.offenceCategory}` +
      `${r.classification.offenceInferred ? ' (inferred)' : ''}`);
    results.push(r);
  }

  mkdirSync(path.dirname(RAW_PATH), { recursive: true });
  writeFileSync(RAW_PATH, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\nraw results written to ${RAW_PATH}`);

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
