/**
 * Sendungsnummern nach Shopware zurueckschreiben (updateOrderShipping): mehrere Nummern statt einer
 * zusammengesetzten, Ziel ist die neueste Lieferung, Nummern anderer Lieferungen nicht doppelt,
 * Sendcloud ergaenzt je Paket statt zu ersetzen - gegen ein simuliertes Shopware.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseTrackingCodes, trackingLinkFor } from "../../shared/tracking";
import { ShopwareClient } from "../../server/shopware/shopware";

const shop = vi.hoisted(() => ({
  deliveries: [] as any[],
  requests: [] as Array<{ method: string; path: string; body: any }>,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    shop.requests.push({ method, path, body });
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    if (method === "GET" && path === "/api/order/o1") return json({ data: { id: "o1", deliveries: shop.deliveries } });
    return json({});
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  shop.requests = [];
  shop.deliveries = [{ id: "d1", createdAt: "2026-09-01T08:00:00.000+00:00", trackingCodes: [] }];
});

const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
const deliveryPatches = () => shop.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/api/order-delivery/"));
const orderPatch = () => shop.requests.find((r) => r.method === "PATCH" && r.path === "/api/order/o1")?.body;
const shipped = () => shop.requests.filter((r) => r.path.endsWith("/state/ship")).map((r) => r.path);

describe("Sendungsnummern zurueckschreiben", () => {
  it("\"A, B\" sind zwei Nummern (frueher eine: \"A, B\")", async () => {
    await client().updateOrderShipping("o1", { carrier: "DPD", trackingNumber: "A, B" });
    expect(deliveryPatches()).toEqual([{ method: "PATCH", path: "/api/order-delivery/d1", body: { trackingCodes: ["A", "B"] } }]);
    expect(orderPatch()).toEqual({ customFields: { meta_shipped_carrier: "DPD", meta_shipped_tracking: "A, B" } });
  });

  it("Semikolon und Zeilenumbruch trennen, Leerzeichen gehoeren zur Nummer, Doppelte fallen weg", async () => {
    await client().updateOrderShipping("o1", { trackingNumber: "JJD 0001 2345;\nB ,B\n" });
    expect(deliveryPatches()[0].body).toEqual({ trackingCodes: ["JJD 0001 2345", "B"] });
  });

  it("neueste Lieferung statt der ersten in der Antwort; Nummern anderer Lieferungen nicht doppelt", async () => {
    shop.deliveries = [
      { id: "d-alt", createdAt: "2026-09-01T08:00:00.000+00:00", trackingCodes: ["X"] },
      { id: "d-neu", createdAt: "2026-09-05T08:00:00.000+00:00", trackingCodes: [] },
    ];
    await client().updateOrderShipping("o1", { trackingNumber: "X, Y" });
    expect(deliveryPatches()).toEqual([{ method: "PATCH", path: "/api/order-delivery/d-neu", body: { trackingCodes: ["Y"] } }]);
    expect(shipped()).toEqual(["/api/_action/order_delivery/d-neu/state/ship"]);
    expect(orderPatch().customFields.meta_shipped_tracking).toBe("X, Y");
  });

  it("Ersetzen (Formular, Sammel-Eingabe): die Eingabe ist die ganze Liste", async () => {
    shop.deliveries[0].trackingCodes = ["ALT"];
    await client().updateOrderShipping("o1", { trackingNumber: "NEU" });
    expect(deliveryPatches()[0].body).toEqual({ trackingCodes: ["NEU"] });
  });

  it("Ergaenzen (Sendcloud je Paket): vorhandene Nummern bleiben, keine Doppelten", async () => {
    shop.deliveries[0].trackingCodes = ["P1"];
    await client().updateOrderShipping("o1", { trackingNumber: "P2" }, { trackingMode: "add" });
    expect(deliveryPatches()[0].body).toEqual({ trackingCodes: ["P1", "P2"] });
    expect(orderPatch().customFields.meta_shipped_tracking).toBe("P1, P2");
    shop.requests = [];
    shop.deliveries[0].trackingCodes = ["P1", "P2"];
    await client().updateOrderShipping("o1", { trackingNumber: "P2" }, { trackingMode: "add" });
    expect(deliveryPatches()[0].body).toEqual({ trackingCodes: ["P1", "P2"] });
  });

  it("ohne Sendungsnummer keine Aenderung der Tracking-Codes", async () => {
    await client().updateOrderShipping("o1", { carrier: "DPD", trackingNumber: " , " });
    expect(deliveryPatches()).toEqual([]);
    expect(orderPatch()).toEqual({ customFields: { meta_shipped_carrier: "DPD" } });
  });
});

describe("Hilfen", () => {
  it("parseTrackingCodes", () => {
    expect(parseTrackingCodes("A, B; C\r\nD")).toEqual(["A", "B", "C", "D"]);
    expect(parseTrackingCodes(undefined)).toEqual([]);
  });

  it("trackingLinkFor: Platzhalter %s, Nummer kodiert, nur http(s)", () => {
    expect(trackingLinkFor("https://my.dpd.de/myParcel.aspx?parcelno=%s", "0159 1/2")).toBe("https://my.dpd.de/myParcel.aspx?parcelno=0159%201%2F2");
    expect(trackingLinkFor("https://tracking.example/", "1")).toBeNull();
    expect(trackingLinkFor("javascript:alert(%s)", "1")).toBeNull();
    expect(trackingLinkFor(null, "1")).toBeNull();
  });
});
