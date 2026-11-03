import { Router } from 'express';
import { z } from 'zod';
import { runCounter } from '../lib/counter.js';

export const counterRouter = Router();

const bodySchema = z.object({
  position: z.string()
    .min(20, 'describe the position in at least 20 characters')
    .max(2000),
  side: z.enum(['pro_bail', 'anti_bail']),
  offenceCategory: z
    .enum(['ordinary', 'economic', 'ndps', 'pmla', 'uapa', 'other_special'])
    .optional(),
});

/**
 * POST /api/counter  Counter Engine v0.
 *
 * Plain JSON for now (CounterEngine.md build order step 2) — SSE streaming
 * is a later step. Returns the classification plus three rounds: supporting
 * law, opposing submissions (with graph attacks folded in), and restrictive
 * statutes. Round 4 (rebuttals) is not built: it needs `outcome` labels
 * ARGUMENTS.md Stage C has not produced.
 */
counterRouter.post('/counter', async (req, res, next) => {
  try {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const result = await runCounter(parsed.data);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
