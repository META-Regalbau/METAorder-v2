/**
 * Shop-Puls, GA4-Abweichungen (PR E): Einrichtung, Client-Hülle, alle Regeln und der Lauf über den
 * Zeitplan – mit simuliertem GA4-Client (runReport/runRealtimeReport). Gegen echtes GA4 ist das noch nicht
 * geprüft (Dienstkonto fehlt).
 */
import { describe, expect, it, vi } from "vitest";
import { encrypt } from "../../server/lib/encryption";
import {
  checkGa4Setup,
  ga4Access,
  ga4Property,
  Ga4NotConfiguredError,
  type Ga4DataClient,
  type Ga4Row,
} from "../../server/shopPulse/ga4Client";
import {
  channelDetections,
  checkSearchTerms,
  funnelDetections,
  ga4LiveDetector,
  GA4_DETECTORS,
  GA4_STATE_KEY,
  gaDate,
  isGa4DailyDue,
  isGa4LiveDue,
  landingDetections,
  linkOrderGapWithGa4,
  liveBaselineFrom,
  liveDetections,
  measurementDetections,
  normalizeSearchTerms,
  sameWeekdays,
  searchNoHitsDetections,
  significantDrop,
  type Ga4State,
  type LiveBaseline,
  type LiveWindow,
} from "../../server/shopPulse/detectors/ga4";
import { orderGapDetector } from "../../server/shopPulse/detectors/revenue";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { SHOP_PULSE_SETTINGS_KEY } from "../../server/shopPulse/shopPulseSettings";
import type { ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import { addDays, berlinTime, type PulseOrder } from "../../server/shopPulse/pulseOrders";
import type { ShopPulseDetection, ShopPulseSignal } from "../../shared/shopPulse";

const SERVICE_ACCOUNT = JSON.stringify({ type: "service_account", client_email: "puls@meta.iam.gserviceaccount.com", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" });

/** Zeilen im Format des Google-Clients */
const raw = (rows: Array<[string[], number[]]>) => ({
  rows: rows.map(([d, m]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((v) => ({ value: String(v) })) })),
});
const rows = (list: Array<[string[], number[]]>): Ga4Row[] => list.map(([d, m]) => ({ d, m }));

function fakeClient(handler: { report?: (req: any) => Array<[string[], number[]]>; realtime?: (req: any) => Array<[string[], number[]]> }) {
  const client = {
    runReport: vi.fn(async (req: any) => [raw(handler.report?.(req) ?? [])] as [any]),
    runRealtimeReport: vi.fn(async (req: any) => [raw(handler.realtime?.(req) ?? [])] as [any]),
  };
  return client as typeof client & Ga4DataClient;
}

function order(day: string, hour = 10, total = 500): PulseOrder {
  const createdAt = new Date(`${day}T${String(hour - 2).padStart(2, "0")}:00:00Z`);
  return { orderNumber: `MO${day}${hour}${Math.random()}`, createdAt, day: berlinTime(createdAt).day, hour: berlinTime(createdAt).hour, total, paymentMethod: "Rechnung" };
}

describe("GA4-Einrichtung", () => {
  it("prüft Schalter, numerische Property-ID und Dienstkonto", () => {
    expect(checkGa4Setup({ enabled: false, propertyIds: ["123456789"], serviceAccountJson: SERVICE_ACCOUNT })).toEqual({ ok: false, reason: "disabled" });
    expect(checkGa4Setup({ enabled: true, propertyIds: [], serviceAccountJson: SERVICE_ACCOUNT })).toEqual({ ok: false, reason: "noProperty" });
    expect(checkGa4Setup({ enabled: true, propertyIds: ["G-QVEF735DQF"], serviceAccountJson: SERVICE_ACCOUNT })).toEqual({ ok: false, reason: "measurementId" });
    expect(checkGa4Setup({ enabled: true, propertyIds: ["GTM-MLGLSM7M"], serviceAccountJson: SERVICE_ACCOUNT })).toEqual({ ok: false, reason: "invalidProperty" });
    expect(checkGa4Setup({ enabled: true, propertyIds: ["123456789"], serviceAccountJson: "" })).toEqual({ ok: false, reason: "noServiceAccount" });
    expect(checkGa4Setup({ enabled: true, propertyIds: ["123456789"], serviceAccountJson: "{kaputt" })).toEqual({ ok: false, reason: "invalidServiceAccount" });
    expect(checkGa4Setup({ enabled: true, propertyIds: ["123456789"], serviceAccountJson: '{"client_email":"x"}' })).toEqual({ ok: false, reason: "invalidServiceAccount" });
    expect(checkGa4Setup({ enabled: true, propertyIds: [" properties/123456789 "], serviceAccountJson: SERVICE_ACCOUNT })).toMatchObject({ ok: true, propertyId: "123456789" });
  });

  it("liest die Einstellungen des Mandanten (verschlüsselt); nicht eingerichtet → Ga4NotConfiguredError", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "unit-tests-only-encryption-key");
    const settings = new Map<string, any>();
    const storage = { getSetting: async (key: string, t?: string | null) => settings.get(`${t}:${key}`) };
    settings.set("t1:ga4_settings", { enabled: true, propertyIds: ["G-QVEF735DQF"], serviceAccountJson: encrypt(SERVICE_ACCOUNT) });
    const make = vi.fn(() => fakeClient({}));
    await expect(ga4Access(storage, "t1", make).property()).rejects.toMatchObject({ name: "Ga4NotConfiguredError", reason: "measurementId" });
    expect(make).not.toHaveBeenCalled();
    await expect(ga4Access(storage, "t2", make).property()).rejects.toBeInstanceOf(Ga4NotConfiguredError);

    settings.set("t1:ga4_settings", { enabled: true, propertyIds: ["123456789"], serviceAccountJson: encrypt(SERVICE_ACCOUNT) });
    const client = fakeClient({ report: () => [[["20261018"], [5]]] });
    const access = ga4Access(storage, "t1", () => client);
    const p = await access.property();
    expect(p.propertyId).toBe("123456789");
    expect(await access.property()).toBe(p);
    expect(await p.report({ dimensions: ["date"], metrics: ["sessions"], startDate: "2026-10-18", endDate: "2026-10-18" })).toEqual([{ d: ["20261018"], m: [5] }]);
    vi.unstubAllEnvs();
  });

  it("Client-Hülle: Abfrage-Form, Zeilen, verständliche Fehler", async () => {
    const client = fakeClient({ report: () => [[["mobile", "add_to_cart"], [12]]], realtime: () => [[["page_view"], [40]]] });
    const p = ga4Property(client, "123456789");
    expect(await p.report({ dimensions: ["deviceCategory", "eventName"], metrics: ["totalUsers"], startDate: "2026-10-01", endDate: "2026-10-18", filter: { field: "eventName", inList: ["add_to_cart"] }, orderByMetric: true, limit: 50 })).toEqual([
      { d: ["mobile", "add_to_cart"], m: [12] },
    ]);
    expect(client.runReport.mock.calls[0][0]).toEqual({
      property: "properties/123456789",
      dimensions: [{ name: "deviceCategory" }, { name: "eventName" }],
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: { filter: { fieldName: "eventName", inListFilter: { values: ["add_to_cart"] } } },
      dateRanges: [{ startDate: "2026-10-01", endDate: "2026-10-18" }],
      limit: 50,
      orderBys: [{ metric: { metricName: "totalUsers" }, desc: true }],
    });
    await p.report({ dimensions: ["date"], metrics: ["screenPageViews"], startDate: "2026-10-18", endDate: "2026-10-18", filter: { field: "pageTitle", contains: "Seite nicht gefunden" } });
    expect(client.runReport.mock.calls[1][0].dimensionFilter).toEqual({ filter: { fieldName: "pageTitle", stringFilter: { matchType: "CONTAINS", value: "Seite nicht gefunden", caseSensitive: false } } });
    expect(await p.realtime({ dimensions: ["eventName"], metrics: ["eventCount"] })).toEqual([{ d: ["page_view"], m: [40] }]);
    expect(client.runRealtimeReport.mock.calls[0][0]).toMatchObject({ property: "properties/123456789", dimensions: [{ name: "eventName" }] });

    client.runReport.mockRejectedValueOnce(Object.assign(new Error("7 PERMISSION_DENIED: User does not have sufficient permissions"), { code: 7 }));
    await expect(p.report({ dimensions: ["date"], metrics: ["sessions"], startDate: "yesterday", endDate: "yesterday" })).rejects.toThrow(
      "GA4: Das Dienstkonto hat keine Leserechte in der Property 123456789",
    );
  });
});

