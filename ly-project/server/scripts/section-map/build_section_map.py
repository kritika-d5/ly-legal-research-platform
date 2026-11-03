"""Build server/data/section-map.json: IPC -> BNS and CrPC -> BNSS.

Source: the official correspondence tables and comparison summaries prepared
at the Central Academy for Police Training (CAPT), Bhopal (Ministry of Home
Affairs), as published by Kerala Prisons:
  https://keralaprisons.gov.in/userfiles/act-and-rules/comparison_summary_BNS_to_IPC.pdf
  https://keralaprisons.gov.in/userfiles/act-and-rules/comparison_summary_BNSS_to_CrPC.pdf

Usage (needs poppler's pdftotext):
  pdftotext -bbox comparison_summary_BNS_to_IPC.pdf bns.html
  pdftotext -bbox comparison_summary_BNSS_to_CrPC.pdf bnss.html
  python3 build_section_map.py bns.html bnss.html ../../data/section-map.json

The parser reads each word's position on the page (parse_tables.py). The few
rows it cannot read cleanly are set in OVERRIDES below, each checked by hand
against the PDF. Do not edit the JSON by hand: fix the parser or add an
override, and rebuild.
"""
import json, re, sys
from datetime import date
from parse_tables import parse

# Rows the layout parser gets wrong, read by hand from the PDFs.
OVERRIDES = {
    'ipc_bns': {
        '5': {'subject': 'Commutation of sentence.', 'old': '54 & 55',
              'summary': 'In this section, a cross reference to BNSS has been made, whereas IPC does not refer to CrPC in this context.'},
        '73': {'subject': 'Printing or publishing any matter relating to court proceedings without permission.', 'old': '228A(3)'},
        '177': {'subject': 'Failure to keep election accounts.', 'old': '171-I'},
        '226': {'old': 'New'},
    },
    'crpc_bnss': {
        '2(1)(c)': {'subject': '"bailable offence".', 'old': '2(a)'},
        '2(1)(f)': {'subject': '"charge".', 'old': '2(b)'},
        '2(1)(g)': {'subject': '"cognizable offence".', 'old': '2(c)'},
        '2(1)(j)': {'subject': '"High Court".', 'old': '2(e)'},
        '2(1)(t)': {'subject': '"police report".', 'old': '2(r)'},
        '2(1)(y)': {'subject': '"victim".', 'old': '2(wa)'},
        '297': {'old': '265-I'},
    },
}
# Rows missing from the parse altogether (the first page's header block).
EXTRA = {
    'ipc_bns': [
        {'new': '1(1)', 'subject': 'Short title, commencement and application.', 'old': '1', 'summary': 'This subject is covered by six subsections of Section 1 of BNS, corresponding to five separate sections of IPC.'},
        {'new': '1(2)', 'subject': 'Commencement.', 'old': 'New', 'summary': 'The power to appoint the date of commencement is delegated to the Central Government, which was absent in the IPC.'},
        {'new': '1(3)', 'subject': 'Punishment of offences committed within India.', 'old': '2', 'summary': 'No change except "Code" is replaced with "Sanhita".'},
        {'new': '1(4)', 'subject': 'Punishment of offences committed beyond, which by law may be tried within, India.', 'old': '3', 'summary': 'Section is included as a subsection in BNS sans heading.'},
        {'new': '1(5)', 'subject': 'Extension of Code to extra-territorial offences.', 'old': '4', 'summary': 'Section is included as a subsection in BNS sans heading.'},
        {'new': '1(6)', 'subject': 'Certain laws not to be affected by this Act.', 'old': '5', 'summary': 'IPC section is included as a subsection in BNS sans heading.'},
    ],
    'crpc_bnss': [],
}

TOKEN = re.compile(r'\d+[A-Z]{0,2}(?:-[A-Z]+)?(?:\(\d*[a-z]*\))*')

def tidy(sec: str) -> str:
    """'318 (4)' -> '318(4)', '2(c )' -> '2(c)'."""
    return re.sub(r'\s+', '', sec).rstrip('.,')

def old_sections(old: str) -> list[str]:
    """'230 to 232, 246 to 249, 255' -> every section named; '376(1) & 376(2)' -> both."""
    text = re.sub(r'Explanat\s*ion', '', old)
    text = re.sub(r'(\d)\s+\(', r'\1(', text)
    text = re.sub(r'\(\s*([a-z0-9]+)\s*\)', r'(\1)', text)
    out = []
    for a, b in re.findall(r'(\d+)\s+to\s+(\d+)', text):
        out += [str(n) for n in range(int(a), int(b) + 1)]
    text = re.sub(r'\d+\s+to\s+\d+', '', text)
    out += [m.group() for m in TOKEN.finditer(text)]
    seen = []
    for s in out:
        if s not in seen: seen.append(s)
    return seen

def change(row) -> str:
    if not row['oldSections']: return 'new'
    summary = row['summary'].lower()
    if summary.startswith('no change') and 'except' not in summary[:30]: return 'same'
    return 'modified'

def build(rows, overrides, extra):
    out = []
    for r in extra + rows:
        key = tidy(r['new'])
        if key in overrides: r = {**r, **overrides[key]}
        if not r['subject'] and not r['old'] and len(r['summary']) < 20: continue  # page-break debris
        row = {
            'new': tidy(r['new']),
            'subject': re.sub(r'\s+', ' ', r['subject']).strip(),
            'old': re.sub(r'\s+', ' ', r['old']).strip(),
            'summary': re.sub(r'\s+', ' ', r['summary']).strip(),
        }
        row['oldSections'] = [] if row['old'] in ('', '-', 'New', 'New.') or row['old'].startswith('New') else old_sections(row['old'])
        row['change'] = change(row)
        out.append(row)
    return out

if __name__ == '__main__':
    bns_html, bnss_html, dest = sys.argv[1:4]
    data = {
        'source': {
            'title': 'Correspondence tables and comparison summaries, CAPT Bhopal (MHA)',
            'urls': [
                'https://keralaprisons.gov.in/userfiles/act-and-rules/comparison_summary_BNS_to_IPC.pdf',
                'https://keralaprisons.gov.in/userfiles/act-and-rules/comparison_summary_BNSS_to_CrPC.pdf',
            ],
            'built': date.today().isoformat(),
        },
        'ipc_bns': build(parse(bns_html), OVERRIDES['ipc_bns'], EXTRA['ipc_bns']),
        'crpc_bnss': build(parse(bnss_html), OVERRIDES['crpc_bnss'], EXTRA['crpc_bnss']),
    }
    json.dump(data, open(dest, 'w'), indent=1, ensure_ascii=False)
    print({k: len(v) for k, v in data.items() if isinstance(v, list)})
