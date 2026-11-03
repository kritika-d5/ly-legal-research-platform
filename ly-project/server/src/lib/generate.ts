/**
 * Stage F — CounterEngine.md §6 (prompt contract) + §8.2 (output shape).
 *
 * Counter Engine v0 returned three rounds of passages and stopped there —
 * "a list of passages, not an answer." This module is the last step: one
 * Groq call that reads the position and everything actually retrieved, and
 * writes the research summary a lawyer would want, citing only what was
 * supplied.
 *
 * Reuses `COUNTER_ATTRIBUTION_RULES` from lib/llm.ts, which was written
 * ahead of this step specifically so the attribution rules live in exactly
 * one place (see that file's own comment). Does not duplicate them.
 *
 * WHAT v0 CANNOT CLAIM, and this prompt is deliberately honest about:
 *   - `opposing` round submissions carry `stanceUndetermined: true` — v0
 *     cannot tell pro-bail from anti-bail reliably (needs ARGUMENTS.md
 *     Stage B's applicant_seeking_bail, not built). The prompt must not let
 *     the model quietly assert a side these items don't actually carry.
 *   - There is no R4 rebuttal round (needs Stage C's outcome labels, not
 *     built) — no "this argument failed before" data exists yet. Hard Rule
 *     5 ("no strong counterargument found is a valid, expected output")
 *     extends here: if the corpus has no rebuttal, the answer must say so,
 *     not manufacture one from the graph-attack round alone.
 *   - §9 "No auto-drafting": this produces a research summary, not a
 *     document to file — the prompt says so explicitly.
 */
import { z } from 'zod';
import { env } from '../config.js';
import { COUNTER_ATTRIBUTION_RULES, groq } from './llm.js';
import type {
  Classification, CounterItem, CounterRequest, CounterSummary, RoundResult, SummaryPoint,
} from '../types.js';

const MAX_PASSAGE_CHARS = 1200;

/** CounterEngine.md §5.4 quota selection. Without the cap a full retrieval
 *  (8 supporting + 8 opposing) built a prompt over Groq's free-tier 8,000-token
 *  per-request limit, and generation failed with a 413 on exactly the queries
 *  retrieval served best (eval/citation_faithfulness_results.md). */
const CONTEXT_CAP = 12;
const ROUND_QUOTA: Record<RoundResult['round'], number> = { supporting: 4, opposing: 5, statutes: 2 };

function courtNote(item: CounterItem): string {
  if (item.courtTier === 'HC') return ' — High Court, persuasive only, not binding';
  if (item.courtTier === 'OTHER') return ' — not Supreme Court, persuasive only';
  if (item.year && item.year < 1950) return ' — pre-1950, persuasive weight only';
  return '';
}

/** One numbered context block per retrieved item, in the exact format
 *  CounterEngine.md §6 specifies, extended for v0's honesty requirements
 *  (submissions carry no determined side; graph attacks carry becauseOf). */
function formatItem(n: number, item: CounterItem): string {
  const text = item.text.slice(0, MAX_PASSAGE_CHARS);
  const where = item.locator ? `, ${item.locator}` : '';
  const note = courtNote(item);

  const because = (item.becauseOf ?? [])
    .map((b) => `${b.title} (${b.polarity === 'neg' ? 'disagreed with' : 'distinguished in part'})`)
    .join('; ');

  if (item.kind === 'statute') {
    return `[${n}] STATUTE — ${item.caseTitle}${where} — quoted provision text, NOT a holding\n"${text}"`;
  }
  if (item.speakerUncertain) {
    const edge = item.viaGraph
      ? `\n(Citation graph: in this judgment the court treats ${because}. That is about how that authority is treated, not about who is speaking in this passage.)`
      : '';
    return `[${n}] SOURCE UNCERTAIN — retrieved both as court reasoning and as a party submission — ${item.caseTitle} (${item.year})${note}${where}\n` +
      `"${text}"\n(This system cannot tell whether the court or counsel is speaking here. Do not attribute a holding to this passage.)${edge}`;
  }
  if (item.viaGraph) {
    return `[${n}] YOUR AUTHORITY WAS DOUBTED — ${item.caseTitle} (${item.year})${note}${where} — treats ${because}\n"${text}"`;
  }
  if (item.speaker === 'COUNSEL') {
    return `[${n}] SUBMISSION, SIDE NOT DETERMINED — ${item.caseTitle} (${item.year})${note}${where}\n` +
      `"${text}"\n(This is a party's argument as the court recorded it, not the court's own holding. This system cannot yet determine which side raised it or whether it succeeded — do not guess.)`;
  }
  return `[${n}] COURT'S REASONING — ${item.caseTitle} (${item.year})${note}${where}\n"${text}"`;
}

