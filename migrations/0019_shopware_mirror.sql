-- Migration: Persistenter Shopware-Spiegel (Produkte, Kunden, B2B-Firmen, Kundenpreise)
-- Date: 2026-07-16
-- Description: Lokale Spiegel-Tabellen + Sync-State fuer Delta-Sync aus Shopware

CREATE TABLE IF NOT EXISTS shopware_products (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_id VARCHAR NOT NULL,
  product_number TEXT NOT NULL,
  manufacturer_number TEXT,
  ean TEXT,
  name TEXT,
  active BOOLEAN,
  sw_updated_at TIMESTAMP,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_products_tenant_sw_id_unique
  ON shopware_products(tenant_id, shopware_id);

CREATE INDEX IF NOT EXISTS shopware_products_tenant_active_idx
  ON shopware_products(tenant_id, active);

CREATE INDEX IF NOT EXISTS shopware_products_tenant_product_number_idx
  ON shopware_products(tenant_id, product_number);

CREATE INDEX IF NOT EXISTS shopware_products_tenant_sw_updated_idx
  ON shopware_products(tenant_id, sw_updated_at);

CREATE TABLE IF NOT EXISTS shopware_customers (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_id VARCHAR NOT NULL,
  customer_number TEXT,
  email TEXT,
  company TEXT,
  group_id VARCHAR,
  group_name TEXT,
  sales_channel_id VARCHAR,
  sw_updated_at TIMESTAMP,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_customers_tenant_sw_id_unique
  ON shopware_customers(tenant_id, shopware_id);

CREATE INDEX IF NOT EXISTS shopware_customers_tenant_email_idx
  ON shopware_customers(tenant_id, email);

CREATE INDEX IF NOT EXISTS shopware_customers_tenant_customer_number_idx
  ON shopware_customers(tenant_id, customer_number);

CREATE INDEX IF NOT EXISTS shopware_customers_tenant_sw_updated_idx
  ON shopware_customers(tenant_id, sw_updated_at);

CREATE TABLE IF NOT EXISTS shopware_b2b_companies (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  company_id VARCHAR NOT NULL,
  customer_id VARCHAR,
  company TEXT,
  email TEXT,
  customer_number TEXT,
  active BOOLEAN,
  sales_channel_id VARCHAR,
  sw_updated_at TIMESTAMP,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_b2b_companies_tenant_company_unique
  ON shopware_b2b_companies(tenant_id, company_id);

CREATE INDEX IF NOT EXISTS shopware_b2b_companies_tenant_customer_idx
  ON shopware_b2b_companies(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS shopware_b2b_companies_tenant_sw_updated_idx
  ON shopware_b2b_companies(tenant_id, sw_updated_at);

CREATE TABLE IF NOT EXISTS shopware_customer_prices (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  price_id VARCHAR NOT NULL,
  customer_id VARCHAR,
  product_id VARCHAR,
  product_number TEXT,
  customer_number TEXT,
  sw_updated_at TIMESTAMP,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_customer_prices_tenant_price_unique
  ON shopware_customer_prices(tenant_id, price_id);

CREATE INDEX IF NOT EXISTS shopware_customer_prices_tenant_customer_idx
  ON shopware_customer_prices(tenant_id, customer_id);

CREATE INDEX IF NOT EXISTS shopware_customer_prices_tenant_product_idx
  ON shopware_customer_prices(tenant_id, product_id);

CREATE INDEX IF NOT EXISTS shopware_customer_prices_tenant_sw_updated_idx
  ON shopware_customer_prices(tenant_id, sw_updated_at);

CREATE TABLE IF NOT EXISTS shopware_sync_state (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  entity TEXT NOT NULL,
  cursor_updated_at TIMESTAMP,
  last_total INTEGER,
  last_fingerprint TEXT,
  last_delta_at TIMESTAMP,
  last_reconcile_at TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'idle',
  error TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_sync_state_tenant_entity_unique
  ON shopware_sync_state(tenant_id, entity);
