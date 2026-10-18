/**
 * Shop-Puls PR C: Kaufbarkeit der Stammdaten. Topseller-Gewichtung, Prüfungen gegen den Soll-Stand
 * (nicht mehr kaufbar, Preis 0, Preissprung, Abverkauf ohne Bestand, Lieferzeit), Zahl- und Versandarten,
 * Datenlücken für die PIM-Sammlung, Umsatz je Artikel, Erledigen je Prüfung, Nachtlauf im Zeitplan.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  dataGapsCsv,
  dataGapsOf,
  methodDetections,
  piecesFromName,
  productBuyabilityDetections,
  topsellers,
  BUYABILITY_BASELINE_KEY,
  acceptBuyabilityBaseline,
  DATA_GAPS_KEY,
  DE_CHANNEL_ID,
  channelMethodsDetector,
  productBuyabilityDetector,
} from "../../server/shopPulse/detectors/buyability";
import { revenueByProduct, toBuyabilityProduct, type BuyabilityProduct } from "../../server/shopPulse/buyabilityData";
import { reconcileSignals, type ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import { isNightlyDue, runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import type { ChannelMethods } from "../../server/shopPulse/detectors/types";
import { SHOP_PULSE_SETTINGS_KEY, getShopPulseState } from "../../server/shopPulse/shopPulseSettings";
import type { ShopPulseSignal } from "../../shared/shopPulse";

const product = (productNumber: string, over: Partial<BuyabilityProduct> = {}): BuyabilityProduct => ({
  productNumber,
  name: `Artikel ${productNumber}`,
  active: true,
  salesChannelIds: [DE_CHANNEL_ID],
  priceGross: 100,
  stock: 10,
  isCloseout: false,
  minPurchase: 1,
  coverId: "cover",
  purchaseUnit: 1,
  deliveryTimeId: "dt",
  restockTime: 3,
  categoryCount: 1,
  isVariant: false,
  ...over,
});

/** A = 70 %, B = 20 %, C = 10 %: Topseller sind A und B */
const REVENUE = new Map([
  ["A", 7000],
  ["B", 2000],
  ["C", 1000],
]);

const run = (products: BuyabilityProduct[], over: Partial<Parameters<typeof productBuyabilityDetections>[0]> = {}) =>
  productBuyabilityDetections({ products, revenue: REVENUE, priceChanges: [], baselineProducts: ["A", "B", "C"], ...over });

describe("Topseller", () => {
  it("kleinste Menge, die 80 % des Umsatzes erreicht", () => {
    expect(Array.from(topsellers(REVENUE))).toEqual(["A", "B"]);
    expect(Array.from(topsellers(new Map([["X", 10]])))).toEqual(["X"]);
    expect(topsellers(new Map()).size).toBe(0);
  });
});

