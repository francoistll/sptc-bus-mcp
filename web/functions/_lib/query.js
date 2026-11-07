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
  return { time: `${hh}:${mm}`, day: dow === 0 || dow === 6 ? 'weekend' : 'weekday' };
}

let stopCache = null;
export async function stopNames(db) {
  if (stopCache) return stopCache;
  const r = await db.prepare("select stop from stop_times where stop != '' group by stop order by count(*) desc").all();
  stopCache = r.results.map((x) => x.stop);
  return stopCache;
}

export async function findStops(db, name) {
  const r = await db
    .prepare(
      `select t.stop, count(*) n, g.lat, g.lon, g.quality
       from stop_times t left join stops_geo g on g.stop = t.stop
       where t.stop like ? escape '\\' group by t.stop order by n desc limit 20`
    )
    .bind(like(name))
    .all();
  return r.results;
}

export async function nextDepartures(db, { depart, arrivee, after, day, limit = 8, last = false }) {
  const args = [like(depart)];
  // Sans arrivée demandée : on affiche le terminus (dernier arrêt du trajet) et son heure.
  let join = 'left join stop_times b on b.trip_id = t.id and b.seq = (select max(x.seq) from stop_times x where x.trip_id = t.id) and b.seq > a.seq';
  if (arrivee) {
    join = "join stop_times b on b.trip_id = t.id and b.stop like ? escape '\\' and b.seq > a.seq";
    args.push(like(arrivee));
  }
  args.push(day, after, Math.max(1, Math.min(limit, 20)));
  const sql = `select s.route, s.title, t.id trip, a.stop sa, a.seq qa, a.time ta, b.stop sb, b.seq qb, b.time tb
    from services s join trips t on t.service_id = s.id
    join stop_times a on a.trip_id = t.id and a.stop like ? escape '\\'
    ${join}
    where s.day_type = ? and a.time >= ? order by a.time ${last ? 'desc' : ''} limit ?`;
  // Ordre des paramètres : depart, [arrivee], day, after, limit
  const r = await db.prepare(sql).bind(...args).all();
  if (!arrivee) r.results.forEach((x) => { if (x.sb) x.term = 1; });
  return last ? r.results.reverse() : r.results;
}

export async function lineTimetable(db, { route, day }) {
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
