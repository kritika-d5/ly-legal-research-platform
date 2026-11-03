/**
 * Env + Mongo handles. Mirrors config.py from the data pipeline: nothing
 * hardcodes a connection string, everything comes from a gitignored .env.
 *
 * The `bail_rag` collections were produced by the preprocessing + chunking
 * phases and are READ-ONLY from this application's point of view. `nodes`,
 * `edges`, `paragraphs` and `chunks` are other people's finished output.
 * The only thing this app writes is `legalplatform_app` (accounts, saved work).
 */
import 'dotenv/config';
import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import type { ChunkDoc, EdgeDoc, FolderDoc, NodeDoc, ParagraphDoc, SavedCaseDoc, UserDoc } from './types.js';

/**
 * `mongodb+srv://` needs an SRV lookup, and on this machine Node resolves the
 * system nameserver as 127.0.0.1 (a local stub that is not listening), so the
 * lookup fails with ECONNREFUSED before Mongo is ever contacted. Python's
 * pymongo is unaffected because dnspython reads the Windows adapter config
 * directly rather than going through Node's resolver.
 *
 * Only override when the resolver is loopback-only: on a normal network the
 * machine's own DNS is the right thing to use, and hijacking it unconditionally
 * would be a surprising thing for a server to do.
 */
const systemServers = dns.getServers();
if (systemServers.every((s) => s.startsWith('127.') || s === '::1')) {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
  console.warn(
    `[dns] system resolver is loopback-only (${systemServers.join(', ')}) and refuses ` +
    'SRV queries; using 8.8.8.8 / 1.1.1.1 for the Atlas lookup',
  );
}

const { MONGO_URI, GROQ_API_KEY, PORT, JWT_SECRET } = process.env;

if (!MONGO_URI) {
  throw new Error('MONGO_URI is not set. Copy server/.env.example to server/.env.');
}

// Session cookies are signed with this. A short or guessable secret would let
// anyone mint a cookie for any account, including an admin one.
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error(
    'JWT_SECRET is not set (or shorter than 32 characters) in server/.env. Generate one with:\n' +
    "  node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\"",
  );
}

export const env = {
  mongoUri: MONGO_URI,
  groqApiKey: GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  port: Number(PORT ?? 8080),
  jwtSecret: JWT_SECRET,
  /** Only send the session cookie over HTTPS once deployed; dev is plain http. */
  secureCookies: process.env.NODE_ENV === 'production',
  /** Proves to the FIR backend that a request passed this server's login check. */
  firSharedSecret: process.env.FIR_SHARED_SECRET ?? '',
};

export const client = new MongoClient(env.mongoUri);
const db = client.db('bail_rag');

export const nodes = db.collection<NodeDoc>('nodes');
export const edges = db.collection<EdgeDoc>('edges');
export const chunks = db.collection<ChunkDoc>('chunks');
/** The finer-grained intermediate `chunks` was built from. Counter Engine's
 *  v0 fallback (CounterEngine.md §11) reads `kanoon_structure` and `citations`
 *  off this collection — neither field lives on `chunks`. */
export const paragraphs = db.collection<ParagraphDoc>('paragraphs');

/**
 * This application's own data — accounts now, saved work later. A separate
 * database, not a new collection in `bail_rag`, so nothing here can ever
 * collide with or damage the research corpus.
 */
const appDb = client.db('legalplatform_app');

export const users = appDb.collection<UserDoc>('users');
export const folders = appDb.collection<FolderDoc>('folders');
export const savedCases = appDb.collection<SavedCaseDoc>('saved_cases');

/** Atlas Search index names, created by the data repo's create_search_indexes.py. */
export const VECTOR_INDEX = 'chunks_vector_index';
export const TEXT_INDEX = 'chunks_text_index';
