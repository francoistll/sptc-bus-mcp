// Interprétation de la question : LLM (Workers AI) en premier, analyse par règles en secours.
const MODEL = '@cf/meta/llama-3.1-8b-instruct';

const clean = (s) => (typeof s === 'string' ? s.trim().slice(0, 60) || null : null);

function sanitize(o) {
  const intent = ['next', 'line', 'stop'].includes(o?.intent) ? o.intent : 'unknown';
  const time = typeof o?.time === 'string' && /^\d{1,2}:\d{2}$/.test(o.time) ? o.time.padStart(5, '0') : null;
  const day = o?.day === 'weekend' || o?.day === 'weekday' ? o.day : null;
  const route = typeof o?.route === 'string' && /^[0-9A-Za-z]{1,4}$/.test(o.route.trim()) ? o.route.trim().toUpperCase() : null;
  return { intent, depart: clean(o?.depart), arrivee: clean(o?.arrivee), time, day, route, query: clean(o?.query) };
}

// Secours sans LLM : « de X à Y », « from X to Y », « ligne 20 », « 16h30 », « week-end ».
export function parseByRules(q) {
  const t = q.trim();
  const out = { intent: 'unknown', depart: null, arrivee: null, time: null, day: null, route: null, query: null };
  if (/week-?end|samedi|dimanche|saturday|sunday/i.test(t)) out.day = 'weekend';
  else if (/semaine|lundi|mardi|mercredi|jeudi|vendredi|weekday|monday|tuesday|wednesday|thursday|friday/i.test(t)) out.day = 'weekday';
  const hm = t.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\b/i);
  if (hm && +hm[1] < 24) out.time = `${hm[1].padStart(2, '0')}:${hm[2] || '00'}`;
  const ft = t.match(/(?:de|depuis|from)\s+(.+?)\s+(?:à|a|au|aux|vers|pour|to|->|→)\s+(.+?)(?:\s+(?:vers|à partir|apres|après|after|around|at|le|la|ce|ce soir|demain)\b|[?.,;]|\s+\d{1,2}\s*[h:]|$)/i);
  if (ft) {
    out.intent = 'next'; out.depart = clean(ft[1]); out.arrivee = clean(ft[2]);
    return out;
  }
  const ln = t.match(/(?:ligne|line|route|bus)\s*n?°?\s*([0-9]{1,2}[A-Za-z]?)/i);
  if (ln) { out.intent = 'line'; out.route = ln[1].toUpperCase(); return out; }
  const fromOnly = t.match(/(?:depuis|de|from|at|à|a)\s+([A-Za-zÀ-ÿ' .-]{3,40}?)(?:[?.,;]|\s+\d|$)/i);
  if (fromOnly) { out.intent = 'next'; out.depart = clean(fromOnly[1]); return out; }
  out.intent = 'stop'; out.query = clean(t);
  return out;
}

export async function parseQuestion(env, question, stops) {
  const rules = parseByRules(question);
  if (!env.AI) return { parsed: rules, via: 'rules' };
  const system = `Tu extrais une requête d'horaires de bus (Mahé, Seychelles) en JSON strict, sans texte autour.
Schéma : {"intent":"next|line|stop|unknown","depart":string|null,"arrivee":string|null,"time":"HH:MM"|null,"day":"weekday|weekend|null","route":string|null,"query":string|null}
- next = prochains bus (depart obligatoire, arrivee si donnée) ; line = horaires d'une ligne (route = numéro, ex "20" ou "24A") ; stop = recherche d'un arrêt (query).
- time = heure demandée en 24 h, null si absente. day = weekend pour samedi/dimanche/week-end, weekday pour semaine, sinon null.
- depart et arrivee : choisis le nom EXACT de cette liste d'arrêts qui correspond le mieux, sinon recopie le mot de l'utilisateur.
Arrêts : ${stops.slice(0, 160).join(' | ')}
Si la question ne concerne pas les bus, renvoie {"intent":"unknown"}. Ne réponds jamais autre chose que le JSON.`;
  try {
    const r = await env.AI.run(MODEL, {
      messages: [{ role: 'system', content: system }, { role: 'user', content: question }],
      max_tokens: 200,
      temperature: 0,
    });
    const text = typeof r === 'string' ? r : r?.response || '';
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('pas de JSON');
    const p = sanitize(JSON.parse(text.slice(a, b + 1)));
    if (p.intent === 'unknown') return { parsed: p, via: 'llm' };
    return { parsed: p, via: 'llm' };
  } catch (e) {
    return { parsed: rules, via: 'rules' }; // quota épuisé, erreur réseau, JSON invalide…
  }
}
