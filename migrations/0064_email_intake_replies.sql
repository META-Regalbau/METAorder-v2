-- Migration: Kundenantworten aus dem E-Mail-Eingang (Entscheidung 19.10.2026)
-- Date: 2026-10-19
-- Description:
--   email_intake_replies: je beantwortbarer Kundenmail (Lieferstatus, Reklamation, Kundenfrage, Angebotsanfrage)
--     ein Ticket „Kundenanfrage“ mit KI-Antwortentwurf. Gespeichert werden Postfach und Message-ID der
--     Originalmail (n8n sucht sie darüber, die Outlook-ID ändert sich beim Verschieben), der Entwurf, die
--     verwendeten Fakten (z. B. Bestellstatus) und der Versandstand für den Postausgang über n8n
--     (draft → queued → sent | failed). Eine Zeile je Mail (message_key), n8n darf dieselbe Mail erneut schicken.
--   Idempotent.

CREATE TABLE IF NOT EXISTS email_intake_replies (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  ticket_id VARCHAR REFERENCES tickets(id) ON DELETE CASCADE,
  message_key TEXT NOT NULL,
  internet_message_id TEXT,
  mailbox TEXT,
  kind TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  subject TEXT,
  draft TEXT,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb,
  draft_error TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  sent_text TEXT,
  sent_comment_id VARCHAR,
  attempts INTEGER NOT NULL DEFAULT 0,
  claimed_at TIMESTAMP,
  last_error TEXT,
  sent_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS email_intake_replies_tenant_message_idx
  ON email_intake_replies (tenant_id, message_key);
CREATE INDEX IF NOT EXISTS email_intake_replies_ticket_idx ON email_intake_replies (ticket_id);
CREATE INDEX IF NOT EXISTS email_intake_replies_status_idx ON email_intake_replies (status);
