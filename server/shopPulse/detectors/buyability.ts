/**
 * Shop-Puls, Kaufbarkeit der Stammdaten (Konzept Stufe 1, Abschnitt 2 B1; PR C). Tests in
 * tests/unit/shopPulseBuyability.test.ts.
 *
 * Gewichtung nach Shop-Umsatz: Topseller sind die Artikel, die zusammen 80 % des Netto-Umsatzes der
 * MO-Bestellungen der letzten 365 Tage ausmachen (Live 17.10.2026: 269 von 784). Ein Fund bei einem
 * Topseller ist „kritisch“ (Sofort-Meldung je Artikel), bei den übrigen Artikeln „Warnung“ (eine
 * Sammelmeldung je Prüfung im Tagesbericht).
 *
 * Soll-Stand statt Ist-Zustand: Viele umsatzstarke Artikel sind bewusst nicht mehr im DE-Shop (durch neue
 * Artikelnummern ersetzt, Live 17.10.2026: 41 der Topseller). Gemeldet wird deshalb, was im Soll-Stand
 * kaufbar war und es jetzt nicht mehr ist. Neue kaufbare Artikel kommen von selbst in den Soll-Stand;
 * bewusst entfernte bestätigt man auf der Seite mit „Als Soll übernehmen“. Ebenso Zahl- und Versandarten.
 *
 * Datenlücken (kein Bild, keine Kategorie, Mehrstück-Artikel mit Verkaufseinheit 1) werden nicht gemeldet
 * und nicht im Shop korrigiert, sondern für die PIM-Sammlung (Jana) als Liste gespeichert.
 */
import type { ShopPulseDataGap, ShopPulseDataGaps, ShopPulseDetection } from "@shared/shopPulse";
import type { BuyabilityProduct, PriceChange } from "../buyabilityData";
import type { ChannelMethod, ChannelMethods, ShopPulseDetector, ShopPulseDetectorContext } from "./types";

/** Verkaufskanal META Regalbau DE (dieselbe ID in Testshop und Live) */
export const DE_CHANNEL_ID = "018ec134507f703b82a76467791e7e61";
export const TOPSELLER_SHARE = 0.8;
export const PRICE_JUMP_RATIO = 0.3;
export const LONG_RESTOCK_DAYS = 20;
/** Preisänderungen höchstens so weit zurück (falls der Nachtlauf ein paar Tage nicht lief) */
const PRICE_LOOKBACK_MAX_MS = 3 * 24 * 60 * 60 * 1000;
const PRICE_LOOKBACK_DEFAULT_MS = 26 * 60 * 60 * 1000;
const PRICE_OVERLAP_MS = 60 * 60 * 1000;
const EXAMPLES = 3;

export const BUYABILITY_BASELINE_KEY = "shop_pulse_buyability_baseline";
export const DATA_GAPS_KEY = "shop_pulse_data_gaps";

/** Soll-Stand: kaufbare Artikel mit Umsatz, Zahl- und Versandarten des Kanals */
export type BuyabilityBaseline = {
  takenAt: string;
  products?: string[];
  payment?: Array<Pick<ChannelMethod, "id" | "name">>;
  shipping?: Array<Pick<ChannelMethod, "id" | "name">>;
};

const round = (x: number) => Math.round(x);
/** Grober Verlust eines nicht kaufbaren Artikels: Jahresumsatz brutto je Geschäftsstunde (12 h, 365 Tage) */
export const lossPerHourOf = (net: number) => Math.round((net * 1.19) / 365 / 12) || null;
export const shortName = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);
const examplesOf = (list: BuyabilityProduct[]) =>
  list
    .slice(0, EXAMPLES)
    .map((p) => `${p.productNumber} (${shortName(p.name)})`)
    .join(", ");

export function isSellable(p: BuyabilityProduct | undefined, channelId = DE_CHANNEL_ID): boolean {
  return !!p && p.active && p.salesChannelIds.includes(channelId);
}

/** Topseller: kleinste Menge der umsatzstärksten Artikel, die zusammen 80 % des Umsatzes erreichen */
export function topsellers(revenue: Map<string, number>, share = TOPSELLER_SHARE): Set<string> {
  const ranked = Array.from(revenue.entries()).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0);
  const top = new Set<string>();
  let cum = 0;
  for (const [pn, v] of ranked) {
    if (cum >= total * share) break;
    top.add(pn);
    cum += v;
  }
  return top;
}

