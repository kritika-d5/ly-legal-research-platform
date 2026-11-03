import { useState } from 'react';
import type { Classification, OffenceCategory, Side } from '../../api';

const OFFENCE_LABEL: Record<OffenceCategory, string> = {
  ordinary: 'Ordinary offence',
  economic: 'Economic offence',
  ndps: 'NDPS',
  pmla: 'PMLA',
  uapa: 'UAPA',
  other_special: 'Other special statute',
};

const OFFENCE_OPTIONS = Object.keys(OFFENCE_LABEL) as OffenceCategory[];

interface Props {
  position: string;
  onPositionChange: (v: string) => void;
  side: Side;
  onSideChange: (v: Side) => void;
  onSubmit: () => void;
  submitting: boolean;
  classification: Classification | null;
  onOffenceOverride: (category: OffenceCategory) => void;
}

/**
 * CounterEngine.md §8.1 — one screen, no wizard. The side toggle is the whole
 * reason the feature is symmetric, so it is a prominent radio pair, never a
 * settings checkbox.
 *
 * The offence chip (§4.2) only appears once a classification exists. It is
 * editable rather than a silent guess: a wrong inference here means missing
 * s.37 NDPS / s.45 PMLA / s.43D(5) UAPA entirely, which is most of the
 * anti-bail case in those matters.
 */
export default function PositionForm({
  position, onPositionChange, side, onSideChange, onSubmit, submitting,
  classification, onOffenceOverride,
}: Props) {
  const [editingOffence, setEditingOffence] = useState(false);

  return (
    <div className="rounded-lg border border-stone-200 bg-white p-5">
      <label htmlFor="counter-position" className="text-sm font-medium text-stone-800">
        Describe the position
      </label>
      <textarea
        id="counter-position"
        value={position}
        onChange={(e) => onPositionChange(e.target.value)}
        rows={3}
        maxLength={2000}
        placeholder="e.g. accused in custody 2 years, trial has not commenced, offence punishable up to 7 years"
        className="mt-2 w-full rounded-md border border-stone-300 bg-white p-3 text-sm outline-none
                   focus:border-maroon-400 focus:ring-2 focus:ring-maroon-100"
      />

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <fieldset className="flex items-center gap-4 text-sm">
          <legend className="sr-only">I am</legend>
          <span className="text-stone-500">I am:</span>
          {([['pro_bail', 'Seeking bail'], ['anti_bail', 'Opposing bail']] as const).map(
            ([v, label]) => (
              <label key={v} className="flex cursor-pointer items-center gap-1.5">
                <input
                  type="radio"
                  name="side"
                  checked={side === v}
                  onChange={() => onSideChange(v)}
                  className="accent-maroon-700"
                />
                <span className="text-stone-700">{label}</span>
              </label>
            ),
          )}
        </fieldset>

        <button
          onClick={onSubmit}
          disabled={submitting || position.trim().length < 20}
          className="rounded-md bg-maroon-800 px-5 py-2.5 text-sm font-medium text-white
                     transition-colors hover:bg-maroon-700 disabled:opacity-50"
        >
          {submitting ? 'Running…' : 'Run Counter →'}
        </button>
      </div>

      {classification && (
        <div className="mt-3 flex items-center gap-2 text-xs">
          <span className="text-stone-500">Detected:</span>
          {editingOffence ? (
            <select
              autoFocus
              value={classification.offenceCategory}
              onChange={(e) => {
                onOffenceOverride(e.target.value as OffenceCategory);
                setEditingOffence(false);
              }}
              onBlur={() => setEditingOffence(false)}
              className="rounded border border-stone-300 bg-white px-1.5 py-0.5 text-xs"
            >
              {OFFENCE_OPTIONS.map((o) => (
                <option key={o} value={o}>{OFFENCE_LABEL[o]}</option>
              ))}
            </select>
          ) : (
            <button
              onClick={() => setEditingOffence(true)}
              className="flex items-center gap-1 rounded border border-gold-200 bg-gold-50
                         px-1.5 py-0.5 text-gold-700 hover:border-gold-300"
              title="Click to correct — this drives which restrictive statutes are searched"
            >
              {OFFENCE_LABEL[classification.offenceCategory]} ✎
            </button>
          )}
        </div>
      )}
    </div>
  );
}
