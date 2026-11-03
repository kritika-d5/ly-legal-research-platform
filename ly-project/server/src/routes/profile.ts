import { Router } from 'express';
import { z } from 'zod';
import { users } from '../config.js';
import { hashPassword, requireAuth, startSession, verifyPassword } from '../lib/auth.js';
import { VERIFIED_FIELDS, describeIssue, detailsSchemaFor, passwordSchema, publicUser } from '../lib/users.js';
import type { RoleDetails, UserDoc } from '../types.js';

export const profileRouter = Router();
profileRouter.use(requireAuth);

/** GET /api/me/profile */
profileRouter.get('/profile', (req, res) => {
  res.json({ user: publicUser(req.user!) });
});

/**
 * PATCH /api/me/profile  edit name, location, and role details.
 *
 * Email and role are not editable here: email is the login identity, and a
 * role change would need re-verification rules of its own. Both are Phase 4.
 */
const profilePatchSchema = z.object({
  name: z.string().trim().min(2).max(80).optional(),
  city: z.string().trim().max(60).optional(),
  state: z.string().trim().max(60).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

profileRouter.patch('/profile', async (req, res, next) => {
  try {
    const parsed = profilePatchSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(describeIssue(parsed.error));
    const user = req.user!;
    const { name, city, state, details } = parsed.data;
    const $set: Partial<UserDoc> = { updatedAt: new Date() };
    const $unset: Partial<Record<'city' | 'state', ''>> = {};
    if (name !== undefined) $set.name = name;
    // An emptied field is removed rather than stored as "".
    for (const [key, value] of [['city', city], ['state', state]] as const) {
      if (value === undefined) continue;
      if (value) $set[key] = value;
      else $unset[key] = '';
    }

    if (details !== undefined) {
      // Validate the merged result, so a partial edit cannot leave a lawyer
      // without an enrolment number.
      const merged = detailsSchemaFor(user.role).safeParse({ ...user.details, ...details });
      if (!merged.success) return res.status(400).json(describeIssue(merged.error, 'details.'));
      const newDetails = merged.data as RoleDetails;
      $set.details = newDetails;

      // Changing a checked credential sends the account back to the queue.
      const watched = VERIFIED_FIELDS[user.role] ?? [];
      const changed = watched.some((k) => (user.details?.[k] ?? '') !== (newDetails[k] ?? ''));
      if (changed && user.verification.status !== 'pending') {
        $set.verification = { status: 'pending' };
      }
    }

    const updated = await users.findOneAndUpdate({ _id: user._id }, { $set, $unset }, { returnDocument: 'after' });
    res.json({ user: publicUser(updated!) });
  } catch (err) {
    next(err);
  }
});

const passwordChangeSchema = z.object({
  currentPassword: z.string().min(1, 'Enter your current password'),
  newPassword: passwordSchema,
});

/**
 * POST /api/me/password
 *
 * Bumps tokenVersion, which logs out every other browser this account is
 * signed in on, then issues a fresh cookie so this one stays logged in.
 */
profileRouter.post('/password', async (req, res, next) => {
  try {
    const parsed = passwordChangeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(describeIssue(parsed.error));
    const user = req.user!;
    const { currentPassword, newPassword } = parsed.data;

    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'Current password is incorrect.', field: 'currentPassword' });
    }

    const updated = await users.findOneAndUpdate(
      { _id: user._id },
      {
        $set: { passwordHash: await hashPassword(newPassword), updatedAt: new Date() },
        $inc: { tokenVersion: 1 },
      },
      { returnDocument: 'after' },
    );
    startSession(res, updated!);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
