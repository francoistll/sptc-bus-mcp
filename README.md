# Bus Seychelles — SPTC bus timetables (Mahé, Seychelles)

An **unofficial** project built around the timetables of the **Seychelles Public Transport Corporation (SPTC)**, which
only publishes PDFs (no GTFS feed, no API). The project turns those PDFs into usable data and offers them in two ways:

| | For whom | Where |
|---|---|---|
| 🌐 **Web app** | Everyone: natural-language questions ("next bus from Victoria to Beau Vallon after 4pm"), nearby stops, frequent trips, transfers, FR/EN, mobile-first | https://bus-seychelles.pages.dev |
| 🤖 **MCP server** | AI assistants (Claude, Cursor…) | `https://bus-seychelles.pages.dev/mcp` — see [MCP.md](MCP.md) |

> ⚠️ **Scheduled times only, no real-time data.** SPTC data valid as of **4 August 2026**, extracted automatically
> from PDFs. Errors are possible: check [sptc.sc/timetable](https://sptc.sc/timetable/) or the stop itself.
> Unofficial project, not affiliated with the SPTC.

## Web app — `web/`

**Live: https://bus-seychelles.pages.dev** (hosted for free on Cloudflare Pages).

A single page with a natural-language input, clickable examples, documentation and the data sources (links to the
official PDFs, "Unofficial service" banner). Bilingual (`/` in French, `/en/` in English), optimised for mobile.

* A free AI (Cloudflare Workers AI) is only used to **understand the question**; times always come from the official
  data, the AI never invents them. When the AI quota is used up, a rule-based parser takes over.
* Timetables are served as static JSON (`web/public/timetable.json`) and queried in memory; the D1 database is only
  used for logs (kept 60 days; the site never stores IP addresses).
* Personalisation lives in the browser only (`localStorage`): nearby stops (the user's position never leaves the
  device), frequent trips, a "Clear my memory" button.

Step-by-step deployment: [`web/DEPLOY.md`](web/DEPLOY.md) · maintenance: [`web/MAINTENANCE.md`](web/MAINTENANCE.md).

## MCP server

The same timetable engine is exposed to AI assistants through a free, account-less remote MCP server:
`https://bus-seychelles.pages.dev/mcp`. Tools, setup and limits: **[MCP.md](MCP.md)**.

## Hosting and scaling

### How it is hosted

Everything runs on **Cloudflare's free plan**, with no server to administer and no custom domain:

| Piece | Cloudflare service | Role |
|---|---|---|
| Pages (`web/public`) | Pages (static assets) | Site, `timetable.json`, FR/EN pages |
| API and MCP (`web/functions`) | Pages Functions (Workers) | `/api/ask`, `/api/trip`, `/api/stops`, `/mcp` |
| Question understanding | Workers AI (`AI` binding) | Llama 3.1 8B, only to parse the question |
| Logs | D1 database `sptc-bus` (`DB` binding) | `query_log` and `mcp_log`, 60-day retention |

Requests are served from Cloudflare's edge network, so there is nothing to keep running. The bindings are declared in
`web/wrangler.toml`; no API key is stored anywhere. Deployment is one command (`wrangler pages deploy`, see
[`web/DEPLOY.md`](web/DEPLOY.md)).

### Why it already holds up

* **Timetables are read from memory, not from a database.** `timetable.json` (≈ 350 KB, compressed by Cloudflare) is
  loaded once per instance and queried in memory. An earlier SQL design read about 150,000 D1 rows per question and
  exhausted the free daily quota (5 M rows/day); it now reads none.
* **A fast path skips the AI** for simple questions ("line 20", two known stops), the AI call (~3 s) being the main
  latency. If the AI quota or model is unavailable, the rule-based parser still answers.
* **Static content costs nothing in compute**: pages, JSON and trip details (`Cache-Control: public, max-age=3600`)
  are cached at the edge.
* **Abuse protection**: per-IP rate limits and a 300-character question cap (best-effort, per instance).

### Where the limits are (free plan)

The free-plan figures change over time; check the Cloudflare dashboard. Approximately:

| Resource | Free plan | What happens when exceeded |
|---|---|---|
| Pages Functions / Workers requests | ~100,000 per day | Dynamic requests fail until the daily reset (static files keep being served) |
| Workers AI | ~10,000 "neurons" per day | The site falls back to the rule-based parser (`via: "rules"`) |
| D1 | ~5 M rows read, ~100 k rows written per day | Only logging is affected; answers do not depend on D1 |

For a bus app on an island of ~100,000 people, the realistic bottleneck is the **AI quota**, and its failure mode is
graceful (simpler parsing, never a wrong timetable).

### Scaling up

1. **Stay free, get more headroom**: add a Cloudflare *Rate limiting rule* (Security → WAF) to block abusive IPs
   before they hit the Functions; cache more API responses at the edge; extend the fast path in
   `web/functions/_lib/parse.js` so fewer questions need the AI.
2. **Workers Paid plan (about US$5/month)**: lifts the request cap to millions per month with cheap per-million
   pricing beyond that, raises D1 limits by orders of magnitude, and bills Workers AI by usage instead of a hard
   daily quota. No code change is needed: the same project, bindings and `wrangler pages deploy`.
3. **Custom domain (about €10/year)**: better branding and SEO; Cloudflare Pages supports it directly.
4. **Beyond that**: because the timetable is a static file and the logic is stateless, load spreads across Cloudflare's
   edge automatically. The remaining costs would be AI usage and logs; both can be capped (smaller model, shorter log
   retention, sampling).

## How the data was built

The SPTC publishes **no GTFS feed, no API and no stop map**, only timetable PDFs. The database `data/sptc.sqlite` was
therefore built in three reproducible steps (`pipeline/run_all.sh`).

### 1. Timetables: extraction from the official PDFs

* **Source**: the two PDFs at [sptc.sc/timetable](https://sptc.sc/timetable/) (weekday: 85 pages; weekend: 87 pages),
  valid as of 4 August 2026. The PDFs are **not** redistributed here: `pipeline/fetch.sh` downloads them.
* **Extraction** (`pipeline/extract.py`): each page holds "one table per route and direction" tables. The first row is
  the title (`Route 20`, `Route 1 from Victoria`…), the second the header (stops, in trip order), the rest are trips.
  [pdfplumber](https://github.com/jsvine/pdfplumber) detects the tables; the footer is cropped so it does not mix
  into the last rows.
* **Normalisation** (`pipeline/build.py`):
  * a table can hold several glued routes; it is split at each `Route …` title;
  * duplicates (tables repeated by the PDF) are removed;
  * the "How to read this timetable" guide page is dropped;
  * `-` or an empty cell = stop not served on that trip;
  * **one manual fix** (page 11 of the weekend PDF: Saturday routes 2C/2D are glued into a single table).
* **Result**: ~287 services on weekdays (136 routes), ~276 at weekends (64 routes), ~2,870 trips, ~8,070 stop times.

Schema: `services(day_type, route, title, source_page)`, `service_stops(service_id, seq, stop)`,
`trips(id, service_id, trip_no)`, `stop_times(trip_id, seq, stop, time)`,
`stops_geo(stop, lat, lon, osm_name, quality, score)`.

### 2. Stop positions (partial)

The PDFs give stop **names** ("Beau Vallon", "Anse Etoile"…), not coordinates, and there is no official map. Positions
come from open sources:

1. **OpenStreetMap** (`pipeline/geo.py`): ~1,000 Seychelles bus stops via the Overpass API, matched by name similarity
   (`difflib`, threshold 0.88) → quality `arret_osm`; otherwise to an OSM place (`place=*`) → `lieu_approx`.
2. **Nominatim** (`pipeline/geo2.py`): geocoding restricted to Mahé (1 request/s, per their usage policy) →
   `geocode_approx`. Results outside Mahé are discarded.
3. Otherwise `inconnu` (no position).

**Actual coverage: ~45 stops out of 155** (about 60% of departures). SPTC names designate villages while OSM names
designate physical stops (shop, locality), so matching is weak. An "approximate" position is that of a village or a
neighbouring stop, not the exact stop. Improvements welcome.

### 3. Publication

`web/schema.sql` (a copy of `data/sptc.sqlite`) is used to generate `web/public/timetable.json`
(`pipeline/make_schema.py`), which the site and the MCP server (Cloudflare Pages Functions, `web/functions/`) query in
memory. See `web/DEPLOY.md`.

### Known limitations

* No real time (delays, cancellations); no multi-leg journey planning beyond simple transfers.
* Notes in the PDFs (e.g. "every Tuesday the 1D leaves at 1:20pm") are not imported.
* Weekend = Saturday and Sunday merged (some titles specify "Saturday").
* Irregular columns in a few tables: some secondary routes may be shifted.
* The PDFs change (new timetables in July 2025, May 2026, August 2026…): re-run `run_all.sh`.

## Contact and reporting errors

To report a wrong time, a misunderstood question, or for any request (including from the SPTC):
[open an issue](https://github.com/francoistll/sptc-bus-mcp/issues/new) on this repository (a GitHub account is required).
This service is an **unofficial** integration, not affiliated with the SPTC.

## Credits and licences

* **Code**: MIT (see `LICENSE`).
* **Timetables**: © SPTC — Seychelles Public Transport Corporation, <https://sptc.sc>. Factual data reorganised for
  personal and informational use; the original PDFs are not redistributed. If the SPTC asks, the database will be
  removed or updated.
* **Positions**: © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors, licence
  [ODbL](https://opendatacommons.org/licenses/odbl/); geocoding by [Nominatim](https://nominatim.org/).
  The `stops_geo` table is a derived database and remains under ODbL.
