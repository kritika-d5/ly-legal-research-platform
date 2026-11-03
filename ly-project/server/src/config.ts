/**
 * Env + Mongo handles. Mirrors config.py from the data pipeline: nothing
 * hardcodes a connection string, everything comes from a gitignored .env.
 *
 * The collections here were produced by the preprocessing + chunking phases
 * and are READ-ONLY from this application's point of view. `nodes`, `edges`,
 * `paragraphs` and `chunks` are other people's finished output.
 */
import 'dotenv/config';
import dns from 'node:dns';
import { MongoClient } from 'mongodb';
import type { ChunkDoc, EdgeDoc, NodeDoc, ParagraphDoc } from './types.js';

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

const { MONGO_URI, GROQ_API_KEY, PORT } = process.env;

if (!MONGO_URI) {
  throw new Error('MONGO_URI is not set. Copy server/.env.example to server/.env.');
}

export const env = {
  mongoUri: MONGO_URI,
  groqApiKey: GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  port: Number(PORT ?? 8080),
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

/** Atlas Search index names, created by the data repo's create_search_indexes.py. */
export const VECTOR_INDEX = 'chunks_vector_index';
export const TEXT_INDEX = 'chunks_text_index';
