/**
 * LegalPlatform API.
 *
 * Reads the `bail_rag` corpus produced by the LegalRAG-Data repo: 198
 * judgments, 7,722 embedded chunks, 336 citation edges. This service never
 * writes to those collections and never calls the Indian Kanoon API.
 */
import cors from 'cors';
import express from 'express';
import { chunks, client, env, nodes } from './config.js';
import { warmUp } from './lib/embed.js';
import { casesRouter } from './routes/cases.js';
import { bailRouter } from './routes/bail.js';
import { chatRouter } from './routes/chat.js';
import { firProxyRouter } from './routes/fir.js';
import { graphRouter } from './routes/graph.js';
import { searchRouter } from './routes/search.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res) => {
  const [nodeCount, chunkCount, embedded] = await Promise.all([
    nodes.countDocuments({}),
    chunks.countDocuments({}),
    chunks.countDocuments({ embedding: { $type: 'array' } }),
  ]);
  res.json({ ok: true, nodes: nodeCount, chunks: chunkCount, embedded, model: env.groqModel });
});

app.use('/api', searchRouter);
app.use('/api', casesRouter);
app.use('/api', chatRouter);
app.use('/api', bailRouter);
app.use('/api', graphRouter);
app.use('/api/fir', firProxyRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err?.message ?? 'internal error' });
});

async function main() {
  await client.connect();
  console.log('[mongo] connected to bail_rag');
  await warmUp(); // load BGE before the first request, not during it
  app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
