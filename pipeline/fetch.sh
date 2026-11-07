#!/usr/bin/env bash
# Télécharge les PDF officiels (dl/) et les points OpenStreetMap (data/osm_*.json).
# Adapte les URL des PDF si la SPTC publie une nouvelle version : https://sptc.sc/timetable/
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p dl data
curl -fL -o dl/weekday.pdf https://sptc.sc/wp-content/uploads/2026/08/SPTC_Weekday_Timetable_August_2026_Updated.pdf
curl -fL -o dl/weekend.pdf https://sptc.sc/wp-content/uploads/2026/08/SPTC_Weekend_Timetable_July_2026.pdf
UA="sptc-bus-mcp/1.0 (projet personnel ; voir le dépôt GitHub)"
O=https://overpass-api.de/api/interpreter
curl -fsS -A "$UA" --data-urlencode 'data=[out:json][timeout:90];area["ISO3166-1"="SC"]->.a;(node(area.a)["highway"="bus_stop"];node(area.a)["public_transport"="platform"]["bus"="yes"];);out body;' $O -o data/osm_stops.json
curl -fsS -A "$UA" --data-urlencode 'data=[out:json][timeout:90];area["ISO3166-1"="SC"]->.a;node(area.a)["place"]["name"];out body;' $O -o data/osm_places.json
