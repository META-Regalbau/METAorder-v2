/**
 * Versandangaben einer Bestellung (Order.shippingInfo) aus den Shopware-Lieferungen: Ableitung,
 * Bestell-Abruf (fetchOrders) inkl. Status-Historie und Delta-Filter, Bestell-Fingerprint -
 * gegen ein simuliertes Shopware.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { deliveryShippingFacts, deriveShippingInfo, type DeliveryShippingFacts } from "../../server/shopware/client/mapping";
import { ShopwareClient } from "../../server/shopware/shopware";

const facts = (id: string, state: string | undefined, trackingCodes: string[] = [], createdAt = "2026-09-01T08:00:00.000+00:00"): DeliveryShippingFacts =>
  ({ id, state, trackingCodes, createdAt });

describe("deriveShippingInfo", () => {
  const shippedAt = new Map([
    ["d1", "2026-09-03T10:00:00.000+00:00"],
    ["d2", "2026-09-05T12:30:00.000+00:00"],
  ]);

  it("Sendungsnummern aller Lieferungen, aelteste Lieferung zuerst, ohne Doppelte", () => {
    const info = deriveShippingInfo(
      [facts("d2", "shipped", ["B", "A"], "2026-09-02T00:00:00.000+00:00"), facts("d1", "shipped", ["A"], "2026-09-01T00:00:00.000+00:00")],
      {},
    );
    expect(info).toEqual({ trackingNumber: "A, B" });
  });

  it("Zusatzfelder meta_shipped_*: Dienstleister immer, Sendungsnummer nur ohne Tracking-Code, Datum vor der Historie", () => {
    const cf = { meta_shipped_carrier: "DHL", meta_shipped_tracking: "META-1", meta_shipped_date: "2026-09-04" };
    expect(deriveShippingInfo([facts("d1", "shipped", ["SW-1"])], cf, shippedAt)).toEqual({ carrier: "DHL", trackingNumber: "SW-1", shippedDate: "2026-09-04" });
    expect(deriveShippingInfo([facts("d1", "open")], cf)).toEqual({ carrier: "DHL", trackingNumber: "META-1", shippedDate: "2026-09-04" });
  });

  it("Versanddatum: letzter Uebergang nach versendet - auch zurueckgesendet, nicht wieder geoeffnet oder storniert", () => {
    expect(deriveShippingInfo([facts("d1", "shipped"), facts("d2", "shipped_partially")], {}, shippedAt)).toEqual({ shippedDate: "2026-09-05T12:30:00.000+00:00" });
    expect(deriveShippingInfo([facts("d2", "returned")], {}, shippedAt)).toEqual({ shippedDate: "2026-09-05T12:30:00.000+00:00" });
    expect(deriveShippingInfo([facts("d2", "returned_partially")], {}, shippedAt)).toEqual({ shippedDate: "2026-09-05T12:30:00.000+00:00" });
    expect(deriveShippingInfo([facts("d1", "open"), facts("d2", "cancelled")], {}, shippedAt)).toBeUndefined();
    expect(deriveShippingInfo([facts("d1", "shipped")], {})).toBeUndefined();
  });

  it("Lieferung im JSON:API-Format (Status ueber included)", () => {
    const included = new Map([["state_machine_state-s1", { attributes: { technicalName: "shipped" } }]]);
    const f = deliveryShippingFacts(
      { id: "d9", attributes: { createdAt: "2026-09-01T00:00:00Z", trackingCodes: [" X1 ", "", null] }, relationships: { stateMachineState: { data: { id: "s1" } } } },
      included,
    );
    expect(f).toEqual({ id: "d9", createdAt: "2026-09-01T00:00:00Z", trackingCodes: ["X1"], state: "shipped" });
  });
});

// --- simuliertes Shopware -------------------------------------------------------------------
const shop = vi.hoisted(() => ({
  orders: [] as any[],
  history: [] as Array<{ referencedId: string; createdAt: string }>,
  failHistory: false,
  deliveryUpdatedAt: "2026-09-10T09:00:00.000+00:00",
  requests: [] as Array<{ path: string; body: any }>,
}));

function swOrder(id: string, deliveries: any[], customFields: Record<string, unknown> = {}) {
  return {
    id, orderNumber: `SW-${id}`, orderDate: "2026-09-01T00:00:00.000+00:00", createdAt: "2026-09-01T08:00:00.000+00:00", updatedAt: null,
    amountTotal: 119, amountNet: 100, salesChannelId: "sc1", customFields,
    orderCustomer: { firstName: "Max", lastName: "Muster", email: "m@example.com" },
    stateMachineState: { technicalName: "completed" }, transactions: [], lineItems: [], deliveries,
  };
}
const swDelivery = (id: string, state: string, trackingCodes: string[] = []) =>
  ({ id, createdAt: "2026-09-01T08:00:00.000+00:00", trackingCodes, stateMachineState: { technicalName: state } });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    shop.requests.push({ path, body });
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    if (path === "/api/search/order") return json({ data: shop.orders, total: shop.orders.length });
    if (path === "/api/search/state-machine-history") {
      if (shop.failHistory) return json({ errors: [{ detail: "kaputt" }] }, 500);
      const ids: string[] = body.filter.find((f: any) => f.field === "referencedId")?.value ?? [];
      const hits = shop.history.filter((h) => ids.includes(h.referencedId));
      return json({ data: hits.slice((body.page - 1) * body.limit, body.page * body.limit) });
    }
    if (path === "/api/search/order-delivery") return json({ data: [{ id: "d-neu", updatedAt: shop.deliveryUpdatedAt }], meta: { total: 3 } });
    return json({ data: [], total: 0 });
  });
});
afterAll(() => vi.unstubAllGlobals());
beforeEach(() => {
  shop.requests = [];
  shop.failHistory = false;
  shop.deliveryUpdatedAt = "2026-09-10T09:00:00.000+00:00";
  shop.history = [
    { referencedId: "d-versendet", createdAt: "2026-09-02T09:00:00.000+00:00" },
    { referencedId: "d-versendet", createdAt: "2026-09-04T15:00:00.000+00:00" },
    { referencedId: "d-offen", createdAt: "2026-09-03T09:00:00.000+00:00" },
  ];
  shop.orders = [
    swOrder("versendet", [swDelivery("d-versendet", "shipped", ["00340434"])]),
    swOrder("wieder-offen", [swDelivery("d-offen", "open")]),
    swOrder("datum-in-metaorder", [swDelivery("d-meta", "shipped")], { meta_shipped_date: "2026-09-06", meta_shipped_carrier: "DPD" }),
    swOrder("ohne", [swDelivery("d-ohne", "open")]),
  ];
});
const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
const byId = (orders: any[]) => Object.fromEntries(orders.map((o) => [o.id, o.shippingInfo]));

describe("fetchOrders: Versandangaben", () => {
  it("fordert Lieferungs-ID, Anlagezeit, Tracking-Codes und Lieferstatus an", async () => {
    await client().fetchOrders(null);
    const req = shop.requests.find((r) => r.path === "/api/search/order")!.body;
    expect(req.includes.order_delivery).toEqual(expect.arrayContaining(["id", "createdAt", "trackingCodes", "stateMachineState"]));
    expect(req.associations.deliveries.associations.stateMachineState).toEqual({});
  });

  it("Sendungsnummer aus der Lieferung, Versanddatum aus der Status-Historie (nur versendete Lieferungen ohne eigenes Datum)", async () => {
    const orders = await client().fetchOrders(null);
    expect(byId(orders)).toEqual({
      versendet: { trackingNumber: "00340434", shippedDate: "2026-09-04T15:00:00.000+00:00" },
      "wieder-offen": undefined,
      "datum-in-metaorder": { carrier: "DPD", shippedDate: "2026-09-06" },
      ohne: undefined,
    });
    const history = shop.requests.filter((r) => r.path === "/api/search/state-machine-history");
    expect(history).toHaveLength(1);
    expect(history[0].body.filter).toEqual([
      { type: "equals", field: "entityName", value: "order_delivery" },
      { type: "equals", field: "toStateMachineState.technicalName", value: "shipped" },
      { type: "equalsAny", field: "referencedId", value: ["d-versendet"] },
    ]);
  });

  it("ohne versendete Lieferung keine Historien-Abfrage", async () => {
    shop.orders = [shop.orders[3]];
    await client().fetchOrders(null);
    expect(shop.requests.some((r) => r.path === "/api/search/state-machine-history")).toBe(false);
  });

  it("Historie nicht erreichbar: Bestellungen kommen trotzdem, nur ohne Versanddatum", async () => {
    shop.failHistory = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const orders = await client().fetchOrders(null);
    warn.mockRestore();
    expect(orders).toHaveLength(4);
    expect(byId(orders).versendet).toEqual({ trackingNumber: "00340434" });
  });

  it("Delta-Abruf beruecksichtigt geaenderte Lieferungen (Tracking-Codes aendern die Bestellung nicht)", async () => {
    await client().fetchOrders(null, { updatedSince: new Date("2026-09-08T00:00:00.000Z") });
    const filter = shop.requests.find((r) => r.path === "/api/search/order")!.body.filter;
    expect(filter).toContainEqual({
      type: "multi",
      operator: "OR",
      queries: [
        { type: "range", field: "updatedAt", parameters: { gte: "2026-09-08T00:00:00.000Z" } },
        { type: "range", field: "createdAt", parameters: { gte: "2026-09-08T00:00:00.000Z" } },
        { type: "range", field: "deliveries.updatedAt", parameters: { gte: "2026-09-08T00:00:00.000Z" } },
      ],
    });
  });
});

describe("fetchOrdersFingerprintDetails", () => {
  it("enthaelt die juengste Lieferungs-Aenderung (Endpunkt order-delivery)", async () => {
    const first = await client().fetchOrdersFingerprintDetails();
    expect(shop.requests.some((r) => r.path === "/api/search/order-delivery")).toBe(true);
    expect(first?.latestDeliveryUpdatedAt).toBe("2026-09-10T09:00:00.000+00:00");
    shop.deliveryUpdatedAt = "2026-09-11T07:00:00.000+00:00";
    const second = await client().fetchOrdersFingerprintDetails();
    expect(second?.fingerprint).not.toBe(first?.fingerprint);
    expect(second?.total).toBe(first?.total);
  });
});

describe("fetchDeliveryShippedDates", () => {
  it("stapelt die Lieferungs-IDs (200 je Abfrage), blaettert durch volle Seiten, juengster Uebergang zaehlt", async () => {
    const ids = Array.from({ length: 450 }, (_, i) => `d${i}`);
    // 3 Eintraege je Lieferung -> 600 je Stapel, also eine zweite Seite; der juengste steht in der Mitte
    shop.history = ids.flatMap((id) => [
      { referencedId: id, createdAt: "2026-09-01T10:00:00.000+00:00" },
      { referencedId: id, createdAt: "2026-09-03T10:00:00.000+00:00" },
      { referencedId: id, createdAt: "2026-09-02T10:00:00.000+00:00" },
    ]);
    const dates = await client().fetchDeliveryShippedDates(ids);
    expect(dates.size).toBe(450);
    expect(new Set(dates.values())).toEqual(new Set(["2026-09-03T10:00:00.000+00:00"]));
    const requests = shop.requests.filter((r) => r.path === "/api/search/state-machine-history").map((r) => r.body);
    expect(requests.map((b) => [b.filter[2].value.length, b.page])).toEqual([[200, 1], [200, 2], [200, 1], [200, 2], [50, 1]]);
  });
});
