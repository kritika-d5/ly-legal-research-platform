/**
 * Free legal aid: who qualifies and where to go. Shown on the rights guide, on
 * the FIR Assistant, and after an FIR is confirmed.
 *
 * Personalised only by the state already in the user's profile — never by
 * anything from an FIR.
 */
import { LEGAL_AID_ELIGIBLE, LEGAL_AID_LINKS } from '../content/bailRights';
import { useAuth } from '../auth';
import Icon from './Icon';

export default function LegalAidCard({ compact = false }: { compact?: boolean }) {
  const { user } = useAuth();
  const state = user?.state;

  return (
    <section className="rounded-xl border border-navy-200 bg-navy-50 p-5 text-navy-700">
      <h2 className="flex items-center gap-2 text-base font-semibold text-navy-700">
        <Icon name="scale" size={18} /> Free legal help
      </h2>
      <p className="mt-1.5 text-sm">
        Legal services authorities provide a lawyer free of cost to people who qualify, for bail
        applications, filing complaints and more.
      </p>

      <a
        href={`tel:${LEGAL_AID_LINKS.helpline}`}
        className="mt-4 flex items-center gap-3 rounded-lg bg-white px-4 py-3 text-navy-700 ring-1 ring-navy-200 transition-colors hover:ring-navy-300"
      >
        <Icon name="phone" size={20} className="text-navy-500" />
        <span>
          <span className="block text-xs text-navy-500">NALSA legal aid helpline (toll-free)</span>
          <span className="font-serif text-xl font-semibold tracking-wide">{LEGAL_AID_LINKS.helpline}</span>
        </span>
      </a>

      <ul className="mt-4 space-y-2 text-sm">
        <AidLink href={LEGAL_AID_LINKS.apply}>Apply for legal aid online (NALSA)</AidLink>
        <AidLink href={LEGAL_AID_LINKS.directory}>
          {state ? `Find the ${state} State Legal Services Authority` : 'Find your State or District Legal Services Authority'}
        </AidLink>
        {!compact && (
          <>
            <AidLink href={LEGAL_AID_LINKS.defenceCounsel}>Legal Aid Defence Counsel, for people accused of an offence</AidLink>
            <AidLink href={LEGAL_AID_LINKS.teleLaw}>Tele-Law: free advice from a lawyer by video or phone</AidLink>
          </>
        )}
      </ul>
      {state && (
        <p className="mt-2 text-xs text-navy-500">
          You can also visit the District Legal Services Authority office at your district court.
        </p>
      )}

      {!compact && (
        <>
          <h3 className="mt-5 text-xs font-semibold uppercase tracking-wide text-navy-500">Who qualifies</h3>
          <ul className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {LEGAL_AID_ELIGIBLE.map((e) => (
              <li key={e} className="flex items-start gap-1.5">
                <Icon name="check" size={14} className="mt-0.5 text-navy-500" />
                {e}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-navy-500">
            Legal Services Authorities Act, 1987, section 12. Income limits differ from state to state.
          </p>
        </>
      )}
    </section>
  );
}

function AidLink({ href, children }: { href: string; children: string }) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-start gap-1.5 font-medium underline decoration-navy-200 underline-offset-4 hover:decoration-navy-500"
      >
        <Icon name="external" size={13} className="mt-1" />
        {children}
      </a>
    </li>
  );
}
