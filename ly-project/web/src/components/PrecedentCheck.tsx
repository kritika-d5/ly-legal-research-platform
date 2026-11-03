/**
 * Precedent check: a warning when later judgments in the library disagreed
 * with this one. Shown to everyone on the case page — relying on a case that
 * was later disapproved is the most expensive mistake this tool can prevent.
 *
 * Uses the `citedBy` list the case page already loads (the polarity on each is
 * how that later judgment treated this one), so it costs no extra request.
 */
import { Link } from 'react-router-dom';
import type { Citation } from '../api';
import { shortCaseTitle } from '../useDocumentTitle';
import Icon from './Icon';

export default function PrecedentCheck({ citedBy }: { citedBy: Citation[] }) {
  const against = citedBy
    .filter((c) => c.polarity === 'neg' || c.polarity === 'mixed')
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0));
  if (against.length === 0) return null;

  return (
    <div role="note" className="mt-4 rounded-md border border-vermilion-200 bg-vermilion-50 px-4 py-3 text-sm text-vermilion-700">
      <p className="flex items-start gap-2 font-medium">
        <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
        Precedent check: {against.length} later judgment{against.length === 1 ? '' : 's'} in this library
        disagreed with this one{against.some((c) => c.polarity === 'mixed') ? ', at least in part' : ''}.
      </p>
      <ul className="mt-1.5 space-y-0.5 pl-6 text-[13px]">
        {against.map((c) => (
          <li key={c.tid}>
            <Link to={`/case/${c.tid}`} className="underline decoration-vermilion-200 underline-offset-4 hover:decoration-vermilion-500">
              {shortCaseTitle(c.title)}
            </Link>{' '}
            ({c.year ?? 'undated'}) — {c.polarity === 'neg' ? 'disagreed' : 'agreed in part, disagreed in part'}
          </li>
        ))}
      </ul>
      <p className="mt-1.5 pl-6 text-xs text-vermilion-700/80">Read them before relying on this case. Within this library only.</p>
    </div>
  );
}
