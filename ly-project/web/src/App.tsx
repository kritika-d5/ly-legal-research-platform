import { Link, Outlet } from 'react-router-dom';
import { KanoonCredit } from './components/Attribution';
import Icon, { GraphMark } from './components/Icon';

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <div className="h-1 bg-gradient-to-r from-maroon-800 via-maroon-600 to-gold-400" />

      <header className="border-b border-stone-200 bg-white">
        <div className="mx-auto max-w-6xl px-6 h-14 flex items-center justify-between">
          <Link to="/" className="group flex items-center gap-2.5">
            <GraphMark size={22} className="transition-transform group-hover:-rotate-6" />
            <span className="font-serif text-lg font-semibold tracking-tight text-maroon-800">
              Bail<span className="text-terracotta-400">Research</span>
            </span>
            <span className="text-xs text-stone-500 hidden sm:inline">
              Supreme Court bail jurisprudence
            </span>
          </Link>
          <nav className="flex items-center gap-4 text-xs">
            <Link
              to="/explore"
              className="flex items-center gap-1.5 text-stone-600 transition-colors hover:text-maroon-700"
            >
              <Icon name="network" size={14} />
              Citation explorer
            </Link>
            <Link
              to="/fir"
              className="flex items-center gap-1.5 text-stone-600 transition-colors hover:text-maroon-700"
            >
              <Icon name="document" size={14} />
              FIR Assistant
            </Link>
            <Link
              to="/counter"
              className="flex items-center gap-1.5 text-stone-600 transition-colors hover:text-maroon-700"
            >
              <Icon name="scales" size={14} />
              Counter Engine
            </Link>
            <span className="hidden text-stone-400 sm:inline">
              198 judgments &middot; 1912&ndash;2022
            </span>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      {/* The IKanoon credit is required by the terms under which this corpus was
          collected — see CLAUDE.md rule 10 in the data repo. Do not remove it. */}
      <footer className="border-t border-stone-200 bg-stone-100">
        <div className="mx-auto max-w-6xl px-6 py-5 text-xs text-stone-500">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <KanoonCredit />
            <span className="text-stone-400">
              &mdash; judgment text, the citation graph and citation treatment labels are
              sourced from Indian Kanoon.
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-stone-400">
            <span>
              Official judgment PDFs from the Supreme Court of India open data set
              (records of the Supreme Court Reports).
            </span>
          </div>
          <div className="mt-1.5 text-stone-400">
            Research aid only &mdash; not legal advice. Summaries and answers are
            machine-generated; verify against the judgment before relying on them.
          </div>
        </div>
      </footer>
    </div>
  );
}