describe("Hilfen und Takt", () => {
  it("deutlicher Einbruch verlangt Erwartung, Anteil und Abstand", () => {
    const rule = { minExpected: 10, maxShare: 0.5, z: 3 };
    expect(significantDrop(4, 20, rule)).toBe(true);
    expect(significantDrop(4, 9, rule)).toBe(false); // zu wenig erwartet
    expect(significantDrop(11, 20, rule)).toBe(false); // nicht halbiert
    expect(significantDrop(9, 18, { ...rule, z: 5 })).toBe(false); // zu nah an der Erwartung
  });

  it("gleiche Wochentage und GA4-Datum", () => {
    expect(sameWeekdays("2026-10-18", 3)).toEqual(["2026-10-11", "2026-10-04", "2026-09-27"]);
    expect(gaDate("2026-10-18")).toBe("20261018");
  });

  it("Live 6–22 Uhr alle 30 Minuten; Tagesprüfungen ab 7 Uhr einmal am Tag, nach Fehler erst nach 2 Stunden", () => {
    const at = (iso: string) => new Date(iso);
    expect(isGa4LiveDue(undefined, at("2026-10-19T03:30:00Z"))).toBe(false); // 5:30 Berlin
    expect(isGa4LiveDue(undefined, at("2026-10-19T04:00:00Z"))).toBe(true);
    expect(isGa4LiveDue({ at: "2026-10-19T08:00:00Z", ok: true, findings: 0 }, at("2026-10-19T08:15:00Z"))).toBe(false);
    expect(isGa4LiveDue({ at: "2026-10-19T08:00:00Z", ok: true, findings: 0 }, at("2026-10-19T08:30:00Z"))).toBe(true);
    expect(isGa4LiveDue({ at: "2026-10-19T08:00:00Z", ok: true, findings: 0 }, at("2026-10-19T20:30:00Z"))).toBe(false); // 22:30 Berlin

    expect(isGa4DailyDue(undefined, at("2026-10-19T04:30:00Z"))).toBe(false); // 6:30 Berlin
    expect(isGa4DailyDue(undefined, at("2026-10-19T05:00:00Z"))).toBe(true);
    expect(isGa4DailyDue({ at: "2026-10-19T05:00:00Z", ok: true, findings: 0 }, at("2026-10-19T12:00:00Z"))).toBe(false);
    expect(isGa4DailyDue({ at: "2026-10-18T05:00:00Z", ok: true, findings: 0 }, at("2026-10-19T05:00:00Z"))).toBe(true);
    expect(isGa4DailyDue({ at: "2026-10-19T05:00:00Z", ok: false, findings: 0 }, at("2026-10-19T06:00:00Z"))).toBe(false);
    expect(isGa4DailyDue({ at: "2026-10-19T05:00:00Z", ok: false, findings: 0 }, at("2026-10-19T07:00:00Z"))).toBe(true);
    expect(isGa4DailyDue({ at: "2026-10-19T05:00:00Z", ok: true, skipped: "ga4", findings: 0 }, at("2026-10-19T05:15:00Z"))).toBe(true);
  });

  it("alle GA4-Prüfungen gehören zur Quelle ga4 mit eigenem Schlüssel-Anfang", () => {
    expect(GA4_DETECTORS.map((d) => [d.id, d.source, d.keyPrefix])).toEqual([
      ["ga4Live", "ga4", "ga4:live:"],
      ["ga4Funnel", "ga4", "ga4:funnel:"],
      ["ga4Channels", "ga4", "ga4:channel:"],
      ["ga4LandingPages", "ga4", "ga4:landing:"],
      ["ga4SearchTerms", "ga4", "ga4:search:"],
      ["ga4Measurement", "ga4", "ga4:measurement:"],
    ]);
  });
});

