-- Migration: Mondu an Bestellungen (MonduSell-Anlage aus METAorder, Zahlungslink erneut senden)
-- Date: 2026-10-18
-- Description:
--   mondu_orders: je Mandant, Shopware-Bestellung und Art eine Zeile.
--     kind = 'sell': MonduSell-Bestellung, die METAorder über die Async-Orders-API angelegt hat
--       (Mondu-UUID, Status, Rechnungsübergabe). Nach Ablehnung oder Storno wird dieselbe Zeile
--       für einen neuen Versuch überschrieben (attempt zählt hoch, Verlauf bleibt in history).
--     kind = 'shop': nur der Verlauf „Mondu-Zahlung erneut gesendet“ einer Shop-Bestellung, deren
--       Mondu-Zahlung das Shopware-Plugin führt.
--   Idempotent.

CREATE TABLE IF NOT EXISTS mondu_orders (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  shopware_order_id TEXT NOT NULL,
  order_number TEXT,
  kind TEXT NOT NULL,
  mondu_order_uuid TEXT,
  external_reference_id TEXT,
  state TEXT,
  state_reason TEXT,
  gross_amount_cents INTEGER,
  currency TEXT,
  buyer_email TEXT,
  net_term INTEGER,
  attempt INTEGER NOT NULL DEFAULT 1,
  invoice_pending BOOLEAN NOT NULL DEFAULT FALSE,
  invoice_uuid TEXT,
  invoice_number TEXT,
  invoice_state TEXT,
  last_error TEXT,
  history JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_checked_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS mondu_orders_tenant_order_kind_idx
  ON mondu_orders (tenant_id, shopware_order_id, kind);

CREATE INDEX IF NOT EXISTS mondu_orders_tenant_kind_state_idx
  ON mondu_orders (tenant_id, kind, state);
