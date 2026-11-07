// Pré-rend le texte dans les pages pour que les moteurs de recherche voient le contenu sans exécuter le JS.
// Produit public/index.html (français, mis à jour sur place) et public/en/index.html (anglais, généré).
// Usage : node prerender.mjs   (idempotent ; à relancer après avoir modifié les textes T.fr / T.en)
import fs from 'node:fs';
import vm from 'node:vm';
const dir = new URL('./public/', import.meta.url);
const fFr = new URL('index.html', dir);
let html = fs.readFileSync(fFr, 'utf8');
const m = html.match(/const T = (\{[\s\S]*?\});?\s*\n(?:\s*const fmtDur[^\n]*\n)?\s*let lang/);
if (!m) throw new Error('bloc T introuvable');
const g = (n) => (html.match(new RegExp("const " + n + " = '([^']*)'")) || [])[1] || '';
const T = vm.runInNewContext('(' + m[1] + ')', { PDF_WD: g('PDF_WD'), PDF_WE: g('PDF_WE'), REPO: g('REPO') });

// Remplit le contenu de chaque élément data-i / data-i-html, jusqu'à sa balise fermante (imbrication de même nom gérée).
function fill(src, dict) {
  const re = /<(h1|h2|p|label|span|button|div)\b[^>]*\bdata-i(?:-html)?="([^"]+)"[^>]*>/g;
  let out = '', last = 0, mm;
  while ((mm = re.exec(src))) {
    const [open, tag, key] = mm; const v = dict[key];
    if (typeof v !== 'string') continue;
    const start = mm.index + open.length;
    const tagRe = new RegExp('<(/?)' + tag + '\\b', 'g'); tagRe.lastIndex = start;
    let depth = 1, t, end = -1;
    while ((t = tagRe.exec(src))) { depth += t[1] ? -1 : 1; if (!depth) { end = t.index; break; } }
    if (end < 0) continue;
    out += src.slice(last, start) + v; last = end; re.lastIndex = end;
  }
  return out + src.slice(last);
}

const U = 'https://bus-seychelles.pages.dev/';
const frHtml = fill(html, T.fr);
fs.writeFileSync(fFr, frHtml);

// Version anglaise : mêmes scripts et styles, métadonnées et contenu en anglais, ressources en chemins absolus.
const EN = {
  title: 'Seychelles bus timetable (Mahé, SPTC) — next bus, routes and stops',
  desc: 'Mahé (Seychelles) bus timetable: ask “next bus from Victoria to Beau Vallon” in plain English. SPTC routes, stops and schedules, August 2026. Unofficial, free service.',
  ogTitle: 'Seychelles bus timetable (Mahé, SPTC)',
  ogDesc: 'Next bus, route timetables and stops on Mahé, in one question. Unofficial service, scheduled SPTC times only.',
  twDesc: 'Next bus, routes and stops on Mahé. Unofficial service.',
  ld: 'Scheduled SPTC bus timetables for Mahé (Seychelles), searchable in plain language. Unofficial service, not affiliated with SPTC.',
};
let en = fill(html, T.en);
const sub = (re, to) => { if (!re.test(en)) throw new Error('motif introuvable : ' + re); en = en.replace(re, to); };
sub(/<html lang="fr">/, '<html lang="en">');
sub(/<title>[^<]*<\/title>/, `<title>${EN.title}</title>`);
sub(/(<meta name="description" content=")[^"]*"/, `$1${EN.desc}"`);
sub(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${U}en/">`);
sub(/(<meta property="og:title" content=")[^"]*"/, `$1${EN.ogTitle}"`);
sub(/(<meta property="og:description" content=")[^"]*"/, `$1${EN.ogDesc}"`);
sub(/(<meta property="og:url" content=")[^"]*"/, `$1${U}en/"`);
sub(/<meta property="og:locale" content="fr_FR">/, '<meta property="og:locale" content="en_GB">');
sub(/<meta property="og:locale:alternate" content="en_GB">/, '<meta property="og:locale:alternate" content="fr_FR">');
sub(/(<meta name="twitter:title" content=")[^"]*"/, `$1${EN.ogTitle}"`);
sub(/(<meta name="twitter:description" content=")[^"]*"/, `$1${EN.twDesc}"`);
sub(/("description":")[^"]*"/, `$1${EN.ld}"`);
sub(/("url":")[^"]*"/, `$1${U}en/"`);
sub(/"inLanguage":\["fr","en"\]/, '"inLanguage":"en"');
sub(/href="logo\.svg"/, 'href="/logo.svg"');
sub(/src="logo\.svg"/, 'src="/logo.svg"');
sub(/url\(hero\.svg\)/, 'url(/hero.svg)');
fs.mkdirSync(new URL('en/', dir), { recursive: true });
fs.writeFileSync(new URL('en/index.html', dir), en);
console.log('ok : fr + en');
