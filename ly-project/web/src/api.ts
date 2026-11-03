/**
 * Typed client for the LegalPlatform API.
 *
 * `contentType` is threaded through every shape here on purpose. It is what
 * lets the UI say "this is the statute, not the holding" — the distinction the
 * whole corpus was built to preserve. Do not drop it when adding fields.
 */

export type ContentType =
  | 'court_text'
  | 'quoted_case'
  | 'quoted_statute'
  | 'quoted_other'
  | 'editorial';

export type CourtTier = 'SC' | 'HC' | 'OTHER';

export interface Passage {
  id: string;
  tid: number;
  text: string;
  locator: string | null;
  contentType: ContentType;
  sectionPrimary: string;
  chunkKind: 'body' | 'headnote';
  score: number;
  via: ('vector' | 'text')[];
  /** cosine similarity 0–1; null when only keyword search found it */
  semanticScore?: number | null;
  /** BM25 relative to this query's best keyword hit, 0–1; null when only vector search found it */
  keywordScore?: number | null;
  /** where query words occur in `text` */
  highlights?: Span[];
}

/** Half-open character range [start, end) into a passage's text. */
export interface Span {
  start: number;
  end: number;
}

export type MatchStrength = 'strong' | 'partial' | 'weak';

export interface Explanation {
  id: string;
  /** null when the LLM was unavailable and a keyword-based reason is shown instead */
  match: MatchStrength | null;
  why: string;
  /** the sentence behind the match, verified verbatim in the passage */
  keySpan: Span | null;
  source: 'llm' | 'fallback';
}

export interface CaseResult {
  tid: number;
  title: string;
  year: number;
  court: string;
  courtTier: CourtTier;
  layer: string;
  hasPdf: boolean;
  score: number;
  citedByCount: number;
  passages: Passage[];
}

export interface SearchResponse {
  query: string;
  tookMs: number;
  count: number;
  results: CaseResult[];
}

