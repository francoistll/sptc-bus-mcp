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

// Horaires lus dans /timetable.json (fichier statique du site, compressé par Cloudflare) et interrogés en mémoire :
// plus aucune lecture D1 (quota gratuit), et pas d'aller-retour réseau. D1 ne sert plus qu'aux journaux.
let assets = null; // { fetcher, base } : liaison ASSETS de Pages
export function useAssets(env, url) { if (env && env.ASSETS) assets = { fetcher: env.ASSETS, base: url }; }

let loading = null;
function load() {
  if (loading) return loading;
  loading = (async () => {
    let raw = globalThis.__TIMETABLE; // tests locaux
    if (!raw) {
      if (!assets) throw new Error('timetable: liaison ASSETS absente');
      const r = await assets.fetcher.fetch(new Request(new URL('/timetable.json', assets.base)));
      if (!r.ok) throw new Error('timetable: HTTP ' + r.status);
      raw = await r.json();
    }
    const svc = new Map(raw.sv.map((x) => [x[0], { id: x[0], day: x[1], route: x[2], title: x[3] }]));
    const trip = new Map(), byService = new Map();
    for (const [id, sid, no] of raw.tr) {
      const t = { id, svc: svc.get(sid), no };
      trip.set(id, t);
      if (!byService.has(sid)) byService.set(sid, []);
      byService.get(sid).push(t);
    }
    for (const l of byService.values()) l.sort((u, v) => u.no - v.no || u.id - v.id);
    const byTrip = new Map(), byStop = new Map(), count = new Map();
    for (const [t, seq, stop, time] of raw.st) {
      const r = { t, seq, stop, time };
      if (!byTrip.has(t)) byTrip.set(t, []);
      byTrip.get(t).push(r);
      if (stop === '') continue;
      if (!byStop.has(stop)) byStop.set(stop, []);
      byStop.get(stop).push(r);
      count.set(stop, (count.get(stop) || 0) + 1);
    }
    for (const l of byTrip.values()) l.sort((u, v) => u.seq - v.seq);
    const stopsOf = new Map();
    for (const [sid, seq, stop] of raw.ss) {
      if (!stopsOf.has(sid)) stopsOf.set(sid, []);
      stopsOf.get(sid).push({ seq, stop });
    }
    for (const l of stopsOf.values()) l.sort((u, v) => u.seq - v.seq);
    const geo = new Map(raw.geo.map((x) => [x[0], { lat: x[1], lon: x[2], quality: x[3] }]));
    const list = [...count].map(([stop, n]) => ({ stop, n })).sort((u, v) => v.n - u.n);
    return { svc, trip, byService, byTrip, byStop, stopsOf, geo, list, services: [...svc.values()].sort((u, v) => u.id - v.id) };
  })();
  loading.catch(() => { loading = null; });
  return loading;
}

// Seychelles : liste d'arrêts avec leur nombre de passages, du plus desservi au moins desservi.
export async function stopNames() { return (await load()).list.map((x) => x.stop); }

// Noms exacts d'arrêts contenant `name` (comme LIKE '%name%', insensible à la casse).
function resolve(tt, name, max = 60) {
  const q = String(name).toLowerCase();
  return tt.list.filter((x) => x.stop.toLowerCase().includes(q)).slice(0, max);
}

export async function findStops(_db, name) {
  const tt = await load();
  return resolve(tt, name).slice(0, 20).map((x) => {
    const g = tt.geo.get(x.stop);
    return { stop: x.stop, n: x.n, lat: g?.lat ?? null, lon: g?.lon ?? null, quality: g?.quality ?? null };
  });
}

export async function routesServing(_db, name) {
  const tt = await load();
  const out = new Set();
  for (const { stop } of resolve(tt, name)) for (const r of tt.byStop.get(stop)) out.add(tt.trip.get(r.t).svc.route);
  return [...out].sort();
}

// Arrêts positionnés (api/stops.js).
export async function geoStops() {
  const tt = await load();
  return [...tt.geo].filter(([, g]) => g.lat !== null && ['arret_osm', 'lieu_approx'].includes(g.quality)).map(([stop, g]) => ({ stop, lat: g.lat, lon: g.lon, quality: g.quality })).sort((u, v) => (u.stop < v.stop ? -1 : u.stop > v.stop ? 1 : 0));
}

export async function nextDepartures(_db, { depart, arrivee, after, day, limit = 8, last = false }) {
  const tt = await load();
  const dep = resolve(tt, depart).map((x) => x.stop);
  const arr = arrivee ? new Set(resolve(tt, arrivee).map((x) => x.stop)) : null;
  if (!dep.length || (arr && !arr.size)) return [];
  const rows = [];
  for (const sa of dep) for (const a of tt.byStop.get(sa)) {
    const t = tt.trip.get(a.t);
    if (t.svc.day !== day || !(a.time >= after)) continue;
    const tr = tt.byTrip.get(a.t);
    const mk = (b) => ({ route: t.svc.route, title: t.svc.title, trip: t.id, sa: a.stop, qa: a.seq, ta: a.time, sb: b ? b.stop : null, qb: b ? b.seq : null, tb: b ? b.time : null });
    if (arr) { for (const b of tr) if (b.seq > a.seq && arr.has(b.stop)) rows.push(mk(b)); }
    else { const b = tr[tr.length - 1]; rows.push(mk(b.seq > a.seq ? b : null)); }
  }
  rows.sort((u, v) => (u.ta < v.ta ? -1 : u.ta > v.ta ? 1 : 0) * (last ? -1 : 1));
  const out = rows.slice(0, Math.max(1, Math.min(limit, 20)));
  if (!arr) out.forEach((x) => { if (x.sb) x.term = 1; });
  return last ? out.reverse() : out;
}

