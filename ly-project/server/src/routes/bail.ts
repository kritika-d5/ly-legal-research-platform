import { Router } from 'express';
import { env, nodes } from '../config.js';
import {
  BAIL_ANALYSIS_SYSTEM,
  bailContext,
  formatBailPassages,
  parseAnalysis,
  type BailAnalysis,
  type BailPassage,
} from '../lib/bailAnalysis.js';
import { groq } from '../lib/llm.js';

export const bailRouter = Router();

interface BailAnalysisResponse {
  tid: number;
  title: string;
  analysis: BailAnalysis;
  passages: BailPassage[];
  model: string;
  generatedAt: string;
}

/**
 * The corpus never changes, so an analysis only goes stale if the prompt does.
 * Kept in memory rather than written to Mongo: this service is read-only
 * against `bail_rag`, and a restart re-deriving a few analyses is cheap.
 */
const cache = new Map<number, BailAnalysisResponse>();

/**
 * GET /api/cases/:tid/bail-analysis  the cached analysis, if one exists.
 * Never calls the model, so the case page can show a known outcome on load.
 */
bailRouter.get('/cases/:tid/bail-analysis', (req, res) => {
  const hit = cache.get(Number(req.params.tid));
  if (!hit) return res.status(404).json({ error: 'not analysed yet' });
  res.json(hit);
});

/**
 * POST /api/cases/:tid/bail-analysis  outcome, reasons, factors, conditions
 * and a structured summary, each pinned to the passages it came from.
 * `?refresh=1` ignores the cache.
 */
bailRouter.post('/cases/:tid/bail-analysis', async (req, res, next) => {
  try {
    const tid = Number(req.params.tid);
    if (!req.query.refresh && cache.has(tid)) return res.json(cache.get(tid));
    if (!env.groqApiKey) {
      return res.status(503).json({ error: 'GROQ_API_KEY is not set in server/.env' });
    }
    const node = await nodes.findOne({ _id: tid }, { projection: { title: 1, docsource: 1 } });
    if (!node) return res.status(404).json({ error: 'case not found' });

    const passages = await bailContext(tid);
    if (!passages.length) return res.status(404).json({ error: 'no chunks for this case', tid });

    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0.1, // extraction, not composition
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: BAIL_ANALYSIS_SYSTEM },
        {
          role: 'user',
          content: `JUDGMENT: ${node.title}\nCOURT: ${node.docsource ?? 'unknown'}\n\nEXTRACTS (${passages.length}, in document order):\n${formatBailPassages(passages)}`,
        },
      ],
    });

    const result: BailAnalysisResponse = {
      tid,
      title: node.title,
      analysis: parseAnalysis(completion.choices[0]?.message?.content ?? '', passages),
      passages,
      model: env.groqModel,
      generatedAt: new Date().toISOString(),
    };
    cache.set(tid, result);
    res.json(result);
  } catch (err) {
    next(err);
  }
});
