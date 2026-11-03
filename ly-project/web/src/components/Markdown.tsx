import type { ReactNode } from 'react';

/**
 * Renders model-written markdown (case summary, case chat) without a markdown
 * library and never via `dangerouslySetInnerHTML`: a small block parser for
 * what the model actually emits — headings (`## X`, or a line that is only
 * `**X**`), bullet and numbered lists, tables, **bold**, *italic*, and
 * citations as [N], [N, M] or 【N】. Anything else is a plain paragraph, so
 * nothing is dropped. Works on partial text, so it can render a stream.
 */
export type MdBlock =
  | { type: 'heading'; text: string }
  | { type: 'para'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; header: string[]; rows: string[][] };

const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const BOLD_LINE = /^\s*\*\*([^*]+?)\*\*\s*:?\s*$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}/;
const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

const cells = (line: string) =>
  line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
const isItem = (l: string) => BULLET.test(l) || NUMBERED.test(l);
const isHeading = (l: string) => HEADING.test(l) || BOLD_LINE.test(l);

export function parseMarkdown(markdown: string): MdBlock[] {
  const blocks: MdBlock[] = [];
  const lines = markdown.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim() || RULE.test(line)) continue;

    const h = HEADING.exec(line) ?? BOLD_LINE.exec(line);
    if (h) { blocks.push({ type: 'heading', text: h[1].replace(/\*+/g, '').trim() }); continue; }

    if (line.trim().startsWith('|')) {
      const rows: string[][] = [];
      for (; i < lines.length && lines[i].trim().startsWith('|'); i++) {
        if (!TABLE_SEPARATOR.test(lines[i].trim().replace(/^\|/, ''))) rows.push(cells(lines[i]));
      }
      i--;
      if (rows.length) blocks.push({ type: 'table', header: rows[0], rows: rows.slice(1) });
      continue;
    }

    if (isItem(line)) {
      const ordered = !BULLET.test(line);
      const items: string[] = [];
      for (; i < lines.length; i++) {
        const l = lines[i];
        const m = BULLET.exec(l) ?? NUMBERED.exec(l);
        if (m) items.push(m[1]);
        else if (l.trim() && /^\s{2,}/.test(l) && items.length) items[items.length - 1] += ' ' + l.trim();
        else if (!l.trim() && i + 1 < lines.length && isItem(lines[i + 1])) continue;
        else break;
      }
      i--;
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    const para: string[] = [line.trim()];
    while (i + 1 < lines.length && lines[i + 1].trim() && !isHeading(lines[i + 1]) && !RULE.test(lines[i + 1])
      && !lines[i + 1].trim().startsWith('|') && !isItem(lines[i + 1])) {
      para.push(lines[++i].trim());
    }
    blocks.push({ type: 'para', text: para.join(' ') });
  }
  return blocks;
}

const INLINE = /(\*\*.+?\*\*|\*[^*\s][^*]*\*|`[^`]+`|【\d+[^】]*】|\[\d+(?:\s*[,;]\s*\d+)*\])/g;

function Cite({ n }: { n: string }) {
  return (
    <span
      title={`Passage ${n}`}
      className="mx-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded bg-stone-100 px-1
                 align-[1px] font-sans text-[10px] font-semibold text-stone-600 ring-1 ring-stone-200"
    >
      {n}
    </span>
  );
}

export function renderInline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold text-stone-900">{renderInline(part.slice(2, -2))}</strong>;
    }
    if (/^\*[^*]/.test(part) && part.endsWith('*') && part.length > 2) {
      return <em key={i}>{part.slice(1, -1)}</em>;
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="rounded bg-stone-100 px-1 text-[0.9em]">{part.slice(1, -1)}</code>;
    }
    const full = /^【(\d+)[^】]*】$/.exec(part);
    if (full) return <Cite key={i} n={full[1]} />;
    const ascii = /^\[([\d\s,;]+)\]$/.exec(part);
    if (ascii) return ascii[1].split(/[,;]/).map((n, j) => <Cite key={`${i}-${j}`} n={n.trim()} />);
    return <span key={i}>{part}</span>;
  });
}

/** Renders already-parsed blocks; headings are styled by the caller's choice. */
export function MarkdownBlocks({ blocks }: { blocks: MdBlock[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        if (b.type === 'heading') {
          return (
            <h4 key={i} className="mt-5 font-serif text-[15px] font-semibold text-stone-900 first:mt-0">
              {renderInline(b.text)}
            </h4>
          );
        }
        if (b.type === 'para') {
          return <p key={i} className="mt-3 leading-relaxed first:mt-0">{renderInline(b.text)}</p>;
        }
        if (b.type === 'list') {
          const List = b.ordered ? 'ol' : 'ul';
          return (
            <List
              key={i}
              className={`mt-3 space-y-1.5 pl-5 leading-relaxed marker:text-stone-400 first:mt-0 ${b.ordered ? 'list-decimal' : 'list-disc'}`}
            >
              {b.items.map((it, j) => <li key={j} className="pl-1">{renderInline(it)}</li>)}
            </List>
          );
        }
        return (
          <div key={i} className="mt-3 overflow-x-auto rounded-md border border-stone-200 first:mt-0">
            <table className="w-full border-collapse text-left font-sans text-[13px]">
              <thead className="bg-stone-50">
                <tr>
                  {b.header.map((c, j) => (
                    <th key={j} className="border-b border-stone-200 px-3 py-2 font-semibold text-stone-700">
                      {renderInline(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j} className="border-b border-stone-100 last:border-0">
                    {r.map((c, k) => (
                      <td key={k} className="px-3 py-2 align-top leading-relaxed text-stone-700">{renderInline(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}

export default function Markdown({ text, className = '' }: { text: string; className?: string }) {
  return <div className={className}><MarkdownBlocks blocks={parseMarkdown(text)} /></div>;
}
