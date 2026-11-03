/**
 * Choose a judgment by typing part of its name or topic. Uses the ordinary
 * corpus search, so "sibbia", "anticipatory bail" and "default bail" all work.
 */
import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCase, searchCases } from '../api';
import { shortCaseTitle } from '../useDocumentTitle';
import { useDismiss } from '../useDismiss';
import { TierBadge } from './Badges';
import { inputClass } from './Form';
import Icon from './Icon';

export default function CasePicker({
  label,
  tid,
  onChange,
  exclude,
}: {
  label: string;
  tid: number | null;
  onChange: (tid: number | null) => void;
  /** A tid that may not be chosen (the other side of a comparison). */
  exclude?: number | null;
}) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));

  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 300);
    return () => clearTimeout(t);
  }, [text]);

  const { data: chosen } = useQuery({ queryKey: ['case', tid], queryFn: () => getCase(tid!), enabled: tid !== null });
  const { data: results, isFetching } = useQuery({
    queryKey: ['search', q, 'picker'],
    queryFn: () => searchCases({ q }),
    enabled: q.length >= 3,
    staleTime: 5 * 60 * 1000,
  });

  if (tid !== null) {
    return (
      <div>
        <p className="mb-1 text-xs font-medium text-stone-700">{label}</p>
        <div className="flex items-start justify-between gap-3 rounded-lg border border-stone-300 bg-white p-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-stone-900">{chosen ? shortCaseTitle(chosen.title) : `Judgment ${tid}`}</p>
            {chosen && (
              <div className="mt-1 flex items-center gap-2 text-xs text-stone-500">
                <TierBadge tier={chosen.courtTier} />
                <span>{chosen.publishdate ?? chosen.year ?? 'undated'}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => onChange(null)}
            aria-label={`Change ${label}`}
            className="shrink-0 rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700"
          >
            <Icon name="close" size={14} />
          </button>
        </div>
      </div>
    );
  }

  const options = (results?.results ?? []).filter((r) => r.tid !== exclude).slice(0, 8);

  return (
    <div ref={ref} className="relative">
      <label className="mb-1 block text-xs font-medium text-stone-700">
        {label}
        <div className="relative mt-1">
          <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
          <input
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            placeholder="Type a case name or topic, e.g. Sibbia"
            className={`${inputClass} pl-8 font-normal`}
          />
        </div>
      </label>
      {open && q.length >= 3 && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white py-1 shadow-lg">
          {isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-stone-500">Searching…</li>}
          {!isFetching && options.length === 0 && <li className="px-3 py-2 text-sm text-stone-500">No judgments found.</li>}
          {options.map((r) => (
            <li key={r.tid}>
              <button
                type="button"
                onClick={() => {
                  onChange(r.tid);
                  setText('');
                  setOpen(false);
                }}
                className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left hover:bg-stone-50"
              >
                <span className="text-sm text-stone-800">{shortCaseTitle(r.title)}</span>
                <span className="flex shrink-0 items-center gap-1.5 text-xs text-stone-500">
                  {r.year || ''} <TierBadge tier={r.courtTier} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
