-- Migration: Gelernte Artikelzuordnung pro Kunde
-- Date: 2026-10-11
-- Description:
--   commercial_product_match_feedback.shopware_customer_id: Händler schicken eigene Artikelnummern
--   (Roloff „921027516“). Wird eine Zuordnung bestätigt (Anlage in Shopware oder Korrektur im
--   Prüffenster), gilt sie für diesen Kunden und diese Nummer künftig als sicherer Treffer. Idempotent.

ALTER TABLE commercial_product_match_feedback ADD COLUMN IF NOT EXISTS shopware_customer_id TEXT;

CREATE INDEX IF NOT EXISTS commercial_product_feedback_customer_ident_idx
  ON commercial_product_match_feedback (tenant_id, shopware_customer_id, source_identifier);