describe("Artikel gegen den Soll-Stand", () => {
  it("erster Lauf: kein Fund, Soll-Stand = kaufbare Artikel mit Umsatz", () => {
    const r = run([product("A"), product("B", { active: false }), product("D")], { baselineProducts: undefined });
    expect(r.detections).toEqual([]);
    expect(r.baselineProducts).toEqual(["A"]);
  });

  it("Topseller nicht mehr kaufbar: einzeln kritisch je Grund; übrige als Sammel-Warnung", () => {
    const r = run([product("A", { active: false }), product("B", { salesChannelIds: ["other"] }), product("C", { active: false })]);
    expect(r.detections.map((d) => [d.key, d.code, d.severity])).toEqual([
      ["buyability:product:unavailable:A", "topsellerInactive", "critical"],
      ["buyability:product:unavailable:B", "topsellerHidden", "critical"],
      ["buyability:product:unavailable:other", "productsUnavailable", "warning"],
    ]);
    expect(r.detections[0].params).toMatchObject({ number: "A", revenue: 7000 });
    expect(r.detections[0].lossPerHour).toBe(Math.round((7000 * 1.19) / 365 / 12));
    expect(r.detections[2].params).toMatchObject({ count: 1, examples: "C (Artikel C)" });
    // Soll-Stand verliert nichts von selbst
    expect(r.baselineProducts).toEqual(["A", "B", "C"]);
  });

  it("gelöschter Topseller, neue kaufbare Artikel kommen in den Soll-Stand", () => {
    const r = run([product("B"), product("C"), product("E")], { revenue: new Map([...REVENUE, ["E", 5]]) });
    expect(r.detections.map((d) => d.code)).toEqual(["topsellerMissing"]);
    expect(r.baselineProducts).toEqual(["A", "B", "C", "E"]);
  });

  it("Preis 0 €: Topseller kritisch, übrige gesammelt; Varianten zählen nicht", () => {
    const r = run([product("A", { priceGross: 0 }), product("B"), product("C", { priceGross: 0 }), product("V", { priceGross: 0, isVariant: true })]);
    expect(r.detections.map((d) => [d.key, d.severity])).toEqual([
      ["buyability:product:price-zero:A", "critical"],
      ["buyability:product:price-zero:other", "warning"],
    ]);
  });

  it("Preissprung ab ±30 %, letzte Änderung zählt, nur kaufbare Artikel", () => {
    const at = (h: number) => new Date(Date.UTC(2026, 9, 18, h));
    const r = run([product("A"), product("B"), product("C"), product("X", { active: false })], {
      priceChanges: [
        { productNumber: "A", oldPriceGross: 100, newPriceGross: 110, changedAt: at(1) },
        { productNumber: "A", oldPriceGross: 110, newPriceGross: 11, changedAt: at(2) },
        { productNumber: "B", oldPriceGross: 100, newPriceGross: 125, changedAt: at(2) },
        { productNumber: "C", oldPriceGross: 100, newPriceGross: 150, changedAt: at(2) },
        { productNumber: "X", oldPriceGross: 100, newPriceGross: 500, changedAt: at(2) },
        { productNumber: "C", oldPriceGross: 0, newPriceGross: 150, changedAt: at(1) },
      ],
    });
    expect(r.detections.map((d) => [d.key, d.severity, d.params?.percent])).toEqual([
      ["buyability:product:price-jump:A", "critical", -90],
      ["buyability:product:price-jump:C", "warning", 50],
    ]);
    expect(r.detections[0].params).toMatchObject({ oldPrice: 110, newPrice: 11 });
  });

  it("Abverkauf ohne Bestand (unter Mindestabnahme); ohne Feld im Spiegel kein Fund", () => {
    const r = run([
      product("A", { isCloseout: true, stock: 0 }),
      product("B", { isCloseout: true, stock: 3, minPurchase: 5 }),
      product("C", { isCloseout: true, stock: 0 }),
      product("D", { isCloseout: undefined, stock: 0 }),
      product("E", { isCloseout: false, stock: 0 }),
    ]);
    expect(r.detections.map((d) => [d.key, d.code])).toEqual([
      ["buyability:product:sold-out:A", "topsellerSoldOut"],
      ["buyability:product:sold-out:B", "topsellerSoldOut"],
      ["buyability:product:sold-out:other", "productsSoldOut"],
    ]);
  });

  it("technische Artikel (Konfigurator, Service): keine Lieferzeit-Prüfung und keine Datenlücken, aber „nicht mehr kaufbar“", () => {
    const tech = { isTechnical: true, deliveryTimeId: null, categoryCount: 0 };
    const r = run([product("A", tech), product("B"), product("C")]);
    expect(r.detections).toEqual([]);
    expect(r.dataGaps).toEqual([]);
    expect(run([product("A", { ...tech, active: false }), product("B"), product("C")]).detections.map((d) => d.code)).toEqual(["topsellerInactive"]);
    expect(toBuyabilityProduct({ productNumber: "SW10001", active: true, name: "Konfigurator Artikel", payload: {} }).isTechnical).toBe(true);
    expect(toBuyabilityProduct({ productNumber: "stapler", active: true, name: "Mitnahmestapler", payload: { serviceType: "forklift" } }).isTechnical).toBe(true);
    expect(toBuyabilityProduct({ productNumber: "4026212011258", active: true, name: "CLIP", payload: {} }).isTechnical).toBe(false);
  });

  it("Topseller ohne Lieferzeit oder mit Wiederauffüllzeit über 20 Tage: Sammel-Warnungen", () => {
    const r = run([product("A", { deliveryTimeId: null }), product("B", { restockTime: 21 }), product("C", { deliveryTimeId: null, restockTime: 99 })]);
    expect(r.detections.map((d) => [d.key, d.severity, d.params?.count])).toEqual([
      ["buyability:product:no-delivery-time", "warning", 1],
      ["buyability:product:long-restock", "warning", 1],
    ]);
    expect(r.detections[1].params).toMatchObject({ days: 20, examples: "B (Artikel B)" });
  });
});

