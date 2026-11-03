import { useMutation } from '@tanstack/react-query';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { CounterItem, OffenceCategory } from '../../api';
import {
  analyseCase,
  authorityName,
  BAIL_SOUGHT,
  FACTOR_LABEL,
  OFFENCE_LABEL,
  getSampleCase,
  type BailSought,
  type CaseAnalysis,
} from '../../api/lawyer';
import { useAuth } from '../../auth';
import { TierBadge } from '../../components/Badges';
import AnswerBlock from '../../components/counter/AnswerBlock';
import SourceDrawer from '../../components/counter/SourceDrawer';
import DeskNav from '../../components/DeskNav';
import { inputClass, primaryButton, secondaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import SaveButton from '../../components/SaveButton';
import { ACCEPTED_DOCUMENTS, documentText } from '../../documentText';
import { useDocumentTitle } from '../../useDocumentTitle';

const MIN_FACTS = 80;
/** Mirror MAX_FACTS_CHARS in server/src/lib/caseAnalysis.ts and the route's 4x cap. */
const MAX_ANALYSED = 10_000;
const MAX_ACCEPTED = MAX_ANALYSED * 4;

const STATUS_STYLE = {
  favourable: { label: 'For the accused', className: 'bg-sage-50 text-sage-700 ring-sage-200' },
  unfavourable: { label: 'Against the accused', className: 'bg-vermilion-50 text-vermilion-700 ring-vermilion-200' },
  missing: { label: 'Not in the facts', className: 'bg-stone-100 text-stone-600 ring-stone-200' },
} as const;

/**
 * Bail case analysis. The lawyer gives the client's facts (typed, or read out
 * of an FIR / order in the browser); the page returns a structured bail
 * research brief: issues, sections, similar judgments from the corpus,
 * arguments for bail and the other side's answers, a bail-factor checklist,
 * missing facts and weaknesses.
 *
 * Two kinds of content sit side by side and are labelled apart: what the AI
 * read out of the lawyer's own facts, and what was retrieved from the
 * judgments (every argument cites a passage the lawyer can open). Nothing
 * is stored on the server.
 */
export default function AnalysisPage() {
  useDocumentTitle('Bail case analysis');
  const { user } = useAuth();
  const [facts, setFacts] = useState('');
  const [bailSought, setBailSought] = useState<BailSought>('unknown');
  const [offence, setOffence] = useState<OffenceCategory | ''>('');
  const [reading, setReading] = useState(false);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const [sourceItem, setSourceItem] = useState<CounterItem | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const mutation = useMutation({
    mutationFn: ({ fresh }: { fresh?: boolean } = {}) =>
      analyseCase({
        facts,
        bailSought: bailSought === 'unknown' ? undefined : bailSought,
        offenceCategory: offence || undefined,
        fresh,
      }),
  });

  async function loadSample() {
    try {
      const sample = await getSampleCase();
      setFacts(sample.facts);
      setBailSought('unknown');
      setOffence('');
      setFileNote(
        sample.saved
          ? 'Sample case loaded (invented facts). Its saved result opens instantly, without using the AI quota.'
          : 'Sample case loaded (invented facts).',
      );
    } catch {
      setFileNote('Could not load the sample case.');
    }
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    setReading(true);
    setFileNote(null);
    try {
      const text = await documentText(file);
      if (!text) {
        setFileNote(`No text could be read from ${file.name}. If it is a scanned PDF, type or paste the relevant facts instead.`);
      } else {
        setFacts((f) => `${f.trim() ? `${f.trim()}\n\n` : ''}--- From ${file.name} ---\n${text}`);
        setFileNote(`Added the text of ${file.name}. Check it and remove anything that is not relevant.`);
      }
    } catch {
      setFileNote(`Could not read ${file.name}. Only PDF and plain-text files are supported.`);
    } finally {
      setReading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  const result = mutation.data;
  const length = facts.trim().length;
  const canSubmit = length >= MIN_FACTS && length <= MAX_ACCEPTED;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:p-0">
      <div className="print:hidden">
        <DeskNav desk="lawyer" />
        <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-maroon-800">Bail case analysis</h1>
        <p className="mt-1 max-w-2xl text-sm text-stone-600">
          Enter your client’s facts or add a document (FIR, charge sheet, earlier bail order). You get the legal issues
          and sections, similar judgments, arguments for bail and the likely counterarguments, and what is missing or
          weak — as a research brief you can print.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) mutation.mutate({});
          }}
          className="mt-6 space-y-4 rounded-xl border border-stone-200 bg-white p-5"
        >
          <label className="block text-xs font-medium text-stone-700">
            Case facts
            <textarea
              value={facts}
              onChange={(e) => setFacts(e.target.value)}
              rows={10}
              placeholder="e.g. Client, 34, arrested on 12 August 2025 under Sections 420 and 406 IPC on a complaint that he took ₹18 lakh for a joint venture… in judicial custody since… charge sheet filed on… Sessions Court rejected bail because…"
              className={`${inputClass} mt-1 font-normal leading-relaxed`}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-stone-500">
            <div className="flex items-center gap-3">
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_DOCUMENTS}
                className="hidden"
                onChange={(e) => onFile(e.target.files?.[0])}
              />
              <button type="button" onClick={() => fileInput.current?.click()} disabled={reading} className={secondaryButton}>
                <Icon name="document" size={14} />
                {reading ? 'Reading…' : 'Add a document'}
              </button>
              <button
                type="button"
                onClick={loadSample}
                className="text-maroon-700 underline-offset-2 hover:underline"
              >
                Use a sample case
              </button>
              <span className="hidden sm:inline">PDF or text. Read in your browser — the file is not uploaded.</span>
            </div>
            <span className={length < MIN_FACTS ? 'text-stone-400' : ''}>
              {length.toLocaleString()} characters
            </span>
          </div>
          {fileNote && <p className="rounded-md bg-stone-50 p-2.5 text-xs text-stone-600">{fileNote}</p>}
          {length > MAX_ACCEPTED ? (
            <p className="rounded-md bg-vermilion-50 p-2.5 text-xs text-vermilion-700">
              That is too long to analyse ({length.toLocaleString()} characters). Keep the facts and the reasons of any
              earlier order, and cut the rest, to under {MAX_ACCEPTED.toLocaleString()}.
            </p>
          ) : (
            length > MAX_ANALYSED && (
              <p className="rounded-md bg-gold-50 p-2.5 text-xs text-gold-800">
                Only the first {MAX_ANALYSED.toLocaleString()} characters will be analysed. Put the most important facts
                first, or trim the document.
              </p>
            )
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-xs font-medium text-stone-700">
              Bail sought
              <select
                value={bailSought}
                onChange={(e) => setBailSought(e.target.value as BailSought)}
                className={`${inputClass} mt-1 font-normal`}
              >
                {Object.entries(BAIL_SOUGHT).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs font-medium text-stone-700">
              Offence category
              <select
                value={offence}
                onChange={(e) => setOffence(e.target.value as OffenceCategory | '')}
                className={`${inputClass} mt-1 font-normal`}
              >
                <option value="">Detect from the facts</option>
                {Object.entries(OFFENCE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-stone-100 pt-4">
            <button type="submit" disabled={!canSubmit || mutation.isPending} className={primaryButton}>
              <Icon name="scales" size={15} />
              {mutation.isPending ? 'Analysing…' : 'Analyse case'}
            </button>
            <p className="flex items-center gap-1.5 text-xs text-stone-500">
              <Icon name="lock" size={13} /> The facts are not saved. A research aid, not legal advice.
            </p>
          </div>
        </form>

        {mutation.isPending && (
          <p className="mt-6 rounded-md border border-stone-200 bg-white p-4 text-sm text-stone-600">
            Reading the facts, finding similar judgments and testing the bail arguments against the corpus. This usually
            takes 20–60 seconds.
          </p>
        )}
        {mutation.isError && (
          <p className="mt-6 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">
            {mutation.error.message}
          </p>
        )}
      </div>

      {result && !result.intake.inScope && (
        <p className="mt-8 rounded-md border border-gold-200 bg-gold-50 p-4 text-sm text-gold-800 print:hidden">
          These facts do not seem to raise a bail, arrest or custody question, which is all this tool’s judgments cover.
          Add the criminal case details and the bail sought, and try again.
        </p>
      )}

      {result && result.intake.inScope && (
        <Brief
          result={result}
          preparedBy={user?.name ?? ''}
          onOpenSource={setSourceItem}
          onRunFresh={() => mutation.mutate({ fresh: true })}
          running={mutation.isPending}
        />
      )}

      <SourceDrawer item={sourceItem} onClose={() => setSourceItem(null)} />
    </div>
  );
}

function Brief({
  result,
  preparedBy,
  onOpenSource,
  onRunFresh,
  running,
}: {
  result: CaseAnalysis;
  preparedBy: string;
  onOpenSource: (item: CounterItem) => void;
  onRunFresh: () => void;
  running: boolean;
}) {
  const { intake, similar, counter } = result;
  const [today] = useState(() => new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }));
  const counterItems = counter?.rounds.flatMap((r) => r.items) ?? [];

  function download() {
    const blob = new Blob([briefMarkdown(result, preparedBy, today)], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: 'bail-research-brief.md' });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="mt-8 flex flex-wrap items-center gap-2 print:hidden">
        <button onClick={() => window.print()} className={primaryButton}>
          <Icon name="document" size={15} /> Print / save as PDF
        </button>
        <button onClick={download} className={secondaryButton}>
          Download (.md)
        </button>
        {result.savedExample ? (
          <span className="flex items-center gap-2 text-xs text-stone-500">
            Saved result of the sample case.
            <button onClick={onRunFresh} disabled={running} className="text-maroon-700 underline-offset-2 hover:underline disabled:opacity-50">
              {running ? 'Running…' : 'Run it fresh'}
            </button>
          </span>
        ) : (
          <span className="text-xs text-stone-400">Took {Math.round(result.tookMs / 1000)}s</span>
        )}
      </div>

      <article className="mt-4 rounded-xl border border-stone-200 bg-white p-6 shadow-sm sm:p-10 print:mt-0 print:rounded-none print:border-0 print:p-0 print:shadow-none">
        <header className="border-b border-stone-200 pb-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gold-600">Bail research brief</p>
          <h2 className="mt-1 font-serif text-xl font-semibold text-stone-900">
            {BAIL_SOUGHT[intake.bailSought] === BAIL_SOUGHT.unknown ? 'Bail' : BAIL_SOUGHT[intake.bailSought]} ·{' '}
            {OFFENCE_LABEL[intake.offenceCategory]}
          </h2>
          <p className="mt-1 text-xs text-stone-500">
            {today}
            {preparedBy && <> · Prepared by {preparedBy}</>}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-stone-500">
            Research aid, not legal advice. Sections 1–3 and 6–7 are an AI reading of the facts you gave — check them;
            the old ⇄ new code column comes from the official correspondence table.
            Sections 4–5 come from the judgments in this corpus (198, mostly Supreme Court, 1912–2022); open each source
            before relying on it.
          </p>
          {result.usedFallbackModel && (
            <p className="mt-2 rounded-md bg-gold-50 p-2 text-xs text-gold-800 print:hidden">
              The main AI model’s free daily limit was reached, so a smaller backup model wrote part of this brief. It is
              less careful: check it closely, or run it again later.
            </p>
          )}
          {result.truncated && (
            <p className="mt-2 text-xs text-gold-700">The facts were long, so only the first part was analysed.</p>
          )}
        </header>

        <Section n={1} title="Case snapshot">
          <p className="text-sm leading-relaxed text-stone-700">{intake.summary || 'No summary could be produced.'}</p>
        </Section>

        <Section n={2} title="Legal issues">
          <List
            empty="No specific issues identified."
            items={intake.issues.map((i) => ({ head: i.issue, body: i.why }))}
          />
        </Section>

        <Section n={3} title="Relevant sections">
          {intake.sections.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-stone-500">
                  <tr className="border-b border-stone-200">
                    <th className="py-2 pr-3 font-medium">Provision</th>
                    <th className="py-2 pr-3 font-medium">What it is about</th>
                    <th className="py-2 pr-3 font-medium">Old ⇄ new code</th>
                    <th className="py-2 font-medium">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {intake.sections.map((s, i) => (
                    <tr key={i} className="border-b border-stone-100 align-top">
                      <td className="whitespace-nowrap py-2 pr-3 font-medium text-stone-900">
                        s. {s.section} {s.act}
                      </td>
                      <td className="py-2 pr-3 text-stone-700">{s.about}</td>
                      <td className="whitespace-nowrap py-2 pr-3 text-stone-700">
                        {s.equivalent ? (
                          s.equivalent.sections.length ? (
                            <Link
                              to={`/sections?${new URLSearchParams({ q: s.section, code: s.act })}`}
                              title={s.equivalent.subject}
                              className="hover:text-maroon-700 hover:underline"
                            >
                              {s.equivalent.code} {s.equivalent.sections.join(', ')}
                            </Link>
                          ) : (
                            <span className="text-xs italic text-stone-400">no {s.equivalent.code} entry</span>
                          )
                        ) : (
                          <span className="text-stone-300">—</span>
                        )}
                      </td>
                      <td className="py-2">
                        {s.source === 'stated' ? (
                          <Pill className="bg-stone-100 text-stone-600 ring-stone-200">In the facts</Pill>
                        ) : (
                          <Pill className="bg-gold-50 text-gold-700 ring-gold-200">Suggested — verify</Pill>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm italic text-stone-500">No sections are named in the facts.</p>
          )}
        </Section>

        <Section n={4} title="Similar judgments">
          {similar.length ? (
            <ul className="space-y-3">
              {similar.map((c) => {
                const p = c.passages[0];
                return (
                  <li key={c.tid} className="rounded-md border border-stone-200 p-3.5 print:break-inside-avoid">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link to={`/case/${c.tid}`} className="font-serif font-semibold text-maroon-800 hover:underline">
                          {authorityName(c.title)}
                        </Link>
                        <p className="mt-0.5 flex items-center gap-2 text-xs text-stone-500">
                          <TierBadge tier={c.courtTier} /> {c.year || 'Year unknown'}
                          {c.citedByCount > 0 && <span>· cited by {c.citedByCount} in the corpus</span>}
                        </p>
                      </div>
                      <div className="print:hidden">
                        <SaveButton tid={c.tid} compact />
                      </div>
                    </div>
                    {p && (
                      <blockquote className="mt-2 border-l-2 border-stone-200 pl-3 text-sm leading-relaxed text-stone-600">
                        {p.text.length > 420 ? `${p.text.slice(0, 420)}…` : p.text}
                        {p.locator && <span className="ml-1 text-xs text-stone-400">({p.locator})</span>}
                      </blockquote>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm italic text-stone-500">
              No judgment in the corpus closely matches these facts. That is a result, not an error: the corpus is 198
              judgments.
            </p>
          )}
        </Section>

        <Section n={5} title="Arguments for bail and counterarguments">
          {!counter ? (
            <p className="text-sm italic text-stone-500">The facts did not give enough to state a bail position.</p>
          ) : !counter.classification.inScope ? (
            <p className="text-sm italic text-stone-500">The bail position was judged outside this corpus’s scope.</p>
          ) : (
            <div className="space-y-3">
              <p className="rounded-md bg-stone-50 p-3 text-sm leading-relaxed text-stone-600">
                <span className="font-medium text-stone-800">Position tested: </span>
                {intake.bailPosition}
              </p>
              {counter.generationFailed && (
                <p className="text-xs text-stone-500">
                  This is often the AI service’s usage limit. Run the analysis again in a few minutes for the written
                  arguments.
                </p>
              )}
              <AnswerBlock
                summary={counter.summary}
                fallbackText={counter.answer}
                sources={counter.sourceIds.map((id) => counterItems.find((it) => it.id === id))}
                generationFailed={counter.generationFailed}
                invalidCitations={counter.invalidCitations}
                onOpenSource={onOpenSource}
              />
            </div>
          )}
        </Section>

        <Section n={6} title="Bail factors checklist">
          {intake.factors.length ? (
            <ul className="divide-y divide-stone-100">
              {intake.factors.map((f) => {
                const style = STATUS_STYLE[f.status];
                return (
                  <li key={f.factor} className="grid gap-1 py-2 text-sm sm:grid-cols-[13rem_9.5rem_1fr] sm:gap-3">
                    <span className="font-medium text-stone-800">{FACTOR_LABEL[f.factor] ?? f.factor}</span>
                    <span>
                      <Pill className={style.className}>{style.label}</Pill>
                    </span>
                    <span className="text-stone-600">{f.note}</span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-sm italic text-stone-500">No checklist could be produced.</p>
          )}
        </Section>

        <Section n={7} title="Missing facts and weaknesses">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-stone-500">Facts to find out</h4>
          <div className="mt-2">
            <List empty="Nothing obvious is missing." items={intake.missingFacts.map((m) => ({ head: m.fact, body: m.why }))} />
          </div>
          <h4 className="mt-6 text-xs font-semibold uppercase tracking-wide text-stone-500">Weak points the other side will raise</h4>
          <div className="mt-2">
            <List empty="No clear weaknesses identified." items={intake.weaknesses.map((w) => ({ head: w.weakness, body: w.why }))} />
          </div>
        </Section>
      </article>
    </>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="mt-8 print:break-inside-avoid-page">
      <h3 className="font-serif text-base font-semibold text-stone-900">
        <span className="mr-2 text-gold-600">{n}.</span>
        {title}
      </h3>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function List({ items, empty }: { items: { head: string; body: string }[]; empty: string }) {
  if (!items.length) return <p className="text-sm italic text-stone-500">{empty}</p>;
  return (
    <ol className="list-decimal space-y-2 pl-5 text-sm leading-relaxed text-stone-700 marker:text-stone-400">
      {items.map((i, k) => (
        <li key={k}>
          <span className="font-medium text-stone-900">{i.head}</span>
          {i.body && <span className="text-stone-600"> — {i.body}</span>}
        </li>
      ))}
    </ol>
  );
}

function Pill({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ${className}`}>
      {children}
    </span>
  );
}

/** The same brief as plain markdown, for pasting into the lawyer's own drafts. */
function briefMarkdown({ intake, similar, counter }: CaseAnalysis, preparedBy: string, date: string): string {
  const s = counter?.summary;
  const items = counter?.rounds.flatMap((r) => r.items) ?? [];
  const source = (n: number) => {
    const it = items.find((i) => i.id === counter?.sourceIds[n - 1]);
    return it ? `${authorityName(it.caseTitle)} (${it.year})${it.locator ? `, ${it.locator}` : ''}` : `source ${n}`;
  };
  const points = (ps: { point: string; detail: string; evidence: number[] }[]) =>
    ps.map((p, i) => `${i + 1}. **${p.point}** ${p.detail}${p.evidence.length ? ` [${p.evidence.map(source).join('; ')}]` : ''}`);
  const lines = [
    '# Bail research brief',
    `${date}${preparedBy ? ` · Prepared by ${preparedBy}` : ''}`,
    `${BAIL_SOUGHT[intake.bailSought]} · ${OFFENCE_LABEL[intake.offenceCategory]}`,
    '',
    '_Research aid, not legal advice. Verify every section and authority before relying on it._',
    '',
    '## 1. Case snapshot',
    intake.summary,
    '',
    '## 2. Legal issues',
    ...intake.issues.map((i, k) => `${k + 1}. **${i.issue}** — ${i.why}`),
    '',
    '## 3. Relevant sections',
    ...intake.sections.map(
      (x) =>
        `- s. ${x.section} ${x.act} — ${x.about}${x.equivalent?.sections.length ? ` (= ${x.equivalent.code} ${x.equivalent.sections.join(', ')})` : ''}${x.source === 'suggested' ? ' _(suggested — verify)_' : ''}`,
    ),
    '',
    '## 4. Similar judgments',
    ...similar.map((c) => `- ${authorityName(c.title)} (${c.year}, ${c.courtTier})${c.passages[0]?.locator ? ` — see ${c.passages[0].locator}` : ''}`),
    '',
    '## 5. Arguments for bail and counterarguments',
    `Position tested: ${intake.bailPosition}`,
    '',
    '### Arguments for bail',
    ...(s ? points(s.yourCase) : ['_Not generated._']),
    '',
    '### Counterarguments',
    ...(s ? points(s.otherSide) : ['_Not generated._']),
    ...(s?.otherSideNote ? [s.otherSideNote] : []),
    ...(s?.weakestPremise ? ['', `Weakest premise: ${s.premises[s.weakestPremise.number - 1] ?? ''} — ${s.weakestPremise.why}`] : []),
    '',
    '## 6. Bail factors checklist',
    ...intake.factors.map((f) => `- **${FACTOR_LABEL[f.factor] ?? f.factor}** (${STATUS_STYLE[f.status].label}) — ${f.note}`),
    '',
    '## 7. Missing facts and weaknesses',
    '### Facts to find out',
    ...intake.missingFacts.map((m) => `- ${m.fact} — ${m.why}`),
    ...(s?.gaps.length ? s.gaps.map((g) => `- ${g}`) : []),
    '',
    '### Weak points the other side will raise',
    ...intake.weaknesses.map((w) => `- ${w.weakness} — ${w.why}`),
    '',
  ];
  return lines.join('\n');
}
