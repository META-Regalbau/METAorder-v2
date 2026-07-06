import type { Order, OrderItem, OrderProfitabilitySummary } from "@shared/schema";
import type { IStorage } from "./storage";
import type { ShopwareClient } from "./shopware";
import { loadCrmProfitabilitySettings } from "./crmProfitabilitySettings";
import {
  computeCrmProfitabilityVerdict,
  computeHerstellMarginPercent,
  type HerstellMarginVerdict,
} from "./herstellpreisMargin";
import { productIdLookupKeys } from "./pricingUtils";
import { getHerstellpreisLookupKey } from "./productIdentifiers";

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

function resolveHerstellpreisLookupKey(
  item: OrderItem,
  lookupKeyByProductId: Map<string, string>,
): string | undefined {
  if (item.productId) {
    for (const key of productIdLookupKeys(item.productId)) {
      const hit = lookupKeyByProductId.get(key);
      if (hit) return hit;
    }
  }
  return getHerstellpreisLookupKey(undefined, item.productNumber);
}

function enrichOrderItem(
  item: OrderItem,
  lookupKeyByProductId: Map<string, string>,
  herstellMap: Map<string, number>,
  minMarginPercent: number,
): OrderItem {
  const lookupKey = resolveHerstellpreisLookupKey(item, lookupKeyByProductId);
  const herstellpreisNet = lookupKey ? (herstellMap.get(lookupKey) ?? null) : null;
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
  const crmVerdict = computeCrmProfitabilityVerdict(marginPercent, minMarginPercent);

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

function summarizeOrderItems(items: OrderItem[], minMarginPercent: number): OrderProfitabilitySummary {
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
  const crmVerdict = computeCrmProfitabilityVerdict(marginPercent, minMarginPercent);

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
    else if (p.crmVerdict === "red") crmRed += 1;
    else crmNone += 1;

    if (p.marginPercent == null) continue;

    ordersWithHerstellpreis += 1;
    margins.push(p.marginPercent);
    if (p.marginPercent < 0) lossCount += 1;
    if (p.crmVerdict === "red") belowCrmThresholdCount += 1;
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

  const productIds = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      if (item.productId) productIds.add(item.productId);
    }
  }

  const lookupKeyByProductId =
    productIds.size > 0
      ? await opts.client.fetchProductHerstellpreisLookupKeys([...productIds])
      : new Map<string, string>();

  const lookupKeys = new Set<string>();
  for (const order of orders) {
    for (const item of order.items) {
      const key = resolveHerstellpreisLookupKey(item, lookupKeyByProductId);
      if (key) lookupKeys.add(key);
    }
  }

  const herstellMap =
    lookupKeys.size > 0
      ? await opts.storage.getProductHerstellpreiseByProductNumbers([...lookupKeys], opts.tenantId)
      : new Map<string, number>();

  return orders.map((order) => {
    const items = order.items.map((item) =>
      enrichOrderItem(item, lookupKeyByProductId, herstellMap, minMarginPercent),
    );
    const profitability = summarizeOrderItems(items, minMarginPercent);
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
