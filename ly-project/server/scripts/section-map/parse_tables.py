"""Parse the CAPT Bhopal correspondence tables (pdftotext -bbox output) into rows.

Columns per page: new section | subject | old section | summary. Their x
positions differ page to page, so each page's columns are found from where
section-number-like tokens cluster."""
import collections, html, json, re, sys

SEC = re.compile(r'^(\d+[A-Z]{0,2}(\(\d+[A-Za-z]?\))*(\([a-z]+\))*[.,]?|New\.?|Omitted\.?|and|to|&|,)$')

def cells_of(ws, gap=7.0):
    """Split one line's words into cells wherever the horizontal gap is wide."""
    cells, cur = [], [ws[0]]
    for prev, w in zip(ws, ws[1:]):
        if w[0] - prev[2] > gap:
            cells.append(cur); cur = [w]
        else:
            cur.append(w)
    cells.append(cur)
    return cells

OLD_TOKEN = re.compile(r'^(\d+[A-Z]{0,2}(\(\d+[A-Za-z]?\))*(\([a-z]+\))*[.,]?|New\.?|-|&|and|to|,|Explanat|ion)$')
START = re.compile(r'^\d+[A-Z]{0,2}(\s?\(\d+[A-Za-z]?\))*(\([a-z]+\))*$')

def page_rows(page):
    words = [(float(a), float(b), float(c), html.unescape(t)) for a, b, c, _, t in
             re.findall(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)</word>', page)]
    foot = [w[1] for w in words if 'Anil' in w[3] or '©' in w[3]]
    if foot: words = [w for w in words if abs(w[1] - foot[0]) > 3]
    if not words: return []
    left = min(w[0] for w in words)
    # Group into lines by nearness, not fixed buckets: a cell is sometimes
    # printed a point higher or lower than the rest of its line.
    groups = []
    for w in sorted(words, key=lambda w: w[1]):
        if groups and w[1] - groups[-1][0] <= 3.0:
            groups[-1][1].append(w)
        else:
            groups.append([w[1], [w]])
    parsed = []
    for _, ws in groups:
        ws = sorted(ws)
        cells = cells_of(ws)
        kinds = []
        for i, c in enumerate(cells):
            x = c[0][0]
            if i == 0 and x < left + 12: kinds.append('new')
            elif x > left + 120 and all(OLD_TOKEN.match(w[3]) for w in c) and x < 430: kinds.append('old')
            else: kinds.append('text')
        parsed.append((ws, cells, kinds))
    # page geometry from lines that have an explicit old cell
    old_xs = sorted(c[0][0] for _, cells, kinds in parsed for c, k in zip(cells, kinds) if k == 'old')
    if not old_xs: return []
    old_x = old_xs[len(old_xs) // 2]
    sum_xs = sorted(cells[i + 1][0][0] for _, cells, kinds in parsed for i, k in enumerate(kinds) if k == 'old' and i + 1 < len(cells))
    sum_x = sum_xs[len(sum_xs) // 2] if sum_xs else old_x + 40
    rows = []
    for ws, cells, kinds in parsed:
        cols = {'new': [], 'subject': [], 'old': [], 'summary': []}
        for c, k in zip(cells, kinds):
            x = c[0][0]
            if k == 'new': col = 'new'
            elif k == 'old': col = 'old'
            elif x >= sum_x - 8: col = 'summary'
            elif x >= old_x - 8 and all(OLD_TOKEN.match(w[3]) for w in c): col = 'old'
            else:
                # The IPC number can sit so close to the subject that no gap
                # separates them: peel trailing section-like words that lie in
                # the old column off the end of the subject cell.
                tail = []
                while c and c[-1][0] >= old_x - 14 and OLD_TOKEN.match(c[-1][3]):
                    tail.insert(0, c.pop())
                cols['subject'] += [w[3] for w in c]
                cols['old'] += [w[3] for w in tail]
                continue
            cols[col] += [w[3] for w in c]
        is_start = cols['new'] and START.match(' '.join(cols['new']).split(' ')[0])
        if is_start or not rows:
            rows.append({k: ' '.join(v) for k, v in cols.items()})
        else:
            for k, v in cols.items():
                if v: rows[-1][k] = (rows[-1][k] + ' ' + ' '.join(v)).strip()
    return rows

def parse(path):
    pages = open(path).read().split('<page ')[1:]
    rows = []
    for p in pages:
        rows += page_rows(p)
    # drop header rows
    return [r for r in rows if re.match(r'^\d', r['new'])]

if __name__ == '__main__':
    rows = parse(sys.argv[1])
    json.dump(rows, open(sys.argv[2], 'w'), indent=1, ensure_ascii=False)
    print(len(rows), 'rows')
