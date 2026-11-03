import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { runCounter, type CounterItem, type CounterResponse, type OffenceCategory, type Side } from '../api';
import AnswerBlock from '../components/counter/AnswerBlock';
import ArgumentCard from '../components/counter/ArgumentCard';
import { EmptyState, OutOfScopeState } from '../components/counter/EmptyState';
import PositionForm from '../components/counter/PositionForm';
import SourceDrawer from '../components/counter/SourceDrawer';
import Icon from '../components/Icon';
import { useDocumentTitle } from '../useDocumentTitle';

/**
 * CounterEngine.md — v0. Plain JSON (build order step 2); SSE streaming is a
 * later step. See §2 for why this is its own page rather than a CasePage tab:
 * this feature spans the corpus, and CasePage's whole attribution guarantee
 * depends on every passage coming from the one judgment on screen.
 */
export default function CounterPage() {
  useDocumentTitle('Counter Engine');

  const [position, setPosition] = useState('');
  const [side, setSide] = useState<Side>('pro_bail');
  const [offenceOverride, setOffenceOverride] = useState<OffenceCategory | undefined>();
  const [sourceItem, setSourceItem] = useState<CounterItem | null>(null);

  const mutation = useMutation<CounterResponse, Error, void>({
    mutationFn: () => runCounter({ position, side, offenceCategory: offenceOverride }),
  });

  const run = () => {
    if (position.trim().length < 20) return;
    mutation.mutate();
  };

  const onOffenceOverride = (category: OffenceCategory) => {
    setOffenceOverride(category);
    // §4.2: "re-run on edit" — a corrected offence category changes which
    // restrictive statutes Round 5 searches for, so it must not sit unused.
    mutation.mutate();
  };

  const result = mutation.data;
  const supporting = result?.rounds.find((r) => r.round === 'supporting');
  const opposing = result?.rounds.find((r) => r.round === 'opposing');
  const statutes = result?.rounds.find((r) => r.round === 'statutes');

  return (
    <div className="mx-auto max-w-4xl px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-stone-900">
        Counter Engine
      </h1>
      <p className="mt-2 text-sm text-stone-600">
        Test a position against the corpus — Supreme Court bail jurisprudence
        only, 198 judgments, 1912–2022. Research aid, not legal advice.
      </p>

      <div className="mt-6">
        <PositionForm
          position={position}
          onPositionChange={setPosition}
          side={side}
          onSideChange={setSide}
          onSubmit={run}
          submitting={mutation.isPending}
          classification={result?.classification ?? null}
          onOffenceOverride={onOffenceOverride}
        />
      </div>

      {mutation.isPending && (
        <p className="mt-6 text-sm text-stone-500">Running Counter Engine&hellip;</p>
      )}

      {mutation.isError && (
        <p className="mt-6 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {mutation.error.message}
        </p>
      )}

      {result?.classification.classificationFailed && (
        <p className="mt-6 flex items-center gap-2 rounded-md border border-gold-200 bg-gold-50 p-3 text-sm text-gold-800">
          <Icon name="alert" size={14} className="shrink-0 text-gold-600" />
          Couldn&rsquo;t verify this question is within scope — showing bail results anyway.
        </p>
      )}

      {result && !result.classification.inScope && (
        <div className="mt-8">
          <OutOfScopeState />
        </div>
      )}

      {result && result.classification.inScope && (
        <div className="mt-8 space-y-10">
          <section>
            <AnswerBlock
              summary={result.summary ?? null}
              fallbackText={result.answer ?? ''}
              sources={(result.sourceIds ?? []).map((id) => result.rounds.flatMap((r) => r.items).find((it) => it.id === id))}
              generationFailed={result.generationFailed}
              invalidCitations={result.invalidCitations}
              onOpenSource={setSourceItem}
            />
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              Your case
            </h2>
            <div className="mt-1 h-px bg-stone-200" />
            {supporting && !supporting.empty ? (
              <ul className="mt-4 space-y-3">
                {supporting.items.map((item) => (
                  <ArgumentCard key={item.id} item={item} onOpenSource={setSourceItem} />
                ))}
              </ul>
            ) : (
              <p className="mt-4 text-sm text-stone-500">
                No supporting law found in the corpus for this position.
              </p>
            )}
          </section>

          <section>
            <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
              The other side
            </h2>
            <div className="mt-1 h-px bg-stone-200" />
            {opposing && !opposing.empty ? (
              <ul className="mt-4 space-y-3">
                {opposing.items.map((item) => (
                  <ArgumentCard key={item.id} item={item} onOpenSource={setSourceItem} />
                ))}
              </ul>
            ) : (
              <div className="mt-4">
                <EmptyState />
              </div>
            )}
          </section>

          {statutes && !statutes.empty && (
            <section>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-stone-500">
                Restrictive statutes
              </h2>
              <div className="mt-1 h-px bg-stone-200" />
              <ul className="mt-4 space-y-3">
                {statutes.items.map((item) => (
                  <ArgumentCard key={item.id} item={item} onOpenSource={setSourceItem} />
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <SourceDrawer item={sourceItem} onClose={() => setSourceItem(null)} />
    </div>
  );
}
