import { tripDetail, useAssets } from '../_lib/query.js';

// GET /api/trip?id=123 : arrêts et heures d'un trajet précis (données statiques, mises en cache une heure).
export async function onRequestGet({ request, env }) {
  useAssets(env, request.url);
  const id = Number(new URL(request.url).searchParams.get('id'));
  const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' };
  if (!Number.isInteger(id) || id < 1) return new Response('{"ok":false,"error":"bad_request"}', { status: 400, headers });
  const d = await tripDetail(env.DB, id);
  if (!d) return new Response('{"ok":false,"error":"not_found"}', { status: 404, headers });
  return new Response(JSON.stringify({ ok: true, ...d }), { headers });
}