// Montag, 19.10.2026
const baseline: LiveBaseline = {
  day: "2026-10-19",
  days: 8,
  pageViewsByHour: Array.from({ length: 24 }, () => 200),
  addToCartPerView: 0.05,
  checkoutPerView: 0.01,
  purchasePerCheckout: 0.3,
};
const windowsUntil = (endIso: string, n: number, w: Partial<LiveWindow>): LiveWindow[] =>
  Array.from({ length: n }, (_, i) => ({
    at: new Date(Date.parse(endIso) - (n - 1 - i) * 30 * 60 * 1000).toISOString(),
    pageViews: 100,
    addToCart: 5,
    beginCheckout: 1,
    purchases: 0,
    ...w,
  }));

describe("Live-Trichter", () => {
  const now = new Date("2026-10-19T10:00:00Z"); // 12:00 Berlin

  it("Erwartung je Stunde aus den gleichen Wochentagen, Quoten aus 28 Tagen", () => {
    const b = liveBaselineFrom(
      rows([
        [["20261012", "10", "page_view"], [300]],
        [["20261005", "10", "page_view"], [100]],
        [["20261013", "10", "page_view"], [5000]], // Dienstag: nicht in der Stunden-Erwartung
        [["20261012", "10", "add_to_cart"], [20]],
        [["20261013", "11", "begin_checkout"], [54]],
        [["20261013", "12", "purchase"], [27]],
        [["20260901", "10", "page_view"], [99999]], // älter als 28 Tage, kein gleicher Wochentag
      ]),
      "2026-10-19",
    );
    expect(b).toMatchObject({ day: "2026-10-19", days: 2, addToCartPerView: 20 / 5400, checkoutPerView: 54 / 5400, purchasePerCheckout: 0.5 });
    expect(b.pageViewsByHour[10]).toBe(200);
    expect(b.pageViewsByHour[11]).toBe(0);
  });

  it("2 Stunden Seitenaufrufe normal, aber kein add_to_cart → kritisch; begin_checkout zu selten erwartet", () => {
    const w = windowsUntil(now.toISOString(), 4, { addToCart: 0, beginCheckout: 0 });
    const found = liveDetections(w, baseline, now, 300);
    expect(found).toEqual([
      expect.objectContaining({ key: "ga4:live:add-to-cart", source: "ga4", code: "ga4LiveNoAddToCart", severity: "critical", params: { hours: 2, pageViews: 400, expected: 20 }, lossPerHour: 300 }),
    ]);
    // mit mehr Kassen-Quote auch begin_checkout
    expect(liveDetections(w, { ...baseline, checkoutPerView: 0.03 }, now).map((d) => d.code)).toEqual(["ga4LiveNoAddToCart", "ga4LiveNoCheckout"]);
  });

  it("kein Fund: ein Warenkorb, zu wenig Seitenaufrufe, Lücke in den Fenstern, zu wenig Vergleichstage", () => {
    expect(liveDetections(windowsUntil(now.toISOString(), 4, { addToCart: 0, beginCheckout: 0 }).map((x, i) => (i === 2 ? { ...x, addToCart: 1 } : x)), baseline, now)).toEqual([]);
    expect(liveDetections(windowsUntil(now.toISOString(), 4, { pageViews: 40, addToCart: 0 }), baseline, now)).toEqual([]);
    expect(liveDetections(windowsUntil(now.toISOString(), 3, { addToCart: 0 }), baseline, now)).toEqual([]);
    expect(liveDetections(windowsUntil(now.toISOString(), 4, { addToCart: 0 }), { ...baseline, days: 3 }, now)).toEqual([]);
    expect(liveDetections(windowsUntil(now.toISOString(), 4, { addToCart: 0 }), undefined, now)).toEqual([]);
    // wenig Verkehr: 4 × 30 Seitenaufrufe, Erwartung 6 Warenkörbe → Zufall, kein Fund
    expect(liveDetections(windowsUntil(now.toISOString(), 4, { pageViews: 30, addToCart: 0 }), { ...baseline, pageViewsByHour: baseline.pageViewsByHour.map(() => 60) }, now)).toEqual([]);
  });
});

