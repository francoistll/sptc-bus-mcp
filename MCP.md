# Serveur MCP — horaires des bus SPTC (Mahé, Seychelles)

Serveur [MCP](https://modelcontextprotocol.io) qui permet à une IA (Claude, Cursor…) d'interroger les horaires des bus de la
**Seychelles Public Transport Corporation (SPTC)** : « quels sont les prochains bus de Victoria à Beau Vallon ? ».
C'est la deuxième facette du projet ; l'application web est décrite dans le [README principal](README.md).

*English: a remote MCP server exposing SPTC (Seychelles) bus timetables to AI assistants. Read-only, no account, scheduled times only (no real-time data).*

> ⚠️ **Horaires théoriques, sans temps réel**, extraits automatiquement des PDF officiels. Des erreurs sont possibles :
> vérifiez sur [sptc.sc/timetable](https://sptc.sc/timetable/). Service non officiel, non affilié à la SPTC.

## Connexion

URL : `https://bus-seychelles.pages.dev/mcp` (Streamable HTTP, sans état, lecture seule, sans authentification, gratuit).
Mode d'emploi détaillé : https://bus-seychelles.pages.dev/claude (anglais : `/en/claude`).

* **Claude** : Personnaliser → Connecteurs → *Ajouter un connecteur personnalisé* → coller l'URL.
* **Claude Code** :
  ```bash
  claude mcp add --transport http bus-seychelles https://bus-seychelles.pages.dev/mcp
  ```
* **Autres clients** (Cursor…) : serveur MCP distant de type HTTP avec la même URL.

## Outils exposés

| Outil | Rôle |
|---|---|
| `chercher_arret(nom)` | Arrêts dont le nom contient `nom`, avec position GPS quand elle existe |
| `prochains_passages(depart, arrivee?, apres?, jour?, limite?)` | Prochains bus au départ d'un arrêt, éventuellement vers une destination. Sans `apres`, utilise l'heure actuelle aux Seychelles (UTC+4). `jour` = `semaine` ou `weekend` |
| `horaires_ligne(ligne, jour?)` | Grille complète d'une ligne (ex. `20`, `22`, `24A`), par sens |

Conseil d'usage : `chercher_arret` pour retrouver le nom exact d'un arrêt, puis `prochains_passages` ou `horaires_ligne`.

## Implémentation et limites

* Code : `web/functions/mcp.js`, sur Cloudflare Pages Functions. Les horaires viennent de `web/public/timetable.json`,
  interrogé en mémoire (même moteur que le site, `web/functions/_lib/query.js`).
* Limite : 60 requêtes par minute et par IP (approximatif).
* Journal `mcp_log` (D1) : outil appelé, arguments tronqués et IP, conservés 60 jours, annoncé dans la page `/claude`.
* Pas de temps réel (retards, annulations) ; correspondances non gérées par le MCP.
* Origine et limites des données : voir le [README principal](README.md#comment-les-données-ont-été-créées).

## Contact

Horaire faux ou demande : [ouvrir une issue](https://github.com/francoistll/sptc-bus-mcp/issues/new). Service **non officiel**.
Code sous licence MIT ; horaires © SPTC (voir le README principal).
