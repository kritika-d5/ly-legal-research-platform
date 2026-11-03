/**
 * Client for the judges' research desk. The server allows only verified
 * judges and admins; `canUseJudgeTools` mirrors that rule so the UI can hide
 * what would only return 403.
 */
import type { CourtTier, Passage } from '../api';
import { ApiError, type User } from './auth';

export type Polarity = 'pos' | 'neg' | 'mixed' | 'neutral' | 'unknown';
export type PolarityCounts = Record<Polarity, number>;

export function canUseJudgeTools(user: User | null) {
  if (!user) return false;
  return user.role === 'admin' || (user.role === 'judge' && user.verification.status === 'verified');
}

export interface TreatmentEntry {
  tid: number;
  title: string;
  year: number | null;
  date: string | null;
  courtTier: CourtTier;
  polarity: Polarity;
  polarityCounts: { pos: number; neg: number; neutral: number } | null;
}

export interface Treatment {
  case: { tid: number; title: string; year: number | null; date: string | null; courtTier: CourtTier; court: string };
  timeline: TreatmentEntry[];
  summary: PolarityCounts;
  citesCount: number;
}

export interface MemoAuthority {
  tid: number;
  title: string;
  year: number | null;
  date: string | null;
  court: string;
  courtTier: CourtTier;
  citation: string | null;
  note: string;
  treatment: PolarityCounts;
}

export interface MemoData {
  folder: { id: string; name: string; description: string | null };
  authorities: MemoAuthority[];
  preparedBy: string;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status);
  return data as T;
}

export const getTreatment = (tid: number) => get<Treatment>(`/api/judge/treatment/${tid}`);
export const getMemo = (folderId: string) => get<MemoData>(`/api/judge/memo/${folderId}`);

/**
 * Stream a comparison. Same SSE protocol as case chat, plus a `notice` event
 * the server sends (before any model output) when the question asks for an
 * outcome rather than about the law.
 */
export async function streamCompare(
  body: { a: number; b: number; question?: string },
  handlers: {
    onSources: (s: { a: Passage[]; b: Passage[] }) => void;
    onNotice: (text: string) => void;
    onToken: (text: string) => void;
    onDone: () => void;
    onError: (message: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch('/api/judge/compare', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    handlers.onError(data.error ?? `Comparison failed (${res.status})`);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split('\n\n');
    buffer = frames.pop() ?? '';
    for (const frame of frames) {
      const event = /^event: (.+)$/m.exec(frame)?.[1];
      const line = /^data: (.*)$/m.exec(frame)?.[1];
      if (!event || line === undefined) continue;
      const data = JSON.parse(line);
      if (event === 'sources') handlers.onSources(data);
      else if (event === 'notice') handlers.onNotice(data.text);
      else if (event === 'token') handlers.onToken(data.text);
      else if (event === 'error') handlers.onError(data.message);
    }
  }
  // Called once, when the stream closes — whether or not a `done` event came.
  handlers.onDone();
}

export const POLARITY_INFO: Record<Polarity, { label: string; tone: string; dot: string }> = {
  pos: { label: 'Relied on', tone: 'bg-sage-50 text-sage-700 border-sage-200', dot: 'bg-sage-500' },
  neg: { label: 'Disagreed', tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200', dot: 'bg-vermilion-500' },
  mixed: { label: 'Mixed', tone: 'bg-gold-50 text-gold-700 border-gold-200', dot: 'bg-gold-500' },
  neutral: { label: 'Mentioned', tone: 'bg-stone-100 text-stone-600 border-stone-300', dot: 'bg-stone-400' },
  unknown: { label: 'Not labelled', tone: 'bg-white text-stone-500 border-stone-200', dot: 'bg-stone-300' },
};
