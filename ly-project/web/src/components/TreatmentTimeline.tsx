import { Link } from 'react-router-dom';
import type { Citation } from '../api';
import { KanoonSourceNote } from './Attribution';
import { PolarityBadge } from './Badges';
import Icon from './Icon';

/**
 * How later judgments in the corpus treated this one, laid out by year.
 *
 * Built from the same `citedBy` list as the side panel — no new data, just a
 * view over time. Two honesty constraints shape it:
 *  - Only citations between the 198 corpus judgments exist here. The most-cited
 *    case has 10, so a "trend" is a handful of points, and the copy says so.
 *  - A citation with no treatment label is shown as "not recorded" (a hollow
 *    dot), never folded into "relied on" — absence of a label is not approval.
 */

const DOT: Record<string, { fill: string; label: string }> = {
  pos: { fill: 'bg-sage-500 border-sage-500', label: 'relied on' },
  mixed: { fill: 'bg-gold-500 border-gold-500', label: 'mixed' },
  neg: { fill: 'bg-vermilion-500 border-vermilion-500', label: 'disagreed' },
  neutral: { fill: 'bg-stone-400 border-stone-400', label: 'mentioned' },
  none: { fill: 'bg-white border-stone-400', label: 'not recorded' },
};
const ORDER = ['pos', 'mixed', 'neg', 'neutral', 'none'];
const keyOf = (c: Citation) => (c.polarity && DOT[c.polarity] ? c.polarity : 'none');

const DOT_PX = 12;
const STACK_GAP = 4;

