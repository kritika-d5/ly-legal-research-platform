/**
 * Keyword highlighting for search results.
 *
 * Done here rather than with Atlas Search's `highlight` option because that
 * option only annotates hits from the BM25 arm — a passage the vector arm
 * found alone would come back with nothing marked, even when it plainly
 * contains "Section 439". Running the same term match over every passage
 * keeps highlighting independent of which retriever surfaced it.
 *
 * Deliberately crude stemming (suffix stripping, applied identically to query
 * and passage) — the goal is "offence" lighting up for "offences", not
 * linguistic accuracy.
 */
import type { Span } from '../types.js';

const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'by', 'for',
  'with', 'from', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it',
  'its', 'this', 'that', 'these', 'those', 'can', 'could', 'should', 'would',
  'will', 'shall', 'may', 'might', 'must', 'do', 'does', 'did', 'has', 'have',
  'had', 'when', 'what', 'which', 'who', 'whom', 'whether', 'how', 'why', 'where',
  'if', 'then', 'than', 'there', 'not', 'no', 'any', 'all', 'under', 'into',
  'about', 'such', 'so', 'also', 'i', 'we', 'you', 'he', 'she', 'they', 'his',
  'her', 'their', 'our', 'my', 'me', 'us', 'them', 'case', 'cases',
]);

const WORD = /[A-Za-z]+|\d+/g;

function stem(word: string): string {
  let w = word.toLowerCase();
  if (w.length > 4) {
    if (w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('ing')) w = w.slice(0, -3);
    else if (w.endsWith('ed')) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  }
  return w;
}

/** Words in nearly every chunk of a bail corpus. Marking "bail" in every
 *  passage tells the user nothing, so these are dropped — unless the query
 *  has nothing more specific, in which case they are all there is to show. */
const CORPUS_COMMON = new Set(['bail', 'court', 'accus', 'grant']);

/** The distinct stems in a query worth highlighting. */
export function queryTerms(query: string): Set<string> {
  const terms = new Set<string>();
  for (const m of query.matchAll(WORD)) {
    const raw = m[0].toLowerCase();
    if (STOPWORDS.has(raw)) continue;
    if (!/^\d+$/.test(raw) && raw.length < 3) continue;
    terms.add(stem(raw));
  }
  const specific = [...terms].filter((t) => !CORPUS_COMMON.has(t));
  return specific.length ? new Set(specific) : terms;
}

/** Offsets of query terms in `text`. Adjacent hits separated only by spaces or
 *  light punctuation merge into one span, so "Section 439" is one mark. */
export function findHighlights(text: string, terms: Set<string>): Span[] {
  if (!terms.size) return [];
  const spans: Span[] = [];
  for (const m of text.matchAll(WORD)) {
    if (!terms.has(stem(m[0]))) continue;
    const start = m.index!;
    const end = start + m[0].length;
    const prev = spans[spans.length - 1];
    if (prev && /^[\s().,-]{0,3}$/.test(text.slice(prev.end, start))) prev.end = end;
    else spans.push({ start, end });
  }
  return spans;
}

/** The distinct surface words a passage matched on, for the fallback explanation. */
export function matchedWords(text: string, spans: Span[]): string[] {
  const seen = new Map<string, string>();
  for (const s of spans) {
    const word = text.slice(s.start, s.end);
    const key = [...word.matchAll(WORD)].map((m) => stem(m[0])).join(' ');
    if (!seen.has(key)) seen.set(key, word);
  }
  return [...seen.values()];
}
