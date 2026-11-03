import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import {
  analyseBail,
  getCachedBailAnalysis,
  OUTCOME_LABEL,
  type BailAnalysis,
  type BailAnalysisResponse,
} from '../api';
import { ContentBadge } from './Badges';
import Icon from './Icon';

const WEIGHED = {
  for_accused: { label: 'Favoured the accused', tone: 'bg-sage-50 text-sage-700 border-sage-200' },
  against_accused: {
    label: 'Weighed against the accused',
    tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200',
  },
  neutral: { label: 'Considered', tone: 'bg-stone-100 text-stone-600 border-stone-300' },
} as const;

const BAIL_TYPE: Record<string, string> = {
  regular: 'Regular bail',
  anticipatory: 'Anticipatory bail',
  interim: 'Interim bail',
  default: 'Default bail',
  cancellation: 'Cancellation of bail',
  suspension_of_sentence: 'Suspension of sentence',
  other: 'Other bail relief',
};

/**
 * Bail outcome & judgment analysis: was bail granted or refused, why, which
 * factors the court weighed, and the paragraphs each of those rests on.
 *
 * Generated on demand like the summary — it costs a model call. Once made it
 * is cached server-side, so the outcome is shown on the next visit without one.
 */
export default function BailAnalysisPanel({ tid }: { tid: number }) {
  const queryClient = useQueryClient();
  const cached = useQuery({
    queryKey: ['bail', tid],
    queryFn: () => getCachedBailAnalysis(tid),
  });
  const { mutate, isPending, error } = useMutation({
    mutationFn: (refresh: boolean) => analyseBail(tid, refresh),
    onSuccess: (data) => queryClient.setQueryData(['bail', tid], data),
  });
  const data = cached.data;

  if (cached.isLoading) return <p className="text-sm text-stone-500">Loading&hellip;</p>;
  if (isPending) {
    return <p className="text-sm text-stone-500">Reading the operative order and the court&rsquo;s reasons&hellip;</p>;
  }

  if (!data) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-5">
        <h3 className="flex items-center gap-2 text-sm font-medium text-stone-900">
          <Icon name="gavel" size={16} className="text-gold-500" />
          Analyse the bail outcome
        </h3>
        <p className="mt-1.5 text-sm text-stone-600">
          Whether bail was granted or rejected, the reasons behind the decision, the factors the
          court weighed, and the paragraphs each conclusion rests on. The outcome is read from the
          judgment&rsquo;s closing order and headnote &mdash; never from a case it quotes.
        </p>
        <button
          onClick={() => mutate(false)}
          className="mt-4 flex items-center gap-2 rounded-md bg-maroon-800 px-4 py-2 text-sm
                     font-medium text-white transition-colors hover:bg-maroon-700"
        >
          <Icon name="gavel" size={15} />
          Analyse outcome
        </button>
        {error && <ErrorNote message={(error as Error).message} />}
      </div>
    );
  }

  return <AnalysisView data={data} onRefresh={() => mutate(true)} error={error as Error | null} />;
}

