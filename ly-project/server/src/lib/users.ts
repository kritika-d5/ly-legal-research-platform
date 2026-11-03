/**
 * Account shapes: what a sign-up must contain for each role, and what of a
 * user document is ever allowed to leave the server.
 *
 * Validation lives here rather than in the routes so signup and profile-edit
 * agree on what a valid lawyer / judge / student record is.
 */
import { z } from 'zod';
import { users } from '../config.js';
import type { Role, RoleDetails, UserDoc, VerificationStatus } from '../types.js';

/** The roles a person may pick for themselves. `admin` is deliberately absent. */
export const SELF_SERVICE_ROLES = ['citizen', 'student', 'lawyer', 'judge'] as const;

/** Claiming to be a lawyer or judge is a claim about the real world, so those
 *  accounts wait for an admin. Citizens and students have nothing to check. */
export function initialVerification(role: Role): VerificationStatus {
  return role === 'lawyer' || role === 'judge' ? 'pending' : 'not_required';
}

/** Editing any of these after approval sends the account back for review —
 *  otherwise a verified lawyer could swap in someone else's enrolment number. */
export const VERIFIED_FIELDS: Partial<Record<Role, (keyof RoleDetails)[]>> = {
  lawyer: ['barCouncilId', 'barCouncilState'],
  judge: ['courtName', 'designation'],
};

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : undefined));

export const emailSchema = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);

/** bcrypt ignores everything past 72 bytes, so a longer limit would be a lie. */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters');

const lawyerDetails = z.object({
  barCouncilId: z
    .string()
    .trim()
    .min(3, 'Enter your Bar Council enrolment number')
    .max(40)
    .regex(/^[A-Za-z0-9/\- .]+$/, 'Enrolment number can contain letters, numbers, / and -'),
  barCouncilState: text(2, 60),
});

const judgeDetails = z.object({
  courtName: text(2, 120),
  designation: text(2, 80),
});

const studentDetails = z.object({
  institution: text(2, 120),
  programme: optionalText(80),
});

/** Parse `details` for a role; unknown keys are stripped, not stored. */
export function detailsSchemaFor(role: Role) {
  switch (role) {
    case 'lawyer':
      return lawyerDetails;
    case 'judge':
      return judgeDetails;
    case 'student':
      return studentDetails;
    default:
      return z.object({});
  }
}

const common = {
  name: text(2, 80),
  email: emailSchema,
  password: passwordSchema,
  city: optionalText(60),
  state: optionalText(60),
};

/** One schema per role, joined on `role` so zod reports the right missing field. */
export const signupSchema = z.discriminatedUnion('role', [
  z.object({ ...common, role: z.literal('citizen'), details: z.object({}).optional().default({}) }),
  z.object({ ...common, role: z.literal('student'), details: studentDetails }),
  z.object({ ...common, role: z.literal('lawyer'), details: lawyerDetails }),
  z.object({ ...common, role: z.literal('judge'), details: judgeDetails }),
]);

/** Everything about a user that the browser may see. Never the hash, never the token version. */
export function publicUser(u: UserDoc) {
  return {
    id: String(u._id),
    email: u.email,
    name: u.name,
    role: u.role,
    details: u.details ?? {},
    city: u.city ?? null,
    state: u.state ?? null,
    verification: {
      status: u.verification.status,
      reviewedAt: u.verification.reviewedAt ?? null,
      note: u.verification.note ?? null,
    },
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt ?? null,
  };
}

export type PublicUser = ReturnType<typeof publicUser>;

/** Idempotent; called at startup. The unique index is what actually stops two
 *  accounts sharing an email — the check in the signup route is only for a
 *  friendly error message and would race on its own. */
export async function ensureUserIndexes() {
  await users.createIndex({ email: 1 }, { unique: true, name: 'email_unique' });
  await users.createIndex({ 'verification.status': 1, createdAt: -1 }, { name: 'verification_queue' });
}

const FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  email: 'Email',
  password: 'Password',
  role: 'Account type',
  'details.barCouncilId': 'Bar Council enrolment number',
  'details.barCouncilState': 'State of enrolment',
  'details.courtName': 'Court',
  'details.designation': 'Designation',
  'details.institution': 'Institution',
};

/** Turn zod's first issue into `{ error, field }` a person can act on —
 *  "Bar Council enrolment number is required", not "Required". */
export function describeIssue(error: z.ZodError, prefix = '') {
  const issue = error.issues[0];
  const field = prefix + issue.path.join('.');
  const label = FIELD_LABELS[field] ?? 'This field';
  // Our own messages (e.g. "Password must be at least 8 characters") are kept;
  // only zod's generic defaults are rewritten.
  const generic = issue.message === 'Required' || issue.message.startsWith('String');
  let message = issue.message;
  if (issue.code === 'invalid_union_discriminator') {
    message = 'Choose an account type: citizen, student, lawyer or judge';
  } else if (generic && issue.code === 'invalid_type') {
    message = `${label} is required`;
  } else if (generic && issue.code === 'too_small') {
    message = issue.minimum === 1 ? `${label} is required` : `${label} is too short`;
  } else if (generic && issue.code === 'too_big') {
    message = `${label} is too long`;
  }
  return { error: message, field };
}
