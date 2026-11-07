// Serveur MCP public (Streamable HTTP, sans état, réponses JSON) : horaires théoriques des bus SPTC (Mahé, Seychelles).
// Même base D1 que le site. Lecture seule, sans authentification, aucune donnée utilisateur enregistrée.
// Intégration NON OFFICIELLE : non affiliée à la SPTC.
import { seychellesNow, findStops, nextDepartures, lineTimetable, minutesBetween, VALID_FR } from './_lib/query.js';

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type, mcp-protocol-version, mcp-session-id, accept',
};
const INSTRUCTIONS =
  "Horaires des bus SPTC (Mahé, Seychelles), issus des PDF officiels (sptc.sc), théoriques, sans temps réel ni correspondances. Service non officiel, non affilié à la SPTC. " +
  "Utilise chercher_arret pour retrouver le nom exact d'un arrêt, puis prochains_passages ou horaires_ligne. Heure par défaut : heure actuelle des Seychelles (UTC+4).";

const TOOLS = [
  {
    name: 'chercher_arret',
    description: "Cherche des arrêts de bus SPTC dont le nom contient `nom` (ex. 'Beau Vallon'). Renvoie les noms exacts et, si connues, les positions.",
    inputSchema: { type: 'object', properties: { nom: { type: 'string', description: "Nom (partiel) de l'arrêt" } }, required: ['nom'] },
    annotations: { title: 'Chercher un arrêt', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'prochains_passages',
    description:
      "Prochains bus au départ de `depart` (nom partiel), éventuellement vers `arrivee`. Sans arrivée, le terminus de chaque trajet est indiqué. " +
      "`apres` = HH:MM (défaut : maintenant, heure des Seychelles). `jour` = 'semaine' ou 'weekend' (défaut : aujourd'hui).",
    inputSchema: {
      type: 'object',
      properties: {
        depart: { type: 'string', description: 'Arrêt de départ (nom partiel)' },
        arrivee: { type: 'string', description: "Arrêt d'arrivée (nom partiel), optionnel" },
        apres: { type: 'string', description: 'Heure HH:MM (24 h), optionnelle' },
        jour: { type: 'string', enum: ['semaine', 'weekend'], description: 'Type de jour, optionnel' },
        limite: { type: 'integer', minimum: 1, maximum: 20, description: 'Nombre de résultats (défaut 6)' },
      },
      required: ['depart'],
    },
    annotations: { title: 'Prochains bus', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'horaires_ligne',
    description: "Tous les horaires d'une ligne (ex. '20', '22', '24A'), par sens. `jour` = 'semaine' ou 'weekend' (défaut : aujourd'hui).",
    inputSchema: {
      type: 'object',
      properties: {
        ligne: { type: 'string', description: "Numéro de ligne, ex. '20' ou '24A'" },
        jour: { type: 'string', enum: ['semaine', 'weekend'] },
      },
      required: ['ligne'],
    },
    annotations: { title: "Horaires d'une ligne", readOnlyHint: true, openWorldHint: false },
  },
];

const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(ip, arr);
  if (hits.size > 5000) hits.clear();
  return arr.length > 60;
}
const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const dayOf = (j, now) => (j === 'weekend' || j === 'samedi' || j === 'dimanche' ? 'weekend' : j === 'semaine' || j === 'weekday' ? 'weekday' : now.day);
const dayFr = (d) => (d === 'weekend' ? 'week-end' : 'semaine');

async function callTool(db, name, a = {}) {
  const now = seychellesNow();
  if (name === 'chercher_arret') {
    const nom = String(a.nom || '').trim().slice(0, 60);
    if (nom.length < 2) return text('Indiquez au moins 2 caractères.', true);
    const r = await findStops(db, nom);
    if (!r.length) return text(`Aucun arrêt SPTC ne contient « ${nom} ».`);
    return text(r.map((s) => `${s.stop}${s.lat != null && s.quality !== 'inconnu' ? ` (${(+s.lat).toFixed(5)}, ${(+s.lon).toFixed(5)})` : ''}`).join('\n') + `\n\n${VALID_FR}`);
  }
  if (name === 'prochains_passages') {
    const depart = String(a.depart || '').trim().slice(0, 60);
    if (!depart) return text('Paramètre `depart` requis.', true);
    const arrivee = String(a.arrivee || '').trim().slice(0, 60) || null;
    const apres = /^\d{1,2}:\d{2}$/.test(String(a.apres || '')) ? String(a.apres).padStart(5, '0') : now.time;
    const day = dayOf(a.jour, now);
    const limit = Math.max(1, Math.min(Number(a.limite) || 6, 20));
    const rows = await nextDepartures(db, { depart, arrivee, after: apres, day, limit });
    if (!rows.length) {
      const sug = await findStops(db, depart);
      return text(`Aucun passage trouvé (${dayFr(day)}, à partir de ${apres}).` + (sug.length ? ` Arrêts proches du nom saisi : ${sug.slice(0, 8).map((s) => s.stop).join(', ')}.` : ' Arrêt de départ inconnu : utilisez chercher_arret.'));
    }
    const lines = rows.map((r) => {
      const dur = minutesBetween(r.ta, r.tb);
      return `${r.ta}  ligne ${r.route}  ${r.sa}${r.sb ? ` → ${r.sb}${r.term ? ' (terminus)' : ''} à ${r.tb}${dur != null ? ` (${dur} min)` : ''}` : ''}  [${r.title}]`;
    });
    return text(`Prochains bus (${dayFr(day)}, à partir de ${apres}) :\n${lines.join('\n')}\n\n${VALID_FR}`);
  }
  if (name === 'horaires_ligne') {
    const route = String(a.ligne || '').trim().toUpperCase();
    if (!/^[0-9A-Z]{1,4}$/.test(route)) return text('Numéro de ligne invalide (ex. 20, 22, 24A).', true);
    const day = dayOf(a.jour, now);
    const tables = await lineTimetable(db, { route, day });
    if (!tables.length) return text(`Aucun horaire pour la ligne ${route} (${dayFr(day)}).`);
    const out = tables.map((t) => `## ${t.title}\nArrêts : ${t.stops.join(' | ')}\n` + t.rows.map((r) => r.join('  ')).join('\n'));
    return text(`${out.join('\n\n')}\n\n${VALID_FR}`);
  }
  return null;
}

const rpcErr = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function handle(env, m) {
  if (!m || m.jsonrpc !== '2.0' || typeof m.method !== 'string') return rpcErr(m?.id, -32600, 'Invalid Request');
  const isNote = m.id === undefined || m.id === null;
  if (isNote) return null; // notifications (initialized, cancelled…) : rien à répondre
  switch (m.method) {
    case 'initialize': {
      const v = VERSIONS.includes(m.params?.protocolVersion) ? m.params.protocolVersion : VERSIONS[0];
      return { jsonrpc: '2.0', id: m.id, result: { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'sptc-bus', title: 'Bus Seychelles (SPTC, non officiel)', version: '1.0.0' }, instructions: INSTRUCTIONS } };
    }
    case 'ping': return { jsonrpc: '2.0', id: m.id, result: {} };
    case 'tools/list': return { jsonrpc: '2.0', id: m.id, result: { tools: TOOLS } };
    case 'tools/call': {
      try {
        const r = await callTool(env.DB, m.params?.name, m.params?.arguments);
        if (!r) return rpcErr(m.id, -32602, `Unknown tool: ${m.params?.name}`);
        return { jsonrpc: '2.0', id: m.id, result: r };
      } catch (e) {
        return { jsonrpc: '2.0', id: m.id, result: text('Erreur interne, réessayez plus tard.', true) };
      }
    }
    default: return rpcErr(m.id, -32601, `Method not found: ${m.method}`);
  }
}

