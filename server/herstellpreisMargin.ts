import type { IStorage } from "./storage";
import type { EnrichedShopwareCustomerPrice, ShopwareClient } from "./shopware";
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

/** Ergänzt Kundenpreise um Herstellkosten-Marge (nur % + Ampel, kein HK-Betrag). */
export async function enrichCustomerPricesWithHerstellMargin(
  prices: EnrichedShopwareCustomerPrice[],
  opts: {
    storage: IStorage;
    client: ShopwareClient;
    tenantId?: string | null;
    threshold?: number;
  },
): Promise<CustomerPriceWithHerstellMargin[]> {
  if (prices.length === 0) return [];

  const threshold = opts.threshold ?? DEFAULT_HERSTELL_MARGIN_THRESHOLD_PERCENT;
  const productIds = [
    ...new Set(prices.filter((p) => p.productId).map((p) => String(p.productId))),
  ];
  const lookupKeyByProductId = await opts.client.fetchProductHerstellpreisLookupKeys(productIds);

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
    const herstellMarginPercent = computeHerstellMarginPercent(price.priceNet, herstellpreisNet);
    const herstellMarginVerdict = computeHerstellMarginVerdict(herstellMarginPercent, threshold);

    return {
      ...price,
      herstellMarginPercent,
      herstellMarginVerdict,
    };
  });
}
