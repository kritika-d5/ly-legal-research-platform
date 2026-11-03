/**
 * Client for the lawyers' desk. The server allows only verified lawyers and
 * admins; `canUseLawyerTools` mirrors that rule for the UI.
 */
import type { CaseResult, CounterResponse, CourtTier, OffenceCategory, Passage } from '../api';
import { ApiError, type User } from './auth';
import type { PolarityCounts } from './judge';
import type { Folder } from './workspace';

export function canUseLawyerTools(user: User | null) {
  if (!user) return false;
  return user.role === 'admin' || (user.role === 'lawyer' && user.verification.status === 'verified');
}

export interface MatterDetails {
  client?: string;
  court?: string;
  caseNumber?: string;
  stage?: string;
  nextHearing?: string;
  issue?: string;
}

export interface Matter extends Folder {
  matter: MatterDetails | null;
  flagged: number;
}

export interface BriefAuthority {
  tid: number;
  title: string;
  year: number | null;
  date: string | null;
  court: string;
  courtTier: CourtTier;
  citation: string | null;
  note: string;
  treatment: PolarityCounts;
  disagreedBy: { tid: number; title: string; year: number | null; polarity: 'neg' | 'mixed' }[];
  passages: Passage[];
}

export interface Brief {
  matter: Folder & { matter: MatterDetails | null };
  issue: string;
  authorities: BriefAuthority[];
  preparedBy: string;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const listMatters = () => call<{ matters: Matter[] }>('GET', '/api/lawyer/matters');
export const saveMatterDetails = (folderId: string, details: MatterDetails) =>
  call<{ matter: Matter }>('PUT', `/api/lawyer/matters/${folderId}`, details).then((r) => r.matter);
export const getBrief = (folderId: string, issue?: string) =>
  call<Brief>('GET', `/api/lawyer/brief/${folderId}${issue ? `?issue=${encodeURIComponent(issue)}` : ''}`);

export const MATTER_STAGES = [
  'Anticipatory bail application',
  'Regular bail application',
  'Default bail application',
  'Bail appeal / revision',
  'Cancellation of bail',
  'Other',
];

/** "X vs Y on 9 April, 1980" → "X v. Y", the form used in a list of authorities. */
export function authorityName(title: string) {
  return title
    .replace(/\s+on\s+\d{1,2}\s+\w+,\s*\d{4}\s*$/i, '')
    .replace(/\s+vs\.?\s+/i, ' v. ')
    .trim();
}

/* ------------------------------------------------------------------------ */
/* Bail case analysis: from the client's facts to a research brief.          */
/* ------------------------------------------------------------------------ */

export const BAIL_SOUGHT = {
  unknown: 'Not sure / let the analysis decide',
  regular: 'Regular bail',
  anticipatory: 'Anticipatory bail',
  interim: 'Interim bail',
  default: 'Default (statutory) bail',
  suspension_of_sentence: 'Suspension of sentence',
} as const;
export type BailSought = keyof typeof BAIL_SOUGHT;

export const OFFENCE_LABEL: Record<OffenceCategory, string> = {
  ordinary: 'Ordinary (IPC / BNS)',
  economic: 'Economic offence',
  ndps: 'NDPS',
  pmla: 'PMLA',
  uapa: 'UAPA',
  other_special: 'Other special statute',
};

/** Same list, same order, as FACTORS in server/src/lib/bailAnalysis.ts. */
export const FACTOR_LABEL: Record<string, string> = {
  gravity_of_offence: 'Gravity of the offence',
  prima_facie_case: 'Prima facie case',
  flight_risk: 'Flight risk',
  tampering_with_evidence: 'Tampering with evidence',
  influencing_witnesses: 'Influencing witnesses',
  criminal_antecedents: 'Criminal antecedents',
  period_of_custody: 'Period in custody',
  delay_in_trial: 'Delay in trial',
  parity: 'Parity with co-accused',
  health_age_or_gender: 'Health, age or gender',
  personal_liberty: 'Personal liberty',
  statutory_restriction: 'Statutory restriction on bail',
  conduct_of_accused: 'Conduct of the accused',
};

export interface CaseIntake {
  inScope: boolean;
  summary: string;
  bailSought: BailSought;
  offenceCategory: OffenceCategory;
  issues: { issue: string; why: string }[];
  /** `stated`: the section appears in the facts. `suggested`: the model added it — verify. */
  sections: {
    act: string;
    section: string;
    about: string;
    source: 'stated' | 'suggested';
    /** IPC ⇄ BNS / CrPC ⇄ BNSS from the official table; empty `sections` = no entry */
    equivalent?: { code: string; sections: string[]; subject: string };
  }[];
  factors: { factor: string; status: 'favourable' | 'unfavourable' | 'missing'; note: string }[];
  missingFacts: { fact: string; why: string }[];
  weaknesses: { weakness: string; why: string }[];
  bailPosition: string;
  searchQuery: string;
}

export interface CaseAnalysis {
  intake: CaseIntake;
  similar: CaseResult[];
  counter: CounterResponse | null;
  /** the facts were longer than the server reads; only the first part was analysed */
  truncated: boolean;
  /** the main AI model was rate-limited, so a smaller backup model wrote some of this */
  usedFallbackModel: boolean;
  /** the saved result of the sample case, not a live run */
  savedExample: boolean;
  tookMs: number;
}

export const analyseCase = (body: { facts: string; bailSought?: BailSought; offenceCategory?: OffenceCategory; fresh?: boolean }) =>
  call<CaseAnalysis>('POST', '/api/lawyer/analysis', body);

/** The built-in sample case (invented facts), and whether the server has a saved result for it. */
export const getSampleCase = () => call<{ facts: string; saved: boolean }>('GET', '/api/lawyer/analysis/sample');
