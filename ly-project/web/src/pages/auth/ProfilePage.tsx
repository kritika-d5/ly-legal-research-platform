import { useQuery } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  ApiError,
  INDIAN_STATES,
  ROLE_INFO,
  changePassword,
  updateProfile,
  type RoleDetails,
  type User,
} from '../../api/auth';
import { listFirCases } from '../../api/fir';
import { listFolders, workspaceKeys } from '../../api/workspace';
import { useAuth } from '../../auth';
import {
  Field,
  FormError,
  RoleBadge,
  focusField,
  VerificationBadge,
  inputClass,
  primaryButton,
  secondaryButton,
} from '../../components/Form';
import Icon, { type IconName } from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';
import { RoleDetailsFields } from './RoleDetailsFields';

/** Must match VERIFIED_FIELDS on the server: editing these re-queues the account. */
const CHECKED_FIELDS: Partial<Record<User['role'], (keyof RoleDetails)[]>> = {
  lawyer: ['barCouncilId', 'barCouncilState'],
  judge: ['courtName', 'designation'],
};

const DETAIL_LABELS: Record<keyof RoleDetails, string> = {
  barCouncilId: 'Bar Council enrolment no.',
  barCouncilState: 'State of enrolment',
  courtName: 'Court',
  designation: 'Designation',
  institution: 'Institution',
  programme: 'Programme',
};

export default function ProfilePage() {
  useDocumentTitle('Your profile');
  const { user } = useAuth();
  if (!user) return null; // RequireAuth guarantees a user; this satisfies the types.

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
      <ProfileHeader user={user} />
      <VerificationPanel user={user} />
      <WorkspaceCard />
      <ProfileForm user={user} />
      <PasswordForm />
    </div>
  );
}

function ProfileHeader({ user }: { user: User }) {
  const initials = user.name
    .split(/\s+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  const details = Object.entries(user.details).filter(([, v]) => v) as [keyof RoleDetails, string][];

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-maroon-800 font-serif text-lg font-semibold text-gold-200">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-serif text-2xl font-semibold tracking-tight text-stone-900">{user.name}</h1>
          <p className="truncate text-sm text-stone-500">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <RoleBadge role={user.role} />
          <VerificationBadge status={user.verification.status} />
        </div>
      </div>

      <dl className="mt-5 grid gap-x-6 gap-y-3 border-t border-stone-100 pt-5 text-sm sm:grid-cols-2">
        {details.map(([k, v]) => (
          <div key={k}>
            <dt className="text-xs text-stone-500">{DETAIL_LABELS[k]}</dt>
            <dd className="text-stone-800">{v}</dd>
          </div>
        ))}
        {(user.city || user.state) && (
          <div>
            <dt className="text-xs text-stone-500">Location</dt>
            <dd className="text-stone-800">{[user.city, user.state].filter(Boolean).join(', ')}</dd>
          </div>
        )}
        <div>
          <dt className="text-xs text-stone-500">Member since</dt>
          <dd className="text-stone-800">
            {new Date(user.createdAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/** Explains where a lawyer / judge account stands. Nothing for other roles. */
function VerificationPanel({ user }: { user: User }) {
  const { status, note, reviewedAt } = user.verification;
  if (status === 'not_required') return null;

  const panels = {
    pending: {
      tone: 'border-gold-200 bg-gold-50 text-gold-700',
      icon: 'alert' as const,
      title: 'Waiting for verification',
      body: `An admin will check your ${
        user.role === 'lawyer' ? 'Bar Council enrolment' : 'court details'
      }. Until then your account works like a citizen account.`,
    },
    verified: {
      tone: 'border-sage-200 bg-sage-50 text-sage-700',
      icon: 'shield' as const,
      title: `Verified ${ROLE_INFO[user.role].label.toLowerCase()}`,
      body: reviewedAt ? `Approved on ${new Date(reviewedAt).toLocaleDateString()}.` : 'Your account is approved.',
    },
    rejected: {
      tone: 'border-vermilion-200 bg-vermilion-50 text-vermilion-700',
      icon: 'alert' as const,
      title: 'Verification was not approved',
      body: 'Correct your details below and save to send your account for review again.',
    },
  }[status];

  return (
    <section className={`flex items-start gap-3 rounded-xl border p-4 ${panels.tone}`}>
      <Icon name={panels.icon} size={18} className="mt-0.5" />
      <div className="text-sm">
        <p className="font-medium">{panels.title}</p>
        <p className="mt-0.5 opacity-90">{panels.body}</p>
        {note && <p className="mt-1.5 text-xs opacity-80">Admin note: “{note}”</p>}
      </div>
    </section>
  );
}

/** Shortcuts into the user's own work, with counts. */
function WorkspaceCard() {
  const { user } = useAuth();
  const { data: folderList } = useQuery({ queryKey: workspaceKeys.folders, queryFn: listFolders });
  const { data: firs } = useQuery({ queryKey: ['me', 'fir-cases'], queryFn: () => listFirCases(50), retry: false });

  const tiles: { to: string; icon: IconName; label: string; value: number | undefined; hint: string }[] = [
    { to: '/saved', icon: 'bookmark', label: 'Saved judgments', value: folderList?.total, hint: 'With your private notes' },
    { to: '/saved', icon: 'folder', label: 'Folders', value: folderList?.folders.length, hint: 'Grouped by client or topic' },
    { to: '/fir', icon: 'document', label: 'My FIRs', value: firs?.length, hint: 'Drafts and confirmed' },
  ];
  const isCitizen = user?.role === 'citizen';

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-base font-semibold text-stone-900">Your workspace</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.label}
            to={t.to}
            className="group rounded-lg border border-stone-200 p-4 transition-colors hover:border-terracotta-300 hover:bg-stone-50"
          >
            <div className="flex items-center justify-between">
              <Icon name={t.icon} size={16} className="text-maroon-700" />
              <span className="font-serif text-2xl font-semibold tabular-nums text-stone-900">{t.value ?? '–'}</span>
            </div>
            <p className="mt-2 text-sm font-medium text-stone-800 group-hover:text-maroon-800">{t.label}</p>
            <p className="text-xs text-stone-500">{t.hint}</p>
          </Link>
        ))}
      </div>
      {isCitizen && (
        <Link
          to="/rights"
          className="mt-3 flex items-center justify-between rounded-lg border border-navy-200 bg-navy-50 px-4 py-3 text-sm text-navy-700 transition-colors hover:border-navy-300"
        >
          <span className="flex items-center gap-2">
            <Icon name="scale" size={16} />
            <span>
              <span className="font-medium">Know your bail rights</span>
              <span className="block text-xs text-navy-500">and where to get a lawyer for free (helpline 15100)</span>
            </span>
          </span>
          <Icon name="chevronRight" size={16} />
        </Link>
      )}
    </section>
  );
}