describe("Datenlücken für die PIM-Sammlung", () => {
  it("Stückzahl aus dem Namen", () => {
    expect(piecesFromName("META Fachteiler | 10 Stück")).toBe(10);
    expect(piecesFromName("Bodenanker zu 6 Stück verpackt")).toBe(6);
    expect(piecesFromName("Schraube M8, 50 Stk.")).toBe(50);
    expect(piecesFromName("Regalfuß-Paar")).toBe(2);
    expect(piecesFromName("META CLIP | Fachbodenregal | Grundregal | 2000 x 1000 x 300 mm")).toBeNull();
    expect(piecesFromName("META CLIP SET | Fachbodenregal | 3 Felder")).toBeNull();
  });

  it("kein Bild, keine Kategorie, Mehrstück mit Verkaufseinheit 1; fehlende Spiegel-Felder zählen nicht", () => {
    const gaps = dataGapsOf([
      product("1", { coverId: null }),
      product("2", { coverId: undefined, categoryCount: 0 }),
      product("3", { name: "Fachteiler | 10 Stück", purchaseUnit: 1 }),
      product("4", { name: "Fachteiler | 10 Stück", purchaseUnit: 10 }),
      product("5", { name: "Fachteiler | 10 Stück", purchaseUnit: undefined }),
    ]);
    expect(gaps.map((g) => [g.code, g.productNumber])).toEqual([
      ["noImage", "1"],
      ["noCategory", "2"],
      ["salesUnit", "3"],
    ]);
    expect(gaps[2].hint).toContain("Verkaufseinheit 10");
  });

  it("CSV im Format der Datenfehler-Sammlung (Semikolon, BOM, Anführungszeichen bei Bedarf)", () => {
    const csv = dataGapsCsv({ at: "2026-10-18T05:10:00.000Z", items: [{ code: "noImage", productNumber: "4026", name: 'Regal; "groß"', active: true, value: "kein Titelbild", hint: "Titelbild zuordnen" }] });
    const lines = csv.split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines[0]).toBe("﻿Fund;Gefunden am;Artikelnummer;Status Shop;Artikelname;Eigenschaft;Wert im Shop;Soll / Hinweis");
    expect(lines[1]).toBe('Shop-Puls: Bild;2026-10-18;4026;aktiv;"Regal; ""groß""";Titelbild;kein Titelbild;Titelbild zuordnen');
  });
});

describe("Zahl- und Versandarten", () => {
  const methods = (over: Partial<ChannelMethods> = {}): ChannelMethods => ({
    payment: [
      { id: "p1", name: "Vorkasse", active: true },
      { id: "p2", name: "Mondu", active: true },
    ],
    shipping: [{ id: "s1", name: "Spedition", active: true }],
    ...over,
  });

  it("ohne Soll-Stand: keiner, Soll = aktive Arten", () => {
    const r = methodDetections(methods(), {});
    expect(r.detections).toEqual([]);
    expect(r.payment?.map((m) => m.id)).toEqual(["p1", "p2"]);
  });

  it("entfernt oder inaktiv: kritisch; neue aktive kommen dazu", () => {
    const soll = { payment: [{ id: "p1", name: "Vorkasse" }, { id: "p2", name: "Mondu" }], shipping: [{ id: "s1", name: "Spedition" }] };
    const r = methodDetections(
      methods({ payment: [{ id: "p1", name: "Vorkasse", active: false }, { id: "p3", name: "PayPal", active: true }], shipping: [{ id: "s1", name: "Spedition", active: true }] }),
      soll,
    );
    expect(r.detections.map((d) => [d.key, d.code, d.params?.name])).toEqual([
      ["buyability:method:payment:p1", "paymentMethodGone", "Vorkasse"],
      ["buyability:method:payment:p2", "paymentMethodGone", "Mondu"],
    ]);
    expect(r.payment?.map((m) => m.id)).toEqual(["p1", "p2", "p3"]);
  });
});

