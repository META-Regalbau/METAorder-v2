/**
 * Datenqualitaet der Produkte: Bewertung, paralleles Laden, Zwischenspeicher und die korrigierte
 * Shopware-Abfrage (Kategorien/Sichtbarkeiten/Bilder wurden frueher nie gezaehlt).
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";
import {
  createDataQualityCache,
  dataQualityCacheKey,
  fetchAllDataQualityProducts,
  scoreProductDataQuality,
  summarizeDataQuality,
  type DataQualityProduct,
  type DataQualitySummary,
} from "../../server/analytics/productDataQuality";
import { fetchProductDataQuality, fetchProductsForDataQuality } from "../../server/shopware/client/products";

const empty: DataQualityProduct = { id: "x", propertyCount: 0, hasDeliveryTime: false, categoryCount: 0, visibilityCount: 0, imageCount: 0 };
const full: DataQualityProduct = {
  id: "y", productNumber: "P1", manufacturerNumber: "M1", ean: "4000000000000", description: "<p>x</p>", propertyCount: 3,
  hasDeliveryTime: true, categoryCount: 1, visibilityCount: 1, imageCount: 1, width: 1, height: 1, length: 1, weight: 1,
};

describe("Bewertung", () => {
  it("alle 13 Kriterien = 100, keines = 0, jedes einzelne zaehlt", () => {
    expect(scoreProductDataQuality(full)).toBe(100);
    expect(scoreProductDataQuality(empty)).toBe(0);
    const single: Array<Partial<DataQualityProduct>> = [
      { productNumber: "P" }, { manufacturerNumber: "M" }, { ean: "1" }, { description: "d" }, { propertyCount: 3 },
      { hasDeliveryTime: true }, { visibilityCount: 1 }, { categoryCount: 1 }, { imageCount: 1 },
      { width: 1 }, { height: 1 }, { length: 1 }, { weight: 1 },
    ];
    for (const s of single) expect(scoreProductDataQuality({ ...empty, ...s }), JSON.stringify(s)).toBe(8);
    expect(scoreProductDataQuality({ ...empty, propertyCount: 2 })).toBe(0);
  });

  it("Zusammenfassung: Durchschnitt, Verteilung, Stand", () => {
    const now = new Date("2026-10-04T12:00:00Z");
    const s = summarizeDataQuality([full, empty, { ...empty, categoryCount: 1, imageCount: 1, visibilityCount: 1 }], now);
    expect(s).toEqual({
      totalProducts: 3, averageScore: 41, criteriaCount: 13, computedAt: "2026-10-04T12:00:00.000Z",
      distribution: [{ label: "0-20", count: 1 }, { label: "21-40", count: 1 }, { label: "41-60", count: 0 }, { label: "61-80", count: 0 }, { label: "81-100", count: 1 }],
    });
  });
});

describe("Laden aller Produkte", () => {
  function fakeClient(total: number) {
    const calls: Array<{ limit: number; page: number; channels?: string[] }> = [];
    let active = 0, maxActive = 0;
    const client = {
      fetchProductsForDataQuality: async (limit: number, page: number, channels?: string[]) => {
        calls.push({ limit, page, channels });
        active++; maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, 5));
        active--;
        const from = (page - 1) * limit;
        const n = Math.max(0, Math.min(limit, total - from));
        return { products: Array.from({ length: n }, (_, i) => ({ ...empty, id: `p${from + i}` })), total: page === 1 ? total : n };
      },
    };
    return { client: client as any, calls, maxActive: () => maxActive };
  }

  it("erste Seite mit Gesamtzahl, Rest parallel, alle Produkte genau einmal", async () => {
    const { client, calls, maxActive } = fakeClient(2234);
    const products = await fetchAllDataQualityProducts(client, null, { pageSize: 500, parallel: 2 });
    expect(products).toHaveLength(2234);
    expect(new Set(products.map((p) => p.id)).size).toBe(2234);
    expect(calls.map((c) => c.page)).toEqual([1, 2, 3, 4, 5]);
    expect(calls.every((c) => c.limit === 500 && c.channels === undefined)).toBe(true);
    expect(maxActive()).toBe(2);
  });

  it("eine Seite reicht, Kanalfilter wird weitergegeben, ohne Kanal kein Abruf", async () => {
    const a = fakeClient(120);
    expect(await fetchAllDataQualityProducts(a.client, ["sc1"])).toHaveLength(120);
    expect(a.calls).toEqual([{ limit: 500, page: 1, channels: ["sc1"] }]);
    const b = fakeClient(120);
    expect(await fetchAllDataQualityProducts(b.client, [])).toEqual([]);
    expect(b.calls).toEqual([]);
  });
});

describe("Zwischenspeicher", () => {
  const summary = (n: number): DataQualitySummary => ({ totalProducts: n, averageScore: 0, criteriaCount: 13, distribution: [], computedAt: `t${n}` });

  it("frisch: kein erneutes Laden; abgelaufen: alter Stand sofort, Erneuerung im Hintergrund (einmal)", async () => {
    let clock = 0;
    const cache = createDataQualityCache({ freshMs: 1000, maxStaleMs: 10_000, now: () => clock });
    let n = 0;
    let release: () => void = () => {};
    const compute = vi.fn(async () => { n++; if (n === 2) await new Promise<void>((r) => { release = r; }); return summary(n); });
    expect((await cache.get("k", compute)).totalProducts).toBe(1);
    clock = 500;
    expect((await cache.get("k", compute)).totalProducts).toBe(1);
    expect(compute).toHaveBeenCalledTimes(1);
    clock = 2000;
    const [a, b] = await Promise.all([cache.get("k", compute), cache.get("k", compute)]);
    expect([a.totalProducts, b.totalProducts]).toEqual([1, 1]);
    expect(compute).toHaveBeenCalledTimes(2);
    release();
    await vi.waitFor(async () => expect((await cache.get("k", compute)).totalProducts).toBe(2));
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("zu alt: wartet auf neue Berechnung; Schluessel getrennt; Fehler im Hintergrund behaelt alten Stand", async () => {
    let clock = 0;
    const cache = createDataQualityCache({ freshMs: 1000, maxStaleMs: 5000, now: () => clock });
    await cache.get("a", async () => summary(1));
    await cache.get("b", async () => summary(7));
    clock = 6000;
    expect((await cache.get("a", async () => summary(2))).totalProducts).toBe(2);
    clock = 7500;
    expect((await cache.get("a", async () => { throw new Error("Shopware weg"); })).totalProducts).toBe(2);
    await new Promise((r) => setTimeout(r, 5));
    // weiterhin abgelaufen: alter Stand sofort, die neue Berechnung laeuft im Hintergrund ...
    expect((await cache.get("a", async () => summary(3))).totalProducts).toBe(2);
    // ... und ist beim naechsten Aufruf da
    await vi.waitFor(async () => expect((await cache.get("a", async () => summary(4))).totalProducts).toBe(3));
    expect(dataQualityCacheKey("t1", null)).not.toBe(dataQualityCacheKey("t1", ["sc1"]));
    expect(dataQualityCacheKey("t1", ["b", "a"])).toBe(dataQualityCacheKey("t1", ["a", "b"]));
  });
});

describe("Shopware-Abfrage", () => {
  const sp = { id: "p1", productNumber: "P1", coverId: "m1", categories: [{ id: "c1" }, { id: "c2" }], visibilities: [{ id: "v1" }], media: [{ id: "m1" }, { id: "m2" }], properties: [{ id: "o1" }, { id: "o2" }], options: [{ id: "o3" }], deliveryTimeId: "d1" };

  it("Liste: fragt Kategorien/Sichtbarkeiten/Bilder ab und zaehlt sie; Gesamtzahl nur auf Seite 1", async () => {
    const bodies: any[] = [];
    const fake = { baseUrl: "https://shop.invalid", makeAuthenticatedRequest: async (_url: string, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ data: [sp], total: 1 })); } };
    const r = await fetchProductsForDataQuality.call(fake as any, 500, 1);
    expect(bodies[0].includes.product).toEqual(expect.arrayContaining(["categories", "visibilities", "media", "coverId"]));
    expect(bodies[0]["total-count-mode"]).toBe(1);
    expect(r.products[0]).toMatchObject({ categoryCount: 2, visibilityCount: 1, imageCount: 3, propertyCount: 3, hasDeliveryTime: true });
    await fetchProductsForDataQuality.call(fake as any, 500, 2);
    expect(bodies[1]["total-count-mode"]).toBe(0);
  });

  it("Einzelprodukt (Detailansicht, Entwuerfe): dieselben Felder werden abgefragt", async () => {
    const bodies: any[] = [];
    const fake = { searchEntity: async (_e: string, body: any) => { bodies.push(body); return { data: [sp], total: 1 }; } };
    await fetchProductDataQuality.call(fake as any, "p1").catch(() => undefined);
    expect(bodies[0].includes.product).toEqual(expect.arrayContaining(["categories", "visibilities", "media", "coverId"]));
  });
});
