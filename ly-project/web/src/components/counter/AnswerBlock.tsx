import type { ReactNode } from 'react';
import type { CounterItem, CounterSummary, SummaryPoint } from '../../api';
import Icon, { type IconName } from '../Icon';

/**
 * Renders the Stage F research summary (CounterEngine.md §6/§8.2).
 *
 * The server returns the summary as fixed fields (`CounterSummary`), so this
 * is one layout every run: premises table, argument cards, gaps, sources.
 * It used to parse whatever markdown the model wrote, and the page looked
 * different each time — a table on one run, a numbered list the next.
 *
 * Never `dangerouslySetInnerHTML` on LLM output: text fields only get
 * **bold** and *italic*, plus any stray [N] the model wrote despite the
 * prompt, rendered as a citation chip.
 */
interface AnswerBlockProps {
  summary: CounterSummary | null;
  /** Shown as a plain note when there is no summary but the server still
   *  said something (nothing retrieved for this position). */
  fallbackText: string;
  /** Passage N is `sources[N - 1]`; undefined if the id did not resolve. */
  sources: (CounterItem | undefined)[];
  generationFailed: boolean;
  invalidCitations: number[];
  onOpenSource: (item: CounterItem) => void;
}

type Tone = 'sage' | 'vermilion' | 'navy';

const TONE: Record<Tone, { number: string; rule: string }> = {
  sage: { number: 'bg-sage-50 text-sage-700 ring-sage-200', rule: 'border-l-sage-500' },
  vermilion: { number: 'bg-vermilion-50 text-vermilion-700 ring-vermilion-200', rule: 'border-l-vermilion-400' },
  navy: { number: 'bg-navy-50 text-navy-700 ring-navy-200', rule: 'border-l-navy-400' },
};

const INLINE = /(\*\*.+?\*\*|\*[^*\s][^*]*\*|\[\d+(?:\s*[,;]\s*\d+)*\])/g;

