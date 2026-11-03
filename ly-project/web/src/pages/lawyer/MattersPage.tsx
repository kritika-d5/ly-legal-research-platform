import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { MATTER_STAGES, listMatters, saveMatterDetails, type Matter, type MatterDetails } from '../../api/lawyer';
import { createFolder, workspaceKeys } from '../../api/workspace';
import DeskNav from '../../components/DeskNav';
import { Field, inputClass, primaryButton, secondaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';

const MATTERS_KEY = ['me', 'lawyer-matters'];

/**
 * Client matters: each is one of the lawyer's folders with client, court and
 * hearing details. Upcoming hearings are listed first.
 */
export default function MattersPage() {
  useDocumentTitle('Matters');
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({ queryKey: MATTERS_KEY, queryFn: listMatters });
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => createFolder(name.trim()),
    onSuccess: (f) => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      setName('');
      setCreating(false);
      setEditing(f.id); // straight into the details form
    },
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <DeskNav desk="lawyer" />
      <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-serif text-2xl font-semibold tracking-tight text-maroon-800">Matters</h1>
          <p className="mt-1 max-w-2xl text-sm text-stone-600">
            Each matter is a folder of saved judgments with the client and hearing details. Add
            judgments to a matter from any case page with the Save button.
          </p>
        </div>
        {!creating && (
          <button onClick={() => setCreating(true)} className={primaryButton}>
            <Icon name="plus" size={15} /> New matter
          </button>
        )}
      </div>

      {creating && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) create.mutate();
          }}
          className="mt-4 flex flex-col gap-2 rounded-xl border border-stone-200 bg-white p-4 sm:flex-row"
        >
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            placeholder="Matter name, e.g. State v. Sharma"
            aria-label="Matter name"
            className={inputClass}
          />
          <div className="flex gap-2">
            <button type="submit" disabled={!name.trim() || create.isPending} className={primaryButton}>Create</button>
            <button type="button" onClick={() => setCreating(false)} className={secondaryButton}>Cancel</button>
          </div>
          {create.error && <p className="text-xs text-vermilion-700">{(create.error as Error).message}</p>}
        </form>
      )}

      <div className="mt-6 space-y-3">
        {isLoading && <p className="text-sm text-stone-500">Loading…</p>}
        {error && <p className="text-sm text-vermilion-700">{(error as Error).message}</p>}
        {data && data.matters.length === 0 && (
          <p className="rounded-lg border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
            No matters yet. Create one, then save judgments into it.
          </p>
        )}
        {data?.matters.map((m) =>
          editing === m.id ? (
            <MatterForm key={m.id} matter={m} onDone={() => setEditing(null)} />
          ) : (
            <MatterCard key={m.id} matter={m} onEdit={() => setEditing(m.id)} />
          ),
        )}
      </div>
    </div>
  );
}

/** Today's date where the user is (YYYY-MM-DD). Not the server's: it runs in
 *  UTC, which in India is still "yesterday" until 5:30 in the morning. */
function localToday() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hearingLabel(date: string) {
  const days = Math.round((Date.parse(date) - Date.parse(localToday())) / 86_400_000);
  const pretty = new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  if (days === 0) return { text: `Today · ${pretty}`, tone: 'bg-vermilion-50 text-vermilion-700 border-vermilion-200' };
  if (days > 0 && days <= 7) return { text: `In ${days} day${days === 1 ? '' : 's'} · ${pretty}`, tone: 'bg-gold-50 text-gold-700 border-gold-200' };
  if (days > 0) return { text: pretty, tone: 'bg-navy-50 text-navy-600 border-navy-200' };
  return { text: `Past · ${pretty}`, tone: 'bg-stone-100 text-stone-500 border-stone-200' };
}

