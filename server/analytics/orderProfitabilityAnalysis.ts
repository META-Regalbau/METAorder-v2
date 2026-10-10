import type { Order, OrderItem, OrderProfitabilitySummary, OrderProfitabilityVerdict } from "@shared/schema";
import type { IStorage } from "../storage";
import type { ShopwareClient } from "../shopware/shopware";
import { loadCrmProfitabilitySettings } from "./crmProfitabilitySettings";
import {
  computeCrmProfitabilityVerdict,
  computeHerstellMarginPercent,
} from "../products/herstellpreisMargin";
import { productIdLookupKeys } from "../products/pricingUtils";
import { getHerstellpreisLookupKey } from "../products/productIdentifiers";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function computeMarginOnRevenuePercent(
  priceNet: number | null | undefined,
  herstellpreisNet: number | null | undefined,
): number | null {
  if (priceNet == null || herstellpreisNet == null || priceNet <= 0) return null;
  return Math.round(((priceNet - herstellpreisNet) / priceNet) * 1000) / 10;
}

/** Artikel-Bezug fuer die Herstellpreis-Suche (Bestell- oder Angebotsposition, Stuecklistenteil). */
export type HerstellpreisRef = { productId?: string | null; productNumber?: string | null };

function resolveHerstellpreisLookupKey(
  item: HerstellpreisRef,
  lookupKeyByProductId: Map<string, string>,
): string | undefined {
  if (item.productId) {
    for (const key of productIdLookupKeys(item.productId)) {
      const hit = lookupKeyByProductId.get(key);
      if (hit) return hit;
    }
  }
  return getHerstellpreisLookupKey(undefined, item.productNumber ?? undefined);
}

/**
 * Herstellpreise (netto je Einheit) fuer eine Menge Artikel-Bezuege laden; liefert eine Suche je
 * Bezug (null = kein Herstellpreis). Schluessel wie bei Bestellungen: WDU-IFS-Nummer des Produkts,
 * sonst die Artikelnummer.
 */
export async function createHerstellpreisResolver(
  refs: HerstellpreisRef[],
  opts: { storage: IStorage; client: ShopwareClient; tenantId?: string | null },
): Promise<(ref: HerstellpreisRef) => number | null> {
  const productIds = new Set<string>();
  for (const ref of refs) {
    if (ref.productId) productIds.add(ref.productId);
  }

  const lookupKeyByProductId =
    productIds.size > 0
      ? await opts.client.fetchProductHerstellpreisLookupKeys([...productIds])
      : new Map<string, string>();

  const lookupKeys = new Set<string>();
  for (const ref of refs) {
    const key = resolveHerstellpreisLookupKey(ref, lookupKeyByProductId);
    if (key) lookupKeys.add(key);
  }

  const herstellMap =
    lookupKeys.size > 0
      ? await opts.storage.getProductHerstellpreiseByProductNumbers([...lookupKeys], opts.tenantId)
      : new Map<string, number>();

  return (ref) => {
    const key = resolveHerstellpreisLookupKey(ref, lookupKeyByProductId);
    const value = key ? herstellMap.get(key) : undefined;
    return value != null && value > 0 ? value : null;
  };
}

/** Ampel-Schwellen in % Aufschlag auf Herstellkosten (siehe crmProfitabilitySettings). */
export type ProfitabilityThresholds = { minMarginPercent: number; warnMarginPercent?: number };

function toThresholds(value: number | ProfitabilityThresholds): ProfitabilityThresholds {
  return typeof value === "number" ? { minMarginPercent: value } : value;
}

function verdictFor(
  marginPercent: number | null,
  thresholds: ProfitabilityThresholds,
): OrderProfitabilityVerdict {
  return computeCrmProfitabilityVerdict(
    marginPercent,
    thresholds.minMarginPercent,
    thresholds.warnMarginPercent,
  );
}

