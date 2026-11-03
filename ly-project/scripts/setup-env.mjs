#!/usr/bin/env node
/**
 * Fills in the secrets the app needs, so a fresh checkout (or an older .env
 * from before user accounts) starts without hand-editing. Run by
 * start-all.bat before the servers start; safe to run any number of times.
 *
 *   server/.env       JWT_SECRET         signs login cookies (32+ characters)
 *   server/.env       FIR_SHARED_SECRET  proves FIR requests came through the login check
 *   fir-service/.env  PROXY_SHARED_SECRET  must equal FIR_SHARED_SECRET
 *
 * Only empty or missing values are generated; an existing secret is never
 * replaced (a new JWT_SECRET would log everyone out). If the two shared
 * secrets differ, the FIR service's copy is set to the server's.
 *
 * Usage: node scripts/setup-env.mjs [path to ly-project]
 */
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..'));
const serverEnv = join(root, 'server', '.env');
const firEnv = join(root, 'fir-service', '.env');

for (const file of [serverEnv, firEnv]) {
  if (!existsSync(file)) {
    console.error(`  MISSING: ${file}`);
    process.exit(1);
  }
}

/** A .env file kept as lines, so comments and order survive an edit. */
function load(file) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const crlf = readFileSync(file, 'utf8').includes('\r\n');
  let changed = false;
  const find = (key) => lines.findIndex((l) => new RegExp(`^\\s*${key}\\s*=`).test(l));
  return {
    get(key) {
      const i = find(key);
      if (i < 0) return '';
      return lines[i].slice(lines[i].indexOf('=') + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
    },
    set(key, value) {
      const i = find(key);
      if (i >= 0) lines[i] = `${key}=${value}`;
      else {
        if (lines.length && lines[lines.length - 1] === '') lines.pop();
        lines.push(`${key}=${value}`, '');
      }
      changed = true;
    },
    save() {
      if (changed) writeFileSync(file, lines.join(crlf ? '\r\n' : '\n'));
    },
  };
}

const secret = (bytes) => randomBytes(bytes).toString('hex');
const server = load(serverEnv);
const fir = load(firEnv);

if (server.get('JWT_SECRET').length < 32) {
  server.set('JWT_SECRET', secret(48));
  console.log('  Generated JWT_SECRET in server\\.env');
}

const shared = server.get('FIR_SHARED_SECRET');
const proxy = fir.get('PROXY_SHARED_SECRET');
if (!shared && !proxy) {
  const s = secret(32);
  server.set('FIR_SHARED_SECRET', s);
  fir.set('PROXY_SHARED_SECRET', s);
  console.log('  Generated the FIR shared secret (server\\.env and fir-service\\.env)');
} else if (!shared) {
  server.set('FIR_SHARED_SECRET', proxy);
  console.log('  Copied PROXY_SHARED_SECRET into server\\.env as FIR_SHARED_SECRET');
} else if (shared !== proxy) {
  fir.set('PROXY_SHARED_SECRET', shared);
  console.log('  Set PROXY_SHARED_SECRET in fir-service\\.env to match FIR_SHARED_SECRET');
}

server.save();
fir.save();
console.log('  Secrets are set.');
