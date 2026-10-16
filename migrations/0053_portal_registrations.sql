-- Migration: Portal-Registrierungen
-- Date: 2026-10-16
-- Description:
--   portal_registrations: Anmeldungen fürs Händlerportal aus dem Registrierungs-Postfach (über n8n),
--   mit ausgelesenen Daten, Kundentreffer, Plan und Verlauf.
--   portal_registration_outbox: Mails an Kundenstamm und Außendienst, die n8n verschickt.
--   sales_rep_assignments: Kundennummer → META-Außendienst (Import). Idempotent.

CREATE TABLE IF NOT EXISTS portal_registrations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  message_id TEXT NOT NULL,
  graph_message_id TEXT,
  mailbox TEXT,
  subject TEXT NOT NULL DEFAULT '',
  from_email TEXT,
  from_name TEXT,
  forwarded_by TEXT,
  received_at TIMESTAMP NOT NULL DEFAULT now(),
  body_text TEXT NOT NULL DEFAULT '',
  raw_eml_base64 TEXT,
  status TEXT NOT NULL,
  extraction JSONB,
  data JSONB,
  match JSONB,
  plan JSONB,
  events JSONB NOT NULL DEFAULT '[]'::jsonb,
  customer_id TEXT,
  employee_id TEXT,
  password_reset_at TIMESTAMP,
  sales_rep_notified_at TIMESTAMP,
  master_data_requested_at TIMESTAMP,
  last_checked_at TIMESTAMP,
  last_error TEXT,
  handled_by_user_id VARCHAR,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS portal_registrations_tenant_message_idx
  ON portal_registrations (tenant_id, message_id);
CREATE INDEX IF NOT EXISTS portal_registrations_tenant_status_idx
  ON portal_registrations (tenant_id, status, received_at);

CREATE TABLE IF NOT EXISTS portal_registration_outbox (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  registration_id VARCHAR NOT NULL,
  kind TEXT NOT NULL,
  to_addresses JSONB NOT NULL,
  cc_addresses JSONB NOT NULL DEFAULT '[]'::jsonb,
  subject TEXT NOT NULL,
  html TEXT NOT NULL,
  attach_original BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMP,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_registration_outbox_tenant_status_idx
  ON portal_registration_outbox (tenant_id, status, created_at);
CREATE INDEX IF NOT EXISTS portal_registration_outbox_registration_idx
  ON portal_registration_outbox (registration_id);

CREATE TABLE IF NOT EXISTS sales_rep_assignments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  customer_number TEXT NOT NULL,
  rep_name TEXT NOT NULL DEFAULT '',
  rep_email TEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS sales_rep_assignments_tenant_customer_idx
  ON sales_rep_assignments (tenant_id, customer_number);