// ---------------------------------------------------------------------------------------------
// Artikel (Nachtlauf)

export type ProductCheckInput = {
  products: BuyabilityProduct[];
  revenue: Map<string, number>;
  priceChanges: PriceChange[];
  /** Soll-Stand der kaufbaren Artikel mit Umsatz; undefined = noch keiner (erster Lauf) */
  baselineProducts: string[] | undefined;
  channelId?: string;
};

export type ProductCheckResult = {
  detections: ShopPulseDetection[];
  /** neuer Soll-Stand: bisheriger plus alle jetzt kaufbaren Artikel mit Umsatz */
  baselineProducts: string[];
  dataGaps: ShopPulseDataGap[];
};

export function productBuyabilityDetections(input: ProductCheckInput): ProductCheckResult {
  const channelId = input.channelId ?? DE_CHANNEL_ID;
  const byNumber = new Map(input.products.map((p) => [p.productNumber, p]));
  const top = topsellers(input.revenue);
  const detections: ShopPulseDetection[] = [];
  const revenueOf = (pn: string) => input.revenue.get(pn) ?? 0;
  const params = (p: BuyabilityProduct) => ({ number: p.productNumber, name: shortName(p.name), revenue: round(revenueOf(p.productNumber)) });
  const sellable = input.products.filter((p) => !p.isVariant && isSellable(p, channelId));

  /** Topseller einzeln kritisch, die übrigen als eine Sammel-Warnung */
  const split = (list: BuyabilityProduct[], perTop: (p: BuyabilityProduct) => ShopPulseDetection, other: (rest: BuyabilityProduct[]) => ShopPulseDetection) => {
    const rest: BuyabilityProduct[] = [];
    for (const p of list) {
      if (top.has(p.productNumber)) detections.push(perTop(p));
      else rest.push(p);
    }
    if (rest.length) detections.push(other(rest.sort((a, b) => revenueOf(b.productNumber) - revenueOf(a.productNumber))));
  };

  // 1. Nicht mehr kaufbar: im Soll-Stand kaufbar, jetzt inaktiv, nicht im Kanal oder gelöscht
  const sellableWithRevenue = sellable.filter((p) => revenueOf(p.productNumber) > 0).map((p) => p.productNumber);
  if (input.baselineProducts) {
    const gone: BuyabilityProduct[] = [];
    for (const pn of input.baselineProducts) {
      const p = byNumber.get(pn);
      if (isSellable(p, channelId)) continue;
      gone.push(p ?? { productNumber: pn, name: "", active: false, salesChannelIds: [], priceGross: null, stock: null, deliveryTimeId: null, restockTime: null, categoryCount: 0, isVariant: false });
    }
    split(
      gone,
      (p) => ({
        key: `buyability:product:unavailable:${p.productNumber}`,
        source: "buyability",
        code: !byNumber.has(p.productNumber) ? "topsellerMissing" : !p.active ? "topsellerInactive" : "topsellerHidden",
        severity: "critical",
        params: params(p),
        evidence: { active: p.active, salesChannelIds: p.salesChannelIds },
        lossPerHour: lossPerHourOf(revenueOf(p.productNumber)),
      }),
      (rest) => ({
        key: "buyability:product:unavailable:other",
        source: "buyability",
        code: "productsUnavailable",
        severity: "warning",
        params: { count: rest.length, examples: examplesOf(rest) },
        evidence: { products: rest.map((p) => p.productNumber) },
      }),
    );
  }
  const baselineProducts = Array.from(new Set([...(input.baselineProducts ?? []), ...sellableWithRevenue])).sort();

  // 2. Preis 0 €
  split(
    sellable.filter((p) => p.priceGross !== null && p.priceGross <= 0),
    (p) => ({ key: `buyability:product:price-zero:${p.productNumber}`, source: "buyability", code: "topsellerPriceZero", severity: "critical", params: params(p), lossPerHour: lossPerHourOf(revenueOf(p.productNumber)) }),
    (rest) => ({ key: "buyability:product:price-zero:other", source: "buyability", code: "productsPriceZero", severity: "warning", params: { count: rest.length, examples: examplesOf(rest) }, evidence: { products: rest.map((p) => p.productNumber) } }),
  );

  // 3. Preissprung über ±30 % (je Artikel die letzte Änderung im Zeitraum)
  const lastChange = new Map<string, PriceChange>();
  for (const c of input.priceChanges) {
    const prev = lastChange.get(c.productNumber);
    if (!prev || c.changedAt.getTime() > prev.changedAt.getTime()) lastChange.set(c.productNumber, c);
  }
  for (const c of Array.from(lastChange.values())) {
    const p = byNumber.get(c.productNumber);
    if (!p || !isSellable(p, channelId) || !c.oldPriceGross || c.oldPriceGross <= 0) continue;
    const ratio = c.newPriceGross / c.oldPriceGross - 1;
    if (Math.abs(ratio) < PRICE_JUMP_RATIO) continue;
    detections.push({
      key: `buyability:product:price-jump:${p.productNumber}`,
      source: "buyability",
      code: "priceJump",
      severity: top.has(p.productNumber) ? "critical" : "warning",
      params: { number: p.productNumber, name: shortName(p.name), oldPrice: c.oldPriceGross, newPrice: c.newPriceGross, percent: Math.round(ratio * 100) },
      evidence: { changedAt: c.changedAt.toISOString() },
    });
  }

  // 4. Abverkauf ohne Bestand: nicht bestellbar (weniger Bestand als die Mindestabnahme)
  split(
    sellable.filter((p) => p.isCloseout === true && (p.stock ?? 0) < Math.max(1, p.minPurchase ?? 1)),
    (p) => ({ key: `buyability:product:sold-out:${p.productNumber}`, source: "buyability", code: "topsellerSoldOut", severity: "critical", params: params(p), evidence: { stock: p.stock, minPurchase: p.minPurchase ?? null }, lossPerHour: lossPerHourOf(revenueOf(p.productNumber)) }),
    (rest) => ({ key: "buyability:product:sold-out:other", source: "buyability", code: "productsSoldOut", severity: "warning", params: { count: rest.length, examples: examplesOf(rest) }, evidence: { products: rest.map((p) => p.productNumber) } }),
  );

  // 5. Topseller ohne Lieferzeit bzw. mit langer Wiederauffüllzeit (Tagesbericht); technische Artikel haben keine
  const topSellable = sellable.filter((p) => top.has(p.productNumber) && !p.isTechnical).sort((a, b) => revenueOf(b.productNumber) - revenueOf(a.productNumber));
  const noDelivery = topSellable.filter((p) => !p.deliveryTimeId);
  if (noDelivery.length) {
    detections.push({ key: "buyability:product:no-delivery-time", source: "buyability", code: "topsellersNoDeliveryTime", severity: "warning", params: { count: noDelivery.length, examples: examplesOf(noDelivery) }, evidence: { products: noDelivery.map((p) => p.productNumber) } });
  }
  const longRestock = topSellable.filter((p) => (p.restockTime ?? 0) > LONG_RESTOCK_DAYS);
  if (longRestock.length) {
    detections.push({ key: "buyability:product:long-restock", source: "buyability", code: "topsellersLongRestock", severity: "warning", params: { count: longRestock.length, days: LONG_RESTOCK_DAYS, examples: examplesOf(longRestock) }, evidence: { products: longRestock.map((p) => ({ number: p.productNumber, days: p.restockTime })) } });
  }

  return { detections, baselineProducts, dataGaps: dataGapsOf(sellable.filter((p) => !p.isTechnical)) };
}

