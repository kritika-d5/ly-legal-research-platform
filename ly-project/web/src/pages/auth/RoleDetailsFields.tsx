/**
 * The extra fields each role needs. Used by signup and by profile editing, so
 * both always ask for exactly what the server validates.
 */
import {
  INDIAN_STATES,
  JUDGE_DESIGNATIONS,
  STUDENT_PROGRAMMES,
  type Role,
  type RoleDetails,
} from '../../api/auth';
import { Field, inputClass } from '../../components/Form';

export function RoleDetailsFields({
  role,
  details,
  onChange,
  errors,
}: {
  role: Role;
  details: RoleDetails;
  onChange: (d: RoleDetails) => void;
  errors: Record<string, string>;
}) {
  const set = (key: keyof RoleDetails) => (e: { target: { value: string } }) =>
    onChange({ ...details, [key]: e.target.value });
  const err = (key: keyof RoleDetails) => errors[`details.${key}`];
  const aria = (key: keyof RoleDetails) =>
    err(key) ? { 'aria-invalid': true, 'aria-describedby': `${key}-error` } : {};

  if (role === 'lawyer') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Bar Council enrolment no." htmlFor="barCouncilId" error={err('barCouncilId')} hint="e.g. MAH/1234/2015">
          <input id="barCouncilId" value={details.barCouncilId ?? ''} onChange={set('barCouncilId')} className={inputClass} {...aria('barCouncilId')} />
        </Field>
        <Field label="State of enrolment" htmlFor="barCouncilState" error={err('barCouncilState')}>
          <select id="barCouncilState" value={details.barCouncilState ?? ''} onChange={set('barCouncilState')} className={inputClass} {...aria('barCouncilState')}>
            <option value="">Select…</option>
            {INDIAN_STATES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  }

  if (role === 'judge') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Court" htmlFor="courtName" error={err('courtName')} hint="e.g. Bombay High Court">
          <input id="courtName" value={details.courtName ?? ''} onChange={set('courtName')} className={inputClass} {...aria('courtName')} />
        </Field>
        <Field label="Designation" htmlFor="designation" error={err('designation')}>
          <select id="designation" value={details.designation ?? ''} onChange={set('designation')} className={inputClass} {...aria('designation')}>
            <option value="">Select…</option>
            {JUDGE_DESIGNATIONS.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  }

  if (role === 'student') {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="University / institution" htmlFor="institution" error={err('institution')}>
          <input id="institution" value={details.institution ?? ''} onChange={set('institution')} className={inputClass} {...aria('institution')} />
        </Field>
        <Field label="Programme" htmlFor="programme" optional>
          <select id="programme" value={details.programme ?? ''} onChange={set('programme')} className={inputClass}>
            <option value="">—</option>
            {STUDENT_PROGRAMMES.map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
      </div>
    );
  }

  return null;
}
