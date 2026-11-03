import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authorityName, getBrief, listMatters, type Brief, type BriefAuthority } from '../../api/lawyer';
import { ContentBadge, TierBadge } from '../../components/Badges';
import DeskNav from '../../components/DeskNav';
import { inputClass, primaryButton, secondaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';

/**
 * Bail argument builder. For one matter: every authority with the paragraphs
 * of it most relevant to the matter's issue, the precedent check, and the
 * lawyer's own note. Tick the paragraphs to rely on; the list of authorities
 * is written out ready to paste into an application.
 *
 * Nothing is machine-written. The paragraphs are the judgments' own text,
 * picked by similarity to the issue; the propositions are the lawyer's notes.
 */
export default function BriefPage() {
  useDocumentTitle('Argument builder');
  const [params, setParams] = useSearchParams();
  const matterId = params.get('matter');
  const [issueDraft, setIssueDraft] = useState<string | null>(null);
  const [issue, setIssue] = useState<string | undefined>(undefined);

  const { data: matters } = useQuery({ queryKey: ['me', 'lawyer-matters'], queryFn: listMatters });
  const { data: brief, isLoading, isFetching, error } = useQuery({
    queryKey: ['me', 'lawyer-brief', matterId, issue ?? ''],
    queryFn: () => getBrief(matterId!, issue),
    enabled: !!matterId,
    staleTime: 60_000,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <DeskNav desk="lawyer" />
      <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-maroon-800">Bail argument builder</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Pick a matter. For each authority in it you get the paragraphs most relevant to the issue,
        a precedent check, and your note. Tick what you rely on and copy the list of authorities.
      </p>

      <div className="mt-6 grid gap-4 rounded-xl border border-stone-200 bg-white p-5 md:grid-cols-[1fr_2fr]">
        <label className="text-xs font-medium text-stone-700">
          Matter
          <select
            value={matterId ?? ''}
            onChange={(e) => {
              setIssue(undefined);
              setIssueDraft(null);
              setParams(e.target.value ? { matter: e.target.value } : {});
            }}
            className={`${inputClass} mt-1 font-normal`}
          >
            <option value="">Choose a matter…</option>
            {matters?.matters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.count})
              </option>
            ))}
          </select>
        </label>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setIssue(issueDraft?.trim() || undefined);
          }}
          className="text-xs font-medium text-stone-700"
        >
          <label htmlFor="issue">Issue — paragraphs are ranked against this</label>
          <div className="mt-1 flex gap-2">
            <input
              id="issue"
              value={issueDraft ?? brief?.issue ?? ''}
              onChange={(e) => setIssueDraft(e.target.value)}
              disabled={!brief}
              maxLength={500}
              className={`${inputClass} font-normal`}
            />
            <button type="submit" disabled={!brief || isFetching} className={`${secondaryButton} shrink-0`}>
              {isFetching ? 'Finding…' : 'Update'}
            </button>
          </div>
        </form>
      </div>

      {matters && matters.matters.length === 0 && (
        <p className="mt-4 text-sm text-stone-500">
          No matters yet. <Link to="/lawyer/matters" className="text-maroon-700 hover:underline">Create one</Link> first.
        </p>
      )}
      {isLoading && <p className="mt-6 text-sm text-stone-500">Reading the authorities…</p>}
      {error && <p className="mt-6 text-sm text-vermilion-700">{(error as Error).message}</p>}
      {/* Keyed so a new matter or issue starts with fresh selections. */}
      {brief && <Builder key={`${brief.matter.id}:${brief.issue}`} brief={brief} />}
    </div>
  );
}

