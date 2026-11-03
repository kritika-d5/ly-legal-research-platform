/**
 * CounterEngine.md §12 item 2, step 1: run the 20 coverage queries through the
 * real /api/counter endpoint (answer generation on) and store every answer with
 * the exact numbered passage set the model was given. Eval script only.
 *
 * Numbering comes from generate.ts selectForContext(), the same function the
 * server uses, so [N] here is exactly the model's [N]. Items it did not select were
 * retrieved but never shown to the model; they are stored with n: null.
 *
 * Aborts if the server log shows a classify or relevance fallback (a budget cap
 * contaminating the run); the batch is kept as <out>.INVALID.json, never deleted.
 * A generation failure is recorded on its query and the run continues.
 *
 * Run from server/, with the dev server up on :8080:
 *   SERVER_LOG=<log> npx tsx src/scripts/faithfulness_run.ts                       -> generated_answers.json
 *   SERVER_LOG=<log> npx tsx src/scripts/faithfulness_run.ts --only sw02,sw03 --out part2.json
 *   npx tsx src/scripts/faithfulness_run.ts --merge part1.json part2.json ...   -> generated_answers.json
 * A batch run (--only) writes only its --out file; the Groq daily cap means the
 * 20 queries are run in batches on separate days and merged.
 */
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectForContext } from '../lib/generate.js';
import type { CounterResponseBody } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(__dirname, '../../../eval');
const EXPECT_PATH = path.join(EVAL, 'coverage_expectations.json');
const OUT_PATH = path.join(EVAL, 'generated_answers.json');
const API_URL = 'http://localhost:8080/api/counter';

const PACE_MS = Number(process.env.PACE_MS ?? 70_000); // Groq free tier: 8k tokens/minute
// Only these mean a budget cap is contaminating classification or gating. A
// generation failure (e.g. a 413 on an oversized prompt) is recorded on that
// query as a finding, not treated as an abort.
const FALLBACK_MARKERS = ['[relevance] falling back', '[classify] falling back'];

function logLines(markers: string[]): string[] {
  const log = process.env.SERVER_LOG;
  if (!log || !existsSync(log)) return [];
  return readFileSync(log, 'utf-8').split(/\r?\n/).filter((l) => markers.some((m) => l.includes(m)));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const argValue = (flag: string) =>
  process.argv.includes(flag) ? process.argv[process.argv.indexOf(flag) + 1] : undefined;

function merge(files: string[], queryOrder: string[]) {
  const byId = new Map<string, { id: string }>();
  for (const f of files) {
    for (const r of JSON.parse(readFileSync(path.resolve(EVAL, f), 'utf-8')) as { id: string }[]) {
      if (byId.has(r.id)) throw new Error(`${r.id} appears in more than one batch`);
      byId.set(r.id, r);
    }
  }
  const missing = queryOrder.filter((id) => !byId.has(id));
  if (missing.length && !process.argv.includes('--partial')) {
    throw new Error(`cannot merge, missing: ${missing.join(', ')} (pass --partial to merge anyway)`);
  }
  const present = queryOrder.filter((id) => byId.has(id));
  writeFileSync(OUT_PATH, JSON.stringify(present.map((id) => byId.get(id)), null, 2), 'utf-8');
  console.log(`merged ${files.length} batches, ${present.length} queries -> ${OUT_PATH}` +
    (missing.length ? `\nNOT PRESENT (${missing.length}): ${missing.join(', ')}` : ''));
}

async function main() {
  const { queries } = JSON.parse(readFileSync(EXPECT_PATH, 'utf-8')) as {
    queries: { id: string; group: string; query: string }[];
  };

  if (process.argv.includes('--merge')) {
    merge(process.argv.slice(process.argv.indexOf('--merge') + 1).filter((a) => a !== '--partial'), queries.map((q) => q.id));
    return;
  }

  if (!process.env.SERVER_LOG) throw new Error('set SERVER_LOG so fallbacks can be detected');
  const onlyArg = argValue('--only');
  const only = onlyArg ? new Set(onlyArg.split(',')) : null;
  const outArg = argValue('--out');
  if (only && !outArg) throw new Error('--only needs --out <batch file>');
  const outPath = outArg ? path.resolve(EVAL, outArg) : OUT_PATH;
  const todo = queries.filter((q) => !only || only.has(q.id));

  const results: unknown[] = [];
  let seenGenerateErrors = logLines(['[generate] failed']).length;
  for (const [i, q] of todo.entries()) {
    if (i > 0) await sleep(PACE_MS);
    const t0 = Date.now();
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ position: q.query, side: 'pro_bail' }),
    });
    if (!res.ok) throw new Error(`${q.id}: HTTP ${res.status} ${await res.text()}`);
    const data = (await res.json()) as CounterResponseBody;

    // Same selection generateAnswer used, so [N] here is the model's [N].
    // Keyed on the item object, not its id: one chunk can appear in two rounds.
    const selected = selectForContext(data.rounds);
    const supplied = new Map(selected.map((it, i) => [it, i + 1]));
    const n = selected.length;
    const items = data.rounds.flatMap((round) =>
      round.items.map((it) => ({
        n: supplied.get(it) ?? null,
        round: round.round,
        chunkId: it.id,
        paraIds: it.paraIds,
        tid: it.tid,
        caseTitle: it.caseTitle,
        year: it.year,
        courtTier: it.courtTier,
        locator: it.locator,
        kind: it.kind,
        speaker: it.speaker,
        viaGraph: it.viaGraph ?? false,
        text: it.text,
      })),
    );

    const generateErrors = logLines(['[generate] failed']);
    results.push({
      id: q.id,
      generatedAt: new Date().toISOString(),
      group: q.group,
      query: q.query,
      classification: data.classification,
      roundsEmpty: Object.fromEntries(data.rounds.map((r) => [r.round, r.empty])),
      answer: data.answer,
      generationFailed: data.generationFailed,
      generationError: data.generationFailed ? generateErrors.slice(seenGenerateErrors)[0] ?? null : null,
      serverInvalidCitations: data.invalidCitations,
      suppliedCount: n,
      items,
      rounds: data.rounds, // raw, so the exact generation prompt can be rebuilt and measured
      tookMs: data.tookMs,
    });
    seenGenerateErrors = generateErrors.length;
    writeFileSync(outPath, JSON.stringify(results, null, 2), 'utf-8');
    console.log(`${q.id} ok ${Date.now() - t0}ms, supplied=${n}, answerChars=${data.answer.length}` +
      `${data.generationFailed ? ' GENERATION FAILED (recorded, not an abort)' : ''}`);

    const bad = logLines(FALLBACK_MARKERS);
    if (bad.length) {
      // Kept, never deleted: the answers before the cap was hit are still evidence.
      const invalidPath = outPath.replace(/\.json$/, '.INVALID.json');
      writeFileSync(invalidPath, JSON.stringify({
        invalid: true, reason: `budget fallback logged during ${q.id}`, fallbackLines: bad, results,
      }, null, 2), 'utf-8');
      unlinkSync(outPath);
      console.error(`\nABORT after ${q.id}: fallback in server log. Batch kept as ${invalidPath}.\n${bad.join('\n')}`);
      process.exit(2);
    }
  }
  console.log(`\nwritten ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