export interface Citation {
  tid: number;
  title: string;
  year: number | null;
  courtTier: CourtTier;
  direction: 'cites' | 'cited_by';
  polarity: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

export interface CaseDetail {
  tid: number;
  title: string;
  publishdate: string | null;
  year: number | null;
  court: string;
  courtTier: CourtTier;
  author: string | null;
  neutralCitation: string | null;
  layer: string | null;
  duplicateOf: number | null;
  hasPdf: boolean;
  pdfUrl: string | null;
  chunkStats: { contentType: ContentType; chunks: number; tokens: number }[];
  citations: { cites: Citation[]; citedBy: Citation[] };
}

export interface CaseText {
  tid: number;
  title: string;
  count: number;
  chunks: {
    id: string;
    seq: number;
    text: string;
    locator: string | null;
    contentType: ContentType;
    chunkKind: 'body' | 'headnote';
    sectionPrimary: string;
    tokens: number;
  }[];
}

/* ------------------------------------------------------------------------ *
 * Counter Engine (CounterEngine.md). v0: `stance` and `outcome` are never
 * set by the server — the `arguments` collection they'd come from does not
 * exist yet. `stanceUndetermined: true` is the honest substitute; the UI
 * must render that, never a guessed side (CounterEngine.md §11).
 * `speakerUncertain: true` is the same for speaker: two rounds retrieved the
 * passage under different speakers, so the UI must say so, never show either.
 * ------------------------------------------------------------------------ */

export type OffenceCategory =
  | 'ordinary' | 'economic' | 'ndps' | 'pmla' | 'uapa' | 'other_special';

export type Side = 'pro_bail' | 'anti_bail';

export interface Classification {
  inScope: boolean;
  topics: string[];
  offenceCategory: OffenceCategory;
  offenceInferred: boolean;
  /** true when scope was never actually verified (no Groq key, or the LLM
   *  call errored) — drives the "couldn't verify" banner, never silent. */
  classificationFailed: boolean;
}

export type Speaker = 'THE COURT' | 'COUNSEL' | 'STATUTE' | 'HEADNOTE';

export interface BecauseOf {
  tid: number;
  title: string;
  polarity: 'neg' | 'mixed';
}

export interface CounterItem {
  id: string;
  kind: 'court_holding' | 'argument' | 'statute';
  text: string;
  speaker: Speaker;
  stance?: Side;
  outcome?: 'accepted' | 'rejected' | 'not_addressed' | 'unclear';
  stanceUndetermined?: boolean;
  speakerUncertain?: boolean;
  tid: number;
  caseTitle: string;
  year: number;
  courtTier: CourtTier;
  locator: string | null;
  paraIds: string[];
  authorities?: { tid: number; title: string }[];
  viaGraph?: boolean;
  becauseOf?: BecauseOf[];
  /** Round 4 (rebuttals) — never populated in v0, needs ARGUMENTS.md Stage C.
   *  Declared now so ArgumentCard's nested-response rendering does not need
   *  to change shape when that round is built. */
  responses?: CounterResponseItem[];
}

export interface CounterResponseItem {
  kind: 'argument_failed' | 'authority_doubted';
  text: string;
  tid: number;
  caseTitle: string;
  locator: string | null;
  polarity?: 'neg' | 'mixed';
}

export interface RoundResult {
  round: 'supporting' | 'opposing' | 'statutes';
  items: CounterItem[];
  empty: boolean;
}

/** `evidence` holds 1-based passage numbers: N is `sourceIds[N - 1]`. */
export interface SummaryPoint {
  point: string;
  detail: string;
  evidence: number[];
}

export interface CounterSummary {
  premises: string[];
  /** `number` is 1-based into `premises` */
  weakestPremise: { number: number; why: string; evidence: number[] } | null;
  yourCase: SummaryPoint[];
  otherSide: SummaryPoint[];
  otherSideNote: string;
  statutes: SummaryPoint[];
  gaps: string[];
}

export interface CounterResponse {
  classification: Classification;
  rounds: RoundResult[];
  /** Stage F — synthesised research summary, markdown. Empty when out of
   *  scope or when `generationFailed` is true. */
  answer: string;
  /** The same summary as fixed fields — what the page renders. Null when out
   *  of scope, when nothing was retrieved, or when generation failed. */
  summary: CounterSummary | null;
  /** Passage [N] in `summary` is the round item with id `sourceIds[N - 1]`. */
  sourceIds: string[];
  generationFailed: boolean;
  /** Non-empty means the model cited a passage number that was not in the
   *  retrieved set — a hallucinated citation. Surfaced so the UI can flag
   *  it rather than silently trust every bracket number in `answer`. */
  invalidCitations: number[];
  tookMs: number;
}

export interface CounterRequestBody {
  position: string;
  side: Side;
  offenceCategory?: OffenceCategory;
}

/** POST /api/counter — plain JSON for now; the SSE version is a later step. */
export async function runCounter(body: CounterRequestBody): Promise<CounterResponse> {
  const res = await fetch('/api/counter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `counter failed (${res.status})`);
  }
  return res.json() as Promise<CounterResponse>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface SearchParams {
  q: string;
  courtTier?: CourtTier | '';
  contentTypes?: ContentType[];
}

export function searchCases({ q, courtTier, contentTypes }: SearchParams) {
  const params = new URLSearchParams({ q, limit: '20' });
  if (courtTier) params.set('courtTier', courtTier);
  if (contentTypes?.length) params.set('contentTypes', contentTypes.join(','));
  return get<SearchResponse>(`/api/search?${params}`);
}

/** Server caps this at 10 ids per call. */
export async function explainPassages(q: string, ids: string[]) {
  const res = await fetch('/api/search/explain', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q, ids }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `explain failed (${res.status})`);
  }
  return res.json() as Promise<{ query: string; tookMs: number; explanations: Explanation[] }>;
}

