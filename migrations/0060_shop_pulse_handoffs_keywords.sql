-- Migration: Shop-Puls Stufe 3, S3-1 Vom Befund zur Umsetzung (Konzept 19.10.2026, Abschnitt 1)
-- Date: 2026-10-19
-- Description:
--   shop_pulse_handoffs: je Meldung die Weitergaben („Für Agentur/Smarketer weitergeben“, Ticket). Der fertige
--     Text ging als Teams-Direktnachricht an Oliver (Entscheidung 19.10.2026: alles an Oliver). Erledigt von
--     Hand oder von selbst, sobald die Meldung erledigt ist; reminded_at = Erinnerung nach 2 Werktagen.
--   shop_pulse_search_keywords: je Suchbegriff ohne Treffer die gefundenen Artikel und, falls eingetragen, die
--     Änderung am Feld customSearchKeywords (vorher/nachher je Artikel) für „Rückgängig“.
--     Ohne Mandant (tenant_id NULL) sichert der Code gegen Dubletten, der Index greift dort nicht.
--   Idempotent.

CREATE TABLE IF NOT EXISTS shop_pulse_handoffs (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  signal_id VARCHAR NOT NULL,
  signal_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  recipient TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL DEFAULT '',
  ticket_id VARCHAR,
  ticket_number TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  created_by TEXT,
  done_at TIMESTAMP,
  done_by TEXT,
  reminded_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS shop_pulse_handoffs_tenant_signal_idx
  ON shop_pulse_handoffs (tenant_id, signal_id);

CREATE TABLE IF NOT EXISTS shop_pulse_search_keywords (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  term TEXT NOT NULL,
  term_key TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'ga4',
  searches INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'suggested',
  match_kind TEXT NOT NULL DEFAULT 'none',
  candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_at TIMESTAMP,
  applied_by TEXT,
  reverted_at TIMESTAMP,
  reverted_by TEXT,
  error TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_pulse_search_keywords_tenant_term_idx
  ON shop_pulse_search_keywords (tenant_id, term_key);
