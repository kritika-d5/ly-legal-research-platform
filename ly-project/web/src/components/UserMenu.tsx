import { useCallback, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ROLE_INFO } from '../api/auth';
import { canUseJudgeTools } from '../api/judge';
import { canUseLawyerTools } from '../api/lawyer';
import { useAuth } from '../auth';
import { useDismiss } from '../useDismiss';
import Icon, { type IconName } from './Icon';

/** Header account control: Log in / Sign up when logged out, a menu when in. */
export default function UserMenu() {
  const { user, loading, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();

  const close = useCallback(() => setOpen(false), []);
  // Close on outside click and Escape; menu links close it themselves.
  useDismiss(ref, open, close);

  if (loading) return <span className="h-7 w-7" aria-hidden="true" />;

  if (!user) {
    // Come back to this page after logging in, unless we are already on an auth page.
    const here = location.pathname.startsWith('/login') || location.pathname.startsWith('/signup')
      ? ''
      : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return (
      <div className="flex items-center gap-2 whitespace-nowrap">
        <Link to={`/login${here}`} className="text-stone-600 transition-colors hover:text-maroon-700">
          Log in
        </Link>
        <Link
          to={`/signup${here}`}
          className="rounded-md bg-maroon-800 px-2.5 py-1.5 font-medium text-white transition-colors hover:bg-maroon-700"
        >
          Sign up
        </Link>
      </div>
    );
  }

  const initials = user.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const pending = user.verification.status === 'pending';

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        className="flex items-center gap-2 rounded-full py-0.5 pl-0.5 pr-2 transition-colors hover:bg-stone-100"
      >
        <span className="relative flex h-7 w-7 items-center justify-center rounded-full bg-maroon-800 text-[11px] font-semibold text-gold-200">
          {initials}
          {pending && (
            <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-gold-400" title="Verification pending" />
          )}
        </span>
        <span className="hidden max-w-[9rem] truncate text-stone-700 md:inline">{user.name.split(' ')[0]}</span>
      </button>

      {open && (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-60 overflow-hidden rounded-lg border border-stone-200 bg-white shadow-lg">
          <div className="border-b border-stone-100 px-4 py-3">
            <p className="truncate text-sm font-medium text-stone-900">{user.name}</p>
            <p className="truncate text-xs text-stone-500">{user.email}</p>
            <p className="mt-1.5 text-[11px] text-stone-500">
              {ROLE_INFO[user.role].label}
              {pending && <span className="text-gold-700"> · verification pending</span>}
              {user.verification.status === 'verified' && <span className="text-sage-700"> · verified</span>}
            </p>
          </div>
          <MenuLink onClick={close} to="/profile" icon="user">Your profile</MenuLink>
          <MenuLink onClick={close} to="/saved" icon="bookmark">Saved judgments</MenuLink>
          <MenuLink onClick={close} to="/fir" icon="document">My FIRs</MenuLink>
          {canUseLawyerTools(user) && (
            <MenuLink onClick={close} to="/lawyer" icon="folder">Lawyers’ desk</MenuLink>
          )}
          {canUseJudgeTools(user) && (
            <MenuLink onClick={close} to="/judge" icon="gavel">Judges’ research desk</MenuLink>
          )}
          {user.role === 'admin' && <MenuLink onClick={close} to="/admin" icon="shield">Verify accounts</MenuLink>}
          <button
            role="menuitem"
            onClick={async () => {
              close();
              await logout();
              navigate('/');
            }}
            className="flex w-full items-center gap-2.5 border-t border-stone-100 px-4 py-2.5 text-left text-sm text-stone-700 transition-colors hover:bg-stone-50"
          >
            <Icon name="logout" size={15} className="text-stone-500" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function MenuLink({ to, icon, onClick, children }: { to: string; icon: IconName; onClick: () => void; children: string }) {
  return (
    <Link role="menuitem" to={to} onClick={onClick} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-700 transition-colors hover:bg-stone-50">
      <Icon name={icon} size={15} className="text-stone-500" />
      {children}
    </Link>
  );
}
