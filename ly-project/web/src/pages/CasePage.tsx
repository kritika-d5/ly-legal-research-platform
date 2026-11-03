import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getCachedBailAnalysis, getCase, OUTCOME_LABEL, type Citation } from '../api';
import { KanoonSourceNote } from '../components/Attribution';
import BailAnalysisPanel from '../components/BailAnalysisPanel';
import { PolarityBadge, TierBadge } from '../components/Badges';
import ChatPanel from '../components/ChatPanel';
import EgoGraph from '../components/EgoGraph';
import PdfViewer from '../components/PdfViewer';
import SummaryPanel from '../components/SummaryPanel';
import Icon, { type IconName } from '../components/Icon';
import TextViewer from '../components/TextViewer';
import { shortCaseTitle, useDocumentTitle } from '../useDocumentTitle';

type Tab = 'document' | 'text' | 'bail' | 'citations' | 'summary' | 'chat';

export default function CasePage() {
  const { tid: tidParam } = useParams();
  const tid = Number(tidParam);
  const { data, isLoading, error } = useQuery({
    queryKey: ['case', tid],
    queryFn: () => getCase(tid),
  });
  const [tab, setTab] = useState<Tab>('document');
  // Shares its cache with BailAnalysisPanel, so the header badge appears the
  // moment an analysis exists — on load if the server has one, or right after
  // the user runs it.
  const { data: bail } = useQuery({
    queryKey: ['bail', tid],
    queryFn: () => getCachedBailAnalysis(tid),
  });

  useDocumentTitle(data ? shortCaseTitle(data.title) : null);

  if (isLoading) return <p className="mx-auto max-w-6xl px-6 py-10 text-sm text-stone-500">Loading&hellip;</p>;
  if (error) {
    return (
      <p className="mx-auto max-w-6xl px-6 py-10 text-sm text-vermilion-700">
        {(error as Error).message}
      </p>
    );
  }
  if (!data) return null;

  // 58 of the 198 cases have no official PDF (every High Court case, everything
  // pre-1950), so the document tab has to open on the text view for them
  // rather than showing an empty viewer.
  const effectiveTab: Tab = tab === 'document' && !data.hasPdf ? 'text' : tab;

  const tabs: [Tab, string, IconName][] = [
    ...(data.hasPdf
      ? ([['document', 'Official PDF', 'document']] as [Tab, string, IconName][])
      : []),
    ['text', 'Text', 'text'],
    ['bail', 'Bail outcome', 'gavel'],
    ['citations', 'Citation graph', 'network'],
    ['summary', 'Summary', 'summary'],
    ['chat', 'Ask this case', 'chat'],
  ];

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <Link
        to="/"
        className="group flex w-fit items-center gap-1.5 text-xs text-stone-500
                   transition-colors hover:text-maroon-700"
      >
        <Icon name="back" size={13} className="transition-transform group-hover:-translate-x-0.5" />
        Back to search
      </Link>

      <div className="mt-3 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="max-w-3xl text-xl font-semibold tracking-tight text-stone-900">
            {data.title}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500">
            <TierBadge tier={data.courtTier} />
            {bail && (
              <button
                onClick={() => setTab('bail')}
                title="See the reasons and supporting paragraphs"
                className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]
                            font-medium ${OUTCOME_LABEL[bail.analysis.outcome].tone}`}
              >
                <Icon name="gavel" size={11} strokeWidth={1.8} />
                {OUTCOME_LABEL[bail.analysis.outcome].short}
              </button>
            )}
            <span>{data.court}</span>
            {data.publishdate && <span>{data.publishdate}</span>}
            {data.neutralCitation && <span>{data.neutralCitation}</span>}
            {data.author && <span>{data.author}</span>}
          </div>
        </div>
      </div>

      {data.courtTier !== 'SC' && (
        <p
          className="mt-4 flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50
                     px-3 py-2 text-xs text-gold-700"
        >
          <Icon name="alert" size={14} className="mt-px" />
          This is not a Supreme Court decision. It does not bind other courts the way a Supreme
          Court judgment does.
        </p>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <div className="mb-5 flex gap-1 border-b border-stone-200">
            {tabs.map(([id, label, icon]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm
                            transition-colors ${
                  effectiveTab === id
                    ? 'border-maroon-700 font-medium text-maroon-800'
                    : 'border-transparent text-stone-500 hover:border-stone-300 hover:text-stone-800'
                }`}
              >
                <Icon name={icon} size={15} />
                {label}
              </button>
            ))}
          </div>

          {effectiveTab === 'document' && data.pdfUrl && <PdfViewer url={data.pdfUrl} />}
          {effectiveTab === 'text' && <TextViewer tid={tid} />}
          {effectiveTab === 'bail' && <BailAnalysisPanel tid={tid} />}
          {effectiveTab === 'citations' && <EgoGraph tid={tid} />}
          {effectiveTab === 'summary' && <SummaryPanel tid={tid} />}
          {effectiveTab === 'chat' && <ChatPanel tid={tid} title={data.title} />}
        </div>

        <aside className="space-y-6">
          <CitationBlock
            icon="cites"
            heading="Cites"
            hint="Earlier cases this judgment relied on"
            items={data.citations.cites}
          />
          <CitationBlock
            icon="citedBy"
            heading="Cited by"
            hint="Later cases in this corpus that cite it"
            items={data.citations.citedBy}
          />

          <div>
            <h2
              className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide
                         text-stone-400"
            >
              <Icon name="quote" size={13} />
              What this text contains
            </h2>
            <ul className="mt-2 space-y-1 text-xs text-stone-600">
              {data.chunkStats.map((s) => (
                <li key={s.contentType} className="flex justify-between gap-2">
                  <span>{s.contentType.replace('_', ' ')}</span>
                  <span className="tabular-nums text-stone-400">{s.chunks}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border-t border-stone-200 pt-4">
            <KanoonSourceNote what="Judgment text, citations and treatment labels" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function CitationBlock({
  icon,
  heading,
  hint,
  items,
}: {
  icon: IconName;
  heading: string;
  hint: string;
  items: Citation[];
}) {
  if (!items.length) return null;
  return (
    <div>
      <h2 className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-stone-400">
        <Icon name={icon} size={13} className="text-terracotta-400" />
        {heading} ({items.length})
      </h2>
      <p className="mt-0.5 text-[11px] text-stone-400">{hint}</p>
      <ul className="mt-2 space-y-2.5">
        {items.map((c) => (
          <li key={`${c.direction}-${c.tid}`}>
            <Link
              to={`/case/${c.tid}`}
              className="block text-[13px] leading-snug text-stone-700 hover:underline
                         underline-offset-4"
            >
              {c.title}
            </Link>
            <div className="mt-1 flex items-center gap-1.5">
              <PolarityBadge polarity={c.polarity} />
              {c.courtTier !== 'SC' && (
                <span className="text-[11px] text-stone-400">{c.courtTier}</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
