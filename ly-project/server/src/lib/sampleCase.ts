/**
 * The sample case on the Bail case analysis page, and its saved result.
 *
 * A live analysis is several Groq calls and the free tier's daily quota runs
 * out, so a demonstration cannot depend on it. The first time the sample
 * case runs cleanly on the main model (no fallback model, arguments
 * generated, at least one similar judgment) the result is written to
 * server/demo/sample-analysis.json; after that the sample case is answered
 * from that file, instantly, unless the user asks for a fresh run.
 *
 * Only the sample is ever saved. Its facts are invented; a lawyer's own
 * facts are client material and never touch the disk.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import type { CaseAnalysis } from './caseAnalysis.js';

export const SAMPLE_FACTS = `The accused, a 34-year-old man, was arrested on 12 August 2025 by Pune police under Sections 420 and 406 IPC on a complaint by a former business partner alleging that he took Rs 18 lakh for a joint venture and did not return it. He has been in judicial custody since then. The charge sheet was filed on 2 October 2025 and all documents were seized during the investigation. He has a wife and two children in Pune and runs a small transport business. He has no previous criminal cases. The Sessions Court rejected his regular bail application, saying the amount is large and he may influence witnesses. We now want to apply to the High Court for regular bail.`;

const DEMO_DIR = new URL('../../demo/', import.meta.url);
const SAVED = new URL('sample-analysis.json', DEMO_DIR);

/** The sample exactly as offered: same facts, no options changed. */
export function isSample(facts: string, given: { bailSought?: string; offenceCategory?: string }) {
  return facts.trim() === SAMPLE_FACTS && (!given.bailSought || given.bailSought === 'unknown') && !given.offenceCategory;
}

export async function savedSample(): Promise<CaseAnalysis | null> {
  try {
    return JSON.parse(await readFile(SAVED, 'utf8')) as CaseAnalysis;
  } catch {
    return null;
  }
}

/** Keeps a run of the sample only if it is one worth showing. */
export async function saveSampleIfClean(result: CaseAnalysis): Promise<void> {
  const c = result.counter;
  const clean = !result.usedFallbackModel && result.similar.length > 0 && c?.summary && !c.generationFailed
    && !c.classification.classificationFailed && c.invalidCitations.length === 0;
  if (!clean) return;
  try {
    await mkdir(DEMO_DIR, { recursive: true });
    await writeFile(SAVED, JSON.stringify(result, null, 2));
    console.log('[sampleCase] saved a clean run of the sample case for demonstrations');
  } catch (err) {
    console.error('[sampleCase] could not save the sample result:', err);
  }
}
