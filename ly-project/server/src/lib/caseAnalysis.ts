/**
 * Bail case analysis — the lawyers' desk tool that starts from a client's
 * FACTS rather than from a saved matter or a ready-made legal position.
 *
 * Three stages, and only the first one is new reasoning:
 *
 *   1. Intake (one Groq call, this file). Reads the facts and returns labels
 *      and short notes: a neutral summary, the legal issues, the sections in
 *      play, a check of the facts against the bail factors courts weigh
 *      (FACTORS, shared with lib/bailAnalysis.ts so the two lists cannot
 *      drift), what is missing, and where the case is weak. It also writes
 *      the accused's bail position as one paragraph, for stage 2.
 *
 *   2. Arguments and counterarguments: runCounter() (lib/counter.ts) on that
 *      position. Every argument it returns cites a retrieved passage, and it
 *      already flags hallucinated citation numbers — nothing is rebuilt here.
 *
 *   3. Similar judgments: searchCases() on the facts, then filterRelevant()
 *      so that a judgment which is merely "about bail" does not pass as one
 *      that fits these facts.
 *
 * What intake may NOT do, and the prompt says so: cite or name any judgment
 * (stage 3 does that from the corpus), predict the outcome, or present a
 * section it inferred as one the facts state. A section the model adds is
 * returned as `source: 'suggested'` and the UI labels it "verify".
 */
import { z } from 'zod';
import { env } from '../config.js';
import type { CounterResponseBody, OffenceCategory } from '../types.js';
import { FACTORS } from './bailAnalysis.js';
import { runCounter } from './counter.js';
import { fallbackUses, groq } from './llm.js';
import { filterRelevant } from './relevance.js';
import { searchCases, type CaseResult } from './search.js';
import { mapSection, type Code } from './sectionMap.js';

/** Long enough for an FIR plus a bail application's facts; keeps the intake
 *  prompt well inside Groq's free-tier per-request token limit. */
export const MAX_FACTS_CHARS = 10_000;
/** Groq free tier: 8,000 tokens per request, prompt and reply together. */
const REQUEST_TOKEN_LIMIT = 7_600;
const MAX_OUTPUT_TOKENS = 5_000;
const MIN_OUTPUT_TOKENS = 2_500;
const SIMILAR_CANDIDATES = 10;
const SIMILAR_LIMIT = 6;

export const BAIL_SOUGHT = ['regular', 'anticipatory', 'interim', 'default', 'suspension_of_sentence', 'unknown'] as const;

const OFFENCE_CATEGORIES = ['ordinary', 'economic', 'ndps', 'pmla', 'uapa', 'other_special'] as const;

/** Lenient on the way in (models drift), strict on the way out. */
const intakeSchema = z.object({
  inScope: z.boolean().catch(true),
  summary: z.string().default(''),
  bailSought: z.enum(BAIL_SOUGHT).catch('unknown'),
  offenceCategory: z.enum(OFFENCE_CATEGORIES).catch('ordinary'),
  issues: z.array(z.object({ issue: z.string(), why: z.string().default('') })).default([]),
  sections: z
    .array(
      z.object({
        act: z.string(),
        section: z.string(),
        about: z.string().default(''),
        source: z.enum(['stated', 'suggested']).catch('suggested'),
        /** set by the server from the official table (lib/sectionMap.ts), never by the model */
        equivalent: z.object({ code: z.string(), sections: z.array(z.string()), subject: z.string() }).optional(),
      }),
    )
    .default([]),
  factors: z
    .array(
      z.object({
        factor: z.enum(FACTORS).catch('other'),
        status: z.enum(['favourable', 'unfavourable', 'missing']).catch('missing'),
        note: z.string().default(''),
      }),
    )
    .default([]),
  missingFacts: z.array(z.object({ fact: z.string(), why: z.string().default('') })).default([]),
  weaknesses: z.array(z.object({ weakness: z.string(), why: z.string().default('') })).default([]),
  bailPosition: z.string().default(''),
  searchQuery: z.string().default(''),
});

export type CaseIntake = z.infer<typeof intakeSchema>;

