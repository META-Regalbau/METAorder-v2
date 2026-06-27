-- Migration: Add bundles tables
-- Date: 2026-02-07
-- Description: Introduces bundle definitions with mock product numbers and bundle items

CREATE TABLE IF NOT EXISTS bundles (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  name TEXT NOT NULL,
  mock_product_number TEXT NOT NULL,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bundle_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  bundle_id VARCHAR NOT NULL REFERENCES bundles(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  product_id TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS bundles_tenant_mock_number_unique
  ON bundles(tenant_id, mock_product_number);

CREATE INDEX IF NOT EXISTS bundle_items_bundle_id_idx ON bundle_items(bundle_id);
