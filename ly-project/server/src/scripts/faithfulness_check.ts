/**
 * CounterEngine.md §12 item 2, steps 2 and 3. Reads eval/generated_answers.json
 * (from faithfulness_run.ts), makes no Groq calls, judges nothing.
 *
 * Step 2 -- automatable checks on every citation marker in every answer body:
 *   A. number out of range: N outside 1..suppliedCount (fabricated reference)
 *   B. format: prompt rule 11 requires plain ASCII [N]; anything else counted
 *   C. locator: a locator written inside the marker (e.g. 【1†para 7】) vs the
 *      stored locator of passage N
 *   D. body vs Sources table: N missing from Sources, Sources names a different
 *      case for N, or the body sentence names a supplied case other than N's
 * Step 3 -- 30 resolving citations, seed 7, 2:1 should_work, round-robin over
 * queries, with the verbatim claim and the full stored text of the passage.
 *
 * Run from server/:  npx tsx src/scripts/faithfulness_check.ts [--in a.json,b.json]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { selectForContext } from '../lib/generate.js';
import type { RoundResult } from '../types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVAL = path.resolve(__dirname, '../../../eval');
const CHECKS_PATH = path.join(EVAL, 'citation_checks.json');
const CLAIMS_PATH = path.join(EVAL, 'claims_to_review.json');

const SEED = 7;
const SAMPLE = { should_work: 20, should_fail: 10 };
const MAX_PASSAGE_CHARS = 1200; // generate.ts -- what the model was actually shown

interface Item {
  n: number | null; round: string; chunkId: string; paraIds: string[]; tid: number;
  caseTitle: string; year: number; courtTier: string; locator: string | null;
  kind: string; speaker: string; viaGraph: boolean; text: string;
  /** graph-attack items: the authorities the passage is about, so naming them is not a mismatch */
  becauseOf?: number[];
}
interface Answer {
  id: string; group: 'should_work' | 'should_fail'; query: string; answer: string;
  generationFailed: boolean; serverInvalidCitations: number[]; suppliedCount: number; items: Item[];
  rounds?: RoundResult[];
}

/** Passage [N] -> item. From the stored raw rounds via the server's own
 *  selectForContext when present (authoritative; a chunk may sit in two
 *  rounds), else the driver's stored n (the pre-cap sw01 pilot). */
function suppliedMap(a: Answer): Map<number, Item> {
  if (!a.rounds) return new Map(a.items.filter((i) => i.n !== null).map((i) => [i.n as number, i]));
  return new Map(selectForContext(a.rounds).map((it, i): [number, Item] => [i + 1, {
    n: i + 1, round: a.rounds!.find((r) => r.items.includes(it))!.round, chunkId: it.id, paraIds: it.paraIds,
    tid: it.tid, caseTitle: it.caseTitle, year: it.year, courtTier: it.courtTier, locator: it.locator,
    kind: it.kind, speaker: it.speaker, viaGraph: it.viaGraph ?? false, text: it.text,
    becauseOf: (it.becauseOf ?? []).map((b) => b.tid),
  }]));
}
interface Marker {
  raw: string; n: number; locator: string | null; style: string; compliant: boolean;
  section: string; line: string; claim: string;
}

// ---------- parsing ----------

