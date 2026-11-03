/**
 * Form building blocks shared by the account pages, so signup, login and
 * profile look like one family and every error sits under its own field.
 */
import type { ReactNode } from 'react';
import type { Role, VerificationStatus } from '../api/auth';
import { ROLE_INFO, VERIFICATION_INFO } from '../api/auth';
import Icon from './Icon';

export const inputClass =
  'w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900 ' +
  'placeholder:text-stone-400 transition-colors focus:border-maroon-600 focus:outline-none ' +
  'focus:ring-2 focus:ring-maroon-100 aria-[invalid=true]:border-vermilion-400 disabled:bg-stone-100';

export const primaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md bg-maroon-800 px-4 py-2.5 text-sm ' +
  'font-medium text-white transition-colors hover:bg-maroon-700 disabled:opacity-50';

export const secondaryButton =
  'inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 py-2 ' +
  'text-sm font-medium text-stone-700 transition-colors hover:border-stone-400 hover:bg-stone-50 disabled:opacity-50';

export function Field({
  label,
  htmlFor,
  error,
  hint,
  optional,
  children,
}: {
  label: string;
  htmlFor: string;
  error?: string | null;
  hint?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1 flex items-baseline justify-between text-xs font-medium text-stone-700">
        {label}
        {optional && <span className="font-normal text-stone-400">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="mt-1 text-xs text-vermilion-600">
          {error}
        </p>
      ) : (
        hint && <p className="mt-1 text-xs text-stone-500">{hint}</p>
      )}
    </div>
  );
}

/** Move focus (and scroll) to the input an error is about. Field keys come
 *  from the server as e.g. `details.barCouncilId`; input ids drop the prefix. */
export function focusField(field: string | undefined) {
  if (!field) return;
  requestAnimationFrame(() => document.getElementById(field.replace(/^details\./, ''))?.focus());
}

/** A banner-style error for problems not tied to one field. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
      <Icon name="alert" size={15} className="mt-0.5" />
      {message}
    </p>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const info = ROLE_INFO[role];
  return (
    <span className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] font-medium ${info.tone}`}>
      {info.label}
    </span>
  );
}

export function VerificationBadge({ status }: { status: VerificationStatus }) {
  const info = VERIFICATION_INFO[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-2 py-0.5 text-[11px] font-medium ${info.tone}`}>
      {status === 'verified' && <Icon name="shield" size={12} />}
      {info.label}
    </span>
  );
}

/** A centred card for the login / signup pages. */
export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10 sm:py-14">
      <div className="rounded-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="font-serif text-2xl font-semibold tracking-tight text-maroon-800">{title}</h1>
        {subtitle && <p className="mt-1.5 text-sm text-stone-600">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </div>
    </div>
  );
}
