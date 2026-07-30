-- Lieferanten-Preislisten (eine aktive Liste pro Lieferant)

CREATE TABLE IF NOT EXISTS erp_supplier_price_lists (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  supplier_id VARCHAR NOT NULL REFERENCES erp_suppliers(id) ON DELETE CASCADE,
  name TEXT,
  currency TEXT NOT NULL DEFAULT 'EUR',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  source_filename TEXT,
  imported_at TIMESTAMP,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT erp_supplier_price_lists_tenant_supplier_unique UNIQUE (tenant_id, supplier_id)
);

CREATE INDEX IF NOT EXISTS erp_supplier_price_lists_supplier_idx
  ON erp_supplier_price_lists(supplier_id, active);

CREATE TABLE IF NOT EXISTS erp_supplier_price_list_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  price_list_id VARCHAR NOT NULL REFERENCES erp_supplier_price_lists(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  unit_price REAL NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  CONSTRAINT erp_supplier_price_list_lines_list_product_unique UNIQUE (price_list_id, product_number)
);

CREATE INDEX IF NOT EXISTS erp_supplier_price_list_lines_list_idx
  ON erp_supplier_price_list_lines(price_list_id);

CREATE INDEX IF NOT EXISTS erp_supplier_price_list_lines_product_idx
  ON erp_supplier_price_list_lines(product_number);