describe("Als Soll übernehmen", () => {
  it("jetzt kaufbare Artikel mit Umsatz und aktive Arten; ohne Admin-API bleiben die Arten", async () => {
    const saved = new Map<string, any>();
    const storage: any = { getSetting: async (k: string) => saved.get(k), saveSetting: async (k: string, v: any) => void saved.set(k, v) };
    saved.set(BUYABILITY_BASELINE_KEY, { takenAt: "x", products: ["A", "B", "C"], payment: [{ id: "p1", name: "Vorkasse" }], shipping: [] });
    const products = async () => [product("A", { active: false }), product("B"), product("C"), product("D")];
    const now = new Date("2026-10-18T12:00:00Z");
    await acceptBuyabilityBaseline({
      storage,
      tenantId: "t1",
      now,
      buyability: { products, revenue: async () => REVENUE, priceChanges: async () => [], channelMethods: async () => Promise.reject(new Error("offline")) },
    });
    expect(saved.get(BUYABILITY_BASELINE_KEY)).toEqual({ takenAt: now.toISOString(), products: ["B", "C"], payment: [{ id: "p1", name: "Vorkasse" }], shipping: [] });
    await acceptBuyabilityBaseline({
      storage,
      tenantId: "t1",
      now,
      buyability: { products, revenue: async () => REVENUE, priceChanges: async () => [], channelMethods: async () => ({ payment: [{ id: "p2", name: "PayPal", active: true }, { id: "p3", name: "Alt", active: false }], shipping: [] }) },
    });
    expect(saved.get(BUYABILITY_BASELINE_KEY).payment).toEqual([{ id: "p2", name: "PayPal" }]);
  });
});

describe("Spiegel-Daten", () => {
  it("Umsatz je Artikel: MO, nicht storniert, je Nummer die zuletzt geänderte Zeile, ab Stichtag", () => {
    const row = (orderNumber: string, updated: number, items: Array<[string, number]>, over: Record<string, unknown> = {}) => ({
      orderNumber,
      swUpdatedAt: new Date(updated),
      createdAt: "2026-06-01T10:00:00Z",
      status: "open",
      items: items.map(([productNumber, netTotal]) => ({ productNumber, netTotal })),
      ...over,
    });
    const rev = revenueByProduct(
      [
        row("MO1", 1, [["A", 100]]),
        row("MO1", 2, [["A", 150]]),
        row("MO2", 1, [["A", 50], ["B", 20]]),
        row("MO3", 1, [["A", 999]], { status: "cancelled" }),
        row("12345", 1, [["A", 999]]),
        row("MO4", 1, [["A", 999]], { createdAt: "2025-01-01T00:00:00Z" }),
      ],
      new Date("2025-10-18T00:00:00Z"),
    );
    expect(Object.fromEntries(rev)).toEqual({ A: 200, B: 20 });
  });

  it("Spiegel-Zeile: fehlende Felder (alter Payload) bleiben undefined", () => {
    const old = toBuyabilityProduct({ productNumber: "A", active: true, name: "A", payload: { salesChannelIds: [DE_CHANNEL_ID], priceGross: 10 } });
    expect(old.isCloseout).toBeUndefined();
    expect(old.coverId).toBeUndefined();
    const v3 = toBuyabilityProduct({ productNumber: "A", active: true, name: "A", payload: { isCloseout: true, coverId: null, purchaseUnit: 2, parentId: "p" } });
    expect(v3).toMatchObject({ isCloseout: true, coverId: null, purchaseUnit: 2, isVariant: true });
  });
});

