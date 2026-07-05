-- Migration: Herstellpreise (SAP/VTLS) lokal in META Order
-- Date: 2026-07-05
-- Description: Speichert Herstellkosten pro Artikelnummer und Mandant (nicht in Shopware)

CREATE TABLE IF NOT EXISTS product_herstellpreise (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  product_number TEXT NOT NULL,
  herstellkosten_net REAL NOT NULL,
  source TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS product_herstellpreise_tenant_product_unique
  ON product_herstellpreise(tenant_id, product_number);

CREATE INDEX IF NOT EXISTS product_herstellpreise_tenant_idx
  ON product_herstellpreise(tenant_id);
