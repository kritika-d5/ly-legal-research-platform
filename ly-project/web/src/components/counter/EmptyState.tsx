import Icon from '../Icon';

/**
 * CounterEngine.md §8.6. Given 198 judgments this will happen often, so it is
 * designed deliberately rather than left as a bare "no results."
 *
 * The closing line is not optional — without it, silence reads as
 * endorsement, which is the most dangerous thing a legal tool can imply.
 */
export function EmptyState() {
  return (
    <div className="rounded-lg border border-dashed border-stone-300 bg-stone-50 p-6 text-center">
      <Icon name="scales" size={22} className="mx-auto text-stone-300" />
      <p className="mt-3 text-sm font-medium text-stone-700">
        No strong counterargument found for this position.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-500">
        The corpus covers Supreme Court bail jurisprudence — 198 judgments,
        1912–2022. Your position may fall outside it, or the corpus may
        simply contain no opposing argument on this point.
      </p>
      <p className="mx-auto mt-3 max-w-md text-sm font-medium text-stone-600">
        This is not an indication that your position is unassailable.
      </p>
    </div>
  );
}

/** CounterEngine.md §8.7 — Hard Rule "Bail only," refused explicitly rather
 *  than answered from the model's general knowledge. */
export function OutOfScopeState() {
  return (
    <div className="rounded-lg border border-vermilion-200 bg-vermilion-50 p-6 text-center">
      <Icon name="alert" size={22} className="mx-auto text-vermilion-400" />
      <p className="mt-3 text-sm font-medium text-vermilion-700">
        Counter Engine covers bail only.
      </p>
      <p className="mx-auto mt-2 max-w-md text-sm text-vermilion-700/80">
        This corpus is 198 Supreme Court bail judgments. It holds nothing on
        property, contract, tax or matrimonial law, and answering from
        general knowledge would not be grounded in any source.
      </p>
    </div>
  );
}