const INTAKE_SYSTEM = `You help an Indian criminal lawyer prepare a BAIL application. You are given the case facts the lawyer typed or extracted from documents (an FIR, a charge sheet, a previous order, their own notes). You organise those facts for research. You do not decide the case.

Return one valid JSON object only (no comments, no prose), with exactly these keys:
{
  "inScope": true,
  "summary": "...",
  "bailSought": "regular",
  "offenceCategory": "ordinary",
  "issues": [{ "issue": "...", "why": "..." }],
  "sections": [{ "act": "...", "section": "...", "about": "...", "source": "stated" }],
  "factors": [{ "factor": "flight_risk", "status": "missing", "note": "..." }],
  "missingFacts": [{ "fact": "...", "why": "..." }],
  "weaknesses": [{ "weakness": "...", "why": "..." }],
  "bailPosition": "...",
  "searchQuery": "..."
}

FIELDS:
- inScope: false only if the facts have nothing to do with arrest, custody or bail in a criminal matter.
- summary: 3-5 neutral sentences: who is accused of what, when, arrest/custody status, procedural stage.
- bailSought: one of "regular", "anticipatory", "interim", "default", "suspension_of_sentence", "unknown".
- offenceCategory: one of "ordinary", "economic", "ndps", "pmla", "uapa", "other_special" (ndps = drugs; pmla = money laundering; uapa = terrorism; economic = large fraud, bank fraud, corruption; other_special = another special statute with its own bail bar, e.g. POCSO; ordinary = everything else).
- issues: 2-6 legal issues a bail court will have to address on THESE facts.
- sections: the statutory provisions in play; source is "stated" or "suggested" (see rule 2).
- factors: one entry for EACH of these factors: ${FACTORS.filter((f) => f !== 'other').join(', ')}. status is "favourable", "unfavourable" or "missing".
- missingFacts, weaknesses: see rules 4 and 5.
- bailPosition: ONE paragraph, first person as the accused's counsel ("The accused seeks <type> bail because ..."), using only the favourable facts given.
- searchQuery: one sentence describing the offence, the custody situation and the bail question in legal terms, for searching a database of bail judgments. No names of people or places.

RULES — correctness requirements, not style:
1. Use ONLY the facts given. Never invent a date, an amount, a custody period, a prior record or a witness. If a fact matters and is not given, it goes in missingFacts, not in the summary.
2. sections: an entry is "stated" only if the act and section number appear in the facts. Anything you add because the facts suggest it is "suggested". Write the act as "IPC", "BNS", "CrPC" or "BNSS" where it is one of those. Do NOT list the IPC/BNS or CrPC/BNSS equivalent of a section: the old and new codes are matched afterwards from the official correspondence table. Never guess a section number you are not sure of — leave it out.
3. factors: one entry for EACH factor listed in FIELDS. "favourable" / "unfavourable" mean the facts given bear on it for or against the accused; "missing" means the facts are silent on it. The note says which fact, or what is needed.
4. missingFacts: the facts a bail court would ask about that are not given (e.g. date of arrest and days in custody, whether the charge sheet is filed, criminal antecedents, roots in the community, the specific role attributed to the accused, recovery). Most important first.
5. weaknesses: honest points the prosecution or court would raise against bail on these facts. Do not soften them.
6. Do not name or cite any judgment. Case law is retrieved separately from a verified corpus.
7. The absence of a fact is never a favourable fact. bailPosition may only rely on facts actually given: do not write "no flight risk has been indicated" or "no criminal record" unless the facts say so.
8. weaknesses are points AGAINST the accused only. A fact that ordinarily supports bail (for example the charge sheet being filed, documents already seized, a long period in custody) is not a weakness.
9. Work out periods (such as days in custody) from the dates given and TODAY's date stated below; say "as of today".
10. Do not predict whether bail will be granted, and do not give advice on what the lawyer should do beyond identifying issues, gaps and weaknesses.

BEFORE YOU ANSWER, check your draft: (a) every fact in summary and bailPosition appears in CASE FACTS — remove anything that does not (for example "cooperated with the investigation" when the facts do not say so); (b) every weakness is a point against bail — remove any that actually helps the accused, such as a long period in custody; (c) every "stated" section number appears in CASE FACTS.`;