describe("Verknüpfung mit der Bestell-Lücke", () => {
  const now = new Date("2026-10-19T13:30:00Z"); // 15:30 Berlin
  const gap: ShopPulseDetection = { key: "revenue:order-gap", source: "revenue", code: "orderGap", severity: "warning", params: { expected: 4 } };
  const state = (w: Partial<LiveWindow>, b: LiveBaseline = baseline): Ga4State => ({ baseline: b, live: windowsUntil(now.toISOString(), 18, w) });

  it("Trichter bis zur Kasse normal, keine Käufe → Zahlung/Abschluss gestört (kritisch)", () => {
    const out = linkOrderGapWithGa4([gap], state({ beginCheckout: 2, purchases: 0 }), now);
    expect(out[0]).toMatchObject({ key: "revenue:order-gap", code: "orderGapCheckout", severity: "critical", params: { expected: 4, pct: 100 } });
    expect(out[0].evidence?.ga4).toMatchObject({ pageViews: 1800, expectedPageViews: 1800, beginCheckout: 36, purchases: 0, windows: 18 });
  });

  it("deutlich weniger Seitenaufrufe → Besucherproblem (Warnung)", () => {
    expect(linkOrderGapWithGa4([gap], state({ pageViews: 40, beginCheckout: 1 }), now)[0]).toMatchObject({ code: "orderGapVisitors", severity: "warning", params: { pct: 40 } });
  });

  it("bleibt, wie sie ist: Käufe in GA4, kaum Kasse, alter Stand, andere Erwartung, keine Lücke", () => {
    expect(linkOrderGapWithGa4([gap], state({ beginCheckout: 2, purchases: 1 }), now)).toEqual([gap]);
    expect(linkOrderGapWithGa4([gap], state({ beginCheckout: 0 }), now)).toEqual([gap]);
    expect(linkOrderGapWithGa4([gap], { baseline, live: windowsUntil("2026-10-19T12:30:00Z", 18, { beginCheckout: 2 }) }, now)).toEqual([gap]);
    expect(linkOrderGapWithGa4([gap], state({ beginCheckout: 2 }, { ...baseline, day: "2026-10-18" }), now)).toEqual([gap]);
    expect(linkOrderGapWithGa4([gap], null, now)).toEqual([gap]);
    const other: ShopPulseDetection = { ...gap, key: "revenue:week:orders", code: "weekOrdersDown" };
    expect(linkOrderGapWithGa4([other], state({ beginCheckout: 2 }), now)).toEqual([other]);
  });
});

