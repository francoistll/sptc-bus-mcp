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

export async function nextDepartures(db, { depart, arrivee, after, day, limit = 8 }) {
  const args = [like(depart)];
  let join = 'left join stop_times b on 0';
  if (arrivee) {
    join = "join stop_times b on b.trip_id = t.id and b.stop like ? escape '\\' and b.seq > a.seq";
    args.push(like(arrivee));
  }
  args.push(day, after, Math.max(1, Math.min(limit, 20)));
  const sql = `select s.route, s.title, a.stop sa, a.time ta, b.stop sb, b.time tb
    from services s join trips t on t.service_id = s.id
    join stop_times a on a.trip_id = t.id and a.stop like ? escape '\\'
    ${join}
    where s.day_type = ? and a.time >= ? order by a.time limit ?`;
  // Ordre des paramètres : depart, [arrivee], day, after, limit
  const r = await db.prepare(sql).bind(...args).all();
  return r.results;
}

export async function lineTimetable(db, { route, day }) {
  const services = (
    await db.prepare('select id, title from services where day_type = ? and route = ? order by id').bind(day, route).all()
  ).results;
  const out = [];
  for (const s of services) {
    const stops = (await db.prepare('select stop from service_stops where service_id = ? order by seq').bind(s.id).all()).results.map((x) => x.stop);
    const trips = (await db.prepare('select id from trips where service_id = ? order by trip_no').bind(s.id).all()).results;
    const rows = [];
    for (const t of trips) {
      const tm = {};
      for (const r of (await db.prepare('select seq, time from stop_times where trip_id = ?').bind(t.id).all()).results) tm[r.seq] = r.time;
      rows.push(stops.map((_, i) => tm[i] || '–'));
    }
    out.push({ title: s.title, stops, rows });
  }
  return out;
}
