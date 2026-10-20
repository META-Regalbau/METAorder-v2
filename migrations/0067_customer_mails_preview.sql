-- Migration: Kundenmails B2 – Vorschau einer Mailart an die Testadressen (20.10.2026)
-- Date: 2026-10-20
-- Description: marketing_mail_runs.preview_of = Mailart, deren echte Inhalte (Beispielkunden) eine
--   Testaussendung zeigt; null bei normalen Läufen. Idempotent.
ALTER TABLE marketing_mail_runs ADD COLUMN IF NOT EXISTS preview_of TEXT;
