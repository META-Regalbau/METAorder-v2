-- Migration: Freigabe roter Entwuerfe (DB zu niedrig) + Link an Benachrichtigungen
-- Date: 2026-10-10
-- Description:
--   commercial_draft_margin_approvals: Verlauf je Entwurf (angefordert / freigegeben / abgelehnt)
--   mit Begruendung, Entscheider und Stand (fingerprint aus Positionen, Mengen, Preisen).
--   notifications.link: Ziel im Client fuer Benachrichtigungen ohne Ticket. Idempotent.

CREATE TABLE IF NOT EXISTS commercial_draft_margin_approvals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  draft_kind TEXT NOT NULL,
  draft_id VARCHAR NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  verdict TEXT NOT NULL,
  margin_percent DOUBLE PRECISION,
  db1_total DOUBLE PRECISION,
  requested_by_user_id VARCHAR,
  requested_by_name TEXT NOT NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
  decided_by_user_id VARCHAR,
  decided_by_name TEXT,
  decided_at TIMESTAMP,
  decision_comment TEXT
);

CREATE INDEX IF NOT EXISTS commercial_draft_margin_approvals_draft_idx
  ON commercial_draft_margin_approvals (draft_kind, draft_id, requested_at);

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS link TEXT;