function Builder({ brief }: { brief: Brief }) {
  // Everything starts included, with the top two paragraphs of each ticked.
  const [included, setIncluded] = useState(() => new Set(brief.authorities.map((a) => a.tid)));
  const [paras, setParas] = useState(
    () => new Set(brief.authorities.flatMap((a) => a.passages.slice(0, 2).map((p) => p.id))),
  );
  const [withTreatment, setWithTreatment] = useState(true);
  const [copied, setCopied] = useState(false);

  const toggle = <T,>(set: Set<T>, value: T, update: (s: Set<T>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const text = useMemo(() => {
    const m = brief.matter.matter;
    const chosen = brief.authorities.filter((a) => included.has(a.tid));
    const lines: string[] = [];
    lines.push('LIST OF AUTHORITIES');
    if (m?.caseNumber || m?.court) lines.push([m.caseNumber, m.court].filter(Boolean).join(', '));
    lines.push('');
    chosen.forEach((a, i) => {
      const locators = a.passages.filter((p) => paras.has(p.id) && p.locator).map((p) => p.locator);
      const when = a.date ? new Date(`${a.date}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : a.year ?? 'undated';
      lines.push(`${i + 1}. ${authorityName(a.title)}${a.citation ? `, ${a.citation}` : ''} (${a.court}, decided ${when})`);
      if (locators.length) lines.push(`   Relied on at: ${locators.join('; ')}`);
      if (a.note) lines.push(`   Proposition: ${a.note.replace(/\s+/g, ' ').trim()}`);
      if (withTreatment && a.disagreedBy.length) {
        lines.push(
          `   Note: disagreed with in ${a.disagreedBy
            .map((d) => `${authorityName(d.title)} (${d.year ?? 'n.d.'}${d.polarity === 'mixed' ? ', in part' : ''})`)
            .join('; ')}.`,
        );
      }
      lines.push('');
    });
    return lines.join('\n').trimEnd();
  }, [brief, included, paras, withTreatment]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  if (brief.authorities.length === 0) {
    return (
      <p className="mt-6 rounded-lg border border-dashed border-stone-300 p-10 text-center text-sm text-stone-500">
        This matter has no authorities yet. Save judgments into it from search or any case page.
      </p>
    );
  }

  const flagged = brief.authorities.filter((a) => a.disagreedBy.length > 0);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        {flagged.length > 0 && (
          <p className="flex items-start gap-2 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
            <Icon name="alert" size={15} className="mt-0.5 shrink-0" />
            Precedent check: {flagged.length} of these authorities {flagged.length === 1 ? 'was' : 'were'} later
            disagreed with in this library. Expect the other side to rely on the later judgment.
          </p>
        )}
        {brief.authorities.map((a) => (
          <AuthorityCard
            key={a.tid}
            a={a}
            included={included.has(a.tid)}
            onInclude={() => toggle(included, a.tid, setIncluded)}
            paras={paras}
            onPara={(id) => toggle(paras, id, setParas)}
          />
        ))}
      </div>

      <aside className="lg:sticky lg:top-6 lg:self-start">
        <div className="rounded-xl border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-stone-900">List of authorities</h2>
            <span className="text-xs text-stone-500">{included.size} selected</span>
          </div>
          <pre className="mt-3 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-md bg-stone-50 p-3 font-serif text-[13px] leading-relaxed text-stone-800">
            {text}
          </pre>
          <label className="mt-3 flex items-center gap-2 text-xs text-stone-600">
            <input type="checkbox" checked={withTreatment} onChange={(e) => setWithTreatment(e.target.checked)} className="accent-maroon-700" />
            Mention later judgments that disagreed
          </label>
          <button onClick={copy} className={`${primaryButton} mt-3 w-full`}>
            <Icon name={copied ? 'check' : 'document'} size={15} /> {copied ? 'Copied' : 'Copy to clipboard'}
          </button>
          <p className="mt-2 text-[11px] leading-relaxed text-stone-500">
            Paragraph numbers come from the reported judgment where available, otherwise the SCR page.
            Check each against the official report before filing.
          </p>
        </div>
      </aside>
    </div>
  );
}

function AuthorityCard({
  a,
  included,
  onInclude,
  paras,
  onPara,
}: {
  a: BriefAuthority;
  included: boolean;
  onInclude: () => void;
  paras: Set<string>;
  onPara: (id: string) => void;
}) {
  return (
    <article className={`rounded-xl border bg-white p-4 transition-opacity ${included ? 'border-stone-200' : 'border-stone-200 opacity-60'}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={included}
          onChange={onInclude}
          aria-label={`Include ${authorityName(a.title)}`}
          className="mt-1 h-4 w-4 accent-maroon-700"
        />
        <div className="min-w-0 flex-1">
          <Link to={`/case/${a.tid}`} className="font-medium text-stone-900 underline-offset-4 hover:underline">
            {authorityName(a.title)}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500">
            <TierBadge tier={a.courtTier} />
            <span>{a.date ?? a.year ?? 'undated'}</span>
            {a.citation && <span>{a.citation}</span>}
          </div>

          {a.disagreedBy.length > 0 && (
            <p className="mt-2 text-xs font-medium text-vermilion-700">
              <Icon name="alert" size={12} className="mr-1 inline" />
              Disagreed with by{' '}
              {a.disagreedBy.map((d, i) => (
                <span key={d.tid}>
                  {i > 0 && '; '}
                  <Link to={`/case/${d.tid}`} className="underline underline-offset-2">
                    {authorityName(d.title)}
                  </Link>{' '}
                  ({d.year ?? 'n.d.'}{d.polarity === 'mixed' ? ', in part' : ''})
                </span>
              ))}
            </p>
          )}

          {a.note ? (
            <p className="mt-2 border-l-2 border-gold-200 pl-3 text-sm text-stone-700">{a.note}</p>
          ) : (
            <p className="mt-2 text-xs italic text-stone-400">
              No note yet. Add the proposition you rely on it for from its bookmark on the case page.
            </p>
          )}

          <p className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-stone-400">Most relevant paragraphs</p>
          {a.passages.length === 0 && <p className="mt-1 text-xs text-stone-500">No passage in the court’s own words matched the issue closely.</p>}
          <ul className="mt-1.5 space-y-2">
            {a.passages.map((p) => (
              <li key={p.id}>
                <label className="flex cursor-pointer items-start gap-2 rounded-md p-2 hover:bg-stone-50">
                  <input
                    type="checkbox"
                    checked={paras.has(p.id)}
                    onChange={() => onPara(p.id)}
                    disabled={!included}
                    className="mt-0.5 accent-maroon-700"
                  />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-medium text-stone-800">{p.locator ?? 'no para number'}</span>
                      <ContentBadge type={p.contentType} />
                    </span>
                    <span className="judgment-text mt-1 block text-[13px] text-stone-600 line-clamp-3">{p.text}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  );
}
