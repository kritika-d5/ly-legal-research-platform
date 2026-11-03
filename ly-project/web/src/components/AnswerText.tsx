/**
 * Renders a model answer: a small, safe subset of markdown, citation labels
 * like [A3] as buttons that open the cited extract, and a check on quotations.
 *
 * The quote check is the part that matters. A model can attach a citation to
 * words that are not in the cited passage. Anything the answer puts in
 * quotation marks is looked for in the extracts the model was actually given;
 * if it is not there, it is flagged. That catches invented quotes (not
 * invented paraphrase — hence the "verify" notice around every answer).
 *
 * Built from React elements, never innerHTML, so model output cannot inject
 * markup into the page.
 */
import type { ReactNode } from 'react';

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/[‘’“”"'`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Is this quotation (possibly with "…" gaps) present in the source text? */
function quoteFound(quote: string, haystack: string) {
  const parts = quote
    .split(/…|\.\.\./)
    .map(normalise)
    .filter((p) => p.split(' ').length >= 3);
  return parts.length === 0 || parts.every((p) => haystack.includes(p));
}

// One pass over a line: bold, italic, citations (both [A3] and the 【A3】 some
// models emit), and double-quoted text.
const INLINE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|【[A-Z]?\d+】|\[[A-Z]?\d+\]|“[^”]{3,}”|"[^"\n]{12,}")/g;

interface Props {
  text: string;
  /** Concatenated text of every extract the model saw; enables the quote check. */
  sourceText?: string;
  onCite?: (label: string) => void;
  /** While streaming, quotes are not checked yet (they may be half-written). */
  streaming?: boolean;
}

export default function AnswerText({ text, sourceText, onCite, streaming }: Props) {
  const haystack = sourceText ? normalise(sourceText) : null;

  const inline = (line: string, key: string): ReactNode[] =>
    line.split(INLINE).map((tok, i) => {
      const k = `${key}-${i}`;
      if (!tok) return null;
      if (tok.startsWith('**') && tok.endsWith('**') && tok.length > 4) {
        return <strong key={k} className="font-semibold text-stone-900">{inline(tok.slice(2, -2), k)}</strong>;
      }
      if (tok.startsWith('*') && tok.endsWith('*') && tok.length > 2) return <em key={k}>{tok.slice(1, -1)}</em>;
      const cite = /^(?:【|\[)([A-Z]?\d+)(?:】|\])$/.exec(tok);
      if (cite) {
        return (
          <button
            key={k}
            type="button"
            onClick={() => onCite?.(cite[1])}
            title={`Show extract ${cite[1]}`}
            className="mx-0.5 rounded bg-navy-50 px-1 font-mono text-[11px] font-medium text-navy-600 ring-1 ring-navy-200 hover:bg-navy-100"
          >
            {cite[1]}
          </button>
        );
      }
      if ((tok.startsWith('“') || tok.startsWith('"')) && haystack && !streaming) {
        const quote = tok.slice(1, -1);
        if (!quoteFound(quote, haystack)) {
          return (
            <span
              key={k}
              title="These words were not found in the extracts the model was given. Check before relying on them."
              className="rounded bg-vermilion-50 px-0.5 text-vermilion-700 underline decoration-vermilion-400 decoration-wavy underline-offset-4"
            >
              {tok}
              <span className="ml-1 text-[10px] font-semibold uppercase tracking-wide">⚠ not found in the extracts</span>
            </span>
          );
        }
      }
      return <span key={k}>{tok}</span>;
    });

  const blocks: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = (key: string) => {
    if (bullets.length) blocks.push(<ul key={`ul-${key}`} className="my-2 list-disc space-y-1 pl-5">{bullets}</ul>);
    bullets = [];
  };

  text.split('\n').forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = /^\s*(?:[-*•])\s+(.*)$/.exec(line);
    const heading = /^#{1,4}\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(<li key={i}>{inline(bullet[1], `b${i}`)}</li>);
      return;
    }
    flush(String(i));
    if (!line.trim()) return;
    if (/^-{3,}$/.test(line.trim())) blocks.push(<hr key={i} className="my-3 border-stone-200" />);
    else if (heading) blocks.push(<h4 key={i} className="mt-4 text-sm font-semibold text-stone-900">{inline(heading[1], `h${i}`)}</h4>);
    else blocks.push(<p key={i} className="my-2">{inline(line, `p${i}`)}</p>);
  });
  flush('end');

  return <div className="text-[15px] leading-relaxed text-stone-800">{blocks}</div>;
}

/** Count flagged quotations, so the page can say "2 quotes could not be found". */
export function countUnverifiedQuotes(text: string, sourceText: string) {
  const haystack = normalise(sourceText);
  const quotes = text.match(/“[^”]{3,}”|"[^"\n]{12,}"/g) ?? [];
  return quotes.filter((q) => !quoteFound(q.slice(1, -1), haystack)).length;
}
