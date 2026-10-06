-- Migration: API-Key fuer Webhooks
-- Date: 2026-10-06
-- Description:
--   Optionaler API-Key je Webhook, der als Header X-API-Key mitgeschickt wird (z. B. fuer die
--   Header-Authentifizierung eines n8n-Webhooks). Ergaenzt die HMAC-Signatur ueber `secret`.
--   Der neue Ereignistyp b2b.portal_password_requested steht in der Pruefregel von 0009/0017
--   (beide laufen bei jedem Start erneut und setzen die Regel neu). Idempotent.

ALTER TABLE webhook_configs ADD COLUMN IF NOT EXISTS api_key TEXT;
