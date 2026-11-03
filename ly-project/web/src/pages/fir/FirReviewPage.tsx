import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  accusedLabel,
  factDisplay,
  factHasValue,
  getFirCase,
  type Fact,
} from '../../api/fir';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';

/**
 * FIR Review page.
 *
 * Shows the information extracted into CaseState before confirmation.
 * Clearly distinguishes confirmed, extracted, uncertain, missing, and
 * contradictory information. Does NOT silently resolve contradictions
 * or invent missing information.
 */
export default function FirReviewPage() {
  const { caseId } = useParams<{ caseId: string }>();
  useDocumentTitle('Review FIR Facts');

  const { data, isLoading, error } = useQuery({
    queryKey: ['fir-case', caseId],
    queryFn: () => getFirCase(caseId!),
    enabled: !!caseId,
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10 text-sm text-stone-500">
        Loading case data…
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
        <span>Review</span>
      </div>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-stone-900">
          Review the Information
        </h1>
        <p className="mt-1 text-sm text-stone-600">
          This is what the assistant has recorded. Please review it carefully before confirming.
          Nothing here has been independently verified.
        </p>
      </div>

      {/* Contradictions — shown prominently, never silently resolved */}
      {state.contradictions.filter((c) => !c.resolved).length > 0 && (
        <div className="mb-6 rounded-lg border border-vermilion-200 bg-vermilion-50 p-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-vermilion-700 mb-2">
            <Icon name="alert" size={15} />
            Points needing clarification
          </h2>
          <ul className="space-y-2">
            {state.contradictions
              .filter((c) => !c.resolved)
              .map((c) => (
                <li key={c.contradiction_id} className="text-xs text-vermilion-700">
                  <span className="font-medium capitalize">{c.type}:</span> {c.explanation}
                </li>
              ))}
          </ul>
          <p className="mt-2 text-xs text-vermilion-600">
            These contradictions have NOT been resolved. You can go back and clarify them, or
            proceed with confirmation as-is.
          </p>
        </div>
      )}

      {/* CaseState sections */}
      <div className="space-y-6">
        <Section title="Incident">
          <FactRow label="Description" fact={state.incident.description} />
          <FactRow label="Date" fact={state.incident.date} />
          <FactRow label="Time" fact={state.incident.time} />
          <FactRow label="Location" fact={state.incident.location} />
          <FactRow label="Location details" fact={state.incident.location_details} />
          <FactRow label="Ongoing or repeated" fact={state.incident.ongoing_or_repeated} />
        </Section>

        <Section title="Complainant">
          <FactRow label="Name" fact={state.complainant.name} />
          <FactRow label="Age" fact={state.complainant.age} />
          <FactRow label="Gender" fact={state.complainant.gender} />
          <FactRow label="Address" fact={state.complainant.address} />
          <FactRow label="Contact" fact={state.complainant.contact} />
        </Section>

        {state.complainant_is_victim.value === false && (
          <Section title="Victim (different from complainant)">
            <FactRow label="Name" fact={state.victim.name} />
            <FactRow label="Relationship" fact={state.victim.relationship_to_other_party} />
          </Section>
        )}

        {state.accused.length > 0 && (
          <Section title={`Accused (${state.accused.length})`}>
            {state.accused.map((a) => (
              <div key={a.accused_id} className="mb-3 last:mb-0">
                <p className="text-xs font-medium text-stone-700 mb-1">
                  {accusedLabel(a)}
                  <span className="ml-2 text-stone-400 font-normal">
                    Identity: {a.identity_status.replace('_', ' ')}
                  </span>
                </p>
                <FactRow label="Description" fact={a.description} />
                <FactRow label="Relationship to complainant" fact={a.relationship_to_complainant} />
                <FactRow label="Address / whereabouts" fact={a.address_or_whereabouts} />
              </div>
            ))}
          </Section>
        )}

        {state.acts.length > 0 && (
          <Section title={`Acts (${state.acts.length})`}>
            {state.acts.map((act) => (
              <div key={act.act_id} className="mb-2 last:mb-0 text-xs">
                <span className="font-medium text-stone-700 capitalize">{act.type.replace('_', ' ')}</span>
                <span className="text-stone-500"> — {act.description}</span>
                {act.by && <span className="text-stone-400"> (by {act.by})</span>}
              </div>
            ))}
          </Section>
        )}

        {state.injuries.length > 0 && (
          <Section title={`Injuries (${state.injuries.length})`}>
            {state.injuries.map((inj) => (
              <div key={inj.injury_id} className="mb-3 last:mb-0">
                <FactRow label="Type" fact={inj.type} />
                <FactRow label="Body part" fact={inj.body_part} />
                <FactRow label="Treatment received" fact={inj.treatment_received} />
                <FactRow label="Hospital / doctor" fact={inj.hospital_or_doctor} />
                <FactRow label="Medical report available" fact={inj.medical_report_available} />
              </div>
            ))}
          </Section>
        )}

        {state.weapons.length > 0 && (
          <Section title={`Weapons / Objects (${state.weapons.length})`}>
            {state.weapons.map((w) => (
              <div key={w.weapon_id} className="mb-3 last:mb-0">
                <FactRow label="Object" fact={w.object} />
                <FactRow label="Used" fact={w.used} />
                <FactRow label="How used" fact={w.how_used} />
              </div>
            ))}
          </Section>
        )}

        {state.property.length > 0 && (
          <Section title={`Property (${state.property.length})`}>
            {state.property.map((p) => (
              <div key={p.property_id} className="mb-3 last:mb-0">
                <FactRow label="Item" fact={p.item} />
                <FactRow label="What happened" fact={p.what_happened} />
                <FactRow label="Approximate value" fact={p.approximate_value} />
                <FactRow label="Recovered" fact={p.recovered} />
              </div>
            ))}
          </Section>
        )}

        {state.witnesses.length > 0 && (
          <Section title={`Witnesses (${state.witnesses.length})`}>
            {state.witnesses.map((w) => (
              <div key={w.witness_id} className="mb-3 last:mb-0">
                <FactRow label="Name" fact={w.name} />
                <FactRow label="What they witnessed" fact={w.what_witnessed} />
              </div>
            ))}
          </Section>
        )}

        {state.evidence.length > 0 && (
          <Section title={`Evidence (${state.evidence.length})`}>
            {state.evidence.map((e) => (
              <div key={e.evidence_id} className="mb-3 last:mb-0">
                <p className="text-xs font-medium text-stone-700 mb-1 capitalize">
                  {e.type.replace('_', ' ')}
                </p>
                <FactRow label="Description" fact={e.description} />
                <FactRow label="In possession" fact={e.in_possession} />
              </div>
            ))}
          </Section>
        )}

        {/* Missing information */}
        {state.missing_information.filter((m) => m.priority !== 'optional').length > 0 && (
          <div className="rounded-lg border border-gold-200 bg-gold-50 p-4">
            <h2 className="text-sm font-medium text-gold-700 mb-2">Still missing</h2>
            <ul className="space-y-1">
              {state.missing_information
                .filter((m) => m.priority !== 'optional')
                .map((m) => (
                  <li key={m.field} className="text-xs text-gold-700">
                    <span className="font-medium">{m.field.replace(/_/g, ' ')}</span>
                    <span className="text-gold-600"> ({m.priority})</span>
                    {m.reason && <span className="text-gold-600"> — {m.reason}</span>}
                  </li>
                ))}
            </ul>
          </div>
        )}

        {/* Unknown fields */}
        {state.unknown_fields.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <h2 className="text-sm font-medium text-stone-600 mb-2">User does not know</h2>
            <ul className="space-y-1">
              {state.unknown_fields.map((f) => (
                <li key={f} className="text-xs text-stone-500">{f.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Declined fields */}
        {state.declined_fields.length > 0 && (
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-4">
            <h2 className="text-sm font-medium text-stone-600 mb-2">User declined to share</h2>
            <ul className="space-y-1">
              {state.declined_fields.map((f) => (
                <li key={f} className="text-xs text-stone-500">{f.replace(/_/g, ' ')}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="mt-8 flex items-center gap-3">
        <Link
          to={`/fir/case/${caseId}/confirm`}
          className="inline-flex items-center gap-2 rounded-md bg-maroon-800 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-maroon-700"
        >
          <Icon name="summary" size={15} />
          Proceed to confirmation
        </Link>
        <Link
          to={`/fir/case/${caseId}`}
          className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-2.5 text-sm font-medium text-stone-700 transition-colors hover:border-stone-400"
        >
          <Icon name="back" size={15} />
          Back to conversation
        </Link>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-sm font-medium text-stone-700 mb-3">{title}</h2>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function FactRow({ label, fact }: { label: string; fact: Fact }) {
  // The approx. marker is drawn below as a badge, so leave it off the text.
  const display = factDisplay(fact, { markApproximate: false });
  const isUnknown = fact.status === 'unknown';
  const isDeclined = fact.status === 'declined';
  const isNotProvided = fact.status === 'not_provided';

  let valueClass = 'text-stone-700';
  if (isUnknown) valueClass = 'text-stone-400 italic';
  else if (isDeclined) valueClass = 'text-stone-400 italic';
  else if (isNotProvided) valueClass = 'text-stone-300';

  return (
    <div className="flex items-start gap-3 text-xs">
      <span className="w-32 shrink-0 text-stone-500">{label}</span>
      <span className={valueClass}>
        {display}
        {fact.approximate && factHasValue(fact) && (
          <span className="ml-1 text-[10px] text-gold-600">(approx.)</span>
        )}
      </span>
    </div>
  );
}
