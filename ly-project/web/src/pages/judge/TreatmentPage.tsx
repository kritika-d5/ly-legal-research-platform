import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { POLARITY_INFO, getTreatment, type Polarity, type Treatment } from '../../api/judge';
import { TierBadge } from '../../components/Badges';
import CasePicker from '../../components/CasePicker';
import Icon from '../../components/Icon';
import DeskNav from '../../components/DeskNav';
import SaveButton from '../../components/SaveButton';
import { shortCaseTitle, useDocumentTitle } from '../../useDocumentTitle';

const ORDER: Polarity[] = ['pos', 'mixed', 'neg', 'neutral', 'unknown'];

/**
 * How a judgment has been treated by later judgments in this library, in date
 * order: relied on, disagreed with, or mixed. The labels come from Indian
 * Kanoon's citation data (see Badges.tsx for what "relied on" does and does
 * not mean).
 */
export default function TreatmentPage() {
  const { tid: tidParam } = useParams();
  const tid = Number(tidParam) || null;
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['judge', 'treatment', tid],
    queryFn: () => getTreatment(tid!),
    enabled: tid !== null,
  });
  useDocumentTitle(data ? `Treatment · ${shortCaseTitle(data.case.title)}` : 'Treatment timeline');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <DeskNav desk="judge" />
      <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-maroon-800">Treatment timeline</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Every later judgment in this library that cites a case, in date order, and whether it relied
        on it, disagreed with it, or both.
      </p>

      <div className="mt-6 max-w-xl">
        <CasePicker label="Judgment" tid={tid} onChange={(t) => navigate(t ? `/judge/treatment/${t}` : '/judge/treatment')} />
      </div>

      {isLoading && <p className="mt-6 text-sm text-stone-500">Loading…</p>}
      {error && <p className="mt-6 text-sm text-vermilion-700">{(error as Error).message}</p>}
      {data && <TreatmentView data={data} />}
    </div>
  );
}

function TreatmentView({ data }: { data: Treatment }) {
  const total = data.timeline.length;
  const troubled = data.summary.neg + data.summary.mixed;

  return (
    <>
      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link to={`/case/${data.case.tid}`} className="font-medium text-stone-900 underline-offset-4 hover:underline">
              {data.case.title}
            </Link>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-stone-500">
              <TierBadge tier={data.case.courtTier} />
              <span>{data.case.court}</span>
              <span>cites {data.citesCount} earlier judgment{data.citesCount === 1 ? '' : 's'} in the library</span>
            </div>
          </div>
          <SaveButton tid={data.case.tid} compact />
        </div>

        {total > 0 && (
          <>
            {/* One bar, one segment per treatment — proportions at a glance. */}
            <div className="mt-5 flex h-2.5 overflow-hidden rounded-full bg-stone-100" role="img" aria-label="Share of each treatment">
              {ORDER.map((p) =>
                data.summary[p] ? (
                  <div key={p} className={POLARITY_INFO[p].dot} style={{ width: `${(data.summary[p] / total) * 100}%` }} />
                ) : null,
              )}
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-600">
              {ORDER.filter((p) => data.summary[p]).map((p) => (
                <li key={p} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${POLARITY_INFO[p].dot}`} />
                  {POLARITY_INFO[p].label}: <span className="font-medium text-stone-800">{data.summary[p]}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {troubled > 0 && (
          <p className="mt-4 flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 p-3 text-sm text-gold-700">
            <Icon name="alert" size={15} className="mt-0.5" />
            {troubled} later judgment{troubled === 1 ? '' : 's'} in this library disagreed with it at least in part.
            Read {troubled === 1 ? 'it' : 'them'} before relying on this case.
          </p>
        )}
      </section>

      {total === 0 ? (
        <p className="mt-6 rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
          No later judgment in this library cites this case. That says nothing about how courts outside
          the library have treated it.
        </p>
      ) : (
        <ol className="relative mt-6 space-y-4 border-l-2 border-stone-200 pl-6">
          {data.timeline.map((t) => {
            const info = POLARITY_INFO[t.polarity];
            return (
              <li key={t.tid} className="relative">
                <span className={`absolute -left-[31px] top-4 h-3 w-3 rounded-full ring-4 ring-stone-50 ${info.dot}`} aria-hidden="true" />
                <div className="rounded-lg border border-stone-200 bg-white p-4">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="font-serif text-base font-semibold text-stone-900">{t.year ?? '—'}</span>
                    <span className={`rounded border px-1.5 py-0.5 font-medium ${info.tone}`}>{info.label}</span>
                    <TierBadge tier={t.courtTier} />
                  </div>
                  <Link to={`/case/${t.tid}`} className="mt-1.5 block text-sm font-medium text-stone-900 underline-offset-4 hover:underline">
                    {shortCaseTitle(t.title)}
                  </Link>
                  {t.polarityCounts && t.polarity === 'mixed' && (
                    <p className="mt-1 text-xs text-stone-500">
                      References: {t.polarityCounts.pos} approving, {t.polarityCounts.neg} disapproving
                      {t.polarityCounts.neutral ? `, ${t.polarityCounts.neutral} neutral` : ''}.
                    </p>
                  )}
                  <Link
                    to={`/judge/treatment/${t.tid}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs text-maroon-700 hover:underline"
                  >
                    <Icon name="network" size={12} /> Its own treatment
                  </Link>
                </div>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-6 text-xs text-stone-500">
        Within this library of 198 bail judgments only. Treatment labels come from Indian Kanoon’s
        citation data: “relied on” means referred to approvingly, not necessarily “followed” in the
        technical sense.
      </p>
    </>
  );
}