const yesterday = "2026-10-18";
const baseDates = sameWeekdays(yesterday, 8).map(gaDate);

describe("Trichter gestern je Gerät", () => {
  const day = (date: string, device: string, v: [number, number, number, number]): Array<[string[], number[]]> =>
    (["view_item", "add_to_cart", "begin_checkout", "purchase"] as const).map((e, i) => [[date, device, e], [v[i]]]);
  const base = baseDates.flatMap((d) => [...day(d, "mobile", [200, 20, 10, 3]), ...day(d, "desktop", [200, 20, 10, 3])]);

  it("Warenkorb-Quote mobil eingebrochen → Warnung; kleine Zahlen weiter hinten im Trichter zählen nicht", () => {
    const found = funnelDetections(rows([...base, ...day("20261018", "mobile", [200, 4, 2, 1]), ...day("20261018", "desktop", [200, 21, 9, 3])]), yesterday);
    expect(found).toEqual([
      expect.objectContaining({ key: "ga4:funnel:mobile:cart", code: "ga4FunnelCart", severity: "warning", params: { device: "mobile", date: yesterday, current: 2, expected: 10, pct: 80 } }),
    ]);
  });

  it("weniger Besucher bei gleichen Quoten ist kein Fund; ohne Vergleichstage auch nicht", () => {
    expect(funnelDetections(rows([...base, ...day("20261018", "mobile", [50, 5, 2, 1])]), yesterday)).toEqual([]);
    expect(funnelDetections(rows(day("20261018", "mobile", [200, 0, 0, 0])), yesterday)).toEqual([]);
  });
});