export interface GraphNode {
  id: number;
  title: string;
  /** short label for drawing — the full title is far too long for a node */
  label: string;
  year: number | null;
  courtTier: CourtTier;
  layer: string | null;
  degree: number;
  hasPdf: boolean;
  /**
   * Position relative to the focus case in an ego graph. Set client-side, not
   * by the API: it only has meaning once you have chosen a case to centre on.
   * 'authority' = the focus case cites it; 'citing' = it cites the focus case.
   */
  role?: 'center' | 'authority' | 'citing';
  /** how the focus case treated it, for the hover card */
  treatment?: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  /** injected by the force simulation at render time */
  x?: number;
  y?: number;
}

export interface GraphLink {
  source: number | GraphNode;
  target: number | GraphNode;
  polarity: 'pos' | 'neg' | 'neutral' | 'mixed' | null;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

export interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export const getGraph = () => get<GraphData>('/api/graph');

export const getEgoGraph = (tid: number, depth: 1 | 2 = 1) =>
  get<GraphData & { center: number; depth: number }>(`/api/graph/ego/${tid}?depth=${depth}`);

export const getCase = (tid: number) => get<CaseDetail>(`/api/cases/${tid}`);
export const getCaseText = (tid: number) => get<CaseText>(`/api/cases/${tid}/text`);

export async function getSummary(tid: number) {
  const res = await fetch(`/api/cases/${tid}/summary`, { method: 'POST' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `summary failed (${res.status})`);
  }
  return res.json() as Promise<{ tid: number; title: string; summary: string; passages: Passage[] }>;
}

export type BailOutcome =
  | 'granted'
  | 'rejected'
  | 'partly_granted'
  | 'cancelled'
  | 'remanded'
  | 'directions'
  | 'not_a_bail_decision'
  | 'unclear';

export interface BailAnalysis {
  outcome: BailOutcome;
  bailType: string;
  confidence: 'high' | 'medium' | 'low';
  outcomeStatement: string;
  /** 1-based indices into `passages` — every claim points at its source */
  outcomeEvidence: number[];
  reasons: { reason: string; evidence: number[] }[];
  factors: {
    factor: string;
    label: string;
    weighed: 'for_accused' | 'against_accused' | 'neutral';
    explanation: string;
    evidence: number[];
  }[];
  conditions: string[];
  summary: { background: string; issue: string; decision: string; principle: string };
  evidenceWarning: string | null;
  /** the supporting passage was found by its wording, not cited by the model */
  outcomeEvidenceMatched: boolean;
}

export interface BailAnalysisResponse {
  tid: number;
  title: string;
  analysis: BailAnalysis;
  /** `closing`: one of the judgment's last passages, where the order is made */
  passages: (Passage & { seq: number; closing: boolean })[];
  model: string;
  generatedAt: string;
}

/** The server's cached analysis, or null. Never triggers a model call. */
export async function getCachedBailAnalysis(tid: number) {
  const res = await fetch(`/api/cases/${tid}/bail-analysis`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`bail analysis failed (${res.status})`);
  return res.json() as Promise<BailAnalysisResponse>;
}

export async function analyseBail(tid: number, refresh = false) {
  const res = await fetch(`/api/cases/${tid}/bail-analysis${refresh ? '?refresh=1' : ''}`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `bail analysis failed (${res.status})`);
  }
  return res.json() as Promise<BailAnalysisResponse>;
}

/** How each outcome is shown. Granted/rejected borrow the sage/vermilion
 *  convention the citation badges already use for approval/disapproval. */
