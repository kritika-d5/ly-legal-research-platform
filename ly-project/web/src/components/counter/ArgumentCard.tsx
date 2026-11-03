import type { CounterItem } from '../../api';
import {
  OutcomeBadge, PolarityBadge, SideUndeterminedBadge, SpeakerBadge, SpeakerUncertainBadge, TierBadge, ViaGraphNote,
} from '../Badges';
import Icon from '../Icon';

/**
 * One card, every round. CounterEngine.md §8.3: speaker and court tier are a
 * correctness requirement on every card, not a styling choice — an argument
 * rendered without them is a bug.
 *
 * Nested `responses` (Round 4, rebuttals) render here when present, but v0
 * never populates them (ARGUMENTS.md Stage C is unbuilt). The block is kept
 * so the card's shape does not change when that round ships.
 */
export default function ArgumentCard({
  item, onOpenSource,
}: {
  item: CounterItem;
  onOpenSource: (item: CounterItem) => void;
}) {
  return (
    <li className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        {item.speakerUncertain ? <SpeakerUncertainBadge /> : <SpeakerBadge speaker={item.speaker} />}
        <OutcomeBadge outcome={item.outcome} />
        {item.stanceUndetermined && <SideUndeterminedBadge />}
        <TierBadge tier={item.courtTier} />
      </div>

      <p className="judgment-text mt-3 text-[13px] leading-relaxed text-stone-700 line-clamp-6">
        {item.text}
      </p>

      {item.authorities?.length ? (
        <p className="mt-2 text-xs text-stone-500">
          relied on: {item.authorities.map((a) => a.title).join(' · ')}
        </p>
      ) : null}

      {item.responses?.length ? (
        <div className="mt-3 space-y-1.5 border-t border-stone-100 pt-3">
          <p className="text-xs font-medium text-stone-600">▾ Your response</p>
          {item.responses.map((r, i) => (
            <p key={i} className="flex items-start gap-1.5 pl-3 text-xs text-stone-600">
              <Icon name="chevronRight" size={11} className="mt-0.5 shrink-0 text-gold-500" />
              <span>
                {r.kind === 'argument_failed'
                  ? 'This argument was rejected in '
                  : 'Their authority was doubted in '}
                <span className="font-medium">{r.caseTitle}</span>
                {r.polarity && <PolarityBadge polarity={r.polarity} />}
                {r.locator && ` — ${r.locator}`}
              </span>
            </p>
          ))}
        </div>
      ) : null}

      {item.viaGraph && (
        <div className="mt-2">
          <ViaGraphNote becauseOf={item.becauseOf} />
        </div>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-stone-100 pt-2.5">
        <p className="text-xs text-stone-500">
          {item.caseTitle}
          {item.year ? ` (${item.year})` : ''}
          {item.locator && <span className="text-stone-400">, {item.locator}</span>}
        </p>
        <button
          onClick={() => onOpenSource(item)}
          className="flex shrink-0 items-center gap-1 text-xs font-medium text-maroon-700 hover:underline"
        >
          view source
          <Icon name="external" size={12} />
        </button>
      </div>
    </li>
  );
}