/** The JSON object in a reply, without any code fence or stray prose around
 *  it. Groq's strict JSON mode is not used: it rejects a whole reply (400
 *  json_validate_failed) where parsing it here only needs the braces. */
function jsonObject(raw: string): string {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < start) throw new SyntaxError('No JSON object in the model reply');
  return raw.slice(start, end + 1);
}

/** The model occasionally returns an empty or malformed reply; a second try
 *  usually succeeds. A rate limit (429) is not retried: the same request
 *  would fail the same way. */
const ATTEMPTS = 2;
async function withRetry<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (err) {
      if (attempt >= ATTEMPTS || (err as { status?: number }).status === 429) throw err;
      console.error(`[caseAnalysis] intake attempt ${attempt}/${ATTEMPTS} failed, retrying:`, (err as Error).message);
    }
  }
}

function codeOfAct(act: string): Code | null {
  const a = act.replace(/[\s.]/g, '').toLowerCase();
  if (a === 'bnss' || a.includes('nagariksuraksha')) return 'BNSS';
  if (a === 'bns' || a.includes('nyayasanhita')) return 'BNS';
  if (a === 'ipc' || a.includes('penalcode')) return 'IPC';
  if (a === 'crpc' || a.includes('criminalprocedure')) return 'CrPC';
  return null;
}

async function intake(facts: string, given: { offenceCategory?: OffenceCategory; bailSought?: string }): Promise<CaseIntake> {
  const hints = [
    given.bailSought && given.bailSought !== 'unknown' ? `The lawyer says the bail sought is: ${given.bailSought}.` : '',
    given.offenceCategory ? `The lawyer says the offence category is: ${given.offenceCategory}.` : '',
  ]
    .filter(Boolean)
    .join(' ');

  const user = `TODAY: ${new Date().toISOString().slice(0, 10)}\n${hints ? `${hints}\n` : ''}\nCASE FACTS:\n${facts}`;
  // gpt-oss models reason before they answer, and Groq's default output cap
  // (2,048 tokens) can go entirely on reasoning, leaving an empty reply. So
  // the cap is set explicitly: whatever the request limit leaves after the
  // prompt (about 3.5 characters a token). When that is tight — a long
  // document — the model is told to reason briefly so the answer still fits.
  const promptTokens = Math.ceil((INTAKE_SYSTEM.length + user.length) / 3.5);
  const outputBudget = Math.min(MAX_OUTPUT_TOKENS, Math.max(MIN_OUTPUT_TOKENS, REQUEST_TOKEN_LIMIT - promptTokens));

  const parsed = await withRetry(async () => {
    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0,
      max_tokens: outputBudget,
      // groq-sdk 0.9 does not type this field yet; the API accepts it.
      ...({ reasoning_effort: outputBudget < 4000 ? 'low' : 'medium' } as object),
      messages: [
        { role: 'system', content: INTAKE_SYSTEM },
        { role: 'user', content: user },
      ],
    });
    const choice = completion.choices[0];
    try {
      return intakeSchema.parse(JSON.parse(jsonObject(choice?.message?.content ?? '')));
    } catch (err) {
      // finish_reason "length" means the reply was cut off, not malformed.
      throw new SyntaxError(`${(err as Error).message} (finish_reason: ${choice?.finish_reason}, usage: ${JSON.stringify(completion.usage)})`);
    }
  });
  // The lawyer's own choice wins over the model's reading of the facts.
  if (given.offenceCategory) parsed.offenceCategory = given.offenceCategory;
  if (given.bailSought && given.bailSought !== 'unknown') parsed.bailSought = given.bailSought as CaseIntake['bailSought'];
  // "Stated" is checked, not trusted: the section number must actually occur
  // in the facts (as a whole number, so s.4 does not match 420).
  for (const sec of parsed.sections) {
    const number = sec.section.replace(/^(s(ec(tion)?)?\.?\s*)/i, '').match(/^\d+[A-Z]?/i)?.[0];
    if (sec.source === 'stated' && (!number || !new RegExp(`(^|[^\\d])${number}(?![\\d])`, 'i').test(facts))) {
      sec.source = 'suggested';
    }
  }
  // IPC ⇄ BNS and CrPC ⇄ BNSS come from the official table, never the model.
  for (const sec of parsed.sections) {
    delete sec.equivalent;
    const code = codeOfAct(sec.act);
    if (!code) continue;
    sec.act = code;
    const { to, rows } = mapSection(code, sec.section);
    const isNew = code === 'BNS' || code === 'BNSS';
    sec.equivalent = {
      code: to,
      sections: [...new Set(rows.flatMap((r) => (isNew ? r.oldSections : [r.new])))],
      subject: rows[0]?.subject ?? '',
    };
  }
  // A factor the model returned twice keeps its first reading.
  const seen = new Set<string>();
  parsed.factors = parsed.factors.filter((f) => f.factor !== 'other' && !seen.has(f.factor) && seen.add(f.factor));
  return parsed;
}

