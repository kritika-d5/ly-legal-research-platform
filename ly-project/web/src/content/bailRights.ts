/**
 * "Know your bail rights" — the plain-language guide for citizens.
 *
 * Kept as data, separate from the page, so it can be reviewed and corrected by
 * someone who knows the law without touching any React.
 *
 * Accuracy rules for editing this file:
 *  - Cite both codes. The Bharatiya Nagarik Suraksha Sanhita, 2023 (BNSS)
 *    replaced the Code of Criminal Procedure, 1973 (CrPC) on 1 July 2024, but
 *    every judgment in this corpus (1912–2022) cites the CrPC, and cases
 *    registered earlier may still proceed under it.
 *  - Every `tid` below is checked to exist in bail_rag.nodes. Do not add one
 *    that is not in the corpus: the link would 404.
 *  - Describe, do not advise. Say what the law provides, never what a reader
 *    should do in their own case.
 */

export interface GuideCase {
  tid: number;
  name: string;
  year: number;
  /** One line: what this judgment is known for. */
  point: string;
}

export interface GuideSection {
  id: string;
  title: string;
  summary: string;
  /** Short paragraphs or bullet points. A line starting with "• " renders as a bullet. */
  body: string[];
  /** Provision references, new code first. */
  law?: { bnss?: string; crpc?: string; constitution?: string; label: string }[];
  cases?: GuideCase[];
  /** A search to run for more judgments on this topic. */
  searchQuery?: string;
}

