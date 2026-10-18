/**
 * Shop-Puls, Daten für die Kaufbarkeits-Prüfung (PR C): Artikel aus dem Produktspiegel, Umsatz je Artikel
 * aus dem Bestellspiegel, Preisänderungen aus der Preis-Historie. Nur lesend aus der eigenen Datenbank;
 * Zahl- und Versandarten liest detectors/buyability.ts über die Admin-API.
 */
import { and, eq, gte, isNull, sql, type AnyColumn } from "drizzle-orm";
import { productPriceHistory, shopwareOrders, shopwareProducts } from "@shared/schema";
import { isMoOrderNumber } from "@shared/orderNumberFilter";
import { db } from "../db";

/** Ein Artikel, wie ihn die Kaufbarkeits-Prüfung braucht (Felder ab Spiegel-Payload v3 können fehlen) */
export type BuyabilityProduct = {
  productNumber: string;
  name: string;
  active: boolean;
  salesChannelIds: string[];
  priceGross: number | null;
  stock: number | null;
  /** undefined = Spiegel noch ohne das Feld (vor dem ersten Abgleich mit Payload v3) */
  isCloseout?: boolean | null;
  minPurchase?: number | null;
  coverId?: string | null;
  purchaseUnit?: number | null;
  deliveryTimeId: string | null;
  restockTime: number | null;
  categoryCount: number;
  /** Variante (parentId gesetzt): erbt Felder vom Hauptartikel, wird nicht einzeln bewertet */
  isVariant: boolean;
  /**
   * Technischer Artikel ohne Lieferzeit und Kategorie: Service-Artikel (Zusatzfeld wdu_service_type) und
   * Shopware-eigene SW-Nummern (Konfigurator-Artikel SW10001, Platzhalter SW10000). Nur „nicht mehr
   * kaufbar“ wird für sie geprüft (ohne SW10001 keine Konfigurator-Bestellungen).
   */
  isTechnical?: boolean;
};

export type PriceChange = { productNumber: string; oldPriceGross: number | null; newPriceGross: number; changedAt: Date };

const tenantIs = (column: AnyColumn, tenantId: string | null) => (tenantId ? eq(column, tenantId) : isNull(column));
const num = (v: unknown): number | null => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));

type ProductRow = {
  productNumber: string;
  active: boolean | null;
  name: string | null;
  payload: Record<string, unknown> | null;
};

export function toBuyabilityProduct(r: ProductRow): BuyabilityProduct {
  const p = r.payload ?? {};
  const has = (k: string) => Object.prototype.hasOwnProperty.call(p, k);
  return {
    productNumber: r.productNumber,
    name: String(r.name ?? p.name ?? ""),
    active: r.active === true,
    salesChannelIds: Array.isArray(p.salesChannelIds) ? (p.salesChannelIds as unknown[]).map(String) : [],
    priceGross: num(p.priceGross),
    stock: num(p.stock),
    isCloseout: has("isCloseout") ? (typeof p.isCloseout === "boolean" ? p.isCloseout : null) : undefined,
    minPurchase: has("minPurchase") ? num(p.minPurchase) : undefined,
    coverId: has("coverId") ? (p.coverId ? String(p.coverId) : null) : undefined,
    purchaseUnit: has("purchaseUnit") ? num(p.purchaseUnit) : undefined,
    deliveryTimeId: p.deliveryTimeId ? String(p.deliveryTimeId) : null,
    restockTime: num(p.restockTime),
    categoryCount: Array.isArray(p.categories) ? (p.categories as unknown[]).length : 0,
    isVariant: !!p.parentId,
    isTechnical: !!p.serviceType || /^SW\d+$/i.test(r.productNumber),
  };
}

/** Alle Artikel des Mandanten aus dem Produktspiegel (Live: rund 8.200) */
export async function loadBuyabilityProducts(tenantId: string | null): Promise<BuyabilityProduct[]> {
  const p = shopwareProducts.payload;
  const rows = await db
    .select({
      productNumber: shopwareProducts.productNumber,
      active: shopwareProducts.active,
      name: shopwareProducts.name,
      // ohne die großen Teile (Staffelpreise, Zusatzfelder, Eigenschaften), die hier nicht gebraucht werden
      payload: sql<Record<string, unknown>>`(${p} - 'advancedPrices' - 'customFields' - 'customFieldsDisplay' - 'properties' - 'options' - 'tags' - 'salesChannelVisibilities')
        || jsonb_build_object('serviceType', ${p}->'customFields'->'wdu_service_type')`,
    })
    .from(shopwareProducts)
    .where(tenantIs(shopwareProducts.tenantId, tenantId));
  return rows.map(toBuyabilityProduct);
}

type RevenueOrderRow = { orderNumber: string | null; swUpdatedAt: Date | null; createdAt: string | null; status: string | null; items: unknown };

/**
 * Netto-Umsatz je Artikelnummer aus den Shop-Bestellungen (MO, nicht storniert, je Nummer die zuletzt
 * geänderte Zeile) ab einem Zeitpunkt.
 */
export function revenueByProduct(rows: RevenueOrderRow[], since: Date): Map<string, number> {
  const latest = new Map<string, RevenueOrderRow>();
  for (const r of rows) {
    const number = String(r.orderNumber ?? "").trim();
    if (!isMoOrderNumber(number)) continue;
    const prev = latest.get(number);
    if (!prev || (r.swUpdatedAt?.getTime() ?? 0) > (prev.swUpdatedAt?.getTime() ?? 0)) latest.set(number, r);
  }
  const out = new Map<string, number>();
  for (const r of Array.from(latest.values())) {
    if (r.status === "cancelled") continue;
    const at = r.createdAt ? Date.parse(r.createdAt) : NaN;
    if (Number.isNaN(at) || at < since.getTime()) continue;
    for (const item of Array.isArray(r.items) ? r.items : []) {
      const pn = String((item as any)?.productNumber ?? "").trim();
      const net = Number((item as any)?.netTotal ?? 0);
      if (!pn || !Number.isFinite(net) || net <= 0) continue;
      out.set(pn, (out.get(pn) ?? 0) + net);
    }
  }
  return out;
}

export async function loadProductRevenue(tenantId: string | null, since: Date): Promise<Map<string, number>> {
  const p = shopwareOrders.payload;
  const rows = await db
    .select({
      orderNumber: shopwareOrders.orderNumber,
      swUpdatedAt: shopwareOrders.swUpdatedAt,
      createdAt: sql<string | null>`${p}->>'createdAt'`,
      status: sql<string | null>`${p}->>'status'`,
      items: sql<unknown>`${p}->'items'`,
    })
    .from(shopwareOrders)
    .where(and(tenantIs(shopwareOrders.tenantId, tenantId), sql`upper(${shopwareOrders.orderNumber}) like 'MO%'`));
  return revenueByProduct(rows, since);
}

export async function loadPriceChanges(tenantId: string | null, since: Date): Promise<PriceChange[]> {
  const rows = await db
    .select({
      productNumber: productPriceHistory.productNumber,
      oldPriceGross: productPriceHistory.oldPriceGross,
      newPriceGross: productPriceHistory.newPriceGross,
      changedAt: productPriceHistory.changedAt,
    })
    .from(productPriceHistory)
    .where(and(tenantIs(productPriceHistory.tenantId, tenantId), gte(productPriceHistory.changedAt, since)));
  return rows;
}