export default function AnswerBlock({
  summary: raw, fallbackText, sources, generationFailed, invalidCitations = [], onOpenSource,
}: AnswerBlockProps) {
  // Defaults for every list, so a reply missing a field (an older server
  // still running, say) renders what it has instead of crashing the page.
  const summary: CounterSummary | null = raw && {
    premises: [], weakestPremise: null, yourCase: [], otherSide: [], otherSideNote: '', statutes: [], gaps: [],
    ...(raw as Partial<CounterSummary>),
  };
  if (generationFailed) {
    return (
      <p className="rounded-md border border-gold-200 bg-gold-50 p-3 text-sm text-gold-800">
        The retrieved passages are shown below, but a summary could not be generated this time.
      </p>
    );
  }
  if (!summary) {
    return fallbackText.trim() ? (
      <p className="rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-600">{fallbackText}</p>
    ) : null;
  }

  function Cite({ n }: { n: number | string }) {
    const item = typeof n === 'number' ? sources[n - 1] : undefined;
    const chip = 'mx-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded bg-stone-100 px-1 ' +
      'align-[1px] text-[10px] font-semibold text-stone-600 ring-1 ring-stone-200';
    if (!item) return <span className={chip}>{n}</span>;
    return (
      <button
        type="button"
        onClick={() => onOpenSource(item)}
        title={`Passage ${n}: ${item.caseTitle}${item.locator ? `, ${item.locator}` : ''}`}
        className={`${chip} cursor-pointer hover:bg-maroon-50 hover:text-maroon-700 hover:ring-maroon-200`}
      >
        {n}
      </button>
    );
  }

  function inline(text: string): ReactNode[] {
    return text.split(INLINE).filter(Boolean).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
        return <strong key={i} className="font-semibold text-stone-900">{part.slice(2, -2)}</strong>;
      }
      if (/^\*[^*]/.test(part) && part.endsWith('*') && part.length > 2) {
        return <em key={i}>{part.slice(1, -1)}</em>;
      }
      const cites = /^\[([\d\s,;]+)\]$/.exec(part);
      if (cites) return cites[1].split(/[,;]/).map((n, j) => <Cite key={`${i}-${j}`} n={Number(n.trim())} />);
      return <span key={i}>{part}</span>;
    });
  }

  const evidence = (ns: number[]) =>
    ns.length ? <span className="whitespace-nowrap">{ns.map((n) => <Cite key={n} n={n} />)}</span> : null;

  function Section({ title, icon, children }: { title: string; icon: IconName; children: ReactNode }) {
    return (
      <section className="mt-8 first:mt-0">
        <h3 className="flex items-center gap-2 border-b border-stone-200 pb-2 font-serif text-[15px] font-semibold text-stone-900">
          <Icon name={icon} size={15} className="text-stone-400" />
          {title}
        </h3>
        <div className="mt-4">{children}</div>
      </section>
    );
  }

  function Points({ points, tone, empty }: { points: SummaryPoint[]; tone: Tone; empty: string }) {
    if (!points.length) return <p className="text-sm italic text-stone-500">{empty}</p>;
    return (
      <ol className="space-y-3">
        {points.map((p, i) => (
          <li key={i} className={`flex gap-3 rounded-md border border-l-4 border-stone-200 bg-white p-3.5 ${TONE[tone].rule}`}>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ring-1 ${TONE[tone].number}`}
            >
              {i + 1}
            </span>
            <div className="min-w-0 text-sm leading-relaxed text-stone-700">
              {p.point && <p className="font-semibold text-stone-900">{inline(p.point)}</p>}
              {p.detail && <p className={p.point ? 'mt-1' : ''}>{inline(p.detail)} {evidence(p.evidence)}</p>}
              {!p.detail && evidence(p.evidence)}
            </div>
          </li>
        ))}
      </ol>
    );
  }

  const weakest = summary.weakestPremise;
  const cited = [...new Set([
    ...(weakest?.evidence ?? []),
    ...[...summary.yourCase, ...summary.otherSide, ...summary.statutes].flatMap((p) => p.evidence),
  ])].sort((a, b) => a - b);

  return (
    <div className="space-y-3">
      {invalidCitations.length > 0 && (
        <p className="rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-xs text-vermilion-700">
          This summary referenced a source number that was not part of the retrieved passages
          ({invalidCitations.join(', ')}). Treat the summary with extra care and verify against
          the sources below.
        </p>
      )}
      <article className="rounded-lg border border-stone-200 bg-white p-5 sm:p-6">
        <header className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Research summary</h2>
          <p className="text-[11px] text-stone-400">
            AI-generated from the passages below — click a <Cite n="N" /> to read it; check before relying on it
          </p>
        </header>

        <Section title="Your position" icon="scales">
          {summary.premises.length ? (
            <div className="overflow-x-auto rounded-md border border-stone-200">
              <table className="w-full border-collapse text-left text-[13px]">
                <thead className="bg-stone-50 text-xs uppercase tracking-wide text-stone-500">
                  <tr>
                    <th className="w-12 border-b border-stone-200 px-3 py-2 font-semibold">#</th>
                    <th className="border-b border-stone-200 px-3 py-2 font-semibold">Premise</th>
                    <th className="w-28 border-b border-stone-200 px-3 py-2 text-right font-semibold">Strength</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.premises.map((p, i) => {
                    const isWeakest = weakest?.number === i + 1;
                    return (
                      <tr key={i} className={`border-b border-stone-100 last:border-0 ${isWeakest ? 'bg-gold-50' : ''}`}>
                        <td className="px-3 py-2.5 align-top font-semibold text-stone-500">{i + 1}</td>
                        <td className="px-3 py-2.5 align-top leading-relaxed text-stone-800">{inline(p)}</td>
                        <td className="px-3 py-2.5 text-right align-top">
                          {isWeakest && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-gold-100 px-2 py-0.5 text-[11px] font-semibold text-gold-700 ring-1 ring-gold-300">
                              <Icon name="alert" size={11} />
                              Weakest
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm italic text-stone-500">The position could not be broken into premises.</p>
          )}
          {weakest && (
            <div className="mt-3 rounded-md border border-l-4 border-gold-200 border-l-gold-400 bg-gold-50/60 p-3.5 text-sm leading-relaxed text-stone-700">
              <p className="text-xs font-semibold uppercase tracking-wide text-gold-700">
                Why premise {weakest.number} is the weakest
              </p>
              <p className="mt-1">{inline(weakest.why)} {evidence(weakest.evidence)}</p>
            </div>
          )}
        </Section>

        <Section title="Your case" icon="court">
          <Points points={summary.yourCase} tone="sage" empty="No supporting material was retrieved for this position." />
        </Section>

        <Section title="The other side" icon="gavel">
          <Points
            points={summary.otherSide}
            tone="vermilion"
            empty={summary.otherSideNote || 'Nothing substantive was retrieved against this position.'}
          />
        </Section>

        {summary.statutes.length > 0 && (
          <Section title="Restrictive statutes" icon="document">
            <Points points={summary.statutes} tone="navy" empty="" />
          </Section>
        )}

        {summary.gaps.length > 0 && (
          <Section title="What this corpus does not show" icon="alert">
            <ul className="list-disc space-y-1.5 rounded-md bg-stone-50 py-3 pl-8 pr-4 text-[13px] leading-relaxed text-stone-600 marker:text-stone-400">
              {summary.gaps.map((g, i) => <li key={i}>{inline(g)}</li>)}
            </ul>
          </Section>
        )}

        {cited.length > 0 && (
          <Section title="Sources" icon="cites">
            <ul className="divide-y divide-stone-100 rounded-md border border-stone-200">
              {cited.map((n) => {
                const item = sources[n - 1];
                return (
                  <li key={n} className="flex items-center gap-3 px-3 py-2 text-xs text-stone-600">
                    <Cite n={n} />
                    <span className="min-w-0 flex-1">
                      {item ? (
                        <>
                          <span className="font-medium text-stone-800">{item.caseTitle}</span>
                          {item.year ? ` (${item.year})` : ''}
                          {item.locator && <span className="text-stone-400">, {item.locator}</span>}
                        </>
                      ) : (
                        <span className="italic text-stone-400">passage not found</span>
                      )}
                    </span>
                    {item && (
                      <button
                        type="button"
                        onClick={() => onOpenSource(item)}
                        className="flex shrink-0 items-center gap-1 font-medium text-maroon-700 hover:underline"
                      >
                        view
                        <Icon name="external" size={11} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Section>
        )}
      </article>
    </div>
  );
}
