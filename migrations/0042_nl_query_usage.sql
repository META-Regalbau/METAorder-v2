-- Migration: Zaehler fuer den Reiter "Natuerliche Sprache" (Statistik)
-- Date: 2026-10-05
-- Description:
--   Jede Frage kostet 2-3 KI-Aufrufe. Je Mandant, Nutzer und Tag (deutsche Zeit) wird gezaehlt,
--   wie viele Fragen gestellt wurden; die Grenzen stehen in den KI-Einstellungen (openai_settings:
--   nlDailyLimitPerUser, nlDailyLimitPerTenant). Erhoeht wird atomar per INSERT ... ON CONFLICT
--   ... WHERE count < Grenze. Idempotent.

CREATE TABLE IF NOT EXISTS nl_query_usage (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL DEFAULT '',
  user_id VARCHAR NOT NULL,
  usage_date DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nl_query_usage_unique ON nl_query_usage (tenant_id, user_id, usage_date);
