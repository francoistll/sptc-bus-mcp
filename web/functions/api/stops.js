import { geoStops, useAssets } from '../_lib/query.js';

// GET /api/stops : arrêts dont la position est connue (peu nombreux). Le navigateur calcule lui-même l'arrêt le plus proche :
// la position de l'utilisateur ne quitte jamais son appareil. Données statiques, mises en cache une journée.
export async function onRequestGet({ request, env }) {
  useAssets(env, request.url);
  return new Response(JSON.stringify({ ok: true, stops: await geoStops() }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