export function enrichOrderItem(
  item: OrderItem,
  herstellpreisNet: number | null,
  thresholds: number | ProfitabilityThresholds,
): OrderItem {
  if (herstellpreisNet == null || herstellpreisNet <= 0) {
    return {
      ...item,
      herstellpreisNet: null,
      herstellkostenTotal: null,
      db1Abs: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
      crmVerdict: "none",
    };
  }

  const herstellkostenTotal = roundMoney(herstellpreisNet * item.quantity);
  const db1Abs = roundMoney(item.netTotal - herstellkostenTotal);
  const marginPercent = computeHerstellMarginPercent(item.netPrice, herstellpreisNet);
  const marginOnRevenuePercent = computeMarginOnRevenuePercent(item.netPrice, herstellpreisNet);
  const crmVerdict = verdictFor(marginPercent, toThresholds(thresholds));

  return {
    ...item,
    herstellpreisNet,
    herstellkostenTotal,
    db1Abs,
    marginPercent,
    marginOnRevenuePercent,
    crmVerdict,
  };
}

/** Felder einer Position, die die DB-Zusammenfassung braucht (Bestellung wie Angebot). */
export type ProfitabilityLineInput = Pick<
  OrderItem,
  "productId" | "productNumber" | "quantity" | "netTotal" | "herstellpreisNet" | "herstellkostenTotal"
>;

export function summarizeOrderItems(
  items: ProfitabilityLineInput[],
  thresholds: number | ProfitabilityThresholds,
): OrderProfitabilitySummary {
  const productLines = items.filter((item) => item.productId || item.productNumber);
  const linesWithHerstellpreis = productLines.filter(
    (item) => item.herstellpreisNet != null && item.herstellpreisNet > 0,
  );

  if (linesWithHerstellpreis.length === 0) {
    return {
      herstellkostenTotal: null,
      db1Total: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
      crmVerdict: "none",
      productLineCount: productLines.length,
      linesWithHerstellpreis: 0,
      coveragePercent:
        productLines.length > 0
          ? 0
          : 0,
    };
  }

  const netRevenueWithHk = linesWithHerstellpreis.reduce((sum, item) => sum + item.netTotal, 0);
  const herstellkostenTotal = roundMoney(
    linesWithHerstellpreis.reduce(
      (sum, item) => sum + (item.herstellkostenTotal ?? item.herstellpreisNet! * item.quantity),
      0,
    ),
  );
  const db1Total = roundMoney(netRevenueWithHk - herstellkostenTotal);
  const marginPercent =
    herstellkostenTotal > 0
      ? Math.round(((netRevenueWithHk - herstellkostenTotal) / herstellkostenTotal) * 1000) / 10
      : null;
  const marginOnRevenuePercent =
    netRevenueWithHk > 0
      ? Math.round(((netRevenueWithHk - herstellkostenTotal) / netRevenueWithHk) * 1000) / 10
      : null;
  const crmVerdict = verdictFor(marginPercent, toThresholds(thresholds));

  return {
    herstellkostenTotal,
    db1Total,
    marginPercent,
    marginOnRevenuePercent,
    crmVerdict,
    productLineCount: productLines.length,
    linesWithHerstellpreis: linesWithHerstellpreis.length,
    coveragePercent:
      productLines.length > 0
        ? Math.round((linesWithHerstellpreis.length / productLines.length) * 1000) / 10
        : 0,
  };
}

export type OrderProfitabilityAnalysisSummary = {
  totalOrders: number;
  ordersWithHerstellpreis: number;
  coveragePercent: number;
  crmGreen: number;
  crmYellow: number;
  crmRed: number;
  crmNone: number;
  lossCount: number;
  belowCrmThresholdCount: number;
  totalDb1: number | null;
  avgDb1: number | null;
  avgMarginPercent: number | null;
  medianMarginPercent: number | null;
  totalNetRevenueWithHk: number | null;
  totalHerstellkosten: number | null;
};