function AnalysisView({
  data,
  onRefresh,
  error,
}: {
  data: BailAnalysisResponse;
  onRefresh: () => void;
  error: Error | null;
}) {
  const { analysis: a, passages } = data;
  const [highlight, setHighlight] = useState<number | null>(null);
  const outcome = OUTCOME_LABEL[a.outcome];

  const jump = (n: number) => {
    setHighlight(n);
    document.getElementById(`bail-passage-${n}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const cite = (ns: number[]) => <EvidenceChips ns={ns} onJump={jump} />;

  const citedBy = citationIndex(a);
  const cited = passages.map((p, i) => ({ p, n: i + 1 })).filter(({ n }) => citedBy.has(n));
  const uncited = passages.map((p, i) => ({ p, n: i + 1 })).filter(({ n }) => !citedBy.has(n));

  return (
    <div className="space-y-8">
      {/* Outcome */}
      <section className={`rounded-lg border p-5 ${outcome.banner}`}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Icon name="gavel" size={22} />
          <h3 className="text-xl font-semibold tracking-tight">{outcome.short}</h3>
          {BAIL_TYPE[a.bailType] && (
            <span className="rounded border border-current/30 px-1.5 py-0.5 text-[11px] font-medium">
              {BAIL_TYPE[a.bailType]}
            </span>
          )}
          <span className="ml-auto text-[11px] uppercase tracking-wide opacity-75">
            {a.confidence} confidence
          </span>
        </div>
        {a.outcomeStatement && (
          <p className="mt-3 text-[15px] leading-relaxed text-stone-800">{a.outcomeStatement}</p>
        )}
        {a.outcomeEvidence.length > 0 && (
          <div className="mt-3 flex items-center gap-2 text-xs text-stone-600">
            Supported by {cite(a.outcomeEvidence)}
            {a.outcomeEvidenceMatched && (
              <span className="text-stone-500">&mdash; the closing order, located by its wording</span>
            )}
          </div>
        )}
        {a.evidenceWarning && (
          <p className="mt-3 flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 px-3 py-2 text-xs text-gold-700">
            <Icon name="alert" size={14} className="mt-px shrink-0" />
            {a.evidenceWarning}
          </p>
        )}
      </section>

      {/* Structured summary */}
      <section>
        <SectionHeading icon="summary">Judgment summary</SectionHeading>
        <dl className="mt-3 grid gap-4 sm:grid-cols-2">
          {(
            [
              ['Background', a.summary.background],
              ['Issue', a.summary.issue],
              ['Decision', a.summary.decision],
              ['Principle', a.summary.principle],
            ] as const
          ).map(([label, text]) => (
            <div key={label} className="rounded-lg border border-stone-200 bg-white p-4">
              <dt className="text-[11px] font-medium uppercase tracking-wide text-stone-400">{label}</dt>
              <dd className="judgment-text mt-1 text-[14px] text-stone-800">{text || '—'}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Reasons */}
      {a.reasons.length > 0 && (
        <section>
          <SectionHeading icon="quote">Why the court decided this</SectionHeading>
          <ol className="mt-3 space-y-2.5">
            {a.reasons.map((r, i) => (
              <li key={i} className="flex gap-3 text-[14px] leading-relaxed text-stone-800">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-maroon-50 text-[11px] font-medium text-maroon-700">
                  {i + 1}
                </span>
                <span>
                  {r.reason} {cite(r.evidence)}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Factors */}
      <section>
        <SectionHeading icon="court">Factors the court weighed</SectionHeading>
        {a.factors.length === 0 ? (
          <p className="mt-2 text-sm text-stone-500">
            No specific bail factors are discussed in the passages that were read.
          </p>
        ) : (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {a.factors.map((f, i) => (
              <div key={i} className="rounded-lg border border-stone-200 bg-white p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h4 className="text-sm font-medium text-stone-900">{f.label}</h4>
                  <span className={`rounded border px-1.5 py-0.5 text-[11px] ${WEIGHED[f.weighed].tone}`}>
                    {WEIGHED[f.weighed].label}
                  </span>
                </div>
                <p className="mt-1.5 text-[13px] leading-relaxed text-stone-600">{f.explanation}</p>
                {f.evidence.length > 0 && (
                  <div className="mt-2">
                    {cite(f.evidence)}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Conditions */}
      {a.conditions.length > 0 && (
        <section>
          <SectionHeading icon="pin">Conditions imposed</SectionHeading>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-[14px] text-stone-800">
            {a.conditions.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Supporting paragraphs */}
      <section>
        <SectionHeading icon="text">Supporting paragraphs</SectionHeading>
        <p className="mt-1 text-xs text-stone-500">
          The passages the conclusions above are drawn from, in the order they appear in the
          judgment.
        </p>
        <ol className="mt-3 space-y-4">
          {cited.map(({ p, n }) => (
            <li
              key={p.id}
              id={`bail-passage-${n}`}
              className={`scroll-mt-24 rounded-lg border p-4 transition-colors ${
                highlight === n ? 'border-gold-300 bg-gold-50' : 'border-stone-200 bg-white'
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <span className="font-mono text-[11px] text-stone-400">[{n}]</span>
                <ContentBadge type={p.contentType} />
                {p.closing && (
                  <span
                    title="One of the last passages of the judgment, where the order is made"
                    className="rounded border border-maroon-200 bg-maroon-50 px-1.5 py-0.5 text-[11px] font-medium text-maroon-700"
                  >
                    Closing order
                  </span>
                )}
                {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
                <span className="ml-auto flex flex-wrap gap-1">
                  {citedBy.get(n)!.map((use) => (
                    <span key={use} className="rounded bg-stone-100 px-1.5 py-0.5 text-[10px] text-stone-600">
                      {use}
                    </span>
                  ))}
                </span>
              </div>
              <p className="judgment-text whitespace-pre-wrap text-[14px] text-stone-800">{p.text}</p>
            </li>
          ))}
        </ol>
        {uncited.length > 0 && (
          <details className="mt-4 rounded-lg border border-stone-200 bg-stone-50 p-3">
            <summary className="cursor-pointer text-xs font-medium text-stone-600">
              {uncited.length} more passage{uncited.length === 1 ? '' : 's'} read but not cited
            </summary>
            <ol className="mt-3 space-y-3">
              {uncited.map(({ p, n }) => (
                <li key={p.id} id={`bail-passage-${n}`} className="text-[13px]">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="font-mono text-[11px] text-stone-400">[{n}]</span>
                    <ContentBadge type={p.contentType} />
                    {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
                  </div>
                  <p className="judgment-text line-clamp-3 text-stone-600">{p.text}</p>
                </li>
              ))}
            </ol>
          </details>
        )}
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-4 text-xs text-stone-500">
        <span>
          Machine-generated from {passages.length} passages of the judgment. Verify against the
          judgment before relying on it.
        </span>
        <button
          onClick={onRefresh}
          className="rounded-md border border-stone-300 px-3 py-1.5 text-stone-600 transition-colors hover:border-maroon-700 hover:text-maroon-700"
        >
          Re-run analysis
        </button>
      </div>
      {error && <ErrorNote message={error.message} />}
    </div>
  );
}

/** passage number -> what cites it ("Outcome", "Reason 2", "Parity"). */
function citationIndex(a: BailAnalysis): Map<number, string[]> {
  const index = new Map<number, string[]>();
  const add = (ns: number[], use: string) =>
    ns.forEach((n) => index.set(n, [...(index.get(n) ?? []), use]));
  add(a.outcomeEvidence, 'Outcome');
  a.reasons.forEach((r, i) => add(r.evidence, `Reason ${i + 1}`));
  a.factors.forEach((f) => add(f.evidence, f.label));
  return index;
}

function EvidenceChips({ ns, onJump }: { ns: number[]; onJump: (n: number) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-baseline">
      {ns.map((n) => (
        <button
          key={n}
          onClick={() => onJump(n)}
          title={`Show passage ${n}`}
          className="rounded border border-stone-300 bg-white px-1 font-mono text-[11px] text-stone-600
                     transition-colors hover:border-maroon-700 hover:text-maroon-700"
        >
          [{n}]
        </button>
      ))}
    </span>
  );
}

function SectionHeading({ icon, children }: { icon: 'summary' | 'quote' | 'court' | 'pin' | 'text'; children: React.ReactNode }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-500">
      <Icon name={icon} size={13} className="text-terracotta-400" />
      {children}
    </h3>
  );
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="mt-3 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
      {message}
    </p>
  );
}
