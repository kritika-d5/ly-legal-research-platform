import { Router } from 'express';
import { z } from 'zod';
import { explainPassages, MAX_EXPLAINED } from '../lib/explain.js';
import { searchCases, searchPassages } from '../lib/search.js';

export const searchRouter = Router();

const querySchema = z.object({
  q: z.string().min(2, 'query too short'),
  courtTier: z.enum(['SC', 'HC', 'OTHER']).optional(),
  yearFrom: z.coerce.number().int().optional(),
  yearTo: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  /** comma-separated; omit for the safe default of court_text + editorial */
  contentTypes: z.string().optional(),
});

const CONTENT_TYPES = [
  'court_text', 'quoted_case', 'quoted_statute', 'quoted_other', 'editorial',
] as const;

function parseOptions(raw: z.infer<typeof querySchema>) {
  const contentTypes = raw.contentTypes
    ?.split(',')
    .map((s) => s.trim())
    .filter((s): s is (typeof CONTENT_TYPES)[number] =>
      (CONTENT_TYPES as readonly string[]).includes(s));
  return {
    contentTypes,
    courtTier: raw.courtTier,
    yearFrom: raw.yearFrom,
    yearTo: raw.yearTo,
    limit: raw.limit,
  };
}

/** GET /api/search?q=...  ranked CASES, which is what the search screen shows. */
searchRouter.get('/search', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const t0 = Date.now();
    const results = await searchCases(parsed.data.q, parseOptions(parsed.data));
    res.json({ query: parsed.data.q, tookMs: Date.now() - t0, count: results.length, results });
  } catch (err) {
    next(err);
  }
});

const explainSchema = z.object({
  q: z.string().min(2, 'query too short'),
  ids: z.array(z.string()).min(1).max(MAX_EXPLAINED),
});

/** POST /api/search/explain {q, ids}  why each result was returned. Separate
 *  from /search so the ranking renders before the LLM call finishes. */
searchRouter.post('/search/explain', async (req, res, next) => {
  try {
    const parsed = explainSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const t0 = Date.now();
    const explanations = await explainPassages(parsed.data.q, parsed.data.ids);
    res.json({ query: parsed.data.q, tookMs: Date.now() - t0, explanations });
  } catch (err) {
    next(err);
  }
});

/** GET /api/search/passages?q=...  flat passage ranking, for debugging relevance. */
searchRouter.get('/search/passages', async (req, res, next) => {
  try {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: parsed.error.issues[0].message });
    }
    const t0 = Date.now();
    const passages = await searchPassages(parsed.data.q, parseOptions(parsed.data));
    res.json({ query: parsed.data.q, tookMs: Date.now() - t0, count: passages.length, passages });
  } catch (err) {
    next(err);
  }
});