export type OrderAnalysisRow = Order & {
  profitability: OrderProfitabilitySummary;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = values.toSorted((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round(((sorted[mid - 1]! + sorted[mid]!) / 2) * 10) / 10;
  }
  return sorted[mid]!;
}

export function buildOrderProfitabilityAnalysisSummary(
  orders: OrderAnalysisRow[],
): OrderProfitabilityAnalysisSummary {
  const margins: number[] = [];
  const db1Values: number[] = [];
  let ordersWithHerstellpreis = 0;
  let crmGreen = 0;
  let crmYellow = 0;
  let crmRed = 0;
  let crmNone = 0;
  let lossCount = 0;
  let belowCrmThresholdCount = 0;
  let totalNetRevenueWithHk = 0;
  let totalHerstellkosten = 0;
  let hasRevenueTotals = false;

  for (const order of orders) {
    const p = order.profitability;
    if (p.crmVerdict === "green") crmGreen += 1;
    else if (p.crmVerdict === "yellow") crmYellow += 1;
    else if (p.crmVerdict === "red") crmRed += 1;
    else crmNone += 1;

    if (p.marginPercent == null) continue;

    ordersWithHerstellpreis += 1;
    margins.push(p.marginPercent);
    if (p.marginPercent < 0) lossCount += 1;
    if (p.crmVerdict === "red" || p.crmVerdict === "yellow") belowCrmThresholdCount += 1;
    if (p.db1Total != null) db1Values.push(p.db1Total);

    if (p.herstellkostenTotal != null && p.db1Total != null) {
      hasRevenueTotals = true;
      totalHerstellkosten += p.herstellkostenTotal;
      totalNetRevenueWithHk += p.herstellkostenTotal + p.db1Total;
    }
  }

  const totalDb1 =
    db1Values.length > 0 ? roundMoney(db1Values.reduce((sum, v) => sum + v, 0)) : null;
  const avgDb1 =
    db1Values.length > 0 ? roundMoney(totalDb1! / db1Values.length) : null;
  const avgMarginPercent =
    margins.length > 0
      ? Math.round((margins.reduce((sum, v) => sum + v, 0) / margins.length) * 10) / 10
      : null;

  return {
    totalOrders: orders.length,
    ordersWithHerstellpreis,
    coveragePercent:
      orders.length > 0
        ? Math.round((ordersWithHerstellpreis / orders.length) * 1000) / 10
        : 0,
    crmGreen,
    crmYellow,
    crmRed,
    crmNone,
    lossCount,
    belowCrmThresholdCount,
    totalDb1,
    avgDb1,
    avgMarginPercent,
    medianMarginPercent: median(margins),
    totalNetRevenueWithHk: hasRevenueTotals ? roundMoney(totalNetRevenueWithHk) : null,
    totalHerstellkosten: hasRevenueTotals ? roundMoney(totalHerstellkosten) : null,
  };
}

export async function enrichOrdersWithProfitability(
  orders: Order[],
  opts: {
    storage: IStorage;
    client: ShopwareClient;
    tenantId?: string | null;
    minMarginPercent?: number;
  },
): Promise<OrderAnalysisRow[]> {
  if (orders.length === 0) return [];

  const profitabilitySettings = await loadCrmProfitabilitySettings(opts.storage, opts.tenantId);
  const minMarginPercent = opts.minMarginPercent ?? profitabilitySettings.minMarginPercent;
  const thresholds: ProfitabilityThresholds = {
    minMarginPercent,
    warnMarginPercent: Math.min(profitabilitySettings.warnMarginPercent, minMarginPercent),
  };

  const herstellpreisOf = await createHerstellpreisResolver(
    orders.flatMap((order) => order.items),
    opts,
  );

  return orders.map((order) => {
    const items = order.items.map((item) =>
      enrichOrderItem(item, herstellpreisOf(item), thresholds),
    );
    const profitability = summarizeOrderItems(items, thresholds);
    return { ...order, items, profitability };
  });
}

export function sortOrdersByMargin(
  orders: OrderAnalysisRow[],
  direction: "asc" | "desc",
  limit = 20,
): OrderAnalysisRow[] {
  return orders
    .filter((order) => order.profitability.marginPercent != null)
    .toSorted((a, b) =>
      direction === "asc"
        ? (a.profitability.marginPercent ?? 0) - (b.profitability.marginPercent ?? 0)
        : (b.profitability.marginPercent ?? 0) - (a.profitability.marginPercent ?? 0),
    )
    .slice(0, limit);
}