describe("Besucherquellen", () => {
  const base = baseDates.flatMap((d): Array<[string[], number[]]> => [
    [[d, "Organic Search"], [100]],
    [[d, "Paid Search"], [60]],
    [[d, "Direct"], [40]],
  ]);

  it("eine Quelle bricht ein (Sitzungen und Anteil) → Warnung", () => {
    const found = channelDetections(rows([...base, [["20261018", "Organic Search"], [100]], [["20261018", "Paid Search"], [10]], [["20261018", "Direct"], [40]]]), yesterday);
    expect(found).toEqual([
      expect.objectContaining({ key: "ga4:channel:paid-search", code: "ga4ChannelDrop", params: { channel: "Paid Search", date: yesterday, pct: 83, share: 6.7, expectedShare: 30 } }),
    ]);
  });

  it("alle Quellen gleich weniger (z. B. Einwilligungsquote) → kein Fund", () => {
    expect(channelDetections(rows([...base, [["20261018", "Organic Search"], [40]], [["20261018", "Paid Search"], [24]], [["20261018", "Direct"], [16]]]), yesterday)).toEqual([]);
  });
});

describe("Einstiegsseiten und Seite nicht gefunden", () => {
  const totals = (cur: [number, number]) => rows([...baseDates.map((d): [string[], number[]] => [[d], [1000, 3000]]), [["20261018"], cur]]);
  const landing = (cur: number) =>
    rows([
      ...baseDates.flatMap((d): Array<[string[], number[]]> => [
        [[d, "/"], [300]],
        [[d, "/fachbodenregale/"], [100]],
      ]),
      [["20261018", "/"], [300]],
      [["20261018", "/fachbodenregale/"], [cur]],
    ]);
  const notFound = (cur: number) => rows([...baseDates.map((d): [string[], number[]] => [[d], [15]]), [["20261018"], [cur]]]);

  it("Einstiegsseite eingebrochen und Fehlerseite viermal so häufig → zwei Warnungen", () => {
    const found = landingDetections({ landing: landing(10), totals: totals([1000, 3000]), notFound: notFound(60), notFoundPaths: rows([[["/alte-seite/"], [40]]]) }, yesterday);
    expect(found).toEqual([
      expect.objectContaining({ code: "ga4LandingDrop", params: expect.objectContaining({ page: "/fachbodenregale/", pct: 90, share: 1, expectedShare: 10 }) }),
      expect.objectContaining({ key: "ga4:landing:not-found", code: "ga4NotFoundUp", params: { date: yesterday, current: 60, expected: 15, share: 2, expectedShare: 0.5 } }),
    ]);
    expect(found[0].key).toMatch(/^ga4:landing:fachbodenregale-[0-9a-f]{8}$/);
    expect(found[1].evidence).toMatchObject({ paths: [{ path: "/alte-seite/", views: 40 }] });
  });

  it("übliche Werte → kein Fund", () => {
    expect(landingDetections({ landing: landing(90), totals: totals([1000, 3000]), notFound: notFound(20), notFoundPaths: [] }, yesterday)).toEqual([]);
  });
});

