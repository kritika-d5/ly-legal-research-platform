import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { canUseJudgeTools } from '../api/judge';
import { canUseLawyerTools } from '../api/lawyer';
import { RequireAuth, useAuth } from '../auth';
import Icon from './Icon';

const DESKS = {
  judge: { title: 'Judges’ research desk', allowed: canUseJudgeTools, checked: 'court details' },
  lawyer: { title: 'Lawyers’ desk', allowed: canUseLawyerTools, checked: 'Bar Council enrolment' },
} as const;

/**
 * Gate for a professional desk. Unlike RequireAuth's silent redirect, a
 * logged-in user who cannot enter is told why — a lawyer or judge still
 * awaiting verification should know that is the only thing in the way.
 *
 * Convenience only: /api/judge/* and /api/lawyer/* enforce the same rule.
 */
export default function RequireVerified({ role, children }: { role: keyof typeof DESKS; children: ReactNode }) {
  return (
    <RequireAuth>
      <Gate role={role}>{children}</Gate>
    </RequireAuth>
  );
}

function Gate({ role, children }: { role: keyof typeof DESKS; children: ReactNode }) {
  const { user } = useAuth();
  const desk = DESKS[role];
  if (desk.allowed(user)) return <>{children}</>;

  const pending = user?.role === role;
  return (
    <div className="mx-auto max-w-lg px-4 py-16 text-center">
      <Icon name="shield" size={28} className="mx-auto text-gold-500" />
      <h1 className="mt-3 font-serif text-xl font-semibold text-stone-900">{desk.title}</h1>
      <p className="mt-2 text-sm text-stone-600">
        {pending
          ? user?.verification.status === 'rejected'
            ? `Your verification was not approved. Update your ${desk.checked} on your profile to have it reviewed again.`
            : `Your account is waiting for an admin to verify your ${desk.checked}. The desk opens as soon as it is approved.`
          : `These tools are for verified ${role}s. Everything they draw on — judgments, citations and treatment — is open to everyone in search and on each case page.`}
      </p>
      <Link to={pending ? '/profile' : '/'} className="mt-5 inline-block text-sm font-medium text-maroon-700 hover:underline">
        {pending ? 'Go to your profile →' : 'Back to search →'}
      </Link>
    </div>
  );
}