/** The passages handed to the model, in citation order: passage [N] is
 *  element N-1. Each round's quota first; spare slots up to CONTEXT_CAP go
 *  round-robin by rank, since items carry no cross-round comparable score. */
export function selectForContext(rounds: RoundResult[]): CounterItem[] {
  const taken = rounds.map((r) => Math.min(r.items.length, ROUND_QUOTA[r.round]));
  let total = taken.reduce((s, t) => s + t, 0);
  while (total < CONTEXT_CAP) {
    let added = false;
    for (let i = 0; i < rounds.length && total < CONTEXT_CAP; i++) {
      if (taken[i] < rounds[i].items.length) { taken[i]++; total++; added = true; }
    }
    if (!added) break;
  }
  return rounds.flatMap((r, i) => r.items.slice(0, taken[i]));
}

function buildContext(rounds: RoundResult[]): { block: string; n: number } {
  const items = selectForContext(rounds);
  return { block: items.map((item, i) => formatItem(i + 1, item)).join('\n\n'), n: items.length };
}

/** Exactly what generateAnswer sends; exported so the eval can measure it. */
export function buildPrompt(req: CounterRequest, cls: Classification, rounds: RoundResult[]) {
  const { block, n } = buildContext(rounds);
  const sideLabel = req.side === 'pro_bail' ? 'seeking bail' : 'opposing bail';
  const user = `POSITION (user is ${sideLabel}): ${req.position}\n\n` +
    `DETECTED TOPICS: ${cls.topics.join(', ') || 'none'}\n` +
    `OFFENCE CATEGORY: ${cls.offenceCategory}\n\n` +
    `RETRIEVED PASSAGES (cite ONLY these, by number):\n\n${block}`;
  return { system: SYSTEM, user, n };
}

const SYSTEM = `You are a legal research assistant. You write a research summary for a lawyer preparing a bail argument, from Indian Supreme Court bail jurisprudence.

${COUNTER_ATTRIBUTION_RULES}

Additional rules for this summary specifically:

7. This is a RESEARCH SUMMARY, not a document to file in court. Do not draft a petition, an application, or anything in filing form. You are surfacing what the corpus contains and helping a lawyer think, not producing a paragraph they would submit verbatim.
8. No confidence percentages or probability-of-success claims ("70% likely to succeed"). This corpus is 198 judgments; that kind of precision is not defensible and invites over-reliance.
9. Some submissions in the retrieved passages are marked SIDE NOT DETERMINED — this system could not tell whether they favour bail or oppose it. Present them as "a submission was made along these lines" without asserting which side made it, and without silently treating them as either supporting or opposing the user's position.
10. There is no rebuttal round in this version — if none of the retrieved passages show a prior court response to an opposing argument, do not invent one. Say plainly that the corpus does not show whether that specific argument succeeded elsewhere. This is expected, not a gap to paper over (Hard Rule 5: "no strong counterargument found" is a valid, honest answer).
11. Every point must cite the passage numbers it is drawn from in its "evidence" array. A point with an empty "evidence" array, or a number that was not supplied, is a failure. Never write citation numbers inside the text fields — they go only in "evidence", so they can be checked and linked automatically.
12. A passage marked SOURCE UNCERTAIN was retrieved both as the court's own reasoning and as a party's submission, so whose voice it is in is unknown. Never attribute a holding to it: do not write that the court held, observed, recognised or established anything on its strength. You may say what the passage states, and you must say that its source is uncertain.

Use only the passages supplied — never fill a gap from general legal knowledge. Return ONE JSON object, nothing else, with exactly these keys:

{
  "premises": ["each separate premise of the user's position, one short sentence each"],
  "weakestPremise": { "number": 1-based index into premises, "why": "one or two sentences on why this premise is the easiest to attack", "evidence": [passage numbers] },
  "yourCase": [{ "point": "short title, under 10 words", "detail": "one or two sentences", "evidence": [passage numbers] }],
  "otherSide": [{ "point": "...", "detail": "...", "evidence": [passage numbers] }],
  "otherSideNote": "only when otherSide is empty: say plainly that nothing substantive was retrieved against this position; otherwise an empty string",
  "statutes": [{ "point": "...", "detail": "...", "evidence": [passage numbers] }],
  "gaps": ["one sentence per thing this corpus does not show"]
}

What goes in each key:
- premises / weakestPremise: break the user's position into its separate premises and pick the weakest — per adversarial-reasoning practice, the weakest premise is the one worth attacking, and identifying it is useful even though this summary is written for the person holding that position.
- yourCase: the supporting law and any strong submissions on the user's side.
- otherSide: what the retrieved material suggests could be argued against this position — opposing-flavoured submissions (side not determined, say so in "detail"), and any doubts raised against the user's own authorities via the citation graph. If nothing substantive was retrieved, leave it empty and fill otherSideNote rather than inventing an opposing argument.
- statutes: only from passages marked STATUTE. An empty list if none were supplied.
- gaps: be explicit — no rebuttal round exists yet, so if an opposing argument has no shown outcome, say the corpus does not indicate whether it succeeded elsewhere.

Write plain sentences in every text field: no markdown headings, tables or lists. *Italics* for case names are fine.`;

