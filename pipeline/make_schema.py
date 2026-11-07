"""Génère web/schema.sql (import Cloudflare D1) à partir de data/sptc.sqlite."""
import sqlite3

c = sqlite3.connect('data/sptc.sqlite')
out = [l for l in c.iterdump() if not l.startswith(('BEGIN TRANSACTION', 'COMMIT')) and 'sqlite_sequence' not in l]
out += ['CREATE INDEX idx_st_stop ON stop_times(stop);',
        'CREATE INDEX idx_st_trip ON stop_times(trip_id, seq);',
        'CREATE INDEX idx_trips_service ON trips(service_id, trip_no);',
        'CREATE INDEX idx_services ON services(day_type, route);',
        'CREATE INDEX idx_ss ON service_stops(service_id, seq);']
open('web/schema.sql', 'w').write('\n'.join(out) + '\n')
print(len(out), 'instructions écrites dans web/schema.sql')

# Horaires en JSON statique (servi avec le site, compressé par Cloudflare) : les fonctions Pages le lisent à la place de D1,
# donc plus aucun quota de lectures. Tableaux : st=[trip_id,seq,stop,time] tr=[id,service_id,trip_no] sv=[id,day_type,route,title]
# ss=[service_id,seq,stop] geo=[stop,lat,lon,quality]
import json
rows = lambda q: [list(r) for r in c.execute(q)]
tt = {'st': rows('select trip_id,seq,stop,time from stop_times'), 'tr': rows('select id,service_id,trip_no from trips'),
      'sv': rows('select id,day_type,route,title from services'), 'ss': rows('select service_id,seq,stop from service_stops'),
      'geo': rows('select stop,lat,lon,quality from stops_geo')}
open('web/public/timetable.json', 'w').write(json.dumps(tt, separators=(',', ':'), ensure_ascii=False))
print('web/public/timetable.json écrit')
