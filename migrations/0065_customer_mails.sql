-- Migration: Kundenmails über Brevo, Baustein B1 (Konzept 19./20.10.2026)
-- Date: 2026-10-20
-- Description:
--   marketing_contacts: je E-Mail-Adresse und Mandant die Kaufdaten aus dem Spiegel, Einwilligung, Widerspruch,
--     Bounce und Brevo-/Shopware-Stand. Rechtsgrundlage wird daraus berechnet (shared/customerMails.ts).
--   marketing_mail_runs: Aussendungen (Entwurf -> Versand über Brevo-Kampagne).
--   marketing_mail_recipients: Empfänger je Aussendung mit Grund fürs Auslassen; Grundlage der Kontaktbremse.
--   marketing_events: Ereignisse aus dem Brevo-Webhook (Abmeldung, Spam, Bounce, Klick).
--   Idempotent.

CREATE TABLE IF NOT EXISTS marketing_contacts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  email TEXT NOT NULL,
  customer_number TEXT,
  company TEXT,
  contact_name TEXT,
  sales_channel_id VARCHAR,
  sales_channel_name TEXT,
  language TEXT NOT NULL DEFAULT 'de',
  order_count INTEGER NOT NULL DEFAULT 0,
  first_order_at TIMESTAMP,
  last_order_at TIMESTAMP,
  last_order_number TEXT,
  consent_at TIMESTAMP,
  consent_source TEXT,
  consent_note TEXT,
  consent_by TEXT,
  objection_at TIMESTAMP,
  objection_source TEXT,
  objection_note TEXT,
  bounced_at TIMESTAMP,
  newsletter_recipient_id VARCHAR,
  newsletter_status TEXT,
  shop_opt_out_pending BOOLEAN NOT NULL DEFAULT FALSE,
  brevo_blocklisted BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_contacts_tenant_email_idx ON marketing_contacts (tenant_id, email);
CREATE INDEX IF NOT EXISTS marketing_contacts_customer_idx ON marketing_contacts (tenant_id, customer_number);

CREATE TABLE IF NOT EXISTS marketing_mail_runs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  mail_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  subject TEXT NOT NULL,
  template_id INTEGER,
  sender_id INTEGER,
  planned_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  brevo_list_id INTEGER,
  brevo_campaign_id INTEGER,
  error TEXT,
  created_by TEXT,
  sent_by TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_mail_runs_tenant_created_idx ON marketing_mail_runs (tenant_id, created_at);

CREATE TABLE IF NOT EXISTS marketing_mail_recipients (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  run_id VARCHAR NOT NULL REFERENCES marketing_mail_runs(id) ON DELETE CASCADE,
  mail_type TEXT NOT NULL,
  advertising BOOLEAN NOT NULL DEFAULT TRUE,
  email TEXT NOT NULL,
  customer_number TEXT,
  basis TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  skip_reason TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_mail_recipients_run_idx ON marketing_mail_recipients (run_id);
CREATE INDEX IF NOT EXISTS marketing_mail_recipients_email_sent_idx ON marketing_mail_recipients (tenant_id, email, sent_at);

CREATE TABLE IF NOT EXISTS marketing_events (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  email TEXT NOT NULL,
  event TEXT NOT NULL,
  campaign_id INTEGER,
  url TEXT,
  occurred_at TIMESTAMP NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS marketing_events_tenant_email_idx ON marketing_events (tenant_id, email, occurred_at);
CREATE INDEX IF NOT EXISTS marketing_events_campaign_idx ON marketing_events (tenant_id, campaign_id);
