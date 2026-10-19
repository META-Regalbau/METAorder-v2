-- Migration: Shop-Puls Stufe 3, S3-2 Wächter-Reparatur per Knopf (Konzept 19.10.2026, Abschnitt 2)
-- Date: 2026-10-19
-- Description:
--   shop_watch_targets: je Mandant und Prüfpunkt des Shop-Wächters der Soll-Stand (die Einträge, die METAorder
--     dafür in den Shop geschrieben hat, nur die geschriebenen Felder), gelesen bei grünem Prüfpunkt.
--   shop_watch_repairs: Protokoll jeder Reparatur per Knopf mit Stand vorher (Rückweg), geschriebenem Soll-Stand,
--     Deploy-Schlüssel (höchstens eine Reparatur je Deploy und Prüfpunkt), Prüfergebnis danach und Rücknahme.
--     Ohne Mandant (tenant_id NULL) sichert der Code gegen Dubletten, der Index greift dort nicht.
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_watch_targets (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  check_id TEXT NOT NULL,
  entities JSONB NOT NULL DEFAULT '[]'::jsonb,
  hash TEXT NOT NULL DEFAULT '',
  taken_at TIMESTAMP NOT NULL DEFAULT NOW(),
  taken_by TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_watch_targets_tenant_check_idx
  ON shop_watch_targets (tenant_id, check_id);

CREATE TABLE IF NOT EXISTS shop_watch_repairs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  check_id TEXT NOT NULL,
  deploy_key TEXT NOT NULL DEFAULT 'none',
  status TEXT NOT NULL DEFAULT 'ok',
  error TEXT,
  before JSONB NOT NULL DEFAULT '[]'::jsonb,
  target JSONB NOT NULL DEFAULT '[]'::jsonb,
  target_taken_at TIMESTAMP,
  check_status_before TEXT,
  check_status_after TEXT,
  repaired_at TIMESTAMP NOT NULL DEFAULT NOW(),
  repaired_by TEXT,
  reverted_at TIMESTAMP,
  reverted_by TEXT
);

CREATE INDEX IF NOT EXISTS shop_watch_repairs_tenant_check_idx
  ON shop_watch_repairs (tenant_id, check_id, repaired_at);
