/**
 * Shop-Puls Stufe 2 (S2-4), Google Ads (nur lesend): Einrichtung prüfen, Daten über eine simulierte
 * Ads-API laden (GAQL nacheinander je Konto), die sechs Prüfungen und der Wochenbericht-Abschnitt.
 * Gegen ein echtes Ads-Konto ist das nicht getestet (Zugänge bei Smarketer).
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { adsAccess, AdsNotConfiguredError, checkAdsSetup, loadAdsData, loadAdsWeek, type AdsAccount, type AdsData } from "../../server/shopPulse/adsClient";
import {
  adsDetections,
  adsDetector,
  budgetDetections,
  marginDetections,
  measurementDetections,
  negativeOf,
  noResultDetections,
  searchTermDetections,
  shoppingDetections,
  unbuyableReason,
} from "../../server/shopPulse/detectors/ads";
import { DE_CHANNEL_ID } from "../../server/shopPulse/detectors/buyability";
import { adsWeekly } from "../../server/shopPulse/weeklyReport";
import type { BuyabilityProduct } from "../../server/shopPulse/buyabilityData";
import { addDays } from "../../server/shopPulse/pulseOrders";
import type { ShopPulseSignal } from "../../shared/shopPulse";

const YESTERDAY = "2026-10-18";
const SETTINGS = { enabled: true, customerIds: ["123-456-7890"], developerToken: "dev", clientId: "cid", clientSecret: "sec", refreshToken: "ref", loginCustomerId: "111-222-3333" };

const empty = (): AdsData => ({ groups: [], campaigns: [], days: [], products: [], terms: [] });
const product = (over: Partial<BuyabilityProduct> = {}): BuyabilityProduct => ({
  productNumber: "SW1",
  name: "Regal",
  active: true,
  salesChannelIds: [DE_CHANNEL_ID],
  priceGross: 100,
  stock: 5,
  deliveryTimeId: "d",
  restockTime: null,
  categoryCount: 1,
  isVariant: false,
  ...over,
});

describe("Einrichtung", () => {
  it("prüft Schalter, Kunden-ID und Zugangsdaten", () => {
    expect(checkAdsSetup({ ...SETTINGS, enabled: false })).toEqual({ ok: false, reason: "disabled" });
    expect(checkAdsSetup({ ...SETTINGS, customerIds: [] })).toEqual({ ok: false, reason: "noCustomer" });
    expect(checkAdsSetup({ ...SETTINGS, refreshToken: "" })).toEqual({ ok: false, reason: "noCredentials" });
    const ok = checkAdsSetup(SETTINGS);
    expect(ok.ok && ok.customerIds).toEqual(["1234567890"]);
    expect(ok.ok && ok.loginCustomerId).toBe("1112223333");
  });

  it("nicht eingerichtet: AdsNotConfiguredError (die Prüfung setzt aus)", async () => {
    const access = adsAccess({ getSetting: async () => ({ enabled: false }) }, "t1");
    await expect(access.account()).rejects.toBeInstanceOf(AdsNotConfiguredError);
  });

  it("unvollständige Zugangsdaten: noCredentials", async () => {
    const access = adsAccess({ getSetting: async () => ({ enabled: true, customerIds: ["1234567890"] }) }, "t1", () => async () => []);
    await expect(access.account()).rejects.toMatchObject({ reason: "noCredentials" });
  });

  it("Fehler des Clients werden verständlich (ohne Zugangsdaten im Text)", async () => {
    const access = adsAccess({ getSetting: async () => SETTINGS }, "t1", () => async () => Promise.reject(new Error("USER_PERMISSION_DENIED: ref=secret")));
    const account = await access.account();
    await expect(account.query("1234567890", "SELECT")).rejects.toThrow("Google Ads: keine Leserechte für dieses Konto");
  });
});

describe("Daten laden (simulierte API)", () => {
  it("fünf GAQL-Abfragen je Konto, nacheinander, Kosten in €", async () => {
    const seen: string[] = [];
    const account: AdsAccount = {
      customerIds: ["1234567890"],
      query: async (_id, gaql) => {
        seen.push(gaql.split(" FROM ")[1].split(" ")[0]);
        if (gaql.includes("FROM ad_group")) return [{ campaign: { id: 1, name: "Regale" }, ad_group: { id: 9, name: "Schwerlast" }, metrics: { cost_micros: 210_500_000, clicks: 40, conversions: 0 } }];
        if (gaql.includes("FROM campaign")) return [{ campaign: { id: 1, name: "Regale", advertising_channel_type: "SEARCH" }, metrics: { cost_micros: 900_000_000, clicks: 300, conversions: 4, search_budget_lost_impression_share: 0.31 } }];
        if (gaql.includes("FROM customer")) return [{ segments: { date: "2026-10-18" }, metrics: { cost_micros: 30_000_000, conversions: 1 } }];
        if (gaql.includes("shopping_performance_view")) return [{ segments: { product_item_id: "sw1" }, metrics: { cost_micros: 25_000_000, clicks: 10, conversions: 0 } }];
        return [{ search_term_view: { search_term: "regal gratis" }, campaign: { name: "Regale" }, metrics: { cost_micros: 45_000_000, clicks: 12, conversions: 0 } }];
      },
    };
    const data = await loadAdsData(account, YESTERDAY);
    expect(seen).toEqual(["ad_group", "campaign", "customer", "shopping_performance_view", "search_term_view"]);
    expect(data.groups[0]).toMatchObject({ cost: 210.5, adGroup: "Schwerlast", conversions: 0 });
    expect(data.campaigns[0]).toMatchObject({ cost: 900, budgetLost: 0.31, conversions: 4 });
    expect(data.days).toEqual([{ day: "2026-10-18", cost: 30, conversions: 1 }]);
    expect(data.products[0]).toMatchObject({ itemId: "sw1", cost: 25 });
    expect(data.terms[0]).toMatchObject({ term: "regal gratis", cost: 45 });
    expect(await loadAdsWeek(account, "2026-10-12", "2026-10-18")).toEqual({ cost: 30, clicks: 0, conversions: 1 });
  });

  it("lehnt ungültige Tage ab (nichts ungeprüft ins GAQL)", async () => {
    const account: AdsAccount = { customerIds: ["1"], query: async () => [] };
    await expect(loadAdsWeek(account, "2026-10-12' OR 1=1", "2026-10-18")).rejects.toThrow("Ungültiger Zeitraum");
  });
});

describe("Prüfungen", () => {
  it("1. Kosten ohne Ergebnis: über 150 € in 14 Tagen ohne Conversion", () => {
    const d = empty();
    d.groups = [
      { customerId: "1", campaignId: "1", campaign: "Regale", adGroupId: "9", adGroup: "Schwerlast", cost: 210.5, clicks: 40, conversions: 0 },
      { customerId: "1", campaignId: "1", campaign: "Regale", adGroupId: "8", adGroup: "Klein", cost: 149, clicks: 40, conversions: 0 },
      { customerId: "1", campaignId: "1", campaign: "Regale", adGroupId: "7", adGroup: "Gut", cost: 400, clicks: 40, conversions: 2 },
    ];
    const found = noResultDetections(d);
    expect(found.map((f) => f.key)).toEqual(["ads:noresult:1:9"]);
    expect(found[0]).toMatchObject({ code: "adsCostNoResult", severity: "warning", params: { cost: 210.5, days: 14 }, lossPerHour: 1 });
  });

  it("2. Kosten je Conversion über dem Ø Deckungsbeitrag", () => {
    const d = empty();
    d.campaigns = [
      { customerId: "1", campaignId: "1", campaign: "Teuer", channel: "SEARCH", cost: 900, clicks: 1, conversions: 4, budgetLost: null },
      { customerId: "1", campaignId: "2", campaign: "Gut", channel: "SEARCH", cost: 300, clicks: 1, conversions: 4, budgetLost: null },
      { customerId: "1", campaignId: "3", campaign: "Wenig", channel: "SEARCH", cost: 900, clicks: 1, conversions: 2, budgetLost: null },
    ];
    expect(marginDetections(d, 180).map((f) => f.params)).toEqual([{ campaign: "Teuer", cost: 900, conversions: 4, costPerConversion: 225, avgDb1: 180 }]);
    expect(marginDetections(d, null)).toEqual([]);
  });

  it("3. Shopping auf nicht kaufbare Artikel (kritisch), Artikel-ID ohne Groß/Klein", () => {
    expect(unbuyableReason(undefined)).toBe("missing");
    expect(unbuyableReason(product({ active: false }))).toBe("inactive");
    expect(unbuyableReason(product({ salesChannelIds: [] }))).toBe("hidden");
    expect(unbuyableReason(product({ priceGross: 0 }))).toBe("priceZero");
    expect(unbuyableReason(product({ isCloseout: true, stock: 0 }))).toBe("soldOut");
    expect(unbuyableReason(product())).toBeNull();
    const d = empty();
    d.products = [
      { itemId: "sw1", cost: 25, clicks: 10, conversions: 0 },
      { itemId: "sw2", cost: 30, clicks: 10, conversions: 0 },
      { itemId: "sw3", cost: 5, clicks: 1, conversions: 0 },
    ];
    const found = shoppingDetections(d, [product(), product({ productNumber: "SW2", active: false }), product({ productNumber: "SW3", active: false })]);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: "ads:shopping:unbuyable", severity: "critical", params: { count: 1, cost: 30 } });
    expect((found[0].evidence as any).products[0]).toMatchObject({ number: "SW2", reason: "inactive" });
  });

  it("4. teure Suchbegriffe ohne Bestellung mit Vorschlag zum Ausschließen", () => {
    const d = empty();
    d.terms = [
      { term: "Regal gratis", campaign: "A", cost: 20, clicks: 3, conversions: 0 },
      { term: "regal gratis", campaign: "B", cost: 25, clicks: 4, conversions: 0 },
      { term: "schwerlastregal", campaign: "A", cost: 300, clicks: 50, conversions: 3 },
      { term: "regal billig", campaign: "A", cost: 29, clicks: 20, conversions: 0 },
    ];
    const [f] = searchTermDetections(d);
    expect(f.params).toMatchObject({ count: 1, cost: 45 });
    expect((f.evidence as any).suggestions).toEqual([{ term: "Regal gratis", cost: 45, clicks: 7, campaigns: ["A", "B"], negative: "[regal gratis]" }]);
    expect(negativeOf(" Regal  ")).toBe("[regal]");
  });

  it("5. Messung: Conversions je MO-Bestellung eingebrochen bzw. 0 bei Kosten (kritisch)", () => {
    const d = empty();
    const orders: Array<{ day: string }> = [];
    for (let i = 0; i < 35; i++) {
      const day = addDays(YESTERDAY, -i);
      d.days.push({ day, cost: 50, conversions: i < 7 ? 0.2 : 2 });
      orders.push({ day }, { day });
    }
    const drop = measurementDetections(d, orders, YESTERDAY);
    expect(drop[0]).toMatchObject({ code: "adsMeasurementDrop", severity: "warning", params: { expected: 100, orders: 14 } });
    for (const x of d.days) if (x.day >= addDays(YESTERDAY, -6)) x.conversions = 0;
    expect(measurementDetections(d, orders, YESTERDAY)[0].severity).toBe("critical");
    expect(measurementDetections(d, orders.slice(0, 6), YESTERDAY)).toEqual([]);
  });

  it("6. mehr Budget lohnt: Budget-Verlust ≥ 20 % und Deckungsbeitrag ≥ doppelte Kosten", () => {
    const d = empty();
    d.campaigns = [
      { customerId: "1", campaignId: "1", campaign: "Lohnt", channel: "SHOPPING", cost: 300, clicks: 1, conversions: 5, budgetLost: 0.35 },
      { customerId: "1", campaignId: "2", campaign: "Knapp", channel: "SHOPPING", cost: 600, clicks: 1, conversions: 5, budgetLost: 0.35 },
      { customerId: "1", campaignId: "3", campaign: "Kein Limit", channel: "SEARCH", cost: 100, clicks: 1, conversions: 5, budgetLost: 0.05 },
    ];
    expect(budgetDetections(d, 180).map((f) => f.params)).toEqual([{ campaign: "Lohnt", lost: 35, cost: 300, estDb1: 900, conversions: 5 }]);
  });

  it("ohne Produktspiegel nur die Shopping-Prüfung aus", () => {
    const d = empty();
    d.products = [{ itemId: "x", cost: 99, clicks: 1, conversions: 0 }];
    d.terms = [{ term: "x", campaign: "A", cost: 99, clicks: 9, conversions: 0 }];
    expect(adsDetections({ data: d, products: null, orders: [], avgDb1: null, yesterday: YESTERDAY }).map((f) => f.code)).toEqual(["adsSearchTermsWaste"]);
  });

  it("der Detektor setzt ohne Einrichtung aus", async () => {
    const ctx: any = { ads: { account: async () => Promise.reject(new AdsNotConfiguredError("disabled")) }, now: new Date("2026-10-19T08:00:00Z") };
    await expect(adsDetector.run(ctx)).rejects.toBeInstanceOf(AdsNotConfiguredError);
  });
});

describe("Wochenbericht", () => {
  it("Kosten der Woche, Vorschläge aus der offenen Suchbegriff-Meldung, Hinweis wenn nicht eingerichtet", () => {
    const signal = { status: "open", code: "adsSearchTermsWaste", key: "ads:searchterms", evidence: { suggestions: [{ term: "regal gratis", cost: 45, clicks: 7, negative: "[regal gratis]" }] } } as unknown as ShopPulseSignal;
    const other = { status: "open", code: "adsCostNoResult", key: "ads:noresult:1:9", evidence: {} } as unknown as ShopPulseSignal;
    const w = adsWeekly({ cost: 300, clicks: 100, conversions: 4 }, 150, [signal, other]);
    expect(w).toEqual({ configured: true, cost: 300, clicks: 100, conversions: 4, costPerConversion: 75, avgDb1PerOrder: 150, openCount: 2, suggestions: [{ term: "regal gratis", cost: 45, clicks: 7, negative: "[regal gratis]" }] });
    expect(adsWeekly(null, null, [], "noCredentials")).toEqual({ configured: false, problem: "noCredentials" });
  });
});
