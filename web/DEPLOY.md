# Déployer le site « Bus Seychelles » sur Cloudflare (gratuit)

Le site est une page statique (`public/`) + une fonction (`functions/api/ask.js`) + une base D1 (`schema.sql`)
+ le LLM gratuit Workers AI. Tout tient dans un compte Cloudflare gratuit, sans nom de domaine
(URL `https://bus-seychelles.pages.dev`). Les quotas gratuits changent : vérifiez-les dans le tableau de bord.

Prérequis : un compte Cloudflare et Node.js (≥ 18) sur votre ordinateur.

```bash
cd web
npx wrangler login                          # ouvre le navigateur : vous vous connectez vous-même

# 1. Base de données
npx wrangler d1 create sptc-bus             # affiche un database_id → le coller dans wrangler.toml
npx wrangler d1 execute sptc-bus --remote --file=schema.sql   # ~13 500 instructions, ~750 Ko

# 2. Projet Pages + déploiement
npx wrangler pages project create bus-seychelles --production-branch=main
npx wrangler pages deploy public --project-name=bus-seychelles
```

Les liaisons `DB` (D1) et `AI` (Workers AI) viennent de `wrangler.toml`. Si elles n'apparaissent pas :
tableau de bord → Workers & Pages → bus-seychelles → Settings → Bindings → ajouter **D1 database** (`DB` → `sptc-bus`)
et **Workers AI** (`AI`), puis redéployer.

## Vérifier

```bash
curl -s -X POST https://bus-seychelles.pages.dev/api/ask -H 'content-type: application/json' \
  -d '{"q":"prochain bus de Victoria à Beau Vallon après 16h"}'
```

Attendu : du JSON avec `"intent":"next"` et des lignes (22, 20, 22E, 24A…).

## Bon à savoir

* **Protection anti-abus** : la fonction limite à 12 requêtes/minute/IP (par instance) et à 300 caractères.
  Pour une vraie limite : tableau de bord → Security → WAF → *Rate limiting rules*.
* **Si le quota de l'IA est épuisé**, la fonction bascule sur une analyse par règles (`via: "rules"`) : le site
  continue de répondre aux formulations simples (« de X à Y », « ligne 20 »).
* **Mettre à jour les horaires** : relancer `pipeline/run_all.sh`, régénérer `web/schema.sql`
  (voir `pipeline/make_schema.py`), puis `wrangler d1 execute sptc-bus --remote --file=schema.sql` après avoir vidé les tables.
* **Lien « Code source »** : renseigner `REPO` en haut du script de `public/index.html`.
* **Aucune clé API** n'est nécessaire : Workers AI est lié au projet par `wrangler.toml`.
