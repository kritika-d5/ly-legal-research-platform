/**
 * LegalPlatform API.
 *
 * Reads the `bail_rag` corpus produced by the LegalRAG-Data repo: 198
 * judgments, 7,722 embedded chunks, 336 citation edges. This service never
 * writes to those collections and never calls the Indian Kanoon API.
 *
 * Accounts (signup, login, profiles, admin approval) and each user's saved
 * judgments, notes and folders live in a separate `legalplatform_app`
 * database — the only thing this service writes.
 */
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import { chunks, client, env, nodes } from './config.js';
import { modelStatus } from './lib/llm.js';
import { loadUser } from './lib/auth.js';
import { warmUp } from './lib/embed.js';
import { ensureUserIndexes } from './lib/users.js';
import { adminRouter } from './routes/admin.js';
import { authRouter } from './routes/auth.js';
import { casesRouter } from './routes/cases.js';
import { bailRouter } from './routes/bail.js';
import { chatRouter } from './routes/chat.js';
import { firProxyRouter } from './routes/fir.js';
import { counterRouter } from './routes/counter.js';
import { graphRouter } from './routes/graph.js';
import { judgeRouter } from './routes/judge.js';
import { lawyerRouter } from './routes/lawyer.js';
import { profileRouter } from './routes/profile.js';
import { searchRouter } from './routes/search.js';
import { sectionsRouter } from './routes/sections.js';
import { ensureWorkspaceIndexes, workspaceRouter } from './routes/workspace.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
// Attach req.user when a valid session cookie is present. Never blocks: the
// research routes stay public, and each protected router checks for itself.
app.use(loadUser);

app.get('/api/health', async (_req, res) => {
  const [nodeCount, chunkCount, embedded] = await Promise.all([
    nodes.countDocuments({}),
    chunks.countDocuments({}),
    chunks.countDocuments({ embedding: { $type: 'array' } }),
  ]);
  res.json({ ok: true, nodes: nodeCount, chunks: chunkCount, embedded, ...modelStatus() });
});

app.use('/api/auth', authRouter);
app.use('/api/me', profileRouter);
app.use('/api/me', workspaceRouter);
app.use('/api/admin', adminRouter);
app.use('/api/judge', judgeRouter);
app.use('/api/lawyer', lawyerRouter);
app.use('/api', searchRouter);
app.use('/api', casesRouter);
app.use('/api', sectionsRouter);
app.use('/api', chatRouter);
app.use('/api', bailRouter);
app.use('/api', graphRouter);
app.use('/api/fir', firProxyRouter);
app.use('/api', counterRouter);

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err?.message ?? 'internal error' });
});

async function main() {
  await client.connect();
  console.log('[mongo] connected to bail_rag');
  await ensureUserIndexes();
  await ensureWorkspaceIndexes();
  console.log('[mongo] legalplatform_app indexes ready');
  await warmUp(); // load BGE before the first request, not during it
  app.listen(env.port, () => {
    console.log(`[api] listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
