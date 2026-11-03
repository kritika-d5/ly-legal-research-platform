/**
 * After an FIR is confirmed: how courts approach bail for accusations of the
 * same kind, so a complainant knows what may happen next.
 *
 * Curated, not searched. The library holds 198 bail judgments, mostly on
 * general principles, so a free-text search on "theft" or "assault" surfaces
 * loosely related cases. Each incident category instead maps to the verified
 * landmark judgments on the rule that actually governs it (e.g. Arnesh Kumar
 * for offences punishable up to seven years). The judgments and their one-line
 * summaries come from content/bailRights.ts, so there is one source of truth.
 *
 * PRIVACY — this is the one place FIR data meets the research side, so it is
 * deliberately narrow: only the fixed act categories and the yes/no weapon
 * flag are read, nothing leaves the browser, and the user is told which
 * categories were used.
 */
import { Link } from 'react-router-dom';
import type { ActType, CaseState } from '../api/fir';
import { BAIL_GUIDE, type GuideCase } from '../content/bailRights';
import Icon from './Icon';
import SaveButton from './SaveButton';

interface Topic {
  label: string;
  /** Why these judgments, in one sentence. */
  why: string;
  tids: number[];
  query: string;
}

/** Offences typically punishable with up to seven years: Arnesh Kumar governs arrest. */
const LESSER: Omit<Topic, 'label' | 'query'> = {
  why: 'Accusations like this are usually offences punishable with up to seven years, where arrest is not automatic and bail is commonly granted.',
  tids: [2982624, 768175, 7148380],
};

const TOPICS: Partial<Record<ActType, Topic>> = {
  physical_assault: {
    label: 'assault',
    why: 'For accusations of violence, courts look closely at how serious the injuries are, the evidence, and any risk to the complainant or witnesses.',
    tids: [1129584, 1342616, 836557],
    query: 'factors to be considered while granting bail',
  },
  taking_property: { label: 'theft or robbery', ...LESSER, query: 'bail in theft and robbery cases' },
  cheating_or_fraud: {
    label: 'cheating or fraud',
    why: 'For financial offences, the Supreme Court has held that the seriousness of the charge alone is not a reason to keep someone in custody.',
    tids: [1563495, 7148380],
    query: 'bail in cheating and economic offences',
  },
  threat: { label: 'threats', ...LESSER, query: 'bail for criminal intimidation' },
  harassment: { label: 'harassment', ...LESSER, query: 'bail in harassment cases' },
  stalking_or_following: { label: 'stalking', ...LESSER, query: 'bail in harassment of women' },
  property_damage: { label: 'damage to property', ...LESSER, query: 'bail for damage to property' },
  entering_premises: { label: 'entering premises', ...LESSER, query: 'bail in house trespass cases' },
  online_or_message_based: { label: 'online messages', ...LESSER, query: 'bail in cyber offences' },
  verbal_abuse: { label: 'verbal abuse', ...LESSER, query: 'bail for minor offences' },
};

/** A weapon moves any violent or property accusation into the "serious" group. */
const WITH_WEAPON: Omit<Topic, 'label' | 'query'> = {
  why: 'When a weapon is alleged, the accusation is usually treated as more serious, and courts weigh the gravity, the evidence and the risk to the complainant.',
  tids: [1129584, 1342616, 836557],
};

const MAX_TOPICS = 2;
const CASES = new Map<number, GuideCase>(BAIL_GUIDE.flatMap((s) => s.cases ?? []).map((c) => [c.tid, c]));

function relatedTopics(state: CaseState): Topic[] {
  // Most frequent act type first: that is what the incident is mostly about.
  const counts = new Map<ActType, number>();
  for (const a of state.acts) counts.set(a.type, (counts.get(a.type) ?? 0) + 1);
  const types = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([t]) => t);
  const weapon = state.flags.weapon_involved?.value === true;

  return types
    .filter((t) => TOPICS[t])
    .slice(0, MAX_TOPICS)
    .map((t) => {
      const topic = TOPICS[t]!;
      const armed = weapon && (t === 'physical_assault' || t === 'taking_property' || t === 'threat');
      return armed ? { ...topic, ...WITH_WEAPON, label: `${topic.label} with a weapon` } : topic;
    });
}

export default function FirRelatedJudgments({ state }: { state: CaseState }) {
  const topics = relatedTopics(state);
  if (topics.length === 0) return null;

  // Two topics can share a judgment; show it once, under the first.
  const seen = new Set<number>();
  const groups = topics.map((t) => {
    const cases = t.tids.filter((tid) => !seen.has(tid)).map((tid) => CASES.get(tid)).filter(Boolean) as GuideCase[];
    cases.forEach((c) => seen.add(c.tid));
    return { ...t, cases };
  });

  return (
    <section className="mt-8 rounded-xl border border-stone-200 bg-white p-5 sm:p-6">
      <h2 className="flex items-center gap-2 text-base font-semibold text-stone-900">
        <Icon name="gavel" size={17} className="text-maroon-700" /> What may happen next: bail
      </h2>
      <p className="mt-1 text-sm text-stone-600">
        If someone is arrested, the question of bail usually comes up quickly. These Supreme Court
        judgments set out how courts approach it for accusations of this kind.
      </p>
      <p className="mt-2 flex items-start gap-1.5 text-xs text-stone-500">
        <Icon name="lock" size={12} className="mt-0.5" />
        <span>
          Chosen only from the type of incident ({groups.map((g) => g.label).join(', ')}). No names,
          places or details from your FIR were used or sent anywhere.
        </span>
      </p>

      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <div key={g.label}>
            <h3 className="text-[11px] font-semibold uppercase tracking-wide text-stone-400">Accusations of {g.label}</h3>
            <p className="mt-1 text-sm text-stone-700">{g.why}</p>
            <ul className="mt-2 space-y-2">
              {g.cases.map((c) => (
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
            <Link
              to={`/?q=${encodeURIComponent(g.query)}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-maroon-700 hover:underline"
            >
              <Icon name="search" size={12} /> Search for more
            </Link>
          </div>
        ))}
      </div>

      <p className="mt-4 text-xs text-stone-500">
        This is general information about the law, not a prediction about your case.
      </p>
      <Link
        to="/rights"
        className="mt-3 flex items-center justify-between rounded-lg border border-stone-200 px-4 py-3 text-sm transition-colors hover:border-terracotta-300"
      >
        <span>
          <span className="font-medium text-stone-900">Know your bail rights</span>
          <span className="block text-xs text-stone-500">Bailable vs non-bailable, anticipatory bail, arrest rights</span>
        </span>
        <Icon name="chevronRight" size={16} className="text-stone-400" />
      </Link>
    </section>
  );
}
