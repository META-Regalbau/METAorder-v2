-- Migration: Raumplanung für Angebote (2D-Platzierung mehrerer CPQ-Konfigurationen)
-- Date: 2026-08-01
-- Description: cpq_room_layouts speichert Raummaße + Platzierungen (x/y/Rotation je
--   Konfigurationsgruppe) pro Angebot. Ein Raum pro Angebot (unique tenant_id+shopware_offer_id).

CREATE TABLE IF NOT EXISTS cpq_room_layouts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_offer_id VARCHAR NOT NULL,
  name TEXT,
  length_mm INTEGER NOT NULL,
  width_mm INTEGER NOT NULL,
  height_mm INTEGER NOT NULL,
  min_spacing_mm INTEGER,
  placements JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS cpq_room_layouts_tenant_offer_unique
  ON cpq_room_layouts(tenant_id, shopware_offer_id);