function MatterCard({ matter: m, onEdit }: { matter: Matter; onEdit: () => void }) {
  const d = m.matter ?? {};
  const hearing = d.nextHearing ? hearingLabel(d.nextHearing) : null;
  const facts = [
    ['Client', d.client],
    ['Court', d.court],
    ['Case no.', d.caseNumber],
    ['Stage', d.stage],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
            <Icon name="folder" size={16} className="text-gold-600" /> {m.name}
          </h2>
          {facts.length > 0 ? (
            <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {facts.map(([k, v]) => (
                <div key={k} className="flex gap-2">
                  <dt className="text-stone-500">{k}:</dt>
                  <dd className="text-stone-800">{v}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-1 text-sm text-stone-500">No matter details yet.</p>
          )}
          {d.issue && <p className="mt-2 text-sm italic text-stone-600">Issue: {d.issue}</p>}
        </div>
        {hearing && (
          <span className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium ${hearing.tone}`}>
            <Icon name="calendar" size={12} /> Next hearing: {hearing.text}
          </span>
        )}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-stone-100 pt-3 text-sm">
        <span className="text-stone-600">
          {m.count} authorit{m.count === 1 ? 'y' : 'ies'}
          {m.flagged > 0 && (
            <span className="ml-2 inline-flex items-center gap-1 font-medium text-vermilion-700">
              <Icon name="alert" size={12} /> {m.flagged} disagreed with later
            </span>
          )}
        </span>
        <span className="flex-1" />
        <button onClick={onEdit} className="flex items-center gap-1 text-stone-600 hover:text-maroon-700">
          <Icon name="pencil" size={13} /> Details
        </button>
        <Link to={`/saved?folder=${m.id}`} className="flex items-center gap-1 text-stone-600 hover:text-maroon-700">
          <Icon name="bookmark" size={13} /> Authorities
        </Link>
        <Link to={`/lawyer/brief?matter=${m.id}`} className="flex items-center gap-1 font-medium text-maroon-700 hover:underline">
          <Icon name="gavel" size={13} /> Build argument
        </Link>
      </div>
    </article>
  );
}

function MatterForm({ matter, onDone }: { matter: Matter; onDone: () => void }) {
  const queryClient = useQueryClient();
  const [d, setD] = useState<MatterDetails>(matter.matter ?? {});
  const set = (k: keyof MatterDetails) => (e: { target: { value: string } }) => setD({ ...d, [k]: e.target.value });
  const save = useMutation({
    mutationFn: () => saveMatterDetails(matter.id, d),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-xl border border-maroon-200 bg-white p-5 ring-1 ring-maroon-100">
      <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
        <Icon name="folder" size={16} className="text-gold-600" /> {matter.name}
      </h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Client" htmlFor={`client-${matter.id}`} optional>
          <input id={`client-${matter.id}`} value={d.client ?? ''} onChange={set('client')} maxLength={120} className={inputClass} />
        </Field>
        <Field label="Court" htmlFor={`court-${matter.id}`} optional>
          <input id={`court-${matter.id}`} value={d.court ?? ''} onChange={set('court')} maxLength={120} placeholder="e.g. Sessions Court, Mumbai" className={inputClass} />
        </Field>
        <Field label="Case number" htmlFor={`case-${matter.id}`} optional>
          <input id={`case-${matter.id}`} value={d.caseNumber ?? ''} onChange={set('caseNumber')} maxLength={80} placeholder="e.g. ABA 1234/2026" className={inputClass} />
        </Field>
        <Field label="Stage" htmlFor={`stage-${matter.id}`} optional>
          <select id={`stage-${matter.id}`} value={d.stage ?? ''} onChange={set('stage')} className={inputClass}>
            <option value="">—</option>
            {MATTER_STAGES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <Field label="Next hearing" htmlFor={`hearing-${matter.id}`} optional>
          <input id={`hearing-${matter.id}`} type="date" value={d.nextHearing ?? ''} onChange={set('nextHearing')} className={inputClass} />
        </Field>
      </div>
      <Field label="Issue" htmlFor={`issue-${matter.id}`} optional hint="The legal question the matter turns on. The argument builder uses it to find the most relevant paragraphs.">
        <textarea
          id={`issue-${matter.id}`}
          value={d.issue ?? ''}
          onChange={set('issue')}
          rows={2}
          maxLength={500}
          placeholder="e.g. whether anticipatory bail can be granted without a time limit"
          className={`${inputClass} resize-y`}
        />
      </Field>
      {save.error && <p className="text-sm text-vermilion-700">{(save.error as Error).message}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={save.isPending} className={primaryButton}>{save.isPending ? 'Saving…' : 'Save details'}</button>
        <button type="button" onClick={onDone} className={secondaryButton}>Cancel</button>
      </div>
      <p className="text-xs text-stone-500">Private to your account, like your saved judgments.</p>
    </form>
  );
}