describe("Suchbegriffe ohne Treffer", () => {
  const searchHtml = (n: number) => `<html>${'<div class="card product-box box-standard"></div>'.repeat(n)}</html>`;

  it("Begriffe zusammenfassen, ohne E-Mail-Adressen; im Shop nacheinander suchen; Weiterleitung auf Produkt = Treffer", async () => {
    const terms = normalizeSearchTerms(rows([[["Fachbodenregal"], [10]], [["fachbodenregal "], [2]], [["xyzregal"], [5]], [["a@b.de"], [3]], [["(not set)"], [9]], [["SW10001"], [1]]]));
    expect(terms).toEqual([
      { term: "Fachbodenregal", count: 12 },
      { term: "xyzregal", count: 5 },
      { term: "SW10001", count: 1 },
    ]);
    const calls: string[] = [];
    const fetchImpl = async (url: string) => {
      const u = new URL(url);
      calls.push(`${u.pathname}${u.search}`);
      const q = u.searchParams.get("search");
      if (q === "SW10001") return new Response(null, { status: 302, headers: { location: "/detail/abc" } });
      if (u.pathname === "/detail/abc") return new Response("<html>Produkt</html>", { status: 200 });
      return new Response(searchHtml(q === "xyzregal" ? 0 : 3), { status: 200 });
    };
    const checks = await checkSearchTerms({ storefront: "https://shop.test", fetchImpl, pauseMs: 0 }, terms);
    expect(checks.map((c) => [c.term, c.hits])).toEqual([
      ["Fachbodenregal", 3],
      ["xyzregal", 0],
      ["SW10001", 1],
    ]);
    expect(calls).toEqual(["/search?search=Fachbodenregal", "/search?search=xyzregal", "/search?search=SW10001", "/detail/abc"]);
    expect(searchNoHitsDetections(checks, yesterday)).toEqual([
      expect.objectContaining({ key: "ga4:search:no-hits", code: "ga4SearchNoHits", severity: "warning", params: { date: yesterday, count: 1, searches: 5, terms: "„xyzregal“ (5×)" } }),
    ]);
  });

  it("Shop antwortet gar nicht → Lauf gescheitert; alle mit Treffern → kein Fund", async () => {
    const terms = [{ term: "a", count: 3 }, { term: "b", count: 2 }, { term: "c", count: 1 }];
    await expect(checkSearchTerms({ storefront: "https://shop.test", fetchImpl: async () => new Response("", { status: 503 }), pauseMs: 0 }, terms)).rejects.toThrow("Storefront nicht erreichbar");
    expect(searchNoHitsDetections([{ term: "a", count: 3, hits: 4 }, { term: "b", count: 1, hits: null }], yesterday)).toEqual([]);
  });
});

describe("Messung intakt", () => {
  const orders = [
    ...Array.from({ length: 20 }, (_, i) => order(addDays(yesterday, -(i % 7)))),
    ...Array.from({ length: 80 }, (_, i) => order(addDays(yesterday, -7 - (i % 28)))),
  ];
  const purchases = (current: number) =>
    rows([
      ...Array.from({ length: 28 }, (_, i): [string[], number[]] => [[gaDate(addDays(yesterday, -7 - i))], [i < 12 ? 2 : 1]]), // 40 Käufe
      [[gaDate(yesterday)], [current]],
    ]);

  it("GA4 sieht kaum noch Käufe je MO-Bestellung → Warnung", () => {
    expect(measurementDetections(purchases(1), orders, yesterday)).toEqual([
      expect.objectContaining({ key: "ga4:measurement:purchases", code: "ga4MeasurementDrop", params: { from: "2026-10-12", to: yesterday, current: 5, expected: 50, orders: 20 } }),
    ]);
  });

  it("übliches Verhältnis oder zu wenig Bestellungen → kein Fund", () => {
    expect(measurementDetections(purchases(9), orders, yesterday)).toEqual([]);
    expect(measurementDetections(purchases(0), orders.slice(11), yesterday)).toEqual([]);
  });
});

