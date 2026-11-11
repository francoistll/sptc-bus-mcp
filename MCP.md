# MCP server — SPTC bus timetables (Mahé, Seychelles)

A remote [MCP](https://modelcontextprotocol.io) server that lets an AI assistant (Claude, Cursor…) query the bus
timetables of the **Seychelles Public Transport Corporation (SPTC)**: "what are the next buses from Victoria to Beau
Vallon?". This is the second half of the project; the web app is described in the [main README](README.md).

> ⚠️ **Scheduled times only, no real-time data**, extracted automatically from the official PDFs. Errors are possible:
> check [sptc.sc/timetable](https://sptc.sc/timetable/). Unofficial service, not affiliated with the SPTC.

## Connecting

URL: `https://bus-seychelles.pages.dev/mcp` (Streamable HTTP, stateless, read-only, no authentication, free).
Detailed instructions: https://bus-seychelles.pages.dev/en/claude (French: `/claude`).

* **Claude**: Customize → Connectors → *Add custom connector* → paste the URL.
* **Claude Code**:
  ```bash
  claude mcp add --transport http bus-seychelles https://bus-seychelles.pages.dev/mcp
  ```
* **Other clients** (Cursor…): a remote HTTP MCP server with the same URL.

## Tools

| Tool | Purpose |
|---|---|
| `chercher_arret(nom)` | Stops whose name contains `nom`, with GPS position when known |
| `prochains_passages(depart, arrivee?, apres?, jour?, limite?)` | Next buses leaving a stop, optionally towards a destination. Without `apres`, uses the current Seychelles time (UTC+4). `jour` = `semaine` (weekday) or `weekend` |
| `horaires_ligne(ligne, jour?)` | Full timetable of a route (e.g. `20`, `22`, `24A`), by direction |

Tip: use `chercher_arret` to find a stop's exact name, then `prochains_passages` or `horaires_ligne`. Tool names and
parameters are in French, as are the stop names used by the SPTC.

## Implementation and limits

* Code: `web/functions/mcp.js`, running as Cloudflare Pages Functions. Times come from `web/public/timetable.json`,
  queried in memory (same engine as the site, `web/functions/_lib/query.js`).
* Rate limit: 60 requests per minute per IP (approximate, per instance).
* `mcp_log` (D1): tool called, truncated arguments and IP address, kept 60 days, disclosed on the `/claude` page.
* No real time (delays, cancellations); the MCP tools do not plan transfers.
* Origin and limits of the data: see the [main README](README.md#how-the-data-was-built).
* Hosting and scaling: see [Hosting and scaling](README.md#hosting-and-scaling).

## Contact

Wrong time or any request: [open an issue](https://github.com/francoistll/sptc-bus-mcp/issues/new). **Unofficial**
service. Code under MIT licence; timetables © SPTC (see the main README).