const reply = (body, status = 200) =>
  new Response(body == null ? null : JSON.stringify(body), { status, headers: { ...CORS, ...(body == null ? {} : { 'content-type': 'application/json; charset=utf-8' }), 'cache-control': 'no-store' } });

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return new Response('Méthode non autorisée : ce serveur MCP accepte POST (Streamable HTTP, sans état).', { status: 405, headers: { ...CORS, allow: 'POST, OPTIONS' } });
  if (limited(request.headers.get('cf-connecting-ip') || 'x')) return reply(rpcErr(null, -32000, 'rate_limit'), 429);
  let raw;
  try { raw = await request.text(); if (raw.length > 20000) return reply(rpcErr(null, -32600, 'Request too large'), 413); } catch { return reply(rpcErr(null, -32700, 'Parse error'), 400); }
  let msg;
  try { msg = JSON.parse(raw); } catch { return reply(rpcErr(null, -32700, 'Parse error'), 400); }
  if (Array.isArray(msg)) {
    if (!msg.length || msg.length > 10) return reply(rpcErr(null, -32600, 'Invalid batch'), 400);
    const res = (await Promise.all(msg.map((m) => handle(env, m)))).filter(Boolean);
    return res.length ? reply(res) : reply(null, 202);
  }
  const res = await handle(env, msg);
  return res ? reply(res) : reply(null, 202);
}
