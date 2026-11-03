import { useState } from 'react';
import type { Span } from '../api';

/**
 * A passage with two kinds of emphasis:
 *
 *  - keyword hits (gold <mark>) — words from the query, found server-side
 *  - the key sentence (sage underline) — the sentence the explanation step
 *    pointed at, verified verbatim by the server before it gets here
 *
 * Collapsed, it shows a window of text AROUND the key sentence (or the first
 * keyword hit) rather than the first few lines, because the part that matched
 * is often deep in a long paragraph and a head-of-text clamp hides it.
 */
const WINDOW = 420;
const LEAD = 140;

export default function HighlightedText({
  text,
  highlights = [],
  keySpan = null,
  className = '',
}: {
  text: string;
  highlights?: Span[];
  keySpan?: Span | null;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const fits = text.length <= WINDOW + 60;

  let [from, to] = [0, text.length];
  if (!expanded && !fits) {
    const anchor = keySpan ?? highlights[0] ?? null;
    from = anchor ? Math.max(0, anchor.start - LEAD) : 0;
    to = Math.min(text.length, from + Math.max(WINDOW, (anchor ? anchor.end - anchor.start : 0) + 2 * LEAD));
    if (to === text.length) from = Math.max(0, to - WINDOW);
    // Snap to word boundaries so the window never starts mid-word.
    if (from > 0) from = nextSpace(text, from);
    if (to < text.length) to = prevSpace(text, to);
  }

  const segments = split(text, from, to, highlights, keySpan);

  return (
    <div>
      <p className={className}>
        {from > 0 && <span className="text-stone-400">… </span>}
        {segments.map((s, i) => {
          const keyCls = s.key ? 'bg-sage-50 underline decoration-sage-500 decoration-2 underline-offset-2' : '';
          return s.kw ? (
            <mark key={i} className={`rounded-sm bg-gold-100 px-0.5 text-inherit ${keyCls}`}>
              {s.text}
            </mark>
          ) : (
            <span key={i} className={keyCls}>
              {s.text}
            </span>
          );
        })}
        {to < text.length && <span className="text-stone-400"> …</span>}
      </p>
      {!fits && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-1 text-[11px] text-stone-500 underline decoration-stone-300 underline-offset-2
                     hover:text-maroon-700"
        >
          {expanded ? 'Show less' : 'Show full passage'}
        </button>
      )}
    </div>
  );
}

function nextSpace(text: string, i: number) {
  const j = text.indexOf(' ', i);
  return j < 0 || j - i > 30 ? i : j + 1;
}

function prevSpace(text: string, i: number) {
  const j = text.lastIndexOf(' ', i);
  return j < 0 || i - j > 30 ? i : j;
}

interface Segment {
  text: string;
  kw: boolean;
  key: boolean;
}

/** Cut text[from, to) at every span boundary and tag each piece. */
function split(text: string, from: number, to: number, highlights: Span[], keySpan: Span | null): Segment[] {
  const cuts = new Set([from, to]);
  for (const s of [...highlights, ...(keySpan ? [keySpan] : [])]) {
    if (s.start > from && s.start < to) cuts.add(s.start);
    if (s.end > from && s.end < to) cuts.add(s.end);
  }
  const points = [...cuts].sort((a, b) => a - b);
  const inside = (s: Span, i: number) => i >= s.start && i < s.end;

  const out: Segment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b] = [points[i], points[i + 1]];
    out.push({
      text: text.slice(a, b),
      kw: highlights.some((s) => inside(s, a)),
      key: keySpan ? inside(keySpan, a) : false,
    });
  }
  return out;
}
