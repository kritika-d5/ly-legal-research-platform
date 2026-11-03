import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { safeNext, useAuth } from '../../auth';
import { AuthCard, Field, FormError, inputClass, primaryButton } from '../../components/Form';
import { useDocumentTitle } from '../../useDocumentTitle';

export default function LoginPage() {
  useDocumentTitle('Log in');
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Already logged in (e.g. pressed Back after logging in): skip the form.
  if (user && !busy) return <Navigate to={next} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (err: any) {
      setError(err?.message ?? 'Could not log in. Please try again.');
      setBusy(false);
    }
  }

  return (
    <AuthCard
      title="Log in"
      subtitle={
        <>
          New here?{' '}
          <Link to={`/signup${next !== '/' ? `?next=${encodeURIComponent(next)}` : ''}`} className="font-medium text-maroon-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
          />
        </Field>
        <FormError message={error} />
        <button type="submit" disabled={busy || !email || !password} className={`${primaryButton} w-full`}>
          {busy ? 'Logging in…' : 'Log in'}
        </button>
      </form>
    </AuthCard>
  );
}
