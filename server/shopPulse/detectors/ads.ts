/**
 * Shop-Puls Stufe 2 (S2-4), Google Ads: Werbekosten gegen Bestellungen und Deckungsbeitrag, nur lesend.
 * Einmal am Tag ab 7 Uhr (Berlin), fünf Abfragen je Konto (adsClient.ts). Ist Ads nicht eingerichtet, setzt
 * die Prüfung aus (Hinweis auf der Seite), wie GA4. Alle Funde gehen zuerst an Oliver (Zuständiger „oliver“):
 * Er entscheidet, was an Smarketer weitergeht. METAorder ändert an Kampagnen nichts.
 *
 * 1. Kosten ohne Ergebnis: Anzeigengruppe mit über 150 € Kosten in 14 Tagen und 0 Conversions
 * 2. Kosten je Bestellung über dem Ø Deckungsbeitrag: Kampagne (28 Tage, mindestens 3 Conversions), deren
 *    Kosten je Conversion über dem Ø Deckungsbeitrag je MO-Bestellung derselben 28 Tage liegen
 * 3. Shopping auf nicht kaufbare Artikel: Shopping-Artikel mit mindestens 20 € Kosten in 7 Tagen, die laut
 *    Produktspiegel nicht kaufbar sind (fehlt, inaktiv, nicht im Kanal, Preis 0, Abverkauf ohne Bestand);
 *    kritisch, also sofort
 * 4. Teure Suchbegriffe ohne Bestellung: mindestens 30 € und 5 Klicks in 28 Tagen, 0 Conversions → Liste mit
 *    Vorschlägen für auszuschließende Begriffe (exakt)
 * 5. Messung intakt: Ads-Conversions je MO-Bestellung der letzten 7 Tage deutlich unter den 28 Tagen davor
 *    (wie GA4: höchstens 40 % und 2,5 Standardabweichungen); 0 Conversions bei Kosten und mindestens 10
 *    MO-Bestellungen ist kritisch
 * 6. Mehr Budget lohnt: Kampagne verliert mindestens 20 % der Impressionen wegen des Budgets und ihr
 *    geschätzter Deckungsbeitrag (Conversions × Ø Deckungsbeitrag) ist mindestens doppelt so hoch wie die Kosten
 *
 * Conversions sind die Käufe laut Ads (Zählung von Smarketer); welcher MO-Bestellung sie entsprechen, weiß
 * METAorder nicht. Shopping-Artikel-IDs vergleicht die Prüfung ohne Groß/Klein mit der Artikelnummer.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { BuyabilityProduct } from "../buyabilityData";
import { addDays, berlinTime, type PulseOrder } from "../pulseOrders";
import type { AdsAccount, AdsData } from "../adsClient";
import { loadAdsData } from "../adsClient";
import { DE_CHANNEL_ID, isSellable } from "./buyability";
import { isGa4DailyDue, significantDrop } from "./ga4";
import type { ShopPulseDetector } from "./types";

export const ADS_RULES = {
  noResultCost: 150,
  noResultListed: 10,
  marginMinConversions: 3,
  unbuyableMinCost: 20,
  termMinCost: 30,
  termMinClicks: 5,
  termsListed: 30,
  budgetLostMin: 0.2,
  budgetDbFactor: 2,
  measurement: { minExpected: 6, maxShare: 0.4, z: 2.5 },
  measurementMinOrders: 10,
} as const;

/** Datenquellen der Ads-Prüfung */
export type AdsSources = {
  /** Konto; wirft AdsNotConfiguredError, wenn nicht eingerichtet */
  account(): Promise<AdsAccount>;
  /** Ø Deckungsbeitrag (DB1 netto) je MO-Bestellung mit Herstellpreis von bis (Kalendertage); null = keiner */
  avgDb1PerOrder(from: string, to: string): Promise<number | null>;
};

const round2 = (x: number) => Math.round(x * 100) / 100;
const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const EURO0 = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 });
/** Geschäftsstunden je Tag (wie lossPerHourOf): Kosten je Stunde = Kosten / Tage / 12 */
const perHour = (cost: number, days: number) => Math.round(cost / days / 12) || null;

// ---------------------------------------------------------------------------------------------

export function noResultDetections(data: Pick<AdsData, "groups">): ShopPulseDetection[] {
  return data.groups
    .filter((g) => g.cost > ADS_RULES.noResultCost && g.conversions === 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, ADS_RULES.noResultListed)
    .map((g) => ({
      key: `ads:noresult:${g.customerId}:${g.adGroupId}`,
      source: "ads" as const,
      code: "adsCostNoResult" as const,
      severity: "warning" as const,
      params: { campaign: short(g.campaign), adGroup: short(g.adGroup), cost: round2(g.cost), clicks: g.clicks, days: 14 },
      evidence: { customerId: g.customerId, campaignId: g.campaignId, adGroupId: g.adGroupId, cost: g.cost, clicks: g.clicks, conversions: g.conversions },
      lossPerHour: perHour(g.cost, 14),
    }));
}

