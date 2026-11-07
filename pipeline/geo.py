import json, re, sqlite3, difflib
norm = lambda s: re.sub(r'[^a-z0-9 ]', '', re.sub(r"[’'.]", '', s.lower())).replace('  ', ' ').strip()
def key(s):
    s = norm(s)
    for a, b in (('schl', 'school'), (' da', ' da'), ('tp', 'turning point')): s = s.replace(a, b) if a == 'schl' else s
    return s
stops = [e for e in json.load(open('data/osm_stops.json'))['elements'] if e.get('tags', {}).get('name')]
places = [e for e in json.load(open('data/osm_places.json'))['elements'] if e.get('tags', {}).get('name')]
def best(name, pool, th):
    k = key(name); r = None; bs = 0
    for e in pool:
        sc = difflib.SequenceMatcher(None, k, key(e['tags']['name'])).ratio()
        if sc > bs: bs, r = sc, e
    return (r, bs) if bs >= th else (None, bs)
c = sqlite3.connect('data/sptc.sqlite')
c.execute('drop table if exists stops_geo')
c.execute('create table stops_geo(stop text primary key, lat real, lon real, osm_name text, quality text, score real)')
names = [r[0] for r in c.execute("select distinct stop from stop_times where stop!=''")]
cnt = {}
for n in names:
    e, s = best(n, stops, 0.88); q = 'arret_osm'
    if not e:
        e, s = best(n, places, 0.88); q = 'lieu_approx'
    if not e:
        e, s = None, 0; q = 'inconnu'
    cnt[q] = cnt.get(q, 0) + 1
    c.execute('insert into stops_geo values(?,?,?,?,?,?)', (n, e and e['lat'], e and e['lon'], e and e['tags']['name'], q, s))
c.commit(); print(cnt)
for r in c.execute("select stop,osm_name,quality,round(score,2),round(lat,4),round(lon,4) from stops_geo where stop like 'Beau Vallon%' or stop in ('Victoria','Cascade','Anse Etoile','Glacis','La Batie')"): print(r)
print('inconnus:', [r[0] for r in c.execute("select stop from stops_geo where quality='inconnu' order by 1")][:50])
