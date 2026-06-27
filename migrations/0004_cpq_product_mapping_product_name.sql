-- Migration: Produktname in CPQ-Produkt-Mappings
-- Date: 2026-02-14
-- Description: Spalte product_name für Anzeige des Shop-Namens bei Artikelnummer

ALTER TABLE cpq.cpq_product_mapping
  ADD COLUMN IF NOT EXISTS product_name TEXT;
