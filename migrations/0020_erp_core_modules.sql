-- Migration: ERP-Kernmodule (Warenwirtschaft, Einkauf, Retouren, Fibu, Produktion, Versand)
-- Date: 2026-07-25
-- Description: Bestände, Lieferanten/PO/WE, RMA, OP/Zahlungen, Fertigung, Labels/Picklisten

-- ========== P1 Warenwirtschaft ==========
CREATE TABLE IF NOT EXISTS erp_warehouses (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  address JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_warehouses_tenant_code_unique
  ON erp_warehouses(tenant_id, code);
CREATE INDEX IF NOT EXISTS erp_warehouses_tenant_idx ON erp_warehouses(tenant_id);

CREATE TABLE IF NOT EXISTS erp_warehouse_locations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  warehouse_id VARCHAR NOT NULL REFERENCES erp_warehouses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_warehouse_locations_wh_code_unique
  ON erp_warehouse_locations(warehouse_id, code);

CREATE TABLE IF NOT EXISTS erp_stock_levels (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  warehouse_id VARCHAR NOT NULL REFERENCES erp_warehouses(id) ON DELETE CASCADE,
  location_id VARCHAR REFERENCES erp_warehouse_locations(id) ON DELETE SET NULL,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 0,
  reserved_quantity REAL NOT NULL DEFAULT 0,
  min_quantity REAL NOT NULL DEFAULT 0,
  reorder_point REAL NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_stock_levels_unique
  ON erp_stock_levels(tenant_id, warehouse_id, (COALESCE(location_id, '')), product_number);
CREATE INDEX IF NOT EXISTS erp_stock_levels_tenant_product_idx
  ON erp_stock_levels(tenant_id, product_number);
CREATE INDEX IF NOT EXISTS erp_stock_levels_reorder_idx
  ON erp_stock_levels(tenant_id, reorder_point);

CREATE TABLE IF NOT EXISTS erp_stock_movements (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  warehouse_id VARCHAR NOT NULL REFERENCES erp_warehouses(id) ON DELETE CASCADE,
  location_id VARCHAR REFERENCES erp_warehouse_locations(id) ON DELETE SET NULL,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  movement_type TEXT NOT NULL,
  reference_type TEXT,
  reference_id TEXT,
  note TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_stock_movements_tenant_idx
  ON erp_stock_movements(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_stock_movements_product_idx
  ON erp_stock_movements(tenant_id, product_number);

CREATE TABLE IF NOT EXISTS erp_inventory_counts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  warehouse_id VARCHAR NOT NULL REFERENCES erp_warehouses(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'draft',
  counted_at TIMESTAMP,
  created_by TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_inventory_counts_tenant_idx
  ON erp_inventory_counts(tenant_id);

CREATE TABLE IF NOT EXISTS erp_inventory_count_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_count_id VARCHAR NOT NULL REFERENCES erp_inventory_counts(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  expected_qty REAL NOT NULL DEFAULT 0,
  counted_qty REAL,
  difference REAL
);

-- ========== P1 Einkauf ==========
CREATE TABLE IF NOT EXISTS erp_suppliers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  number TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  address JSONB DEFAULT '{}'::jsonb,
  payment_terms TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_suppliers_tenant_number_unique
  ON erp_suppliers(tenant_id, number);
CREATE INDEX IF NOT EXISTS erp_suppliers_tenant_idx ON erp_suppliers(tenant_id);

CREATE TABLE IF NOT EXISTS erp_purchase_orders (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  supplier_id VARCHAR NOT NULL REFERENCES erp_suppliers(id),
  number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  warehouse_id VARCHAR REFERENCES erp_warehouses(id) ON DELETE SET NULL,
  ordered_at TIMESTAMP,
  expected_at TIMESTAMP,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_purchase_orders_tenant_number_unique
  ON erp_purchase_orders(tenant_id, number);
CREATE INDEX IF NOT EXISTS erp_purchase_orders_tenant_idx
  ON erp_purchase_orders(tenant_id, status);

CREATE TABLE IF NOT EXISTS erp_purchase_order_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_order_id VARCHAR NOT NULL REFERENCES erp_purchase_orders(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  received_quantity REAL NOT NULL DEFAULT 0,
  unit_price REAL NOT NULL DEFAULT 0,
  herstellkosten_net REAL
);

CREATE TABLE IF NOT EXISTS erp_goods_receipts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  purchase_order_id VARCHAR NOT NULL REFERENCES erp_purchase_orders(id),
  warehouse_id VARCHAR NOT NULL REFERENCES erp_warehouses(id),
  number TEXT NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by TEXT,
  notes TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_goods_receipts_tenant_number_unique
  ON erp_goods_receipts(tenant_id, number);

CREATE TABLE IF NOT EXISTS erp_goods_receipt_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  goods_receipt_id VARCHAR NOT NULL REFERENCES erp_goods_receipts(id) ON DELETE CASCADE,
  purchase_order_line_id VARCHAR REFERENCES erp_purchase_order_lines(id) ON DELETE SET NULL,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS erp_supplier_invoices (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  supplier_id VARCHAR NOT NULL REFERENCES erp_suppliers(id),
  purchase_order_id VARCHAR REFERENCES erp_purchase_orders(id) ON DELETE SET NULL,
  number TEXT NOT NULL,
  amount_net REAL NOT NULL DEFAULT 0,
  amount_gross REAL NOT NULL DEFAULT 0,
  invoice_date TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'open',
  file_path TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_supplier_invoices_tenant_number_unique
  ON erp_supplier_invoices(tenant_id, number);

-- ========== P2 Retouren / RMA ==========
CREATE TABLE IF NOT EXISTS erp_returns (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_order_id TEXT,
  shopware_order_number TEXT,
  customer_email TEXT,
  status TEXT NOT NULL DEFAULT 'requested',
  reason TEXT,
  warehouse_id VARCHAR REFERENCES erp_warehouses(id) ON DELETE SET NULL,
  credit_note_number TEXT,
  credit_amount REAL,
  credit_pdf_path TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_returns_tenant_idx ON erp_returns(tenant_id, status);
CREATE INDEX IF NOT EXISTS erp_returns_order_idx ON erp_returns(tenant_id, shopware_order_number);

CREATE TABLE IF NOT EXISTS erp_return_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id VARCHAR NOT NULL REFERENCES erp_returns(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  restock BOOLEAN NOT NULL DEFAULT true,
  unit_price REAL NOT NULL DEFAULT 0
);

-- ========== P2 Finanzbuchhaltung ==========
CREATE TABLE IF NOT EXISTS erp_open_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  type TEXT NOT NULL,
  partner_type TEXT NOT NULL,
  partner_id TEXT,
  partner_name TEXT,
  document_number TEXT NOT NULL,
  document_date TIMESTAMP,
  due_date TIMESTAMP,
  amount REAL NOT NULL,
  open_amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  status TEXT NOT NULL DEFAULT 'open',
  reference_type TEXT,
  reference_id TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_open_items_tenant_idx
  ON erp_open_items(tenant_id, type, status);
CREATE INDEX IF NOT EXISTS erp_open_items_document_idx
  ON erp_open_items(tenant_id, document_number);

CREATE TABLE IF NOT EXISTS erp_payments (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  open_item_id VARCHAR NOT NULL REFERENCES erp_open_items(id) ON DELETE CASCADE,
  amount REAL NOT NULL,
  payment_date TIMESTAMP NOT NULL DEFAULT NOW(),
  method TEXT,
  reference TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_payments_tenant_idx ON erp_payments(tenant_id);
CREATE INDEX IF NOT EXISTS erp_payments_open_item_idx ON erp_payments(open_item_id);

-- ========== P3 Produktion / MRP ==========
CREATE TABLE IF NOT EXISTS erp_production_orders (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  number TEXT NOT NULL,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'planned',
  warehouse_id VARCHAR REFERENCES erp_warehouses(id) ON DELETE SET NULL,
  bom JSONB DEFAULT '[]'::jsonb,
  planned_start TIMESTAMP,
  planned_end TIMESTAMP,
  completed_at TIMESTAMP,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_production_orders_tenant_number_unique
  ON erp_production_orders(tenant_id, number);
CREATE INDEX IF NOT EXISTS erp_production_orders_tenant_idx
  ON erp_production_orders(tenant_id, status);

CREATE TABLE IF NOT EXISTS erp_production_materials (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id VARCHAR NOT NULL REFERENCES erp_production_orders(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  required_qty REAL NOT NULL,
  issued_qty REAL NOT NULL DEFAULT 0
);

-- ========== P3 Versand-Automatisierung ==========
CREATE TABLE IF NOT EXISTS erp_shipping_labels (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_order_id TEXT,
  order_number TEXT,
  carrier_code TEXT NOT NULL,
  tracking_number TEXT,
  label_url TEXT,
  label_status TEXT NOT NULL DEFAULT 'draft',
  package_weight REAL,
  package_count INTEGER NOT NULL DEFAULT 1,
  recipient JSONB DEFAULT '{}'::jsonb,
  raw_response JSONB,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS erp_shipping_labels_tenant_idx
  ON erp_shipping_labels(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS erp_shipping_labels_order_idx
  ON erp_shipping_labels(tenant_id, order_number);

CREATE TABLE IF NOT EXISTS erp_pick_lists (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  warehouse_id VARCHAR REFERENCES erp_warehouses(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'open',
  order_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP
);
CREATE INDEX IF NOT EXISTS erp_pick_lists_tenant_idx ON erp_pick_lists(tenant_id, status);

CREATE TABLE IF NOT EXISTS erp_pick_list_lines (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  pick_list_id VARCHAR NOT NULL REFERENCES erp_pick_lists(id) ON DELETE CASCADE,
  product_number TEXT NOT NULL,
  quantity REAL NOT NULL,
  picked_quantity REAL NOT NULL DEFAULT 0,
  location_code TEXT,
  order_number TEXT
);
