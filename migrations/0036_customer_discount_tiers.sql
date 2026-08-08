-- Zusatzrabatt-Staffeln je Kunde aus b2bsellers_discount_rules.
-- Verknüpfung über die Kundennummer, weil die Regelbedingung Nummern enthält.

CREATE TABLE IF NOT EXISTS customer_discount_tiers (
  id               varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        varchar REFERENCES tenants(id),
  customer_number  text NOT NULL,
  label            text,
  discount_percent double precision NOT NULL,
  threshold_amount double precision,
  allow_stacking   boolean NOT NULL DEFAULT false,
  priority         integer,
  rule_id          varchar,
  synced_at        timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_discount_tiers_tenant_customer_idx
  ON customer_discount_tiers (tenant_id, customer_number);
