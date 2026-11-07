import sys, re, json, pdfplumber
TIME = re.compile(r'^\d{1,2}[:.]\d{2}$')
def lines_above(pg, top, bottom):
    if bottom - top < 3: return []
    t = pg.crop((0, top, pg.width, bottom)).extract_text() or ''
    return [l.strip() for l in t.split('\n') if l.strip()]
def extract(path, daytype):
    out = []
    last_label = None
    with pdfplumber.open(path) as pdf:
        for pn, pg in enumerate(pdf.pages, 1):
            pg = pg.crop((0, 0, pg.width, pg.height - 45))
            tabs = sorted(pg.find_tables(), key=lambda t: t.bbox[1])
            prev = 0
            for t in tabs:
                above = lines_above(pg, prev, t.bbox[1])
                lab = [l for l in above if l.startswith('Route')]
                label = lab[-1] if lab else None
                rows = t.extract()
                prev = t.bbox[3]
                out.append(dict(page=pn, label=label, rows=rows, daytype=daytype))
    return out
if __name__ == '__main__':
    res = extract(sys.argv[1], sys.argv[2])
    json.dump(res, open(sys.argv[3], 'w'), ensure_ascii=False)
    print(len(res), 'tables', sum(1 for r in res if r['label'] is None), 'sans titre')
