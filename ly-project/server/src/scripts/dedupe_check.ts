/**
 * Replays lib/counter.ts dedupeAcrossRounds() over the stored answers in
 * eval/generated_answers.json: how many duplicate passages each query's rounds
 * held, how each was resolved, and how the passage now reaches the model.
 * Also lists which reviewed records (eval/claim_verdicts.json) cited a
 * duplicated chunk, and exercises the graph-merge path, which no stored answer
 * triggers, on a synthetic case. No Groq calls; no Mongo writes.
 *
 * Run from server/:  npx tsx src/scripts/dedupe_check.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dedupeAcrossRounds } from '../lib/counter.js';
import { buildPrompt, selectForContext } from '../lib/generate.js';
import type { Classification, CounterItem, RoundResult } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(__dirname, '../../../eval');
const read = (f: string) => JSON.parse(readFileSync(path.join(EVAL, f), 'utf-8'));

interface Stored {
  id: string; query: string; classification: Classification; rounds?: RoundResult[];
  items: (CounterItem & { chunkId: string; round: RoundResult['round'] })[];
}

/** The pre-cap sw01 pilot stored items, not raw rounds; rebuild rounds from them. */
function roundsOf(a: Stored): RoundResult[] {
  if (a.rounds) return a.rounds;
  return (['supporting', 'opposing', 'statutes'] as const).map((round) => {
    const items = a.items.filter((i) => i.round === round).map((i) => ({ ...i, id: i.chunkId }));
    return { round, items, empty: items.length === 0 };
  });
}

const answers = read('generated_answers.json') as Stored[];
const claims = read('claims_to_review.json') as { query_id: string; chunk_id: string; marker: string }[];
const verdicts = (read('claim_verdicts.json') as { verdicts: { n: number; verdict: string }[] }).verdicts;

const dupIds = new Map<string, Set<string>>();
let totalPairs = 0;
console.log('duplicate passages collapsed, per query:');
for (const a of answers) {
  const rounds = roundsOf(a);
  const { rounds: out, collapsed } = dedupeAcrossRounds(rounds);
  dupIds.set(a.id, new Set(collapsed.map((c) => c.id)));
  totalPairs += collapsed.reduce((s, c) => s + c.copies.length - 1, 0);
  const before = rounds.reduce((s, r) => s + r.items.length, 0);
  const after = out.reduce((s, r) => s + r.items.length, 0);
  console.log(`  ${a.id}  ${collapsed.length} collapsed  (items ${before} -> ${after})` +
    collapsed.map((c) => `\n      ${c.id}  [${c.copies.join(' + ')}]` +
      `${c.speakerUncertain ? '  -> SOURCE UNCERTAIN' : ''}${c.graphMerged ? '  -> graph edge merged' : ''}`).join(''));

  // How the surviving copy is numbered and labelled in the prompt now.
  for (const c of collapsed) {
    const n = selectForContext(out).findIndex((it) => it.id === c.id) + 1;
    if (!n) { console.log(`      (not within the 12 supplied to the model)`); continue; }
    const block = buildPrompt({ position: a.query, side: 'pro_bail' }, a.classification, out).user
      .split('\n\n').find((b) => b.startsWith(`[${n}] `)) ?? '';
    console.log(`      now supplied once, as [${n}]: ${block.split('\n')[0].slice(0, 110)}`);
  }
}
console.log(`total duplicate copies removed: ${totalPairs}`);

console.log('\nreviewed records citing a duplicated chunk:');
const hit = claims.map((c, i) => ({ ...c, n: i + 1 })).filter((c) => dupIds.get(c.query_id)?.has(c.chunk_id));
for (const c of hit) console.log(`  record ${c.n}  ${c.query_id}  ${c.marker}  ${c.chunk_id}  verdict=${verdicts[c.n - 1].verdict}`);
if (!hit.length) console.log('  none');

// Synthetic: the graph-merge path, which no stored answer exercises.
const base = { tid: 1, caseTitle: 'A v B', year: 2020, courtTier: 'SC' as const, locator: 'para 9', paraIds: ['1_p9'] };
const chunkCourt: CounterItem = { ...base, id: '1_c3', kind: 'court_holding', speaker: 'THE COURT', text: 'Earlier text. We disagree with X v Y. Later text.' };
const chunkCounsel: CounterItem = { ...chunkCourt, id: '1_c4', kind: 'argument', speaker: 'COUNSEL' };
const attack: CounterItem = { ...base, id: 'attack_1_2', kind: 'court_holding', speaker: 'THE COURT', text: 'We disagree with X v Y.',
  viaGraph: true, becauseOf: [{ tid: 2, title: 'X v Y', polarity: 'neg' }] };
for (const [label, host] of [['court chunk + attack', chunkCourt], ['counsel chunk + attack', chunkCounsel]] as const) {
  const r = dedupeAcrossRounds([
    { round: 'supporting', items: [host], empty: false },
    { round: 'opposing', items: [attack], empty: false },
  ]);
  const kept = r.rounds.flatMap((x) => x.items);
  console.log(`\nsynthetic, ${label}: ${kept.length} item(s) kept, ids=${kept.map((k) => k.id).join(',')}, ` +
    `viaGraph=${kept[0].viaGraph}, becauseOf=${kept[0].becauseOf?.map((b) => b.title).join(',')}, ` +
    `speakerUncertain=${kept[0].speakerUncertain ?? false}, opposing.empty=${r.rounds[1].empty}`);
}
