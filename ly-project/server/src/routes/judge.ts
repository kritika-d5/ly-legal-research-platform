/**
 * The judges' research desk: treatment timelines, side-by-side comparison,
 * and research memos. Verified judges only (admins too, for review).
 *
 * Everything here describes precedent. Nothing here suggests an outcome —
 * see COMPARE_SYSTEM in lib/llm.ts for how that boundary is held in the model.
 */
import { Router } from 'express';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { edges, env, folders, nodes, savedCases } from '../config.js';
import { requireVerified } from '../lib/auth.js';
import { retrieveInCase } from '../lib/caseContext.js';
import { COMPARE_SYSTEM, formatPassages, groq } from '../lib/llm.js';
import { deriveTier } from '../lib/search.js';
import { treatmentCounts, type Polarity } from '../lib/treatment.js';
import type { NodeDoc } from '../types.js';

export const judgeRouter = Router();
judgeRouter.use(requireVerified('judge'));

const yearOf = (n: Partial<NodeDoc>) => Number(String(n.publishdate ?? '').slice(0, 4)) || null;

/**
 * GET /api/judge/treatment/:tid
 *
 * Every later judgment in the library that cites this one, oldest first, with
 * how it treated it. "Later" is by date: a citing case is by definition later,
 * but the list is sorted so the story reads forward in time.
 */
judgeRouter.get('/treatment/:tid', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const node = await nodes.findOne({ _id: tid }, { projection: { title: 1, publishdate: 1, docsource: 1 } });
    if (!node) return res.status(404).json({ error: 'case not found' });

    const [citing, citesCount] = await Promise.all([
      edges.find({ dst: tid }).toArray(),
      edges.countDocuments({ src: tid }),
    ]);
    const sources = await nodes
      .find({ _id: { $in: citing.map((e) => e.src) } })
      .project<Pick<NodeDoc, '_id' | 'title' | 'publishdate' | 'docsource'>>({ title: 1, publishdate: 1, docsource: 1 })
      .toArray();
    const byId = new Map(sources.map((n) => [n._id, n]));

    const timeline = citing
      .map((e) => {
        const n = byId.get(e.src);
        return {
          tid: e.src,
          title: n?.title ?? String(e.src),
          year: n ? yearOf(n) : null,
          date: n?.publishdate ?? null,
          courtTier: deriveTier(n?.docsource),
          polarity: (e.polarity ?? 'unknown') as Polarity,
          polarityCounts: e.polarity_counts ?? null,
        };
      })
      .sort((a, b) => String(a.date ?? '9999').localeCompare(String(b.date ?? '9999')));

    const summary = { pos: 0, neg: 0, mixed: 0, neutral: 0, unknown: 0 } as Record<Polarity, number>;
    for (const t of timeline) summary[t.polarity] += 1;

    res.json({
      case: { tid, title: node.title, year: yearOf(node), date: node.publishdate ?? null, courtTier: deriveTier(node.docsource), court: node.docsource ?? 'unknown' },
      timeline,
      summary,
      citesCount,
    });
  } catch (err) {
    next(err);
  }
});

const compareSchema = z.object({
  a: z.number().int().positive(),
  b: z.number().int().positive(),
  question: z.string().trim().max(500).optional(),
});

const DEFAULT_QUESTION = 'What principle on bail does each judgment lay down, and on what reasoning?';

/**
 * Questions that ask for an outcome ("should I grant bail to the accused?").
 * The prompt already refuses these, but a model can drift, so the refusal is
 * also made here, deterministically, before the model says anything.
 */
// "Should the court refuse bail here?" asks for an outcome; "When may the
// court cancel bail?" asks about the law. So "may/can" only counts with I/we.
const ASKS_FOR_OUTCOME =
  /\b(should|shall|must)\s+(i|we|the court|the judge|you)\b[^?]*\b(grant|refuse|reject|deny|allow|release|cancel|decide)\b|\b(can|may|do|would)\s+(i|we)\b[^?]*\b(grant|refuse|reject|deny|allow|release|cancel)\b|\b(grant|refuse|deny)\s+(him|her|them|the accused)\b|\bwhat should (i|we|the court) (do|decide)\b/i;

export const OUTCOME_NOTICE =
  'This tool compares what the judgments say. It does not suggest how any case should be decided. ' +
  'The comparison below is on the underlying legal point.';

/**
 * POST /api/judge/compare  { a, b, question? }  — streamed over SSE.
 *
 * Same shape as case chat: a `sources` event first (so the passages are on
 * screen before the model says anything about them), then `token`s, `done`.
 */
