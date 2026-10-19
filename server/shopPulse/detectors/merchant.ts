/**
 * Shop-Puls Stufe 3 (S3-6), Google Merchant Center, nur lesend (Konzept 19.10.2026, Abschnitt 3; Tests in
 * tests/unit/shopPulseMerchant.test.ts). Einmal am Tag ab 7 Uhr; ohne Einrichtung setzt die Prüfung aus
 * (skipped "merchant", Hinweis auf der Seite).
 *
 * Feed-Artikel werden dem Shop über die Artikelnummer (offerId) zugeordnet, sonst über die EAN (GTIN). Gewichtet
 * wird nach dem Shop-Umsatz der letzten 365 Tage (MO, netto); Topseller = die Artikel mit zusammen 80 % des Umsatzes.
 *
 * - merchantDisapproved: abgelehnte Artikel (Ziel Deutschland abgelehnt oder Problem mit Schwere „abgelehnt“) mit
 *   Grund; kritisch, wenn ein Topseller dabei ist, sonst Warnung.
 * - merchantMismatch: Preis im Feed weicht um mehr als 1 % (und 5 Cent) vom Shop ab (brutto), oder der Feed sagt
 *   „auf Lager“, der Artikel ist im Shop aber nicht kaufbar bzw. ausverkauft (Abverkauf ohne Bestand) – und umgekehrt.
 * - merchantTopsellersMissing: kaufbare Topseller, die im Feed fehlen.
 * Werbekosten je Artikel kämen aus Google Ads (S2-4); solange Ads nicht eingerichtet ist, zählt nur der Umsatz.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { BuyabilityProduct } from "../buyabilityData";
import type { MerchantAccess, MerchantItem } from "../merchantClient";
import { isGa4DailyDue } from "./ga4";
import { isSellable, shortName, topsellers } from "./buyability";
import type { ShopPulseDetector } from "./types";

/** Merchant Center und EAN → Artikelnummer aus dem Produktspiegel */
export type MerchantSources = MerchantAccess & { eans(): Promise<Map<string, string>> };

export const MERCHANT_RULE = { priceTolerance: 0.01, priceMinDiff: 0.05, examples: 5 } as const;

type Matched = { item: MerchantItem; product: BuyabilityProduct | undefined };

const IN_STOCK = new Set(["in_stock", "instock", "preorder", "backorder"]);

/** Feed-Artikel ihren Shop-Artikeln zuordnen (Artikelnummer, sonst EAN) */
export function matchItems(items: MerchantItem[], products: BuyabilityProduct[], eans: Map<string, string>): Matched[] {
  const byNumber = new Map(products.map((p) => [p.productNumber.trim().toUpperCase(), p]));
  return items.map((item) => {
    let product = byNumber.get(item.offerId.toUpperCase());
    if (!product && item.gtin) {
      const pn = eans.get(item.gtin);
      if (pn) product = byNumber.get(pn.toUpperCase());
    }
    return { item, product };
  });
}

const examples = (list: string[]) => list.slice(0, MERCHANT_RULE.examples).join(", ");

