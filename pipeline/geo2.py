import json, re, sqlite3, time, urllib.request, urllib.parse
UA = 'sptc-bus-research/1.0 (personal project)'
BOX = '55.35,-4.52,55.56,-4.85'  # lon_min,lat_max,lon_max,lat_min
SUF = re.compile(r'\s+(depot|terminal|school|clinic|church|poly|round about|junction|juntion|highway|estate|turning point|da|bus stop)$', re.I)
def geocode(q):
    url = 'https://nominatim.openstreetmap.org/search?' + urllib.parse.urlencode({'q': q + ', Mahé, Seychelles', 'format': 'json', 'limit': 1, 'viewbox': BOX, 'bounded': 1})
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA}), timeout=20)
    time.sleep(1.1)
    j = json.load(r)
    return j[0] if j else None
c = sqlite3.connect('data/sptc.sqlite')
todo = [r[0] for r in c.execute("select stop from stops_geo where quality='inconnu'")]
ok = 0
for n in todo:
    base = re.sub(r'\(.*?\)', '', n).strip()
    for q in dict.fromkeys([base, SUF.sub('', base)]):
        try: g = geocode(q)
        except Exception as e: g = None; time.sleep(3)
        if g:
            c.execute("update stops_geo set lat=?,lon=?,osm_name=?,quality='geocode_approx',score=0 where stop=?", (float(g['lat']), float(g['lon']), g['display_name'][:80], n)); ok += 1; break
# Écarte les résultats hors de Mahé (le géocodeur en renvoie parfois).
c.execute("update stops_geo set lat=null,lon=null,osm_name=null,quality='inconnu' where lat is not null and (lat>-4.52 or lat<-4.85 or lon<55.35 or lon>55.56)")
c.commit(); print(ok, '/', len(todo), 'géocodés')
