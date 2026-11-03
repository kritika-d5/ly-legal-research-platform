/**
 * Bail outcome & judgment analysis.
 *
 * Answers the questions a reader of a bail judgment actually has — was bail
 * granted or refused, why, and on which factors — as structured data, with
 * every claim pinned to the numbered passages it came from.
 *
 * Context is chosen, not stuffed. A bail outcome lives in a predictable place:
 * the operative order at the END of the judgment ("the appeal is allowed, the
 * appellant shall be released on bail..."), restated in the SCR headnote when
 * there is one. The reasons live wherever the court weighs the usual factors.
 * So the context is, in priority order:
 *
 *   1. the closing body passages                    — the operative order
 *   2. the last body passages written by the court  — in case the order is labelled oddly
 *   3. the SCR headnote                             — the reporter's statement of what was held
 *   4. the best matches for three probes            — outcome / reasons / custody & liberty
 *
 * until a token budget is reached. Passages are then put back in document
 * order, so the model reads the judgment the way it was written.
 *
 * The same attribution rule as chat and summary applies, and matters more
 * here: a judgment that QUOTES an earlier decision granting bail has not
 * itself granted bail. The outcome must come from the court's own words.
 */
import { z } from 'zod';
import { chunks } from '../config.js';
import type { ChunkDoc, Passage } from '../types.js';
import { cosine, embedQuery } from './embed.js';
import { ATTRIBUTION } from './llm.js';

/**
 * Groq's free tier meters ~8k tokens a minute for gpt-oss-120b, and the answer
 * plus its reasoning costs ~2k. Much above this and a second analysis inside
 * the same minute stalls in the SDK's 429 backoff for ~50s.
 */
const CONTEXT_TOKEN_BUDGET = 4_000;
const OPERATIVE_TAIL = 2;
const MAX_HEADNOTES = 2;

const PROBES = [
  'the appeal is allowed and the appellant is directed to be released on bail; the bail application is rejected and dismissed; the order of the High Court is set aside',
  'reasons for granting or refusing bail: gravity of the offence, prima facie case, likelihood of absconding, tampering with evidence, influencing witnesses, criminal antecedents',
  'period of custody already undergone, delay in trial, personal liberty under Article 21, parity with co-accused, conditions imposed on release on bail',
];

export interface BailPassage extends Passage {
  /** position in the judgment, so the UI can say where a passage sits */
  seq: number;
  /**
   * One of the judgment's last body passages — where the operative order sits.
   * The chunker sometimes labels these `quoted_*` (the closing order of State
   * of Bihar v. Rajballav, signatures and all, is tagged quoted), so they are
   * accepted as evidence of the outcome whatever their content_type.
   */
  closing: boolean;
}

/** Pick and order the passages the analysis is allowed to see. */
export async function bailContext(tid: number): Promise<BailPassage[]> {
  const [probeVectors, docs] = await Promise.all([
    Promise.all(PROBES.map((p) => embedQuery(p))),
    chunks.find({ tid }).sort({ chunk_seq: 1 }).toArray(),
  ]);
  if (!docs.length) return [];

  const chosen = new Map<string, ChunkDoc>();
  let budget = CONTEXT_TOKEN_BUDGET;
  const take = (d: ChunkDoc | undefined) => {
    if (!d || chosen.has(d._id)) return;
    // Always admit the first passage, even an oversized one, or a case whose
    // order sits in one long chunk would get no context at all.
    if (chosen.size && d.token_count > budget) return;
    chosen.set(d._id, d);
    budget -= d.token_count;
  };

  const body = docs.filter((d) => d.chunk_kind === 'body');
  const closing = new Set(body.slice(-OPERATIVE_TAIL).map((d) => d._id));
  body.slice(-OPERATIVE_TAIL).reverse().forEach(take);
  body.filter((d) => d.content_type === 'court_text').slice(-OPERATIVE_TAIL).reverse().forEach(take);
  docs.filter((d) => d.chunk_kind === 'headnote').slice(0, MAX_HEADNOTES).forEach(take);

  // Round-robin across probes so one theme cannot crowd out the others.
  const ranked = probeVectors.map((v) =>
    docs
      .filter((d) => d.embedding)
      .map((d) => ({ d, score: cosine(v, d.embedding!) }))
      .sort((a, b) => b.score - a.score),
  );
  for (let i = 0; budget > 0 && i < docs.length; i++) {
    for (const list of ranked) take(list[i]?.d);
  }

  return [...chosen.values()]
    .sort((a, b) => a.chunk_seq - b.chunk_seq)
    .map((d) => ({
      id: d._id,
      tid: d.tid,
      seq: d.chunk_seq,
      closing: closing.has(d._id),
      text: d.text,
      locator: d.locator ?? null,
      contentType: d.content_type,
      sectionPrimary: d.section_primary,
      chunkKind: d.chunk_kind,
      score: 1,
      via: ['vector' as const],
    }));
}