const toMin = (x) => (/^\d{1,2}:\d{2}$/.test(x || '') ? +x.slice(0, x.indexOf(':')) * 60 + +x.slice(-2) : null);

// Une correspondance : bus 1 de `depart` jusqu'à un arrêt commun X, puis bus 2 de X jusqu'à `arrivee`
// (plus de 3 min de battement). Un résultat par 2e bus.
export async function transferDepartures(_db, { depart, arrivee, after, day, limit = 5 }) {
  const tt = await load();
  const dep = new Set(resolve(tt, depart).map((x) => x.stop));
  const arr = new Set(resolve(tt, arrivee).map((x) => x.stop));
  if (!dep.size || !arr.size) return [];
  const { trip, byTrip, byStop } = tt;
  // Bus 2 possibles : trajets du bon type de jour qui atteignent l'arrivée.
  const dByTrip = new Map();
  for (const st of arr) for (const d of byStop.get(st) || []) {
    if (trip.get(d.t).svc.day !== day) continue;
    if (!dByTrip.has(d.t)) dByTrip.set(d.t, []);
    dByTrip.get(d.t).push(d);
  }
  // Bus 1 : à chaque arrêt X atteint après le départ (hors arrivée), le bus pris et l'heure d'arrivée en X.
  const bByStop = new Map();
  for (const sa of dep) for (const a of byStop.get(sa) || []) {
    if (!(a.time >= after) || trip.get(a.t).svc.day !== day) continue;
    for (const b of byTrip.get(a.t)) {
      if (b.seq <= a.seq || b.stop === '' || arr.has(b.stop) || toMin(b.time) === null) continue;
      if (!bByStop.has(b.stop)) bByStop.set(b.stop, []);
      bByStop.get(b.stop).push({ a, b });
    }
  }
  const rows = [];
  for (const [t2, ds] of dByTrip) {
    for (const c of byTrip.get(t2)) {
      const bl = bByStop.get(c.stop);
      const cm = toMin(c.time);
      if (!bl || cm === null) continue;
      for (const { a, b } of bl) {
        if (a.t === t2 || cm <= toMin(b.time) + 3) continue;
        for (const d of ds) if (d.seq > c.seq)
          rows.push({ r1: trip.get(a.t).svc.route, trip1: a.t, sa: a.stop, ta: a.time, sx: b.stop, tx1: b.time, r2: trip.get(t2).svc.route, trip2: t2, tx2: c.time, sb: d.stop, tb: d.time });
      }
    }
  }
  rows.sort((u, v) => (u.ta < v.ta ? -1 : u.ta > v.ta ? 1 : u.tb < v.tb ? -1 : u.tb > v.tb ? 1 : 0));
  const r = { results: rows.slice(0, 600) };
  const best = new Map();
  for (const x of r.results) {
    const k = x.trip2; // un seul résultat par 2e bus : le dernier bus 1 qui permet encore la correspondance
    if (!best.has(k) || x.ta > best.get(k).ta || (x.ta === best.get(k).ta && x.tb < best.get(k).tb)) best.set(k, x);
  }
  const out = [...best.values()].sort((u, v) => (u.ta < v.ta ? -1 : u.ta > v.ta ? 1 : 0)).slice(0, limit);
  out.forEach((x) => { x.dur = minutesBetween(x.ta, x.tb); });
  return out;
}

export async function lineTimetable(_db, { route, day }) {
  const tt = await load();
  return tt.services.filter((s) => s.day === day && s.route === route).map((s) => {
    const stops = (tt.stopsOf.get(s.id) || []).map((x) => x.stop);
    const rows = (tt.byService.get(s.id) || []).map((t) => {
      const tm = {};
      for (const r of tt.byTrip.get(t.id) || []) tm[r.seq] = r.time;
      return stops.map((_, i) => tm[i] || '–');
    });
    return { title: s.title, stops, rows };
  });
}

// Détail d'un trajet : tous les arrêts du service, avec l'heure de passage de ce trajet (null si non indiquée).
export async function tripDetail(_db, id) {
  const tt = await load();
  const t = tt.trip.get(id);
  if (!t) return null;
  const times = new Map((tt.byTrip.get(id) || []).map((r) => [r.seq, r.time]));
  const stops = (tt.stopsOf.get(t.svc.id) || []).map((x) => {
    const g = tt.geo.get(x.stop);
    return { seq: x.seq, stop: x.stop, time: times.get(x.seq) ?? null, lat: g?.lat ?? null, lon: g?.lon ?? null };
  });
  return { route: t.svc.route, title: t.svc.title, day_type: t.svc.day, stops };
}

// Durée en minutes entre deux heures « HH:MM » (passage minuit géré) ; null si une heure manque.
export function minutesBetween(a, b) {
  const m = (x) => (/^\d{1,2}:\d{2}$/.test(x || '') ? +x.slice(0, x.indexOf(':')) * 60 + +x.slice(-2) : null);
  const x = m(a), y = m(b);
  if (x === null || y === null) return null;
  return (y - x + 1440) % 1440;
}