const HEADING = /^\s*(?:\*\*)?\s*#{1,6}\s*(.+?)\s*(?:\*\*)?\s*$/;
const MARKER = /【([^】]*)】|\[([^\[\]]*)\](?!\()/g;
const DASHES = /[‐-―−]/g;

function sections(answer: string): { name: string; lines: string[] }[] {
  const out: { name: string; lines: string[] }[] = [{ name: '(preamble)', lines: [] }];
  for (const line of answer.split(/\r?\n/)) {
    const h = line.match(HEADING);
    if (h) out.push({ name: h[1].replace(/\*/g, '').trim(), lines: [] });
    else out[out.length - 1].lines.push(line);
  }
  return out;
}

const isSources = (name: string) => /^sources\b/i.test(name);

/** Parse one bracket's content into cited numbers. Returns null if it is not a citation. */
function parseMarker(fullwidth: boolean, content: string): { n: number; locator: string | null; style: string; compliant: boolean }[] | null {
  const c = content.trim();
  if (c.includes('†')) {
    const [num, ...rest] = c.split('†');
    if (!/^\s*\d+\s*$/.test(num)) return null;
    return [{ n: Number(num), locator: rest.join('†').trim() || null, style: fullwidth ? 'fullwidth+locator' : 'ascii+locator', compliant: false }];
  }
  if (/^\d+$/.test(c)) return [{ n: Number(c), locator: null, style: fullwidth ? 'fullwidth' : 'ascii', compliant: !fullwidth }];
  if (/^\d+(\s*[,;]\s*\d+)+$/.test(c)) {
    return c.split(/\s*[,;]\s*/).map((s) => ({ n: Number(s), locator: null, style: 'multi-number', compliant: false }));
  }
  const range = c.replace(DASHES, '-').match(/^(\d+)\s*-\s*(\d+)$/);
  if (range) {
    const out = [];
    for (let k = Number(range[1]); k <= Number(range[2]); k++) out.push({ n: k, locator: null, style: 'range', compliant: false });
    return out;
  }
  return null;
}

// Sentence split that does not break on legal abbreviations.
const ABBREV = /\b(?:s|ss|v|vs|no|nos|art|arts|sec|para|paras|p|pp|cl|i\.e|e\.g|dr|mr|ltd|co|anr|ors|cr\.p\.c|crpc|ipc|etc|viz|cf|hon'ble|j|jj|u\.o\.i|st|thr)\.$/i;
/** Sentences as verbatim slices of `text` (never re-joined strings, so every
 *  claim is an exact substring of the answer). */
function sentencesOf(text: string): string[] {
  const cuts: number[] = []; // index where each new sentence starts
  const re = /([.!?])(\s+)(?=[A-Z*"“(【\[])/g;
  let start = 0;
  for (let m; (m = re.exec(text)); ) {
    const lastWord = (text.slice(start, m.index + 1).split(/\s+/).pop() ?? '').replace(/^[*_"“(]+/, '');
    if (ABBREV.test(lastWord) || /(^|\.)[A-Za-z]\.$/.test(lastWord)) continue; // abbreviation or initial ("K.L.")
    start = m.index + m[0].length;
    // A marker that opens a sentence belongs to the sentence before it ("... bail. 【3】 Next").
    const lead = text.slice(start).match(/^((?:【[^】]*】|\[\d[^\]]*\])\s*)+/);
    if (lead) start += lead[0].length;
    cuts.push(start);
  }
  const bounds = [0, ...cuts, text.length];
  return bounds.slice(0, -1).map((b, i) => text.slice(b, bounds[i + 1]).trim()).filter(Boolean);
}

/** Unit of text a citation attaches to: a table row, or a sentence within a line. */
function markersOf(answer: string): { body: Marker[]; sourcesLines: string[]; nonCitationBrackets: string[] } {
  const body: Marker[] = [];
  const nonCitationBrackets: string[] = [];
  let sourcesLines: string[] = [];
  for (const sec of sections(answer)) {
    if (isSources(sec.name)) { sourcesLines = sec.lines; continue; }
    for (const line of sec.lines) {
      if (/^\s*\|?\s*:?-{3,}/.test(line)) continue; // table separator row
      const units = line.trim().startsWith('|') ? [line.trim()] : sentencesOf(line);
      for (const unit of units) {
        for (const m of unit.matchAll(MARKER)) {
          const parsed = parseMarker(m[1] !== undefined, m[1] ?? m[2]);
          if (!parsed) { if (/\d/.test(m[0])) nonCitationBrackets.push(m[0]); continue; }
          // "[3]¶2": a locator appended after a plain bracket -- also not the plain [N] rule 11 asks for.
          const tail = unit.slice((m.index ?? 0) + m[0].length).match(/^¶\s*(\d+(?:\.\d+)?(?:\s*[-‐-―−]\s*\d+(?:\.\d+)?)?)/);
          let raw = m[0];
          if (tail && parsed.length === 1 && parsed[0].locator === null) {
            parsed[0] = { ...parsed[0], locator: `para ${tail[1]}`, style: `${parsed[0].style}+¶locator`, compliant: false };
            raw += tail[0];
          }
          for (const p of parsed) body.push({ raw, ...p, section: sec.name, line: line.trim(), claim: unit.trim() });
        }
      }
    }
  }
  return { body, sourcesLines, nonCitationBrackets };
}

/** Sources entries: number -> the text the model wrote for it (case + locator). */
function sourcesEntries(lines: string[]): Map<number, string> {
  const out = new Map<number, string>();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || /^\|?\s*:?-{3,}/.test(line) || /^\|\s*#\s*\|/.test(line)) continue;
    let m: RegExpMatchArray | null;
    if (line.startsWith('|')) {
      const cells = line.split('|').map((c) => c.trim()).filter((c, i, a) => !(c === '' && (i === 0 || i === a.length - 1)));
      m = cells[0]?.match(/^(?:\*\*)?[【\[]?(\d+)[^\d]*$/);
      if (m) out.set(Number(m[1]), cells.slice(1).join(' | '));
      continue;
    }
    m = line.match(/^[-*]?\s*(?:\*\*)?(?:【(\d+)[^】]*】|\[(\d+)\]|(\d+)[.)])\s*(?:\*\*)?\s*[-–—:]?\s*(.*)$/);
    if (m) out.set(Number(m[1] ?? m[2] ?? m[3]), m[4]);
  }
  return out;
}

// ---------- comparisons ----------

const norm = (s: string) => s.toLowerCase().replace(DASHES, '-').replace(/[*_]/g, '').replace(/\s+/g, ' ').trim();

/** Distinctive first-party words of a case title. Short forms drop middle
 *  names ("Bhadresh Sheth" for Bhadresh Bipinbhai Sheth), so any one
 *  distinctive word is a mention; common name words never count alone. */
const NOT_DISTINCTIVE = new Set(['the', 'state', 'and', 'anr', 'ors', 'etc', 'shri', 'smt', 'union', 'india', 'thr.',
  'others', 'singh', 'kumar', 'lal', 'ram', 'devi', 'prasad', 'sharma', 'khan', 'das', 'mohd', 'mohammad', 'raja',
  'thr', 'and', 'delhi', 'nct', 'bihar', 'punjab', 'gujarat', 'maharashtra', 'assam', 'madhya', 'pradesh', 'rajasthan']);
function caseKey(title: string): string[] {
  const words = (party: string) => party.toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/)
    .filter((w) => w.length > 3 && !NOT_DISTINCTIVE.has(w));
  // "Union Of India vs K.A. Najeeb", "State Of U. P vs Deoman Upadhyaya": the first
  // party has no distinctive name, so the case is known by the second.
  const [first, second = ''] = title.replace(/\s+on\s+\d{1,2}\s+\w+,\s+\d{4}\s*$/, '').split(/\s+(?:vs?\.?|versus)\s+/i);
  const k = words(first);
  return k.length ? k : words(second);
}
const mentions = (text: string, title: string) => {
  const t = norm(text);
  return caseKey(title).some((w) => new RegExp(`\\b${w}\\b`).test(t));
};

function locatorTokens(loc: string): { kind: string; nums: Set<string> } {
  const s = norm(loc);
  const kind = /\bpp?\.|\bpage/.test(s) ? 'page' : /para/.test(s) ? 'para' : 'other';
  const nums = new Set<string>();
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)(?:\s*-\s*(\d+(?:\.\d+)?))?/g)) {
    const a = Number(m[1]); const b = m[2] ? Number(m[2]) : a;
    if (Number.isInteger(a) && Number.isInteger(b) && b >= a && b - a < 200) for (let k = a; k <= b; k++) nums.add(String(k));
    else { nums.add(m[1]); if (m[2]) nums.add(m[2]); }
  }
  for (const m of s.matchAll(/\(([ivxlc]+)\)/g)) nums.add(m[1]);
  return { kind, nums };
}

