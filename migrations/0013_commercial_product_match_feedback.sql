-- Migration 0013: Commercial Product Match Feedback
-- Datum: 2026-05-01
-- Beschreibung: Lernspeicher fuer manuell bestaetigte/abgelehnte Produktzeilen in Offer/Order-Drafts.

CREATE TABLE IF NOT EXISTS commercial_product_match_feedback (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar REFERENCES tenants(id),
  draft_kind text NOT NULL,
  outcome text NOT NULL,
  line_key text NOT NULL,
  source_line text,
  source_identifier text,
  selected_product_id text,
  selected_identifier text,
  selected_strategy text,
  created_by_user_id varchar REFERENCES users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS commercial_product_feedback_tenant_line_idx
  ON commercial_product_match_feedback (tenant_id, line_key);

CREATE INDEX IF NOT EXISTS commercial_product_feedback_tenant_outcome_idx
  ON commercial_product_match_feedback (tenant_id, outcome, created_at);
