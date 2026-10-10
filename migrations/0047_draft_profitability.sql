-- Migration: DB-Berechnung je Bestell-/Angebotsentwurf
-- Date: 2026-10-10
-- Description:
--   commercial_draft_profitability: letzte DB-Berechnung je Entwurf (snapshot JSON mit Positionen,
--   Ampel in verdict). frozen = Stand bei der Anlage in Shopware. Eigene Tabelle, damit die
--   Betraege nicht ueber die Entwurfs-Endpunkte mitgeschickt werden. Ohne Fremdschluessel
--   (zwei Entwurfstabellen). Idempotent.

CREATE TABLE IF NOT EXISTS commercial_draft_profitability (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  draft_kind TEXT NOT NULL,
  draft_id VARCHAR NOT NULL,
  verdict TEXT NOT NULL,
  frozen BOOLEAN NOT NULL DEFAULT FALSE,
  snapshot JSONB NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_draft_profitability_draft_unique
  ON commercial_draft_profitability (draft_kind, draft_id);
