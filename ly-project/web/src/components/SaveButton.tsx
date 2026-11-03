/**
 * Save a judgment to your research, and file it / annotate it in place.
 *
 * One click saves (so the common case is one click); the popover that opens
 * then offers folders and a private note, which most saves never need.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  createFolder,
  getSaved,
  getSavedIds,
  listFolders,
  saveCase,
  unsaveCase,
  workspaceKeys,
} from '../api/workspace';
import { useAuth } from '../auth';
import { useDismiss } from '../useDismiss';
import { inputClass } from './Form';
import Icon from './Icon';

/** Which judgments the user has saved — shared by every SaveButton on a page. */
export function useSavedIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: workspaceKeys.savedIds,
    queryFn: getSavedIds,
    enabled: !!user,
    staleTime: 60_000,
    select: (tids) => new Set(tids),
  });
}

export default function SaveButton({ tid, compact = false }: { tid: number; compact?: boolean }) {
  const { user } = useAuth();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { data: savedIds } = useSavedIds();
  const saved = savedIds?.has(tid) ?? false;
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, useCallback(() => setOpen(false), []));

  const save = useMutation({
    mutationFn: () => saveCase(tid),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      setOpen(true);
    },
  });

  const base = compact
    ? 'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors'
    : 'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors';
  const tone = saved
    ? compact
      ? 'text-maroon-700 hover:bg-maroon-50'
      : 'border-maroon-200 bg-maroon-50 text-maroon-800 hover:bg-maroon-100'
    : compact
      ? 'text-stone-400 hover:bg-stone-100 hover:text-maroon-700'
      : 'border-stone-300 bg-white text-stone-700 hover:border-stone-400';
  const label = saved ? 'Saved' : 'Save';

  // Logged out: the button is a way into signing in, then straight back here.
  if (!user) {
    return (
      <Link
        to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`}
        title="Log in to save judgments"
        aria-label="Log in to save this judgment"
        className={`${base} ${tone}`}
      >
        <Icon name="bookmark" size={compact ? 16 : 14} />
        {!compact && 'Save'}
      </Link>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => (saved ? setOpen((o) => !o) : save.mutate())}
        disabled={save.isPending}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={saved ? 'Saved — edit folders and note' : 'Save this judgment'}
        title={saved ? 'Saved — click to file or add a note' : 'Save to your research'}
        className={`${base} ${tone} disabled:opacity-50`}
      >
        <Icon name={saved ? 'bookmarkFilled' : 'bookmark'} size={compact ? 16 : 14} />
        {!compact && label}
      </button>
      {open && saved && <SavePanel tid={tid} onClose={() => setOpen(false)} />}
      {save.error && (
        <p className="absolute right-0 mt-1 w-56 rounded border border-vermilion-200 bg-vermilion-50 p-2 text-xs text-vermilion-700">
          {(save.error as Error).message}
        </p>
      )}
    </div>
  );
}

function SavePanel({ tid, onClose }: { tid: number; onClose: () => void }) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all });

  const { data: item } = useQuery({ queryKey: workspaceKeys.saved(tid), queryFn: () => getSaved(tid) });
  const { data: folderList } = useQuery({ queryKey: workspaceKeys.folders, queryFn: listFolders });

  // null = untouched, show what is stored. Kept separate so a folder toggle
  // (which refetches the item) never wipes a note being typed.
  const [draft, setDraft] = useState<string | null>(null);
  const note = draft ?? item?.note ?? '';
  const [noteSaved, setNoteSaved] = useState(false);

  const update = useMutation({
    mutationFn: (patch: { note?: string; folderIds?: string[] }) => saveCase(tid, patch),
    onSuccess: (updated) => {
      queryClient.setQueryData(workspaceKeys.saved(tid), updated);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => unsaveCase(tid),
    onSuccess: () => {
      refresh();
      onClose();
    },
  });

  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const addFolder = useMutation({
    mutationFn: (name: string) => createFolder(name),
    onSuccess: (folder) => {
      // File this judgment in the folder that was just made for it.
      update.mutate({ folderIds: [...(item?.folderIds ?? []), folder.id] });
      setNewName('');
      setCreating(false);
    },
  });

  const inFolder = new Set(item?.folderIds ?? []);
  const toggle = (id: string) => {
    const next = new Set(inFolder);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    update.mutate({ folderIds: [...next] });
  };

  const onNewFolder = (e: FormEvent) => {
    e.preventDefault();
    if (newName.trim()) addFolder.mutate(newName.trim());
  };

  const error = update.error ?? addFolder.error ?? remove.error;

  return (
    <div
      role="dialog"
      aria-label="Saved judgment"
      className="absolute right-0 z-40 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-lg border border-stone-200 bg-white p-4 text-left shadow-lg"
    >
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-medium text-stone-900">
          <Icon name="check" size={14} className="text-sage-600" /> Saved to your research
        </p>
        <button onClick={onClose} aria-label="Close" className="rounded p-1 text-stone-400 hover:bg-stone-100 hover:text-stone-700">
          <Icon name="close" size={14} />
        </button>
      </div>

      <p className="mt-3 text-[11px] font-medium uppercase tracking-wide text-stone-400">Folders</p>
      <ul className="mt-1.5 max-h-40 space-y-0.5 overflow-y-auto">
        {folderList?.folders.map((f) => (
          <li key={f.id}>
            <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-sm text-stone-700 hover:bg-stone-50">
              <input
                type="checkbox"
                checked={inFolder.has(f.id)}
                onChange={() => toggle(f.id)}
                disabled={!item || update.isPending}
                className="h-3.5 w-3.5 accent-maroon-700"
              />
              <span className="truncate">{f.name}</span>
            </label>
          </li>
        ))}
        {folderList && folderList.folders.length === 0 && !creating && (
          <li className="px-1.5 text-xs text-stone-500">No folders yet. Folders group judgments, e.g. by client or topic.</li>
        )}
      </ul>
      {creating ? (
        <form onSubmit={onNewFolder} className="mt-1.5 flex gap-1.5">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Folder name"
            maxLength={60}
            aria-label="New folder name"
            className={`${inputClass} py-1.5`}
          />
          <button type="submit" disabled={!newName.trim() || addFolder.isPending} className="rounded-md bg-maroon-800 px-2.5 text-xs font-medium text-white hover:bg-maroon-700 disabled:opacity-50">
            Add
          </button>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className="mt-1 flex items-center gap-1 px-1.5 text-xs font-medium text-maroon-700 hover:underline">
          <Icon name="plus" size={12} /> New folder
        </button>
      )}

      <label htmlFor={`note-${tid}`} className="mt-4 block text-[11px] font-medium uppercase tracking-wide text-stone-400">
        Private note
      </label>
      <textarea
        id={`note-${tid}`}
        value={note}
        onChange={(e) => {
          setDraft(e.target.value);
          setNoteSaved(false);
        }}
        rows={3}
        maxLength={5000}
        placeholder="Why this judgment matters, key paragraphs…"
        className={`${inputClass} mt-1.5 resize-y text-[13px]`}
      />
      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => update.mutate({ note }, { onSuccess: () => setNoteSaved(true) })}
          disabled={!item || note === item.note || update.isPending}
          className="rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-700 hover:border-stone-400 disabled:opacity-40"
        >
          {noteSaved && note === item?.note ? 'Note saved' : 'Save note'}
        </button>
        <button
          onClick={() => remove.mutate()}
          disabled={remove.isPending}
          className="flex items-center gap-1 text-xs text-stone-500 hover:text-vermilion-700"
        >
          <Icon name="trash" size={12} /> Remove
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-vermilion-700">{(error as Error).message}</p>}
      <Link to="/saved" className="mt-3 block border-t border-stone-100 pt-2 text-xs text-stone-500 hover:text-maroon-700">
        View all saved judgments →
      </Link>
    </div>
  );
}