describe("Erledigen je Prüfung und Ereignisse", () => {
  const signal = (over: Partial<ShopPulseSignal>): ShopPulseSignal => ({
    id: "s",
    key: "buyability:method:payment:p1",
    source: "buyability",
    code: "paymentMethodGone",
    severity: "critical",
    status: "open",
    params: {},
    evidence: {},
    lossPerHour: null,
    firstSeenAt: "2026-10-18T05:00:00.000Z",
    lastSeenAt: "2026-10-18T05:00:00.000Z",
    resolvedAt: null,
    resolvedBy: null,
    mutedUntil: null,
    notifiedAt: "2026-10-18T05:00:00.000Z",
    notifiedSeverity: "critical",
    ...over,
  });
  const opts = { now: new Date("2026-10-18T10:00:00Z"), learning: false, completeSources: [], newId: () => "n" };

  it("Quelle unvollständig, aber Prüfung mit eigenem Schlüssel-Anfang lief: nur deren Meldungen erledigt", () => {
    const r = reconcileSignals([signal({}), signal({ id: "t", key: "buyability:product:unavailable:A", code: "topsellerInactive" })], [], { ...opts, completeKeyPrefixes: ["buyability:method:"] });
    expect(r.updates.map((u) => u.id)).toEqual(["s"]);
    expect(r.notices.map((n) => n.kind)).toEqual(["resolved"]);
  });

  it("Preissprung läuft aus ohne Entwarnung", () => {
    const r = reconcileSignals([signal({ key: "buyability:product:price-jump:A", code: "priceJump" })], [], { ...opts, completeSources: ["buyability"] });
    expect(r.updates[0].patch.status).toBe("resolved");
    expect(r.notices).toEqual([]);
  });
});

// -------------------------------------------------------------------------------------------------
// Nachtlauf im Zeitplan

