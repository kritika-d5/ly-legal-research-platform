import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createFolder,
  deleteFolder,
  listFolders,
  listSaved,
  updateFolder,
  workspaceKeys,
  type Folder,
  type SavedCase,
} from '../api/workspace';
import { TierBadge } from '../components/Badges';
import { inputClass, primaryButton, secondaryButton } from '../components/Form';
import Icon from '../components/Icon';
import SaveButton from '../components/SaveButton';
import { shortCaseTitle, useDocumentTitle } from '../useDocumentTitle';

/**
 * Saved judgments, grouped by folder. The selected folder and the search text
 * live in the URL (?folder=…&q=…) so a filtered view can be bookmarked and the
 * Back button behaves.
 */
export default function SavedPage() {
  useDocumentTitle('Saved judgments');
  const [params, setParams] = useSearchParams();
  const folder = params.get('folder') ?? 'all';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);

  // Debounce typing into the URL, so each keystroke is not a request.
  useEffect(() => {
    const t = setTimeout(() => {
      if (search === q) return;
      const next = new URLSearchParams(params);
      if (search) next.set('q', search);
      else next.delete('q');
      setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [search, q, params, setParams]);

  const selectFolder = (id: string) => {
    const next = new URLSearchParams(params);
    if (id === 'all') next.delete('folder');
    else next.set('folder', id);
    setParams(next);
  };

  const { data: folderList } = useQuery({ queryKey: workspaceKeys.folders, queryFn: listFolders });
  const { data: items, isLoading, error } = useQuery({
    queryKey: workspaceKeys.savedList(folder, q),
    queryFn: () => listSaved(folder, q || undefined),
  });

  const folders = folderList?.folders ?? [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const current = byId.get(folder);
  // A deleted folder left in the URL: fall back to "All saved".
  useEffect(() => {
    if (folderList && folder !== 'all' && folder !== 'unfiled' && !current) selectFolder('all');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderList, folder, current]);

  const heading = folder === 'all' ? 'All saved' : folder === 'unfiled' ? 'Not in a folder' : current?.name ?? '';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-maroon-800">Saved judgments</h1>
          <p className="mt-1 text-sm text-stone-600">
            Your research, private to you. Group judgments into folders and keep notes on each.
          </p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[230px_1fr]">
        <FolderSidebar
          folders={folders}
          total={folderList?.total ?? 0}
          unfiled={folderList?.unfiled ?? 0}
          selected={folder}
          onSelect={selectFolder}
        />

        <section className="min-w-0">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
              {folder !== 'all' && folder !== 'unfiled' && <Icon name="folder" size={16} className="text-gold-600" />}
              {heading}
            </h2>
            <div className="relative sm:w-64">
              <Icon name="search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search titles and notes"
                aria-label="Search saved judgments"
                className={`${inputClass} pl-8`}
              />
            </div>
          </div>
          {/* Keyed so switching or renaming a folder starts the header fresh. */}
          {current && (
            <FolderHeader
              key={`${current.id}:${current.name}:${current.description ?? ''}`}
              folder={current}
              onDeleted={() => selectFolder('all')}
            />
          )}

          <div className="mt-4 space-y-3">
            {isLoading && <p className="text-sm text-stone-500">Loading…</p>}
            {error && <p className="text-sm text-vermilion-700">{(error as Error).message}</p>}
            {items && items.length === 0 && <EmptyState folder={folder} searching={!!q} />}
            {items?.map((item) => <SavedRow key={item.tid} item={item} folders={byId} />)}
          </div>
        </section>
      </div>
    </div>
  );
}

function FolderSidebar({
  folders,
  total,
  unfiled,
  selected,
  onSelect,
}: {
  folders: Folder[];
  total: number;
  unfiled: number;
  selected: string;
  onSelect: (id: string) => void;
}) {
  const queryClient = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const create = useMutation({
    mutationFn: () => createFolder(name.trim()),
    onSuccess: (f) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      setName('');
      setCreating(false);
      onSelect(f.id);
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (name.trim()) create.mutate();
  };

  const item = (id: string, label: string, count: number, icon: 'bookmark' | 'folder' | 'document') => {
    const active = selected === id;
    return (
      <li key={id} className="shrink-0">
        <button
          onClick={() => onSelect(id)}
          aria-current={active ? 'page' : undefined}
          className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors ${
            active ? 'bg-maroon-50 font-medium text-maroon-800' : 'text-stone-700 hover:bg-stone-100'
          }`}
        >
          <Icon name={icon} size={14} className={active ? 'text-maroon-700' : icon === 'folder' ? 'text-gold-600' : 'text-stone-400'} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          <span className="text-xs text-stone-400">{count}</span>
        </button>
      </li>
    );
  };

  return (
    <nav aria-label="Folders" className="lg:sticky lg:top-6 lg:self-start">
      <ul className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
        {item('all', 'All saved', total, 'bookmark')}
        {item('unfiled', 'Not in a folder', unfiled, 'document')}
      </ul>
      <p className="mb-1 mt-4 hidden px-2.5 text-[11px] font-medium uppercase tracking-wide text-stone-400 lg:block">Folders</p>
      <ul className="mt-1 flex gap-1 overflow-x-auto pb-1 lg:mt-0 lg:flex-col lg:overflow-visible lg:pb-0">
        {folders.map((f) => item(f.id, f.name, f.count, 'folder'))}
      </ul>
      {creating ? (
        <form onSubmit={submit} className="mt-2 space-y-1.5 px-1">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setCreating(false)}
            placeholder="e.g. Sharma bail matter"
            maxLength={60}
            aria-label="New folder name"
            className={`${inputClass} py-1.5`}
          />
          {create.error && <p className="text-xs text-vermilion-700">{(create.error as Error).message}</p>}
          <div className="flex gap-1.5">
            <button type="submit" disabled={!name.trim() || create.isPending} className={`${primaryButton} py-1.5 text-xs`}>
              Create
            </button>
            <button type="button" onClick={() => setCreating(false)} className={`${secondaryButton} py-1 text-xs`}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button onClick={() => setCreating(true)} className="mt-2 flex items-center gap-1.5 px-2.5 text-sm font-medium text-maroon-700 hover:underline">
          <Icon name="plus" size={14} /> New folder
        </button>
      )}
    </nav>
  );
}

/** Rename, describe or delete the selected folder. */
function FolderHeader({ folder, onDeleted }: { folder: Folder; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [description, setDescription] = useState(folder.description ?? '');
  const refresh = () => queryClient.invalidateQueries({ queryKey: workspaceKeys.all });

  const save = useMutation({
    mutationFn: () => updateFolder(folder.id, { name: name.trim(), description: description.trim() }),
    onSuccess: () => {
      refresh();
      setEditing(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteFolder(folder.id),
    onSuccess: () => {
      refresh();
      onDeleted();
    },
  });

  if (editing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) save.mutate();
        }}
        className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-white p-3"
      >
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Folder name" className={inputClass} />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={300}
          placeholder="Description (optional), e.g. client, court, hearing date"
          aria-label="Folder description"
          className={inputClass}
        />
        {save.error && <p className="text-xs text-vermilion-700">{(save.error as Error).message}</p>}
        <div className="flex gap-2">
          <button type="submit" disabled={save.isPending || !name.trim()} className={`${primaryButton} py-1.5 text-xs`}>
            Save
          </button>
          <button type="button" onClick={() => setEditing(false)} className={`${secondaryButton} py-1 text-xs`}>
            Cancel
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-stone-500">{folder.description || `${folder.count} judgment${folder.count === 1 ? '' : 's'}`}</p>
      <div className="flex gap-3 text-xs">
        <button onClick={() => setEditing(true)} className="flex items-center gap-1 text-stone-500 hover:text-maroon-700">
          <Icon name="pencil" size={12} /> Rename
        </button>
        <button
          onClick={() => {
            if (window.confirm(`Delete the folder “${folder.name}”? The judgments in it stay saved.`)) remove.mutate();
          }}
          className="flex items-center gap-1 text-stone-500 hover:text-vermilion-700"
        >
          <Icon name="trash" size={12} /> Delete folder
        </button>
      </div>
    </div>
  );
}

function SavedRow({ item, folders }: { item: SavedCase; folders: Map<string, Folder> }) {
  const inFolders = item.folderIds.map((id) => folders.get(id)).filter(Boolean) as Folder[];
  return (
    <article className="rounded-lg border border-stone-200 bg-white p-4 transition-colors hover:border-terracotta-300">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/case/${item.tid}`} className="font-medium text-stone-900 underline-offset-4 hover:underline">
            {shortCaseTitle(item.title)}
          </Link>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <TierBadge tier={item.courtTier} />
            <span className="flex items-center gap-1">
              <Icon name="calendar" size={12} className="text-stone-400" />
              {item.year ?? 'undated'}
            </span>
            <span>Saved {new Date(item.savedAt).toLocaleDateString()}</span>
          </div>
        </div>
        {/* The same control as on the case page: file it, edit the note, or remove. */}
        <SaveButton tid={item.tid} compact />
      </div>

      {item.treatment && item.treatment.neg + item.treatment.mixed > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-vermilion-700">
          <Icon name="alert" size={12} />
          Precedent check: {item.treatment.neg + item.treatment.mixed} later judgment
          {item.treatment.neg + item.treatment.mixed === 1 ? '' : 's'} disagreed with this.
          <Link to={`/case/${item.tid}`} className="underline underline-offset-2">See which</Link>
        </p>
      )}
      {inFolders.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {inFolders.map((f) => (
            <span key={f.id} className="inline-flex items-center gap-1 rounded border border-gold-200 bg-gold-50 px-1.5 py-0.5 text-[11px] text-gold-700">
              <Icon name="folder" size={11} /> {f.name}
            </span>
          ))}
        </div>
      )}
      {item.note && (
        <p className="mt-2.5 whitespace-pre-line border-l-2 border-gold-200 pl-3 text-sm text-stone-700">{item.note}</p>
      )}
    </article>
  );
}

function EmptyState({ folder, searching }: { folder: string; searching: boolean }) {
  const text = searching
    ? 'No saved judgments match that search.'
    : folder === 'all'
      ? 'Nothing saved yet. Use the Save button on any judgment or search result.'
      : folder === 'unfiled'
        ? 'Every saved judgment is in a folder.'
        : 'This folder is empty. Open a saved judgment’s bookmark to file it here.';
  return (
    <div className="rounded-lg border border-dashed border-stone-300 p-10 text-center">
      <Icon name="bookmark" size={22} className="mx-auto text-stone-300" />
      <p className="mt-2 text-sm text-stone-500">{text}</p>
      {folder === 'all' && !searching && (
        <Link to="/" className="mt-3 inline-block text-sm font-medium text-maroon-700 hover:underline">
          Search judgments →
        </Link>
      )}
    </div>
  );
}