/** True if every number in the written locator appears as paragraph numbering
 *  printed inside the passage itself ("6.2 It is further submitted", "(vi)"). */
function numberedInText(nums: Set<string>, text: string): boolean {
  const esc = (s: string) => s.replace(/\./g, '\\.');
  return nums.size > 0 && [...nums].every((x) =>
    /^[ivxlc]+$/.test(x)
      ? text.toLowerCase().includes(`(${x})`)
      : new RegExp(`(^|[\\s(])${esc(x)}(\\.|\\)|\\s)`).test(text));
}

/** match | in passage text, not stored locator | no stored locator, not in text | mismatch */
function compareLocator(cited: string, stored: string | null, text: string): string {
  const c = locatorTokens(cited);
  if (stored) {
    if (norm(cited) === norm(stored)) return 'match';
    const s = locatorTokens(stored);
    const kindOk = c.kind === 'other' || s.kind === 'other' || c.kind === s.kind;
    if (c.nums.size && kindOk && [...c.nums].every((x) => s.nums.has(x))) return 'match';
  }
  if (numberedInText(c.nums, text)) return 'in passage text, not stored locator';
  return stored ? 'mismatch' : 'no stored locator, not in text';
}

// ---------- seeded sampling ----------

function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const presentedAs = (it: Item) =>
  it.kind === 'statute' ? 'STATUTE' : it.viaGraph ? 'YOUR AUTHORITY WAS DOUBTED'
    : it.speaker === 'COUNSEL' ? 'SUBMISSION, SIDE NOT DETERMINED' : "COURT'S REASONING";