describe("Nachtlauf", () => {
  it("fällig: noch nie gelaufen, oder 5–7 Uhr Berlin und heute noch nicht", () => {
    const prev = (at: string) => ({ at, ok: true, findings: 0 });
    expect(isNightlyDue(undefined, new Date("2026-10-18T12:00:00Z"))).toBe(true);
    expect(isNightlyDue(prev("2026-10-17T03:00:00Z"), new Date("2026-10-18T02:59:00Z"))).toBe(false); // 4:59
    expect(isNightlyDue(prev("2026-10-17T03:00:00Z"), new Date("2026-10-18T03:00:00Z"))).toBe(true); // 5:00
    expect(isNightlyDue(prev("2026-10-18T03:00:00Z"), new Date("2026-10-18T04:00:00Z"))).toBe(false); // heute schon
    expect(isNightlyDue(prev("2026-10-17T03:00:00Z"), new Date("2026-10-18T05:00:00Z"))).toBe(false); // 7:00
  });

  function setup() {
    const settings = new Map<string, any>();
    const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
    const rows: ShopPulseSignal[] = [];
    let now = new Date("2026-10-18T03:30:00Z"); // 5:30 Berlin
    let products = [product("A"), product("B"), product("C")];
    let methods: ChannelMethods = { payment: [{ id: "p1", name: "Vorkasse", active: true }], shipping: [] };
    const calls = { products: 0, methods: 0 };
    const deps: ShopPulseDeps = {
      storage: {
        getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
        saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
        getUsersWithPermissionInTenant: async () => [],
        createNotification: async (n: any) => n,
        getShopwareSyncState: async () => undefined,
      } as any,
      repo: {
        listSignalsBySources: async (_t: string | null, sources: string[]) => structuredClone(rows.filter((r) => sources.includes(r.source))),
        listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
        applyReconcile: async (_t: string | null, result: ReconcileResult) => {
          rows.push(...structuredClone(result.inserts));
          for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
        },
      },
      detectors: [channelMethodsDetector, productBuyabilityDetector],
      loadOrders: async () => [],
      loadBuyability: () => ({
        products: async () => (calls.products++, products),
        revenue: async () => REVENUE,
        priceChanges: async () => [],
        channelMethods: async () => (calls.methods++, methods),
      }),
      onNotificationCreated: () => undefined,
      baseUrl: null,
      now: () => now,
      newId: (() => {
        let i = 0;
        return () => `id${++i}`;
      })(),
    };
    return {
      deps,
      rows,
      calls,
      settings: (key: string) => settings.get(k(key, "t1")),
      set: (o: { now?: Date; products?: BuyabilityProduct[]; methods?: ChannelMethods }) => {
        if (o.now) now = o.now;
        if (o.products) products = o.products;
        if (o.methods) methods = o.methods;
      },
      enable: () => settings.set(k(SHOP_PULSE_SETTINGS_KEY, "t1"), { enabled: true, learningUntil: "2026-10-01T00:00:00Z" }),
    };
  }

  it("Soll-Stand anlegen, Fund am nächsten Morgen, tagsüber nur Zahlarten, Erledigen je Prüfung", async () => {
    const t = setup();
    t.enable();
    // 1. Erster Lauf (5:30): Soll-Stand und Datenlücken angelegt, keine Funde
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.settings(BUYABILITY_BASELINE_KEY)).toMatchObject({ products: ["A", "B", "C"], payment: [{ id: "p1", name: "Vorkasse" }] });
    expect(t.settings(DATA_GAPS_KEY)).toMatchObject({ items: [] });
    expect(t.rows).toEqual([]);

    // 2. Tagsüber: Artikel A inaktiv, Zahlart weg → nur die Zahlart wird gefunden, der Nachtlauf ist nicht fällig
    t.set({ now: new Date("2026-10-18T10:00:00Z"), products: [product("A", { active: false }), product("B"), product("C")], methods: { payment: [], shipping: [] } });
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows.map((r) => [r.key, r.status])).toEqual([["buyability:method:payment:p1", "open"]]);
    expect(t.calls.products).toBe(1);
    const state = await getShopPulseState(t.deps.storage, "t1");
    expect(state.detectors?.buyability?.at).toBe("2026-10-18T03:30:00.000Z");

    // 3. Zahlart wieder da: tagsüber erledigt, obwohl der Nachtlauf (gleiche Quelle) nicht lief
    t.set({ now: new Date("2026-10-18T10:15:00Z"), methods: { payment: [{ id: "p1", name: "Vorkasse", active: true }], shipping: [] } });
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows[0].status).toBe("resolved");

    // 4. Nächster Morgen: Nachtlauf findet den inaktiven Topseller
    t.set({ now: new Date("2026-10-19T03:30:00Z") });
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows.map((r) => [r.key, r.status, r.severity])).toEqual([
      ["buyability:method:payment:p1", "resolved", "critical"],
      ["buyability:product:unavailable:A", "open", "critical"],
    ]);
  });

  it("Zahlarten-Prüfung scheitert: Artikel-Meldungen werden trotzdem erledigt", async () => {
    const t = setup();
    t.enable();
    await runShopPulseForTenant(t.deps, "t1");
    t.set({ now: new Date("2026-10-19T03:30:00Z"), products: [product("A", { active: false }), product("B"), product("C")] });
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows.map((r) => [r.key, r.status])).toEqual([["buyability:product:unavailable:A", "open"]]);
    // Artikel wieder aktiv, aber die Admin-API für die Zahlarten antwortet nicht
    t.set({ now: new Date("2026-10-20T03:30:00Z"), products: [product("A"), product("B"), product("C")] });
    const sources = t.deps.loadBuyability!;
    t.deps.loadBuyability = (tenantId, now) => ({
      ...sources(tenantId, now),
      channelMethods: async () => {
        throw new Error("Shopware nicht erreichbar");
      },
    });
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows.map((r) => [r.key, r.status])).toEqual([["buyability:product:unavailable:A", "resolved"]]);
  });

  it("Preisänderungen seit dem vorigen Nachtlauf mit einer Stunde Überlappung", async () => {
    let since: Date | null = null;
    const ctx: any = {
      storage: { getSetting: async () => undefined, saveSetting: async () => undefined },
      tenantId: "t1",
      now: new Date("2026-10-19T03:30:00Z"),
      lastRunAt: "2026-10-18T03:30:00.000Z",
      buyability: { products: async () => [product("A")], revenue: async () => REVENUE, priceChanges: async (s: Date) => ((since = s), []) },
    };
    await productBuyabilityDetector.run(ctx);
    expect(since!.toISOString()).toBe("2026-10-18T02:30:00.000Z");
    await productBuyabilityDetector.run({ ...ctx, lastRunAt: "2026-10-01T00:00:00.000Z" });
    expect(since!.toISOString()).toBe("2026-10-16T03:30:00.000Z");
  });

  it("„Jetzt prüfen“ startet den Nachtlauf auch tagsüber", async () => {
    const t = setup();
    t.set({ now: new Date("2026-10-18T10:00:00Z") });
    await runShopPulseForTenant(t.deps, "t1");
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.calls.products).toBe(1);
    await runShopPulseForTenant(t.deps, "t1", { force: true });
    expect(t.calls.products).toBe(2);
  });
});
