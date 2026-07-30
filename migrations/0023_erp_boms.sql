-- Stücklisten-Stamm (BOM master)

CREATE TABLE IF NOT EXISTS erp_boms (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  product_number TEXT NOT NULL,
  name TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT erp_boms_tenant_product_unique UNIQUE (tenant_id, product_number)
);

CREATE INDEX IF NOT EXISTS erp_boms_tenant_idx ON erp_boms(tenant_id, active);

CREATE TABLE IF NOT EXISTS erp_bom_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id VARCHAR NOT NULL REFERENCES erp_boms(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  CONSTRAINT erp_bom_lines_bom_product_unique UNIQUE (bom_id, product_number)
);

CREATE INDEX IF NOT EXISTS erp_bom_lines_bom_idx ON erp_bom_lines(bom_id);
