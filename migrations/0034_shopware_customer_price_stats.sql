-- Fingerabdruck der individuellen Preise je Kunde (inkrementeller Sync).
--
-- Ein Voll-Snapshot der B2B-Preis-Entität ist bei großen Shops nicht praktikabel
-- (>100.000 Zeilen, ~25 min). Eine Shopware-Aggregation liefert je Kunde Anzahl und
-- Preissumme; nur geänderte Kunden werden im Detail nachgeladen.

CREATE TABLE IF NOT EXISTS shopware_customer_price_stats (
  id                varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         varchar REFERENCES tenants(id),
  customer_id       varchar NOT NULL,
  customer_number   text,
  price_count       integer NOT NULL DEFAULT 0,
  price_sum         double precision NOT NULL DEFAULT 0,
  fingerprint       text NOT NULL,
  prices_synced_at  timestamp,
  changed_at        timestamp NOT NULL DEFAULT now(),
  synced_at         timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS shopware_customer_price_stats_tenant_customer_unique
  ON shopware_customer_price_stats (tenant_id, customer_id);

-- Für "welche Kunden muss ich nachladen?" und die Auswertung nach Rabatthöhe.
CREATE INDEX IF NOT EXISTS shopware_customer_price_stats_tenant_synced_idx
  ON shopware_customer_price_stats (tenant_id, prices_synced_at);

-- Der Detail-Sync ersetzt Preiszeilen kundenweise statt global.
CREATE INDEX IF NOT EXISTS shopware_customer_prices_tenant_customer_idx
  ON shopware_customer_prices (tenant_id, customer_id);
