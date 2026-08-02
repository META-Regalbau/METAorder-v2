CREATE INDEX IF NOT EXISTS offer_drafts_tenant_offer_idx ON offer_drafts (tenant_id, shopware_offer_id);
CREATE INDEX IF NOT EXISTS offer_drafts_tenant_created_idx ON offer_drafts (tenant_id, created_at);