export const BAIL_GUIDE: GuideSection[] = [
  {
    id: 'what-is-bail',
    title: 'What bail is',
    summary: 'Release from custody while the case goes on, on a promise to come back.',
    body: [
      'Bail means a person accused of an offence is released from police or judicial custody while the investigation and trial continue. In return they give a bond, a written promise to appear whenever required, sometimes backed by a surety (another person who vouches for them).',
      'Bail is not a finding of innocence, and refusing bail is not a punishment. The question is only whether the person needs to be kept in custody until the case is decided.',
      'The Supreme Court has repeatedly said that bail should be the rule and jail the exception, because a person is presumed innocent until proven guilty.',
    ],
    cases: [
      { tid: 8258, name: 'State of Rajasthan v. Balchand', year: 1977, point: 'The basic rule is "bail, not jail".' },
      { tid: 656741, name: 'Gudikanti Narasimhulu v. Public Prosecutor', year: 1977, point: 'Personal liberty is at stake; bail should not be refused as punishment.' },
      { tid: 7148380, name: 'Satender Kumar Antil v. CBI', year: 2022, point: 'Detailed guidelines to stop unnecessary arrests and delays in deciding bail.' },
    ],
    searchQuery: 'bail is the rule and jail the exception',
  },
  {
    id: 'bailable-non-bailable',
    title: 'Bailable and non-bailable offences',
    summary: 'For a bailable offence, bail is a right. For a non-bailable one, the court decides.',
    body: [
      'Every offence is classified as bailable or non-bailable in the First Schedule of the criminal procedure code.',
      '• Bailable offence: the person has a right to be released on bail. The police officer or court must grant it once the bond is given.',
      '• Non-bailable offence: bail is not automatic. A magistrate, Sessions Court or High Court decides after looking at the facts. "Non-bailable" does not mean bail is impossible.',
      'Courts must not ask for bail amounts or sureties that a poor person cannot afford. Release on a personal bond, without sureties, is possible.',
    ],
    law: [
      { bnss: 'BNSS s. 478', crpc: 'CrPC s. 436', label: 'Bail in bailable offences' },
      { bnss: 'BNSS s. 480', crpc: 'CrPC s. 437', label: 'Bail in non-bailable offences (magistrate)' },
      { bnss: 'BNSS s. 483', crpc: 'CrPC s. 439', label: 'Special powers of High Court and Sessions Court' },
    ],
    cases: [
      { tid: 1912056, name: 'Moti Ram v. State of M.P.', year: 1978, point: 'Excessive sureties from a poor accused defeat the right to bail.' },
      { tid: 1515744, name: 'Babu Singh v. State of U.P.', year: 1978, point: 'Bail decisions must weigh personal liberty against the public interest.' },
    ],
    searchQuery: 'bail in non-bailable offences',
  },
  {
    id: 'anticipatory-bail',
    title: 'Anticipatory bail (before arrest)',
    summary: 'If someone fears arrest, they can ask the court in advance for release on arrest.',
    body: [
      'A person who reasonably believes they may be arrested for a non-bailable offence can apply to the Sessions Court or the High Court for anticipatory bail. If granted, they are released on bail if they are arrested.',
      'The court may attach conditions, for example joining the investigation when called, not leaving the country, or not contacting witnesses.',
      'A Constitution Bench of the Supreme Court held in 2020 that anticipatory bail need not ordinarily be limited to a fixed period; it can continue until the end of the trial unless the court orders otherwise.',
    ],
    law: [{ bnss: 'BNSS s. 482', crpc: 'CrPC s. 438', label: 'Direction for bail to a person apprehending arrest' }],
    cases: [
      { tid: 1308768, name: 'Gurbaksh Singh Sibbia v. State of Punjab', year: 1980, point: 'The foundational judgment: the power is wide and should not be read down.' },
      { tid: 123660783, name: 'Sushila Aggarwal v. State (NCT of Delhi)', year: 2020, point: 'Protection is not ordinarily time-bound (Constitution Bench).' },
      { tid: 1108032, name: 'Siddharam Satlingappa Mhetre v. State of Maharashtra', year: 2010, point: 'Factors courts weigh when granting anticipatory bail.' },
    ],
    searchQuery: 'when can anticipatory bail be granted',
  },
  {
    id: 'default-bail',
    title: 'Default bail (if the charge sheet is late)',
    summary: 'If police do not file the charge sheet in time, the accused can claim bail as a right.',
    body: [
      'After arrest, the police must finish the investigation and file a charge sheet within a fixed time:',
      '• 90 days for offences punishable with death, life imprisonment, or imprisonment of at least ten years;',
      '• 60 days for all other offences.',
      'If the charge sheet is not filed in time, the accused becomes entitled to "default bail" (also called statutory bail). The right has to be claimed by applying for bail before the charge sheet is filed; it is lost if the accused does not apply in time.',
    ],
    law: [{ bnss: 'BNSS s. 187', crpc: 'CrPC s. 167(2)', label: 'Custody when investigation is not complete in 24 hours' }],
    cases: [
      { tid: 1747003, name: 'Uday Mohanlal Acharya v. State of Maharashtra', year: 2001, point: 'The right is indefeasible once claimed before the charge sheet is filed.' },
      { tid: 194334432, name: 'Rakesh Kumar Paul v. State of Assam', year: 2017, point: 'For offences punishable with up to ten years, the 60-day limit applies.' },
    ],
    searchQuery: 'default bail under Section 167(2)',
  },
  {
    id: 'if-arrested',
    title: 'Your rights if you are arrested',
    summary: 'Know why, tell someone, see a lawyer, and see a magistrate within 24 hours.',
    body: [
      '• To be told the grounds of arrest, and, for a bailable offence, that you have the right to be released on bail.',
      '• To have a relative, friend or other person you name informed of the arrest and where you are held.',
      '• To consult a lawyer of your choice, including meeting them during interrogation (though not necessarily throughout it).',
      '• To be produced before a magistrate within 24 hours of arrest, not counting travel time. Custody beyond that needs a magistrate’s order.',
      '• To free legal aid if you cannot afford a lawyer (see "Free legal help" below).',
      'Arrest is not automatic just because police have the power to arrest. For offences punishable with up to seven years, police should first consider issuing a notice to appear instead, and must record reasons if they do arrest.',
    ],
    law: [
      { constitution: 'Article 22', label: 'Grounds of arrest, lawyer, magistrate within 24 hours' },
      { bnss: 'BNSS s. 47', crpc: 'CrPC s. 50', label: 'Grounds of arrest and right to bail' },
      { bnss: 'BNSS s. 48', crpc: 'CrPC s. 50A', label: 'Informing a nominated person' },
      { bnss: 'BNSS s. 38', crpc: 'CrPC s. 41D', label: 'Meeting an advocate during interrogation' },
      { bnss: 'BNSS s. 35(3)', crpc: 'CrPC s. 41A', label: 'Notice of appearance instead of arrest' },
    ],
    cases: [
      { tid: 768175, name: 'Joginder Kumar v. State of U.P.', year: 1994, point: 'Arrest must be justified, not routine; someone must be told of it.' },
      { tid: 2982624, name: 'Arnesh Kumar v. State of Bihar', year: 2014, point: 'No automatic arrest for offences punishable up to seven years.' },
    ],
    searchQuery: 'arrest guidelines and rights of arrested person',
  },
  {
    id: 'undertrials',
    title: 'Limits on detention before trial',
    summary: 'An undertrial cannot be held indefinitely: there is a legal ceiling.',
    body: [
      'A person held in custody during investigation or trial must be released on bail once they have been detained for half of the maximum sentence for the offence.',
      'Under the BNSS, a first-time offender must be released after one-third of the maximum sentence.',
      'This does not apply to offences punishable with death or life imprisonment, and the court can order continued detention for recorded reasons.',
    ],
    law: [{ bnss: 'BNSS s. 479', crpc: 'CrPC s. 436A', label: 'Maximum period an undertrial can be detained' }],
    cases: [
      { tid: 1007347, name: 'Hussainara Khatoon v. State of Bihar', year: 1979, point: 'Speedy trial and free legal aid are part of the right to life.' },
    ],
    searchQuery: 'undertrial prisoners long detention speedy trial',
  },
  {
    id: 'how-courts-decide',
    title: 'How courts decide bail',
    summary: 'There is no fixed formula. Courts balance liberty against a few well-known risks.',
    body: [
      'For non-bailable offences, courts commonly consider:',
      '• the nature and seriousness of the accusation and the possible punishment;',
      '• whether there is a prima facie case (a basic case on the evidence, not proof of guilt);',
      '• the risk that the accused will run away or not attend court;',
      '• the risk of tampering with evidence or threatening witnesses;',
      '• the accused’s past record, and the likelihood of the offence being repeated.',
      'A bail order should give reasons. A higher court can cancel bail that was granted without considering these factors.',
    ],
    cases: [
      { tid: 1129584, name: 'Prasanta Kumar Sarkar v. Ashis Chatterjee', year: 2010, point: 'The standard list of factors for granting bail.' },
      { tid: 836557, name: 'Ram Govind Upadhyay v. Sudarshan Singh', year: 2002, point: 'Bail is discretionary but must be exercised judicially.' },
      { tid: 1342616, name: 'Kalyan Chandra Sarkar v. Rajesh Ranjan', year: 2004, point: 'In grave offences, bail granted without weighing gravity and evidence can be set aside.' },
      { tid: 1563495, name: 'Sanjay Chandra v. CBI', year: 2011, point: 'Seriousness alone is not a reason to deny bail, even in economic offences.' },
    ],
    searchQuery: 'factors to be considered while granting bail',
  },
];

/** Who is entitled to free legal services — Legal Services Authorities Act, 1987, s. 12. */
export const LEGAL_AID_ELIGIBLE = [
  'Women and children',
  'Members of a Scheduled Caste or Scheduled Tribe',
  'Persons with disabilities',
  'Anyone in custody, including a protective or juvenile home',
  'Victims of trafficking or forced labour (begar)',
  'Victims of mass disaster, ethnic or caste violence, flood, drought, earthquake or industrial disaster',
  'Industrial workers',
  'Anyone whose annual income is below the limit set by their state',
];

/** Official services only; every URL was checked when this file was written. */
export const LEGAL_AID_LINKS = {
  helpline: '15100',
  helplineSite: 'https://nalsa15100.in/',
  apply: 'https://scourtapp.nic.in/lsams/nologin/applicationFiling.action?requestLocale=en',
  directory: 'https://nalsa.gov.in/directory/',
  nalsa: 'https://nalsa.gov.in/legal-aid/',
  defenceCounsel: 'https://ladcsdashboard.nalsa.gov.in/',
  teleLaw: 'https://www.tele-law.in/',
};
