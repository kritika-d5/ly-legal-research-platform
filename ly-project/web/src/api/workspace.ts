/**
 * Client for the logged-in user's own research: saved judgments, notes and
 * folders. Every call relies on the session cookie; there is no user id in any
 * URL, so the server always answers for whoever is logged in.
 */
import { ApiError } from './auth';
import type { CourtTier } from '../api';

export interface SavedCase {
  tid: number;
  title: string;
  year: number | null;
  court: string;
  courtTier: CourtTier;
  note: string;
  folderIds: string[];
  savedAt: string;
  updatedAt: string;
  /** How later judgments treated it — present in list responses (the precedent check). */
  treatment?: Record<'pos' | 'neg' | 'mixed' | 'neutral' | 'unknown', number>;
}

export interface Folder {
  id: string;
  name: string;
  description: string | null;
  count: number;
  createdAt: string;
  /** Client-matter details; only lawyers can set them. */
  matter?: import('./lawyer').MatterDetails | null;
}

export interface FolderList {
  folders: Folder[];
  total: number;
  unfiled: number;
}

/** 'all' | 'unfiled' | a folder id */
export type FolderFilter = string;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Request failed (${res.status})`, res.status, data.field);
  return data as T;
}

export const listSaved = (folder: FolderFilter, q?: string) => {
  const params = new URLSearchParams({ folder });
  if (q) params.set('q', q);
  return call<{ items: SavedCase[] }>('GET', `/api/me/saved?${params}`).then((r) => r.items);
};
export const getSavedIds = () => call<{ tids: number[] }>('GET', '/api/me/saved/ids').then((r) => r.tids);
export const getSaved = (tid: number) =>
  call<{ item: SavedCase | null }>('GET', `/api/me/saved/${tid}`).then((r) => r.item);
export const saveCase = (tid: number, patch: { note?: string; folderIds?: string[] } = {}) =>
  call<{ item: SavedCase }>('PUT', `/api/me/saved/${tid}`, patch).then((r) => r.item);
export const unsaveCase = (tid: number) => call<{ ok: true }>('DELETE', `/api/me/saved/${tid}`);

export const listFolders = () => call<FolderList>('GET', '/api/me/folders');
export const createFolder = (name: string, description?: string) =>
  call<{ folder: Folder }>('POST', '/api/me/folders', { name, description }).then((r) => r.folder);
export const updateFolder = (id: string, patch: { name?: string; description?: string }) =>
  call<{ folder: Folder }>('PATCH', `/api/me/folders/${id}`, patch).then((r) => r.folder);
export const deleteFolder = (id: string) => call<{ ok: true }>('DELETE', `/api/me/folders/${id}`);

/**
 * React-query keys. All start with 'me' so one invalidation refreshes every
 * view of the user's workspace, and logout (which drops everything except
 * 'auth') clears them.
 */
export const workspaceKeys = {
  all: ['me'] as const,
  savedIds: ['me', 'saved-ids'] as const,
  saved: (tid: number) => ['me', 'saved', tid] as const,
  savedList: (folder: FolderFilter, q: string) => ['me', 'saved-list', folder, q] as const,
  folders: ['me', 'folders'] as const,
};
