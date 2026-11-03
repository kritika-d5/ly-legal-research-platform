/**
 * R0 — classify the user's position before any retrieval runs.
 *
 * Two things decided here, both consequential if wrong:
 *
 *  1. `inScope` — README rule "Bail only." A position about property, tax or
 *     matrimonial law must be refused, not answered from the model's general
 *     knowledge, because nothing in this corpus grounds that answer.
 *
 *  2. `offenceCategory` — CounterEngine.md §4.2: inferred, not left to a
 *     dropdown, because a dropdown is friction on every query. But a WRONG
 *     silent inference means missing s.37 NDPS / s.45 PMLA / s.43D(5) UAPA
 *     entirely, which is most of the anti-bail case in those matters. So it
 *     is inferred here, then handed back with `offenceInferred: true` so the
 *     UI can render it as an editable "Detected: NDPS ✎" chip rather than an
 *     invisible guess.
 *
 * The model emits labels only, never prose that reaches the user — same
 * discipline as CHUNKING.md Hard Rule 4 and ARGUMENTS.md Stage C.
 */
import { z } from 'zod';
import { env } from '../config.js';
import { groq } from './llm.js';
import type { Classification, OffenceCategory } from '../types.js';

const OFFENCE_CATEGORIES = [
  'ordinary', 'economic', 'ndps', 'pmla', 'uapa', 'other_special',
] as const;

const classificationSchema = z.object({
  inScope: z.boolean(),
  topics: z.array(z.string()).max(6),
  offenceCategory: z.enum(OFFENCE_CATEGORIES),
});

const SYSTEM = `You classify a bail-law research query for an Indian Supreme Court bail research tool.

The corpus is 198 Supreme Court (and a few High Court) bail judgments, 1912-2022. Nothing else — no property, contract, tax, matrimonial, criminal-merits-of-the-case, or civil law.

"Bail law" here is broader than the literal word "bail". The corpus's own centerpiece
authority (Satender Kumar Antil v CBI) is about whether arrest and continued custody are
necessary at all -- offence categories, Section 41/41A CrPC notice before arrest, and
custody-necessity are core bail-adjacent doctrine, not a different topic. A question can
be squarely in scope while never using the word "bail" -- e.g. "was this arrest proper
without a s.41A notice", "should he have been taken into custody", "is pre-trial
detention justified here". Judge scope by whether the corpus's bail/arrest/custody
jurisprudence could plausibly address the question, not by whether "bail" appears in it.

Given the user's POSITION, return JSON only, no prose, matching exactly:
{
  "inScope": boolean,        // true if this is a bail/arrest/custody-law question the corpus could plausibly address (see above -- do not require the literal word "bail")
  "topics": string[],        // up to 6 short snake_case tags, e.g. "delay_in_trial", "article_21", "section_436A", "flight_risk", "economic_offence"
  "offenceCategory": one of "ordinary" | "economic" | "ndps" | "pmla" | "uapa" | "other_special"
}

offenceCategory guide:
- "ndps": Narcotic Drugs and Psychotropic Substances Act, drugs
- "pmla": Prevention of Money Laundering Act, money laundering
- "uapa": Unlawful Activities (Prevention) Act, terrorism, sedition-adjacent
- "economic": financial fraud, cheating of large sums, bank fraud, 2G/coal-type scams, corruption, NOT covered by ndps/pmla/uapa
- "other_special": any other special statute with its own bail rigours (e.g. POCSO, Companies Act s.212(6)) not covered above
- "ordinary": everything else — regular IPC/BNS offences with no special bail statute

If the position names no offence at all (a pure legal-principle question like "when can anticipatory bail be granted"), use "ordinary".
If the position is not about bail law at all, set inScope to false and offenceCategory to "ordinary".`;

const FALLBACK: Classification = {
  inScope: true,
  topics: [],
  offenceCategory: 'ordinary',
  offenceInferred: true,
  classificationFailed: true,
};

/**
 * `classificationFailed` covers both fallback paths, not only the try/catch
 * one: a missing GROQ_API_KEY means scope was just as unverified as a broken
 * LLM call did — the honest banner ("couldn't verify this is in scope") is
 * equally true either way, so both set the flag rather than only the second.
 */
export async function classify(
  position: string,
  providedOffenceCategory?: OffenceCategory,
): Promise<Classification> {
  if (!env.groqApiKey) {
    // No key configured: fail open to "in scope, ordinary" rather than block
    // the whole feature on an optional key, same posture as chat/summary
    // routes take for THEIR Groq dependency being absent.
    return providedOffenceCategory
      ? { ...FALLBACK, offenceCategory: providedOffenceCategory, offenceInferred: false }
      : FALLBACK;
  }

  try {
    const completion = await groq().chat.completions.create({
      model: env.groqModel,
      temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: `POSITION: ${position}` },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    const parsed = classificationSchema.parse(JSON.parse(raw));

    return {
      inScope: parsed.inScope,
      topics: parsed.topics,
      offenceCategory: providedOffenceCategory ?? parsed.offenceCategory,
      offenceInferred: !providedOffenceCategory,
      classificationFailed: false,
    };
  } catch (err) {
    // A malformed or missing classification must not silently take down the
    // whole request. Fail open to "in scope, ordinary" and log — this mirrors
    // ARGUMENTS.md Stage C's rule that a missing evidence paragraph downgrades
    // to `unclear` automatically rather than the model being trusted to guess.
    // `classificationFailed: true` is what tells the UI to say so, rather
    // than silently presenting an unverified guess as a real classification.
    console.error('[classify] falling back:', err);
    return providedOffenceCategory
      ? { ...FALLBACK, offenceCategory: providedOffenceCategory, offenceInferred: false }
      : FALLBACK;
  }
}
