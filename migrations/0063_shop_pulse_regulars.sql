-- Migration: Shop-Puls Stufe 3, S3-4 Stammkunden-Wache (Konzept 19.10.2026, Abschnitt 3)
-- Date: 2026-10-19
-- Description:
--   shop_pulse_regulars: je Mandant und Kundennummer der Stand der Stammkunden-Wache: letzte Meldung (wann, an
--     wen, Inhalt), Altbestand beim ersten Lauf (nur per Knopf melden) und die erste Bestellung nach der Meldung
--     (Erfolg für die Wirkungsmessung). Höchstens eine Meldung je Kunde in 90 Tagen.
--     Ohne Mandant (tenant_id NULL) sichert der Code gegen Dubletten, der Index greift dort nicht.
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_regulars (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  customer_number TEXT NOT NULL,
  backlog BOOLEAN NOT NULL DEFAULT FALSE,
  alerted_at TIMESTAMP,
  alert_last_order_at TIMESTAMP,
  recipient TEXT,
  recipient_source TEXT,
  alert_mailed BOOLEAN NOT NULL DEFAULT FALSE,
  alert_text TEXT,
  won_at TIMESTAMP,
  won_order_number TEXT,
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_regulars_tenant_customer_idx
  ON shop_pulse_regulars (tenant_id, customer_number);
