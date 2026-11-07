#!/usr/bin/env bash
# Reconstruit data/sptc.sqlite depuis zéro. Lancer depuis n'importe où ; dépendances : pip install -r requirements.txt
set -euo pipefail
cd "$(dirname "$0")/.."
bash pipeline/fetch.sh
python pipeline/extract.py dl/weekday.pdf weekday data/raw_weekday.json
python pipeline/extract.py dl/weekend.pdf weekend data/raw_weekend.json
python pipeline/build.py     # crée data/sptc.sqlite (services, trajets, passages)
python pipeline/geo.py       # positions : arrêts OSM et lieux
python pipeline/geo2.py      # compléments Nominatim (≈ 2 min, 1 requête/s)
