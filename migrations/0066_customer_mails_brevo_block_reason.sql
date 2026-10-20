-- Migration: Kundenmails – Brevo-Sperrliste ist kein Widerspruch (Live-Befund 20.10.2026)
-- Date: 2026-10-20
-- Description:
--   Das Brevo-Plugin im Shop legt alle Shopkunden in Brevo an und sperrt jeden ohne Newsletter-Anmeldung.
--   „In Brevo gesperrt“ heißt deshalb nicht „hat widersprochen“. Der erste Abgleich hatte daraus 7.037 Widersprüche
--   gemacht. Ab jetzt prüft METAorder je gesperrtem Kontakt den Grund (Abmeldelink, Spam-Meldung, Bounce oder
--   Sperre durch Admin/Plugin), siehe server/customerMails/customerMailsRun.ts (checkBrevoBlockReasons).
--   Setzt die Widersprüche mit Quelle „brevoBlocklist“ zurück (diese Quelle entsteht nicht mehr). Idempotent.

ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS brevo_checked_at TIMESTAMP;
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS brevo_admin_blocked BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE marketing_contacts
SET objection_at = NULL, objection_source = NULL, objection_note = NULL, updated_at = NOW()
WHERE objection_source = 'brevoBlocklist';