export default function TreatmentTimeline({
  citedBy, caseYear, caseTitle,
}: {
  citedBy: Citation[];
  caseYear: number | null;
  caseTitle: string;
}) {
  const dated = citedBy.filter((c) => c.year).sort((a, b) => a.year! - b.year! || a.title.localeCompare(b.title));
  const undated = citedBy.filter((c) => !c.year);

  if (citedBy.length === 0) {
    return (
      <div className="rounded-lg border border-stone-200 bg-white p-6 text-sm text-stone-600">
        <p className="font-medium text-stone-800">No later judgment in this corpus cites this case yet.</p>
        <p className="mt-1.5 text-stone-500">
          The timeline only covers citations between the 198 judgments here, not every Indian court.
        </p>
      </div>
    );
  }

  const counts = Object.fromEntries(ORDER.map((k) => [k, citedBy.filter((c) => keyOf(c) === k).length]));
  const years = dated.map((c) => c.year!);
  const start = Math.min(caseYear ?? years[0], years[0]);
  const end = Math.max(years[years.length - 1], start + 1);
  const pos = (y: number) => ((y - start) / (end - start)) * 100;

  // Stack same-year citations vertically instead of overlapping them.
  const perYear = new Map<number, number>();
  const placed = dated.map((c) => {
    const k = perYear.get(c.year!) ?? 0;
    perYear.set(c.year!, k + 1);
    return { c, stack: k };
  });
  const maxStack = Math.max(...perYear.values());
  const chartHeight = 28 + maxStack * (DOT_PX + STACK_GAP);

  const tickCount = Math.min(6, end - start + 1);
  const ticks = [...new Set(Array.from({ length: tickCount }, (_, i) =>
    Math.round(start + (i * (end - start)) / Math.max(1, tickCount - 1))))];

  const firstOf = (k: string) => dated.find((c) => keyOf(c) === k);
  const firstDoubt = firstOf('neg') ?? firstOf('mixed');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="font-serif text-[15px] font-semibold text-stone-900">How later judgments treated this case</h2>
        <p className="mt-1 text-xs text-stone-500">
          {citedBy.length} later judgment{citedBy.length === 1 ? '' : 's'} in this corpus cite{citedBy.length === 1 ? 's' : ''}{' '}
          <span className="text-stone-700">{caseTitle.split(' on ')[0]}</span>
          {dated.length
            ? years[0] === years[years.length - 1] ? `, in ${years[0]}` : `, from ${years[0]} to ${years[years.length - 1]}`
            : ''}.
          {citedBy.length === 1
            ? ''
            : firstDoubt
              ? ` First ${keyOf(firstDoubt) === 'neg' ? 'disagreement' : 'mixed treatment'}: ${firstDoubt.year}.`
              : ' None of them disagreed with it.'}
        </p>
        {citedBy.length === 1 && (
          <p className="mt-1 text-xs text-stone-400">
            With a single later citation there is no trend to read yet — most cases in this corpus were reached
            through one citing judgment, so this is the common case, not an error.
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-stone-600">
        {ORDER.filter((k) => counts[k] > 0).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className={`inline-block h-2.5 w-2.5 rounded-full border ${DOT[k].fill}`} />
            {DOT[k].label} <span className="tabular-nums text-stone-400">{counts[k]}</span>
          </span>
        ))}
      </div>

      {dated.length > 0 && (
        <div className="rounded-lg border border-stone-200 bg-white px-6 pb-3 pt-4">
          <div className="relative" style={{ height: chartHeight }}>
            {caseYear && (
              <div className="absolute bottom-[18px] top-0 border-l border-dashed border-stone-300" style={{ left: `${pos(caseYear)}%` }}>
                <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[10px] text-stone-400">decided {caseYear}</span>
              </div>
            )}
            <div className="absolute inset-x-0 bottom-[18px] border-t border-stone-300" />
            {placed.map(({ c, stack }) => (
              <Link
                key={`${c.tid}-${stack}`}
                to={`/case/${c.tid}`}
                title={`${c.title} (${c.year}) — ${DOT[keyOf(c)].label}`}
                className={`absolute -translate-x-1/2 rounded-full border-2 transition-transform hover:scale-125 ${DOT[keyOf(c)].fill}`}
                style={{
                  left: `${pos(c.year!)}%`,
                  bottom: 18 + 4 + stack * (DOT_PX + STACK_GAP),
                  width: DOT_PX, height: DOT_PX,
                }}
              />
            ))}
            {ticks.map((y) => (
              <span
                key={y}
                className="absolute bottom-0 -translate-x-1/2 text-[10px] tabular-nums text-stone-400"
                style={{ left: `${pos(y)}%` }}
              >
                {y}
              </span>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-stone-400">Each dot is one later judgment. Hover for its name; click to open it.</p>
        </div>
      )}

      <ol className="divide-y divide-stone-100 rounded-lg border border-stone-200 bg-white">
        {[...dated, ...undated].map((c, i) => (
          <li key={`${c.tid}-${i}`} className="flex items-start gap-4 px-4 py-2.5">
            <span className="w-10 shrink-0 pt-px text-xs tabular-nums text-stone-400">{c.year ?? '—'}</span>
            <div className="min-w-0 flex-1">
              <Link to={`/case/${c.tid}`} className="text-[13px] leading-snug text-stone-700 underline-offset-4 hover:underline">
                {c.title}
              </Link>
              {c.courtTier !== 'SC' && <span className="ml-2 text-[11px] text-stone-400">{c.courtTier}</span>}
            </div>
            <span className="shrink-0">
              {c.polarity && DOT[c.polarity]
                ? <PolarityBadge polarity={c.polarity} />
                : <span className="text-[11px] text-stone-400">not recorded</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="space-y-2 text-[11px] leading-relaxed text-stone-400">
        <p className="flex items-start gap-1.5">
          <Icon name="alert" size={12} className="mt-0.5 shrink-0" />
          Only citations between the 198 judgments in this corpus are shown, not every Indian court.
          Treatment labels come from citation sentiment and have not been checked by a lawyer;
          &ldquo;relied on&rdquo; does not mean the technical &ldquo;followed&rdquo;.
        </p>
        <KanoonSourceNote what="Citations and treatment labels" />
      </div>
    </div>
  );
}