// ---------------------------------------------------------------------------------------------
// Datenlücken für die PIM-Sammlung

/**
 * Stückzahl laut Artikelname: „| 10 Stück“, „zu 6 Stück verpackt“, „4 Stk.“, „…-Paar“ (Regel des Users
 * 17.10.2026: Verkaufseinheit nur bei Mehrstück-Artikeln). null = kein Hinweis.
 */
export function piecesFromName(name: string): number | null {
  const m = name.match(/(?:^|[|,(]|\bzu\b|\bje\b)\s*(\d{1,4})\s*(?:Stück|Stk\.?)(?=$|[\s|,)])/i);
  if (m) return Number(m[1]);
  if (/(?:^|[\s-])Paar\b/i.test(name)) return 2;
  return null;
}

export function dataGapsOf(sellable: BuyabilityProduct[]): ShopPulseDataGap[] {
  const gaps: ShopPulseDataGap[] = [];
  for (const p of sellable) {
    const base = { productNumber: p.productNumber, name: p.name, active: p.active };
    if (p.coverId === null) gaps.push({ ...base, code: "noImage", value: "kein Titelbild", hint: "Titelbild zuordnen" });
    if (p.categoryCount === 0) gaps.push({ ...base, code: "noCategory", value: "keine Kategorie", hint: "Kategorie zuordnen (sonst fehlen u. a. die Sicherheitshinweise)" });
    const pieces = piecesFromName(p.name);
    if (pieces && pieces > 1 && p.purchaseUnit !== undefined && (p.purchaseUnit ?? 0) <= 1) {
      gaps.push({ ...base, code: "salesUnit", value: `Verkaufseinheit ${p.purchaseUnit ?? "leer"}`, hint: `Mehrstück-Artikel laut Name: Verkaufseinheit ${pieces}, Einheit Stück, Grundeinheit 1` });
    }
  }
  return gaps;
}

