import { useMutation } from '@tanstack/react-query';
import { getSummary } from '../api';
import { ContentBadge } from './Badges';
import Icon, { type IconName } from './Icon';
import { MarkdownBlocks, parseMarkdown, type MdBlock } from './Markdown';

const TONES: Record<string, { rule: string; label: string; icon: IconName }> = {
  issue: { rule: 'border-l-gold-400', label: 'text-gold-700', icon: 'quote' },
  held: { rule: 'border-l-maroon-600', label: 'text-maroon-700', icon: 'gavel' },
  principle: { rule: 'border-l-sage-500', label: 'text-sage-700', icon: 'scales' },
  other: { rule: 'border-l-stone-300', label: 'text-stone-600', icon: 'summary' },
};

/** Splits the summary into one card per heading. The model writes the
 *  sections as `**Issue**` on its own line, `## Issue`, or `- **Issue** — text`
 *  (the prompt's own shape); the last is rewritten into a heading first. */
function sections(summary: string): { title: string | null; blocks: MdBlock[] }[] {
  const normalised = summary.replace(
    /^\s*[-*•]?\s*\*\*(Issue|Held|Principle)\*\*\s*[:—–-]*\s*(.*)$/gim,
    (_, title: string, rest: string) => `## ${title}\n${rest}`,
  );
  const out: { title: string | null; blocks: MdBlock[] }[] = [];
  for (const b of parseMarkdown(normalised)) {
    if (b.type === 'heading') out.push({ title: b.text, blocks: [] });
    else if (out.length) out[out.length - 1].blocks.push(b);
    else out.push({ title: null, blocks: [b] });
  }
  return out;
}

/**
 * Issue / Held / Principle, generated on demand rather than on page load —
 * a summary costs a model call, and most visits to a case page are to read it,
 * not to have it paraphrased.
 */
export default function SummaryPanel({ tid }: { tid: number }) {
  const { mutate, data, isPending, error } = useMutation({
    mutationFn: () => getSummary(tid),
  });

  if (!data && !isPending) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-medium text-stone-900">
          <Icon name="summary" size={16} className="text-gold-500" />
          Generate a structured summary
        </h3>
        <p className="mt-1.5 text-sm text-stone-600">
          Issue, holding, and the principle the case is cited for &mdash; drawn only from the
          court&rsquo;s own words and the reporter&rsquo;s headnote, never from quoted material.
        </p>
        <button
          onClick={() => mutate()}
          className="mt-4 flex items-center gap-2 rounded-md bg-maroon-800 px-4 py-2 text-sm
                     font-medium text-white transition-colors hover:bg-maroon-700"
        >
          <Icon name="summary" size={15} />
          Summarise
        </button>
        {error && (
          <p className="mt-3 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
            {(error as Error).message}
          </p>
        )}
      </div>
    );
  }

  if (isPending) return <p className="text-sm text-stone-500">Reading the judgment&hellip;</p>;

  return (
    <div>
      <div className="space-y-4">
        {sections(data!.summary).map((s, i) => {
          const tone = s.title ? TONES[s.title.toLowerCase()] ?? TONES.other : null;
          return (
            <section
              key={i}
              className={`rounded-lg border border-stone-200 bg-white p-5 ${tone ? `border-l-4 ${tone.rule}` : ''}`}
            >
              {s.title && tone && (
                <h3 className={`mb-2.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide ${tone.label}`}>
                  <Icon name={tone.icon} size={14} />
                  {s.title}
                </h3>
              )}
              <div className="judgment-text text-[15px] text-stone-800">
                <MarkdownBlocks blocks={s.blocks} />
              </div>
            </section>
          );
        })}
      </div>

      <details className="mt-6 rounded-lg border border-stone-200 bg-stone-50 p-3">
        <summary className="cursor-pointer text-xs font-medium text-stone-600">
          Based on {data!.passages.length} passages
        </summary>
        <ol className="mt-3 space-y-3">
          {data!.passages.map((p, i) => (
            <li key={p.id} className="text-[13px]">
              <div className="mb-1 flex items-center gap-2">
                <span className="font-mono text-[11px] text-stone-400">[{i + 1}]</span>
                <ContentBadge type={p.contentType} />
                {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
              </div>
              <p className="judgment-text text-stone-600 line-clamp-3">{p.text}</p>
            </li>
          ))}
        </ol>
      </details>

      <p className="mt-4 text-xs text-stone-500">
        Machine-generated from the judgment text. Verify against the judgment before relying on it.
      </p>
    </div>
  );
}