function ProfileForm({ user }: { user: User }) {
  const { setUser } = useAuth();
  const [name, setName] = useState(user.name);
  const [city, setCity] = useState(user.city ?? '');
  const [state, setState] = useState(user.state ?? '');
  const [details, setDetails] = useState<RoleDetails>(user.details);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  const checked = CHECKED_FIELDS[user.role] ?? [];
  const touchesChecked = checked.some((k) => (details[k] ?? '') !== (user.details[k] ?? ''));
  const willRequeue = touchesChecked && user.verification.status !== 'pending';

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setSaved(false);
    try {
      const updated = await updateProfile({ name, city, state, details });
      setUser(updated);
      setSaved(true);
    } catch (err) {
      if (err instanceof ApiError && err.field) {
        setFieldErrors({ [err.field]: err.message });
        focusField(err.field === 'name' ? 'p-name' : err.field);
      } else setError((err as Error)?.message ?? 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="text-base font-semibold text-stone-900">Edit profile</h2>
      <p className="mt-0.5 text-xs text-stone-500">
        Your email and account type can’t be changed here.
      </p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        <Field label="Full name" htmlFor="p-name" error={fieldErrors.name}>
          <input id="p-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
        </Field>

        <RoleDetailsFields role={user.role} details={details} onChange={setDetails} errors={fieldErrors} />

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="City" htmlFor="p-city" optional>
            <input id="p-city" value={city} onChange={(e) => setCity(e.target.value)} className={inputClass} />
          </Field>
          <Field label="State" htmlFor="p-state" optional>
            <select id="p-state" value={state} onChange={(e) => setState(e.target.value)} className={inputClass}>
              <option value="">—</option>
              {INDIAN_STATES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </Field>
        </div>

        {willRequeue && (
          <p className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 p-3 text-xs text-gold-700">
            <Icon name="alert" size={14} className="mt-0.5" />
            Changing these details sends your account back for verification.
          </p>
        )}
        <FormError message={error} />
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy} className={primaryButton}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-sage-700">
              <Icon name="check" size={14} /> Saved
            </span>
          )}
        </div>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    const local: Record<string, string> = {};
    if (next.length < 8) local.newPassword = 'Password must be at least 8 characters';
    else if (confirm !== next) local.confirm = 'Passwords do not match';
    setFieldErrors(local);
    if (Object.keys(local).length) return;

    setBusy(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      const field = err instanceof ApiError && err.field ? err.field : 'currentPassword';
      setFieldErrors({ [field]: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-xl border border-stone-200 bg-white p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
        <Icon name="lock" size={16} className="text-stone-500" /> Change password
      </h2>
      <p className="mt-0.5 text-xs text-stone-500">This logs you out on every other device.</p>
      <form onSubmit={onSubmit} className="mt-5 space-y-4" noValidate>
        <Field label="Current password" htmlFor="pw-current" error={fieldErrors.currentPassword}>
          <input id="pw-current" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} className={inputClass} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="New password" htmlFor="pw-new" error={fieldErrors.newPassword} hint="At least 8 characters">
            <input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} className={inputClass} />
          </Field>
          <Field label="Confirm new password" htmlFor="pw-confirm" error={fieldErrors.confirm}>
            <input id="pw-confirm" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" disabled={busy || !current || !next} className={secondaryButton}>
            {busy ? 'Updating…' : 'Update password'}
          </button>
          {done && (
            <span className="flex items-center gap-1 text-xs text-sage-700">
              <Icon name="check" size={14} /> Password updated
            </span>
          )}
        </div>
      </form>
    </section>
  );
}
