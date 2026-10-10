/**
 * Preis je Entwurfsposition ändern (Prüffenster): manueller Netto-Stückpreis setzen/entfernen mit
 * Protokoll (wer/wann), Prüfungen, Wirkung auf die DB; Preiseingabe in deutscher/englischer Form.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import { applyManualLinePrice, preserveManualLinePrices } from "../../server/commercial/draftLinePrice";
import { buildDraftProfitability, collectDraftLines } from "../../server/commercial/draftProfitability";
import { parseLocalePrice } from "../../client/src/lib/parseLocalePrice";

const now = new Date("2026-10-10T12:00:00Z");
const items = [
  { quantity: 2, matchedProduct: { id: "pA", productNumber: "A", name: "Regal", price: 120 } },
  { quantity: 1, bundle: { components: [{ productNumber: "S1", quantity: 2 }] } },
  { quantity: 1 },
];

describe("manueller Preis je Position", () => {
  it("setzt Preis (gerundet) mit Benutzer und Zeitpunkt, Eingabe bleibt unverändert", () => {
    const result = applyManualLinePrice(items as any[], 0, 99.999, "isabell", now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.items[0]!.matchedProduct).toEqual({
      id: "pA",
      productNumber: "A",
      name: "Regal",
      price: 120,
      manualUnitPriceNet: 100,
      manualPriceChangedBy: "isabell",
      manualPriceChangedAt: now.toISOString(),
    });
    expect((items[0]!.matchedProduct as any).manualUnitPriceNet).toBeUndefined();
  });

  it("null entfernt Preis und Protokoll", () => {
    const set = applyManualLinePrice(items as any[], 0, 80, "a", now);
    if (!set.ok) throw new Error("setzen fehlgeschlagen");
    const reset = applyManualLinePrice(set.items, 0, null, "b", now);
    expect(reset.ok && reset.items[0]!.matchedProduct).toEqual({ id: "pA", productNumber: "A", name: "Regal", price: 120 });
  });

  it.each([
    [5, 10, 404],
    [1, 10, 400],
    [2, 10, 400],
    [0, -1, 400],
    [0, Number.NaN, 400],
    [0, 20_000_000, 400],
  ])("Position %s mit Preis %s → %s", (index, price, status) => {
    const result = applyManualLinePrice(items as any[], index, price, "x", now);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.statusCode).toBe(status);
  });

  it("der manuelle Preis zählt in der DB-Berechnung vor allem anderen", () => {
    const result = applyManualLinePrice(items as any[], 0, 110, "x", now);
    if (!result.ok) throw new Error("setzen fehlgeschlagen");
    const lines = collectDraftLines({ matchingResults: { items: result.items as any } }, "order", () => undefined);
    const db = buildDraftProfitability(lines, () => 100, { minMarginPercent: 20, warnMarginPercent: 7 });
    expect(db.lines[0]).toMatchObject({ unitPriceNet: 110, priceSource: "manual", marginPercent: 10, crmVerdict: "yellow" });
  });
});

describe("Preiseingabe", () => {
  it.each([
    ["1.088,85", 1088.85],
    ["1088,85", 1088.85],
    ["1,088.85", 1088.85],
    ["1088.85", 1088.85],
    ["1.088", 1088],
    ["0,6", 0.6],
    [" 12 € ", 12],
    ["1.234.567,8", 1234567.8],
  ])("%s → %s", (raw, value) => {
    expect(parseLocalePrice(raw)).toBe(value);
  });

  it.each(["", "abc", "1,2,3.4.5", "1..2"])("%j → null", (raw) => {
    expect(parseLocalePrice(raw)).toBeNull();
  });
});

describe("allgemeines Speichern ändert manuelle Preise nicht", () => {
  const stored = [
    { quantity: 2, matchedProduct: { id: "pA", manualUnitPriceNet: 100, manualPriceChangedBy: "a", manualPriceChangedAt: "t" } },
    { quantity: 1, matchedProduct: { id: "pB" } },
  ];

  it("veralteter Stand ohne Preis: gespeicherter Preis bleibt, neue Menge gilt", () => {
    const incoming = [{ quantity: 5, matchedProduct: { id: "pA" } }, { quantity: 1, matchedProduct: { id: "pB" } }];
    expect(preserveManualLinePrices(stored as any[], incoming as any[])).toEqual([
      { quantity: 5, matchedProduct: { id: "pA", manualUnitPriceNet: 100, manualPriceChangedBy: "a", manualPriceChangedAt: "t" } },
      { quantity: 1, matchedProduct: { id: "pB" } },
    ]);
  });

  it("veralteter Stand mit älterem Preis bzw. Preis ohne Speicherung wird verworfen", () => {
    const incoming = [
      { quantity: 2, matchedProduct: { id: "pA", manualUnitPriceNet: 80 } },
      { quantity: 1, matchedProduct: { id: "pB", manualUnitPriceNet: 1 } },
    ];
    const result = preserveManualLinePrices(stored as any[], incoming as any[]);
    expect((result[0]!.matchedProduct as any).manualUnitPriceNet).toBe(100);
    expect(result[1]!.matchedProduct).toEqual({ id: "pB" });
  });

  it("anderer Artikel an der Stelle (Alternative gewählt): kein manueller Preis", () => {
    const incoming = [{ quantity: 2, matchedProduct: { id: "pX" } }];
    expect(preserveManualLinePrices(stored as any[], incoming as any[])).toEqual([
      { quantity: 2, matchedProduct: { id: "pX" } },
    ]);
  });
});
