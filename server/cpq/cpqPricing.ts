/**
 * CPQ Kunden-Preisberechnung ("Weg 1"), strikt nach Verkaufskanal getrennt:
 * 1. Kundenindividueller Preis (b2b sellers Rabattmatrix) — gewinnt immer, kanalunabhängig.
 * 2. Sonst, je nach gebundenem Verkaufskanal des Kunden, wird derselbe B2B-Standardrabatt%
 *    (aus b2b sellers) auf unterschiedliche Basispreise angewendet:
 *    a) Portal-Kunde (Kanalname beginnt mit "META Händler Portal"):
 *       Erweiterter Preis (Shopware-Regel "Standard Preise Portal") − B2B-Standardrabatt%
 *    b) Onlineshop-Kunde (alle anderen Kanäle, z. B. "META Regalbau DE"):
 *       Standard-Onlineshop-Preis − B2B-Standardrabatt% (Bestpreis mit optionaler
 *       Zusatzrabatt-Regel, falls konfiguriert)
 */
import type { ShopwareAdvancedPrice, ShopwareClient, ShopwareCustomerPrice } from "../shopware";
import type { IStorage } from "../storage";
import type { BomLineItem } from "./cpqBillOfMaterials";
import { loadCpqPricingSettings } from "../cpqPricingSettings";

export type CpqPriceSource = "customer-individual" | "extended-b2b" | "shop-b2b" | "additional-discount" | "fallback";

export type CpqCustomerPricingContext = {
  customerId: string;
  /** true = an "META Händler Portal <Land>" gebunden, false = normaler Onlineshop-Kanal. */
  isPortalCustomer: boolean;
  standardDiscountPercent: number | null;
  customerPrices: ShopwareCustomerPrice[];
  advancedPricesByProductId: Map<string, ShopwareAdvancedPrice[]>;
  extendedPriceRuleId: string | null;
  additionalDiscountRuleId: string | null;
};

function pickTierForRule(
  tiers: ShopwareAdvancedPrice[],
  ruleId: string | null,
  quantity: number,
): ShopwareAdvancedPrice | null {
  if (!ruleId || tiers.length === 0) return null;
  const ruleTiers = tiers.filter((t) => t.ruleId === ruleId);
  if (ruleTiers.length === 0) return null;

  const qty = quantity > 0 ? quantity : 1;
  const matching = ruleTiers.filter(
    (t) => t.quantityStart <= qty && (t.quantityEnd == null || t.quantityEnd >= qty) && t.net != null && t.net > 0,
  );
  if (matching.length > 0) {
    return matching.sort((a, b) => b.quantityStart - a.quantityStart)[0] ?? null;
  }
  return ruleTiers.find((t) => t.net != null && t.net > 0) ?? null;
}

function pickCustomerPriceForQuantity(
  prices: ShopwareCustomerPrice[],
  quantity: number,
): ShopwareCustomerPrice | null {
  if (prices.length === 0) return null;
  const qty = quantity > 0 ? quantity : 1;
  const matching = prices.filter(
    (p) => (p.from ?? 1) <= qty && (p.to == null || p.to >= qty) && p.priceNet != null && p.priceNet > 0,
  );
  if (matching.length > 0) {
    return matching.sort((a, b) => (b.from ?? 0) - (a.from ?? 0))[0] ?? null;
  }
  return prices.find((p) => p.priceNet != null && p.priceNet > 0) ?? null;
}

// Der CPQ-Konfigurator ruft die BOM-Bepreisung bei jeder (debounced) Optionsänderung neu ab —
// derselbe Kunde bleibt dabei über viele Requests hinweg gleich, nur die angefragten productIds
// wechseln je nach gewählter Konfiguration. Standardrabatt/individuelle Preise/Verkaufskanal sind
// kundenbezogen (nicht produktbezogen) und ändern sich innerhalb einer kurzen TTL praktisch nie —
// die produktbezogenen advancedPrices werden pro Kunde inkrementell ergänzt statt neu geladen.
type CachedPricingContext = {
  ctx: CpqCustomerPricingContext;
  coveredProductIds: Set<string>;
  expiresAt: number;
};

const PRICING_CONTEXT_TTL_MS = 45_000;
const pricingContextCache = new Map<string, CachedPricingContext>();

function pricingCacheKey(tenantId: string | null | undefined, customerId: string): string {
  return `${tenantId ?? "__global__"}::${customerId}`;
}

