-- Preis-Historie für die Produktübersicht: erfasst pro Produkt jede erkannte
-- Preisänderung (alt/neu, brutto/netto) beim Shopware-Mirror-Sync, damit die
-- Übersicht anzeigen kann, wann sich der Preis zuletzt geändert hat.
ALTER TABLE shopware_products
  ADD COLUMN IF NOT EXISTS last_price_change_at timestamp;

CREATE TABLE IF NOT EXISTS product_price_history (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar REFERENCES tenants(id),
  shopware_id varchar NOT NULL,
  product_number text NOT NULL,
  old_price_gross real,
  new_price_gross real NOT NULL,
  old_price_net real,
  new_price_net real NOT NULL,
  changed_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS product_price_history_tenant_sw_idx
  ON product_price_history (tenant_id, shopware_id);
