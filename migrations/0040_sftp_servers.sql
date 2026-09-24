-- Migration: SFTP-Server für die DMS-Übergabe (Lobster → d.3)
-- Date: 2026-09-22
-- Description:
--   Je Mandant können mehrere SFTP-Ziele hinterlegt werden. Beilagen der KI-Auftragsanlage
--   (Kundenlieferschein, optional AB/Rechnung/Sonstiges) werden nach der Bestellanlage per
--   SFTP hochgeladen, zusammen mit einer JSON-Sidecar-Datei (Bestellnummer, Kundenbestellnummer,
--   LS-Nr., Kommission) für die Zuordnung im d.3. Zugangsdaten liegen verschlüsselt (AES-GCM).
--   sftp_upload_logs protokolliert jeden Versuch (Wiederholungen über request_id gruppiert).

CREATE TABLE IF NOT EXISTS sftp_servers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 22,
  username TEXT NOT NULL,
  auth_method TEXT NOT NULL DEFAULT 'password',
  password TEXT,
  private_key TEXT,
  passphrase TEXT,
  host_key_fingerprint TEXT,
  remote_path TEXT NOT NULL DEFAULT '/',
  filename_template TEXT NOT NULL DEFAULT '{orderNumber}_{documentKind}_{originalName}',
  document_kinds JSONB NOT NULL DEFAULT '["delivery_note"]'::jsonb,
  write_metadata_sidecar INTEGER NOT NULL DEFAULT 1,
  auto_upload_on_order_create INTEGER NOT NULL DEFAULT 1,
  enabled INTEGER NOT NULL DEFAULT 1,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  initial_backoff_ms INTEGER NOT NULL DEFAULT 2000,
  backoff_factor REAL NOT NULL DEFAULT 2.0,
  timeout_ms INTEGER NOT NULL DEFAULT 20000,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS sftp_servers_tenant_name_unique ON sftp_servers (tenant_id, name);
CREATE INDEX IF NOT EXISTS sftp_servers_tenant_idx ON sftp_servers (tenant_id);

CREATE TABLE IF NOT EXISTS sftp_upload_logs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  request_id VARCHAR NOT NULL,
  server_id VARCHAR,
  server_name TEXT NOT NULL,
  trigger TEXT NOT NULL,
  draft_kind TEXT,
  draft_id VARCHAR,
  attachment_id VARCHAR,
  file_name TEXT,
  remote_path TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  attempt INTEGER NOT NULL DEFAULT 1,
  duration_ms INTEGER,
  executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  payload JSONB,
  CONSTRAINT sftp_upload_logs_status_check CHECK (status IN ('pending', 'success', 'failed', 'skipped'))
);

CREATE INDEX IF NOT EXISTS sftp_upload_logs_tenant_executed_idx ON sftp_upload_logs (tenant_id, executed_at);
CREATE INDEX IF NOT EXISTS sftp_upload_logs_draft_idx ON sftp_upload_logs (draft_id);
