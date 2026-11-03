/**
 * Inline SVG icons.
 *
 * Inline rather than an icon package: there are fifteen of them, they are all
 * on a 24 grid, and they inherit `currentColor` so a single Tailwind text
 * colour drives the icon and its label together. No dependency, no sprite
 * fetch, no flash of unstyled icon.
 *
 * Everything is stroked rather than filled so the set stays legible at the
 * 12–16px sizes it is actually used at, and so it reads as line-work next to
 * the serif judgment text rather than as UI chrome pasted on top.
 */
export type IconName =
  | 'search'
  | 'court'
  | 'gavel'
  | 'document'
  | 'text'
  | 'network'
  | 'summary'
  | 'chat'
  | 'quote'
  | 'send'
  | 'pin'
  | 'calendar'
  | 'cites'
  | 'citedBy'
  | 'back'
  | 'chevronLeft'
  | 'chevronRight'
  | 'external'
  | 'alert'
  | 'scales'
  | 'user'
  | 'logout'
  | 'shield'
  | 'check'
  | 'close'
  | 'lock'
  | 'bookmark'
  | 'bookmarkFilled'
  | 'folder'
  | 'plus'
  | 'trash'
  | 'pencil'
  | 'scale'
  | 'phone';

const PATHS: Record<IconName, React.ReactNode> = {
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M16.5 16.5 21 21" />
    </>
  ),
  // A court building: the shorthand for "which bench decided this".
  court: (
    <>
      <path d="M3 9.5 12 4l9 5.5" />
      <path d="M5 9.5v9M9.5 9.5v9M14.5 9.5v9M19 9.5v9" />
      <path d="M3 18.5h18" />
    </>
  ),
  gavel: (
    <>
      <path d="M15 2.5 21.5 9l-3 3-6.5-6.5z" />
      <path d="M13.5 8.5 5 17" />
      <path d="M3 21h9" />
    </>
  ),
  document: (
    <>
      <path d="M14 2H7a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7z" />
      <path d="M14 2v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  text: <path d="M4 6h16M4 11h16M4 16h16M4 21h9" />,
  // Two authorities feeding one hub — the shape this whole corpus makes.
  network: (
    <>
      <circle cx="5.5" cy="6.5" r="2.5" />
      <circle cx="5.5" cy="17.5" r="2.5" />
      <circle cx="18" cy="12" r="3" />
      <path d="M8 7.5 15.2 10.8M8 16.5 15.2 13.2" />
    </>
  ),
  summary: (
    <>
      <path d="M12 3.5 13.9 9l5.6 1.9-5.6 2L12 18.5 10.1 12.9 4.5 10.9 10.1 9z" />
      <path d="M18.5 3v3M20 4.5h-3" />
    </>
  ),
  chat: (
    <>
      <path d="M20.5 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4.5 3v-5.4a7.5 7.5 0 1 1 17-5.1z" />
      <path d="M8.5 11.5h8M8.5 15h5" />
    </>
  ),
  quote: (
    <>
      <path d="M9 6C6 7.5 4.5 10 4.5 13v5h6v-6H8c0-2 .4-3.5 2-4.5z" />
      <path d="M19 6c-3 1.5-4.5 4-4.5 7v5h6v-6H18c0-2 .4-3.5 2-4.5z" />
    </>
  ),
  send: <path d="M3.5 12 21 4l-6 17-3.5-7.5z" />,
  pin: (
    <>
      <path d="M12 21s7-6.6 7-11.5a7 7 0 1 0-14 0C5 14.4 12 21 12 21z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="16" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  // Direction, not decoration: out to an earlier authority, back from a later
  // case. These two are the whole grammar of the citation sidebar.
  cites: <path d="M7 17 17 7M9.5 7H17v7.5" />,
  citedBy: <path d="M17 7 7 17M14.5 17H7V9.5" />,
  back: <path d="M19 12H5M10.5 6.5 5 12l5.5 5.5" />,
  chevronLeft: <path d="M14.5 5.5 8 12l6.5 6.5" />,
  chevronRight: <path d="M9.5 5.5 16 12l-6.5 6.5" />,
  external: (
    <>
      <path d="M14 4h6v6M20 4l-8.5 8.5" />
      <path d="M18 14.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3.5" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5 22 20H2z" />
      <path d="M12 9.5v4.5M12 17h.01" />
    </>
  ),
  // Scales of justice — Counter Engine's mark. Two pans in balance, which is
  // also the visual argument for why the feature is symmetric by side.
  scales: (
    <>
      <path d="M12 3v16M8 21h8" />
      <path d="M4 7h6M14 7h6" />
      <path d="M4 7 1.5 12.5a2.5 2.5 0 0 0 5 0z" />
      <path d="M20 7l-2.5 5.5a2.5 2.5 0 0 0 5 0z" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  logout: (
    <>
      <path d="M9.5 20H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3.5" />
      <path d="M15 16.5 19.5 12 15 7.5M19.5 12H9" />
    </>
  ),
  // Verification: the badge a checked lawyer or judge account carries.
  shield: (
    <>
      <path d="M12 2.5 19.5 5.5v6c0 4.6-3.2 8.3-7.5 10-4.3-1.7-7.5-5.4-7.5-10v-6z" />
      <path d="m8.8 12 2.3 2.3 4.2-4.6" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  lock: (
    <>
      <rect x="4.5" y="10.5" width="15" height="10.5" rx="2" />
      <path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" />
    </>
  ),
  bookmark: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />,
  // The one filled glyph: "saved" has to read at a glance in a list of results.
  bookmarkFilled: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" fill="currentColor" />,
  folder: <path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v8.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />,
  plus: <path d="M12 5v14M5 12h14" />,
  trash: (
    <>
      <path d="M4.5 7h15M9.5 7V4.5h5V7" />
      <path d="M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" />
    </>
  ),
  // Scales of justice: the "your rights" section.
  scale: (
    <>
      <path d="M12 3.5v17M7 20.5h10M5 6.5h14" />
      <path d="M5 6.5 2.5 12.5a2.5 2.5 0 0 0 5 0zM19 6.5l-2.5 6a2.5 2.5 0 0 0 5 0z" />
    </>
  ),
  phone: (
    <path d="M5 3.5h3.5l1.5 4.5-2.3 1.6a12 12 0 0 0 6.7 6.7l1.6-2.3 4.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5A16.5 16.5 0 0 1 3.5 5 1.5 1.5 0 0 1 5 3.5z" />
  ),
  pencil: (
    <>
      <path d="M15.5 4.5 19.5 8.5 8.5 19.5H4.5v-4z" />
      <path d="m13 7 4 4" />
    </>
  ),
};

export default function Icon({
  name,
  size = 16,
  className = '',
  strokeWidth = 1.6,
}: {
  name: IconName;
  size?: number;
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  );
}

/** The wordmark glyph — the same three-node citation motif as the favicon. */
export function GraphMark({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true" className={className}>
      <rect width="32" height="32" rx="7" className="fill-maroon-800" />
      <g className="stroke-stone-200" strokeWidth="1.6" strokeLinecap="round" opacity="0.85">
        <line x1="10" y1="9.5" x2="22" y2="16" />
        <line x1="10" y1="22.5" x2="22" y2="16" />
      </g>
      <circle cx="10" cy="9.5" r="3" className="fill-stone-100" />
      <circle cx="10" cy="22.5" r="3" className="fill-stone-100" />
      <circle cx="22" cy="16" r="4.2" className="fill-gold-400" />
    </svg>
  );
}
