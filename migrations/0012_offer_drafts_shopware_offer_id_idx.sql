-- Schnelle Auflösung Angebotsentwurf → B2B-Angebot (CPQ config-PDF / Detail-Stückliste)
CREATE INDEX IF NOT EXISTS offer_drafts_shopware_offer_id_tenant_idx
  ON offer_drafts (shopware_offer_id, tenant_id)
  WHERE shopware_offer_id IS NOT NULL;