export function marginDetections(data: Pick<AdsData, "campaigns">, avgDb1: number | null): ShopPulseDetection[] {
  if (avgDb1 == null || avgDb1 <= 0) return [];
  return data.campaigns
    .filter((c) => c.conversions >= ADS_RULES.marginMinConversions && c.cost / c.conversions > avgDb1)
    .map((c) => {
      const cpa = round2(c.cost / c.conversions);
      return {
        key: `ads:margin:${c.customerId}:${c.campaignId}`,
        source: "ads" as const,
        code: "adsCostAboveMargin" as const,
        severity: "warning" as const,
        params: { campaign: short(c.campaign), cost: round2(c.cost), conversions: round1(c.conversions), costPerConversion: cpa, avgDb1: round2(avgDb1) },
        evidence: { customerId: c.customerId, campaignId: c.campaignId, channel: c.channel, days: 28 },
        lossPerHour: perHour((cpa - avgDb1) * c.conversions, 28),
      };
    });
}

export type UnbuyableReason = "missing" | "inactive" | "hidden" | "priceZero" | "soldOut";

export function unbuyableReason(p: BuyabilityProduct | undefined, channelId = DE_CHANNEL_ID): UnbuyableReason | null {
  if (!p) return "missing";
  if (!p.active) return "inactive";
  if (!isSellable(p, channelId)) return "hidden";
  if (p.priceGross != null && p.priceGross <= 0) return "priceZero";
  if (p.isCloseout && (p.stock ?? 0) <= 0) return "soldOut";
  return null;
}

export function shoppingDetections(data: Pick<AdsData, "products">, products: BuyabilityProduct[]): ShopPulseDetection[] {
  const byNumber = new Map(products.map((p) => [p.productNumber.trim().toLowerCase(), p]));
  const costByItem = new Map<string, { cost: number; clicks: number }>();
  for (const r of data.products) {
    const id = r.itemId.trim().toLowerCase();
    if (!id) continue;
    const prev = costByItem.get(id) ?? { cost: 0, clicks: 0 };
    costByItem.set(id, { cost: prev.cost + r.cost, clicks: prev.clicks + r.clicks });
  }
  const hits = Array.from(costByItem.entries())
    .map(([id, v]) => ({ id, ...v, product: byNumber.get(id), reason: unbuyableReason(byNumber.get(id)) }))
    .filter((h) => h.reason && h.cost >= ADS_RULES.unbuyableMinCost)
    .sort((a, b) => b.cost - a.cost);
  if (!hits.length) return [];
  const cost = round2(sum(hits.map((h) => h.cost)));
  return [
    {
      key: "ads:shopping:unbuyable",
      source: "ads",
      code: "adsShoppingUnbuyable",
      severity: "critical",
      params: {
        count: hits.length,
        cost,
        examples: hits
          .slice(0, 5)
          .map((h) => `${h.product?.productNumber ?? h.id} (${EURO0.format(h.cost)} €)`)
          .join(", "),
      },
      evidence: { days: 7, products: hits.map((h) => ({ itemId: h.id, number: h.product?.productNumber ?? h.id, reason: h.reason, cost: round2(h.cost), clicks: h.clicks })) },
      lossPerHour: perHour(cost, 7),
    },
  ];
}

/** Vorschlag zum Ausschließen: exakter Begriff in eckigen Klammern (Ads-Schreibweise für „genau passend“) */
export const negativeOf = (term: string) => `[${term.trim().toLowerCase()}]`;

export function searchTermDetections(data: Pick<AdsData, "terms">): ShopPulseDetection[] {
  const byTerm = new Map<string, { term: string; cost: number; clicks: number; conversions: number; campaigns: Set<string> }>();
  for (const t of data.terms) {
    const key = t.term.trim().toLowerCase();
    if (!key) continue;
    const prev = byTerm.get(key) ?? { term: t.term.trim(), cost: 0, clicks: 0, conversions: 0, campaigns: new Set<string>() };
    prev.cost += t.cost;
    prev.clicks += t.clicks;
    prev.conversions += t.conversions;
    prev.campaigns.add(t.campaign);
    byTerm.set(key, prev);
  }
  const waste = Array.from(byTerm.values())
    .filter((t) => t.conversions === 0 && t.cost >= ADS_RULES.termMinCost && t.clicks >= ADS_RULES.termMinClicks)
    .sort((a, b) => b.cost - a.cost);
  if (!waste.length) return [];
  const cost = round2(sum(waste.map((t) => t.cost)));
  return [
    {
      key: "ads:searchterms",
      source: "ads",
      code: "adsSearchTermsWaste",
      severity: "warning",
      params: {
        count: waste.length,
        cost,
        terms: waste
          .slice(0, 5)
          .map((t) => `„${short(t.term, 40)}“ (${EURO0.format(t.cost)} €)`)
          .join(", "),
      },
      evidence: {
        days: 28,
        suggestions: waste.slice(0, ADS_RULES.termsListed).map((t) => ({ term: t.term, cost: round2(t.cost), clicks: t.clicks, campaigns: Array.from(t.campaigns).slice(0, 3), negative: negativeOf(t.term) })),
      },
      lossPerHour: perHour(cost, 28),
    },
  ];
}

