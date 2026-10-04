/**
 * Mahnvorschau: Rechnungsnummer und -datum fehlender Bestellungen kommen gebatcht aus Shopware
 * (200 Bestellungen je Abfrage) statt je Bestellung - in Testing 615 Abfragen und ~39 s fuer 207
 * Bestellungen. Ergebnis wie bisher: echte Rechnung, sonst fruehestes Dokument, sonst Bestelldatum.
 * Echter getDunningCandidates und Shopware-Client; Spiegel und Shopware simuliert.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Order } from "../../shared/schema";
import { storage } from "../../server/storage";
import { ShopwareClient, type OrderDocument } from "../../server/shopware/shopware";
import { enrichOrderDueDate, enrichOrdersDueDates, getDunningCandidates } from "../../server/invoicing/dunningJob";

const day = 86400000;
const daysAgo = (n: number) => new Date(Date.now() - n * day).toISOString();

function order(id: string, overrides: Partial<Order> = {}): Order {
  return {
    id, orderNumber: `SW-${id}`, customerName: `Kunde ${id}`, customerEmail: "kunde@example.com", orderDate: daysAgo(60),
    customFields: { custom_order_numbers_invoice: `ERP-${id}` }, totalAmount: 100, netTotalAmount: 84,
    status: "in_progress", paymentStatus: "open", salesChannelId: "sc1", items: [], ...overrides,
  } as Order;
}

type Doc = { id: string; orderId: string; documentTypeId: string; documentNumber: string; createdAt?: string; sent: boolean };
const shop = vi.hoisted(() => ({
  mirror: [] as Order[],
  docs: [] as Doc[],
  failDocuments: false,
  requests: [] as Array<{ path: string; body: any }>,
}));

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeAll(() => {
  vi.spyOn(storage, "countShopwareOrderMirrors").mockImplementation(async () => shop.mirror.length);
  vi.spyOn(storage, "getShopwareOrderMirrors").mockImplementation(async () => ({
    rows: shop.mirror.map((o) => ({ shopwareId: o.id, payload: structuredClone(o) })) as any,
    total: shop.mirror.length,
  }));
  vi.spyOn(storage, "getOrderDunningStatuses").mockResolvedValue([]);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.stubGlobal("fetch", async (url: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname;
    const body = init.body ? JSON.parse(String(init.body)) : null;
    shop.requests.push({ path, body });
    if (path === "/api/oauth/token") return json({ access_token: "tok", expires_in: 600, token_type: "Bearer" });
    if (path === "/api/search/document-type") return json({ data: [{ id: "t-inv", technicalName: "invoice" }, { id: "t-ls", technicalName: "delivery_note" }] });
    if (path === "/api/search/document") {
      if (shop.failDocuments) return json({ errors: [{ detail: "kaputt" }] }, 500);
      const ids: string[] = body.filter[0].value;
      const hits = shop.docs.filter((d) => ids.includes(d.orderId));
      return json({ data: hits.slice((body.page - 1) * body.limit, body.page * body.limit) });
    }
    return json({ data: [] });
  });
});
afterAll(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

beforeEach(() => {
  shop.requests = [];
  shop.failDocuments = false;
  // 450 Bestellungen ohne Rechnungsdatum (3 Stapel) und eine vollstaendige
  shop.mirror = [
    ...Array.from({ length: 450 }, (_, i) => order(`o${String(i).padStart(3, "0")}`)),
    order("fertig", { invoiceNumber: "RE-fertig", invoiceDate: daysAgo(30), customFields: {} }),
  ];
  shop.docs = [
    // echte Rechnung neben Proforma: Nummer und Datum der echten
    { id: "x1", orderId: "o000", documentTypeId: "t-inv", documentNumber: "PF-1", createdAt: daysAgo(50), sent: true },
    { id: "x2", orderId: "o000", documentTypeId: "t-inv", documentNumber: "RE-1", createdAt: daysAgo(40), sent: true },
    // nur ein Lieferschein: fruehestes Dokument
    { id: "x3", orderId: "o001", documentTypeId: "t-ls", documentNumber: "LS-1", createdAt: daysAgo(20), sent: false },
    // unbekannte Typ-ID: Typ aus dem Nummern-Praefix
    { id: "x4", orderId: "o004", documentTypeId: "t-unbekannt", documentNumber: "RE-77", createdAt: daysAgo(10), sent: false },
    // viele Dokumente: zweite Seite (500 je Seite)
    ...Array.from({ length: 600 }, (_, i) => ({ id: `ls${i}`, orderId: "o003", documentTypeId: "t-ls", documentNumber: `LS-3-${i}`, createdAt: daysAgo(15 + (i % 3)), sent: false })),
    // letzte Bestellung im dritten Stapel
    { id: "x5", orderId: "o449", documentTypeId: "t-inv", documentNumber: "RE-449", createdAt: daysAgo(12), sent: true },
  ];
});

const client = () => new ShopwareClient({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
const dunning = { enabled: true, manualOnly: true, dueDateFieldKey: "invoiceDate", stageDays: [7, 14, 21] } as any;
const daysOf = (iso: string) => Math.round((Date.now() - new Date(iso).getTime()) / day);

describe("Mahnvorschau: Faelligkeit gebatcht", () => {
  it("450 Bestellungen: 3 Stapel + 1 Folgeseite statt einer Abfrage je Bestellung", async () => {
    await getDunningCandidates(storage, client(), dunning, null, "tenant-a");
    const documentSearches = shop.requests.filter((r) => r.path === "/api/search/document");
    expect(documentSearches.map((r) => [r.body.filter[0].value.length, r.body.page])).toEqual([[200, 1], [200, 2], [200, 1], [50, 1]]);
    expect(documentSearches.every((r) => r.body.filter[0].type === "equalsAny")).toBe(true);
    expect(shop.requests.filter((r) => r.path === "/api/search/document-type")).toHaveLength(1);
    // die vollstaendige Bestellung wird nicht abgefragt
    expect(documentSearches.some((r) => r.body.filter[0].value.includes("fertig"))).toBe(false);
  });

  it("Rechnungsnummer und -datum wie bisher: echte Rechnung, sonst fruehestes Dokument, sonst Bestelldatum", async () => {
    const byId = new Map((await getDunningCandidates(storage, client(), dunning, null, "tenant-a")).map((c) => [c.order.id, c]));
    expect(byId.get("o000")!.order.invoiceNumber).toBe("RE-1");
    expect(daysOf(byId.get("o000")!.dueDate.toISOString())).toBe(40);
    expect(byId.get("o001")!.order.invoiceNumber).toBeUndefined();
    expect(daysOf(byId.get("o001")!.dueDate.toISOString())).toBe(20);
    expect(daysOf(byId.get("o002")!.dueDate.toISOString())).toBe(60);
    expect(daysOf(byId.get("o003")!.dueDate.toISOString())).toBe(17);
    expect(byId.get("o004")!.order.invoiceNumber).toBe("RE-77");
    expect(byId.get("o449")!.order.invoiceNumber).toBe("RE-449");
    expect(byId.get("o449")!.nextStage).toBe(0 + 1);
    expect(byId.size).toBe(451);
  });

  it("Shopware nicht erreichbar: Bestelldatum als Faelligkeit, Vorschau kommt trotzdem", async () => {
    shop.failDocuments = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const candidates = await getDunningCandidates(storage, client(), dunning, null, "tenant-a");
    warn.mockRestore();
    expect(candidates).toHaveLength(451);
    expect(daysOf(candidates.find((c) => c.order.id === "o000")!.dueDate.toISOString())).toBe(60);
  });

  it("gleiches Ergebnis wie die Einzelabfrage (enrichOrderDueDate) bei denselben Dokumenten", async () => {
    const docs: Record<string, OrderDocument[]> = {
      a: [{ id: "1", type: "invoice", number: "PF-9", deepLinkCode: "", createdAt: daysAgo(30) }, { id: "2", type: "invoice", number: "RE-9", deepLinkCode: "", createdAt: daysAgo(25) }],
      b: [{ id: "3", type: "delivery_note", number: "LS-1", deepLinkCode: "", createdAt: daysAgo(9) }, { id: "4", type: "credit_note", number: "GS-1", deepLinkCode: "", createdAt: daysAgo(11) }],
      c: [],
    };
    const fake = {
      fetchOrderDocuments: async (id: string) => docs[id],
      fetchDocumentsByOrderIds: async (ids: string[]) => new Map(ids.map((id) => [id, docs[id]])),
    } as unknown as ShopwareClient;
    const single = ["a", "b", "c"].map((id) => order(id));
    const batch = ["a", "b", "c"].map((id) => order(id));
    for (const o of single) await enrichOrderDueDate(fake, o, "invoiceDate");
    await enrichOrdersDueDates(fake, batch);
    expect(batch).toEqual(single);
    expect(batch.map((o) => [o.invoiceNumber, daysOf(o.invoiceDate!)])).toEqual([["RE-9", 25], [undefined, 11], [undefined, 60]]);
  });

  it("Bestellungen mit Rechnungsnummer und -datum werden nicht abgefragt", async () => {
    const asked: string[][] = [];
    const fake = { fetchDocumentsByOrderIds: async (ids: string[]) => (asked.push(ids), new Map()) } as unknown as ShopwareClient;
    const complete = order("voll", { invoiceNumber: "RE-1", invoiceDate: daysAgo(3) });
    await enrichOrdersDueDates(fake, [complete, order("leer")]);
    expect(asked).toEqual([["leer"]]);
    await enrichOrdersDueDates(fake, [complete]);
    expect(asked).toHaveLength(1);
  });
});
