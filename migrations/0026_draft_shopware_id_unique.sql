-- Verhindert doppelte Shopware-Bestellungen/-Angebote aus einem Entwurf
-- Date: 2026-07-30
-- Description: Unique-Index auf order_drafts.shopware_order_id / offer_drafts.shopware_offer_id
--   (nur für nicht-NULL-Werte) als Datenbank-seitige Absicherung gegen die Race-Condition
--   bei gleichzeitigen create-order/create-offer-Requests (siehe server/commercialDraftShopware.ts
--   claimOrderDraftForCreation / claimOfferDraftForCreation für die eigentliche Sperre).

CREATE UNIQUE INDEX IF NOT EXISTS order_drafts_shopware_order_id_unique
  ON order_drafts (shopware_order_id)
  WHERE shopware_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS offer_drafts_shopware_offer_id_unique
  ON offer_drafts (shopware_offer_id)
  WHERE shopware_offer_id IS NOT NULL;
