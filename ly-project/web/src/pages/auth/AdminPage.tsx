import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { listUsers, verifyUser, type AdminFilter, type User } from '../../api/auth';
import { RoleBadge, VerificationBadge, inputClass } from '../../components/Form';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';

const TABS: { key: AdminFilter; label: string }[] = [
  { key: 'pending', label: 'Pending' },
  { key: 'verified', label: 'Verified' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All users' },
];

export default function AdminPage() {
  useDocumentTitle('Admin · Verification');
  const [tab, setTab] = useState<AdminFilter>('pending');
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'users', tab],
    queryFn: () => listUsers(tab),
    staleTime: 10_000,
  });
  const counts = data?.counts ?? {};
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <h1 className="font-serif text-2xl font-semibold tracking-tight text-maroon-800">Account verification</h1>
      <p className="mt-1 text-sm text-stone-600">
        Check each lawyer’s enrolment with their State Bar Council, and each judge’s posting,
        before approving. Approved accounts unlock professional features.
      </p>

      <div role="tablist" className="mt-6 flex gap-1 overflow-x-auto border-b border-stone-200">
        {TABS.map((t) => {
          const n = t.key === 'all' ? total : counts[t.key] ?? 0;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                active ? 'border-maroon-700 font-medium text-maroon-800' : 'border-transparent text-stone-500 hover:text-stone-800'
              }`}
            >
              {t.label}
              <span className={`rounded-full px-1.5 text-[11px] ${active ? 'bg-maroon-100 text-maroon-800' : 'bg-stone-100 text-stone-500'}`}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="mt-5 space-y-3">
        {isLoading && <p className="text-sm text-stone-500">Loading…</p>}
        {error && <p className="text-sm text-vermilion-700">{(error as Error).message}</p>}
        {data && data.users.length === 0 && (
          <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500">
            {tab === 'pending' ? 'Nobody is waiting for verification.' : 'No accounts here.'}
          </p>
        )}
        {data?.users.map((u) => <UserRow key={u.id} user={u} />)}
      </div>
    </div>
  );
}

function UserRow({ user }: { user: User }) {
  const queryClient = useQueryClient();
  const [note, setNote] = useState('');
  const reviewable = user.role === 'lawyer' || user.role === 'judge';

  const decide = useMutation({
    mutationFn: (decision: 'verified' | 'rejected') => verifyUser(user.id, decision, note || undefined),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });

  const d = user.details;
  const facts: [string, string | undefined][] =
    user.role === 'lawyer'
      ? [['Enrolment no.', d.barCouncilId], ['State', d.barCouncilState]]
      : user.role === 'judge'
        ? [['Court', d.courtName], ['Designation', d.designation]]
        : user.role === 'student'
          ? [['Institution', d.institution], ['Programme', d.programme]]
          : [];

  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-stone-900">{user.name}</p>
          <p className="truncate text-xs text-stone-500">{user.email}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <RoleBadge role={user.role} />
          <VerificationBadge status={user.verification.status} />
        </div>
      </div>

      {facts.length > 0 && (
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {facts.map(([k, v]) => (
            <div key={k} className="flex gap-2">
              <dt className="text-stone-500">{k}:</dt>
              <dd className="font-medium text-stone-800">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="mt-2 text-[11px] text-stone-400">
        Signed up {new Date(user.createdAt).toLocaleString()}
        {user.verification.note && <> · Note: “{user.verification.note}”</>}
      </p>

      {reviewable && (
        <div className="mt-3 flex flex-col gap-2 border-t border-stone-100 pt-3 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note to the user (optional, shown on their profile)"
            maxLength={300}
            className={`${inputClass} sm:flex-1`}
          />
          <div className="flex gap-2">
            <button
              onClick={() => decide.mutate('verified')}
              disabled={decide.isPending || user.verification.status === 'verified'}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-sage-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-sage-700 disabled:opacity-40 sm:flex-none"
            >
              <Icon name="check" size={14} /> Approve
            </button>
            <button
              onClick={() => decide.mutate('rejected')}
              disabled={decide.isPending || user.verification.status === 'rejected'}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-vermilion-200 bg-white px-3 py-2 text-sm font-medium text-vermilion-700 transition-colors hover:bg-vermilion-50 disabled:opacity-40 sm:flex-none"
            >
              <Icon name="close" size={14} /> Reject
            </button>
          </div>
        </div>
      )}
      {decide.error && <p className="mt-2 text-xs text-vermilion-700">{(decide.error as Error).message}</p>}
    </article>
  );
}
