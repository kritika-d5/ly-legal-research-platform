import { CONTENT_LABEL, TIER_LABEL, type ContentType, type CourtTier, type Speaker } from '../api';
import Icon, { type IconName } from './Icon';

/**
 * The attribution badge. This is not decoration — 2,388 of the corpus's 7,722
 * chunks are text the court reproduced rather than wrote, and a user who reads
 * a quoted statute as a holding has been misinformed about the law.
 */
export function ContentBadge({ type }: { type: ContentType }) {
  const label = CONTENT_LABEL[type];
  return (
    <span
      title={label.full}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${label.tone}`}
    >
      {label.short}
    </span>
  );
}

export function TierBadge({ tier }: { tier: CourtTier }) {
  const label = TIER_LABEL[tier];
  return (
    <span
      title={label.full}
      className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${label.tone}`}
    >
      <Icon name="court" size={11} strokeWidth={1.8} />
      {label.short}
    </span>
  );
}

const POLARITY: Record<string, { label: string; tone: string; title: string }> = {
  pos: {
    label: 'relied on',
    tone: 'bg-sage-50 text-sage-700 border-sage-200',
    title: 'Referred to approvingly. Note this means "relied on", not the technical "followed".',
  },
  neg: {
    label: 'disagreed',
    tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200',
    title: 'The citing court disagreed with or distinguished this case',
  },
  mixed: {
    label: 'mixed',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
    title: 'Agreed in part and disagreed in part — often the most interesting treatment',
  },
  neutral: {
    label: 'mentioned',
    tone: 'bg-stone-100 text-stone-600 border-stone-300',
    title: 'Referred to without endorsing or rejecting it',
  },
};

export function PolarityBadge({ polarity }: { polarity: string | null }) {
  if (!polarity || !POLARITY[polarity]) return null;
  const p = POLARITY[polarity];
  return (
    <span
      title={p.title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] ${p.tone}`}
    >
      {p.label}
    </span>
  );
}

/* ------------------------------------------------------------------------ *
 * Counter Engine badges (CounterEngine.md §8.3). "Every card must show
 * speaker and court tier. This is a correctness requirement, not styling" —
 * an argument rendered without them misattributes it, the exact failure mode
 * ATTRIBUTION exists to prevent for the rest of the app.
 * ------------------------------------------------------------------------ */

const SPEAKER: Record<Speaker, { icon: IconName; title: string }> = {
  'THE COURT': { icon: 'scales', title: "The court's own words, in this or another judgment" },
  COUNSEL: { icon: 'chat', title: "This court's own record of what a party's counsel argued — not a holding" },
  STATUTE: { icon: 'document', title: 'The bare text of a statutory provision' },
  HEADNOTE: { icon: 'summary', title: 'An SCR headnote — written by law reporters, not the court' },
};

export function SpeakerBadge({ speaker }: { speaker: Speaker }) {
  const s = SPEAKER[speaker];
  return (
    <span
      title={s.title}
      className="inline-flex items-center gap-1 rounded border border-stone-200 bg-stone-100
                 px-1.5 py-0.5 text-[11px] font-medium text-stone-600"
    >
      <Icon name={s.icon} size={11} strokeWidth={1.8} />
      {speaker}
    </span>
  );
}

/**
 * v0 CANNOT tell pro-bail from anti-bail reliably (CounterEngine.md §11 —
 * ARGUMENTS.md Stage B, `applicant_seeking_bail`, is unbuilt). This badge is
 * the honest alternative to a guessed stance: it says so, in the same place
 * a stance badge would otherwise go, rather than omitting the signal.
 */
export function SideUndeterminedBadge() {
  return (
    <span
      title="v0 cannot yet determine which side raised this — a wrong guess here would be worse than none"
      className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5
                 text-[11px] text-stone-400"
    >
      side not yet determined
    </span>
  );
}

/**
 * Two rounds retrieved this passage under different speakers — once as the
 * court's reasoning, once as a party's submission — so who is speaking could
 * not be established (eval/citation_faithfulness_results.md, record 6). Shown
 * in place of SpeakerBadge, never beside it: a wrongly confident speaker badge
 * is the exact failure mode ATTRIBUTION exists to prevent.
 */
export function SpeakerUncertainBadge() {
  return (
    <span
      title="Retrieved both as the court's reasoning and as a party's submission — its speaker could not be established, so it is not shown as the court's holding"
      className="inline-flex items-center rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5
                 text-[11px] text-stone-400"
    >
      speaker uncertain
    </span>
  );
}

const OUTCOME: Record<string, { label: string; tone: string; title: string }> = {
  accepted: {
    label: '✓ ACCEPTED',
    tone: 'bg-stone-100 text-stone-500 border-stone-200', // quiet — most arguments are unremarkable
    title: 'The court accepted this argument',
  },
  rejected: {
    label: '✕ REJECTED',
    // The one outcome that must not read as quiet: this is rebuttal ammunition.
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
    title: 'The court rejected this argument — usable as rebuttal, never as support',
  },
  not_addressed: {
    label: '— NOT ADDRESSED',
    tone: 'bg-stone-50 text-stone-400 border-stone-200',
    title: 'The court did not address this argument directly',
  },
  unclear: {
    label: '? UNCLEAR',
    tone: 'bg-stone-50 text-stone-400 border-stone-200',
    title: 'Outcome could not be determined with confidence',
  },
};

/** Not yet populated by v0 (needs ARGUMENTS.md Stage C) — kept ready so the
 *  UI does not change shape when outcome data arrives. */
export function OutcomeBadge({ outcome }: { outcome?: string }) {
  if (!outcome || !OUTCOME[outcome]) return null;
  const o = OUTCOME[outcome];
  return (
    <span
      title={o.title}
      className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium ${o.tone}`}
    >
      {o.label}
    </span>
  );
}

/** "An extra result with no explanation reads as a bug" (GRAPH_RETRIEVAL.md).
 *  Shown on every item the citation graph surfaced rather than a text match. */
export function ViaGraphNote({ becauseOf }: { becauseOf?: { tid: number; title: string; polarity: string }[] }) {
  if (!becauseOf?.length) return null;
  return (
    <p className="flex items-center gap-1.5 text-[11px] text-stone-500">
      <Icon name="network" size={11} className="text-terracotta-400" />
      found via the citation graph — <PolarityBadge polarity={becauseOf[0].polarity} /> treatment of{' '}
      <span className="font-medium text-stone-600">{becauseOf[0].title}</span>, which you are relying on
    </p>
  );
}
