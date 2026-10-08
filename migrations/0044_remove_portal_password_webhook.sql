-- Migration: Webhook "Händlerportal: Passwort angefordert" entfernen
-- Date: 2026-10-08
-- Description:
--   Die Seite /portal-zugang verschickt keine Mail mehr über n8n, sondern löst das
--   "Passwort vergessen" von B2Bsellers in Shopware aus. Die Einträge des Webhooks
--   b2b.portal_password_requested werden entfernt. Der Typ bleibt in der Prüfregel aus
--   0009/0017 (die vor dieser Migration bei jedem Start laufen). Idempotent.

DELETE FROM webhook_configs WHERE event_type = 'b2b.portal_password_requested';