const evidence = z.array(z.coerce.number().int()).default([]);
const pointSchema = z.object({
  point: z.string().default(''),
  detail: z.string().default(''),
  evidence,
});
const summarySchema = z.object({
  premises: z.array(z.string()).default([]),
  weakestPremise: z
    .object({ number: z.coerce.number().int(), why: z.string().default(''), evidence })
    .nullable()
    .default(null)
    .catch(null),
  yourCase: z.array(pointSchema).default([]),
  otherSide: z.array(pointSchema).default([]),
  otherSideNote: z.string().default(''),
  statutes: z.array(pointSchema).default([]),
  gaps: z.array(z.string()).default([]),
});

/** Parses the model's JSON and checks every citation against the n passages
 *  it was shown. Out-of-range numbers are reported in `invalidCitations`
 *  (Hard Rule 4: surfaced, not hidden) and left off the citation chips, since
 *  a chip pointing at no passage cannot be opened. Throws if unparseable. */
function parseSummary(raw: string, n: number): { summary: CounterSummary; invalidCitations: number[] } {
  const parsed: CounterSummary = summarySchema.parse(
    JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)),
  );
  const invalid = new Set<number>();
  const valid = (ns: number[]) => {
    ns.filter((x) => x < 1 || x > n).forEach((x) => invalid.add(x));
    return [...new Set(ns.filter((x) => x >= 1 && x <= n))];
  };
  const points = (ps: SummaryPoint[]) =>
    ps.filter((p) => p.point.trim() || p.detail.trim()).map((p) => ({ ...p, evidence: valid(p.evidence) }));

  const w = parsed.weakestPremise;
  const summary: CounterSummary = {
    ...parsed,
    weakestPremise: w && w.number >= 1 && w.number <= parsed.premises.length
      ? { ...w, evidence: valid(w.evidence) }
      : null,
    yourCase: points(parsed.yourCase),
    otherSide: points(parsed.otherSide),
    statutes: points(parsed.statutes),
  };
  return { summary, invalidCitations: [...invalid].sort((a, b) => a - b) };
}

/** The summary as the section-structured markdown `answer` always carried,
 *  so eval/ scripts (faithfulness_check reads sections and Sources rows) are
 *  unchanged. Sources rows come from the passages themselves, not the model. */
