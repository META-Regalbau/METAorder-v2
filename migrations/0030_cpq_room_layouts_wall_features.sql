-- Migration: Stilisierte Tür/Fenster/Tor-Markierungen in Raumwänden
-- Date: 2026-08-01
-- Description: wall_features speichert rein visuelle Öffnungen (Tür/Fenster/Tor) je
--   Raumwand (Nord/Süd/Ost/West) für die Draufsicht — ohne Kollisionsprüfung.

ALTER TABLE cpq_room_layouts ADD COLUMN IF NOT EXISTS wall_features JSONB NOT NULL DEFAULT '[]'::jsonb;
