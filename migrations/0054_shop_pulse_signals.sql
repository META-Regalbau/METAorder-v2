-- Migration: Shop-Puls, Meldungen (Konzept Stufe 1, 17.10.2026)
-- Date: 2026-10-17
-- Description:
--   shop_pulse_signals: je Mandant und Fund-Schluessel eine Meldung. Sie bleibt offen, solange der Fund
--     in den Pruefungen auftaucht, und wird erledigt, wenn er verschwindet oder jemand sie erledigt.
--     Kommt derselbe Fund spaeter wieder, wird dieselbe Zeile wieder geoeffnet (Verlauf in reopen_count).
--     notified_* merkt sich, was zuletzt gemeldet wurde (keine Wiederholung, Meldung bei Verschlimmerung).
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_signals (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  key TEXT NOT NULL,
  source TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  params JSONB NOT NULL DEFAULT '{}'::jsonb,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  loss_per_hour DOUBLE PRECISION,
  first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMP,
  resolved_by TEXT,
  muted_until TIMESTAMP,
  notified_at TIMESTAMP,
  notified_severity TEXT,
  reopen_count INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_signals_tenant_key_idx
  ON shop_pulse_signals (tenant_id, key);

CREATE INDEX IF NOT EXISTS shop_pulse_signals_tenant_status_idx
  ON shop_pulse_signals (tenant_id, status, last_seen_at);