// ---------- main ----------

async function main() {
  const inArg = process.argv.includes('--in') ? process.argv[process.argv.indexOf('--in') + 1] : 'generated_answers.json';
  const answers: Answer[] = inArg.split(',').flatMap((f) => JSON.parse(readFileSync(path.resolve(EVAL, f), 'utf-8')));

  const perQuery: Record<string, unknown>[] = [];
  const instances = { outOfRange: [] as unknown[], formatViolations: [] as unknown[], locatorMismatch: [] as unknown[],
    locatorInText: [] as unknown[], bodyVsSources: [] as unknown[], sourcesOnly: [] as unknown[],
    nonCitationBrackets: [] as unknown[], generationFailed: [] as string[] };
  const locatorResults: Record<string, number> = {};
  const pool: { a: Answer; m: Marker; item: Item }[] = [];
  const styleCounts: Record<string, number> = {};
  let total = 0, resolving = 0, serverFlagged = 0, withLocator = 0;

  for (const a of answers) {
    if (a.generationFailed || !a.answer.trim()) { instances.generationFailed.push(a.id); continue; }
    const supplied = suppliedMap(a);
    const { body, sourcesLines, nonCitationBrackets } = markersOf(a.answer);
    const sources = sourcesEntries(sourcesLines);
    serverFlagged += a.serverInvalidCitations.length;
    for (const b of nonCitationBrackets) instances.nonCitationBrackets.push({ query: a.id, bracket: b });

    const q = { id: a.id, group: a.group, supplied: supplied.size, citations: body.length, resolving: 0,
      outOfRange: 0, formatViolations: 0, locatorMismatch: 0, bodyVsSources: 0, serverReported: a.serverInvalidCitations };
    const cited = new Set<number>();

    for (const m of body) {
      total++; cited.add(m.n);
      styleCounts[m.style] = (styleCounts[m.style] ?? 0) + 1;
      const where = { query: a.id, group: a.group, section: m.section, marker: m.raw, n: m.n, claim: m.claim, line: m.line };
      if (!m.compliant) { q.formatViolations++; instances.formatViolations.push({ ...where, style: m.style }); }

      const item = supplied.get(m.n);
      if (!item) { q.outOfRange++; instances.outOfRange.push({ ...where, supplied: supplied.size }); continue; }
      q.resolving++; resolving++;
      pool.push({ a, m, item });

      if (m.locator) {
        withLocator++;
        const result = compareLocator(m.locator, item.locator, item.text);
        locatorResults[result] = (locatorResults[result] ?? 0) + 1;
        if (result !== 'match') {
          const rec = { ...where, writtenLocator: m.locator, storedLocator: item.locator, result, caseTitle: item.caseTitle };
          if (result === 'in passage text, not stored locator') instances.locatorInText.push(rec);
          else { q.locatorMismatch++; instances.locatorMismatch.push(rec); }
        }
      }

      const problems: string[] = [];
      const entry = sources.get(m.n);
      if (entry === undefined) problems.push('cited in body but absent from Sources');
      else if (!mentions(entry, item.caseTitle)) problems.push(`Sources lists [${m.n}] as "${entry}"`);
      const others = [...supplied.values()].filter((it) => it.tid !== item.tid
        && !(item.becauseOf ?? []).includes(it.tid) && mentions(m.claim, it.caseTitle));
      if (others.length && !mentions(m.claim, item.caseTitle)) {
        problems.push(`body names ${[...new Set(others.map((o) => o.caseTitle))].join('; ')} but [${m.n}] is ${item.caseTitle}`);
      }
      if (problems.length) {
        q.bodyVsSources++;
        instances.bodyVsSources.push({ ...where, passageCase: item.caseTitle, passageLocator: item.locator, sourcesEntry: entry ?? null, problems });
      }
    }

    for (const [n, entry] of sources) {
      if (!cited.has(n)) instances.sourcesOnly.push({ query: a.id, n, entry, inRange: supplied.has(n) });
      if (!supplied.has(n)) instances.outOfRange.push({ query: a.id, group: a.group, section: 'Sources', marker: `Sources row ${n}`, n, claim: entry, supplied: supplied.size });
    }
    perQuery.push(q);
  }

  // ---- step 3: sample ----
  const rnd = mulberry32(SEED);
  const seen = new Set<string>();
  const dedup = pool.filter(({ a, m }) => { const k = `${a.id}|${m.n}|${m.claim}`; if (seen.has(k)) return false; seen.add(k); return true; });
  const picked: typeof dedup = [];
  // 2:1 toward should_work; a group short of citations hands its slots to the other.
  const avail = (g: string) => dedup.filter((p) => p.a.group === g).length;
  const sampleSize = SAMPLE.should_work + SAMPLE.should_fail;
  const quota = { should_work: 0, should_fail: Math.min(SAMPLE.should_fail, avail('should_fail')) };
  quota.should_work = Math.min(sampleSize - quota.should_fail, avail('should_work'));
  quota.should_fail = Math.min(sampleSize - quota.should_work, avail('should_fail'));
  for (const group of ['should_work', 'should_fail'] as const) {
    const byQuery = new Map<string, typeof dedup>();
    for (const p of dedup.filter((p) => p.a.group === group)) byQuery.set(p.a.id, [...(byQuery.get(p.a.id) ?? []), p]);
    for (const [k, v] of byQuery) byQuery.set(k, shuffle(v, rnd));
    const order = shuffle([...byQuery.keys()].sort(), rnd);
    let taken = 0;
    while (taken < quota[group] && order.some((k) => byQuery.get(k)!.length)) {
      for (const k of order) {
        if (taken >= quota[group]) break;
        const next = byQuery.get(k)!.shift();
        if (next) { picked.push(next); taken++; }
      }
    }
  }

  const { client, chunks, paragraphs } = await import('../config.js');
  await client.connect();
  const chunkIds = picked.filter((p) => !p.item.viaGraph).map((p) => p.item.chunkId);
  const paraIds = picked.filter((p) => p.item.viaGraph).map((p) => p.item.paraIds[0]);
  const [chunkDocs, paraDocs] = await Promise.all([
    chunks.find({ _id: { $in: chunkIds } as any }).project({ text: 1 }).toArray(),
    paragraphs.find({ _id: { $in: paraIds } as any }).project({ text: 1 }).toArray(),
  ]);
  await client.close();
  const textById = new Map<string, string>([...chunkDocs, ...paraDocs].map((d: any) => [d._id, d.text]));

  const claims = picked.map(({ a, m, item }) => {
    const stored = textById.get(item.viaGraph ? item.paraIds[0] : item.chunkId);
    if (stored === undefined) throw new Error(`${a.id} [${m.n}]: stored text not found for ${item.chunkId}`);
    return {
      query_id: a.id, group: a.group, query: a.query,
      answer_section: m.section,
      marker: m.raw,
      claim: m.claim,
      claim_context: m.line,
      case_title: item.caseTitle, tid: item.tid, chunk_id: item.chunkId,
      paragraph_id: item.viaGraph ? item.paraIds[0] : null,
      locator: item.locator,
      locator_written_in_marker: m.locator,
      presented_to_model_as: presentedAs(item),
      round: item.round,
      chars_shown_to_model: Math.min(stored.length, MAX_PASSAGE_CHARS),
      paragraph_text: stored,
    };
  });
  writeFileSync(CLAIMS_PATH, JSON.stringify(claims, null, 2), 'utf-8');

  const summary = {
    answers: answers.length, generationFailed: instances.generationFailed,
    totalCitations: total, resolving, outOfRangeBody: instances.outOfRange.filter((x: any) => x.section !== 'Sources').length, outOfRangeSourcesRows: instances.outOfRange.filter((x: any) => x.section === 'Sources').length,
    formatViolations: instances.formatViolations.length, markerStyles: styleCounts,
    citationsWithLocatorInMarker: withLocator, locatorResults, locatorMismatch: instances.locatorMismatch.length,
    bodyVsSources: instances.bodyVsSources.length, sourcesRowsNeverCitedInBody: instances.sourcesOnly.length,
    serverInvalidCitationsReported: serverFlagged,
    sampled: { total: claims.length, should_work: claims.filter((c) => c.group === 'should_work').length, should_fail: claims.filter((c) => c.group === 'should_fail').length },
  };
  writeFileSync(CHECKS_PATH, JSON.stringify({ input: inArg, summary, perQuery, instances }, null, 2), 'utf-8');

  console.log(JSON.stringify(summary, null, 2));
  console.log('\nper query:');
  for (const q of perQuery as any[]) {
    console.log(`  ${q.id}  cites=${q.citations} resolve=${q.resolving} outOfRange=${q.outOfRange} format=${q.formatViolations} ` +
      `locator=${q.locatorMismatch} body/sources=${q.bodyVsSources} server=${JSON.stringify(q.serverReported)}`);
  }
  console.log(`\nall instances: ${CHECKS_PATH}\nclaims: ${CLAIMS_PATH}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
