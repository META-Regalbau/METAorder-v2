-- Migration: Shop-Inhalte mit Versionen (Pflegeoberflaeche, Konzept 16.10.2026)
-- Date: 2026-10-16
-- Description:
--   shop_content_items: je Mandant eine Zeile je Branchenseite bzw. Startseiten-Abschnitt (kind + key).
--   shop_content_versions: jede Speicherung = neue Version (data jsonb in der Form von shared/shopContent.ts),
--     mit Pruefergebnis beim Speichern. Nichts wird ueberschrieben.
--   shop_content_publications: jeder Schreiblauf in Testshop oder Live (Protokoll fuer den Rueckbau,
--     Fingerabdruck des geschriebenen Stands fuer die Erkennung von Aenderungen im Shop-Admin). Idempotent.

CREATE TABLE IF NOT EXISTS shop_content_items (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  kind TEXT NOT NULL,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_content_items_tenant_kind_key_idx
  ON shop_content_items (tenant_id, kind, key);

CREATE TABLE IF NOT EXISTS shop_content_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  item_id VARCHAR NOT NULL REFERENCES shop_content_items(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  data JSONB NOT NULL,
  comment TEXT,
  check_result JSONB,
  created_by_user_id VARCHAR,
  created_by_name TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS shop_content_versions_item_no_idx
  ON shop_content_versions (item_id, version_no);

CREATE TABLE IF NOT EXISTS shop_content_publications (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR,
  item_id VARCHAR NOT NULL REFERENCES shop_content_items(id) ON DELETE CASCADE,
  version_id VARCHAR REFERENCES shop_content_versions(id) ON DELETE SET NULL,
  target TEXT NOT NULL,
  target_tenant_id VARCHAR,
  status TEXT NOT NULL,
  protocol JSONB,
  written JSONB,
  error TEXT,
  published_by_user_id VARCHAR,
  published_by_name TEXT,
  published_at TIMESTAMP NOT NULL DEFAULT NOW(),
  reverted_at TIMESTAMP,
  reverted_by_name TEXT
);

CREATE INDEX IF NOT EXISTS shop_content_publications_item_idx
  ON shop_content_publications (item_id, target, published_at);
