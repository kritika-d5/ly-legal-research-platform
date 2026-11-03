/**
 * Client for accounts: signup, login, profile, admin approval.
 *
 * There is no token handling here on purpose. The server sets an httpOnly
 * session cookie that this code cannot read, and the browser sends it with
 * every same-origin request by itself. Keeping the token out of JavaScript is
 * what stops a malicious script on the page from stealing a login.
 */

export type Role = 'citizen' | 'student' | 'lawyer' | 'judge' | 'admin';
export type SelfServiceRole = Exclude<Role, 'admin'>;
export type VerificationStatus = 'not_required' | 'pending' | 'verified' | 'rejected';

export interface RoleDetails {
  barCouncilId?: string;
  barCouncilState?: string;
  courtName?: string;
  designation?: string;
  institution?: string;
  programme?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  details: RoleDetails;
  city: string | null;
  state: string | null;
  verification: { status: VerificationStatus; reviewedAt: string | null; note: string | null };
  createdAt: string;
  lastLoginAt: string | null;
}

export interface SignupInput {
  role: SelfServiceRole;
  name: string;
  email: string;
  password: string;
  city?: string;
  state?: string;
  details: RoleDetails;
}

/** An API error that remembers which form field it is about, so the form can
 *  put the message next to the right input. */
export class ApiError extends Error {
  status: number;
  field?: string;
  constructor(message: string, status: number, field?: string) {
    super(message);
    this.status = status;
    this.field = field;
  }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.field);
  return data as T;
}

export const getMe = () => call<{ user: User | null }>('GET', '/api/auth/me').then((r) => r.user);
export const signup = (input: SignupInput) =>
  call<{ user: User }>('POST', '/api/auth/signup', input).then((r) => r.user);
export const login = (email: string, password: string) =>
  call<{ user: User }>('POST', '/api/auth/login', { email, password }).then((r) => r.user);
export const logout = () => call<{ ok: true }>('POST', '/api/auth/logout');

export interface ProfilePatch {
  name?: string;
  city?: string;
  state?: string;
  details?: RoleDetails;
}
export const updateProfile = (patch: ProfilePatch) =>
  call<{ user: User }>('PATCH', '/api/me/profile', patch).then((r) => r.user);
export const changePassword = (currentPassword: string, newPassword: string) =>
  call<{ ok: true }>('POST', '/api/me/password', { currentPassword, newPassword });

export type AdminFilter = 'pending' | 'verified' | 'rejected' | 'all';
export const listUsers = (status: AdminFilter) =>
  call<{ users: User[]; counts: Partial<Record<VerificationStatus, number>> }>(
    'GET',
    `/api/admin/users?status=${status}`,
  );
export const verifyUser = (id: string, decision: 'verified' | 'rejected', note?: string) =>
  call<{ user: User }>('POST', `/api/admin/users/${id}/verify`, { decision, note });

/* ---------------------------------------------------------------- labels */

export const ROLE_INFO: Record<Role, { label: string; blurb: string; tone: string }> = {
  citizen: {
    label: 'Citizen',
    blurb: 'Research bail law and file FIRs for yourself.',
    tone: 'bg-stone-100 text-stone-700 border-stone-300',
  },
  student: {
    label: 'Law student / Researcher',
    blurb: 'Study judgments, citation trends and precedent.',
    tone: 'bg-navy-50 text-navy-600 border-navy-200',
  },
  lawyer: {
    label: 'Lawyer',
    blurb: 'Build case research for clients. Needs Bar Council verification.',
    tone: 'bg-maroon-50 text-maroon-700 border-maroon-200',
  },
  judge: {
    label: 'Judge',
    blurb: 'Compare precedent and track treatment. Needs verification.',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
  },
  admin: {
    label: 'Admin',
    blurb: 'Approves lawyer and judge accounts.',
    tone: 'bg-stone-800 text-stone-50 border-stone-800',
  },
};

export const VERIFICATION_INFO: Record<VerificationStatus, { label: string; tone: string }> = {
  not_required: { label: 'Active', tone: 'bg-sage-50 text-sage-700 border-sage-200' },
  pending: { label: 'Verification pending', tone: 'bg-gold-50 text-gold-700 border-gold-200' },
  verified: { label: 'Verified', tone: 'bg-sage-50 text-sage-700 border-sage-200' },
  rejected: { label: 'Verification rejected', tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200' },
};

/** States and union territories — for "state of enrolment" and location. */
export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export const JUDGE_DESIGNATIONS = [
  'Supreme Court Judge',
  'High Court Judge',
  'District & Sessions Judge',
  'Additional Sessions Judge',
  'Civil Judge',
  'Judicial Magistrate',
  'Metropolitan Magistrate',
  'Other',
];

export const STUDENT_PROGRAMMES = ['LLB', 'BA LLB / BBA LLB', 'LLM', 'PhD', 'Independent researcher', 'Other'];
