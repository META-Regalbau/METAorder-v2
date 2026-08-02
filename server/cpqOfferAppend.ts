/**
 * Fügt eine weitere CPQ-Konfiguration (komplette Stückliste) als neue
 * Konfigurationsgruppe zu einem bereits bestehenden, echten Shopware-Angebot hinzu
 * — im Gegensatz zu /api/offer-drafts/from-cpq, das immer ein NEUES Angebot anlegt.
 */
import { B2BSellersClient } from "./b2bSellersClient";
import { buildShopwareLinePayloadFromCpqSource, type CpqSourceSnapshot } from "./cpq/cpqMetaCalcPayload";
import { productCacheRegistry } from "./productCache";
import { ShopwareClient } from "./shopware";
import type { IStorage } from "./storage";

export async function addCpqConfigurationToOffer(
  storage: IStorage,
  tenantId: string | null,
  offerId: string,
  cpq: CpqSourceSnapshot,
): Promise<void> {
  const items = cpq.billOfMaterials?.items ?? [];
  if (items.length === 0) {
    throw new Error("Stückliste ist leer.");
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error("Shopware-Einstellungen nicht konfiguriert");

  const shopwareClient = new ShopwareClient(settings);
  const cache = productCacheRegistry.for(tenantId);
  await cache.ensurePopulated(shopwareClient);

  const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
  const b2bClient = new B2BSellersClient(settings, { statusMapping });

  // Kopf-Payload (Konfigurationsname/-beschreibung/Stückliste fürs Angebotsdetail und PDF)
  // wird nur an der ersten Position gesetzt — genau wie bei der Erstanlage eines Angebots.
  const headPayload = buildShopwareLinePayloadFromCpqSource(cpq);

  const newItems = items.map((item, index) => {
    const product = item.productId ? cache.getProductById(item.productId) : undefined;
    return {
      productId: item.productId,
      quantity: Math.max(1, Math.round(item.quantity) || 1),
      unitPriceNet: item.unitPrice ?? 0,
      taxRate: product?.taxRate ?? 19,
      label: item.name || item.productNumber || "Position",
      payload: index === 0 ? headPayload : undefined,
    };
  });

  await b2bClient.addOfferLineItems(offerId, newItems);
}
