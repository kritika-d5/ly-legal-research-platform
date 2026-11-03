/**
 * FIR Assistant API client.
 *
 * Talks to the FIR backend through the LY Express proxy at /api/fir/*.
 * The FIR backend owns its own routes, CaseState schema, and SQLite
 * persistence. This client is a thin typed wrapper — no FIR business logic
 * lives here.
 *
 * IMPORTANT: This is completely separate from the Legal Research API client
 * (api.ts). FIR and Legal Research must never share state, history, or data.
 */

// ---------------------------------------------------------------------------
// Types — mirrors FIR backend Pydantic schemas (app/models/*)
// ---------------------------------------------------------------------------

export type FactStatus =
  | 'explicit'
  | 'extracted'
  | 'confirmed'
  | 'uncertain'
  | 'unknown'
  | 'declined'
  | 'not_provided';

export type CaseStatus = 'in_progress' | 'awaiting_confirmation' | 'complete';

export type IdentityStatus = 'known' | 'partially_known' | 'unknown' | 'not_provided';

export type ActType =
  | 'physical_assault'
  | 'threat'
  | 'verbal_abuse'
  | 'harassment'
  | 'taking_property'
  | 'property_damage'
  | 'entering_premises'
  | 'cheating_or_fraud'
  | 'stalking_or_following'
  | 'online_or_message_based'
  | 'other';

export type Priority = 'high' | 'medium' | 'low' | 'optional';

export type ContradictionType =
  | 'direct'
  | 'location'
  | 'identity'
  | 'event'
  | 'timeline'
  | 'relationship'
  | 'other';

export type Severity = 'low' | 'medium' | 'high';

export type NextAction = 'ask_question' | 'clarify_contradiction' | 'review_summary' | 'complete' | 'error';

export interface Fact<T = unknown> {
  value: T | null;
  status: FactStatus;
  approximate: boolean;
  description: string | null;
  turn: number | null;
  history: Record<string, unknown>[];
}

export interface Person {
  name: Fact<string>;
  age: Fact<number>;
  gender: Fact<string>;
  address: Fact<string>;
  contact: Fact<string>;
  relationship_to_other_party: Fact<string>;
  other_details: Fact<string>;
}

export interface Accused {
  accused_id: string;
  identity_status: IdentityStatus;
  name: Fact<string>;
  alias: Fact<string>;
  description: Fact<string>;
  relationship_to_complainant: Fact<string>;
  address_or_whereabouts: Fact<string>;
  alleged_actions: string[];
}

export interface Incident {
  date: Fact<string>;
  time: Fact<string>;
  location: Fact<string>;
  location_details: Fact<string>;
  description: Fact<string>;
  ongoing_or_repeated: Fact<boolean>;
}

export interface Act {
  act_id: string;
  type: ActType;
  description: string;
  by: string | null;
  against: string | null;
  status: FactStatus;
  turn: number | null;
}

export interface Injury {
  injury_id: string;
  type: Fact<string>;
  body_part: Fact<string>;
  severity_as_described: Fact<string>;
  treatment_received: Fact<boolean>;
  hospital_or_doctor: Fact<string>;
  medical_report_available: Fact<boolean>;
  injured_person: Fact<string>;
}

export interface Weapon {
  weapon_id: string;
  object: Fact<string>;
  description: Fact<string>;
  used: Fact<boolean>;
  how_used: Fact<string>;
}

export interface PropertyItem {
  property_id: string;
  item: Fact<string>;
  description: Fact<string>;
  approximate_value: Fact<string>;
  owner: Fact<string>;
  what_happened: Fact<string>;
  recovered: Fact<boolean>;
  force_or_threat_used: Fact<boolean>;
}

export interface Witness {
  witness_id: string;
  name: Fact<string>;
  relationship: Fact<string>;
  contact: Fact<string>;
  what_witnessed: Fact<string>;
}

export type EvidenceType =
  | 'cctv'
  | 'photograph'
  | 'video'
  | 'audio'
  | 'messages'
  | 'email'
  | 'document'
  | 'medical_report'
  | 'bill_or_receipt'
  | 'call_records'
  | 'other';

export interface Evidence {
  evidence_id: string;
  type: EvidenceType;
  description: Fact<string>;
  in_possession: Fact<boolean>;
  reference: Fact<string>;
}

export interface TimelineEvent {
  sequence: number;
  time_description: string | null;
  description: string;
  turn: number | null;
}

export interface ContextFlags {
  injury_occurred: Fact<boolean>;
  weapon_involved: Fact<boolean>;
  property_involved: Fact<boolean>;
  threat_involved: Fact<boolean>;
  witnesses_present: Fact<boolean>;
  evidence_available: Fact<boolean>;
  police_informed_earlier: Fact<boolean>;
}

export interface Contradiction {
  contradiction_id: string;
  type: ContradictionType;
  field: string;
  earlier_value: string | null;
  later_value: string | null;
  earlier_turn: number | null;
  later_turn: number | null;
  explanation: string;
  severity: Severity;
  requires_clarification: boolean;
  resolved: boolean;
  resolution: string | null;
}

export interface MissingInformation {
  field: string;
  priority: Priority;
  reason: string;
  suggested_question: string;
}

export interface AskedQuestion {
  field: string;
  question: string;
  turn: number;
  times_asked: number;
}