export function merchantDetections(items: MerchantItem[], products: BuyabilityProduct[], revenue: Map<string, number>, eans: Map<string, string>): ShopPulseDetection[] {
  const out: ShopPulseDetection[] = [];
  const top = topsellers(revenue);
  const matched = matchItems(items, products, eans);
  const revenueOf = (m: Matched) => (m.product ? revenue.get(m.product.productNumber) ?? 0 : 0);

  // 1. Abgelehnt
  const rejected = matched.filter((m) => m.item.disapproved).sort((a, b) => revenueOf(b) - revenueOf(a));
  if (rejected.length) {
    const topRejected = rejected.filter((m) => m.product && top.has(m.product.productNumber));
    const reasons = new Map<string, number>();
    for (const m of rejected) for (const i of m.item.issues.filter((x) => x.severity === "DISAPPROVED")) reasons.set(i.description, (reasons.get(i.description) ?? 0) + 1);
    out.push({
      key: "merchant:disapproved",
      source: "merchant",
      code: "merchantDisapproved",
      severity: topRejected.length ? "critical" : "warning",
      params: {
        count: rejected.length,
        top: topRejected.length,
        revenue: Math.round(rejected.reduce((s, m) => s + revenueOf(m), 0)),
        reasons: Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([d, n]) => `${d} (${n})`).join("; ") || "–",
        examples: examples(rejected.map((m) => `${m.item.offerId} (${shortName(m.item.title)})`)),
      },
      evidence: { items: rejected.slice(0, 200).map((m) => ({ number: m.product?.productNumber ?? m.item.offerId, offerId: m.item.offerId, revenue: Math.round(revenueOf(m)), issues: m.item.issues })) },
    });
  }

  // 2. Preis oder Verfügbarkeit weichen vom Shop ab
  const mismatches: Array<{ m: Matched; kind: "price" | "availability"; feed: string; shop: string }> = [];
  for (const m of matched) {
    const p = m.product;
    if (!p) continue;
    if (m.item.price !== null && p.priceGross !== null && (m.item.currency ?? "EUR") === "EUR") {
      const diff = Math.abs(m.item.price - p.priceGross);
      if (diff > MERCHANT_RULE.priceMinDiff && diff > p.priceGross * MERCHANT_RULE.priceTolerance) mismatches.push({ m, kind: "price", feed: m.item.price.toFixed(2), shop: p.priceGross.toFixed(2) });
    }
    if (m.item.availability) {
      const feedInStock = IN_STOCK.has(m.item.availability);
      const soldOut = p.isCloseout === true && (p.stock ?? 0) < Math.max(1, p.minPurchase ?? 1);
      const shopBuyable = isSellable(p) && !soldOut;
      if (feedInStock !== shopBuyable) mismatches.push({ m, kind: "availability", feed: m.item.availability, shop: shopBuyable ? "kaufbar" : "nicht kaufbar" });
    }
  }
  if (mismatches.length) {
    mismatches.sort((a, b) => revenueOf(b.m) - revenueOf(a.m));
    out.push({
      key: "merchant:mismatch",
      source: "merchant",
      code: "merchantMismatch",
      severity: "warning",
      params: {
        count: mismatches.length,
        price: mismatches.filter((x) => x.kind === "price").length,
        availability: mismatches.filter((x) => x.kind === "availability").length,
        examples: examples(mismatches.map((x) => `${x.m.product!.productNumber}: ${x.kind === "price" ? `Feed ${x.feed} € / Shop ${x.shop} €` : `Feed ${x.feed} / Shop ${x.shop}`}`)),
      },
      evidence: { items: mismatches.slice(0, 200).map((x) => ({ number: x.m.product!.productNumber, kind: x.kind, feed: x.feed, shop: x.shop, revenue: Math.round(revenueOf(x.m)) })) },
    });
  }

  // 3. Topseller fehlen im Feed
  const inFeed = new Set(matched.filter((m) => m.product).map((m) => m.product!.productNumber));
  const missing = products
    .filter((p) => top.has(p.productNumber) && isSellable(p) && !p.isVariant && !p.isTechnical && !inFeed.has(p.productNumber))
    .sort((a, b) => (revenue.get(b.productNumber) ?? 0) - (revenue.get(a.productNumber) ?? 0));
  if (missing.length) {
    out.push({
      key: "merchant:topsellers-missing",
      source: "merchant",
      code: "merchantTopsellersMissing",
      severity: "warning",
      params: { count: missing.length, revenue: Math.round(missing.reduce((s, p) => s + (revenue.get(p.productNumber) ?? 0), 0)), examples: examples(missing.map((p) => `${p.productNumber} (${shortName(p.name)})`)) },
      evidence: { products: missing.map((p) => p.productNumber) },
    });
  }
  return out;
}

export const merchantDetector: ShopPulseDetector = {
  id: "merchantCenter",
  source: "merchant",
  due: isGa4DailyDue,
  async run(ctx) {
    const account = await ctx.merchant.account();
    const [items, products, revenue, eans] = await Promise.all([account.products(), ctx.buyability.products(), ctx.buyability.revenue(), ctx.merchant.eans()]);
    return merchantDetections(items, products, revenue, eans);
  },
};
