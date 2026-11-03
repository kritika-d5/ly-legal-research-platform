import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { MongoServerError } from 'mongodb';
import { z } from 'zod';
import { users } from '../config.js';
import {
  DUMMY_HASH,
  endSession,
  hashPassword,
  startSession,
  verifyPassword,
} from '../lib/auth.js';
import { describeIssue, emailSchema, initialVerification, publicUser, signupSchema } from '../lib/users.js';
import type { UserDoc } from '../types.js';

export const authRouter = Router();

/**
 * Per-IP limits on the two endpoints that accept a password. Without them a
 * script could try thousands of passwords a minute against one account.
 * In-memory, so they reset when the server restarts — fine for one process.
 */
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skipSuccessfulRequests: true, // only failed attempts count
  message: { error: 'Too many login attempts. Please wait 15 minutes and try again.' },
});

const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many sign-ups from this network. Please try again later.' },
});

/** POST /api/auth/signup  create an account and log straight in. */
authRouter.post('/signup', signupLimiter, async (req, res, next) => {
  try {
    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json(describeIssue(parsed.error));
    const { password, ...input } = parsed.data;
    const now = new Date();

    const doc: UserDoc = {
      email: input.email,
      name: input.name,
      role: input.role,
      details: input.details,
      city: input.city,
      state: input.state,
      passwordHash: await hashPassword(password),
      verification: { status: initialVerification(input.role) },
      tokenVersion: 0,
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };

    try {
      const { insertedId } = await users.insertOne(doc);
      const user = { ...doc, _id: insertedId };
      startSession(res, user);
      res.status(201).json({ user: publicUser(user) });
    } catch (err) {
      // 11000 = duplicate key on the unique email index.
      if (err instanceof MongoServerError && err.code === 11000) {
        return res.status(409).json({ error: 'An account with this email already exists. Try logging in.', field: 'email' });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

const loginSchema = z.object({ email: emailSchema, password: z.string().min(1).max(200) });

/** POST /api/auth/login */
authRouter.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter your email and password.' });
    const { email, password } = parsed.data;

    const user = await users.findOne({ email });
    // Always run bcrypt, even for an unknown email, so both failures look identical.
    const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok) {
      // Deliberately vague: saying "no account with this email" would let anyone
      // test which emails are registered.
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    const lastLoginAt = new Date();
    await users.updateOne({ _id: user._id }, { $set: { lastLoginAt } });
    startSession(res, user);
    res.json({ user: publicUser({ ...user, lastLoginAt }) });
  } catch (err) {
    next(err);
  }
});

/** POST /api/auth/logout  always succeeds, even if already logged out. */
authRouter.post('/logout', (_req, res) => {
  endSession(res);
  res.json({ ok: true });
});

/** GET /api/auth/me  who is logged in. `{ user: null }` rather than a 401, so
 *  the frontend can ask on every page load without logging an error. */
authRouter.get('/me', (req, res) => {
  res.json({ user: req.user ? publicUser(req.user) : null });
});
