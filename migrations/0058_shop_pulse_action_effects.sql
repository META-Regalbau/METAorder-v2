-- Migration: Shop-Puls Stufe 2, S2-6 Wirkung messen (Konzept 18.10.2026, Abschnitt 6)
-- Date: 2026-10-18
-- Description:
--   shop_pulse_action_effects: je Eintrag im Massnahmen-Protokoll (shop_pulse_actions) die zuletzt berechnete
--     Wirkung: Einstufung (sure/unsure/notMeasurable/pending) und der Vergleich vorher/nachher (14 und 28
--     Tage, Bereich gegen uebrigen Shop) als JSON, dazu fruehe Signale aus GA4. Wird taeglich und von Hand
--     neu berechnet (je Mandant werden die Zeilen der berechneten Massnahmen ersetzt).
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_action_effects (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  action_id VARCHAR NOT NULL,
  verdict TEXT NOT NULL,
  data JSONB NOT NULL,
  computed_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_action_effects_tenant_action_idx
  ON shop_pulse_action_effects (tenant_id, action_id);