export const OUTCOME_LABEL: Record<BailOutcome, { short: string; tone: string; banner: string }> = {
  granted: {
    short: 'Bail granted',
    tone: 'bg-sage-50 text-sage-700 border-sage-200',
    banner: 'border-sage-200 bg-sage-50 text-sage-700',
  },
  rejected: {
    short: 'Bail rejected',
    tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200',
    banner: 'border-vermilion-200 bg-vermilion-50 text-vermilion-700',
  },
  partly_granted: {
    short: 'Partly granted',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
    banner: 'border-gold-200 bg-gold-50 text-gold-700',
  },
  cancelled: {
    short: 'Bail cancelled',
    tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200',
    banner: 'border-vermilion-200 bg-vermilion-50 text-vermilion-700',
  },
  remanded: {
    short: 'Remanded',
    tone: 'bg-navy-50 text-navy-600 border-navy-200',
    banner: 'border-navy-200 bg-navy-50 text-navy-600',
  },
  directions: {
    short: 'Bail directions issued',
    tone: 'bg-navy-50 text-navy-600 border-navy-200',
    banner: 'border-navy-200 bg-navy-50 text-navy-600',
  },
  not_a_bail_decision: {
    short: 'Not a bail decision',
    tone: 'bg-stone-100 text-stone-600 border-stone-300',
    banner: 'border-stone-300 bg-stone-100 text-stone-700',
  },
  unclear: {
    short: 'Outcome unclear',
    tone: 'bg-stone-100 text-stone-600 border-stone-300',
    banner: 'border-stone-300 bg-stone-100 text-stone-700',
  },
};

export interface ChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Streams a case-scoped answer over SSE.
 *
 * `onSources` fires before any token, so the UI can show what the model was
 * given before it starts talking — evidence first, answer second.
 */
export async function streamChat(
  tid: number,
  message: string,
  history: ChatTurn[],
  handlers: {
    onSources: (passages: Passage[]) => void;
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
): Promise<void> {
  const res = await fetch(`/api/cases/${tid}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, history }),
  });

  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({}));
    handlers.onError(body.error ?? `chat failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE frames are separated by a blank line.
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';

    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const dataLine = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || dataLine === undefined) continue;
      const data = JSON.parse(dataLine);
      if (event === 'sources') handlers.onSources(data.passages);
      else if (event === 'token') handlers.onToken(data.text);
      else if (event === 'done') handlers.onDone();
      else if (event === 'error') handlers.onError(data.message);
    }
  }
  handlers.onDone();
}

/** How each content_type is described in the UI. The wording matters: a user
 *  must never read quoted material as the court's ruling. */
export const CONTENT_LABEL: Record<ContentType, { short: string; full: string; tone: string }> = {
  court_text: {
    short: "Court's words",
    full: "The court's own words in this judgment",
    tone: 'bg-sage-50 text-sage-700 border-sage-200',
  },
  editorial: {
    short: 'SCR headnote',
    full: 'A summary written by law reporters, not by the court',
    tone: 'bg-navy-50 text-navy-600 border-navy-200',
  },
  quoted_statute: {
    short: 'Statute text',
    full: 'The bare text of a statutory provision reproduced in the judgment',
    tone: 'bg-gold-50 text-gold-700 border-gold-200',
  },
  quoted_case: {
    short: 'Quoted judgment',
    full: 'Quoted from another judgment — not this court speaking',
    tone: 'bg-terracotta-100 text-terracotta-600 border-terracotta-200',
  },
  quoted_other: {
    short: 'Quoted source',
    full: 'Quoted from an outside source (dictionary, foreign court, report)',
    tone: 'bg-stone-100 text-stone-700 border-stone-300',
  },
};

export const TIER_LABEL: Record<CourtTier, { short: string; full: string; tone: string }> = {
  SC: {
    short: 'Supreme Court',
    full: 'Supreme Court of India — binding on all courts',
    tone: 'bg-stone-800 text-white border-stone-800',
  },
  HC: {
    short: 'High Court',
    full: 'High Court — persuasive, not binding the way a Supreme Court decision is',
    tone: 'bg-white text-stone-700 border-stone-400',
  },
  OTHER: {
    short: 'Tribunal / other',
    full: 'Not a Supreme Court or High Court decision',
    tone: 'bg-white text-stone-500 border-stone-300',
  },
};
