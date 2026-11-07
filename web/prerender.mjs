// Pré-rend le texte français dans index.html pour que les moteurs de recherche voient le contenu sans exécuter le JS.
// Usage : node prerender.mjs   (idempotent ; à relancer après avoir modifié les textes T.fr)
import fs from 'node:fs';
import vm from 'node:vm';
const f = new URL('./public/index.html', import.meta.url);
let html = fs.readFileSync(f, 'utf8');
const m = html.match(/const T = (\{[\s\S]*?\});?\s*\n(?:\s*const fmtDur[^\n]*\n)?\s*let lang/);
if (!m) throw new Error('bloc T introuvable');
const g = (n) => (html.match(new RegExp("const " + n + " = '([^']*)'")) || [])[1] || '';
const T = vm.runInNewContext('(' + m[1] + ')', { PDF_WD: g('PDF_WD'), PDF_WE: g('PDF_WE'), REPO: g('REPO') });
const fr = T.fr;
// <el data-i="k"></el> et <el data-i-html="k"></el> : remplit le contenu (jusqu'à la balise fermante correspondante, sans imbrication de même nom).
html = html.replace(/(<(h1|h2|p|label|span|button|div)\b[^>]*\bdata-i(?:-html)?="([^"]+)"[^>]*>)()(<\/\2>)/g, (all, open, tag, key, _old, close) => {
  const v = fr[key];
  return typeof v === 'string' ? open + v + close : all;
});
fs.writeFileSync(f, html);
console.log('ok');
