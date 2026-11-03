/**
 * IPC ⇄ BNS and CrPC ⇄ BNSS, from the official correspondence tables
 * (data/section-map.json, built by scripts/section-map/; see its docstring
 * for the source PDFs). The table is the only source of a mapping anywhere in
 * this app: a model is never asked what an old section became, because a
 * confident wrong section number is worse than none.
 *
 * Two traps this module handles so callers do not have to:
 *
 *  - The corpus runs from 1912. Before 1 April 1974, "Cr.P.C." meant the Code
 *    of Criminal Procedure, 1898, whose numbering is different (bail was
 *    ss. 496-498, not 436-439). The table maps the 1973 Code only, so CrPC
 *    mentions in an earlier judgment are reported but never mapped.
 *  - Section numbers collide across codes: s. 482 CrPC (inherent powers) is
 *    s. 528 BNSS, while s. 482 BNSS is anticipatory bail (old s. 438). Every
 *    lookup is therefore tied to a named code.
 */
import { readFileSync } from 'node:fs';

export type OldCode = 'IPC' | 'CrPC';
export type NewCode = 'BNS' | 'BNSS';
export type Code = OldCode | NewCode;

export interface MapRow {
  /** section in the new code, e.g. "318(4)" */
  new: string;
  subject: string;
  /** the old-code cell as printed, e.g. "376(1) & 376(2)" */
  old: string;
  oldSections: string[];
  change: 'same' | 'modified' | 'new';
  /** the official comparison summary for this row */
  summary: string;
}

interface SectionMapFile {
  source: { title: string; urls: string[]; built: string };
  ipc_bns: MapRow[];
  crpc_bnss: MapRow[];
}

const data: SectionMapFile = JSON.parse(
  readFileSync(new URL('../../data/section-map.json', import.meta.url), 'utf8'),
);

export const SECTION_MAP_SOURCE = data.source;

/** The day the CrPC 1973 came into force; "CrPC" before this is the 1898 Code. */
export const CRPC_1973_FROM = '1974-04-01';

const TABLE: Record<Code, { rows: MapRow[]; pair: Code; old: boolean }> = {
  IPC: { rows: data.ipc_bns, pair: 'BNS', old: true },
  BNS: { rows: data.ipc_bns, pair: 'IPC', old: false },
  CrPC: { rows: data.crpc_bnss, pair: 'BNSS', old: true },
  BNSS: { rows: data.crpc_bnss, pair: 'CrPC', old: false },
};

/** "420", "420(1)", "376(1)" → base "420" / "376"; "171-I" stays whole; "2(1)(c)" → "2". */
const base = (section: string) => section.match(/^\d+[A-Z]{0,2}(?:-[A-Z]+)?/i)?.[0].toUpperCase() ?? section;
/** "318 (4)" → "318(4)"; "120-B" → "120B" (judgments hyphenate, the table does not). */
const tidy = (section: string) => {
  const s = section.replace(/\s+/g, '').replace(/[.,]$/, '');
  // Upper-case the section's own letters (120b → 120B), not its clauses: 167(2)(a)(i).
  const head = s.match(/^\d+(?:-?[A-Za-z]+)?/)?.[0] ?? '';
  return head.toUpperCase().replace(/^(\d+)-([A-Z]+)/, '$1$2') + s.slice(head.length).toLowerCase();
};

export interface Mapping {
  code: Code;
  /** the section asked about, tidied */
  section: string;
  /** the code it maps to */
  to: Code;
  /** every table row that involves it; empty means the table has no entry */
  rows: MapRow[];
}

/**
 * Rows for one section of one code. A whole section matches its
 * sub-sections too ("376" finds 376(1), 376(2), 376(3)...); a sub-section
 * asked for exactly ("376(3)") is narrowed to rows naming it, if any do.
 */
export function mapSection(code: Code, section: string): Mapping {
  const { rows, pair, old } = TABLE[code];
  const wanted = tidy(section);
  const wantedBase = base(wanted);
  const sectionsOf = (r: MapRow) => (old ? r.oldSections : [r.new]).map(tidy);
  let hits = rows.filter((r) => sectionsOf(r).some((s) => base(s) === wantedBase));
  if (wanted !== wantedBase) {
    const exact = hits.filter((r) => sectionsOf(r).some((s) => s === wanted || s.startsWith(wanted)));
    if (exact.length) hits = exact;
  }
  return { code, section: wanted, to: pair, rows: hits };
}

/* ------------------------------------------------------------------------ */
/* Finding section references in free text                                   */
/* ------------------------------------------------------------------------ */

