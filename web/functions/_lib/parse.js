// Interprétation de la question : LLM (Workers AI) en premier, analyse par règles en secours.
// Le LLM (8 B) invente facilement un jour, une heure ou une ligne : tout ce qu'il renvoie est revérifié contre le texte de la question.
const MODEL = '@cf/meta/llama-3.1-8b-instruct-fp8';

const clean = (s) => (typeof s === 'string' ? s.trim().slice(0, 60) || null : null);
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const DAY_WORDS = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|week-?end|weekday|semaine';
const NOISE_TAIL = new RegExp(
  '\\s+(?:(?:on|le|ce|this|next|sur)\\s+)?(?:' + DAY_WORDS + ')\\b.*$|' +
    '\\s+(?:en bus|by bus|please|svp|s.il vous pla[iî]t|tomorrow|demain|today|aujourd.?hui|tonight|ce soir|ce matin|cet apr[eè]s-midi|this (?:morning|evening|afternoon)|in the (?:morning|evening|afternoon)|le matin|le soir|maintenant|now|beach|plage|village|bus stop|stop)\\b.*$',
  'i'
);
const tidy = (s) => clean(String(s || '').replace(NOISE_TAIL, '').replace(/^(?:the|le|la|les|l'|to|au|aux|à|a)\s+/i, '').replace(/[?.!,;]+$/, ''));

// Heure explicite (« 16h », « 16:30 », « 5pm », « 8:30 am ») ou approximative (matin, soir…) → « HH:MM ».
export function parseTime(t) {
  const m = t.match(/\b(\d{1,2})\s*(?:h|:)\s*(\d{2})?\s*(am|pm)?\b/i) || t.match(/\b(\d{1,2})()\s*(am|pm)\b/i);
  if (m) {
    let h = +m[1];
    const mi = m[2] || '00', ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12;
    if (ap === 'am' && h === 12) h = 0;
    if (h < 24) return `${String(h).padStart(2, '0')}:${mi}`;
  }
  if (/\b(matin|morning)\b/i.test(t)) return '05:00';
  if (/\b(apr[eè]s-midi|afternoon)\b/i.test(t)) return '12:00';
  if (/\b(soir|evening|tonight)\b/i.test(t)) return '17:00';
  return null;
}

// Noms d'arrêts connus cités dans le texte, dans l'ordre d'apparition (le plus long d'abord, sans chevauchement).
export function stopsInText(q, stops) {
  const text = ' ' + norm(q) + ' ';
  const cands = new Map();
  for (const s of stops) {
    const n = norm(s);
    if (n.length < 4) continue;
    cands.set(n, s);
    const short = n.replace(/ (depot|terminal|clinic|church|school|beach|bus stop)$/, ''); // « Baie Lazare Depot » ↔ « Baie Lazare »
    if (short.length >= 4 && !cands.has(short)) cands.set(short, s);
  }
  const found = [];
  const taken = [];
  for (const [n, s] of [...cands].sort((a, b) => b[0].length - a[0].length)) {
    const i = text.indexOf(' ' + n + ' ');
    if (i < 0) continue;
    const j = i + n.length + 1;
    if (taken.some(([a, b]) => i < b && j > a)) continue;
    taken.push([i, j]);
    found.push({ i, stop: s, short: n });
  }
  return found.sort((a, b) => a.i - b.i);
}

function sanitize(o) {
  const intent = ['next', 'line', 'stop'].includes(o?.intent) ? o.intent : 'unknown';
  const time = typeof o?.time === 'string' && /^\d{1,2}:\d{2}$/.test(o.time) ? o.time.padStart(5, '0') : null;
  const day = o?.day === 'weekend' || o?.day === 'weekday' ? o.day : null;
  const route = typeof o?.route === 'string' && /^[0-9A-Za-z]{1,4}$/.test(o.route.trim()) ? o.route.trim().toUpperCase() : null;
  const b = (v) => v === true || v === 'true';
  // « à 17h » n'est pas un arrêt : une heure reçue comme lieu est ignorée.
  const place = (v) => { const c = clean(v); return c && !/^\d{1,2}\s*(?:h|:|am|pm)\s*\d{0,2}\s*(?:am|pm)?$/i.test(c) ? c : null; };
  return { intent, depart: place(o?.depart), arrivee: place(o?.arrivee), time, day, route, query: clean(o?.query), last: b(o?.last), first: b(o?.first) };
}

// Secours sans LLM : noms d'arrêts connus, « de X à Y », « from X to Y », « ligne 20 », heures, jours.
export function parseByRules(q, stops = []) {
  const t = q.trim();
  const out = {
    intent: 'unknown', depart: null, arrivee: null, time: parseTime(t), day: null, route: null, query: null,
    last: /\b(derniers?|dernières?|last|final)\b/i.test(t), first: /\b(premiers?|premières?|first|earliest)\b/i.test(t),
    tomorrow: /\b(tomorrow|demain)\b/i.test(t),
  };
  if (/week-?end|samedi|dimanche|saturday|sunday/i.test(t)) out.day = 'weekend';
  else if (/semaine|lundi|mardi|mercredi|jeudi|vendredi|weekday|monday|tuesday|wednesday|thursday|friday/i.test(t)) out.day = 'weekday';

  const ln = t.match(/(?:ligne|line|route|bus|numéro|number)\s*n?°?\s*([0-9]{1,2}[A-Za-z]?)\b/i);
  const found = stops.length ? stopsInText(t, stops) : [];
  const fromWord = t.search(/(?<![\wÀ-ÿ])(?:from|depuis|de|d')\s*/i);
  const toWord = t.search(/(?<![\wÀ-ÿ])(?:to|vers|pour|jusqu.?à|au|aux|à)\s+/i);

  if (ln && found.length < 2) { out.intent = 'line'; out.route = ln[1].toUpperCase(); return out; }

  if (found.length >= 2) {
    let [a, b] = found;
    if (toWord >= 0 && fromWord > toWord && /(?<![\wÀ-ÿ])to\s/i.test(t)) [a, b] = [b, a]; // « to Victoria from Beau Vallon »
    out.intent = 'next'; out.depart = a.stop; out.arrivee = b.stop;
    return out;
  }
  const ft = t.match(/(?<![\wÀ-ÿ])(?:de|depuis|from)\s+(.+?)\s+(?:à|a|au|aux|vers|pour|to|->|→)\s+(.+?)(?:\s+(?:vers|à partir|apres|après|after|around|at|le|la|ce|ce soir|demain|aujourd.?hui|today|tomorrow|maintenant|now)\b|[?.,;]|\s+\d{1,2}\s*[h:]|$)/i);
  if (ft) {
    out.intent = 'next';
    out.depart = found[0]?.stop || tidy(ft[1]);
    out.arrivee = found[1]?.stop || tidy(ft[2]);
    return out;
  }
  if (found.length === 1) {
    const f = found[0];
    const idx = Math.max(0, t.toLowerCase().indexOf(f.short.split(' ')[0]));
    const before = t.slice(0, idx);
    if (/\b(?:stops?|arr[êe]ts?)\b/i.test(t) && !/\b(?:from|depuis)\b/i.test(before)) { out.intent = 'stop'; out.query = f.stop; return out; }
    out.intent = 'next';
    const toAny = /(?<![\wÀ-ÿ])(?:to|vers|pour|jusqu.?à|à|au|aux|go|aller|for)(?![\wÀ-ÿ])/i.test(before);
    const fromExplicit = /(?<![\wÀ-ÿ])(?:from|depuis|at|near|proche)\s+(?:the\s+|la\s+|le\s+)?$/i.test(before) || (/(?<![\wÀ-ÿ])de\s+(?:la\s+|le\s+)?$/i.test(before) && !toAny);
    if (toAny && !fromExplicit) {
      out.arrivee = f.stop;
    } else {
      out.depart = f.stop;
      // « bus Victoria to Au Cap » : destination inconnue après le départ.
      const m = t.slice(idx + f.short.length).match(/(?<![\wÀ-ÿ])(?:to|vers|pour|jusqu.?à|à|au|aux)\s+(.+?)(?:\s+(?:at|à|after|around|this|ce|tomorrow|demain|tonight|on|le)\b|[?.,;]|\s+\d|$)/i);
      if (m) out.arrivee = tidy(m[1]);
    }
    return out;
  }
  const fromOnly = t.match(/(?<![\wÀ-ÿ])(?:depuis|de|from|at|à)\s+([A-Za-zÀ-ÿ' .-]{3,40}?)(?:[?.,;]|\s+\d|$)/i);
  if (fromOnly) { out.intent = 'next'; out.depart = tidy(fromOnly[1]); return out; }
  if (t.split(/\s+/).length <= 3) {
    out.intent = 'stop';
    out.query = tidy(t.replace(/^(?:l'|un |le |les )?(?:arr[êe]ts?|stops?)\s+(?:de |du |d'|of )?/i, ''));
  }
  return out;
}

const SYSTEM = (stops) => `You turn a bus-timetable question (island of Mahé, Seychelles; French or English) into ONE JSON object, nothing else.
Fields: {"intent":"next|line|stop|unknown","depart":string|null,"arrivee":string|null,"time":"HH:MM"|null,"day":"weekday|weekend"|null,"route":string|null,"query":string|null,"last":boolean,"first":boolean}
Rules:
- intent "next": the user wants buses between places (depart = where they start, arrivee = where they go). Use it for almost every trip question.
- intent "line": ONLY if the user themself wrote a route number/letter ("route 20", "ligne 24A", "bus 22"). Then route = that number. NEVER invent a route; otherwise route = null.
- intent "stop": the user looks for a stop or asks which bus serves a place (query = the place).
- intent "unknown": the question is not about buses.
- depart/arrivee: copy the exact name from the stop list below that matches best, else the user's own words without articles ("the airport" -> "Airport").
- time: only if the user wrote a clock time (24 h format), else null. day: only if the user wrote a weekday / weekend word, else null.
- last = true only for "last/final bus"; first = true only for "first bus".
Examples:
Q: how do I get from the airport to town -> {"intent":"next","depart":"Airport","arrivee":"Victoria","time":null,"day":null,"route":null,"query":null,"last":false,"first":false}
Q: dernier bus pour Cascade depuis Victoria -> {"intent":"next","depart":"Victoria","arrivee":"Cascade","time":null,"day":null,"route":null,"query":null,"last":true,"first":false}
Q: bus from Takamaka at 5pm on saturday -> {"intent":"next","depart":"Takamaka","arrivee":null,"time":"17:00","day":"weekend","route":null,"query":null,"last":false,"first":false}
Q: horaires ligne 31 -> {"intent":"line","depart":null,"arrivee":null,"time":null,"day":null,"route":"31","query":null,"last":false,"first":false}
Q: which bus goes to Glacis -> {"intent":"stop","depart":null,"arrivee":null,"time":null,"day":null,"route":null,"query":"Glacis","last":false,"first":false}
Q: what is the weather -> {"intent":"unknown","depart":null,"arrivee":null,"time":null,"day":null,"route":null,"query":null,"last":false,"first":false}
Stop list: ${stops.slice(0, 160).join(' | ')}`;

export async function parseQuestion(env, question, stops) {
  const rules = parseByRules(question, stops);
  const isTimeWord = (v) => typeof v === 'string' && /^\d{1,2}\s*(?:h|:|am|pm)\s*\d{0,2}\s*(?:am|pm)?$/i.test(v.trim());
  if (isTimeWord(rules.arrivee)) rules.arrivee = null;
  if (isTimeWord(rules.depart)) rules.depart = null;
  const finish = (p, via, why) => {
    // Extras déduits du texte seul, jamais du LLM : demain, heure approximative.
    p.tomorrow = rules.tomorrow;
    if (!p.time && !p.last) p.time = rules.time;
    return { parsed: p, via, why };
  };
  // Chemin rapide (évite ~3 s d'appel au LLM) : numéro de ligne explicite, ou deux arrêts connus cités dans le texte.
  const explicitLine = rules.intent === 'line' && /(?:ligne|line|route)\s*n?°?\s*\d/i.test(question);
  const twoStops = rules.intent === 'next' && rules.depart && rules.arrivee && stopsInText(question, stops).length >= 2;
  if (explicitLine || twoStops) return finish(rules, 'fast');
  if (!env.AI) return finish(rules, 'rules', 'no_ai_binding');
  try {
    const r = await env.AI.run(MODEL, {
      messages: [{ role: 'system', content: SYSTEM(stops) }, { role: 'user', content: question }],
      max_tokens: 200,
      temperature: 0,
    });
    const text = typeof r === 'string' ? r : r?.response || '';
    const a = text.indexOf('{'), b = text.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('pas de JSON');
    const p = sanitize(JSON.parse(text.slice(a, b + 1)));
    // Garde-fous : le LLM invente parfois un jour, une heure ou une ligne que la question ne contient pas.
    p.day = rules.day;                                          // jour : seulement s'il est écrit
    p.time = rules.time;                                        // heure : seulement lue dans le texte (règles)
    p.last = p.last && rules.last;
    p.first = p.first && rules.first;
    if (p.intent === 'next') p.route = null;
    if (p.intent === 'line' && !new RegExp('(^|[^0-9A-Za-z])' + (p.route || '@@') + '([^0-9A-Za-z]|$)', 'i').test(question)) {
      // Ligne inventée : si des arrêts sont donnés, c'est un trajet.
      if (p.depart || p.arrivee) { p.intent = 'next'; p.route = null; } else p.intent = 'unknown';
    }
    // Les arrêts cités dans le texte priment sur ceux du LLM quand les règles en ont trouvé deux.
    if (rules.intent === 'next' && rules.depart && rules.arrivee && stopsInText(question, stops).length >= 2) {
      p.intent = 'next'; p.depart = rules.depart; p.arrivee = rules.arrivee;
    }
    // Le LLM a compris « trajet » mais oublié les arrêts que les règles ont trouvés dans le texte.
    if (p.intent === 'next') { p.depart = p.depart || rules.depart; p.arrivee = p.arrivee || rules.arrivee; }
    if (p.intent === 'next' && !p.depart && !p.arrivee && rules.intent !== 'unknown') return finish(rules, 'rules', 'llm_no_stops');
    if (p.intent === 'unknown' && rules.intent !== 'unknown') return finish(rules, 'rules', 'llm_unknown');
    return finish(p, 'llm');
  } catch (e) {
    return finish(rules, 'rules', 'err:' + String(e && e.message).slice(0, 160)); // quota épuisé, erreur réseau, JSON invalide…
  }
}
