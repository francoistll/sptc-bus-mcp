-- Journal des questions (sans IP, texte expurgé), conservé 60 jours, pour détecter les réponses non conformes.
-- Hors schema.sql : le renouvellement mensuel des horaires ne doit jamais effacer ce journal.
CREATE TABLE IF NOT EXISTS query_log(
  ts TEXT, q TEXT, via TEXT, intent TEXT, n INT, depart TEXT, arrivee TEXT, route TEXT, qtime TEXT, day TEXT
);
CREATE INDEX IF NOT EXISTS query_log_ts ON query_log(ts);
