/**
 * DB-Berechnung für Bestell- und Angebotsentwürfe: Preisquelle je Position (manuell, Vorschlag,
 * Kundenpreis aus Shopware), Sets über ihre Bestandteile, Positionen ohne Preis, Ampel mit zwei
 * Schwellen, Ausblenden der Werte ohne Recht.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import {
  buildDraftProfitability,
  collectDraftLines,
  hideDraftProfitabilityDetails,
  toDraftProfitabilityBadge,
  type DraftForProfitability,
} from "../../server/commercial/draftProfitability";

const HK: Record<string, number> = { A: 100, B: 50, C: 10, S1: 20, S2: 5 };
const herstellpreisOf = (ref: { productNumber?: string | null }) => HK[ref.productNumber ?? ""] ?? null;
const thresholds = { minMarginPercent: 20, warnMarginPercent: 7 };
const now = new Date("2026-10-10T10:00:00Z");

const draft: DraftForProfitability = {
  shopwareCustomerId: "c1",
  matchingResults: {
    items: [
      { quantity: 2, matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: 130 } },
      { quantity: 1, matchedProduct: { id: "pB", productNumber: "B", suggestedPrice: 54 } },
      { quantity: 3, matchedProduct: { id: "pX", productNumber: "X" } },
      { quantity: 1 }, // nicht zugeordnet
      {
        quantity: 2,
        bundle: {
          components: [
            { productId: "s1", productNumber: "S1", quantity: 2 },
            { productNumber: "S2", quantity: 4 },
          ],
        },
      },
      { quantity: 0, matchedProduct: { id: "pC", productNumber: "C", manualUnitPriceNet: 99 } },
    ],
  },
};

describe("Positionen aus dem Entwurf", () => {
  it("Angebot: manueller Preis vor Vorschlag, Rest ohne Preis; Sets mit Bestandteilen", () => {
    const lines = collectDraftLines(draft, "offer", (n) => (n === "S2" ? "s2" : undefined));
    expect(lines.map((l) => [l.index, l.priceSource, l.parts[0]!.unitPriceNet])).toEqual([
      [0, "manual", 130],
      [1, "suggested", 54],
      [2, "unresolved", null],
      [4, "unresolved", null],
    ]);
    expect(lines[3]!.parts.map((p) => [p.ref.productId, p.quantityPerUnit])).toEqual([
      ["s1", 2],
      ["s2", 4],
    ]);
  });

  it("Bestellung: Smart-Pricing-Vorschlag zählt nicht (Shopware rechnet selbst)", () => {
    const lines = collectDraftLines(draft, "order", () => undefined);
    expect(lines[1]).toMatchObject({ index: 1, priceSource: "unresolved" });
    expect(lines[1]!.parts[0]!.unitPriceNet).toBeNull();
  });
});

describe("DB je Position und Entwurf", () => {
  const lines = collectDraftLines(draft, "offer", () => undefined);
  // Shopware-Preise wie fillMissingPrices sie setzen würde
  lines[2]!.parts[0]!.unitPriceNet = 10;
  lines[2]!.priceSource = "list";
  lines[3]!.parts[0]!.unitPriceNet = 30;
  lines[3]!.parts[1]!.unitPriceNet = 8;
  lines[3]!.priceSource = "customer_specific";
  const result = buildDraftProfitability(lines, herstellpreisOf, thresholds, { now });

  it("manueller Preis: 30 % Aufschlag = grün", () => {
    expect(result.lines[0]).toMatchObject({
      unitPriceNet: 130,
      herstellpreisNet: 100,
      herstellkostenTotal: 200,
      db1Abs: 60,
      marginPercent: 30,
      crmVerdict: "green",
    });
  });

  it("Vorschlag 54 auf HK 50: 8 % = gelb", () => {
    expect(result.lines[1]).toMatchObject({ marginPercent: 8, crmVerdict: "yellow", priceSource: "suggested" });
  });

  it("Artikel ohne Herstellpreis: Preis ja, Ampel nein", () => {
    expect(result.lines[2]).toMatchObject({ unitPriceNet: 10, herstellpreisNet: null, crmVerdict: "none" });
  });

  it("Set: Preis und HK über die Bestandteile", () => {
    // Preis je Set 2×30 + 4×8 = 92, HK je Set 2×20 + 4×5 = 60 → 53,3 %
    expect(result.lines[3]).toMatchObject({
      isBundle: true,
      unitPriceNet: 92,
      herstellpreisNet: 60,
      herstellkostenTotal: 120,
      db1Abs: 64,
      marginPercent: 53.3,
      crmVerdict: "green",
    });
  });

  it("Summe nur über Positionen mit Preis und HK", () => {
    // Umsatz 260 + 54 + 184 = 498, HK 200 + 50 + 120 = 370 → DB1 128, 34,6 %
    expect(result.summary).toMatchObject({
      db1Total: 128,
      herstellkostenTotal: 370,
      marginPercent: 34.6,
      crmVerdict: "green",
      productLineCount: 4,
      linesWithHerstellpreis: 3,
    });
    expect(result.unpricedLineCount).toBe(0);
    expect(result.thresholds).toEqual(thresholds);
    expect(result.computedAt).toBe(now.toISOString());
  });

  it("Set mit fehlendem Bestandteil-Preis zählt als Position ohne Preis", () => {
    const partial = collectDraftLines(draft, "offer", () => undefined);
    partial[3]!.parts[0]!.unitPriceNet = 30;
    const r = buildDraftProfitability(partial, herstellpreisOf, thresholds, { now });
    expect(r.lines[3]).toMatchObject({ unitPriceNet: null, priceSource: "unresolved", crmVerdict: "none" });
    expect(r.unpricedLineCount).toBe(2);
  });

  it("niedriger Gesamtaufschlag macht den Entwurf rot", () => {
    const only = collectDraftLines(
      { matchingResults: { items: [{ quantity: 1, matchedProduct: { id: "pA", productNumber: "A", manualUnitPriceNet: 105 } }] } },
      "order",
      () => undefined,
    );
    expect(buildDraftProfitability(only, herstellpreisOf, thresholds).summary.crmVerdict).toBe("red");
  });
});

describe("Sichtbarkeit", () => {
  const lines = collectDraftLines(draft, "offer", () => undefined);
  const result = buildDraftProfitability(lines, herstellpreisOf, thresholds, { now });

  it("ohne Recht keine Beträge, Ampeln und Preise bleiben", () => {
    const hidden = hideDraftProfitabilityDetails(result);
    expect(hidden.detailsHidden).toBe(true);
    expect(hidden.summary).toMatchObject({ db1Total: null, marginPercent: null, herstellkostenTotal: null });
    expect(hidden.summary.crmVerdict).toBe(result.summary.crmVerdict);
    expect(hidden.lines[0]).toMatchObject({
      unitPriceNet: 130,
      crmVerdict: "green",
      herstellpreisNet: null,
      db1Abs: null,
      marginPercent: null,
    });
    expect(JSON.stringify(hidden)).not.toContain("\"herstellpreisNet\":100");
  });

  it("Listen-Kurzform: Beträge nur mit Recht", () => {
    const row = { snapshot: result, frozen: true };
    expect(toDraftProfitabilityBadge(row, false)).toEqual({
      crmVerdict: result.summary.crmVerdict,
      marginPercent: null,
      db1Total: null,
      frozen: true,
    });
    expect(toDraftProfitabilityBadge(row, true)!.db1Total).toBe(result.summary.db1Total);
    expect(toDraftProfitabilityBadge(undefined, true)).toBeNull();
  });
});
