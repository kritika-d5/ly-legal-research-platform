/**
 * Content-based relevance gate — replaces a similarity-score threshold.
 *
 * eval/coverage_results.md found that cosine similarity does not separate
 * "the corpus has a real answer" from "this is just the nearest available
 * passage": even restricted to the 6 confirmed corpus gaps (PMLA s.45,
 * juvenile bail, foreign nationals, medical/interim bail, passport
 * surrender, NI Act cheque-dishonour bail), no score threshold achieves
 * zero cost in both directions — the best available cutoff (~0.081) fully
 * excludes the 6 gaps only by also wrongly rejecting 3 of 10 genuine
 * should-work queries. A gate built on that score would suppress real
 * answers to keep out fake ones.
 *
 * So: ask the model directly, on the top few candidates a round is about to
 * show, whether each one actually addresses the question — not merely
 * whether it mentions "bail". One cheap Groq call per round. If every
 * checked candidate comes back "no", the round is empty: true, not just
 * low-scoring.
 */
import { z } from 'zod';
import { env } from '../config.js';
import { groq } from './llm.js';

const MAX_CHECKED = 5;
const MAX_CHARS_PER_PASSAGE = 600; // enough for the model to judge topical fit, not the whole chunk

const resultSchema = z.object({
  results: z.array(z.object({ id: z.string(), relevant: z.boolean() })),
});

export interface RelevanceCandidate {
  id: string;
  text: string;
}

const SYSTEM = `You check whether retrieved passages actually address a legal research question, or are merely the nearest thing a similarity search could find.

Nearest-neighbour retrieval over this corpus (198 Indian Supreme Court bail judgments) sometimes returns a passage that is topically adjacent to "bail" in general — anticipatory bail procedure, arrest safeguards, general bail philosophy — without addressing the SPECIFIC question asked. Example: a general anticipatory-bail passage returned for a question about POCSO-specific bail rigour is not relevant, even though both are "about bail".

The test: would a lawyer researching THIS SPECIFIC question actually cite this passage? Answer no if the passage is about bail generally — or about some other bail topic entirely — but does not address the issue this question actually raises. A passage sharing vocabulary with the question (bail, custody, chargesheet, investigating agency) is not enough on its own; that vocabulary recurs throughout nearly every passage in this corpus regardless of topic.

For EACH numbered passage, decide: does its own substantive content actually address the question asked? Being generally bail-related is not enough — it must bear on what was actually asked.

Return JSON only: {"results": [{"id": "<exact id>", "relevant": true|false}, ...]} — one entry per passage, in the same order given.`;

/**
 * Returns the ids (from `candidates`, capped at the top MAX_CHECKED) judged
 * relevant. Fails OPEN — on a missing key or any error, every checked
 * candidate is treated as relevant — because a gate that silently empties
 * every round on a Groq outage is a worse failure mode than the score
 * threshold it replaces (HARD RULE-equivalent to classify()'s own fail-open
 * posture in classify.ts).
 */
export async function filterRelevant(
  question: string,
  candidates: RelevanceCandidate[],
): Promise<Set<string>> {
  const checked = candidates.slice(0, MAX_CHECKED);
  if (!checked.length) return new Set();
  if (!env.groqApiKey) return new Set(checked.map((c) => c.id));

  const prompt = checked
    .map((c) => `[${c.id}]\n${c.text.slice(0, MAX_CHARS_PER_PASSAGE)}`)
    .join('\n\n---\n\n');

  try {
    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `QUESTION: ${question}\n\nPASSAGES:\n\n${prompt}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = resultSchema.parse(JSON.parse(raw));
    const echoed = new Set(parsed.results.map((r) => r.id));
    const relevantIds = new Set(parsed.results.filter((r) => r.relevant).map((r) => r.id));
    // An id the model failed to echo back is neither confirmed relevant nor
    // confirmed irrelevant -- fail open per-item, same posture as the outage case.
    for (const c of checked) {
      if (!echoed.has(c.id)) relevantIds.add(c.id);
    }
    return relevantIds;
  } catch (err) {
    console.error('[relevance] falling back to keep-all:', err);
    return new Set(checked.map((c) => c.id));
  }
}

/** True only when every checked candidate was judged not relevant. Used to
 *  decide whether a round collapses to empty: true — not to filter items,
 *  which stays out of scope for this pass (see counter.ts). */
export async function allIrrelevant(
  question: string,
  candidates: RelevanceCandidate[],
): Promise<boolean> {
  if (!candidates.length) return false; // an already-empty round is not this gate's concern
  const relevant = await filterRelevant(question, candidates);
  return relevant.size === 0;
}
