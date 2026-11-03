import { Link } from 'react-router-dom';
import type { CounterItem } from '../../api';
import { SpeakerBadge, SpeakerUncertainBadge, TierBadge, ViaGraphNote } from '../Badges';
import Icon from '../Icon';

/**
 * CounterEngine.md §8.4 — "a drawer, never a modal." The user is checking a
 * source against the argument on screen; a modal hides the thing they are
 * checking, which defeats the point of a source drawer entirely.
 */
export default function SourceDrawer({
  item, onClose,
}: {
  item: CounterItem | null;
  onClose: () => void;
}) {
  if (!item) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-40 bg-stone-900/20"
        aria-hidden="true"
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col border-l
                   border-stone-200 bg-white shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-stone-200 px-5 py-4">
          <h2 className="text-sm font-medium text-stone-800">Source</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
            aria-label="Close"
          >
            <Icon name="back" size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-wrap items-center gap-2">
            {item.speakerUncertain ? <SpeakerUncertainBadge /> : <SpeakerBadge speaker={item.speaker} />}
            <TierBadge tier={item.courtTier} />
            {item.locator && <span className="text-xs text-stone-400">{item.locator}</span>}
          </div>

          <p className="mt-3 font-serif text-sm font-medium text-stone-900">{item.caseTitle}</p>
          <p className="text-xs text-stone-500">{item.year || 'undated'}</p>

          <p className="judgment-text mt-4 text-sm leading-relaxed text-stone-700 whitespace-pre-wrap">
            {item.text}
          </p>

          <div className="mt-4">
            <ViaGraphNote becauseOf={item.becauseOf} />
          </div>

          {item.authorities?.length ? (
            <div className="mt-4">
              <p className="text-xs uppercase tracking-wide text-stone-400">Relied on</p>
              <ul className="mt-1 space-y-0.5 text-xs text-stone-600">
                {item.authorities.map((a) => (
                  <li key={a.tid}>{a.title}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="border-t border-stone-200 px-5 py-3">
          <Link
            to={`/case/${item.tid}`}
            className="flex items-center gap-1.5 text-sm font-medium text-maroon-700 hover:underline"
          >
            Open full case
            <Icon name="external" size={13} />
          </Link>
        </div>
      </aside>
    </>
  );
}
