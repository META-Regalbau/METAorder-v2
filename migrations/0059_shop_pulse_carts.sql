-- Migration: Shop-Puls Stufe 2, S2-3 B2B-Warenkorb-Alarm (Konzept 18.10.2026, Abschnitt 3)
-- Date: 2026-10-19
-- Description:
--   shop_pulse_carts: je Mandant und Kundennummer der zuletzt gemeldete Warenkorb eines angemeldeten
--     Geschaeftskunden (Shopware-Plugin MetaCartSignal, signierter Webhook). Nur Kennzahlen und Ansprechpartner
--     (Firma, Name, E-Mail, Telefon; Positionen mit Artikelnummer, Bezeichnung, Menge, Netto), dazu Stand des
--     Alarms (wann, an wen, per E-Mail) und der Bestellung. Zeilen aelter als 30 Tage loescht der Lauf.
--     Ohne Mandant (tenant_id NULL) sichert der Code gegen Dubletten, der Index greift dort nicht.
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_carts (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  customer_number TEXT NOT NULL,
  customer_id TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT,
  net_total DOUBLE PRECISION NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  position_count INTEGER NOT NULL DEFAULT 0,
  positions JSONB NOT NULL DEFAULT '[]'::jsonb,
  cart_updated_at TIMESTAMP NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT NOW(),
  alarmed_at TIMESTAMP,
  alarm_recipient TEXT,
  alarm_recipient_source TEXT,
  alarm_mailed BOOLEAN NOT NULL DEFAULT FALSE,
  ordered_at TIMESTAMP,
  order_number TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_carts_tenant_customer_idx
  ON shop_pulse_carts (tenant_id, customer_number);
