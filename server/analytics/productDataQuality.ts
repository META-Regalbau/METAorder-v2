import type { ShopwareClient } from "../shopware/shopware";
import { logger } from "../lib/logger";

const log = logger.child({ component: "analytics/productDataQuality" });

/**
 * Datenqualitaet der Produkte fuer die Statistik-Seite (GET /api/analytics/product-data-quality).
 *
 * Shopware liefert die noetigen Angaben (Eigenschaften, Sichtbarkeiten, Kategorien, Bilder) nur
 * live; der Produkt-Spiegel hat sie nicht. Deshalb: Seiten zu 500 Produkten, mehrere parallel,
 * und das Ergebnis je Mandant und Kanalfilter zwischengespeichert - 15 Minuten frisch, danach
 * wird der alte Stand sofort geliefert und im Hintergrund erneuert. Die Antwort nennt den Stand
 * (computedAt).
 */

export type DataQualityProduct = Awaited<ReturnType<ShopwareClient["fetchProductsForDataQuality"]>>["products"][number];

export type DataQualitySummary = {
  totalProducts: number;
  averageScore: number;
  criteriaCount: number;
  distribution: Array<{ label: string; count: number }>;
  /** Zeitpunkt der Berechnung (ISO) */
  computedAt: string;
};

export const DATA_QUALITY_CRITERIA_COUNT = 13;

/** Punkte je erfuelltem Kriterium -> 0..100 (unveraendert aus der frueheren Route). */
export function scoreProductDataQuality(product: DataQualityProduct): number {
  let points = 0;
  if (product.productNumber) points += 1;
  if (product.manufacturerNumber) points += 1;
  if (product.ean) points += 1;
  if (product.description) points += 1;
  if (product.propertyCount > 2) points += 1;
  if (product.hasDeliveryTime) points += 1;
  if (product.visibilityCount > 0) points += 1;
  if (product.categoryCount > 0) points += 1;
  if (product.imageCount > 0) points += 1;
  if (product.width) points += 1;
  if (product.height) points += 1;
  if (product.length) points += 1;
  if (product.weight) points += 1;
  return Math.round((points / DATA_QUALITY_CRITERIA_COUNT) * 100);
}

export function summarizeDataQuality(products: DataQualityProduct[], now: Date = new Date()): DataQualitySummary {
  const buckets = { "0-20": 0, "21-40": 0, "41-60": 0, "61-80": 0, "81-100": 0 };
  let totalScore = 0;
  for (const product of products) {
    const score = scoreProductDataQuality(product);
    totalScore += score;
    if (score <= 20) buckets["0-20"] += 1;
    else if (score <= 40) buckets["21-40"] += 1;
    else if (score <= 60) buckets["41-60"] += 1;
    else if (score <= 80) buckets["61-80"] += 1;
    else buckets["81-100"] += 1;
  }
  return {
    totalProducts: products.length,
    averageScore: products.length > 0 ? Math.round(totalScore / products.length) : 0,
    criteriaCount: DATA_QUALITY_CRITERIA_COUNT,
    distribution: Object.entries(buckets).map(([label, count]) => ({ label, count })),
    computedAt: now.toISOString(),
  };
}

/**
 * Alle Produkte laden: erste Seite mit Gesamtzahl, die uebrigen Seiten parallel.
 * salesChannelIds: null = alle; [] = keiner (Nutzer ohne Kanal) -> keine Produkte.
 */
export async function fetchAllDataQualityProducts(
  client: ShopwareClient,
  salesChannelIds: string[] | null,
  opts: { pageSize?: number; parallel?: number } = {},
): Promise<DataQualityProduct[]> {
  if (salesChannelIds && salesChannelIds.length === 0) return [];
  const pageSize = opts.pageSize ?? 500;
  const parallel = opts.parallel ?? 4;
  const channels = salesChannelIds ?? undefined;

  const first = await client.fetchProductsForDataQuality(pageSize, 1, channels);
  const products = [...first.products];
  const pages = Math.ceil((first.total ?? 0) / pageSize);
  if (first.products.length < pageSize || pages <= 1) return products;

  for (let start = 2; start <= pages; start += parallel) {
    const batch = Array.from({ length: Math.min(parallel, pages - start + 1) }, (_, i) => start + i);
    const results = await Promise.all(batch.map((page) => client.fetchProductsForDataQuality(pageSize, page, channels)));
    for (const r of results) products.push(...r.products);
  }
  return products;
}

type CacheEntry = { value?: DataQualitySummary; computedAtMs?: number; inflight?: Promise<DataQualitySummary> };

export function createDataQualityCache(opts: { freshMs?: number; maxStaleMs?: number; now?: () => number } = {}) {
  const freshMs = opts.freshMs ?? 15 * 60 * 1000;
  const maxStaleMs = opts.maxStaleMs ?? 24 * 60 * 60 * 1000;
  const now = opts.now ?? Date.now;
  const entries = new Map<string, CacheEntry>();

  function refresh(key: string, compute: () => Promise<DataQualitySummary>): Promise<DataQualitySummary> {
    const entry = entries.get(key) ?? {};
    entries.set(key, entry);
    if (entry.inflight) return entry.inflight;
    entry.inflight = compute()
      .then((value) => {
        entry.value = value;
        entry.computedAtMs = now();
        return value;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
    return entry.inflight;
  }

  return {
    async get(key: string, compute: () => Promise<DataQualitySummary>): Promise<DataQualitySummary> {
      const entry = entries.get(key);
      const age = entry?.computedAtMs !== undefined ? now() - entry.computedAtMs : Infinity;
      if (entry?.value && age < freshMs) return entry.value;
      if (entry?.value && age < maxStaleMs) {
        // Alter Stand sofort, Erneuerung im Hintergrund; ein Fehler dabei behaelt den alten Stand
        refresh(key, compute).catch((err) => log.warn({ err, key }, "Datenqualitaet: Aktualisierung im Hintergrund fehlgeschlagen"));
        return entry.value;
      }
      return refresh(key, compute);
    },
    clear() {
      entries.clear();
    },
  };
}

export const productDataQualityCache = createDataQualityCache();

export function dataQualityCacheKey(tenantId: string | null | undefined, salesChannelIds: string[] | null): string {
  return `${tenantId ?? "default"}|${salesChannelIds === null ? "*" : [...salesChannelIds].sort().join(",")}`;
}
