import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { Passage } from '../../api';
import { streamCompare } from '../../api/judge';
import AnswerText, { countUnverifiedQuotes } from '../../components/AnswerText';
import { ContentBadge } from '../../components/Badges';
import CasePicker from '../../components/CasePicker';
import { inputClass, primaryButton } from '../../components/Form';
import Icon from '../../components/Icon';
import { useDocumentTitle } from '../../useDocumentTitle';
import DeskNav from '../../components/DeskNav';

const SUGGESTIONS = [
  'Can the protection of anticipatory bail be limited to a fixed period?',
  'What weight does each give to the gravity of the offence?',
  'What does each say about conditions that may be imposed?',
];

/**
 * Two judgments side by side on one legal question. The pair lives in the URL
 * (?a=…&b=…) so "Compare with…" links from a case page land ready to go.
 */
export default function ComparePage() {
  useDocumentTitle('Compare judgments');
  const [params, setParams] = useSearchParams();
  const a = Number(params.get('a')) || null;
  const b = Number(params.get('b')) || null;
  const setSide = (key: 'a' | 'b', tid: number | null) => {
    const next = new URLSearchParams(params);
    if (tid) next.set(key, String(tid));
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const [sources, setSources] = useState<{ a: Passage[]; b: Passage[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);

  async function run(e: FormEvent) {
    e.preventDefault();
    if (!a || !b) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setAnswer('');
    setNotice(null);
    setSources(null);
    setError(null);
    setHighlight(null);
    try {
      await streamCompare(
        { a, b, question: question.trim() || undefined },
        {
          onSources: setSources,
          onNotice: setNotice,
          onToken: (t) => setAnswer((prev) => prev + t),
          onDone: () => setBusy(false),
          onError: (m) => {
            setError(m);
            setBusy(false);
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
      setBusy(false);
    }
  }

  const sourceText = sources ? [...sources.a, ...sources.b].map((p) => p.text).join('\n') : '';
  const unverified = !busy && answer && sources ? countUnverifiedQuotes(answer, sourceText) : 0;

  const cite = (label: string) => {
    setHighlight(label);
    document.getElementById(`extract-${label}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
      <DeskNav desk="judge" />
      <h1 className="mt-4 font-serif text-2xl font-semibold tracking-tight text-maroon-800">Compare two judgments</h1>
      <p className="mt-1 max-w-2xl text-sm text-stone-600">
        Pick two judgments and a legal question. The comparison is drawn only from extracts of the
        two judgments, each labelled and shown below so every statement can be checked.
      </p>

      <form onSubmit={run} className="mt-6 space-y-4 rounded-xl border border-stone-200 bg-white p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <CasePicker label="Judgment A" tid={a} onChange={(t) => setSide('a', t)} exclude={b} />
          <CasePicker label="Judgment B" tid={b} onChange={(t) => setSide('b', t)} exclude={a} />
        </div>
        <div>
          <label htmlFor="question" className="mb-1 flex items-baseline justify-between text-xs font-medium text-stone-700">
            Legal question
            <span className="font-normal text-stone-400">Optional — defaults to “the principle each lays down”</span>
          </label>
          <input
            id="question"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            maxLength={500}
            placeholder="e.g. Can anticipatory bail be limited to a fixed period?"
            className={inputClass}
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setQuestion(s)}
                className="rounded-full border border-stone-200 px-2.5 py-0.5 text-[11px] text-stone-600 hover:border-stone-300 hover:bg-stone-50"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" disabled={!a || !b || busy} className={primaryButton}>
            <Icon name="scale" size={15} />
            {busy ? 'Comparing…' : 'Compare'}
          </button>
          <p className="text-xs text-stone-500">Compares precedent only. It does not suggest how any case should be decided.</p>
        </div>
      </form>

      {error && <p className="mt-4 rounded-md border border-vermilion-200 bg-vermilion-50 p-3 text-sm text-vermilion-700">{error}</p>}

      {(answer || busy || notice) && (
        <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
          {notice && (
            <p className="mb-4 flex items-start gap-2 rounded-md border border-navy-200 bg-navy-50 p-3 text-sm text-navy-700">
              <Icon name="scale" size={15} className="mt-0.5" /> {notice}
            </p>
          )}
          {answer ? (
            <AnswerText text={answer} sourceText={sourceText} onCite={cite} streaming={busy} />
          ) : (
            <p className="text-sm text-stone-500">Reading both judgments…</p>
          )}
          {!busy && answer && (
            <div className="mt-5 space-y-2 border-t border-stone-100 pt-4 text-xs">
              {unverified > 0 && (
                <p className="flex items-start gap-1.5 font-medium text-vermilion-700">
                  <Icon name="alert" size={13} className="mt-0.5" />
                  {unverified} quotation{unverified === 1 ? ' was' : 's were'} not found in the extracts and may be
                  inaccurate. They are marked above.
                </p>
              )}
              <p className="flex items-start gap-1.5 text-stone-500">
                <Icon name="alert" size={13} className="mt-0.5" />
                Machine-generated. Click a label like <span className="font-mono">A3</span> to see the exact extract,
                and verify against the full judgment before relying on any statement.
              </p>
            </div>
          )}
        </section>
      )}

      {sources && (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {(['a', 'b'] as const).map((side) => (
            <section key={side}>
              <h2 className="flex items-center justify-between text-sm font-semibold text-stone-900">
                Extracts from judgment {side.toUpperCase()}
                <Link to={`/case/${side === 'a' ? a : b}`} className="text-xs font-normal text-maroon-700 hover:underline">
                  Open judgment →
                </Link>
              </h2>
              <ol className="mt-2 space-y-2">
                {sources[side].map((p, i) => {
                  const label = `${side.toUpperCase()}${i + 1}`;
                  return (
                    <li
                      key={p.id}
                      id={`extract-${label}`}
                      className={`rounded-lg border p-3 transition-colors ${
                        highlight === label ? 'border-navy-300 bg-navy-50 ring-2 ring-navy-200' : 'border-stone-200 bg-white'
                      }`}
                    >
                      <div className="mb-1.5 flex items-center gap-2">
                        <span className="rounded bg-navy-50 px-1 font-mono text-[11px] font-medium text-navy-600 ring-1 ring-navy-200">{label}</span>
                        <ContentBadge type={p.contentType} />
                        {p.locator && <span className="text-[11px] text-stone-400">{p.locator}</span>}
                      </div>
                      <p className={`judgment-text text-[13px] text-stone-700 ${highlight === label ? '' : 'line-clamp-5'}`}>{p.text}</p>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