/** Judgments whose facts or reasoning fit this case, best first. Ranked by
 *  the search, then checked passage by passage: a case stays only if its best
 *  passage actually addresses the question. The check is asked as the legal
 *  question (bail sought + issues), not the client's facts: no judgment
 *  matches a client's age or arrest date, and asked that way the relevance
 *  check drops everything. */
async function similarJudgments(query: string, question: string): Promise<CaseResult[]> {
  const cases = (await searchCases(query, { contentTypes: ['court_text', 'editorial'], limit: SIMILAR_CANDIDATES }))
    .filter((c) => c.passages.length > 0);
  if (!cases.length) return [];
  const relevant = await filterRelevant(
    question,
    cases.map((c) => ({ id: c.passages[0].id, text: c.passages[0].text })),
  );
  return cases.filter((c) => relevant.has(c.passages[0].id)).slice(0, SIMILAR_LIMIT);
}

export interface CaseAnalysis {
  intake: CaseIntake;
  similar: CaseResult[];
  /** null when the facts are out of scope, or there was no bail position to test */
  counter: CounterResponseBody | null;
  /** some of this was written by the smaller fallback model (rate limit on the main one) */
  usedFallbackModel: boolean;
  tookMs: number;
}

export class AnalysisUnavailableError extends Error {}

export async function analyseCase(
  facts: string,
  given: { offenceCategory?: OffenceCategory; bailSought?: string } = {},
): Promise<CaseAnalysis> {
  const t0 = Date.now();
  const fallbacksBefore = fallbackUses();
  if (!env.groqApiKey) {
    // Unlike search, this whole tool is the model reading the facts: without
    // it there is nothing honest to show.
    throw new AnalysisUnavailableError('Case analysis needs GROQ_API_KEY in server/.env.');
  }

  const text = facts.slice(0, MAX_FACTS_CHARS);
  const info = await intake(text, given);
  if (!info.inScope) {
    return { intake: info, similar: [], counter: null, usedFallbackModel: fallbackUses() > fallbacksBefore, tookMs: Date.now() - t0 };
  }

  const query = info.searchQuery || info.summary || text.slice(0, 500);
  // Sequential, not parallel: each stage is several Groq calls, and the free
  // tier's tokens-per-minute limit is shared between them.
  const question = `${info.bailSought === 'unknown' ? 'Bail' : `${info.bailSought.replace(/_/g, ' ')} bail`} in a ${info.offenceCategory === 'ordinary' ? '' : `${info.offenceCategory} `}case: ${
    info.issues.map((i) => i.issue).join('; ') || query
  }`;
  const similar = await similarJudgments(query, question);
  const counter = info.bailPosition.trim().length >= 20
    ? await runCounter({ position: info.bailPosition, side: 'pro_bail', offenceCategory: info.offenceCategory })
    : null;

  return { intake: info, similar, counter, usedFallbackModel: fallbackUses() > fallbacksBefore, tookMs: Date.now() - t0 };
}
