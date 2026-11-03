import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getMemo, POLARITY_INFO, type MemoAuthority, type MemoData } from '../../api/judge';
import { listFolders, workspaceKeys } from '../../api/workspace';
import { inputClass, primaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import DeskNav from '../../components/DeskNav';
import { shortCaseTitle, useDocumentTitle } from '../../useDocumentTitle';

/** The memo's own text fields are a per-browser draft; the authorities always
 *  come live from the folder. Storage can be unavailable (private windows). */
function useDraft(folderId: string | null) {
  const key = folderId ? `memo-draft:${folderId}` : null;
  const read = (k: string | null): { title: string; issue: string } | null => {
    try {
      return k ? JSON.parse(localStorage.getItem(k) ?? 'null') : null;
    } catch {
      return null;
    }
  };
  // Remember which folder the draft belongs to; switching folders reads that
  // folder's draft during render rather than resetting state in an effect.
  const [state, setState] = useState(() => ({ key, value: read(key) }));
  const draft = state.key === key ? state.value : read(key);
  const save = (d: { title: string; issue: string }) => {
    setState({ key, value: d });
    try {
      if (key) localStorage.setItem(key, JSON.stringify(d));
    } catch {
      /* not persisted; the memo still works */
    }
  };
  return [draft, save] as const;
}

/**
 * A research memorandum built from one of the user's folders: the question,
 * then each authority with its citation, how later judgments treated it, and
 * the user's own note. Printed (or saved as PDF) from the browser.
 *
 * Nothing here is written by a model — it is the judge's own research, laid
 * out. That is deliberate for a document a judge might keep on file.
 */
export default function MemoPage() {
  useDocumentTitle('Research memo');
  const [params, setParams] = useSearchParams();
  const folderId = params.get('folder');

  const { data: folderList } = useQuery({ queryKey: workspaceKeys.folders, queryFn: listFolders });
  const { data: memo, isLoading, error } = useQuery({
    queryKey: ['judge', 'memo', folderId],
    queryFn: () => getMemo(folderId!),
    enabled: !!folderId,
  });
  const [draft, setDraft] = useDraft(folderId);
  const title = draft?.title ?? memo?.folder.name ?? '';
  const issue = draft?.issue ?? memo?.folder.description ?? '';

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:p-0">
      <DeskNav desk="judge" />
      <div className="print:hidden">
        <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-maroon-800">Research memo</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Turn a folder of saved judgments and your notes into a memorandum you can print or save as
          PDF. Add judgments to a folder from any case page with the Save button.
        </p>

        <div className="mt-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-5 md:grid-cols-2">
          <label className="text-xs font-medium text-stone-700">
            Folder
            <select
              value={folderId ?? ''}
              onChange={(e) => setParams(e.target.value ? { folder: e.target.value } : {})}
              className={`${inputClass} mt-1 font-normal`}
            >
              <option value="">Choose a folder…</option>
              {folderList?.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name} ({f.count})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-stone-700">
            Memo title
            <input
              value={title}
              onChange={(e) => setDraft({ title: e.target.value, issue })}
              disabled={!memo}
              className={`${inputClass} mt-1 font-normal`}
            />
          </label>
          <label className="text-xs font-medium text-stone-700 md:col-span-2">
            Question considered
            <textarea
              value={issue}
              onChange={(e) => setDraft({ title, issue: e.target.value })}
              disabled={!memo}
              rows={2}
              placeholder="e.g. Whether anticipatory bail may be limited in time"
              className={`${inputClass} mt-1 resize-y font-normal`}
            />
          </label>
          <div className="flex items-center gap-3 md:col-span-2">
            <button onClick={() => window.print()} disabled={!memo || memo.authorities.length === 0} className={primaryButton}>
              <Icon name="document" size={15} /> Print or save as PDF
            </button>
            {folderList && folderList.folders.length === 0 && (
              <p className="text-xs text-stone-500">
                You have no folders yet. <Link to="/saved" className="text-maroon-700 hover:underline">Create one</Link> and save judgments into it.
              </p>
            )}
          </div>
        </div>
        {isLoading && <p className="mt-6 text-sm text-stone-500">Loading…</p>}
        {error && <p className="mt-6 text-sm text-vermilion-700">{(error as Error).message}</p>}
      </div>

      {memo && <MemoDocument memo={memo} title={title} issue={issue} />}
    </div>
  );
}

