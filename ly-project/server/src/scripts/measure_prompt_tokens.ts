/**
 * Token size of the generateAnswer request for each stored query, rebuilt with
 * the server's own buildPrompt(). Eval script only; no Groq calls.
 *
 * `uncapped` estimates the pre-§5.4 request (8 per round, no 12 cap) as the
 * capped prompt plus the items the cap dropped, so it can be checked against the
 * 8,257 tokens Groq itself reported for sw10's 413.
 *
 * Run from server/:  npx tsx src/scripts/measure_prompt_tokens.ts generated_answers.part2.json [...]
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AutoTokenizer } from '@huggingface/transformers';

import { buildPrompt, selectForContext } from '../lib/generate.js';
import type { Classification, CounterRequest, RoundResult } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(__dirname, '../../../eval');

interface Rec { id: string; query: string; classification: Classification; rounds?: RoundResult[] }

const tok = await AutoTokenizer.from_pretrained('Xenova/gpt-4o'); // o200k encoding
const count = (s: string) => tok.encode(s).length;

for (const f of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(path.resolve(EVAL, f), 'utf-8')) as Rec[]) {
    if (!r.rounds) { console.log(`${r.id}  (no raw rounds stored -- predates this script)`); continue; }
    const req: CounterRequest = { position: r.query, side: 'pro_bail' };
    const capped = buildPrompt(req, r.classification, r.rounds);
    const cappedTokens = count(capped.system) + count(capped.user);

    const kept = new Set(selectForContext(r.rounds).map((it) => it.id));
    const dropped = r.rounds.flatMap((rd) => rd.items.slice(0, 8)).filter((it) => !kept.has(it.id));
    let uncapped = cappedTokens;
    if (dropped.length) {
      const only = buildPrompt(req, r.classification, [{ round: 'supporting', items: dropped.slice(0, 4), empty: false },
        { round: 'opposing', items: dropped.slice(4), empty: false }]);
      const none = buildPrompt(req, r.classification, []);
      uncapped += count(only.user) - count(none.user);
    }
    console.log(`${r.id}  supplied=${capped.n}  capped=${cappedTokens}  uncapped~${uncapped}  (dropped ${dropped.length})`);
  }
}
