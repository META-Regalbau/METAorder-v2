-- Migration: Wer hat den Entwurf in Shopware angelegt?
-- Date: 2026-10-10
-- Description:
--   shopware_created_by_user_id an Bestell- und Angebotsentwürfen. Der E-Mail-Eingang (n8n)
--   weist Problem-Tickets dem Sachbearbeiter zu, der zuletzt einen Entwurf desselben Kunden
--   angelegt hat. created_by_user_id ist dafür ungeeignet: bei Mail-Entwürfen steht dort der
--   n8n-Benutzer. Leer bei automatischer Anlage. Idempotent.

ALTER TABLE order_drafts ADD COLUMN IF NOT EXISTS shopware_created_by_user_id VARCHAR;
ALTER TABLE offer_drafts ADD COLUMN IF NOT EXISTS shopware_created_by_user_id VARCHAR;

CREATE INDEX IF NOT EXISTS order_drafts_tenant_customer_idx ON order_drafts (tenant_id, shopware_customer_id);
CREATE INDEX IF NOT EXISTS offer_drafts_tenant_customer_idx ON offer_drafts (tenant_id, shopware_customer_id);