judgeRouter.post('/compare', async (req, res, next) => {
  try {
    const parsed = compareSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Choose two judgments to compare.' });
    const { a, b } = parsed.data;
    const question = parsed.data.question || DEFAULT_QUESTION;
    if (a === b) return res.status(400).json({ error: 'Choose two different judgments.' });
    if (!env.groqApiKey) return res.status(503).json({ error: 'GROQ_API_KEY is not set in server/.env' });

    const found = await nodes
      .find({ _id: { $in: [a, b] } })
      .project<Pick<NodeDoc, '_id' | 'title' | 'publishdate' | 'docsource'>>({ title: 1, publishdate: 1, docsource: 1 })
      .toArray();
    const nodeA = found.find((n) => n._id === a);
    const nodeB = found.find((n) => n._id === b);
    if (!nodeA || !nodeB) return res.status(404).json({ error: 'One of those judgments was not found.' });

    // Fewer passages each than single-case chat: two judgments share one
    // context window and Groq's free tier meters tokens per minute.
    const [passagesA, passagesB] = await Promise.all([
      retrieveInCase(a, question, 6),
      retrieveInCase(b, question, 6),
    ]);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    send('sources', { a: passagesA, b: passagesB });
    if (ASKS_FOR_OUTCOME.test(question)) send('notice', { text: OUTCOME_NOTICE });

    const describe = (label: string, n: typeof nodeA) =>
      `JUDGMENT ${label}: ${n.title}\nCOURT: ${n.docsource ?? 'unknown'}\nDATE: ${n.publishdate ?? 'unknown'}`;
    const context = [
      describe('A', nodeA),
      'EXTRACTS FROM A:',
      formatPassages(passagesA, 'A'),
      '',
      describe('B', nodeB),
      'EXTRACTS FROM B:',
      formatPassages(passagesB, 'B'),
    ].join('\n');

    const stream = await groq().chat.completions.create({
      model: env.groqModel,
      stream: true,
      // 0, not chat's 0.2: in testing, even slight sampling let the model
      // attach a citation to a claim that was not in the cited extract.
      temperature: 0,
      messages: [
        { role: 'system', content: COMPARE_SYSTEM },
        { role: 'user', content: `${context}\n\nRESEARCH QUESTION: ${question}` },
      ],
    });
    for await (const part of stream) {
      const delta = part.choices[0]?.delta?.content;
      if (delta) send('token', { text: delta });
    }
    send('done', {});
    res.end();
  } catch (err) {
    if (res.headersSent) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: String(err) })}\n\n`);
      return res.end();
    }
    next(err);
  }
});

/**
 * GET /api/judge/memo/:folderId
 *
 * Everything a research memo needs from one of the judge's own folders: the
 * saved judgments (with their private notes), each one's court and date, and
 * how later judgments in the library treated it. The memo is assembled and
 * printed in the browser; nothing is generated by a model.
 */
judgeRouter.get('/memo/:folderId', async (req, res, next) => {
  try {
    if (!ObjectId.isValid(req.params.folderId)) return res.status(404).json({ error: 'Folder not found.' });
    const userId = req.user!._id;
    const folder = await folders.findOne({ _id: new ObjectId(req.params.folderId), userId });
    if (!folder) return res.status(404).json({ error: 'Folder not found.' });

    const items = await savedCases.find({ userId, folderIds: folder._id }).toArray();
    const counts = await treatmentCounts(items.map((i) => i.tid));
    const metaRows = await nodes
      .find({ _id: { $in: items.map((i) => i.tid) } })
      .project<Pick<NodeDoc, '_id' | 'neutral_citation' | 'publishdate'>>({ neutral_citation: 1, publishdate: 1 })
      .toArray();
    const meta = new Map(metaRows.map((n) => [n._id, n]));

    // Supreme Court first, then by date: the order authorities are usually cited in.
    const tierRank = { SC: 0, HC: 1, OTHER: 2 } as const;
    const authorities = items
      .map((i) => ({
        tid: i.tid,
        title: i.title,
        year: i.year,
        date: meta.get(i.tid)?.publishdate ?? null,
        court: i.court,
        courtTier: i.courtTier,
        citation: meta.get(i.tid)?.neutral_citation ?? null,
        note: i.note,
        treatment: counts.get(i.tid)!,
      }))
      .sort((x, y) => tierRank[x.courtTier] - tierRank[y.courtTier] || String(x.date ?? '').localeCompare(String(y.date ?? '')));

    res.json({
      folder: { id: String(folder._id), name: folder.name, description: folder.description ?? null },
      authorities,
      preparedBy: req.user!.name,
    });
  } catch (err) {
    next(err);
  }
});
