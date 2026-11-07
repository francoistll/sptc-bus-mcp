import { seychellesNow, stopNames, findStops, nextDepartures, lineTimetable, minutesBetween, VALID_FR, VALID_EN } from '../_lib/query.js';
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

async function handle({ request, env }, emit = () => {}) {
  const ip = request.headers.get('cf-connecting-ip') || 'x';
  if (limited(ip)) return json({ ok: false, error: 'rate_limit' }, 429);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'bad_request' }, 400); }
  const question = String(body?.q || '').trim().slice(0, 300);
  if (question.length < 3) return json({ ok: false, error: 'empty' }, 400);

  const db = env.DB;
  const now = seychellesNow();
  const ms = {};
  let t0 = Date.now();
  const lap = (k) => { const t = Date.now(); ms[k] = t - t0; t0 = t; };
  emit('stops');
  const stops = await stopNames(db);
  lap('stops');
  emit('parse');
  const { parsed, via } = await parseQuestion(env, question, stops);
  lap('parse');
  emit('search');
  const tomorrowDay = seychellesNow(new Date(Date.now() + 86400000)).day;
  const day = parsed.day || (parsed.tomorrow ? tomorrowDay : now.day);
  const last = !!parsed.last && !parsed.time;
  const first = !last && !!parsed.first && !parsed.time;
  const after = last || first ? '00:00' : parsed.time || (parsed.tomorrow ? '00:00' : now.time);
  const base = { ok: true, via, ms, parsed, day, after, last, first, tomorrow: !!parsed.tomorrow, now: now.time, notice: { fr: VALID_FR, en: VALID_EN } };

  if (parsed.intent === 'next' && !parsed.depart && parsed.arrivee) {
    const routes = (await db.prepare(`select distinct s.route from services s join trips t on t.service_id = s.id join stop_times a on a.trip_id = t.id and a.stop like ? escape '\\' order by s.route`).bind('%' + String(parsed.arrivee).replace(/[\\%_]/g, (c) => '\\' + c) + '%').all()).results.map((x) => x.route);
    return json({ ...base, intent: 'need_from', arrivee: parsed.arrivee, routes });
  }
  if (parsed.intent === 'next' && parsed.depart) {
    const rows = await nextDepartures(db, { depart: parsed.depart, arrivee: parsed.arrivee, after, day, last, limit: first ? 5 : 8 });
    if (!rows.length) {
      // Pourquoi rien ? arrêt de départ inconnu, arrêt d'arrivée inconnu, ou pas de bus direct / plus de bus.
      const sugD = await findStops(db, parsed.depart);
      const sugA = parsed.arrivee ? await findStops(db, parsed.arrivee) : [];
      let reason = 'none_after';
      if (!sugD.length) reason = 'no_depart_stop';
      else if (parsed.arrivee && !sugA.length) reason = 'no_arrivee_stop';
      else if (parsed.arrivee) {
        const any = await nextDepartures(db, { depart: parsed.depart, arrivee: parsed.arrivee, after: '00:00', day, limit: 1 });
        reason = any.length ? 'none_after' : 'no_direct';
      }
      const sug = reason === 'no_arrivee_stop' ? sugA : sugD;
      return json({ ...base, intent: 'next', rows: [], reason, suggestions: sug.map((x) => x.stop) });
    }
    rows.forEach((r) => { r.dur = minutesBetween(r.ta, r.tb); });
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

// Journal minimal (pas d'IP) pour le contrôle quotidien des réponses ; texte expurgé (e-mails, longs nombres).
const redact = (q) => q.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '[email]').replace(/\d[\d\s().+-]{6,}\d/g, '[nombre]').slice(0, 300);

export async function onRequestPost(ctx) {
  let question = '';
  try { question = String((await ctx.request.clone().json())?.q || ''); } catch {}
  // Mode flux (en-tête x-stream: 1) : une ligne JSON par étape en cours, puis {"done": réponse}.
  if (ctx.request.headers.get('x-stream') === '1') {
    const { readable, writable } = new TransformStream();
    const w = writable.getWriter();
    const enc = new TextEncoder();
    const send = (o) => w.write(enc.encode(JSON.stringify(o) + '\n')).catch(() => {});
    ctx.waitUntil((async () => {
      try {
        const res = await handleLogged(ctx, question, (step) => send({ step }));
        await send({ status: res.status, done: await res.json() });
      } catch { await send({ status: 500, done: { ok: false, error: 'server' } }); }
      await w.close().catch(() => {});
    })());
    return new Response(readable, { headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' } });
  }
  return handleLogged(ctx, question);
}

async function handleLogged(ctx, question, emit) {
  const t0 = Date.now();
  const res = await handle(ctx, emit);
  res.headers.set('server-timing', `total;dur=${Date.now() - t0}`);
  if (res.status === 200 && ctx.env.DB) {
    try {
      const j = await res.clone().json();
      const n = (j.rows || j.stops || j.tables || []).length;
      const p = j.parsed || {};
      ctx.waitUntil(
        ctx.env.DB.prepare('insert into query_log values (?,?,?,?,?,?,?,?,?,?)')
          .bind(new Date().toISOString(), redact(question), j.via || null, j.intent || null, n, p.depart || null, p.arrivee || null, p.route || null, p.time || null, p.day || null)
          .run()
          .then(() => (Math.random() < 0.02 ? ctx.env.DB.prepare("delete from query_log where ts < datetime('now','-60 days')").run() : null))
          .catch(() => {})
      );
    } catch {}
  }
  return res;
}
