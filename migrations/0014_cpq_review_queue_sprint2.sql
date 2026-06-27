-- 0014_cpq_review_queue_sprint2.sql
-- Datum: 2026-05-03
-- Zweck: Review/Ops Queue fuer CPQ Klasse C inkl. Audit-Historie

ALTER TABLE cpq.cpq_configurations
  ADD COLUMN IF NOT EXISTS review_required boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS review_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS review_requested_at timestamp,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamp;

CREATE TABLE IF NOT EXISTS cpq.cpq_review_audit (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar REFERENCES public.tenants(id),
  configuration_id varchar NOT NULL REFERENCES cpq.cpq_configurations(id) ON DELETE CASCADE,
  from_status text,
  to_status text NOT NULL,
  review_notes text,
  reviewed_by text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cpq_configurations_review_queue_idx
  ON cpq.cpq_configurations (tenant_id, review_required, review_status, review_requested_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS cpq_review_audit_configuration_idx
  ON cpq.cpq_review_audit (configuration_id, created_at DESC);

CREATE INDEX IF NOT EXISTS cpq_review_audit_tenant_idx
  ON cpq.cpq_review_audit (tenant_id, created_at DESC);