function pruneStalePricingCacheEntries(now: number): void {
  if (pricingContextCache.size < 1000) return;
  for (const [key, entry] of pricingContextCache) {
    if (entry.expiresAt <= now) pricingContextCache.delete(key);
  }
}

export async function loadCpqCustomerPricingContext(opts: {
  customerId: string;
  productIds: string[];
  storage: IStorage;
  client: ShopwareClient;
  tenantId?: string | null;
}): Promise<CpqCustomerPricingContext> {
  const now = Date.now();
  const cacheKey = pricingCacheKey(opts.tenantId, opts.customerId);
  const cached = pricingContextCache.get(cacheKey);
  const cacheValid = !!cached && cached.expiresAt > now;
  const missingProductIds = cacheValid
    ? opts.productIds.filter((id) => !cached!.coveredProductIds.has(id))
    : opts.productIds;

  if (cacheValid && missingProductIds.length === 0) {
    return cached!.ctx;
  }

  if (cacheValid) {
    // Kundenbezogene Daten (Rabatt%, individuelle Preise, Kanal) bleiben unverändert — nur die
    // fehlenden Produkte werden nachgeladen und in die bestehende advancedPrices-Map gemergt.
    const sellingContextByProductId = await opts.client.fetchProductCrmSellingContext(missingProductIds);
    const advancedPricesByProductId = new Map(cached!.ctx.advancedPricesByProductId);
    for (const [productId, ctx] of sellingContextByProductId) {
      advancedPricesByProductId.set(productId, ctx.advancedPrices);
    }
    const nextCtx: CpqCustomerPricingContext = { ...cached!.ctx, advancedPricesByProductId };
    const coveredProductIds = new Set(cached!.coveredProductIds);
    for (const id of opts.productIds) coveredProductIds.add(id);
    pruneStalePricingCacheEntries(now);
    pricingContextCache.set(cacheKey, { ctx: nextCtx, coveredProductIds, expiresAt: now + PRICING_CONTEXT_TTL_MS });
    return nextCtx;
  }

  const settings = await loadCpqPricingSettings(opts.storage, opts.tenantId ?? null);

  const [standardDiscountPercent, customerPricesResult, sellingContextByProductId, boundChannel] = await Promise.all([
    opts.client.fetchCustomerB2BStandardDiscount(opts.customerId).catch(() => null),
    opts.client
      .fetchAllCustomerSpecificPrices({ customerId: opts.customerId })
      .catch(() => ({ available: false, total: 0, prices: [] as ShopwareCustomerPrice[], entity: null })),
    opts.client.fetchProductCrmSellingContext(opts.productIds),
    opts.client.fetchCustomerSalesChannelId(opts.customerId).catch(() => null),
  ]);

  const advancedPricesByProductId = new Map<string, ShopwareAdvancedPrice[]>();
  for (const [key, ctx] of sellingContextByProductId) {
    advancedPricesByProductId.set(key, ctx.advancedPrices);
  }

  const portalPrefix = settings.portalChannelNamePrefix.trim().toLowerCase();
  const isPortalCustomer =
    portalPrefix.length > 0 && !!boundChannel?.name?.trim().toLowerCase().startsWith(portalPrefix);

  const ctx: CpqCustomerPricingContext = {
    customerId: opts.customerId,
    isPortalCustomer,
    standardDiscountPercent,
    customerPrices: customerPricesResult.prices ?? [],
    advancedPricesByProductId,
    extendedPriceRuleId: settings.extendedPriceRuleId,
    additionalDiscountRuleId: settings.additionalDiscountRuleId,
  };
  pruneStalePricingCacheEntries(now);
  pricingContextCache.set(cacheKey, { ctx, coveredProductIds: new Set(opts.productIds), expiresAt: now + PRICING_CONTEXT_TTL_MS });
  return ctx;
}

