# Deploying "Bus Seychelles" on Cloudflare (free)

The site is a static page (`public/`) + Pages Functions (`functions/`) + a D1 database (logs, `logging.sql`; the
timetables themselves are the static file `public/timetable.json`) + the free Workers AI LLM. It all fits in a free
Cloudflare account, with no domain name (URL `https://bus-seychelles.pages.dev`). Free quotas change: check them in
the dashboard. For the hosting overview and scaling options, see the "Hosting and scaling" section of the
[main README](../README.md#hosting-and-scaling).

Prerequisites: a Cloudflare account and Node.js (≥ 18) on your computer.

```bash
cd web
npx wrangler login                          # opens the browser: you sign in yourself

# 1. Database (logs)
npx wrangler d1 create sptc-bus             # prints a database_id → paste it into wrangler.toml
npx wrangler d1 execute sptc-bus --remote --file=logging.sql   # query_log and mcp_log tables

# 2. Pages project + deployment
npx wrangler pages project create bus-seychelles --production-branch=main
npx wrangler pages deploy public --project-name=bus-seychelles
```

The `DB` (D1) and `AI` (Workers AI) bindings come from `wrangler.toml`. If they do not appear: dashboard →
Workers & Pages → bus-seychelles → Settings → Bindings → add **D1 database** (`DB` → `sptc-bus`) and
**Workers AI** (`AI`), then redeploy.

## Checking

```bash
curl -s -X POST https://bus-seychelles.pages.dev/api/ask -H 'content-type: application/json' \
  -d '{"q":"next bus from Victoria to Beau Vallon after 4pm"}'
```

Expected: JSON with `"intent":"next"` and rows (routes 22, 20, 22E, 24A…).

## Good to know

* **Abuse protection**: the function limits requests per IP (per instance, best-effort) and questions to 300
  characters. For a real limit: dashboard → Security → WAF → *Rate limiting rules*.
* **If the AI quota is exhausted**, the function falls back to rule-based parsing (`via: "rules"`): the site keeps
  answering simple phrasings ("from X to Y", "line 20").
* **Updating the timetables**: re-run `pipeline/run_all.sh`, then `python pipeline/make_schema.py` (regenerates
  `web/schema.sql` and `web/public/timetable.json`), and redeploy. `timetable.json` is what the site reads; D1 is not
  involved in timetables. Never touch `query_log` / `mcp_log`.
* **"Source code" link**: set `REPO` at the top of the script in `public/index.html`.
* **No API key** is needed: Workers AI is bound to the project through `wrangler.toml`.
* **Scaling**: see the main README (free-plan limits, Workers Paid plan, custom domain).
