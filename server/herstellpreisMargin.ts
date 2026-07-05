import type { IStorage } from "./storage";
import type {
  EnrichedShopwareCustomerPrice,
  ShopwareAdvancedPrice,
  ShopwareClient,
} from "./shopware";
import { productIdLookupKeys } from "./pricingUtils";
import { getHerstellpreisLookupKey } from "./productIdentifiers";

export type HerstellMarginVerdict = "green" | "red" | "none";

export const DEFAULT_HERSTELL_MARGIN_THRESHOLD_PERCENT = 7;

/** Aufschlag in % relativ zu importierten Herstellkosten: (VK − HK) / HK × 100. */
export function computeHerstellMarginPercent(
  priceNet: number | null | undefined,
  herstellpreisNet: number | null | undefined,
): number | null {
  if (priceNet == null || herstellpreisNet == null || herstellpreisNet <= 0) return null;
  return Math.round(((priceNet - herstellpreisNet) / herstellpreisNet) * 1000) / 10;
}

export function computeHerstellMarginVerdict(
  marginPercent: number | null,
  threshold = DEFAULT_HERSTELL_MARGIN_THRESHOLD_PERCENT,
): HerstellMarginVerdict {
  if (marginPercent == null) return "none";
  return marginPercent >= threshold ? "green" : "red";
}

/** Passende Staffel aus Shopware-Erweiterpreisen für eine Menge wählen. */
export function pickAdvancedPriceTier(
  tiers: ShopwareAdvancedPrice[],
  quantity: number | null | undefined,
): ShopwareAdvancedPrice | null {
  if (tiers.length === 0) return null;
  const qty = quantity != null && quantity > 0 ? quantity : 1;

  const matching = tiers.filter(
    (tier) =>
      tier.quantityStart <= qty &&
      (tier.quantityEnd == null || tier.quantityEnd >= qty) &&
      tier.net != null &&
      tier.net > 0,
  );
  if (matching.length > 0) {
    return matching.sort((a, b) => b.quantityStart - a.quantityStart)[0] ?? null;
  }

  const fallback = tiers.find((tier) => tier.net != null && tier.net > 0);
  return fallback ?? null;
}

/**
 * Effektiver Verkaufspreis netto nach Rabatten für die CRM-Marge:
 * 1. Kundenpreis netto (B2Bsellers)
 * 2. Erweiterte Staffelpreise (Shopware)
 * 3. Katalogpreis mit firmenweitem B2B-Standardrabatt
 */
export function resolveCrmSellingPriceNet(input: {
  customerPriceNet: number | null | undefined;
  quantityFrom: number | null | undefined;
  catalogPriceNet: number | null | undefined;
  advancedPrices?: ShopwareAdvancedPrice[] | null;
  standardDiscountPercent?: number | null;
}): number | null {
  if (input.customerPriceNet != null && input.customerPriceNet > 0) {
    return input.customerPriceNet;
  }

  const advancedTier = pickAdvancedPriceTier(input.advancedPrices ?? [], input.quantityFrom);
  if (advancedTier?.net != null && advancedTier.net > 0) {
    return advancedTier.net;
  }

  if (
    input.catalogPriceNet != null &&
    input.catalogPriceNet > 0 &&
    input.standardDiscountPercent != null &&
    input.standardDiscountPercent > 0
  ) {
    return Math.round(input.catalogPriceNet * (1 - input.standardDiscountPercent / 100) * 100) / 100;
  }

  return null;
}

export type CustomerPriceWithHerstellMargin = EnrichedShopwareCustomerPrice & {
  herstellMarginPercent: number | null;
  herstellMarginVerdict: HerstellMarginVerdict;
};

function lookupHerstellpreisKey(
  lookupKeyByProductId: Map<string, string>,
  productId: string | null | undefined,
  productNumber: string | null | undefined,
): string | undefined {
  if (productId) {
    for (const key of productIdLookupKeys(productId)) {
      const hit = lookupKeyByProductId.get(key);
      if (hit) return hit;
    }
  }
  return getHerstellpreisLookupKey(undefined, productNumber ?? undefined);
}

function lookupProductContext<T>(
  map: Map<string, T>,
  productId: string | null | undefined,
): T | null {
  if (!productId) return null;
  for (const key of productIdLookupKeys(productId)) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return null;
}

/** Ergänzt Kundenpreise um Herstellkosten-Marge (nur % + Ampel, kein HK-Betrag). */
export async function enrichCustomerPricesWithHerstellMargin(
  prices: EnrichedShopwareCustomerPrice[],
  opts: {
    storage: IStorage;
    client: ShopwareClient;
    tenantId?: string | null;
    threshold?: number;
    standardDiscountPercent?: number | null;
  },
): Promise<CustomerPriceWithHerstellMargin[]> {
  if (prices.length === 0) return [];

  const threshold = opts.threshold ?? DEFAULT_HERSTELL_MARGIN_THRESHOLD_PERCENT;
  const productIds = [
    ...new Set(prices.filter((p) => p.productId).map((p) => String(p.productId))),
  ];

  const [lookupKeyByProductId, sellingContextByProductId] = await Promise.all([
    opts.client.fetchProductHerstellpreisLookupKeys(productIds),
    opts.client.fetchProductCrmSellingContext(productIds),
  ]);

  const lookupKeys = new Set<string>();
  for (const price of prices) {
    const key = lookupHerstellpreisKey(lookupKeyByProductId, price.productId, price.productNumber);
    if (key) lookupKeys.add(key);
  }

  const herstellMap =
    lookupKeys.size > 0
      ? await opts.storage.getProductHerstellpreiseByProductNumbers([...lookupKeys], opts.tenantId)
      : new Map<string, number>();

  return prices.map((price) => {
    const lookupKey = lookupHerstellpreisKey(lookupKeyByProductId, price.productId, price.productNumber);
    const herstellpreisNet = lookupKey ? (herstellMap.get(lookupKey) ?? null) : null;
    const sellingContext = lookupProductContext(sellingContextByProductId, price.productId);

    const sellingPriceNet = resolveCrmSellingPriceNet({
      customerPriceNet: price.priceNet,
      quantityFrom: price.from,
      catalogPriceNet: price.catalogPriceNet ?? sellingContext?.catalogPriceNet ?? null,
      advancedPrices: sellingContext?.advancedPrices ?? [],
      standardDiscountPercent: opts.standardDiscountPercent,
    });

    const herstellMarginPercent = computeHerstellMarginPercent(sellingPriceNet, herstellpreisNet);
    const herstellMarginVerdict = computeHerstellMarginVerdict(herstellMarginPercent, threshold);

    return {
      ...price,
      herstellMarginPercent,
      herstellMarginVerdict,
    };
  });
}
