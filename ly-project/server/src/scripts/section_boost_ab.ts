/**
 * In-process A/B of the section_primary tiebreaker in lib/search.ts, on the
 * 20 coverage-probe queries. Eval script only: reads lib/, changes nothing.
 *
 * The supporting-round ranking is searchCases() alone (Mongo + local BGE
 * embedder); classify, the relevance gate and generateAnswer all run after it
 * and cannot reorder it. So this needs no server and makes no Groq calls.
 *
 * SECTION_BOOST_ON is a module-level constant, so the flag must be set before
 * search.js is first loaded -- hence the dynamic import, and one process per
 * arm (a second import() in the same process would return the cached module).
 *
 * Run from server/:
 *   npx tsx src/scripts/section_boost_ab.ts off     -> eval/run_A_boost_off.json
 *   npx tsx src/scripts/section_boost_ab.ts on      -> eval/run_B_boost_on.json
 *   npx tsx src/scripts/section_boost_ab.ts check   -> proves the arms differ
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(__dirname, '../../../eval');
const EXPECT_PATH = path.join(EVAL, 'coverage_expectations.json');
const OUT = {
  off: path.join(EVAL, 'run_A_boost_off.json'),
  on: path.join(EVAL, 'run_B_boost_on.json'),
};

const SUPPORTING_LIMIT = 8; // mirrors counter.ts roundSupporting

type Arm = 'off' | 'on';
interface Row { id: string; supporting: { items: { tid: number; caseTitle: string; id: string; score: number }[] } }

async function runArm(arm: Arm) {
  if (arm === 'off') process.env.SECTION_BOOST = 'off';
  else delete process.env.SECTION_BOOST;

  const { client } = await import('../config.js');
  const { searchCases } = await import('../lib/search.js');

  const { queries } = JSON.parse(readFileSync(EXPECT_PATH, 'utf-8')) as {
    queries: { id: string; query: string }[];
  };

  await client.connect();
  const rows: Row[] = [];
  for (const q of queries) {
    const cases = await searchCases(q.query, { contentTypes: ['court_text'], limit: SUPPORTING_LIMIT });
    // roundSupporting drops cases with no passage and cites passages[0]; same here.
    const items = cases
      .filter((c) => c.passages.length > 0)
      .map((c) => ({ tid: c.tid, caseTitle: c.title, id: c.passages[0].id, score: c.score }));
    rows.push({ id: q.id, supporting: { items } });
    console.log(`${q.id}  ${items.map((i) => i.tid).join(',')}`);
  }
  await client.close();

  writeFileSync(OUT[arm], JSON.stringify(rows, null, 2), 'utf-8');
  console.log(`\nSECTION_BOOST=${process.env.SECTION_BOOST ?? '(unset)'} -> ${OUT[arm]}`);
}

function check() {
  const a = JSON.parse(readFileSync(OUT.off, 'utf-8')) as Row[];
  const b = JSON.parse(readFileSync(OUT.on, 'utf-8')) as Row[];
  const sig = (r: Row) => r.supporting.items.map((i) => `${i.tid}:${i.id}`).join('|');
  const bById = new Map(b.map((r) => [r.id, r]));
  let differ = 0;
  for (const ra of a) {
    const rb = bById.get(ra.id);
    const same = rb !== undefined && sig(ra) === sig(rb);
    if (!same) differ++;
    console.log(`${ra.id}  ${same ? 'identical' : 'DIFFERENT'}`);
  }
  console.log(`\n${differ}/${a.length} queries differ between arms`);
  if (differ === 0) {
    console.error('VOID: arms are identical -- the flag did not take.');
    process.exit(1);
  }
}

const arg = process.argv[2];
if (arg === 'off' || arg === 'on') {
  runArm(arg).catch((err) => { console.error(err); process.exit(1); });
} else if (arg === 'check') {
  check();
} else {
  console.error('usage: section_boost_ab.ts off|on|check');
  process.exit(1);
}
