/**
 * Gemeinsame Preisbasis für Angebot (B2Bsellers) und Bestellung (Shopware-Kern).
 *
 * Reihenfolge je Position:
 *   1. Kundenindividueller Preis aus der B2Bsellers Suite (Produkt + Mengenstaffel +
 *      Währung + Gültigkeitsfenster)
 *   2. Kunden-Standardrabatt (B2Bsellers Discount-Rate-Addon / Customfield) auf den
 *      Listenpreis
 *   3. Listenpreis des Produkts (product.price in der Kanalwährung)
 *
 * Ein manueller Netto-Override aus dem Entwurf (manualUnitPriceNet) hat in den
 * Aufrufern Vorrang vor allen drei Stufen.
 */

import type { ShopwareClient, ShopwareCustomerPrice } from "./shopware";
import { fetchProductPricing, readAttr, round2, searchFirst, toShopwareUuid } from "./b2bOfferCreateContext";

export type CustomerPriceSource = "customer_specific" | "customer_discount" | "list";

export type ResolvedUnitPrice = {
  /** Effektiver Netto-Stückpreis */
  net: number;
  /** Listenpreis netto (Basis für Rabatt / Transparenz) */
  listNet: number;
  gross: number;
  taxRate: number;
  name: string;
  source: CustomerPriceSource;
  /** Nur bei source = customer_discount */
  discountPercent?: number;
  /** Nur bei source = customer_specific: Staffel "ab" */
  tierFrom?: number | null;
};

export type ResolveCustomerUnitPricesInput = {
  productId: string;
  productNumber?: string | null;
  quantity: number;
};

function normalizeId(id: string | null | undefined): string {
  return (id ?? "").replace(/-/g, "").toLowerCase();
}

function isWithinValidity(price: ShopwareCustomerPrice, now: Date): boolean {
  if (price.validFrom) {
    const from = new Date(price.validFrom);
    if (!Number.isNaN(from.getTime()) && from.getTime() > now.getTime()) return false;
  }
  if (price.validUntil) {
    const until = new Date(price.validUntil);
    if (!Number.isNaN(until.getTime()) && until.getTime() < now.getTime()) return false;
  }
  return true;
}

function matchesQuantityTier(price: ShopwareCustomerPrice, quantity: number): boolean {
  const from = price.from ?? 1;
  if (quantity < from) return false;
  if (price.to != null && quantity > price.to) return false;
  return true;
}

/**
 * Wählt den passenden kundenindividuellen Preis für Produkt + Menge.
 * Bei mehreren Treffern gewinnt die höchste Staffel-Untergrenze (spezifischste Staffel).
 */
export function pickCustomerSpecificPrice(
  prices: ShopwareCustomerPrice[],
  item: ResolveCustomerUnitPricesInput,
  now = new Date()
): ShopwareCustomerPrice | null {
  const wantedId = normalizeId(item.productId);
  const wantedNumber = (item.productNumber ?? "").trim();
  let best: ShopwareCustomerPrice | null = null;
  for (const price of prices) {
    if (price.priceNet == null || !Number.isFinite(price.priceNet) || price.priceNet < 0) continue;
    const byId = price.productId ? normalizeId(price.productId) === wantedId : false;
    const byNumber = wantedNumber && price.productNumber ? price.productNumber.trim() === wantedNumber : false;
    if (!byId && !byNumber) continue;
    if (!isWithinValidity(price, now)) continue;
    if (!matchesQuantityTier(price, item.quantity)) continue;
    if (!best || (price.from ?? 1) > (best.from ?? 1)) best = price;
  }
  return best;
}

export async function fetchCurrencyIsoCode(client: ShopwareClient, currencyId: string): Promise<string | null> {
  try {
    const row = await searchFirst(client, "currency", {
      limit: 1,
      filter: [{ type: "equals", field: "id", value: toShopwareUuid(currencyId) }],
    });
    const iso = readAttr(row, "isoCode");
    return typeof iso === "string" && iso.trim() ? iso.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Ermittelt je Produkt den effektiven Netto-Stückpreis für einen Shopware-Kunden.
 * Fehler beim Laden von Kundenpreisen/Rabatt werden protokolliert und führen zum
 * Listenpreis — die Erstellung selbst bricht dadurch nicht ab. Die Quelle steht im
 * Ergebnis, damit die Strikt-Regel eine unsichere Preisbasis erkennen kann.
 */
export async function resolveCustomerUnitPrices(
  client: ShopwareClient,
  params: {
    customerId: string;
    currencyId: string;
    items: ResolveCustomerUnitPricesInput[];
  }
): Promise<{ prices: Map<string, ResolvedUnitPrice>; customerPricesAvailable: boolean; discountPercent: number | null }> {
  const result = new Map<string, ResolvedUnitPrice>();
  if (params.items.length === 0) {
    return { prices: result, customerPricesAvailable: false, discountPercent: null };
  }

  const productIds = Array.from(new Set(params.items.map((i) => toShopwareUuid(i.productId))));
  const [listPricing, currencyIso] = await Promise.all([
    fetchProductPricing(client, productIds, params.currencyId),
    fetchCurrencyIsoCode(client, params.currencyId),
  ]);

  let customerPrices: ShopwareCustomerPrice[] = [];
  let customerPricesAvailable = false;
  try {
    const fetched = await client.fetchAllCustomerSpecificPrices({
      customerId: params.customerId,
      currencyIsoCode: currencyIso,
      includeProductNames: false,
    });
    customerPrices = fetched.prices;
    customerPricesAvailable = fetched.available;
  } catch (error) {
    console.warn(
      "[CustomerPricing] Kundenindividuelle Preise konnten nicht geladen werden:",
      error instanceof Error ? error.message : error
    );
  }

  let discountPercent: number | null = null;
  try {
    discountPercent = await client.fetchCustomerB2BStandardDiscount(params.customerId);
  } catch (error) {
    console.warn(
      "[CustomerPricing] Kundenrabatt konnte nicht geladen werden:",
      error instanceof Error ? error.message : error
    );
  }
  if (discountPercent != null && (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent >= 100)) {
    discountPercent = null;
  }

  const now = new Date();
  for (const item of params.items) {
    const productId = toShopwareUuid(item.productId);
    const list = listPricing.get(productId);
    const listNet = list?.net ?? 0;
    const taxRate = list?.taxRate ?? 0;
    const base: Omit<ResolvedUnitPrice, "net" | "source"> = {
      listNet,
      gross: list?.gross ?? listNet,
      taxRate,
      name: list?.name ?? "",
    };

    const specific = pickCustomerSpecificPrice(customerPrices, { ...item, productId }, now);
    if (specific && specific.priceNet != null) {
      result.set(productId, {
        ...base,
        net: round2(specific.priceNet),
        source: "customer_specific",
        tierFrom: specific.from ?? null,
      });
      continue;
    }

    if (discountPercent != null && listNet > 0) {
      result.set(productId, {
        ...base,
        net: round2(listNet * (1 - discountPercent / 100)),
        source: "customer_discount",
        discountPercent,
      });
      continue;
    }

    result.set(productId, { ...base, net: round2(listNet), source: "list" });
  }

  return { prices: result, customerPricesAvailable, discountPercent };
}