export function measurementDetections(data: Pick<AdsData, "days">, orders: Pick<PulseOrder, "day">[], yesterday: string): ShopPulseDetection[] {
  const curFrom = addDays(yesterday, -6);
  const baseFrom = addDays(curFrom, -28);
  const baseTo = addDays(curFrom, -1);
  const adsIn = (from: string, to: string, f: "cost" | "conversions") => sum(data.days.filter((d) => d.day >= from && d.day <= to).map((d) => d[f]));
  const ordersIn = (from: string, to: string) => orders.filter((o) => o.day >= from && o.day <= to).length;
  const curOrders = ordersIn(curFrom, yesterday);
  const curConv = adsIn(curFrom, yesterday, "conversions");
  const curCost = adsIn(curFrom, yesterday, "cost");
  if (curOrders < ADS_RULES.measurementMinOrders) return [];
  const base = { orders: ordersIn(baseFrom, baseTo), conversions: adsIn(baseFrom, baseTo, "conversions") };
  const params = (expectedPercent: number | null) => ({ from: curFrom, to: yesterday, current: round1((curConv / curOrders) * 100), expected: expectedPercent ?? 0, orders: curOrders });
  const evidence = { current: { conversions: round1(curConv), cost: round2(curCost), moOrders: curOrders }, baseline: { from: baseFrom, ...base } };
  if (curConv === 0 && curCost > 0) {
    const expected = base.orders > 0 ? round1((base.conversions / base.orders) * 100) : null;
    return [{ key: "ads:measurement", source: "ads", code: "adsMeasurementDrop", severity: "critical", params: params(expected), evidence }];
  }
  if (base.orders < 20 || base.conversions < 10) return [];
  const ratio = base.conversions / base.orders;
  if (!significantDrop(curConv, curOrders * ratio, ADS_RULES.measurement)) return [];
  return [{ key: "ads:measurement", source: "ads", code: "adsMeasurementDrop", severity: "warning", params: params(round1(ratio * 100)), evidence }];
}

export function budgetDetections(data: Pick<AdsData, "campaigns">, avgDb1: number | null): ShopPulseDetection[] {
  if (avgDb1 == null || avgDb1 <= 0) return [];
  return data.campaigns
    .filter((c) => c.budgetLost != null && c.budgetLost >= ADS_RULES.budgetLostMin && c.conversions >= ADS_RULES.marginMinConversions)
    .map((c) => ({ c, estDb1: round2(c.conversions * avgDb1) }))
    .filter(({ c, estDb1 }) => estDb1 >= ADS_RULES.budgetDbFactor * c.cost)
    .map(({ c, estDb1 }) => ({
      key: `ads:budget:${c.customerId}:${c.campaignId}`,
      source: "ads" as const,
      code: "adsBudgetLimited" as const,
      severity: "warning" as const,
      params: { campaign: short(c.campaign), lost: round1((c.budgetLost ?? 0) * 100), cost: round2(c.cost), estDb1, conversions: round1(c.conversions) },
      evidence: { customerId: c.customerId, campaignId: c.campaignId, channel: c.channel, days: 28, avgDb1: round2(avgDb1) },
    }));
}

/** Alle Ads-Prüfungen auf geladenen Daten */
export function adsDetections(input: { data: AdsData; products: BuyabilityProduct[] | null; orders: Pick<PulseOrder, "day">[]; avgDb1: number | null; yesterday: string }): ShopPulseDetection[] {
  return [
    ...noResultDetections(input.data),
    ...marginDetections(input.data, input.avgDb1),
    ...(input.products ? shoppingDetections(input.data, input.products) : []),
    ...searchTermDetections(input.data),
    ...measurementDetections(input.data, input.orders, input.yesterday),
    ...budgetDetections(input.data, input.avgDb1),
  ];
}

export const adsDetector: ShopPulseDetector = {
  id: "googleAds",
  source: "ads",
  keyPrefix: "ads:",
  due: isGa4DailyDue,
  needsFreshMirror: true,
  async run(ctx) {
    const account = await ctx.ads.account();
    const yesterday = addDays(berlinTime(ctx.now).day, -1);
    const data = await loadAdsData(account, yesterday);
    // ohne Produktspiegel fällt nur die Shopping-Prüfung aus
    const products = await ctx.buyability.products().catch(() => null);
    const avgDb1 = await ctx.ads.avgDb1PerOrder(addDays(yesterday, -27), yesterday).catch(() => null);
    return adsDetections({ data, products, orders: await ctx.orders(), avgDb1, yesterday });
  },
};
