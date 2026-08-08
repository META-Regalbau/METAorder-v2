-- Rabatt-Übersicht je Kunde: Standardrabatt (customField b2b_customer_discount_rate),
-- kundenindividuelle Preise und der effektive Preislisten-Rabatt in einer Tabelle.

CREATE TABLE IF NOT EXISTS customer_discount_snapshots (
  id                          varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id                   varchar REFERENCES tenants(id),
  customer_id                 varchar NOT NULL,
  customer_number             text,
  email                       text,
  company                     text,
  group_name                  text,
  sales_channel_id            varchar,
  standard_discount_percent   double precision,
  individual_price_count      integer NOT NULL DEFAULT 0,
  price_list_fingerprint      text,
  price_list_discount_percent double precision,
  effective_discount_percent  double precision,
  synced_at                   timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS customer_discount_snapshots_tenant_customer_unique
  ON customer_discount_snapshots (tenant_id, customer_id);

-- Sortierung/Filterung der Auswertung nach Rabatthöhe
CREATE INDEX IF NOT EXISTS customer_discount_snapshots_tenant_effective_idx
  ON customer_discount_snapshots (tenant_id, effective_discount_percent);
