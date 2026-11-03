/**
 * Groq client. Model: openai/gpt-oss-120b.
 *
 * The system prompt below is the legal-correctness boundary of this whole
 * product, so it is worth reading before changing.
 *
 * 2,388 of the corpus's 7,722 chunks are text the court REPRODUCED rather than
 * wrote: bare statutory provisions, passages from other judgments, dictionary
 * definitions, foreign decisions. 346 more are SCR headnotes, written by law
 * reporters. A model shown that text with no labels will attribute all of it to
 * the court, and "the Supreme Court held that a police officer shall record
 * reasons in writing" — when that sentence is actually the text of s. 41A CrPC,
 * or worse, a 1925 decision the court went on to overrule — is a wrong statement
 * of law delivered with full confidence.
 *
 * Every passage is therefore handed to the model with its content_type spelled
 * out, and the prompt makes attribution a hard requirement rather than a style
 * preference.
 */
import Groq from 'groq-sdk';
import { env } from '../config.js';
import type { ContentType, Passage } from '../types.js';

let client: Groq | null = null;

export function groq(): Groq {
  if (!env.groqApiKey) {
    throw new Error('GROQ_API_KEY is not set in server/.env');
  }
  if (!client) client = new Groq({ apiKey: env.groqApiKey });
  return client;
}

/** How each content_type must be described to the user. */
export const ATTRIBUTION: Record<ContentType, string> = {
  court_text: "the court's own words in this judgment",
  quoted_case: 'text QUOTED FROM ANOTHER JUDGMENT (not this court speaking)',
  quoted_statute: 'the bare text of a STATUTORY PROVISION reproduced in the judgment',
  quoted_other: 'material QUOTED from an outside source (dictionary, foreign court, report)',
  editorial: 'an SCR HEADNOTE — a summary written by law reporters, not by the court',
};

/**
 * Counter Engine additions (CounterEngine.md §6) — extends ATTRIBUTION rather
 * than duplicating it, so the two documents cannot drift apart. Not yet
 * consumed by a prompt (generate.ts, the LLM answer-synthesis step, is a
 * later build step); v0 only surfaces retrieval rounds as JSON. Written now
 * so it exists in exactly one place once that step is built.
 *
 * `COUNSEL` here is what Counter Engine calls a submissions-type passage
 * (CounterEngine.md §4.4 `speaker`) — distinct from ATTRIBUTION's
 * `quoted_case`/`quoted_other`, which describe text the court reproduced
 * verbatim from elsewhere. A counsel submission is neither: it is this
 * court's own record of what a party argued, not a holding and not a quote.
 */
export const COUNTER_ATTRIBUTION_RULES = `${Object.entries(ATTRIBUTION)
  .map(([type, desc]) => `- ${type}: ${desc}`)
  .join('\n')}
- an argument/submission (speaker COUNSEL): this court's own record of what a party's counsel argued — NOT the court's holding, and not a quotation from elsewhere

Additional rules for adversarial (Counter Engine) output:
1. COUNSEL is not the court. Never write "the Supreme Court held" when the source is an argument.
2. Never present outcome: rejected material as support. It appears only as "this was argued and rejected in ...".
3. Cite only the supplied passages, each by its locator. Any case name not in the supplied set is a failure.
4. HC and pre-1950 sources are persuasive, not binding — say so when relying on them.
5. Decompose the user's position into premises and target the weakest.
6. If a round is empty, say so for that round. Do not fill the gap.`;

export function formatPassages(passages: Passage[]): string {
  return passages
    .map((p, i) => {
      const where = p.locator ? ` | ${p.locator}` : '';
      return `[${i + 1}] (${ATTRIBUTION[p.contentType]}${where})\n${p.text}`;
    })
    .join('\n\n---\n\n');
}

export const CASE_CHAT_SYSTEM = `You are a legal research assistant answering questions about a single Indian Supreme Court or High Court judgment on bail. You are given numbered extracts from that judgment.

ATTRIBUTION RULES — these are not style preferences, they are correctness requirements:

1. Each extract is tagged with what it actually is. Never describe quoted material as the court's holding. If an extract is tagged as statutory text, say "Section X provides..." not "the Court held...". If it is tagged as quoted from another judgment, name it as a quotation. If it is an SCR headnote, say it is the reporter's summary.
2. Cite the extract number you relied on, like [2], after each claim.
3. If the extracts do not answer the question, say so plainly. Do not fill the gap from general knowledge of Indian law — the user is asking about THIS judgment.
4. Quote the judgment's actual words when stating what it decided, rather than paraphrasing into something more definite than the text supports.
5. Where an extract carries a locator (para number or page), include it, because that is how a lawyer verifies the claim.

Answer concisely and in plain English. You are helping someone understand a judgment, not writing a brief.`;

export const SUMMARY_SYSTEM = `You summarise Indian judgments on bail for a research tool.

You are given extracts from one judgment, each tagged with whether it is the court's own words, quoted material, or an SCR headnote written by law reporters.

Produce:
- **Issue** — what the court had to decide, in one or two sentences.
- **Held** — what it decided, and the reasoning that carried it. Base this ONLY on extracts tagged as the court's own words or as the headnote.
- **Principle** — the rule the case is cited for, in one sentence.

Never present quoted statutory text or a passage quoted from another judgment as this court's holding. If the extracts are too thin to support a section, write "not covered in the available extracts" rather than inventing it.`;