/** Like formatPassages, but marks the closing passages so the model reads the order there. */
export function formatBailPassages(passages: BailPassage[]): string {
  return passages
    .map((p, i) => {
      const where = p.locator ? ` | ${p.locator}` : '';
      const end = p.closing ? ' | CLOSING PASSAGE OF THE JUDGMENT — usually holds the operative order' : '';
      return `[${i + 1}] (${ATTRIBUTION[p.contentType]}${where}${end})\n${p.text}`;
    })
    .join('\n\n---\n\n');
}

export const OUTCOMES = [
  'granted',
  'rejected',
  'partly_granted',
  'cancelled',
  'remanded',
  'directions',
  'not_a_bail_decision',
  'unclear',
] as const;

export const BAIL_TYPES = [
  'regular',
  'anticipatory',
  'interim',
  'default',
  'cancellation',
  'suspension_of_sentence',
  'other',
  'unknown',
] as const;

export const FACTORS = [
  'gravity_of_offence',
  'prima_facie_case',
  'flight_risk',
  'tampering_with_evidence',
  'influencing_witnesses',
  'criminal_antecedents',
  'period_of_custody',
  'delay_in_trial',
  'parity',
  'health_age_or_gender',
  'personal_liberty',
  'statutory_restriction',
  'conduct_of_accused',
  'other',
] as const;

/** Lenient on the way in (models drift), strict on the way out. */
const evidence = z.array(z.coerce.number().int()).default([]);
const analysisSchema = z.object({
  outcome: z.enum(OUTCOMES).catch('unclear'),
  bailType: z.enum(BAIL_TYPES).catch('unknown'),
  confidence: z.enum(['high', 'medium', 'low']).catch('low'),
  outcomeStatement: z.string().default(''),
  outcomeEvidence: evidence,
  reasons: z
    .array(z.object({ reason: z.string(), evidence }))
    .default([]),
  factors: z
    .array(
      z.object({
        factor: z.enum(FACTORS).catch('other'),
        label: z.string(),
        weighed: z.enum(['for_accused', 'against_accused', 'neutral']).catch('neutral'),
        explanation: z.string().default(''),
        evidence,
      }),
    )
    .default([]),
  conditions: z.array(z.string()).default([]),
  summary: z
    .object({
      background: z.string().default(''),
      issue: z.string().default(''),
      decision: z.string().default(''),
      principle: z.string().default(''),
    })
    .default({}),
});

export type BailAnalysis = z.infer<typeof analysisSchema> & {
  /** set when the outcome rests on nothing the court itself wrote */
  evidenceWarning: string | null;
  /** true when outcomeEvidence was located by OPERATIVE_PHRASE, not cited by the model */
  outcomeEvidenceMatched: boolean;
};

/**
 * Wording that only appears where an order is actually made. Used when the
 * model gets the outcome right but cites nothing for it — gpt-oss sometimes
 * returns every evidence array empty (Sharad Kumar v. CBI: the closing passage
 * reads "Bail applications are dismissed accordingly", and was in context).
 */
const OPERATIVE_PHRASE =
  /\b(released on bail|enlarged on bail|admitted to bail|(bail )?(applications?|petitions?|appeals?|pleas?) (is|are|stands?) (accordingly )?(dismissed|rejected|allowed|granted)|bail (is|stands) cancelled|(order|judgment) .{0,40}is (hereby )?set aside)\b/i;

