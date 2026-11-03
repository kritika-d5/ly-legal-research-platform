/**
 * The lawyers' desk: client matters and the bail argument builder.
 * Verified lawyers only (admins too, for review).
 *
 * A "matter" is one of the lawyer's own folders with client and hearing
 * details attached, so the saved judgments, notes and folders from Phase 2
 * become a case file without a second copy of anything.
 */
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { folders, nodes, savedCases } from '../config.js';
import { requireVerified } from '../lib/auth.js';
import { AnalysisUnavailableError, analyseCase, BAIL_SOUGHT, MAX_FACTS_CHARS } from '../lib/caseAnalysis.js';
import { isSample, SAMPLE_FACTS, saveSampleIfClean, savedSample } from '../lib/sampleCase.js';
import { retrieveInCase } from '../lib/caseContext.js';
import { disagreeingJudgments, treatmentCounts } from '../lib/treatment.js';
import type { MatterDetails, NodeDoc } from '../types.js';
import { publicFolder } from './workspace.js';

export const lawyerRouter = Router();
lawyerRouter.use(requireVerified('lawyer'));

const isFlagged = (c: { neg: number; mixed: number }) => c.neg + c.mixed > 0;

/**
 * GET /api/lawyer/matters
 *
 * Every folder, with how many authorities it holds and how many of those a
 * later judgment disagreed with. Upcoming hearings first, then folders with no
 * date, then past hearings.
 */
lawyerRouter.get('/matters', async (req, res, next) => {
  try {
    const userId = req.user!._id;
    const [list, saved] = await Promise.all([
      folders.find({ userId }).toArray(),
      savedCases.find({ userId }).project<{ tid: number; folderIds: ObjectId[] }>({ tid: 1, folderIds: 1 }).toArray(),
    ]);
    const counts = await treatmentCounts([...new Set(saved.map((s) => s.tid))]);

    // For ordering only; a day's error at midnight just moves a matter between
    // "upcoming" and "past". The browser computes the displayed countdown in
    // the user's own timezone.
    const today = new Date().toISOString().slice(0, 10);
    const rank = (d?: string) => (!d ? 1 : d >= today ? 0 : 2);
    const matters = list
      .map((f) => {
        const inFolder = saved.filter((s) => s.folderIds.some((id) => id.equals(f._id!)));
        return {
          ...publicFolder(f, inFolder.length),
          flagged: inFolder.filter((s) => isFlagged(counts.get(s.tid)!)).length,
        };
      })
      .sort((a, b) => {
        const ra = rank(a.matter?.nextHearing);
        const rb = rank(b.matter?.nextHearing);
        if (ra !== rb) return ra - rb;
        const da = a.matter?.nextHearing ?? '';
        const db = b.matter?.nextHearing ?? '';
        // Upcoming: soonest first. Past: most recent first.
        return ra === 2 ? db.localeCompare(da) : da.localeCompare(db) || a.name.localeCompare(b.name);
      });
    res.json({ matters });
  } catch (err) {
    next(err);
  }
});

const optional = (max: number) => z.string().trim().max(max).optional().transform((v) => v || undefined);
const matterSchema = z.object({
  client: optional(120),
  court: optional(120),
  caseNumber: optional(80),
  stage: optional(80),
  nextHearing: z
    .string()
    .trim()
    .optional()
    .transform((v) => v || undefined)
    .refine((v) => v === undefined || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Hearing date must be a date'),
  issue: optional(500),
});

/** PUT /api/lawyer/matters/:id  replace the matter details on one of your folders. */
lawyerRouter.put('/matters/:id', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.id)) return res.status(404).json({ error: 'Matter not found.' });
    const parsed = matterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    // Drop empty fields so "cleared" means absent, not "".
    const matter = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined)) as MatterDetails;

    const updated = await folders.findOneAndUpdate(
      { _id: new ObjectId(req.params.id), userId: req.user!._id },
      Object.keys(matter).length ? { $set: { matter, updatedAt: new Date() } } : { $unset: { matter: '' }, $set: { updatedAt: new Date() } },
      { returnDocument: 'after' },
    );
    if (!updated) return res.status(404).json({ error: 'Matter not found.' });
    const count = await savedCases.countDocuments({ userId: req.user!._id, folderIds: updated._id });
    res.json({ matter: publicFolder(updated, count) });
  } catch (err) {
    next(err);
  }
});

const DEFAULT_ISSUE = 'the principles on which bail should be granted';
const PASSAGES_PER_AUTHORITY = 3;

/**
 * GET /api/lawyer/brief/:folderId?issue=…
 *
 * Everything the bail argument builder needs for one matter: each authority,
 * its citation, how later judgments treated it (and which ones disagreed),
 * the lawyer's own note, and the passages of the judgment most relevant to the
 * matter's issue, with their paragraph / page locators.
 *
 * Passage choice is retrieval, not generation: they are the judgment's actual
 * text, ranked by similarity to the issue. Only the court's own words are
 * offered, because a quoted statute or an earlier judgment quoted inside this
 * one is not what the case can be cited for.
 */