const CSV_HEADER = ["Fund", "Gefunden am", "Artikelnummer", "Status Shop", "Artikelname", "Eigenschaft", "Wert im Shop", "Soll / Hinweis"];
const GAP_LABEL: Record<ShopPulseDataGap["code"], { fund: string; property: string }> = {
  noImage: { fund: "Shop-Puls: Bild", property: "Titelbild" },
  noCategory: { fund: "Shop-Puls: Kategorie", property: "Kategorie" },
  salesUnit: { fund: "Shop-Puls: Verkaufseinheit", property: "Verkaufseinheit" },
};

/** CSV wie Datenfehler-PIM-Artikel.csv: Semikolon, UTF-8 mit BOM, eine Zeile je Artikel und Fund */
export function dataGapsCsv(gaps: ShopPulseDataGaps): string {
  const cell = (v: string) => (/[;"\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const day = gaps.at.slice(0, 10);
  const rows = gaps.items.map((g) =>
    [GAP_LABEL[g.code].fund, day, g.productNumber, g.active ? "aktiv" : "inaktiv", g.name, GAP_LABEL[g.code].property, g.value, g.hint].map(cell).join(";"),
  );
  return `﻿${[CSV_HEADER.join(";"), ...rows].join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------------------------
// Zahl- und Versandarten (jeder Takt)

export type MethodCheckResult = { detections: ShopPulseDetection[]; payment: BuyabilityBaseline["payment"]; shipping: BuyabilityBaseline["shipping"] };

/**
 * Zahl- und Versandarten gegen den Soll-Stand: fehlt eine im Kanal oder ist sie inaktiv → kritisch.
 * Neue aktive Arten kommen von selbst in den Soll-Stand.
 */
export function methodDetections(current: ChannelMethods, baseline: Pick<BuyabilityBaseline, "payment" | "shipping">): MethodCheckResult {
  const detections: ShopPulseDetection[] = [];
  const check = (kind: "payment" | "shipping", list: ChannelMethod[], soll: Array<Pick<ChannelMethod, "id" | "name">> | undefined) => {
    const byId = new Map(list.map((m) => [m.id, m]));
    for (const m of soll ?? []) {
      const now = byId.get(m.id);
      if (now?.active) continue;
      detections.push({
        key: `buyability:method:${kind}:${m.id}`,
        source: "buyability",
        code: kind === "payment" ? "paymentMethodGone" : "shippingMethodGone",
        severity: "critical",
        params: { name: now?.name || m.name },
        evidence: { assigned: !!now, active: now?.active ?? false },
      });
    }
    const known = new Set((soll ?? []).map((m) => m.id));
    return [...(soll ?? []), ...list.filter((m) => m.active && !known.has(m.id)).map((m) => ({ id: m.id, name: m.name }))];
  };
  const payment = check("payment", current.payment, baseline.payment ?? current.payment.filter((m) => m.active));
  const shipping = check("shipping", current.shipping, baseline.shipping ?? current.shipping.filter((m) => m.active));
  return { detections, payment, shipping };
}

// ---------------------------------------------------------------------------------------------
// Prüfungen

async function getBaseline(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId">): Promise<BuyabilityBaseline | null> {
  const raw = await ctx.storage.getSetting(BUYABILITY_BASELINE_KEY, ctx.tenantId);
  return raw && typeof raw === "object" ? (raw as BuyabilityBaseline) : null;
}

async function patchBaseline(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId" | "now">, patch: Partial<BuyabilityBaseline>): Promise<void> {
  const current = await getBaseline(ctx);
  await ctx.storage.saveSetting(BUYABILITY_BASELINE_KEY, { takenAt: current?.takenAt ?? ctx.now.toISOString(), ...current, ...patch }, ctx.tenantId);
}

export const channelMethodsDetector: ShopPulseDetector = {
  id: "channelMethods",
  source: "buyability",
  keyPrefix: "buyability:method:",
  async run(ctx) {
    const current = await ctx.buyability.channelMethods();
    const baseline = await getBaseline(ctx);
    const r = methodDetections(current, { payment: baseline?.payment, shipping: baseline?.shipping });
    if (JSON.stringify(r.payment) !== JSON.stringify(baseline?.payment) || JSON.stringify(r.shipping) !== JSON.stringify(baseline?.shipping)) {
      await patchBaseline(ctx, { payment: r.payment, shipping: r.shipping });
    }
    return r.detections;
  },
};

export const productBuyabilityDetector: ShopPulseDetector = {
  id: "buyability",
  source: "buyability",
  cadence: "nightly",
  keyPrefix: "buyability:product:",
  async run(ctx) {
    // Preisänderungen seit dem vorigen Nachtlauf (höchstens 3 Tage), beim ersten Lauf der letzten 26 Stunden.
    // Eine Stunde Überlappung: der Spiegel trägt die Änderung mit dem Zeitpunkt aus Shopware ein, also evtl.
    // erst nach dem vorigen Lauf, aber mit früherem Zeitstempel.
    const lookback = ctx.lastRunAt
      ? Math.min(ctx.now.getTime() - Date.parse(ctx.lastRunAt) + PRICE_OVERLAP_MS, PRICE_LOOKBACK_MAX_MS)
      : PRICE_LOOKBACK_DEFAULT_MS;
    const [products, revenue, priceChanges, baseline] = await Promise.all([
      ctx.buyability.products(),
      ctx.buyability.revenue(),
      ctx.buyability.priceChanges(new Date(ctx.now.getTime() - lookback)),
      getBaseline(ctx),
    ]);
    if (!products.length) throw new Error("Produktspiegel leer");
    const r = productBuyabilityDetections({ products, revenue, priceChanges, baselineProducts: baseline?.products });
    await patchBaseline(ctx, { products: r.baselineProducts });
    const gaps: ShopPulseDataGaps = { at: ctx.now.toISOString(), items: r.dataGaps };
    await ctx.storage.saveSetting(DATA_GAPS_KEY, gaps, ctx.tenantId);
    return r.detections;
  },
};

/**
 * „Als Soll übernehmen“: der jetzige Stand (kaufbare Artikel mit Umsatz, aktive Zahl- und Versandarten)
 * wird zum Soll-Stand; bewusst entfernte Artikel und Arten werden danach nicht mehr gemeldet.
 */
export async function acceptBuyabilityBaseline(ctx: Pick<ShopPulseDetectorContext, "storage" | "tenantId" | "now" | "buyability">): Promise<BuyabilityBaseline> {
  const [products, revenue, previous] = await Promise.all([ctx.buyability.products(), ctx.buyability.revenue(), getBaseline(ctx)]);
  // Zahl- und Versandarten nur, wenn die Admin-API antwortet; sonst bleibt deren Soll-Stand
  const methods = await ctx.buyability.channelMethods().catch(() => null);
  const baseline: BuyabilityBaseline = {
    takenAt: ctx.now.toISOString(),
    products: products.filter((p) => !p.isVariant && isSellable(p) && (revenue.get(p.productNumber) ?? 0) > 0).map((p) => p.productNumber).sort(),
    payment: methods ? methods.payment.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })) : previous?.payment,
    shipping: methods ? methods.shipping.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name })) : previous?.shipping,
  };
  await ctx.storage.saveSetting(BUYABILITY_BASELINE_KEY, baseline, ctx.tenantId);
  return baseline;
}

export async function getBuyabilityBaseline(store: ShopPulseDetectorContext["storage"], tenantId: string | null): Promise<BuyabilityBaseline | null> {
  return getBaseline({ storage: store, tenantId });
}