function MemoDocument({ memo, title, issue }: { memo: MemoData; title: string; issue: string }) {
  // Fixed when the memo opens, so it does not change between re-renders.
  const [today] = useState(() => new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }));

  return (
    <article className="mt-8 rounded-xl border border-stone-200 bg-white p-8 font-serif text-stone-900 shadow-sm sm:p-12 print:mt-0 print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="border-b-2 border-stone-900 pb-4 text-center">
        <p className="text-xs uppercase tracking-[0.2em] text-stone-600">Research memorandum</p>
        <h2 className="mt-2 text-2xl font-semibold">{title || memo.folder.name}</h2>
        <p className="mt-2 font-sans text-xs text-stone-600">
          Prepared by {memo.preparedBy} · {today}
        </p>
      </header>

      {issue && (
        <section className="mt-6">
          <h3 className="text-sm font-semibold uppercase tracking-wide">Question considered</h3>
          <p className="mt-1.5 whitespace-pre-line leading-relaxed">{issue}</p>
        </section>
      )}

      <section className="mt-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide">Authorities ({memo.authorities.length})</h3>
        {memo.authorities.length === 0 ? (
          <p className="mt-2 font-sans text-sm text-stone-500">This folder has no saved judgments yet.</p>
        ) : (
          <ol className="mt-3 space-y-5">
            {memo.authorities.map((a, i) => (
              <Authority key={a.tid} a={a} n={i + 1} />
            ))}
          </ol>
        )}
      </section>

      <footer className="mt-10 border-t border-stone-300 pt-3 font-sans text-[11px] leading-relaxed text-stone-500">
        Compiled from the BailResearch library of 198 bail judgments. Treatment counts cover later
        judgments within that library only, from Indian Kanoon citation data. Notes are the
        author’s own. Verify every authority against the reported judgment.
      </footer>
    </article>
  );
}

function Authority({ a, n }: { a: MemoAuthority; n: number }) {
  const t = a.treatment;
  const cited = t.pos + t.neg + t.mixed + t.neutral + t.unknown;
  const parts = (['pos', 'mixed', 'neg', 'neutral'] as const)
    .filter((p) => t[p])
    .map((p) => `${POLARITY_INFO[p].label.toLowerCase()} ${t[p]}`);

  return (
    <li className="break-inside-avoid">
      <p className="leading-snug">
        <span className="mr-1 font-semibold">{n}.</span>
        <span className="font-semibold italic">{shortCaseTitle(a.title)}</span>
        <span className="text-stone-700">
          {' '}
          ({a.date ?? a.year ?? 'undated'}) · {a.court}
          {a.citation ? ` · ${a.citation}` : ''}
        </span>
      </p>
      <p className="mt-1 font-sans text-xs text-stone-600">
        {cited === 0
          ? 'Not cited by a later judgment in the library.'
          : `Cited by ${cited} later judgment${cited === 1 ? '' : 's'} in the library: ${parts.join(', ')}.`}
        {t.neg + t.mixed > 0 && <span className="font-semibold text-vermilion-700"> Check the disagreeing judgments.</span>}
      </p>
      {a.note ? (
        <p className="mt-1.5 whitespace-pre-line border-l-2 border-stone-300 pl-3 leading-relaxed">{a.note}</p>
      ) : (
        <p className="mt-1.5 font-sans text-xs italic text-stone-400 print:hidden">No note on this judgment yet — add one from its bookmark.</p>
      )}
    </li>
  );
}
