/**
 * IPC ⇄ BNS and CrPC ⇄ BNSS lookups (lib/sectionMap.ts). Public, like the
 * rest of the research routes: a citizen reading an FIR under the BNS needs
 * this as much as a lawyer does.
 */
import { Router } from 'express';
import { z } from 'zod';
import { nodes } from '../config.js';
import { mapMentions, mapSection, parseQuery, SECTION_MAP_SOURCE } from '../lib/sectionMap.js';

export const sectionsRouter = Router();

const lookupSchema = z.object({
  q: z.string().trim().min(1, 'Enter a section, e.g. 420 or BNS 318(4)').max(80),
  code: z.enum(['IPC', 'BNS', 'CrPC', 'BNSS']).optional(),
});

/** GET /api/sections?q=420&code=IPC  one section and its equivalents. */
sectionsRouter.get('/sections', (req, res) => {
  const parsed = lookupSchema.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.issues[0].message });
  const query = parseQuery(parsed.data.q, parsed.data.code);
  if (!query) return res.status(400).json({ error: 'No section number found. Try “420”, “IPC 302” or “BNSS 483”.' });
  res.json({ ...mapSection(query.code, query.section), source: SECTION_MAP_SOURCE });
});

/**
 * GET /api/cases/:tid/sections  every IPC / CrPC section the judgment refers
 * to, with its BNS / BNSS equivalent. CrPC references in judgments before
 * 1 April 1974 are to the 1898 Code and come back unmapped (`crpc1898`).
 */
sectionsRouter.get('/cases/:tid/sections', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    const node = await nodes.findOne({ _id: tid }, { projection: { text: 1, publishdate: 1 } });
    if (!node) return res.status(404).json({ error: 'Case not found.' });
    const mentions = mapMentions(node.text ?? '', node.publishdate).filter((m) => m.code === 'IPC' || m.code === 'CrPC');
    res.json({ tid, decided: node.publishdate ?? null, mentions, source: SECTION_MAP_SOURCE });
  } catch (err) {
    next(err);
  }
});
