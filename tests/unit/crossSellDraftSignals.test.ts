/**
 * Reaktionen auf Cross-Selling-Vorschlaege in Entwuerfen: Impressionen, Hinzufuegen, Uebernahme.
 */
import { describe, it, expect } from "vitest";
import {
  draftImpressionRows,
  recordDraftSuggestionImpressions,
  recordDraftSuggestionAdd,
  recordDraftSuggestionConversions,
  DRAFT_ADD_EVENT,
  DRAFT_CONVERTED_EVENT,
  DRAFT_IMPRESSION_EVENT,
} from "../../server/cross-selling/crossSellDraftSignals";

type Call = { rows: any[]; ctx: any; tenantId: string | null | undefined };

function fakeStorage(addedPairs: Array<{ sourceProductNumber: string; targetProductNumber: string }> = []) {
  const calls: Call[] = [];
  return {
    calls,
    recordCrossSellEventsOncePerDraft: async (rows: any[], ctx: any, tenantId?: string | null) => {
      calls.push({ rows, ctx, tenantId });
      return rows.length;
    },
    getCrossSellDraftEventPairs: async () => addedPairs,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("draftImpressionRows", () => {
  it("Paare mit Rang, ohne leere Nummern und ohne Selbstbezug", () => {
    expect(
      draftImpressionRows([
        { forProduct: { productNumber: "A" }, suggestions: [{ productNumber: "B" }, { productNumber: "" }, { productNumber: "A" }, { productNumber: "C" }] },
        { forProduct: { productNumber: "" }, suggestions: [{ productNumber: "X" }] },
      ]),
    ).toEqual([
      { sourceProductNumber: "A", targetProductNumber: "B", metadata: { rank: 1 } },
      { sourceProductNumber: "A", targetProductNumber: "C", metadata: { rank: 4 } },
    ]);
  });
});

describe("Entwurfs-Ereignisse", () => {
  it("Impressionen nur fuer angemeldete Nutzer, mit Entwurf und Kontext", async () => {
    const storage = fakeStorage();
    const groups = [{ forProduct: { productNumber: "A" }, suggestions: [{ productNumber: "B" }] }];
    recordDraftSuggestionImpressions(storage, { tenantId: "t1", userId: null, draftId: "d1", kind: "order_draft", groups });
    recordDraftSuggestionImpressions(storage, { tenantId: "t1", userId: "u1", draftId: "d1", kind: "order_draft", groups });
    await flush();
    expect(storage.calls).toHaveLength(1);
    expect(storage.calls[0].ctx).toEqual({ eventType: DRAFT_IMPRESSION_EVENT, draftId: "d1", context: "order_draft", userId: "u1" });
    expect(storage.calls[0].tenantId).toBe("t1");
  });

  it("Hinzufuegen wird nur mit Vorschlags-Kontext erfasst", async () => {
    const storage = fakeStorage();
    const base = { tenantId: "t1", userId: "u1", draftId: "d1", kind: "offer_draft" as const, targetProductNumber: "B" };
    await recordDraftSuggestionAdd(storage, { ...base, crossSell: undefined });
    await recordDraftSuggestionAdd(storage, { ...base, crossSell: { sourceProductNumber: "" } });
    await recordDraftSuggestionAdd(storage, { ...base, crossSell: { sourceProductNumber: "A", rank: 2 } });
    expect(storage.calls).toHaveLength(1);
    expect(storage.calls[0].rows).toEqual([{ sourceProductNumber: "A", targetProductNumber: "B", metadata: { rank: 2 } }]);
    expect(storage.calls[0].ctx.eventType).toBe(DRAFT_ADD_EVENT);
  });

  it("Uebernahme: nur hinzugefuegte Ziele, die noch im Entwurf stehen", async () => {
    const storage = fakeStorage([
      { sourceProductNumber: "A", targetProductNumber: "B" },
      { sourceProductNumber: "A", targetProductNumber: "C" },
    ]);
    const n = await recordDraftSuggestionConversions(storage, {
      tenantId: null,
      draftId: "d1",
      kind: "order_draft",
      items: [{ matchedProduct: { productNumber: "A" } }, { matchedProduct: { productNumber: "B" } }, { matchedProduct: null }],
    });
    expect(n).toBe(1);
    expect(storage.calls[0].rows).toEqual([{ sourceProductNumber: "A", targetProductNumber: "B" }]);
    expect(storage.calls[0].ctx.eventType).toBe(DRAFT_CONVERTED_EVENT);
  });

  it("Uebernahme: Speicherfehler bricht das Anlegen nicht ab", async () => {
    const n = await recordDraftSuggestionConversions(
      {
        recordCrossSellEventsOncePerDraft: async () => 0,
        getCrossSellDraftEventPairs: async () => {
          throw new Error("db down");
        },
      },
      { tenantId: null, draftId: "d1", kind: "offer_draft", items: [{ matchedProduct: { productNumber: "A" } }] },
    );
    expect(n).toBe(0);
  });
});
