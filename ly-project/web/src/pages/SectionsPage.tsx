import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  CHANGE_LABEL,
  equivalentsOf,
  isNewCode,
  lookupSection,
  type SectionCode,
  type SectionMapping,
} from '../api/sections';
import { inputClass, primaryButton } from '../components/Form';
import Icon from '../components/Icon';
import { useDocumentTitle } from '../useDocumentTitle';

const CODES: { value: SectionCode | ''; label: string }[] = [
  { value: '', label: 'Detect' },
  { value: 'IPC', label: 'IPC' },
  { value: 'BNS', label: 'BNS' },
  { value: 'CrPC', label: 'CrPC' },
  { value: 'BNSS', label: 'BNSS' },
];

const EXAMPLES = ['420', '302', '376', '498A', 'CrPC 438', 'CrPC 439', 'CrPC 436A', 'BNS 318(4)', 'BNSS 483', '124A'];

/**
 * IPC ⇄ BNS and CrPC ⇄ BNSS lookup. Since 1 July 2024 new cases are under
 * the BNS and BNSS, while every judgment in this corpus cites the IPC and
 * CrPC; this page connects the two, from the official correspondence tables.
 */
export default function SectionsPage() {
  useDocumentTitle('IPC ⇄ BNS');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const code = (params.get('code') ?? '') as SectionCode | '';
  const [draft, setDraft] = useState(q);

  const { data, error, isFetching } = useQuery({
    queryKey: ['sections', q, code],
    queryFn: () => lookupSection(q, code || undefined),
    enabled: q.trim().length > 0,
    staleTime: Infinity,
  });

  const go = (next: string, nextCode: SectionCode | '' = code) => {
    setDraft(next);
    const p: Record<string, string> = {};
    if (next.trim()) p.q = next.trim();
    if (nextCode) p.code = nextCode;
    setParams(p);
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gold-600">
        <Icon name="scale" size={14} /> New criminal laws
      </p>
      <h1 className="mt-2 font-serif text-2xl font-semibold tracking-tight text-maroon-800">IPC ⇄ BNS and CrPC ⇄ BNSS</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Since 1 July 2024, offences are charged under the Bharatiya Nyaya Sanhita (BNS) and procedure follows the
        Bharatiya Nagarik Suraksha Sanhita (BNSS). The judgments here cite the old IPC and CrPC. Look up a section in
        either direction to find its equivalent and what changed.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(draft);
        }}
        className="mt-6 flex flex-wrap gap-2 rounded-xl border border-stone-200 bg-white p-4"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 420, IPC 302, CrPC 439, BNS 318(4)"
          aria-label="Section"
          className={`${inputClass} min-w-0 flex-1`}
        />
        <select
          value={code}
          onChange={(e) => go(draft, e.target.value as SectionCode | '')}
          aria-label="Code"
          className={`${inputClass} w-auto`}
        >
          {CODES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <button type="submit" className={primaryButton} disabled={!draft.trim()}>
          <Icon name="search" size={15} /> Look up
        </button>
        <div className="flex w-full flex-wrap items-center gap-1.5 pt-1 text-xs text-stone-500">
          Try:
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              onClick={() => go(ex, '')}
              className="rounded-full border border-stone-200 px-2 py-0.5 text-stone-600 hover:border-maroon-300 hover:text-maroon-700"
            >
              {ex}
            </button>
          ))}
        </div>
      </form>

      {isFetching && <p className="mt-6 text-sm text-stone-500">Looking up…</p>}
      {error && (
        <p className="mt-6 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
          {(error as Error).message}
        </p>
      )}
      {data && !isFetching && <Result mapping={data} />}

      {data && (
        <p className="mt-10 border-t border-stone-200 pt-4 text-xs leading-relaxed text-stone-500">
          Source: {data.source.title} (
          {data.source.urls.map((u, i) => (
            <span key={u}>
              {i > 0 && ', '}
              <a href={u} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-maroon-700">
                {u.includes('BNSS') ? 'BNSS–CrPC table' : 'BNS–IPC table'}
              </a>
            </span>
          ))}
          ). A research aid: check the bare text of the BNS / BNSS before relying on a section in a filing.
        </p>
      )}
    </div>
  );
}

function Result({ mapping }: { mapping: SectionMapping }) {
  const asked = `${mapping.code} ${mapping.section}`;
  if (!mapping.rows.length) {
    return (
      <div className="mt-6 rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="font-serif text-lg font-semibold text-stone-900">{asked}</h2>
        <p className="mt-2 text-sm text-stone-600">
          {isNewCode(mapping.code)
            ? `There is no section ${mapping.section} in the ${mapping.code} table.`
            : `The official table has no ${mapping.to} section corresponding to ${asked}. It may not have been carried into the ${mapping.to} — for example, sedition (s. 124A IPC) has no counterpart, and s. 377 IPC was not retained — or the table may not list it. Check the bare text of the ${mapping.to}.`}
        </p>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-3">
      <p className="text-xs text-stone-500">
        {asked} → {mapping.rows.length === 1 ? 'one entry' : `${mapping.rows.length} entries`} in the {mapping.to}{' '}
        {isNewCode(mapping.code) ? 'it replaced' : 'that replaces it'}
      </p>
      {mapping.rows.map((row) => {
        const others = equivalentsOf(mapping, row);
        const change = CHANGE_LABEL[row.change];
        const oldCode = isNewCode(mapping.code) ? mapping.to : mapping.code;
        const searchable = isNewCode(mapping.code) ? row.oldSections : mapping.section ? [mapping.section] : [];
        return (
          <article key={row.new + row.old} className="rounded-xl border border-stone-200 bg-white p-5">
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 className="font-serif text-lg font-semibold text-stone-900">
                {isNewCode(mapping.code) ? (
                  <>
                    {mapping.code} {row.new} <span className="text-stone-400">→</span>{' '}
                    {others.length ? `${mapping.to} ${others.join(', ')}` : 'new provision'}
                  </>
                ) : (
                  <>
                    {mapping.code} {row.old || mapping.section} <span className="text-stone-400">→</span> {mapping.to}{' '}
                    {row.new}
                  </>
                )}
              </h2>
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${change.className}`}>{change.label}</span>
            </div>
            <p className="mt-1 text-sm font-medium text-stone-700">{row.subject}</p>
            <p className="mt-2 text-sm leading-relaxed text-stone-600">
              <span className="text-xs font-medium uppercase tracking-wide text-stone-400">What changed: </span>
              {row.summary || '—'}
            </p>
            {searchable.length > 0 && (
              <Link
                to={`/?q=${encodeURIComponent(`section ${searchable[0]} ${oldCode}`)}`}
                className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-maroon-700 hover:underline"
              >
                <Icon name="search" size={12} /> Find judgments on s. {searchable[0]} {oldCode}
              </Link>
            )}
          </article>
        );
      })}
    </div>
  );
}
