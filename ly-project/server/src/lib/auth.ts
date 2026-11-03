/**
 * Sessions: password hashing, the session cookie, and the middleware that
 * turns a cookie back into a user.
 *
 * The cookie holds a signed JWT with only the user id and a token version.
 * Role and verification status are NOT in the token — they are read from Mongo
 * on every request, so an admin approving or rejecting an account takes effect
 * immediately instead of whenever the cookie happens to expire.
 */
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { env, users } from '../config.js';
import type { Role, UserDoc } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `loadUser` when the request carries a valid session. */
      user?: UserDoc & { _id: ObjectId };
    }
  }
}

export const SESSION_COOKIE = 'lp_session';
const SESSION_DAYS = 7;
const BCRYPT_ROUNDS = 12;

export const hashPassword = (password: string) => bcrypt.hash(password, BCRYPT_ROUNDS);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

/**
 * A real bcrypt hash of a random string. Login compares against it when the
 * email does not exist, so "no such account" and "wrong password" take the
 * same time and an attacker cannot use response time to find registered emails.
 */
export const DUMMY_HASH = bcrypt.hashSync(Math.random().toString(36), BCRYPT_ROUNDS);

interface SessionClaims {
  sub: string; // user id
  tv: number;  // token version
}

/** Sign a session for this user and set it as an httpOnly cookie. */
export function startSession(res: Response, user: UserDoc & { _id: ObjectId }) {
  const claims: SessionClaims = { sub: String(user._id), tv: user.tokenVersion };
  const token = jwt.sign(claims, env.jwtSecret, { expiresIn: `${SESSION_DAYS}d` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,          // page JavaScript cannot read it, so XSS cannot steal it
    sameSite: 'lax',         // not sent on cross-site POSTs, which blocks CSRF
    secure: env.secureCookies,
    maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function endSession(res: Response) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure: env.secureCookies, path: '/' });
}

/**
 * Runs on every request. Attaches `req.user` if the cookie is valid and still
 * current; otherwise leaves it unset. Never rejects — routes decide that.
 */
export async function loadUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) return next();
  try {
    const claims = jwt.verify(token, env.jwtSecret) as SessionClaims;
    const user = await users.findOne({ _id: new ObjectId(claims.sub) });
    // A password change bumps tokenVersion, which retires every older cookie.
    if (user && user.tokenVersion === claims.tv) {
      req.user = user as UserDoc & { _id: ObjectId };
    } else {
      endSession(res);
    }
  } catch {
    // Expired, tampered with, or signed with an old secret: treat as logged out.
    endSession(res);
  }
  next();
}

/** 401 unless logged in. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
  next();
}

/** 403 unless logged in with one of these roles. Pending lawyers/judges do
 *  not count as lawyers/judges — see `requireVerified`. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'You do not have access to this.' });
    }
    next();
  };
}

/** For professional-only features: the role alone is not enough, an admin
 *  must have approved it. Admins also pass, so they can check and demo the
 *  features they are approving people for. */
export function requireVerified(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Please log in to continue.' });
    const { role, verification } = req.user;
    if (role === 'admin') return next();
    if (!roles.includes(role) || verification.status !== 'verified') {
      return res.status(403).json({ error: 'This feature is available to verified accounts only.' });
    }
    next();
  };
}