lawyerRouter.get('/brief/:folderId', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.folderId)) return res.status(404).json({ error: 'Matter not found.' });
    const userId = req.user!._id;
    const folder = await folders.findOne({ _id: new ObjectId(req.params.folderId), userId });
    if (!folder) return res.status(404).json({ error: 'Matter not found.' });

    const issueParam = typeof req.query.issue === 'string' ? req.query.issue.trim().slice(0, 500) : '';
    const issue = issueParam || folder.matter?.issue || folder.description || DEFAULT_ISSUE;

    const items = await savedCases.find({ userId, folderIds: folder._id }).toArray();
    const tids = items.map((i) => i.tid);
    const [counts, disagreeing, metaRows, passageLists] = await Promise.all([
      treatmentCounts(tids),
      disagreeingJudgments(tids),
      nodes
        .find({ _id: { $in: tids } })
        .project<Pick<NodeDoc, '_id' | 'neutral_citation' | 'publishdate'>>({ neutral_citation: 1, publishdate: 1 })
        .toArray(),
      Promise.all(
        tids.map(async (tid) =>
          (await retrieveInCase(tid, issue, 12)).filter((p) => p.contentType === 'court_text').slice(0, PASSAGES_PER_AUTHORITY),
        ),
      ),
    ]);
    const meta = new Map(metaRows.map((n) => [n._id, n]));

    const tierRank = { SC: 0, HC: 1, OTHER: 2 } as const;
    const authorities = items
      .map((i, idx) => ({
        tid: i.tid,
        title: i.title,
        year: i.year,
        date: meta.get(i.tid)?.publishdate ?? null,
        court: i.court,
        courtTier: i.courtTier,
        citation: meta.get(i.tid)?.neutral_citation ?? null,
        note: i.note,
        treatment: counts.get(i.tid)!,
        disagreedBy: disagreeing.get(i.tid)!,
        passages: passageLists[idx],
      }))
      // Supreme Court first, then newest first: the latest binding word leads.
      .sort((x, y) => tierRank[x.courtTier] - tierRank[y.courtTier] || String(y.date ?? '').localeCompare(String(x.date ?? '')));

    res.json({ matter: publicFolder(folder, items.length), issue, authorities, preparedBy: req.user!.name });
  } catch (err) {
    next(err);
  }
});

/** Each analysis is several Groq calls; this keeps one user from spending the
 *  whole free-tier quota. Keyed by account, since the route is login-only. */
const analysisLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 8,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => String(req.user!._id),
  message: { error: 'Too many analyses in a short time. Please wait a few minutes and try again.' },
});

const analysisSchema = z.object({
  facts: z
    .string()
    .trim()
    .min(80, 'Describe the facts in a little more detail (at least a few sentences).')
    // Longer documents are accepted and trimmed by analyseCase; this only stops abuse.
    .max(MAX_FACTS_CHARS * 4, 'That document is too long. Paste the relevant part of it instead.'),
  bailSought: z.enum(BAIL_SOUGHT).optional(),
  offenceCategory: z.enum(['ordinary', 'economic', 'ndps', 'pmla', 'uapa', 'other_special']).optional(),
  /** skip the saved result of the sample case and run it live */
  fresh: z.boolean().optional(),
});

/** GET /api/lawyer/analysis/sample  the sample case's facts, and whether a saved result exists. */
lawyerRouter.get('/analysis/sample', async (_req, res, next) => {
  try {
    res.json({ facts: SAMPLE_FACTS, saved: (await savedSample()) !== null });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/lawyer/analysis
 *
 * Bail case analysis from the client's facts: issues and sections, a check
 * against the bail factors, missing facts and weaknesses, similar judgments
 * from the corpus, and arguments for bail with the other side's answers
 * (the Counter Engine run on the accused's position). See lib/caseAnalysis.ts.
 * Nothing is stored: the facts are confidential client material. The one
 * exception is the built-in sample case (lib/sampleCase.ts), whose invented
 * facts and result are saved so a demonstration does not depend on the quota.
 */
lawyerRouter.post('/analysis', analysisLimiter, async (req, res, next) => {
  try {
    const parsed = analysisSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
    const { facts, fresh, ...given } = parsed.data;
    const sample = isSample(facts, given);
    if (sample && !fresh) {
      const saved = await savedSample();
      if (saved) return res.json({ ...saved, truncated: false, savedExample: true });
    }
    const result = await analyseCase(facts, given);
    if (sample) await saveSampleIfClean(result);
    res.json({ ...result, truncated: facts.length > MAX_FACTS_CHARS, savedExample: false });
  } catch (err) {
    if (err instanceof AnalysisUnavailableError) return res.status(503).json({ error: err.message });
    // Groq's free tier caps tokens per minute and per day; reaching here means
    // the fallback models (lib/llm.ts) were rate-limited too.
    if ((err as { status?: number }).status === 429) {
      return res.status(429).json({
        error: 'The AI service’s usage limit has been reached for now (Groq free tier). Please try again in a few minutes.',
      });
    }
    // Any other model failure (bad JSON twice, a Groq outage): say so plainly
    // rather than passing the provider's raw error text to the page.
    if ((err as { status?: number }).status || err instanceof SyntaxError || err instanceof z.ZodError) {
      console.error('[lawyer/analysis]', err);
      return res.status(502).json({ error: 'The AI service could not analyse these facts this time. Please try again.' });
    }
    next(err);
  }
});