describe("Läufe über den Zeitplan", () => {
  function setup(o: { ga4?: Ga4DataClient | null; now: string; state?: Ga4State; orders?: PulseOrder[] }) {
    const settings = new Map<string, any>();
    const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
    const rowsDb: ShopPulseSignal[] = [];
    const tenantId = "t-ga4";
    const deps: ShopPulseDeps = {
      storage: {
        getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
        saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
        getUsersWithPermissionInTenant: async () => [],
        createNotification: async (n: any) => n,
        getShopwareSyncState: async () => undefined,
      } as any,
      repo: {
        listSignalsBySources: async (_t: string | null, sources: string[]) => structuredClone(rowsDb.filter((r) => sources.includes(r.source))),
        listOpenSignals: async () => structuredClone(rowsDb.filter((r) => r.status === "open")),
        applyReconcile: async (_t: string | null, result: ReconcileResult) => {
          rowsDb.push(...structuredClone(result.inserts));
          for (const u of result.updates) Object.assign(rowsDb.find((r) => r.id === u.id)!, structuredClone(u.patch));
        },
      },
      detectors: [orderGapDetector, ...GA4_DETECTORS],
      loadOrders: async () => o.orders ?? [],
      loadGa4: o.ga4 ? () => ({ property: async () => ga4Property(o.ga4!, "123456789") }) : undefined,
      onNotificationCreated: () => undefined,
      baseUrl: null,
      now: () => new Date(o.now),
      newId: (() => {
        let i = 0;
        return () => `id${++i}`;
      })(),
    };
    settings.set(k(SHOP_PULSE_SETTINGS_KEY, tenantId), { enabled: true, learningUntil: "2026-10-01T00:00:00Z", teamsWebhookUrl: "" });
    if (o.state) settings.set(k(GA4_STATE_KEY, tenantId), o.state);
    return { deps, rows: rowsDb, run: () => runShopPulseForTenant(deps, tenantId), ga4State: () => settings.get(k(GA4_STATE_KEY, tenantId)) as Ga4State };
  }

  it("GA4 nicht eingerichtet: alle GA4-Prüfungen setzen aus, mit Grund", async () => {
    const t = setup({ ga4: null, now: "2026-10-19T08:00:00Z" });
    const r = await t.run();
    for (const d of GA4_DETECTORS) expect(r?.detectors[d.id]).toMatchObject({ ok: true, skipped: "ga4", ga4Problem: "disabled", findings: 0 });
    expect(t.rows).toEqual([]);
  });

  it("Live-Lauf: Erwartung einmal am Tag, Fenster gesammelt, nach 2 Stunden ohne Warenkorb kritisch", async () => {
    const report = vi.fn((req: any): Array<[string[], number[]]> => {
      if (req.dimensions.map((d: any) => d.name).join() !== "date,hour,eventName") return [];
      return sameWeekdays("2026-10-19", 8).flatMap((d) =>
        Array.from({ length: 24 }, (_, h): Array<[string[], number[]]> => [
          [[gaDate(d), String(h).padStart(2, "0"), "page_view"], [200]],
          [[gaDate(d), String(h).padStart(2, "0"), "add_to_cart"], [10]],
        ]).flat(),
      );
    });
    const client = fakeClient({ report, realtime: () => [[["page_view"], [100]]] });
    const t = setup({ ga4: client, now: "2026-10-19T08:00:00Z" });
    const at = (iso: string) => {
      t.deps.now = () => new Date(iso);
      return t.run();
    };
    await at("2026-10-19T08:00:00Z");
    await at("2026-10-19T08:30:00Z");
    await at("2026-10-19T09:00:00Z");
    expect(t.rows).toEqual([]);
    const r = await at("2026-10-19T09:30:00Z");
    expect(client.runRealtimeReport).toHaveBeenCalledTimes(4);
    // Erwartung (date × hour × eventName) nur beim ersten Lauf des Tages; Tagesprüfungen liefen einmal
    expect(report.mock.calls.filter(([req]) => req.dimensions.map((d: any) => d.name).join() === "date,hour,eventName")).toHaveLength(1);
    expect(r?.detectors.ga4Funnel?.at).toBe("2026-10-19T08:00:00.000Z");
    expect(t.ga4State().live).toHaveLength(4);
    expect(t.rows).toEqual([expect.objectContaining({ key: "ga4:live:add-to-cart", code: "ga4LiveNoAddToCart", severity: "critical", status: "open" })]);
    expect(r?.notices.map((n) => [n.kind, n.signal.code])).toEqual([["new", "ga4LiveNoAddToCart"]]);
  });

  it("Bestell-Lücke um 15:30 mit normalem Trichter bis zur Kasse ohne Käufe → Zahlung/Abschluss gestört, sofort gemeldet", async () => {
    const now = "2026-10-19T13:30:00Z";
    const orders = sameWeekdays("2026-10-19", 8).flatMap((d) => [order(d, 9), order(d, 10), order(d, 11), order(d, 12)]);
    const client = fakeClient({ realtime: () => [[["page_view"], [100]], [["add_to_cart"], [5]], [["begin_checkout"], [2]]] });
    const t = setup({
      ga4: client,
      now,
      orders,
      state: { baseline: { ...baseline, checkoutPerView: 0.02 }, live: windowsUntil("2026-10-19T13:00:00Z", 17, { beginCheckout: 2 }) },
    });
    const r = await t.run();
    expect(t.rows.find((s) => s.key === "revenue:order-gap")).toMatchObject({ code: "orderGapCheckout", severity: "critical" });
    expect(r?.notices.map((n) => n.signal.code)).toContain("orderGapCheckout");
  });
});
