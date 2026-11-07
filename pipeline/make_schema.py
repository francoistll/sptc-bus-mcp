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
