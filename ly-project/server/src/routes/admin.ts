import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { users } from '../config.js';
import { requireRole } from '../lib/auth.js';
import { publicUser } from '../lib/users.js';
import type { VerificationStatus } from '../types.js';

export const adminRouter = Router();
adminRouter.use(requireRole('admin'));

const listSchema = z.object({
  status: z.enum(['pending', 'verified', 'rejected', 'not_required', 'all']).default('pending'),
});

/**
 * GET /api/admin/users?status=pending
 *
 * The verification queue. Oldest pending first, so nobody waits forever;
 * every other view newest first.
 */
adminRouter.get('/users', async (req, res, next) => {
  try {
    const parsed = listSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Unknown status filter.' });
    const { status } = parsed.data;

    const filter = status === 'all' ? {} : { 'verification.status': status as VerificationStatus };
    const sort = status === 'pending' ? { createdAt: 1 as const } : { createdAt: -1 as const };
    const [list, counts] = await Promise.all([
      users.find(filter).sort(sort).limit(200).toArray(),
      users.aggregate<{ _id: VerificationStatus; n: number }>([
        { $group: { _id: '$verification.status', n: { $sum: 1 } } },
      ]).toArray(),
    ]);

    res.json({
      users: list.map(publicUser),
      counts: Object.fromEntries(counts.map((c) => [c._id, c.n])),
    });
  } catch (err) {
    next(err);
  }
});

const verifySchema = z.object({
  decision: z.enum(['verified', 'rejected']),
  /** Shown to the user on their profile — say why, especially on a rejection. */
  note: z.string().trim().max(300).optional(),
});

/** POST /api/admin/users/:id/verify  approve or reject a lawyer / judge. */
adminRouter.post('/users/:id/verify', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'User not found.' });
    const parsed = verifySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { decision, note } = parsed.data;

    // Only accounts that need checking can be approved: approving a citizen
    // would mean nothing, and an admin cannot "verify" themselves.
    const updated = await users.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), role: { $in: ['lawyer', 'judge'] } },
      {
        $set: {
          verification: {
            status: decision,
            reviewedBy: req.user!._id,
            reviewedAt: new Date(),
            ...(note ? { note } : {}),
          },
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'No lawyer or judge account with that id.' });
    res.json({ user: publicUser(updated) });
  } catch (err) {
    next(err);
  }
});