const CODE_NAMES: [RegExp, Code][] = [
  [/^(?:B\.?N\.?S\.?S\.?|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita)/i, 'BNSS'],
  [/^(?:B\.?N\.?S\.?|Bharatiya\s+Nyaya\s+Sanhita)/i, 'BNS'],
  [/^(?:I\.?\s?P\.?\s?C\.?|Indian\s+Penal\s+Code)/i, 'IPC'],
  [/^(?:Cr\.?\s?P\.?\s?C\.?|Code\s+of\s+Criminal\s+Procedure)/i, 'CrPC'],
];
// No spaces inside "BNS"/"BNSS": "BNS s. 318" must not read as BNSS.
const CODE = String.raw`(?:B\.?N\.?S\.?S\.?|Bharatiya\s+Nagarik\s+Suraksha\s+Sanhita|B\.?N\.?S\.?|Bharatiya\s+Nyaya\s+Sanhita|I\.?\s?P\.?\s?C\.?|Indian\s+Penal\s+Code|Cr\.?\s?P\.?\s?C\.?|Code\s+of\s+Criminal\s+Procedure)`;
// Never part of a longer number: "Code, 1860" is a year, not s. 186.
const NUM = String.raw`\d{1,3}(?!\d)[A-Z]{0,2}(?:-[A-Z]+)?(?:\s?\(\s?[0-9a-z]{1,4}\s?\))*`;
const LIST = String.raw`(?<![\w.])${NUM}(?:\s*(?:,|/|&|and|or|read\s+with|r/w)\s*${NUM})*`;
/** "Section(s) 420 and 406 of the IPC", "ss. 437/439 Cr.P.C.", "u/s 420 IPC", or bare "420 IPC". */
const MENTION = new RegExp(
  String.raw`(?:\b(?:sections?|secs?\.?|ss?\.|u/s\.?|under\s+section)\s*)?(${LIST})\s*(?:of\s+(?:the\s+)?)?(${CODE})(?![A-Za-z])`,
  'gi',
);
/** Code first, as FIRs and lawyers write it: "IPC 420", "BNS s. 318(4)", "CrPC Sections 437, 439". */
// Not across a full stop ("…BNSS. Section 482 Cr.P.C." is two references),
// and not a number followed by its own code name, which MENTION reads.
const CODE_FIRST = new RegExp(
  String.raw`(?<![A-Za-z])(${CODE})(?<!\.)\s*(?:sections?|secs?\.?|ss?\.|u/s\.?)?\s*(${LIST})(?!\s*(?:of\s+(?:the\s+)?)?${CODE})`,
  'gi',
);

export interface Mention {
  code: Code;
  section: string;
  /** the words as they appear in the text */
  text: string;
}

function codeOf(name: string): Code {
  for (const [re, code] of CODE_NAMES) if (re.test(name)) return code;
  return 'IPC';
}

/** Every "section N of <code>" reference in the text, de-duplicated, in order of first appearance. */
export function findMentions(text: string): Mention[] {
  const out: Mention[] = [];
  const seen = new Set<string>();
  const matches = [
    ...[...text.matchAll(MENTION)].map((m) => ({ at: m.index ?? 0, list: m[1], code: m[2], text: m[0] })),
    ...[...text.matchAll(CODE_FIRST)].map((m) => ({ at: m.index ?? 0, list: m[2], code: m[1], text: m[0] })),
  ].sort((a, b) => a.at - b.at);
  for (const m of matches) {
    const code = codeOf(m.code);
    for (const n of m.list.matchAll(new RegExp(NUM, 'gi'))) {
      const section = tidy(n[0]);
      const key = `${code} ${section}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ code, section, text: m.text.trim() });
    }
  }
  return out;
}

/**
 * The mentions in a judgment with their equivalents. `decided` is the
 * judgment's date: CrPC mentions before 1974 are kept (so the page can say
 * why) but get no mapping.
 */
export function mapMentions(text: string, decided?: string | null) {
  const before1974 = !!decided && decided < CRPC_1973_FROM;
  return findMentions(text).map((m) => {
    const oldCrpc = m.code === 'CrPC' && before1974;
    return { ...m, mapping: oldCrpc ? null : mapSection(m.code, m.section), crpc1898: oldCrpc };
  });
}

/**
 * Lookup-box parsing: "420", "IPC 420", "s. 438 CrPC", "BNS 318(4)",
 * "318(4) BNS". With no code named, the old code (IPC) is assumed, since
 * that is what most people still search by; `code` overrides.
 */
export function parseQuery(q: string, code?: Code): { code: Code; section: string } | null {
  const named = q.match(new RegExp(CODE, 'i'));
  const section = q.replace(new RegExp(CODE, 'gi'), ' ').match(new RegExp(NUM, 'i'))?.[0];
  if (!section) return null;
  return { code: code ?? (named ? codeOf(named[0]) : 'IPC'), section: tidy(section) };
}

/**
 * For search: the corpus predates the BNS, so a query naming BNS or BNSS
 * sections is extended with the IPC / CrPC sections they replaced (and their
 * subjects). Returns null when there is nothing to add.
 */
export function expandQuery(q: string): { query: string; added: { from: string; to: string }[] } | null {
  const added: { from: string; to: string }[] = [];
  const extra: string[] = [];
  for (const m of findMentions(q)) {
    if (m.code !== 'BNS' && m.code !== 'BNSS') continue;
    const { rows, to } = mapSection(m.code, m.section);
    for (const r of rows.slice(0, 3)) {
      for (const old of r.oldSections.slice(0, 3)) {
        added.push({ from: `${m.code} ${r.new}`, to: `${to} ${old}` });
        extra.push(`${old} ${to}`);
      }
      extra.push(r.subject.replace(/[."“”]/g, ''));
    }
  }
  if (!added.length) return null;
  return { query: `${q} ${[...new Set(extra)].join(' ')}`, added };
}
