/**
 * Client for the lawyers' desk. The server allows only verified lawyers and
 * admins; `canUseLawyerTools` mirrors that rule for the UI.
 */
import type { CourtTier, Passage } from '../api';
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
