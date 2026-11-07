"""Serveur MCP : horaires de bus SPTC, Seychelles. Base SQLite : ../data/sptc.sqlite

stdio par défaut ; SPTC_HTTP=1 pour le mode HTTP (connecteur distant).
Variables : SPTC_DB, SPTC_BIND (127.0.0.1), PORT/SPTC_PORT (8791),
SPTC_PUBLIC_HOST (noms d'hôte autorisés, séparés par des virgules ; active la protection DNS-rebinding).
"""
import os, sqlite3, datetime
from mcp.server.fastmcp import FastMCP

DB = os.environ.get('SPTC_DB', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'data', 'sptc.sqlite'))
VALID = "Horaires officiels SPTC valables au 4 août 2026 ; théoriques, sans temps réel."
HTTP = os.environ.get('SPTC_HTTP') == '1'
if HTTP:
    from mcp.server.transport_security import TransportSecuritySettings
    hosts = [h for h in os.environ.get('SPTC_PUBLIC_HOST', '').split(',') if h]
    sec = TransportSecuritySettings(
        enable_dns_rebinding_protection=bool(hosts),
        allowed_hosts=[x for h in hosts for x in (h, f'{h}:*')] + ['127.0.0.1:*', 'localhost:*'],
        allowed_origins=['https://claude.ai', 'https://claude.com'] + [f'https://{h}' for h in hosts])
    mcp = FastMCP('sptc-bus', host=os.environ.get('SPTC_BIND', '127.0.0.1'),
                  port=int(os.environ.get('PORT', os.environ.get('SPTC_PORT', '8791'))),
                  stateless_http=True, json_response=True,
                  instructions="Horaires officiels des bus SPTC (Mahé, Seychelles), théoriques, sans temps réel. Données : sptc.sc.",
                  transport_security=sec)
else:
    mcp = FastMCP('sptc-bus')

def db():
    c = sqlite3.connect(f'file:{os.path.abspath(DB)}?mode=ro', uri=True)
    c.row_factory = sqlite3.Row
    return c

def day_type(d):
    return 'weekend' if d in ('weekend', 'samedi', 'dimanche') else 'weekday'

def now_sc():
    return datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=4)))

@mcp.tool()
def chercher_arret(nom: str) -> str:
    """Cherche des arrêts SPTC dont le nom contient `nom` (ex. 'Beau Vallon')."""
    rows = db().execute("""select t.stop, count(*) n, g.lat, g.lon, g.quality from stop_times t left join stops_geo g on g.stop=t.stop
        where t.stop like ? group by t.stop order by n desc limit 30""", (f'%{nom[:60]}%',)).fetchall()
    def pos(r):
        return f" — position {'approximative ' if r['quality'] != 'arret_osm' else ''}{r['lat']:.5f},{r['lon']:.5f}" if r['lat'] is not None else ''
    return '\n'.join(f"{r['stop']} ({r['n']} passages){pos(r)}" for r in rows) or 'Aucun arrêt trouvé.'

@mcp.tool()
def prochains_passages(depart: str, arrivee: str = '', apres: str = '', jour: str = 'semaine', limite: int = 6) -> str:
    """Prochains bus au départ de `depart` (nom partiel), optionnellement vers `arrivee`.
    `apres` = HH:MM (défaut : maintenant, heure des Seychelles). `jour` = 'semaine' ou 'weekend'."""
    apres = apres or now_sc().strftime('%H:%M')
    dt = day_type(jour); limite = max(1, min(int(limite), 20))
    depart, arrivee = depart[:60], arrivee[:60]
    q = """select s.route, s.title, a.stop sa, a.time ta, b.stop sb, b.time tb
           from services s join trips t on t.service_id=s.id
           join stop_times a on a.trip_id=t.id and a.stop like ?
           %s
           where s.day_type=? and a.time>=? order by a.time limit ?"""
    if arrivee:
        q = q % "join stop_times b on b.trip_id=t.id and b.stop like ? and b.seq>a.seq"
        args = (f'%{depart}%', f'%{arrivee}%', dt, apres, limite)
    else:
        q = q % "left join stop_times b on 0"
        args = (f'%{depart}%', dt, apres, limite)
    rows = db().execute(q, args).fetchall()
    if not rows: return f"Aucun passage après {apres} ({dt}). {VALID}"
    lines = [f"{r['ta']} {r['title']} — {r['sa']}" + (f" → {r['sb']} {r['tb']}" if arrivee else '') for r in rows]
    return '\n'.join(lines) + f"\n({VALID})"

@mcp.tool()
def horaires_ligne(ligne: str, jour: str = 'semaine') -> str:
    """Tous les horaires d'une ligne (ex. '20', '22', '24A'), par sens."""
    dt = day_type(jour); c = db()
    out = []
    for s in c.execute("select id, title from services where day_type=? and route=? order by id", (dt, ligne)).fetchall():
        stops = [r['stop'] for r in c.execute("select stop from service_stops where service_id=? order by seq", (s['id'],))]
        out.append(f"## {s['title']}\n" + ' | '.join(stops))
        for t in c.execute("select id from trips where service_id=? order by trip_no", (s['id'],)).fetchall():
            tm = {r['seq']: r['time'] for r in c.execute("select seq,time from stop_times where trip_id=?", (t['id'],))}
            out.append(' | '.join(tm.get(i, '-') for i in range(len(stops))))
    return ('\n'.join(out) or f"Ligne {ligne} introuvable ({dt}).") + f"\n({VALID})"

if __name__ == '__main__':
    mcp.run(transport='streamable-http' if HTTP else 'stdio')
