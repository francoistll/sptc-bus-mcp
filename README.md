# sptc-bus-mcp — horaires des bus SPTC (Mahé, Seychelles) pour Claude

Serveur [MCP](https://modelcontextprotocol.io) qui permet à une IA d'interroger les horaires des bus de la
**Seychelles Public Transport Corporation (SPTC)** : « quels sont les prochains bus de Victoria à Beau Vallon ? ».

*English summary: an MCP server exposing SPTC (Seychelles) bus timetables, built by parsing the official PDF
timetables into SQLite. No official GTFS feed exists. Scheduled times only, no real-time data.*

> ⚠️ **Horaires théoriques, sans temps réel.** Données SPTC valables au **4 août 2026**, extraites automatiquement
> de PDF. Des erreurs sont possibles : vérifiez sur [sptc.sc/timetable](https://sptc.sc/timetable/) ou aux arrêts.
> Projet non officiel, non affilié à la SPTC.

## Outils exposés

| Outil | Rôle |
|---|---|
| `chercher_arret(nom)` | Arrêts dont le nom contient `nom`, avec position GPS quand elle existe |
| `prochains_passages(depart, arrivee?, apres?, jour?, limite?)` | Prochains bus au départ d'un arrêt, éventuellement vers une destination. Sans `apres`, utilise l'heure actuelle aux Seychelles (UTC+4). `jour` = `semaine` ou `weekend` |
| `horaires_ligne(ligne, jour?)` | Grille complète d'une ligne (ex. `20`, `22`, `24A`), par sens |

## Utilisation

**Comme connecteur Claude (serveur distant)** — Paramètres → Connecteurs → *Ajouter un connecteur personnalisé* →
URL de votre instance, terminée par `/mcp` (voir *Hébergement*).

**En local (Claude Code, Claude Desktop)** :

```bash
pip install -r requirements.txt
claude mcp add sptc-bus -- python /chemin/vers/sptc-bus-mcp/server/server.py
```

**Mode HTTP** : `SPTC_HTTP=1 python server/server.py` → `http://127.0.0.1:8791/mcp`.
Variables : `SPTC_BIND` (défaut `127.0.0.1`), `PORT`/`SPTC_PORT` (défaut `8791`), `SPTC_DB` (chemin de la base),
`SPTC_PUBLIC_HOST` (noms d'hôte autorisés, séparés par des virgules ; active la protection DNS-rebinding).

## Comment les données ont été créées

La SPTC ne publie **ni flux GTFS, ni API, ni carte des arrêts**. Seuls des PDF d'horaires sont disponibles.
La base `data/sptc.sqlite` a donc été fabriquée en trois étapes, toutes reproductibles avec `pipeline/run_all.sh`.

### 1. Horaires : extraction des PDF officiels

* **Source** : les deux PDF de [sptc.sc/timetable](https://sptc.sc/timetable/) (semaine : 85 pages ; week-end : 87 pages),
  valables au 4 août 2026. Les PDF ne sont **pas** redistribués ici : `pipeline/fetch.sh` les télécharge.
* **Extraction** (`pipeline/extract.py`) : chaque page contient des tableaux « un tableau par ligne et par sens ».
  La première ligne du tableau est le titre (`Route 20`, `Route 1 from Victoria`…), la deuxième l'en-tête
  (les arrêts, dans l'ordre du trajet), les suivantes les trajets. [pdfplumber](https://github.com/jsvine/pdfplumber)
  détecte les tableaux ; le pied de page est rogné pour éviter qu'il se mélange aux dernières lignes.
* **Normalisation** (`pipeline/build.py`) :
  * un tableau peut contenir plusieurs lignes collées ; on découpe à chaque titre `Route …` ;
  * les doublons (tableaux répétés par le PDF) sont supprimés ;
  * la page-guide « How to read this timetable » est écartée ;
  * `-` ou case vide = arrêt non desservi sur ce trajet ;
  * **un correctif manuel** (page 11 du PDF week-end : les lignes 2C/2D du samedi sont collées en un seul tableau).
* **Résultat** : ~287 services en semaine (136 lignes), ~276 le week-end (64 lignes), ~2 870 trajets,
  ~8 070 passages (arrêt + heure).

Schéma : `services(day_type, route, title, source_page)`, `service_stops(service_id, seq, stop)`,
`trips(id, service_id, trip_no)`, `stop_times(trip_id, seq, stop, time)`, `stops_geo(stop, lat, lon, osm_name, quality, score)`.

### 2. Positions des arrêts (partielles)

Les PDF donnent des **noms** d'arrêts (« Beau Vallon », « Anse Etoile »…), pas de coordonnées, et il n'existe pas de
carte officielle. Les positions viennent de sources ouvertes :

1. **OpenStreetMap** (`pipeline/geo.py`) : ~1 000 arrêts de bus des Seychelles via l'API Overpass, appariés par
   ressemblance de nom (`difflib`, seuil 0,88) → qualité `arret_osm` ; sinon avec un lieu OSM (`place=*`) → `lieu_approx`.
2. **Nominatim** (`pipeline/geo2.py`) : géocodage restreint à Mahé (1 requête/s, selon leur règle d'usage) →
   `geocode_approx`. Les résultats hors de Mahé sont écartés.
3. Sinon `inconnu` (pas de position).

**Couverture réelle : ~45 arrêts sur 155** (environ 60 % des passages). Les noms de la SPTC désignent des villages ;
ceux d'OSM désignent des arrêts physiques (commerce, lieu-dit) : l'appariement est donc faible. Une position
« approximative » est celle d'un village ou d'un arrêt voisin, pas de l'arrêt exact. Améliorations bienvenues.

### 3. Serveur

`server/server.py` ouvre la base en **lecture seule** et expose les trois outils ci-dessus
(SDK Python [`mcp`](https://pypi.org/project/mcp/) 1.x, `FastMCP`).

### Limites connues

* Pas de temps réel (retards, annulations), pas d'itinéraire avec correspondance.
* Les notes des PDF (ex. « tous les mardis la 1D part à 13h20 ») ne sont pas importées.
* Week-end = samedi et dimanche confondus (certains titres précisent « Saturday »).
* Colonnes irrégulières dans quelques tableaux : certaines lignes secondaires peuvent être décalées.
* Les PDF changent (nouveaux horaires en juillet 2025, mai 2026, août 2026…) : relancer `run_all.sh`.

## Hébergement

Le serveur est sans état, le conteneur est minuscule (base : ~350 Ko). Avec le `Dockerfile` fourni :

```bash
docker build -t sptc-bus-mcp .
docker run -p 8080:8080 -e SPTC_PUBLIC_HOST=bus.example.org sptc-bus-mcp   # → http://localhost:8080/mcp
```

Tout hébergeur de conteneurs convient (Fly.io, Render, Google Cloud Run…) : le serveur lit la variable `PORT`.
Les offres gratuites changent souvent ; vérifiez leurs conditions. Le point d'accès est public et sans
authentification (données publiques, lecture seule).

## Crédits et licences

* **Code** : MIT (voir `LICENSE`).
* **Horaires** : © SPTC — Seychelles Public Transport Corporation, <https://sptc.sc>. Données factuelles
  réorganisées pour usage personnel et d'information ; les PDF d'origine ne sont pas redistribués. En cas de
  demande de la SPTC, la base sera retirée ou mise à jour.
* **Positions** : © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright), licence
  [ODbL](https://opendatacommons.org/licenses/odbl/) ; géocodage par [Nominatim](https://nominatim.org/).
  La table `stops_geo` est une base dérivée : elle reste sous ODbL.
