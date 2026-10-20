-- Migration: Kundenmails – Einwilligung über die Bestätigungsmail des Shops (20.10.2026)
-- Date: 2026-10-20
-- Description: marketing_contacts.doi_requested_at = Zeitpunkt, an dem METAorder die Newsletter-Anmeldung mit
--   Bestätigungsmail (Double-Opt-in) im Shop ausgelöst hat. Die Einwilligung gilt erst, wenn der Abgleich die
--   bestätigte Anmeldung sieht. Idempotent.
ALTER TABLE marketing_contacts ADD COLUMN IF NOT EXISTS doi_requested_at TIMESTAMP;