export const BAIL_ANALYSIS_SYSTEM = `You analyse Indian court judgments on bail for a legal research tool. You are given numbered extracts from ONE judgment, in document order. Each is tagged with who is speaking: the court's own words, quoted material, or an SCR headnote written by law reporters.

Return ONE JSON object, nothing else, with exactly these keys:

{
  "outcome": "granted" | "rejected" | "partly_granted" | "cancelled" | "remanded" | "directions" | "not_a_bail_decision" | "unclear",
  "bailType": "regular" | "anticipatory" | "interim" | "default" | "cancellation" | "suspension_of_sentence" | "other" | "unknown",
  "confidence": "high" | "medium" | "low",
  "outcomeStatement": "one sentence: what THIS court ordered about bail, and for whom",
  "outcomeEvidence": [extract numbers],
  "reasons": [{ "reason": "one sentence", "evidence": [extract numbers] }],
  "factors": [{
    "factor": "gravity_of_offence" | "prima_facie_case" | "flight_risk" | "tampering_with_evidence" | "influencing_witnesses" | "criminal_antecedents" | "period_of_custody" | "delay_in_trial" | "parity" | "health_age_or_gender" | "personal_liberty" | "statutory_restriction" | "conduct_of_accused" | "other",
    "label": "short human-readable name of the factor",
    "weighed": "for_accused" | "against_accused" | "neutral",
    "explanation": "how the court treated this factor, one or two sentences",
    "evidence": [extract numbers]
  }],
  "conditions": ["each condition imposed on release, if any"],
  "summary": {
    "background": "who sought bail, for what offence, and how the case reached this court",
    "issue": "what the court had to decide",
    "decision": "what it decided and the reasoning that carried it",
    "principle": "the rule the case is cited for, in one sentence"
  }
}

RULES — these are correctness requirements:

1. "outcome" is what THIS court ordered for the person seeking bail. Read the operative order (usually the last extracts): "appeal allowed... released on bail" is granted; "petition dismissed" against a bail refusal is rejected; setting aside a grant of bail is cancelled; sending the matter back to a lower court is remanded. Bail for some accused but not others, or interim relief only, is partly_granted. A judgment whose order lays down guidelines or directions on bail (to courts, police or governments) rather than deciding one person's bail is directions.
2. Never take the outcome from quoted material. A judgment that quotes an earlier case granting bail has not itself granted bail. outcomeEvidence must cite the extract(s) where the order is actually made — normally one marked CLOSING PASSAGE, or the court's own words or the headnote. outcomeEvidence must not be empty unless outcome is "unclear". Words like "the appeal is dismissed" in the MIDDLE of a judgment are almost always a quotation of another court's order — the judgment's own order is in the CLOSING PASSAGE.
3. If the judgment is not about bail (e.g. habeas corpus, detention, a criminal appeal on merits), use "not_a_bail_decision" and still fill the summary.
4. If the extracts do not show the final order, use "unclear" and confidence "low". Do not guess.
5. Only list factors the court actually discussed in the extracts. An empty list is better than an invented one.
6. Every reason and factor must cite at least one extract number it is drawn from. Never cite a number that was not given.
7. Plain English. Do not state anything the extracts do not support. If a summary field is not covered, write "Not covered in the available extracts."`;

/** Parse, validate and sanitise the model's answer against the passages it saw. */
export function parseAnalysis(raw: string, passages: BailPassage[]): BailAnalysis {
  const json = raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('the model did not return valid JSON for the bail analysis');
  }
  const parsed = analysisSchema.parse(data);

  // Drop any citation to a passage the model was never shown.
  const valid = (ns: number[]) => [...new Set(ns.filter((n) => n >= 1 && n <= passages.length))];
  parsed.outcomeEvidence = valid(parsed.outcomeEvidence);
  parsed.reasons = parsed.reasons.map((r) => ({ ...r, evidence: valid(r.evidence) }));
  parsed.factors = parsed.factors.map((f) => ({ ...f, evidence: valid(f.evidence) }));

  let outcomeEvidenceMatched = false;
  if (!parsed.outcomeEvidence.length && parsed.outcome !== 'unclear') {
    parsed.outcomeEvidence = passages
      .map((p, i) => (p.closing && OPERATIVE_PHRASE.test(p.text) ? i + 1 : 0))
      .filter(Boolean);
    outcomeEvidenceMatched = parsed.outcomeEvidence.length > 0;
  }

  const ownWords = parsed.outcomeEvidence.some((n) => {
    const p = passages[n - 1];
    return p.closing || ['court_text', 'editorial'].includes(p.contentType);
  });
  // The order itself sits in the closing passages or is restated in the
  // headnote. An outcome resting only on a mid-judgment passage is usually a
  // quoted order of another court (Antil, p. 53: "The appeal is dismissed
  // accordingly." — a quotation the chunker labelled court_text).
  const fromOrder = parsed.outcomeEvidence.some((n) => {
    const p = passages[n - 1];
    return p.closing || p.contentType === 'editorial';
  });
  const decided = parsed.outcome !== 'unclear' && parsed.outcome !== 'not_a_bail_decision';
  let evidenceWarning: string | null = null;
  if (decided && ownWords && !fromOrder) {
    evidenceWarning =
      'The outcome is drawn from a passage in the body of the judgment, not from its closing order. It may be a quotation of another court’s order — check the end of the judgment.';
    if (parsed.confidence === 'high') parsed.confidence = 'medium';
  }
  if (decided && !ownWords) {
    evidenceWarning = parsed.outcomeEvidence.length
      ? 'The outcome rests only on quoted material, not on the court’s own words. Check the operative order in the judgment before relying on it.'
      : 'The analysis did not point to the passage where the order is made. Check the operative order in the judgment before relying on it.';
    parsed.confidence = 'low';
  }

  return { ...parsed, evidenceWarning, outcomeEvidenceMatched };
}
