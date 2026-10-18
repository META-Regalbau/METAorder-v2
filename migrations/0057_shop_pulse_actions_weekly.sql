-- Migration: Shop-Puls Stufe 2, S2-1 Massnahmen-Protokoll und Wochenbericht (Konzept 18.10.2026, Abschnitt 2)
-- Date: 2026-10-18
-- Description:
--   shop_pulse_actions: je Aenderung am Shop ein Eintrag (Zeitpunkt, Art, Titel, Beschreibung, Bereich, Quelle,
--     wer). Automatische Eintraege (Live-Veroeffentlichungen der Shop-Inhalte, von Hand erledigte Meldungen,
--     Deploys laut Shop-Waechter, Preisaenderungen je Tag, importierte Live-Protokolle) haben einen festen
--     Schluessel je Quelle (source_key) und kommen so nie doppelt; von Hand eingetragene haben keinen.
--     Ohne Mandant (tenant_id NULL) sichert der Code gegen Dubletten, der Index greift dort nicht.
--   shop_pulse_weekly_reports: Archiv der Wochenberichte, je Mandant und Woche (Montag, week_start) einer.
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_actions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  occurred_at TIMESTAMP NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  scope_type TEXT NOT NULL DEFAULT 'shop',
  scope_values JSONB NOT NULL DEFAULT '[]'::jsonb,
  source TEXT NOT NULL,
  source_key TEXT,
  actor TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_actions_tenant_source_key_idx
  ON shop_pulse_actions (tenant_id, source_key);

CREATE INDEX IF NOT EXISTS shop_pulse_actions_tenant_occurred_idx
  ON shop_pulse_actions (tenant_id, occurred_at);

CREATE TABLE IF NOT EXISTS shop_pulse_weekly_reports (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  week_start TEXT NOT NULL,
  data JSONB NOT NULL,
  ai JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_weekly_reports_tenant_week_idx
  ON shop_pulse_weekly_reports (tenant_id, week_start);
