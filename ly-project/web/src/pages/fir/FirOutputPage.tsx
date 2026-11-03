import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { accusedLabel, getFirCaseState } from '../../api/fir';
import FirRelatedJudgments from '../../components/FirRelatedJudgments';
import Icon from '../../components/Icon';
import LegalAidCard from '../../components/LegalAidCard';
import { useDocumentTitle } from '../../useDocumentTitle';

/**
 * FIR Output page.
 *
 * Displays the finalized FIR-related output using the actual CaseState
 * returned by the backend. Provides a clean human-readable presentation
 * and a structured JSON view. Does NOT add facts not present in CaseState.
 */
export default function FirOutputPage() {
  const { caseId } = useParams<{ caseId: string }>();
  useDocumentTitle('FIR Output');
  const [showJson, setShowJson] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['fir-state', caseId],
    queryFn: () => getFirCaseState(caseId!),
    enabled: !!caseId,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-stone-500">
        Loading case output…
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <p className="rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {(error as Error).message}
        </p>
        <Link to="/fir" className="mt-4 inline-block text-sm text-maroon-700 hover:underline">
          Back to FIR Assistant
        </Link>
      </div>
    );
  }

  if (!data) return null;

  const state = data.case_state;

  function downloadJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${state.case_id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs text-stone-400 mb-4">
        <Link to="/fir" className="hover:text-maroon-700 transition-colors">FIR Assistant</Link>
        <Icon name="chevronRight" size={12} />
        <Link to={`/fir/case/${caseId}`} className="hover:text-maroon-700 transition-colors">
          Case {caseId}
        </Link>
        <Icon name="chevronRight" size={12} />
        <span>Output</span>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">
            FIR Case Output
          </h1>
          <p className="mt-1 text-sm text-stone-600">
            The finalized case record. This is the structured output that can be passed to
            downstream legal analysis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowJson(!showJson)}
            className="inline-flex items-center gap-1.5 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:border-stone-400"
          >
            <Icon name="document" size={13} />
            {showJson ? 'Human readable' : 'JSON'}
          </button>
          <button
            onClick={downloadJson}
            className="inline-flex items-center gap-1.5 rounded-md bg-maroon-800 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-maroon-700"
          >
            <Icon name="external" size={13} />
            Download JSON
          </button>
        </div>
      </div>

      {/* Status banner */}
      <div className="mb-6 rounded-lg border border-sage-200 bg-sage-50 p-4">
        <p className="flex items-center gap-2 text-sm text-sage-700">
          <Icon name="summary" size={15} />
          <span>
            Case <strong>{state.case_id}</strong> —{' '}
            <span className="capitalize">{state.status.replace('_', ' ')}</span>
            {state.user_confirmed && ' · Confirmed by user'}
          </span>
        </p>
      </div>

      {showJson ? (
        /* JSON view */
        <div className="rounded-lg border border-stone-200 bg-stone-900 p-4 overflow-x-auto">
          <pre className="text-xs text-stone-100 font-mono leading-relaxed whitespace-pre">
            {JSON.stringify(state, null, 2)}
          </pre>
        </div>
      ) : (
        /* Human readable view */
        <div className="space-y-6">
          {/* Incident */}
          <OutputSection title="Incident">
            <OutputRow label="Description" value={state.incident.description.value} />
            <OutputRow label="Date" value={state.incident.date.value} />
            <OutputRow label="Time" value={state.incident.time.value} />
            <OutputRow label="Location" value={state.incident.location.value} />
            <OutputRow label="Location details" value={state.incident.location_details.value} />
          </OutputSection>

          {/* People */}
          <OutputSection title="People">
            <OutputRow label="Complainant" value={state.complainant.name.value} />
            {state.complainant_is_victim.value === false && (
              <OutputRow label="Victim" value={state.victim.name.value} />
            )}
            {state.accused.map((a) => (
              <OutputRow
                key={a.accused_id}
                label={`Accused: ${accusedLabel(a)}`}
                value={a.description.value || a.alias.value || 'No description'}
              />
            ))}
          </OutputSection>

          {/* Acts */}
          {state.acts.length > 0 && (
            <OutputSection title="Acts">
              {state.acts.map((act) => (
                <div key={act.act_id} className="text-xs mb-1">
                  <span className="font-medium text-stone-700 capitalize">
                    {act.type.replace('_', ' ')}
                  </span>
                  <span className="text-stone-500"> — {act.description}</span>
                </div>
              ))}
            </OutputSection>
          )}

          {/* Injuries */}
          {state.injuries.length > 0 && (
            <OutputSection title="Injuries">
              {state.injuries.map((inj) => (
                <div key={inj.injury_id} className="text-xs mb-2">
                  <span className="font-medium text-stone-700">
                    {inj.type.value || 'Unspecified injury'}
                  </span>
                  {inj.body_part.value && (
                    <span className="text-stone-500"> on {inj.body_part.value}</span>
                  )}
                  {inj.treatment_received.value !== null && (
                    <span className="text-stone-500">
                      {' '}
                      — treatment: {inj.treatment_received.value ? 'yes' : 'no'}
                    </span>
                  )}
                </div>
              ))}
            </OutputSection>
          )}

          {/* Property */}
          {state.property.length > 0 && (
            <OutputSection title="Property">
              {state.property.map((p) => (
                <div key={p.property_id} className="text-xs mb-2">
                  <span className="font-medium text-stone-700">{p.item.value || 'Unspecified item'}</span>
                  <span className="text-stone-500"> — {p.what_happened.value || 'unknown'}</span>
                  {p.approximate_value.value && (
                    <span className="text-stone-500"> (approx. {p.approximate_value.value})</span>
                  )}
                </div>
              ))}
            </OutputSection>
          )}

          {/* Witnesses */}
          {state.witnesses.length > 0 && (
            <OutputSection title="Witnesses">
              {state.witnesses.map((w) => (
                <OutputRow
                  key={w.witness_id}
                  label={w.name.value || 'Unnamed witness'}
                  value={w.what_witnessed.value}
                />
              ))}
            </OutputSection>
          )}

          {/* Evidence */}
          {state.evidence.length > 0 && (
            <OutputSection title="Evidence">
              {state.evidence.map((e) => (
                <div key={e.evidence_id} className="text-xs mb-1">
                  <span className="font-medium text-stone-700 capitalize">
                    {e.type.replace('_', ' ')}
                  </span>
                  <span className="text-stone-500"> — {e.description.value || 'No description'}</span>
                </div>
              ))}
            </OutputSection>
          )}

          {/* Metadata */}
          <OutputSection title="Metadata">
            <OutputRow label="Case ID" value={state.case_id} />
            <OutputRow label="Created" value={new Date(state.created_at).toLocaleString()} />
            <OutputRow label="Updated" value={new Date(state.updated_at).toLocaleString()} />
            <OutputRow label="Turns" value={String(state.turn_count)} />
            <OutputRow label="Completion" value={`${state.completion_percentage}%`} />
          </OutputSection>
        </div>
      )}

      <FirRelatedJudgments state={state} />
      <div className="mt-6">
        <LegalAidCard compact />
      </div>

      {/* Disclaimer */}
      <div className="mt-8 rounded-lg border border-gold-200 bg-gold-50 p-4">
        <p className="flex items-start gap-2 text-xs text-gold-700">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>
            This output was generated by an AI-assisted intake assistant. It organises information
            provided by the user and has not been independently verified. It does not constitute
            legal advice and should be reviewed by a qualified person before any official use.
          </span>
        </p>
      </div>

      {/* Actions */}
      <div className="mt-6 flex items-center gap-3">
        <Link
          to="/fir"
          className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400"
        >
          <Icon name="back" size={15} />
          Back to FIR Assistant
        </Link>
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400"
        >
          <Icon name="search" size={15} />
          Go to Legal Research
        </Link>
      </div>
    </div>
  );
}

function OutputSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-medium text-stone-700 mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function OutputRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-32 shrink-0 text-stone-500">{label}</span>
      <span className="text-stone-700">{value}</span>
    </div>
  );
}
