-- Migration: Cross-Selling-Gedaechtnis
-- Date: 2026-10-09
-- Description:
--   cross_sell_pair_state: ein Eintrag je gerichtetem Paar (Familien-Artikelnummern) mit Status
--   (vorgeschlagen, freigegeben, abgelehnt, im Shop, entfernt), Entscheidung, KI-Pruefung und
--   Shop-Stand. Abgelehnte Paare werden nie wieder vorgeschlagen.
--   cross_sell_change_log: jeder Schreibvorgang nach Shopware (nur anhaengen, fuer Rueckgaengig).
--   cross_sell_runs: Laeufe (Import, Kandidaten, Monatspruefung) mit Sperre je Zeitraum.
--   tenant_id NOT NULL DEFAULT '' statt NULL, damit die Unique-Indizes greifen (wie 0042).
--   Ohne Fremdschluessel. Idempotent.

CREATE TABLE IF NOT EXISTS cross_sell_pair_state (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL DEFAULT '',
  source_product_number TEXT NOT NULL,
  target_product_number TEXT NOT NULL,
  source_product_id VARCHAR,
  target_product_id VARCHAR,
  status TEXT NOT NULL,
  origin TEXT NOT NULL,
  pending_action TEXT,
  proposal_reason TEXT,
  replaces_pair_id VARCHAR,
  auto_eligible BOOLEAN NOT NULL DEFAULT false,
  protected BOOLEAN NOT NULL DEFAULT false,
  cooldown_until TIMESTAMPTZ,
  score REAL,
  score_components JSONB,
  stats JSONB,
  llm_verdict TEXT,
  llm_relation TEXT,
  llm_confidence REAL,
  llm_reason TEXT,
  llm_model TEXT,
  llm_input_hash TEXT,
  llm_checked_at TIMESTAMPTZ,
  decision_source TEXT,
  decided_by_user_id VARCHAR,
  decided_at TIMESTAMPTZ,
  decision_reason_code TEXT,
  decision_note TEXT,
  shop_refs JSONB,
  applied_at TIMESTAMPTZ,
  removed_at TIMESTAMPTZ,
  last_seen_in_shop_at TIMESTAMPTZ,
  baseline JSONB,
  effect JSONB,
  last_reviewed_at TIMESTAMPTZ,
  last_run_id VARCHAR,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cross_sell_pair_state_unique
  ON cross_sell_pair_state (tenant_id, source_product_number, target_product_number);
CREATE INDEX IF NOT EXISTS cross_sell_pair_state_status_idx
  ON cross_sell_pair_state (tenant_id, status);
CREATE INDEX IF NOT EXISTS cross_sell_pair_state_target_idx
  ON cross_sell_pair_state (tenant_id, target_product_number);
CREATE INDEX IF NOT EXISTS cross_sell_pair_state_pending_idx
  ON cross_sell_pair_state (tenant_id, pending_action) WHERE pending_action IS NOT NULL;

CREATE TABLE IF NOT EXISTS cross_sell_change_log (
  id BIGSERIAL PRIMARY KEY,
  tenant_id VARCHAR NOT NULL DEFAULT '',
  run_id VARCHAR,
  pair_state_id VARCHAR,
  action TEXT NOT NULL,
  mode TEXT NOT NULL,
  user_id VARCHAR,
  source_product_id VARCHAR,
  source_product_number TEXT,
  target_product_id VARCHAR,
  target_product_number TEXT,
  cross_selling_id VARCHAR,
  group_name TEXT,
  assignment_id VARCHAR,
  position INTEGER,
  success BOOLEAN NOT NULL,
  error TEXT,
  before JSONB,
  after JSONB,
  undo_of_id INTEGER,
  undone_by_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cross_sell_change_log_created_idx
  ON cross_sell_change_log (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS cross_sell_change_log_run_idx
  ON cross_sell_change_log (tenant_id, run_id);
CREATE INDEX IF NOT EXISTS cross_sell_change_log_source_idx
  ON cross_sell_change_log (tenant_id, source_product_number);

CREATE TABLE IF NOT EXISTS cross_sell_runs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL DEFAULT '',
  kind TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  triggered_by_user_id VARCHAR,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  stats JSONB,
  report JSONB,
  notified_at TIMESTAMPTZ,
  error TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS cross_sell_runs_period_unique
  ON cross_sell_runs (tenant_id, kind, period_key);
CREATE INDEX IF NOT EXISTS cross_sell_runs_kind_started_idx
  ON cross_sell_runs (tenant_id, kind, started_at);
