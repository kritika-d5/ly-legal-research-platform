import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { caseSections } from '../api/sections';
import Icon from './Icon';

const SHOWN = 8;

/**
 * The IPC / CrPC sections a judgment refers to, each with its BNS / BNSS
 * equivalent from the official table. CrPC references before 1974 are to the
 * 1898 Code, whose numbers differ; those are listed without a mapping.
 */
export default function SectionsPanel({ tid }: { tid: number }) {
  const [all, setAll] = useState(false);
  const { data } = useQuery({ queryKey: ['case-sections', tid], queryFn: () => caseSections(tid), staleTime: Infinity });
  if (!data || !data.mentions.length) return null;

  const mentions = all ? data.mentions : data.mentions.slice(0, SHOWN);
  const has1898 = data.mentions.some((m) => m.crpc1898);

  return (
    <div>
      <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">
        <Icon name="scale" size={13} />
        Sections → BNS / BNSS
      </h2>
      <ul className="mt-2 space-y-1 text-xs text-stone-600">
        {mentions.map((m) => {
          const rows = m.mapping?.rows ?? [];
          return (
            <li key={`${m.code} ${m.section}`} className="flex justify-between gap-2">
              <Link
                to={`/sections?${new URLSearchParams({ q: m.section, code: m.code })}`}
                className="hover:text-maroon-700 hover:underline"
                title={rows[0]?.subject}
              >
                s. {m.section} {m.code}
              </Link>
              <span className="text-right tabular-nums text-stone-500">
                {m.crpc1898 ? (
                  <span className="italic text-stone-400" title="Before 1974 this meant the CrPC of 1898, whose numbering differs">
                    1898 Code
                  </span>
                ) : rows.length ? (
                  `${m.mapping!.to} ${rows.map((r) => r.new).join(', ')}`
                ) : (
                  <span className="italic text-stone-400">no equivalent listed</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {data.mentions.length > SHOWN && (
        <button onClick={() => setAll(!all)} className="mt-1.5 text-xs text-maroon-700 hover:underline">
          {all ? 'Show fewer' : `Show all ${data.mentions.length}`}
        </button>
      )}
      {has1898 && (
        <p className="mt-2 text-[11px] leading-snug text-stone-400">
          This judgment predates the CrPC of 1973; its CrPC references are to the 1898 Code and are not mapped.
        </p>
      )}
    </div>
  );
}
