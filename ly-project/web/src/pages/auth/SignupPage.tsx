import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ApiError,
  INDIAN_STATES,
  ROLE_INFO,
  type RoleDetails,
  type SelfServiceRole,
} from '../../api/auth';
import { safeNext, useAuth } from '../../auth';
import { AuthCard, Field, FormError, focusField, inputClass, primaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';
import { RoleDetailsFields } from './RoleDetailsFields';

const ROLES: SelfServiceRole[] = ['citizen', 'student', 'lawyer', 'judge'];

export default function SignupPage() {
  useDocumentTitle('Create an account');
  const { user, signup } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [role, setRole] = useState<SelfServiceRole>('citizen');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [details, setDetails] = useState<RoleDetails>({});

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && !busy) return <Navigate to={next} replace />;

  const needsVerification = role === 'lawyer' || role === 'judge';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    // Quick checks the browser can do itself. The server repeats all of them.
    const local: Record<string, string> = {};
    if (name.trim().length < 2) local.name = 'Enter your full name';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) local.email = 'Enter a valid email address';
    if (password.length < 8) local.password = 'Password must be at least 8 characters';
    else if (confirm !== password) local.confirm = 'Passwords do not match';
    setFieldErrors(local);
    if (Object.keys(local).length) return focusField(Object.keys(local)[0]);

    setBusy(true);
    try {
      await signup({
        role,
        name,
        email,
        password,
        city: city || undefined,
        state: state || undefined,
        details,
      });
      // New lawyers and judges land on their profile, where the pending
      // status is explained; everyone else carries on where they were going.
      navigate(needsVerification ? '/profile' : next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setFieldErrors({ [err.field]: err.message });
        focusField(err.field);
      } else setError((err as Error)?.message ?? 'Could not create your account.');
      setBusy(false);
    }
  }

  const invalid = (key: string) => (fieldErrors[key] ? { 'aria-invalid': true, 'aria-describedby': `${key}-error` } : {});

  return (
    <AuthCard
      title="Create an account"
      subtitle={
        <>
          Already have one?{' '}
          <Link to={`/login${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-maroon-700 hover:underline">
            Log in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <fieldset>
          <legend className="mb-2 text-xs font-medium text-stone-700">I am a…</legend>
          <div className="grid grid-cols-2 gap-2">
            {ROLES.map((r) => {
              const selected = r === role;
              return (
                <label
                  key={r}
                  className={`relative cursor-pointer rounded-lg border p-3 transition-colors ${
                    selected
                      ? 'border-maroon-600 bg-maroon-50 ring-1 ring-maroon-600'
                      : 'border-stone-200 bg-white hover:border-stone-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r}
                    checked={selected}
                    onChange={() => {
                      setRole(r);
                      setDetails({});
                      setFieldErrors({});
                    }}
                    className="sr-only"
                  />
                  <span className="block text-sm font-medium text-stone-900">{ROLE_INFO[r].label}</span>
                  <span className="mt-0.5 block text-[11px] leading-snug text-stone-500">{ROLE_INFO[r].blurb}</span>
                  {selected && <Icon name="check" size={14} className="absolute right-2 top-2 text-maroon-700" />}
                </label>
              );
            })}
          </div>
        </fieldset>

        {needsVerification && (
          <p className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 p-3 text-xs text-gold-700">
            <Icon name="shield" size={14} className="mt-0.5" />
            <span>
              {role === 'lawyer' ? 'Lawyer' : 'Judge'} accounts are checked by an admin before
              professional features unlock. Until then your account works like a citizen account.
            </span>
          </p>
        )}

        <div className="space-y-4">
          <Field label="Full name" htmlFor="name" error={fieldErrors.name}>
            <input id="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} {...invalid('name')} />
          </Field>
          <Field label="Email" htmlFor="email" error={fieldErrors.email}>
            <input id="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} {...invalid('email')} />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Password" htmlFor="password" error={fieldErrors.password} hint="At least 8 characters">
              <input id="password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} {...invalid('password')} />
            </Field>
            <Field label="Confirm password" htmlFor="confirm" error={fieldErrors.confirm}>
              <input id="confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} {...invalid('confirm')} />
            </Field>
          </div>
        </div>

        <RoleDetailsFields role={role} details={details} onChange={setDetails} errors={fieldErrors} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="city" optional>
            <input id="city" autoComplete="address-level2" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
          </Field>
          <Field label="State" htmlFor="state" optional>
            <select id="state" value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        <FormError message={error} />
        <button type="submit" disabled={busy} className={`${primaryButton} w-full`}>
          {busy ? 'Creating account…' : 'Create account'}
        </button>
        <p className="text-center text-[11px] text-stone-400">
          Your password is stored only as a one-way hash. Nobody, including admins, can read it.
        </p>
      </form>
    </AuthCard>
  );
}
