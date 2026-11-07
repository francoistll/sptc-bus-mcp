import { seychellesNow, stopNames, findStops, nextDepartures, lineTimetable, VALID_FR, VALID_EN } from '../_lib/query.js';
import { parseQuestion } from '../_lib/parse.js';

const json = (o, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// Limite simple par isolat (best-effort). Pour une vraie limite, ajouter une règle « Rate limiting » dans le tableau de bord Cloudflare.
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 12;
}

export async function onRequestPost({ request, env }) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (limited(ip)) return json({ ok: false, error: 'rate_limit' }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const question = String(body?.q || '').trim().slice(0, 300);
  if (question.length < 3) return json({ ok: false, error: 'empty' }, 400);

  const db = env.DB;
  const now = seychellesNow();
  const stops = await stopNames(db);
  const { parsed, via } = await parseQuestion(env, question, stops);
  const day = parsed.day || now.day;
  const after = parsed.time || now.time;
  const base = { ok: true, via, parsed, day, after, now: now.time, notice: { fr: VALID_FR, en: VALID_EN } };

  if (parsed.intent === 'next' && parsed.depart) {
    const rows = await nextDepartures(db, { depart: parsed.depart, arrivee: parsed.arrivee, after, day });
    if (!rows.length) {
      const sug = await findStops(db, parsed.depart);
      return json({ ...base, intent: 'next', rows: [], suggestions: sug.map((s) => s.stop) });
    }
    return json({ ...base, intent: 'next', rows });
  }
  if (parsed.intent === 'line' && parsed.route) {
    const tables = await lineTimetable(db, { route: parsed.route, day });
    return json({ ...base, intent: 'line', tables });
  }
  if (parsed.intent === 'stop' && parsed.query) {
    return json({ ...base, intent: 'stop', stops: await findStops(db, parsed.query) });
  }
  return json({ ...base, intent: 'unknown' });
}
