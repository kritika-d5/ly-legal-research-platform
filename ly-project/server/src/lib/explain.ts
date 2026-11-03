/**
 * "Why was this returned?" — a plain-English reason, a match strength, and
 * the one sentence that carries the match, for each search result shown.
 *
 * One batched Groq call per search, made AFTER results render (the client
 * calls /api/search/explain separately) so explanation latency never delays
 * the ranking itself.
 *
 * Two guards on what the model says:
 *
 *  - ATTRIBUTION. Passages are labelled with their content_type exactly as
 *    llm.ts does, and the prompt forbids "the court held" for quoted
 *    material. A one-line explanation is still a statement about the law.
 *
 *  - VERBATIM KEY SENTENCE. The model is asked to copy the sentence that
 *    matters, and the server only highlights it if that text is actually
 *    found in the passage. A paraphrased or invented "quote" is dropped
 *    rather than shown as if the judgment said it.
 *
 * Fails open to a deterministic explanation built from matched keywords and
 * which retriever found the passage — the user always gets some reason.
 */
import { z } from 'zod';
import { chunks, env } from '../config.js';
import type { ContentType, Explanation, Span } from '../types.js';
import { findHighlights, matchedWords, queryTerms } from './highlight.js';
import { groq } from './llm.js';

export const MAX_EXPLAINED = 10;
const MAX_CHARS_PER_PASSAGE = 2500;
const CACHE_LIMIT = 2000;

const DESCRIBE: Record<ContentType, string> = {
  court_text: "the court's own words",
  quoted_case: 'a passage QUOTED from another judgment (not this court speaking)',
  quoted_statute: 'the text of a STATUTORY PROVISION quoted in the judgment',
  quoted_other: 'material QUOTED from an outside source',
  editorial: "an SCR HEADNOTE — the law reporter's summary, not the court",
};

const SYSTEM = `You explain to a user of a legal search engine why each search result was returned for their query. The corpus is Indian bail judgments. The user may not be a lawyer.

For EACH numbered passage return:
- "match": "strong" if the passage directly addresses the specific thing asked; "partial" if it addresses a related point, part of the question, or the general principle behind it; "weak" if it only shares vocabulary or the broad topic (e.g. it is "about bail" but not about what was asked).
- "why": ONE or TWO short sentences in plain, everyday English saying what the passage says that connects it to the query. Speak to the user ("you asked about…" is fine). No legal jargon unless the query used it. If the match is weak, say honestly what the passage is actually about instead.
- "keySentence": the single sentence (or clause) from the passage that best shows the connection, COPIED EXACTLY character-for-character from the passage. Do not paraphrase, shorten with "...", or fix typos. Use "" if no sentence fits.

ATTRIBUTION — a correctness requirement: each passage is tagged with what it is. If it is quoted statute text, say "this is the text of Section X that the judgment quotes", never "the court held". If it is quoted from another judgment, say it is a quotation. If it is a headnote, say it is the reporter's summary. Only court's-own-words passages may be described as what the court said or decided.

Return JSON only: {"results": [{"id": "<exact id>", "match": "...", "why": "...", "keySentence": "..."}, ...]} — one entry per passage, same order.`;

const resultSchema = z.object({
  results: z.array(z.object({
    id: z.string(),
    match: z.enum(['strong', 'partial', 'weak']),
    why: z.string(),
    keySentence: z.string().default(''),
  })),
});

interface ExplainDoc {
  _id: string;
  text: string;
  content_type: ContentType;
  locator: string | null;
}

const cache = new Map<string, Explanation>();
const cacheKey = (query: string, id: string) => `${query.trim().toLowerCase()}::${id}`;

function remember(query: string, e: Explanation) {
  // Fallbacks are not cached: they exist because Groq failed, and the next
  // request should get a chance at the real explanation.
  if (e.source !== 'llm') return;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(cacheKey(query, e.id), e);
}

export async function explainPassages(query: string, ids: string[]): Promise<Explanation[]> {
  const wanted = [...new Set(ids)].slice(0, MAX_EXPLAINED);
  const cached = new Map<string, Explanation>();
  for (const id of wanted) {
    const hit = cache.get(cacheKey(query, id));
    if (hit) cached.set(id, hit);
  }

  const missing = wanted.filter((id) => !cached.has(id));
  const docs = missing.length
    ? ((await chunks
        .find({ _id: { $in: missing } })
        .project({ text: 1, content_type: 1, locator: 1 })
        .toArray()) as unknown as ExplainDoc[])
    : [];
  const docById = new Map(docs.map((d) => [d._id, d]));
  const fresh = await explainDocs(query, missing.map((id) => docById.get(id)).filter((d): d is ExplainDoc => !!d));
  for (const e of fresh) remember(query, e);

  const freshById = new Map(fresh.map((e) => [e.id, e]));
  return wanted
    .map((id) => cached.get(id) ?? freshById.get(id))
    .filter((e): e is Explanation => !!e);
}

async function explainDocs(query: string, docs: ExplainDoc[]): Promise<Explanation[]> {
  if (!docs.length) return [];
  if (!env.groqApiKey) return docs.map((d) => fallback(query, d));

  const prompt = docs
    .map((d) => {
      const where = d.locator ? ` | ${d.locator}` : '';
      return `[${d._id}] (${DESCRIBE[d.content_type]}${where})\n${d.text.slice(0, MAX_CHARS_PER_PASSAGE)}`;
    })
    .join('\n\n---\n\n');

  try {
    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `QUERY: ${query}\n\nPASSAGES:\n\n${prompt}` },
      ],
    });
    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = resultSchema.parse(JSON.parse(raw));
    // The model tends to echo the id with the brackets it was shown in.
    const byId = new Map(parsed.results.map((r) => [r.id.replace(/[[\]\s]/g, ''), r]));

    return docs.map((d) => {
      const r = byId.get(d._id);
      // An id the model skipped gets the fallback, not a guess.
      if (!r) return fallback(query, d);
      return {
        id: d._id,
        match: r.match,
        why: r.why.trim(),
        keySpan: locate(d.text, r.keySentence),
        source: 'llm' as const,
      };
    });
  } catch (err) {
    // Message only: util.inspect on some groq-sdk error objects throws, and a
    // throw here would turn a recoverable failure into a 500.
    console.error('[explain] falling back to keyword explanation:', err instanceof Error ? err.message : String(err));
    return docs.map((d) => fallback(query, d));
  }
}

/** Find the model's quoted sentence in the passage. Exact match first, then a
 *  whitespace-tolerant one (the chunk text carries line breaks the model tends
 *  to normalise). Anything looser would let a paraphrase through. */
export function locate(text: string, quote: string): Span | null {
  const q = quote.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
  if (q.length < 12) return null;

  const exact = text.indexOf(q);
  if (exact >= 0) return { start: exact, end: exact + q.length };

  const words = q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const m = new RegExp(words.join('\\s+')).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

function fallback(query: string, d: ExplainDoc): Explanation {
  const words = matchedWords(d.text, findHighlights(d.text, queryTerms(query))).slice(0, 5);
  const why = words.length
    ? `Contains words from your search: ${words.map((w) => `"${w}"`).join(', ')}.`
    : 'No exact words from your search appear here; it was returned because its meaning is close to your question.';
  return { id: d._id, match: null, why, keySpan: null, source: 'fallback' };
}