export function resolveCpqCustomerUnitPriceNet(
  item: { productId: string; productNumber: string; quantity: number; fallbackUnitPriceNet: number },
  ctx: CpqCustomerPricingContext,
): { unitPriceNet: number; source: CpqPriceSource; referencePrice: number } {
  const productPrices = ctx.customerPrices.filter(
    (p) => p.productId === item.productId || (!!p.productNumber && p.productNumber === item.productNumber),
  );
  const individual = pickCustomerPriceForQuantity(productPrices, item.quantity);
  if (individual?.priceNet != null && individual.priceNet > 0) {
    return { unitPriceNet: individual.priceNet, source: "customer-individual", referencePrice: item.fallbackUnitPriceNet };
  }

  const tiers = ctx.advancedPricesByProductId.get(item.productId) ?? [];
  const pct = ctx.standardDiscountPercent ?? 0;

  if (ctx.isPortalCustomer) {
    const extendedTier = pickTierForRule(tiers, ctx.extendedPriceRuleId, item.quantity);
    if (extendedTier?.net != null && extendedTier.net > 0) {
      const unitPriceNet = pct > 0 ? Math.round(extendedTier.net * (1 - pct / 100) * 100) / 100 : extendedTier.net;
      // Referenzpreis für die Rabatt%-Anzeige ist der erweiterte Portal-Preis, NICHT der
      // generische Online-Shop-Preis — sonst würde der Standardrabatt% (z. B. 75 %) auf den
      // ohnehin schon reduzierten Portal-Preis draufgerechnet und die angezeigte Rabatt% würde
      // (produktabhängig unterschiedlich stark) über dem tatsächlich konfigurierten Prozentsatz
      // liegen, obwohl real exakt der konfigurierte Standardrabatt angewendet wurde.
      return { unitPriceNet, source: "extended-b2b", referencePrice: extendedTier.net };
    }
    return { unitPriceNet: item.fallbackUnitPriceNet, source: "fallback", referencePrice: item.fallbackUnitPriceNet };
  }

  // Onlineshop-Kunde: derselbe B2B-Standardrabatt%, aber auf den Standard-Onlineshop-Preis
  // (nicht den erweiterten Preis) — Bestpreis mit optionaler Zusatzrabatt-Regel, falls konfiguriert.
  const candidateB2B =
    pct > 0 ? Math.round(item.fallbackUnitPriceNet * (1 - pct / 100) * 100) / 100 : item.fallbackUnitPriceNet;

  const discountTier = pickTierForRule(tiers, ctx.additionalDiscountRuleId, item.quantity);
  const candidateRule = discountTier?.net != null && discountTier.net > 0 ? discountTier.net : null;

  if (candidateRule != null && candidateRule < candidateB2B) {
    return { unitPriceNet: candidateRule, source: "additional-discount", referencePrice: item.fallbackUnitPriceNet };
  }
  return { unitPriceNet: candidateB2B, source: pct > 0 ? "shop-b2b" : "fallback", referencePrice: item.fallbackUnitPriceNet };
}

export async function applyCpqCustomerPricing(
  items: BomLineItem[],
  opts: { customerId: string; storage: IStorage; client: ShopwareClient; tenantId?: string | null },
): Promise<{ items: BomLineItem[]; totalPrice: number; totalCatalogPrice: number }> {
  if (items.length === 0) return { items, totalPrice: 0, totalCatalogPrice: 0 };

  const productIds = [...new Set(items.map((i) => i.productId))];
  const ctx = await loadCpqCustomerPricingContext({
    customerId: opts.customerId,
    productIds,
    storage: opts.storage,
    client: opts.client,
    tenantId: opts.tenantId,
  });

  const pricedItems = items.map((item) => {
    const { unitPriceNet, referencePrice } = resolveCpqCustomerUnitPriceNet(
      { productId: item.productId, productNumber: item.productNumber, quantity: item.quantity, fallbackUnitPriceNet: item.unitPrice },
      ctx,
    );
    // Rabatt% wird gegen den tatsächlich zugrunde gelegten Referenzpreis berechnet (bei
    // Portal-Kunden der erweiterte Portal-Preis, sonst der Online-Shop-Preis) — nicht immer
    // gegen den generischen Online-Shop-Preis, sonst würde die angezeigte Rabatt% bei
    // Portal-Kunden über dem tatsächlich konfigurierten Standardrabatt liegen (siehe
    // resolveCpqCustomerUnitPriceNet).
    const catalogUnitPrice = referencePrice;
    const discountPercent =
      catalogUnitPrice > 0 ? Math.max(0, Math.round((1 - unitPriceNet / catalogUnitPrice) * 1000) / 10) : 0;
    return {
      ...item,
      unitPrice: unitPriceNet,
      lineTotal: Math.round(item.quantity * unitPriceNet * 100) / 100,
      catalogUnitPrice,
      discountPercent,
    };
  });

  const totalPrice = Math.round(pricedItems.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
  const totalCatalogPrice =
    Math.round(pricedItems.reduce((sum, i) => sum + i.quantity * i.catalogUnitPrice, 0) * 100) / 100;
  return { items: pricedItems, totalPrice, totalCatalogPrice };
}
