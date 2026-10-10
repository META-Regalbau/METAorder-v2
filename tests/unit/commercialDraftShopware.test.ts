/**
 * Anlage aus Entwürfen in Shopware (executeCreateOrderFromDraft / executeCreateOfferFromDraft):
 * Vorprüfungen, DB- und Rabatt-Sperre vor dem Claim, Schutz gegen doppelte Anlage, Rücknahme bei
 * Shopware-Fehler, Positionen (Dubletten, Sets, manuelle Preise), Statuswechsel mit Wiederholung,
 * Folgeschritte (Cross-Selling, SFTP, eingefrorene DB, Rabatt-Freigabe).
 * Ausführung: npm test
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const sw = vi.hoisted(() => ({
  customerExists: true,
  createOrder: vi.fn(async (_attrs: unknown) => ({ id: "sw-order-1" })),
  createOffer: vi.fn(async (_input: unknown) => ({ id: "sw-offer-1" })),
  buildAttrs: vi.fn(async (_settings: unknown, input: unknown) => ({ built: input })),
  marginGate: { ok: true } as { ok: true } | { ok: false; error: string; statusCode: number; code: string },
  discount: { ok: true, approval: null } as any,
  refresh: vi.fn(async (_params: unknown) => null),
  recordConversions: vi.fn(async () => undefined),
  sftp: vi.fn(),
  recordDiscount: vi.fn(async () => undefined),
}));

vi.mock("../../server/shopware/shopware", () => ({
  ShopwareClient: class {
    async searchEntity() {
      return { data: sw.customerExists ? [{ id: "cust-1" }] : [] };
    }
    async findCustomersByEmail() {
      return [];
    }
    createOrder(attrs: unknown) {
      return sw.createOrder(attrs);
    }
  },
}));
vi.mock("../../server/b2b/b2bSellersClient", () => ({
  B2BSellersClient: class {
    createOffer(input: unknown) {
      return sw.createOffer(input);
    }
  },
}));
vi.mock("../../server/b2b/b2bOfferCreateContext", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../server/b2b/b2bOfferCreateContext")>();
  return { ...actual, resolveOfferLineItemProducts: async (_s: unknown, items: unknown[]) => ({ invalid: [], items }) };
});
vi.mock("../../server/shopware/shopwareOrderCreateContext", () => ({
  buildOrderCreateAttributes: (settings: unknown, input: unknown) => sw.buildAttrs(settings, input),
}));
vi.mock("../../server/products/productCache", () => ({
  productCache: { getProductByNumber: (n: string) => (n === "S2" ? { id: "s2" } : undefined) },
}));
vi.mock("../../server/sftp/sftpUpload", () => ({ scheduleSftpUploadAfterOrderCreate: sw.sftp }));
vi.mock("../../server/cross-selling/crossSellDraftSignals", () => ({
  recordDraftSuggestionConversions: sw.recordConversions,
}));
vi.mock("../../server/commercial/draftProfitability", () => ({ refreshDraftProfitability: sw.refresh }));
vi.mock("../../server/commercial/draftMarginApproval", () => ({ checkMarginGateForCreate: async () => sw.marginGate }));
vi.mock("../../server/commercial/offerDraftDiscountGate", () => ({
  checkOfferDraftDiscount: async () => sw.discount,
  recordOfferDiscountApproval: sw.recordDiscount,
}));

const { executeCreateOrderFromDraft, executeCreateOfferFromDraft } = await import(
  "../../server/commercial/commercialDraftShopware"
);

type Draft = Record<string, any>;

function orderDraft(overrides: Draft = {}): Draft {
  return {
    id: "d1",
    status: "review_required",
    shopwareCustomerId: "cust-1",
    attachments: [],
    extractedData: { customer: { email: "einkauf@example.com", company: "ACME" }, billingAddress: { city: "Berlin" } },
    matchingResults: {
      items: [
        { quantity: 2, matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: 99 } },
        { quantity: 3, matchedProduct: { id: "pA", productNumber: "A" } },
        { quantity: 1, matchedProduct: { id: "pB", productNumber: "B" } },
        {
          quantity: 2,
          bundle: { components: [{ productId: "s1", productNumber: "S1", quantity: 2 }, { productNumber: "S2", quantity: 1 }] },
        },
      ],
      overallConfidence: 100,
    },
    ...overrides,
  };
}

function fakeStorage(draft: Draft, opts: { claim?: boolean; updateFails?: number } = {}) {
  let updateFailures = opts.updateFails ?? 0;
  const updates: Array<Record<string, unknown>> = [];
  const update = vi.fn(async (_id: string, data: Record<string, unknown>) => {
    if (data.status === "created" && updateFailures > 0) {
      updateFailures -= 1;
      throw new Error("db down");
    }
    updates.push(data);
    Object.assign(draft, data);
    return { ...draft };
  });
  const claim = vi.fn(async () => (opts.claim === false ? undefined : { ...draft, status: "creating" }));
  return {
    updates,
    claim,
    update,
    storage: {
      getOrderDraft: async () => draft,
      getOfferDraft: async () => draft,
      getShopwareSettings: async () => ({ baseUrl: "https://shop.test" }),
      getSetting: async () => null,
      claimOrderDraftForCreation: claim,
      claimOfferDraftForCreation: claim,
      updateOrderDraft: update,
      updateOfferDraft: update,
    } as any,
  };
}

const options = { salesChannelId: "sc-1", tenantId: "t1" };

beforeEach(() => {
  sw.customerExists = true;
  sw.marginGate = { ok: true };
  sw.discount = { ok: true, approval: null };
  for (const fn of [sw.createOrder, sw.createOffer, sw.buildAttrs, sw.refresh, sw.recordConversions, sw.sftp, sw.recordDiscount]) {
    fn.mockClear();
  }
  sw.createOrder.mockImplementation(async () => ({ id: "sw-order-1" }));
});

describe("Bestellung: Vorprüfungen ohne Shopware-Aufruf", () => {
  it.each([
    ["pending", { status: "pending" }, 400],
    ["schon angelegt", { status: "created" }, 400],
    ["abgelehnt", { status: "rejected" }, 400],
    ["ohne Kunde", { shopwareCustomerId: null }, 400],
    ["Position ohne Artikel", { matchingResults: { items: [{ quantity: 1 }] } }, 400],
    ["Menge 0", { matchingResults: { items: [{ quantity: 0, matchedProduct: { id: "pA" } }] } }, 400],
    ["Set-Bestandteil unbekannt", { matchingResults: { items: [{ quantity: 1, bundle: { components: [{ productNumber: "X", quantity: 1 }] } }] } }, 400],
  ])("%s → %s", async (_label, overrides, status) => {
    const { storage, claim } = fakeStorage(orderDraft(overrides));
    const result = await executeCreateOrderFromDraft(storage, "d1", options);
    expect(result).toMatchObject({ ok: false, statusCode: status });
    expect(claim).not.toHaveBeenCalled();
    expect(sw.createOrder).not.toHaveBeenCalled();
  });

  it("ohne Verkaufskanal → 400", async () => {
    const { storage } = fakeStorage(orderDraft());
    expect(await executeCreateOrderFromDraft(storage, "d1", { salesChannelId: "" })).toMatchObject({ ok: false, statusCode: 400 });
  });

  it("Kunde existiert in Shopware nicht mehr → 400", async () => {
    sw.customerExists = false;
    const { storage } = fakeStorage(orderDraft());
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toMatchObject({ ok: false, statusCode: 400 });
    expect(sw.createOrder).not.toHaveBeenCalled();
  });
});

describe("Bestellung: Sperren und doppelte Anlage", () => {
  it("DB rot ohne Freigabe: 409 mit Code, kein Claim, kein Shopware-Aufruf", async () => {
    sw.marginGate = { ok: false, error: "DB zu niedrig", statusCode: 409, code: "margin_approval_required" };
    const { storage, claim } = fakeStorage(orderDraft());
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toEqual(sw.marginGate);
    expect(claim).not.toHaveBeenCalled();
    expect(sw.createOrder).not.toHaveBeenCalled();
  });

  it("schon geclaimt (Doppelklick, Webhook-Retry): 409, kein zweiter Shopware-Aufruf", async () => {
    const { storage } = fakeStorage(orderDraft(), { claim: false });
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toMatchObject({ ok: false, statusCode: 409 });
    expect(sw.createOrder).not.toHaveBeenCalled();
  });

  it("Shopware-Fehler: Claim zurück auf den alten Status, 502", async () => {
    sw.createOrder.mockRejectedValueOnce(new Error("Shopware 500"));
    const { storage, updates } = fakeStorage(orderDraft({ status: "approved" }));
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toMatchObject({
      ok: false,
      statusCode: 502,
      error: "Shopware 500",
    });
    expect(updates).toEqual([{ status: "approved" }]);
    expect(sw.refresh).not.toHaveBeenCalled();
  });
});

describe("Bestellung: erfolgreiche Anlage", () => {
  it("Positionen zusammengefasst, Sets aufgelöst, manueller Preis übergeben; Folgeschritte", async () => {
    const draft = orderDraft({ attachments: [{ id: "att1" }] });
    const { storage, updates } = fakeStorage(draft);
    const result = await executeCreateOrderFromDraft(storage, "d1", options);
    expect(result).toMatchObject({ ok: true, orderId: "sw-order-1" });

    const input = sw.buildAttrs.mock.calls[0]![1] as { lineItems: unknown[]; shopwareCustomerId: string; salesChannelId: string };
    expect(input.shopwareCustomerId).toBe("cust-1");
    expect(input.salesChannelId).toBe("sc-1");
    expect(input.lineItems).toEqual(
      expect.arrayContaining([
        { productId: "pA", quantity: 5, productNumber: "A", unitPriceNet: 99 },
        { productId: "pB", quantity: 1, productNumber: "B" },
        { productId: "s1", quantity: 4, productNumber: "S1" },
        { productId: "s2", quantity: 2, productNumber: "S2" },
      ]),
    );
    expect(input.lineItems).toHaveLength(4);

    expect(updates.at(-1)).toEqual({ status: "created", shopwareOrderId: "sw-order-1" });
    expect(sw.recordConversions).toHaveBeenCalledTimes(1);
    expect(sw.sftp).toHaveBeenCalledWith(storage, "d1", "t1");
    expect(sw.refresh).toHaveBeenCalledWith(expect.objectContaining({ kind: "order", draftId: "d1", frozen: true }));
  });

  it("ohne Beilagen kein SFTP", async () => {
    const { storage } = fakeStorage(orderDraft());
    await executeCreateOrderFromDraft(storage, "d1", options);
    expect(sw.sftp).not.toHaveBeenCalled();
  });

  it("Statuswechsel scheitert erst zweimal: dritter Versuch klappt", async () => {
    const { storage, update } = fakeStorage(orderDraft(), { updateFails: 2 });
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toMatchObject({ ok: true });
    expect(update.mock.calls.filter(([, data]) => data.status === "created")).toHaveLength(3);
  });

  it("Statuswechsel scheitert dreimal: 500, Beleg existiert, Entwurf bleibt gesperrt", async () => {
    const { storage, update } = fakeStorage(orderDraft(), { updateFails: 3 });
    expect(await executeCreateOrderFromDraft(storage, "d1", options)).toMatchObject({ ok: false, statusCode: 500 });
    expect(sw.createOrder).toHaveBeenCalledTimes(1);
    // keine Rücknahme des Claims: ein neuer Versuch würde doppelt anlegen
    expect(update.mock.calls.some(([, data]) => data.status !== "created")).toBe(false);
  });
});

describe("Angebot", () => {
  function offerDraft(overrides: Draft = {}): Draft {
    return {
      ...orderDraft(),
      matchingResults: {
        items: [
          { quantity: 2, matchedProduct: { id: "pA", productNumber: "A", catalogPrice: 120, suggestedPrice: 100 } },
          { quantity: 1, matchedProduct: { id: "pB", productNumber: "B", catalogPrice: 50, suggestedPrice: 45, manualUnitPriceNet: 40 } },
          { quantity: 1, matchedProduct: { id: "pC", productNumber: "C", catalogPrice: 10 } },
        ],
      },
      ...overrides,
    };
  }

  it("Rabatt gesperrt: 409 vor Claim und B2Bsellers", async () => {
    sw.discount = { ok: false, error: "Rabatt nicht erlaubt", statusCode: 409, code: "discount_blocked" };
    const { storage, claim } = fakeStorage(offerDraft());
    expect(await executeCreateOfferFromDraft(storage, "d1", options)).toMatchObject({ code: "discount_blocked" });
    expect(claim).not.toHaveBeenCalled();
    expect(sw.createOffer).not.toHaveBeenCalled();
  });

  it("Preise: manuell vor Vorschlag, ohne beides Shopware-Preis; Freigabe-Eintrag mit Begründung", async () => {
    const approval = { levelId: "lvl", approvalType: "management", totals: {} };
    sw.discount = { ok: true, approval };
    const { storage, updates } = fakeStorage(offerDraft());
    const result = await executeCreateOfferFromDraft(storage, "d1", {
      ...options,
      discountJustification: "Großprojekt",
      userId: "u-sb",
    });
    expect(result).toMatchObject({ ok: true, offerId: "sw-offer-1" });
    const input = sw.createOffer.mock.calls[0]![0] as { lineItems: Array<Record<string, unknown>> };
    expect(input.lineItems).toEqual([
      { productId: "pA", quantity: 2, productNumber: "A", unitPriceNet: 100 },
      { productId: "pB", quantity: 1, productNumber: "B", unitPriceNet: 40 },
      { productId: "pC", quantity: 1, productNumber: "C" },
    ]);
    expect(updates.at(-1)).toEqual({ status: "created", shopwareOfferId: "sw-offer-1" });
    expect(sw.recordDiscount).toHaveBeenCalledWith({
      offerId: "sw-offer-1",
      approval,
      justification: "Großprojekt",
      userId: "u-sb",
      tenantId: "t1",
    });
    expect(sw.refresh).toHaveBeenCalledWith(expect.objectContaining({ kind: "offer", frozen: true }));
  });

  it("B2Bsellers-Fehler: Claim zurück, kein Freigabe-Eintrag", async () => {
    sw.discount = { ok: true, approval: { levelId: "lvl", approvalType: "management", totals: {} } };
    sw.createOffer.mockRejectedValueOnce(new Error("B2B down"));
    const { storage, updates } = fakeStorage(offerDraft());
    expect(await executeCreateOfferFromDraft(storage, "d1", options)).toMatchObject({ ok: false, statusCode: 502 });
    expect(updates).toEqual([{ status: "review_required" }]);
    expect(sw.recordDiscount).not.toHaveBeenCalled();
  });
});
