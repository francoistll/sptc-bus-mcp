// Requêtes sur la base D1 (copie de data/sptc.sqlite). Aucun horaire ne passe par le LLM.
export const VALID_FR = 'Horaires SPTC du 4 août 2026, théoriques, sans temps réel.';
export const VALID_EN = 'SPTC timetable of 4 August 2026: scheduled times only, no real-time data.';

const like = (s) => '%' + String(s).replace(/[\\%_]/g, (c) => '\\' + c) + '%';

// Heure aux Seychelles (UTC+4, pas d'heure d'été).
export function seychellesNow(d = new Date()) {
  const t = new Date(d.getTime() + 4 * 3600 * 1000);
  const hh = String(t.getUTCHours()).padStart(2, '0');
  const mm = String(t.getUTCMinutes()).padStart(2, '0');
  const dow = t.getUTCDay(); // 0 = dimanche
  return { dow, time: `${hh}:${mm}`, day: dow === 0 || dow === 6 ? 'weekend' : 'weekday' };
}

// Cache en deux niveaux (mémoire de l'instance, puis Cache API de Cloudflare, partagée entre instances)
// pour des données statiques : évite de relire la base D1 (quota gratuit de lectures de lignes par jour).
const mem = new Map();
async function cached(key, ttl, fn) {
  const m = mem.get(key);
  if (m && m.exp > Date.now()) return m.v;
  let cache = null, req = null;
  try { cache = caches.default; req = new Request('https://cache.internal/' + encodeURIComponent(key)); } catch {}
  if (cache) {
    try {
      const hit = await cache.match(req);
      if (hit) { const v = await hit.json(); mem.set(key, { v, exp: Date.now() + ttl * 1000 }); return v; }
    } catch {}
  }
  const v = await fn();
  mem.set(key, { v, exp: Date.now() + ttl * 1000 });
  if (mem.size > 200) mem.clear();
  if (cache) {
    try { await cache.put(req, new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttl}` } })); } catch {}
  }
  return v;
}

// Liste des arrêts avec leur nombre de passages (1 balayage de la table, ensuite en cache 24 h).
async function stopList(db) {
  return cached('stoplist:v1', 86400, async () => {
    const r = await db.prepare("select stop, count(*) n from stop_times where stop != '' group by stop order by n desc").all();
    return r.results;
  });
}
export async function stopNames(db) {
  return (await stopList(db)).map((x) => x.stop);
}

// Noms exacts d'arrêts contenant `name` (comme LIKE '%name%', insensible à la casse), résolus en mémoire :
// les requêtes SQL peuvent alors utiliser l'index sur stop_times.stop au lieu de balayer la table.
async function resolveStops(db, name, max = 60) {
  const q = String(name).toLowerCase();
  return (await stopList(db)).filter((x) => x.stop.toLowerCase().includes(q)).slice(0, max);
}
const marks = (n) => Array(n).fill('?').join(',');

export async function findStops(db, name) {
  const found = (await resolveStops(db, name)).slice(0, 20);
  if (!found.length) return [];
  const geo = await cached('geo:v1', 86400, async () => (await db.prepare('select stop, lat, lon, quality from stops_geo').all()).results);
  const g = new Map(geo.map((x) => [x.stop, x]));
  return found.map((x) => ({ stop: x.stop, n: x.n, lat: g.get(x.stop)?.lat ?? null, lon: g.get(x.stop)?.lon ?? null, quality: g.get(x.stop)?.quality ?? null }));
}

export async function routesServing(db, name) {
  const st = (await resolveStops(db, name)).map((x) => x.stop);
  if (!st.length) return [];
  const r = await db
    .prepare(`select distinct s.route from stop_times a join trips t on t.id = a.trip_id join services s on s.id = t.service_id where a.stop in (${marks(st.length)}) order by s.route`)
    .bind(...st)
    .all();
  return r.results.map((x) => x.route);
}

export async function nextDepartures(db, { depart, arrivee, after, day, limit = 8, last = false }) {
  const dep = (await resolveStops(db, depart)).map((x) => x.stop);
  if (!dep.length) return [];
  const args = [...dep];
  // Sans arrivée demandée : on affiche le terminus (dernier arrêt du trajet) et son heure.
  let join = 'left join stop_times b on b.trip_id = t.id and b.seq = (select max(x.seq) from stop_times x where x.trip_id = t.id) and b.seq > a.seq';
  if (arrivee) {
    const arr = (await resolveStops(db, arrivee)).map((x) => x.stop);
    if (!arr.length) return [];
    join = `join stop_times b on b.trip_id = t.id and b.stop in (${marks(arr.length)}) and b.seq > a.seq`;
    args.push(...arr);
  }
  args.push(day, after, Math.max(1, Math.min(limit, 20)));
  const sql = `select s.route, s.title, t.id trip, a.stop sa, a.seq qa, a.time ta, b.stop sb, b.seq qb, b.time tb
    from services s join trips t on t.service_id = s.id
    join stop_times a on a.trip_id = t.id and a.stop in (${marks(dep.length)})
    ${join}
    where s.day_type = ? and a.time >= ? order by a.time ${last ? 'desc' : ''} limit ?`;
  // Ordre des paramètres : départs, [arrivées], day, after, limit
  const r = await db.prepare(sql).bind(...args).all();
  if (!arrivee) r.results.forEach((x) => { if (x.sb) x.term = 1; });
  return last ? r.results.reverse() : r.results;
}

// Une correspondance : bus 1 de `depart` jusqu'à un arrêt commun X, puis bus 2 de X jusqu'à `arrivee`
// (au moins 3 min de battement). Un résultat par 2e bus.
export async function transferDepartures(db, { depart, arrivee, after, day, limit = 5 }) {
  const dep = (await resolveStops(db, depart)).map((x) => x.stop);
  const arr = (await resolveStops(db, arrivee)).map((x) => x.stop);
  if (!dep.length || !arr.length) return [];
  const sql = `select s1.route r1, t1.id trip1, a.stop sa, a.time ta, b.stop sx, b.time tx1,
      s2.route r2, t2.id trip2, c.time tx2, d.stop sb, d.time tb
    from stop_times a
    join trips t1 on t1.id = a.trip_id join services s1 on s1.id = t1.service_id and s1.day_type = ?
    join stop_times b on b.trip_id = t1.id and b.seq > a.seq
    join stop_times c on c.stop = b.stop and c.trip_id != t1.id and c.time >= time(b.time, '+3 minutes')
    join trips t2 on t2.id = c.trip_id join services s2 on s2.id = t2.service_id and s2.day_type = ?
    join stop_times d on d.trip_id = t2.id and d.seq > c.seq and d.stop in (${marks(arr.length)})
    where a.stop in (${marks(dep.length)}) and a.time >= ? and b.stop != '' and b.stop not in (${marks(arr.length)})
    order by a.time, d.time limit 600`;
  const r = await db.prepare(sql).bind(day, day, ...arr, ...dep, after, ...arr).all();
  const best = new Map();
  for (const x of r.results) {
    const k = x.trip2; // un seul résultat par 2e bus : le dernier bus 1 qui permet encore la correspondance
    if (!best.has(k) || x.ta > best.get(k).ta || (x.ta === best.get(k).ta && x.tb < best.get(k).tb)) best.set(k, x);
  }
  const out = [...best.values()].sort((u, v) => (u.ta < v.ta ? -1 : u.ta > v.ta ? 1 : 0)).slice(0, limit);
  const kept = out;
  kept.forEach((x) => { x.dur = minutesBetween(x.ta, x.tb); });
  return kept;
}

export async function lineTimetable(db, { route, day }) {
  return cached(`line:v1:${day}:${route}`, 3600, () => lineTimetableDb(db, { route, day }));
}
async function lineTimetableDb(db, { route, day }) {
  const services = (
    await db.prepare('select id, title from services where day_type = ? and route = ? order by id').bind(day, route).all()
  ).results;
  if (!services.length) return [];
  // Une seule requête groupée (db.batch) au lieu d'une requête par trajet.
  const res = await db.batch(
    services.flatMap((s) => [
      db.prepare('select stop from service_stops where service_id = ? order by seq').bind(s.id),
      db.prepare('select t.id trip, st.seq, st.time from trips t left join stop_times st on st.trip_id = t.id where t.service_id = ? order by t.trip_no, t.id').bind(s.id),
    ])
  );
  return services.map((s, k) => {
    const stops = res[2 * k].results.map((x) => x.stop);
    const byTrip = new Map();
    for (const r of res[2 * k + 1].results) {
      if (!byTrip.has(r.trip)) byTrip.set(r.trip, {});
      if (r.seq !== null) byTrip.get(r.trip)[r.seq] = r.time;
    }
    const rows = [...byTrip.values()].map((tm) => stops.map((_, i) => tm[i] || '–'));
    return { title: s.title, stops, rows };
  });
}

// Détail d'un trajet : tous les arrêts du service, avec l'heure de passage de ce trajet (null si non indiquée).
export async function tripDetail(db, id) {
  const head = await db.prepare('select s.route, s.title, s.day_type from trips t join services s on s.id = t.service_id where t.id = ?').bind(id).all();
  if (!head.results.length) return null;
  const r = await db
    .prepare(
      `select ss.seq, ss.stop, st.time, g.lat, g.lon from service_stops ss
       join trips t on t.service_id = ss.service_id and t.id = ?
       left join stop_times st on st.trip_id = t.id and st.seq = ss.seq
       left join stops_geo g on g.stop = ss.stop
       order by ss.seq`
    )
    .bind(id)
    .all();
  return { ...head.results[0], stops: r.results };
}

// Durée en minutes entre deux heures « HH:MM » (passage minuit géré) ; null si une heure manque.
export function minutesBetween(a, b) {
  const m = (x) => (/^\d{1,2}:\d{2}$/.test(x || '') ? +x.slice(0, x.indexOf(':')) * 60 + +x.slice(-2) : null);
  const x = m(a), y = m(b);
  if (x === null || y === null) return null;
  return (y - x + 1440) % 1440;
}
