import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import LegalAidCard from '../components/LegalAidCard';
import SaveButton from '../components/SaveButton';
import { BAIL_GUIDE, type GuideSection } from '../content/bailRights';
import { useDocumentTitle } from '../useDocumentTitle';

/**
 * "Know your bail rights" — public, no login needed. Plain language first,
 * then the provision and the leading judgments for anyone who wants to read
 * further. Content lives in content/bailRights.ts.
 */
export default function RightsPage() {
  useDocumentTitle('Know your bail rights');

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gold-600">
        <Icon name="scale" size={14} /> A plain-language guide
      </p>
      <h1 className="mt-2 font-serif text-3xl font-semibold tracking-tight text-maroon-800">Know your bail rights</h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-stone-600">
        What bail is, when it is a right, what happens on arrest, and where to get a lawyer for
        free. Each section links to the Supreme Court judgments behind it, which you can read in
        full here.
      </p>

      <div className="mt-5 rounded-lg border border-gold-200 bg-gold-50 p-4 text-xs leading-relaxed text-gold-700">
        <p className="flex items-start gap-2">
          <Icon name="alert" size={14} className="mt-0.5 shrink-0" />
          <span>
            <strong>General information, not legal advice.</strong> Every case turns on its own
            facts; speak to a lawyer (free, if you qualify) before acting. Since 1 July 2024 the
            Bharatiya Nagarik Suraksha Sanhita (BNSS) has replaced the Code of Criminal Procedure
            (CrPC). Both section numbers are given below, because older cases, including every
            judgment in this library, cite the CrPC.
          </span>
        </p>
      </div>

      <nav aria-label="On this page" className="mt-6 flex flex-wrap gap-2">
        {BAIL_GUIDE.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 transition-colors hover:border-maroon-300 hover:text-maroon-800"
          >
            {s.title}
          </a>
        ))}
        <a
          href="#legal-aid"
          className="rounded-full border border-navy-200 bg-navy-50 px-3 py-1 text-xs font-medium text-navy-600 transition-colors hover:border-navy-300"
        >
          Free legal help
        </a>
      </nav>

      <div className="mt-8 space-y-6">
        {BAIL_GUIDE.map((s, i) => (
          <Section key={s.id} section={s} n={i + 1} />
        ))}
      </div>

      <div id="legal-aid" className="mt-8 scroll-mt-6">
        <LegalAidCard />
      </div>
    </div>
  );
}

function Section({ section: s, n }: { section: GuideSection; n: number }) {
  return (
    <section id={s.id} className="scroll-mt-6 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <div className="flex items-baseline gap-3">
        <span className="font-serif text-lg font-semibold text-gold-500">{n}</span>
        <div>
          <h2 className="text-lg font-semibold tracking-tight text-stone-900">{s.title}</h2>
          <p className="mt-0.5 text-sm font-medium text-maroon-700">{s.summary}</p>
        </div>
      </div>

      <div className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-stone-700">
        {groupBullets(s.body).map((block, i) =>
          Array.isArray(block) ? (
            <ul key={i} className="space-y-1.5 pl-1">
              {block.map((b) => (
                <li key={b} className="flex gap-2">
                  <span className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" aria-hidden="true" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p key={i}>{block}</p>
          ),
        )}
      </div>

      {s.law && (
        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">The law</h3>
          <ul className="mt-2 divide-y divide-stone-100 rounded-lg border border-stone-200 text-sm">
            {s.law.map((l) => (
              <li key={l.label} className="flex flex-col gap-1 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
                <span className="text-stone-700">{l.label}</span>
                <span className="flex shrink-0 flex-wrap gap-1.5 text-xs">
                  {l.constitution && <LawTag tone="navy">Constitution, {l.constitution}</LawTag>}
                  {l.bnss && <LawTag tone="maroon">{l.bnss}</LawTag>}
                  {l.crpc && <LawTag tone="stone">formerly {l.crpc}</LawTag>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.cases && (
        <div className="mt-5">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Key judgments</h3>
          <ul className="mt-2 space-y-2">
            {s.cases.map((c) => (
              <li key={c.tid} className="flex items-start justify-between gap-3 rounded-lg bg-stone-50 px-3 py-2.5">
                <div className="min-w-0">
                  <Link to={`/case/${c.tid}`} className="text-sm font-medium text-stone-900 underline-offset-4 hover:underline">
                    {c.name} <span className="font-normal text-stone-500">({c.year})</span>
                  </Link>
                  <p className="mt-0.5 text-xs text-stone-600">{c.point}</p>
                </div>
                <SaveButton tid={c.tid} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      {s.searchQuery && (
        <Link
          to={`/?q=${encodeURIComponent(s.searchQuery)}`}
          className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-maroon-700 hover:underline"
        >
          <Icon name="search" size={12} /> Find more judgments on this
        </Link>
      )}
    </section>
  );
}

/** Consecutive "• " lines become one list; everything else stays a paragraph. */
function groupBullets(lines: string[]): (string | string[])[] {
  const out: (string | string[])[] = [];
  for (const line of lines) {
    if (line.startsWith('• ')) {
      const last = out[out.length - 1];
      if (Array.isArray(last)) last.push(line.slice(2));
      else out.push([line.slice(2)]);
    } else {
      out.push(line);
    }
  }
  return out;
}

function LawTag({ tone, children }: { tone: 'navy' | 'maroon' | 'stone'; children: React.ReactNode }) {
  const tones = {
    navy: 'border-navy-200 bg-navy-50 text-navy-600',
    maroon: 'border-maroon-200 bg-maroon-50 text-maroon-700',
    stone: 'border-stone-200 bg-white text-stone-500',
  };
  return <span className={`rounded border px-1.5 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}
