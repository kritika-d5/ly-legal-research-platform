/**
 * IPC ⇄ BNS and CrPC ⇄ BNSS, from the official correspondence tables the
 * server holds (server/src/lib/sectionMap.ts).
 */
export type SectionCode = 'IPC' | 'BNS' | 'CrPC' | 'BNSS';

export interface MapRow {
  new: string;
  subject: string;
  old: string;
  oldSections: string[];
  change: 'same' | 'modified' | 'new';
  summary: string;
}

export interface SectionMapping {
  code: SectionCode;
  section: string;
  to: SectionCode;
  rows: MapRow[];
}

export interface MapSource {
  title: string;
  urls: string[];
  built: string;
}

export interface SectionMention {
  code: SectionCode;
  section: string;
  text: string;
  mapping: SectionMapping | null;
  /** a CrPC reference in a judgment before 1 April 1974: the 1898 Code, not mapped */
  crpc1898: boolean;
}

export const isNewCode = (code: SectionCode) => code === 'BNS' || code === 'BNSS';

/** The other side of a row, from the point of view of the code asked about. */
export const equivalentsOf = (m: SectionMapping, row: MapRow) => (isNewCode(m.code) ? row.oldSections : [row.new]);

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const lookupSection = (q: string, code?: SectionCode) =>
  get<SectionMapping & { source: MapSource }>(
    `/api/sections?${new URLSearchParams(code ? { q, code } : { q })}`,
  );

export const caseSections = (tid: number) =>
  get<{ tid: number; decided: string | null; mentions: SectionMention[]; source: MapSource }>(`/api/cases/${tid}/sections`);

export const CHANGE_LABEL: Record<MapRow['change'], { label: string; className: string }> = {
  same: { label: 'No change', className: 'bg-sage-50 text-sage-700 ring-sage-200' },
  modified: { label: 'Changed', className: 'bg-gold-50 text-gold-700 ring-gold-200' },
  new: { label: 'New in BNS / BNSS', className: 'bg-navy-50 text-navy-700 ring-navy-200' },
};