export interface CaseState {
  schema_version: string;
  case_id: string;
  created_at: string;
  updated_at: string;
  status: CaseStatus;
  language: string;
  turn_count: number;
  questions_asked: number;
  complainant: Person;
  complainant_is_victim: Fact<boolean>;
  victim: Person;
  accused: Accused[];
  incident: Incident;
  acts: Act[];
  injuries: Injury[];
  weapons: Weapon[];
  property: PropertyItem[];
  witnesses: Witness[];
  evidence: Evidence[];
  timeline: TimelineEvent[];
  flags: ContextFlags;
  contradictions: Contradiction[];
  missing_information: MissingInformation[];
  completion_percentage: number;
  asked_questions: AskedQuestion[];
  declined_fields: string[];
  unknown_fields: string[];
  pending_clarification: string | null;
  user_confirmed: boolean;
  final_summary: string | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

export interface CaseCreatedResponse {
  case_id: string;
  assistant_message: string;
  status: CaseStatus;
  disclaimer: string;
}

export interface CaseListItem {
  case_id: string;
  created_at: string;
  updated_at: string;
  status: CaseStatus;
}

export interface ChatMessage {
  role: string;
  content: string;
  turn: number;
  created_at: string | null;
}

export interface ProgressItem {
  label: string;
  status: 'done' | 'missing' | 'unknown' | 'not_applicable';
  detail: string | null;
}

export interface CompletenessReport {
  complete: boolean;
  completion_percentage: number;
  missing: MissingInformation[];
  recommended_questions: string[];
  applicable_fields: number;
  resolved_fields: number;
  exhausted_fields: string[];
}

export interface MessageResponse {
  case_id: string;
  assistant_message: string;
  next_action: NextAction;
  status: CaseStatus;
  completeness: CompletenessReport;
  open_contradictions: Contradiction[];
  changes: string[];
  progress: ProgressItem[];
  case_state: CaseState;
  warning: string | null;
}

export interface CaseStateResponse {
  case_state: CaseState;
}

export interface CaseDetailResponse {
  case_id: string;
  status: CaseStatus;
  created_at: string;
  updated_at: string;
  messages: ChatMessage[];
  completeness: CompletenessReport;
  progress: ProgressItem[];
  case_state: CaseState;
}

export interface SummaryResponse {
  case_id: string;
  status: CaseStatus;
  summary: string;
  open_contradictions: Contradiction[];
  completeness: CompletenessReport;
}

export interface ConfirmResponse {
  case_id: string;
  status: CaseStatus;
  user_confirmed: boolean;
  assistant_message: string;
  case_state: CaseState;
}

// ---------------------------------------------------------------------------
// Fact helpers — the API sends plain JSON, so the Pydantic methods
// (Fact.has_value, Fact.display, Accused.label in app/models/case_state.py)
// do not exist on these objects. These mirror them; keep the two in step.
// ---------------------------------------------------------------------------

export function factHasValue(fact: Fact): boolean {
  return fact.value !== null || (fact.approximate && !!fact.description);
}

/** Fact.display(). `markApproximate: false` leaves the "(approx.)" suffix to the caller. */
export function factDisplay(fact: Fact, { markApproximate = true } = {}): string {
  const approx = markApproximate ? ' (approx.)' : '';
  if (fact.value !== null) return String(fact.value) + (fact.approximate ? approx : '');
  if (fact.approximate && fact.description) return fact.description + approx;
  if (fact.status === 'unknown') return 'not known to complainant';
  if (fact.status === 'declined') return 'declined to share';
  return 'not provided';
}

/** Accused.label(), e.g. 'Rahul' or "unidentified person (tall man in red shirt)". */
export function accusedLabel(a: Accused): string {
  if (a.name.value) return a.name.value;
  if (a.alias.value) return `person known as '${a.alias.value}'`;
  if (a.description.value) return `unidentified person (${a.description.value})`;
  return 'unidentified person';
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const FIR_API_BASE = '/api/fir';

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${FIR_API_BASE}${path}`;
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(url, options);

  if (!res.ok) {
    let detail = `request failed (${res.status})`;
    try {
      const data = await res.json();
      detail = data.detail || data.error || detail;
    } catch {
      // non-JSON error response
    }
    throw new FirApiError(detail, res.status);
  }

  return res.json() as Promise<T>;
}

/** Custom error class for FIR API failures */
export class FirApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FirApiError';
    this.status = status;
  }
}

// ---------------------------------------------------------------------------
// Endpoint functions
// ---------------------------------------------------------------------------

export function createFirCase(language = 'en') {
  return request<CaseCreatedResponse>('POST', '/cases', { language });
}

export function listFirCases(limit = 50) {
  return request<CaseListItem[]>('GET', `/cases?limit=${limit}`);
}

export function getFirCase(caseId: string) {
  return request<CaseDetailResponse>('GET', `/cases/${caseId}`);
}

export function getFirCaseState(caseId: string) {
  return request<CaseStateResponse>('GET', `/cases/${caseId}/state`);
}

export function getFirMessages(caseId: string) {
  return request<ChatMessage[]>('GET', `/cases/${caseId}/messages`);
}

export function getFirCompleteness(caseId: string) {
  return request<CompletenessReport>('GET', `/cases/${caseId}/completeness`);
}

export function getFirSummary(caseId: string) {
  return request<SummaryResponse>('GET', `/cases/${caseId}/summary`);
}

export function sendFirMessage(caseId: string, message: string) {
  return request<MessageResponse>('POST', `/cases/${caseId}/messages`, { message });
}

export function confirmFirCase(caseId: string, confirmed: boolean, note?: string) {
  return request<ConfirmResponse>('POST', `/cases/${caseId}/confirm`, { confirmed, note });
}