function toMarkdown(s: CounterSummary, items: CounterItem[]): string {
  const cite = (ev: number[]) => ev.map((x) => ` [${x}]`).join('');
  const points = (ps: SummaryPoint[]) =>
    ps.map((p, i) => `${i + 1}. **${p.point}** ${p.detail}${cite(p.evidence)}`).join('\n');

  const out = ['## Your Position', s.premises.map((p, i) => `${i + 1}. ${p}`).join('\n')];
  if (s.weakestPremise) {
    out.push(`*Weakest premise:* Premise ${s.weakestPremise.number}. ${s.weakestPremise.why}${cite(s.weakestPremise.evidence)}`);
  }
  out.push('## Your Case', points(s.yourCase) || 'No supporting material was retrieved.');
  out.push('## The Other Side', points(s.otherSide) || s.otherSideNote || 'Nothing substantive was retrieved against this position.');
  if (s.statutes.length) out.push('## Restrictive Statutes', points(s.statutes));
  if (s.gaps.length) out.push('## What This Corpus Does Not Show', s.gaps.map((g) => `- ${g}`).join('\n'));

  const cited = [...new Set([
    ...(s.weakestPremise?.evidence ?? []),
    ...[...s.yourCase, ...s.otherSide, ...s.statutes].flatMap((p) => p.evidence),
  ])].sort((a, b) => a - b);
  if (cited.length) {
    out.push('## Sources', cited.map((x) => {
      const item = items[x - 1];
      return `- [${x}] ${item.caseTitle}${item.year ? ` (${item.year})` : ''}${item.locator ? `, ${item.locator}` : ''}`;
    }).join('\n'));
  }
  return out.join('\n\n');
}

export interface GenerateResult {
  markdown: string;
  summary: CounterSummary | null;
  sourceIds: string[];
  generationFailed: boolean;
  /** Hard Rule 4: "any case name in the output not in the retrieved set is a
   *  hallucination and must fail evaluation." Automatable half of that check
   *  (CounterEngine.md §12 item 2) -- every [N] the model cited must be
   *  within the numbered passages it was actually given. Non-empty means the
   *  model cited a number that doesn't exist; surfaced, not silently fixed. */
  invalidCitations: number[];
}

/** Unparseable JSON gets one more try; an API error (413, rate limit,
 *  network) does not, since a second identical request would fail the same
 *  way and only double the wait. */
const PARSE_ATTEMPTS = 2;

/** Synthesises the answer. Fails open to a plain notice (never a crash, never
 *  a silently-empty answer presented as if it were a real one) if Groq is
 *  unavailable — same posture as classify.ts and relevance.ts. */
export async function generateAnswer(
  req: CounterRequest,
  cls: Classification,
  rounds: RoundResult[],
): Promise<GenerateResult> {
  const { system, user, n } = buildPrompt(req, cls, rounds);
  const items = selectForContext(rounds);
  const sourceIds = items.map((item) => item.id);
  const failed: GenerateResult = { markdown: '', summary: null, sourceIds, generationFailed: true, invalidCitations: [] };

  if (n === 0) {
    return {
      markdown: 'No supporting law, opposing material, or statutes were retrieved for this position. ' +
        'The corpus may simply have nothing on this specific point — that is an honest, expected outcome, not an error.',
      summary: null,
      sourceIds,
      generationFailed: false,
      invalidCitations: [],
    };
  }

  if (!env.groqApiKey) return failed;

  for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt++) {
    let raw: string;
    try {
      const completion = await groq().chat.completions.create({
        model: env.groqModel,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      });
      raw = completion.choices[0]?.message?.content ?? '';
    } catch (err) {
      console.error('[generate] failed:', err);
      return failed;
    }

    try {
      const { summary, invalidCitations } = parseSummary(raw, n);
      if (invalidCitations.length) {
        // Not silently dropped or "fixed" -- Hard Rule 4 says this is a
        // failure, so it is surfaced to the caller (and the UI, per the
        // route) rather than quietly hidden from the response.
        console.error(`[generate] hallucinated citation number(s) outside 1-${n}:`, invalidCitations);
      }
      return { markdown: toMarkdown(summary, items), summary, sourceIds, generationFailed: false, invalidCitations };
    } catch (err) {
      console.error(`[generate] unparseable summary (attempt ${attempt}/${PARSE_ATTEMPTS}):`, err);
    }
  }
  console.error('[generate] failed: no parseable summary after retry');
  return failed;
}
