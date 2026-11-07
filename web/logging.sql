-- Journal des questions (sans IP, texte expurgé), conservé 60 jours, pour détecter les réponses non conformes.
-- Hors schema.sql : le renouvellement mensuel des horaires ne doit jamais effacer ce journal.
CREATE TABLE IF NOT EXISTS query_log(
  ts TEXT, q TEXT, via TEXT, intent TEXT, n INT, depart TEXT, arrivee TEXT, route TEXT, qtime TEXT, day TEXT
);
CREATE INDEX IF NOT EXISTS query_log_ts ON query_log(ts);

-- Journal des appels au serveur MCP (/mcp) : adresse IP, outil et arguments, conservé 60 jours, pour repérer les abus.
CREATE TABLE IF NOT EXISTS mcp_log(ts TEXT, ip TEXT, method TEXT, tool TEXT, args TEXT, status TEXT);
CREATE INDEX IF NOT EXISTS mcp_log_ts ON mcp_log(ts);
