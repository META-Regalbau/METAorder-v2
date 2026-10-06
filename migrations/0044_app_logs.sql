-- Migration: Systemprotokoll fuer Admins
-- Date: 2026-10-06
-- Description:
--   Log-Eintraege des Servers (pino) zusaetzlich in der Datenbank, damit Admins sie im Viewer
--   (/admin/logs) nach Bereich, Stufe, Zeit und Anfrage filtern koennen - das Container-Log haelt nur
--   die Zeilen seit dem letzten Neustart. Geschrieben gebuendelt von server/lib/logStore.ts,
--   aeltere Eintraege loescht der Server taeglich (LOG_STORE_DAYS, Standard 14). Ohne
--   Fremdschluessel; tenant_id NULL = Systemmeldung. Idempotent.

CREATE TABLE IF NOT EXISTS app_logs (
  id BIGSERIAL PRIMARY KEY,
  time TIMESTAMPTZ NOT NULL,
  level SMALLINT NOT NULL,
  area TEXT NOT NULL,
  component TEXT,
  msg TEXT NOT NULL,
  tenant_id VARCHAR,
  user_id VARCHAR,
  request_id VARCHAR,
  data JSONB
);

CREATE INDEX IF NOT EXISTS app_logs_time_idx ON app_logs (time);
CREATE INDEX IF NOT EXISTS app_logs_tenant_id_idx ON app_logs (tenant_id, id);
CREATE INDEX IF NOT EXISTS app_logs_request_idx ON app_logs (request_id);
