// GET /api/stops : arrêts dont la position est connue (peu nombreux). Le navigateur calcule lui-même l'arrêt le plus proche :
// la position de l'utilisateur ne quitte jamais son appareil. Données statiques, mises en cache une journée.
export async function onRequestGet({ env }) {
  const r = await env.DB.prepare(
    "select stop, lat, lon, quality from stops_geo where lat is not null and quality in ('arret_osm','lieu_approx') order by stop"
  ).all();
  return new Response(JSON.stringify({ ok: true, stops: r.results }), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' },
  });
}
