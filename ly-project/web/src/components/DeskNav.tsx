import { NavLink } from 'react-router-dom';
import Icon, { type IconName } from './Icon';

const DESKS: Record<'judge' | 'lawyer', { title: string; tools: { to: string; label: string; icon: IconName }[] }> = {
  judge: {
    title: 'Judges’ research desk',
    tools: [
      { to: '/judge/compare', label: 'Compare', icon: 'scale' },
      { to: '/judge/treatment', label: 'Treatment timeline', icon: 'network' },
      { to: '/judge/memo', label: 'Research memo', icon: 'document' },
    ],
  },
  lawyer: {
    title: 'Lawyers’ desk',
    tools: [
      { to: '/lawyer/matters', label: 'Matters', icon: 'folder' },
      { to: '/lawyer/brief', label: 'Argument builder', icon: 'gavel' },
    ],
  },
};

/** The tab bar shared by the tools of a professional desk. */
export default function DeskNav({ desk }: { desk: 'judge' | 'lawyer' }) {
  const { title, tools } = DESKS[desk];
  return (
    <nav aria-label={title} className="print:hidden">
      <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-gold-600">
        <Icon name={desk === 'judge' ? 'gavel' : 'folder'} size={14} /> {title}
      </p>
      <div className="mt-2 flex gap-1 overflow-x-auto border-b border-stone-200">
        {tools.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) =>
              `-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm transition-colors ${
                isActive ? 'border-maroon-700 font-medium text-maroon-800' : 'border-transparent text-stone-500 hover:text-stone-800'
              }`
            }
          >
            <Icon name={t.icon} size={14} />
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
