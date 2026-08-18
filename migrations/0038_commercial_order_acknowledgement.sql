-- Migration: Rückmelde-Endpunkt für Kunden-ERP (Auftragsbestätigung)
-- Date: 2026-08-15
-- Description:
--   1. buyer_document_number auf order_drafts/offer_drafts — die Belegnummer des KUNDEN
--      aus seinem eigenen ERP (documentExtraction.document.number). Denormalisiert, weil
--      das Kunden-ERP mit seiner Nummer fragt und ein JSONB-Pfad nicht indizierbar wäre.
--   2. commercial_customer_api_tokens — kundengebundene Zugangs-Token. Bewusst getrennt
--      von tenant_integration_api_keys: die sind mandantenweit und würden einem Kunden
--      Zugriff auf fremde Vorgänge geben.

ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS buyer_document_number TEXT;
ALTER TABLE offer_drafts ADD COLUMN IF NOT EXISTS buyer_document_number TEXT;

CREATE INDEX IF NOT EXISTS order_drafts_tenant_buyer_doc_idx
  ON order_drafts (tenant_id, buyer_document_number);
CREATE INDEX IF NOT EXISTS offer_drafts_tenant_buyer_doc_idx
  ON offer_drafts (tenant_id, buyer_document_number);

CREATE TABLE IF NOT EXISTS commercial_customer_api_tokens (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  shopware_customer_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  expires_at TIMESTAMP,
  revoked_at TIMESTAMP,
  last_used_at TIMESTAMP,
  created_by_user_id VARCHAR REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS commercial_customer_api_tokens_tenant_customer_idx
  ON commercial_customer_api_tokens (tenant_id, shopware_customer_id);

-- Bestandsdaten: buyer_document_number aus dem bereits extrahierten JSONB nachziehen,
-- damit vorhandene Entwürfe sofort über den Endpunkt auffindbar sind.
UPDATE order_drafts
   SET buyer_document_number = NULLIF(TRIM(extracted_data->'documentExtraction'->'document'->>'number'), '')
 WHERE buyer_document_number IS NULL
   AND extracted_data->'documentExtraction'->'document'->>'number' IS NOT NULL;

UPDATE offer_drafts
   SET buyer_document_number = NULLIF(TRIM(extracted_data->'documentExtraction'->'document'->>'number'), '')
 WHERE buyer_document_number IS NULL
   AND extracted_data->'documentExtraction'->'document'->>'number' IS NOT NULL;
