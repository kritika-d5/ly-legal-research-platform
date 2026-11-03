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

/**
 * Model fallback, for the free tier. Each Groq model has its own daily token
 * quota, and the main model's runs out under heavy use (a demo, an eval run).
 * When a call on the main model is rate-limited, it is retried on the
 * fallback models in order, and the main model is skipped until Groq's
 * retry-after has passed, so later calls do not each waste a request on it.
 *
 * The fallback is a smaller model: it answers, but less carefully. Callers
 * that show AI output can call `fallbackUses()` before and after their work
 * to tell the user when the backup model was used.
 */
let primaryBlockedUntil = 0;
let fallbackCount = 0;

/** How many calls have been served by a fallback model since start-up. */
export const fallbackUses = () => fallbackCount;

export function modelStatus() {
  const blocked = primaryBlockedUntil > Date.now();
  return {
    model: env.groqModel,
    fallbackModels: env.groqFallbackModels,
    usingFallback: blocked,
    primaryAvailableAt: blocked ? new Date(primaryBlockedUntil).toISOString() : null,
  };
}

const isRateLimit = (err: unknown) => (err as { status?: number }).status === 429;

function retryAfterMs(err: unknown): number {
  const headers = (err as { headers?: Record<string, string> }).headers;
  const seconds = Number(headers?.['retry-after']);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 60_000;
}

type Create = Groq['chat']['completions']['create'];

function withFallback(create: Create): Create {
  return (async (body: Parameters<Create>[0], options?: Parameters<Create>[1]) => {
    const fallbacks = env.groqFallbackModels.filter((m) => m !== body.model);
    if (body.model !== env.groqModel || !fallbacks.length) return create(body, options);

    let lastError: unknown;
    if (primaryBlockedUntil <= Date.now()) {
      try {
        return await create(body, options);
      } catch (err) {
        if (!isRateLimit(err)) throw err;
        primaryBlockedUntil = Date.now() + retryAfterMs(err);
        console.warn(`[llm] ${body.model} rate-limited; using ${fallbacks.join(', ')} until ${new Date(primaryBlockedUntil).toISOString()}`);
        lastError = err;
      }
    }
    for (const model of fallbacks) {
      try {
        // A smaller reasoning model can spend Groq's default output cap on
        // reasoning alone; keep it brief unless the caller chose otherwise.
        const reply = await create({ reasoning_effort: 'low', ...body, model } as typeof body, options);
        fallbackCount++;
        return reply;
      } catch (err) {
        if (!isRateLimit(err)) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }) as Create;
}

export function groq(): Groq {
  if (!env.groqApiKey) {
    throw new Error('GROQ_API_KEY is not set in server/.env');
  }
  if (!client) {
    client = new Groq({ apiKey: env.groqApiKey });
    const completions = client.chat.completions;
    completions.create = withFallback(completions.create.bind(completions));
  }
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

/** `prefix` labels extracts from different judgments apart: [A1] vs [B1]. */
export function formatPassages(passages: Passage[], prefix = ''): string {
  return passages
    .map((p, i) => {
      const where = p.locator ? ` | ${p.locator}` : '';
      return `[${prefix}${i + 1}] (${ATTRIBUTION[p.contentType]}${where})\n${p.text}`;
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

/**
 * Side-by-side comparison, for the judges' research desk.
 *
 * Two extra boundaries beyond the chat rules. First, it compares what two
 * judgments SAY; it never advises how any case should be decided, because a
 * research aid that drafts outcomes for a judge is the wrong tool to build.
 * Second, it must weigh the judgments properly: a later or larger bench, or a
 * Supreme Court decision over a High Court one, is not an equal voice.
 */
export const COMPARE_SYSTEM = `You help a judge compare two Indian judgments on bail. You are given numbered extracts from Judgment A (labelled [A1], [A2]...) and Judgment B ([B1], [B2]...), plus each judgment's court and date, and a research question.

ATTRIBUTION RULES — correctness requirements, not style:
1. Each extract is tagged with what it is. Never present quoted statutory text, a passage quoted from another judgment, or an SCR headnote as the court's own holding. Say "the judgment reproduces Section X" or "quoting Y, the court noted" where that is what the extract is.
2. Cite the extract label, like [A3] or [B1], after every claim.
3. If the extracts do not show what a judgment says on the question, say so for that judgment. Do not fill gaps from general knowledge.
4. Quote the judgments' own words for anything they decided.
5. Courts often set out a view in order to reject it ("it was contended that...", "the High Court held that...", "we are unable to agree"). Never present a view the court describes, summarises or rejects as that court's own holding. If an extract is ambiguous about whether the court adopts a view, say so.

WEIGHT: note which judgment is later, and whether they are from the Supreme Court or a High Court. Do not assume they carry equal weight, and do not say one overrules the other unless an extract says so.

BOUNDARY: You compare what the judgments say. You do not advise how any pending or hypothetical case should be decided, and you do not recommend granting or refusing bail. If the question asks for that, your FIRST line must say that this tool compares precedent and does not suggest outcomes; then restate the question as the underlying legal point (e.g. "What do the judgments say about anticipatory bail in cases of fraud?") and compare on that. Never end with advice on applying the law to the facts of a case.

FORMAT (markdown):
**Question** — restate it in one line.
**Judgment A** — what it says on the question, with citations.
**Judgment B** — the same.
**Where they agree** / **Where they differ** — short bullets.
**Weight** — one or two lines on court, date and bench as far as the extracts or metadata show.`;
