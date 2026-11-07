import json, re, sqlite3, os, sys
TIME = re.compile(r'^(\d{1,2})[:.](\d{2})$')
db = 'data/sptc.sqlite'
if os.path.exists(db): os.remove(db)
c = sqlite3.connect(db)
c.executescript('''
CREATE TABLE services(id INTEGER PRIMARY KEY, day_type TEXT, route TEXT, title TEXT, source_page INT);
CREATE TABLE service_stops(service_id INT, seq INT, stop TEXT);
CREATE TABLE trips(id INTEGER PRIMARY KEY, service_id INT, trip_no INT);
CREATE TABLE stop_times(trip_id INT, seq INT, stop TEXT, time TEXT);
CREATE TABLE meta(k TEXT, v TEXT);
''')
warn = []; svc_seen = set()
last = {}
def is_title(r): return r[0].startswith('Route') and not any(r[1:])
for daytype, f in (('weekday','data/raw_weekday.json'),('weekend','data/raw_weekend.json')):
    for t in json.load(open(f)):
        fixed = []
        for r in t['rows']:
            if r and r[0] and '\nRoute 2D from Anse Royale C' in r[0]:
                fixed.append([r[0].split('\n')[0],'','','-','','-','13:45','-'])
                fixed.append(['Route 2D from Anse Royale Church -Saturday']+[None]*7)
                warn.append((t['page'],'patch manuel','2C/2D samedi'))
            else: fixed.append(r)
        rows = [[(x or '').replace('\n',' ').strip() for x in r] for r in fixed]
        rows = [r for r in rows if any(r)]
        if not rows: continue
        segs = []
        for r in rows:
            if is_title(r): segs.append([r[0], []])
            else:
                if not segs: segs.append([last.get(daytype), []])
                segs[-1][1].append(r)
        for title, body in segs:
            if not title or not body: continue
            if not title.startswith('Route'): continue
            if not any(TIME.match(x) for x in body[0]):
                hdr = body[0]; body = body[1:]
            else:
                warn.append((t['page'], 'sans en-tête', title)); continue
            route = re.match(r'Route\s+(\S+)', title).group(1)
            key = (daytype, title, tuple(hdr), tuple(map(tuple, body)))
            if key in svc_seen: continue
            svc_seen.add(key)
            cur = c.execute('INSERT INTO services(day_type,route,title,source_page) VALUES(?,?,?,?)',(daytype,route,title,t['page']))
            sid = cur.lastrowid
            last[daytype] = title
            for i, s_ in enumerate(hdr): c.execute('INSERT INTO service_stops VALUES(?,?,?)',(sid,i,s_))
            n = 0; seen = set()
            for r in body:
                if tuple(r) in seen: continue
                seen.add(tuple(r))
                if not any(TIME.match(x) for x in r):
                    warn.append((t['page'], 'ligne sans heure', title, r)); continue
                n += 1
                tc = c.execute('INSERT INTO trips(service_id,trip_no) VALUES(?,?)',(sid,n))
                for i, x in enumerate(r):
                    m2 = TIME.match(x)
                    if m2:
                        c.execute('INSERT INTO stop_times VALUES(?,?,?,?)',(tc.lastrowid,i,hdr[i] if i < len(hdr) else '?', f'{int(m2.group(1)):02d}:{m2.group(2)}'))
                    elif x not in ('', '-'): warn.append((t['page'], 'cellule inattendue', title, x))
# Retire la page-guide « How to read this timetable » (pages 1-2) : exemple, pas un horaire.
for tbl, col in (('stop_times', "trip_id in (select id from trips where service_id in (select id from services where source_page<=2))"), ('trips', 'service_id in (select id from services where source_page<=2)'), ('service_stops', 'service_id in (select id from services where source_page<=2)'), ('services', 'source_page<=2')):
    c.execute(f'delete from {tbl} where {col}')
c.commit()
for q in ('select day_type,count(*) from services group by 1','select count(*) from trips','select count(*) from stop_times'):
    print(q, c.execute(q).fetchall())
print(len(warn),'avertissements')
for w in warn[:40]: print(w)
