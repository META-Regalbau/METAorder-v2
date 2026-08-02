/**
 * Montagekosten als echte Angebotsposition: Berechnung aus der Montagezeit
 * (Shopware-Customfield "wdu_meta_calc_installation_time", Minuten je Produkt)
 * der Positionen eines Angebots, und Hinzufügen als reale Shopware-Position
 * (Artikel "Montagekosten").
 */
import { B2BSellersClient } from "./b2bSellersClient";
import { computeMontageNet } from "./offerConfigPdfBuilder";
import { productCacheRegistry } from "./productCache";
import { ShopwareClient } from "./shopware";
import type { IStorage } from "./storage";
import { SERVICE_TYPE_CUSTOM_FIELD } from "./offerServiceProducts";

export const MONTAGE_PRODUCT_NUMBER = "SW10002";

export type OfferServiceProduct = {
  productNumber: string;
  productId: string;
  name: string;
  priceNet: number;
  taxRate: number;
  serviceType: string;
};

export type OfferMontageSuggestion = {
  installationMinutes: number;
  blocks: number;
  net: number;
  description: string;
  productNumber: string;
  productName: string;
};

async function loadB2BClient(storage: IStorage, tenantId: string | null) {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error("Shopware-Einstellungen nicht konfiguriert");
  const statusMapping = await storage.getSetting("b2b.offerStatusMapping", tenantId);
  return { settings, client: new B2BSellersClient(settings, { statusMapping }) };
}

export async function computeOfferMontageSuggestion(
  storage: IStorage,
  tenantId: string | null,
  offerId: string,
): Promise<OfferMontageSuggestion> {
  const { settings, client: b2bClient } = await loadB2BClient(storage, tenantId);
  const rawOffer = await b2bClient.fetchOfferById(offerId);
  const mapped = b2bClient.mapOffer(rawOffer.data, undefined, rawOffer.included);

  const shopwareClient = new ShopwareClient(settings);
  const cache = productCacheRegistry.for(tenantId);
  await cache.ensurePopulated(shopwareClient);

  let installationMinutes = 0;
  for (const item of mapped.items || []) {
    const pid = item.productId || item.payload?.productId;
    const qty = Number(item.quantity || 0);
    if (!pid || qty <= 0) continue;
    const product = cache.getProductById(String(pid));
    const perUnit = Number(product?.customFields?.wdu_meta_calc_installation_time ?? 0);
    if (Number.isFinite(perUnit) && perUnit > 0) installationMinutes += perUnit * qty;
  }

  const { net, description, blocks } = computeMontageNet(installationMinutes);
  const montageProduct = cache.getProductByNumber(MONTAGE_PRODUCT_NUMBER);

  return {
    installationMinutes,
    blocks,
    net,
    description,
    productNumber: MONTAGE_PRODUCT_NUMBER,
    productName: montageProduct?.name || "Montagekosten",
  };
}

/** Alle Zusatzleistungs-Artikel im Katalog (markiert über das Customfield "wdu_service_type"). */
export async function listOfferServiceProducts(
  storage: IStorage,
  tenantId: string | null,
): Promise<OfferServiceProduct[]> {
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error("Shopware-Einstellungen nicht konfiguriert");
  const shopwareClient = new ShopwareClient(settings);
  const cache = productCacheRegistry.for(tenantId);
  await cache.ensurePopulated(shopwareClient);

  const services: OfferServiceProduct[] = [];
  for (const product of cache.getProducts()) {
    const serviceType = product.customFields?.[SERVICE_TYPE_CUSTOM_FIELD];
    if (typeof serviceType !== "string" || !serviceType) continue;
    services.push({
      productNumber: product.productNumber,
      productId: product.id,
      name: product.name,
      priceNet: product.netPrice ?? 0,
      taxRate: product.taxRate ?? 19,
      serviceType,
    });
  }
  services.sort((a, b) => a.name.localeCompare(b.name, "de"));
  return services;
}

/** Fügt einen beliebigen Service-Artikel (per Produktnummer) als echte Position zum Angebot hinzu. */
export async function addServiceLineItemToOffer(
  storage: IStorage,
  tenantId: string | null,
  offerId: string,
  productNumber: string,
  unitPriceNet: number,
  quantity: number,
): Promise<void> {
  const { settings, client: b2bClient } = await loadB2BClient(storage, tenantId);

  const shopwareClient = new ShopwareClient(settings);
  const cache = productCacheRegistry.for(tenantId);
  await cache.ensurePopulated(shopwareClient);
  const product = cache.getProductByNumber(productNumber);
  if (!product) {
    throw new Error(`Artikel "${productNumber}" nicht im Produktkatalog gefunden.`);
  }
  if (!(unitPriceNet >= 0) || !Number.isFinite(unitPriceNet)) {
    throw new Error("Ungültiger Preis.");
  }

  await b2bClient.addOfferLineItem(offerId, {
    productId: product.id,
    quantity: Math.max(1, Math.round(quantity) || 1),
    unitPriceNet,
    taxRate: product.taxRate ?? 19,
    label: product.name || productNumber,
  });
}

export async function addMontageLineItemToOffer(
  storage: IStorage,
  tenantId: string | null,
  offerId: string,
  unitPriceNet: number,
  quantity: number,
): Promise<void> {
  await addServiceLineItemToOffer(storage, tenantId, offerId, MONTAGE_PRODUCT_NUMBER, unitPriceNet, quantity);
}
