/**
 * Who is logged in, available to every component via `useAuth()`.
 *
 * The server is the source of truth: on page load we ask `/api/auth/me`, and
 * after login / signup / logout we write the answer straight into the
 * react-query cache so every component re-renders at once.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import * as api from './api/auth';
import type { Role, SignupInput, User } from './api/auth';

interface AuthState {
  user: User | null;
  /** True only on the very first load, before we know either way. */
  loading: boolean;
  login: (email: string, password: string) => Promise<User>;
  signup: (input: SignupInput) => Promise<User>;
  logout: () => Promise<void>;
  /** Replace the cached user after a profile edit. */
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthState | null>(null);
const ME_KEY = ['auth', 'me'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ME_KEY,
    queryFn: api.getMe,
    staleTime: 60_000,
    retry: false,
  });

  const setUser = (user: User | null) => queryClient.setQueryData(ME_KEY, user);

  const value: AuthState = {
    user: data ?? null,
    loading: isLoading,
    setUser,
    async login(email, password) {
      const user = await api.login(email, password);
      setUser(user);
      return user;
    },
    async signup(input) {
      const user = await api.signup(input);
      setUser(user);
      return user;
    },
    async logout() {
      await api.logout();
      setUser(null);
      // Anything fetched while logged in may be personal; drop it.
      queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * Route guard. Logged-out visitors go to /login and come back afterwards;
 * logged-in users without the role get sent home.
 *
 * This is for the user's convenience only — the server enforces every rule
 * again, because anyone can edit the JavaScript running in their browser.
 */
export function RequireAuth({ children, roles }: { children: ReactNode; roles?: Role[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <p className="mx-auto max-w-md px-6 py-16 text-sm text-stone-500">Checking your session…</p>;
  }
  if (!user) {
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  if (roles && !roles.includes(user.role)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Only follow same-site paths after login, never a full URL — otherwise a
 *  crafted link like /login?next=https://evil.example could bounce users off-site. */
export function safeNext(raw: string | null) {
  return raw && raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
}
