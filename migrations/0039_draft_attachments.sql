-- Migration: Beigefügte Dokumente an Bestell-/Angebotsentwürfen
-- Date: 2026-09-16
-- Description:
--   Mails enthalten neben der Bestellung oft weitere Belege (Lieferschein des Kunden,
--   Auftragsbestätigung, Rechnung). Diese werden je Anhang klassifiziert und als
--   Beilage am Entwurf gespeichert statt als eigener Entwurf. Die Liste ist JSONB
--   (Dateipfad, Belegart, Kennnummern, Export-Status für Lobster → d.3).

ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS attachments JSONB;
ALTER TABLE offer_drafts ADD COLUMN IF NOT EXISTS attachments JSONB;
