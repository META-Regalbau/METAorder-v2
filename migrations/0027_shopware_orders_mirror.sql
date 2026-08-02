-- Migration: Persistenter Bestell-Spiegel (Delta-Sync statt Voll-Refetch bei jedem Laden)
-- Date: 2026-07-31
-- Description: shopware_orders spiegelt Bestellungen lokal, analog zu shopware_products/
--   shopware_customers (siehe 0019_shopware_mirror.sql). Der Sync-Cursor liegt weiterhin
--   in der bereits existierenden shopware_sync_state-Tabelle (entity='orders').

CREATE TABLE IF NOT EXISTS shopware_orders (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_id VARCHAR NOT NULL,
  order_number TEXT,
  sales_channel_id VARCHAR,
  sw_updated_at TIMESTAMP,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_orders_tenant_sw_id_unique
  ON shopware_orders(tenant_id, shopware_id);

CREATE INDEX IF NOT EXISTS shopware_orders_tenant_sales_channel_idx
  ON shopware_orders(tenant_id, sales_channel_id);

CREATE INDEX IF NOT EXISTS shopware_orders_tenant_order_number_idx
  ON shopware_orders(tenant_id, order_number);

CREATE INDEX IF NOT EXISTS shopware_orders_tenant_sw_updated_idx
  ON shopware_orders(tenant_id, sw_updated_at);
