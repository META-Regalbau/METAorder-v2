-- Migration: Raumplanung-Snapshot fürs Angebots-PDF (Phase 3)
-- Date: 2026-08-01
-- Description: preview_image_base64 speichert einen Offscreen-3D-Snapshot des
--   Raums (data:image/png;base64,...), gerendert im Client beim Speichern der
--   Raumplanung, und in der Raumplanung-Seite des Angebots-PDF eingebettet.

ALTER TABLE cpq_room_layouts ADD COLUMN IF NOT EXISTS preview_image_base64 TEXT;
