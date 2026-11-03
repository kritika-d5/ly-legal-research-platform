/**
 * FIR Assistant proxy route.
 *
 * Proxies all /api/fir/* requests to the FIR FastAPI backend (default
 * http://localhost:8000), stripping the /api/fir prefix so that:
 *
 *   /api/fir/cases            →  http://localhost:8000/cases
 *   /api/fir/cases/{id}/state →  http://localhost:8000/cases/{id}/state
 *
 * The FIR backend owns its own routes, CaseState schema, LLM providers,
 * and SQLite persistence. This proxy exists solely so the browser can use
 * a single origin (the LY dev server) without CORS issues.
 *
 * Failure isolation: if the FIR backend is down or returns an error, the
 * proxy returns a clear JSON error. The LY server never crashes.
 *
 * Ownership: the FIR Assistant needs a login. After `requireAuth`, the proxy
 * tells the FIR backend who the user is (X-User-Id) and proves the request came
 * from here (X-Proxy-Secret, shared via .env). The backend then shows each user
 * only their own cases. The browser cannot set either header: the proxy builds
 * the outgoing headers itself and forwards nothing else from the client.
 */
import { Router } from 'express';
import { env } from '../config.js';
import { requireAuth } from '../lib/auth.js';

export const firProxyRouter = Router();
firProxyRouter.use(requireAuth);

const FIR_BASE_URL = process.env.FIR_BACKEND_URL || 'http://localhost:8000';
const FIR_TIMEOUT_MS = 120_000; // 2 minutes — LLM calls can be slow

/**
 * Strip the /api/fir prefix and forward the remainder to the FIR backend.
 * e.g. /api/fir/cases/abc/state → /cases/abc/state
 *
 * Uses Router.use() as middleware — the Express 5-compatible catch-all.
 * (Express 5 removed the bare '*' wildcard pattern.)
 */
firProxyRouter.use(async (req, res) => {
  if (!env.firSharedSecret) {
    // Without it the backend would either refuse us or (in standalone mode)
    // show every user every FIR. Fail loudly instead.
    return res.status(503).json({
      error: 'FIR Assistant is not configured',
      detail: 'Set FIR_SHARED_SECRET in ly-project/server/.env and the same value as PROXY_SHARED_SECRET in fir_chatbot/.env, then restart both servers.',
    });
  }

  // Rebuild the path after /api/fir
  const firPath = req.path.replace(/^\//, ''); // remove leading slash
  const targetUrl = `${FIR_BASE_URL}/${firPath}`;

  // Preserve query string
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const fullUrl = `${targetUrl}${qs}`;

  // Build headers — forward content-type and accept, plus a proxy marker
  const headers: Record<string, string> = {
    'Content-Type': req.headers['content-type'] || 'application/json',
    'Accept': 'application/json',
    'X-Proxied-By': 'LY',
    'X-Proxy-Secret': env.firSharedSecret,
    'X-User-Id': String(req.user!._id),
  };

  // Forward the request body for POST/PUT/PATCH
  let body: Buffer | undefined;
  if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
    body = Buffer.from(JSON.stringify(req.body));
    headers['Content-Length'] = String(body.length);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FIR_TIMEOUT_MS);

  try {
    const upstream = await fetch(fullUrl, {
      method: req.method,
      headers,
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // Read the response
    const contentType = upstream.headers.get('content-type') || '';
    const text = await upstream.text();

    // Pass through the status code and content-type
    res.status(upstream.status);
    if (contentType.includes('application/json')) {
      res.setHeader('Content-Type', 'application/json');
    }

    // Try to parse JSON for cleaner error handling, but pass through as-is
    // if it isn't JSON (e.g. error pages).
    if (contentType.includes('application/json')) {
      try {
        const data = JSON.parse(text);
        // For non-2xx responses, ensure there's an error field
        if (!upstream.ok && !data.error && !data.detail) {
          res.json({ error: `FIR backend returned ${upstream.status}`, detail: data });
          return;
        }
        res.json(data);
      } catch {
        // Malformed JSON from upstream — wrap it
        res.json({ error: 'FIR backend returned malformed response', upstream_status: upstream.status });
      }
    } else {
      res.send(text);
    }
  } catch (err: any) {
    clearTimeout(timeout);

    // Determine if it's a connection error or timeout
    const isTimeout = err?.name === 'AbortError';
    const isConnection = err?.cause?.code === 'ECONNREFUSED' || err?.code === 'ECONNREFUSED';

    if (isTimeout) {
      res.status(504).json({
        error: 'FIR backend timed out',
        detail: 'The FIR Assistant backend took too long to respond. Please try again.',
      });
    } else if (isConnection) {
      res.status(502).json({
        error: 'FIR backend unavailable',
        detail: 'The FIR Assistant backend is not running. Please start it with: uvicorn app.main:app --reload',
      });
    } else {
      res.status(502).json({
        error: 'FIR backend error',
        detail: 'Could not reach the FIR Assistant backend. Please check that it is running on localhost:8000.',
      });
    }
  }
});
