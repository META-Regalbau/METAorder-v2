/**
 * Lücken der Entwurfs-Automatik (PR E): Rabatt-Ampel auf dem Server (gemeinsame Rabattrechnung,
 * gesperrte und freigabepflichtige Stufen), lesbare Gründe der Strikt-Regel.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import { computeOfferDraftDiscountTotals } from "../../shared/offerDraftDiscount";
import { decideOfferDiscount } from "../../server/commercial/offerDraftDiscountGate";
import { describeStrictReason, groupStrictReasons } from "../../client/src/lib/strictAutoCreateReasons";

describe("Rabatt eines Angebotsentwurfs", () => {
  it("manueller Preis vor Vorschlag vor Katalog", () => {
    expect(
      computeOfferDraftDiscountTotals([
        { quantity: 2, matchedProduct: { catalogPrice: 100, suggestedPrice: 90, manualUnitPriceNet: 80 } },
        { quantity: 1, matchedProduct: { catalogPrice: 50, suggestedPrice: 45 } },
        { quantity: 1, matchedProduct: { catalogPrice: 50 } },
      ]),
    ).toEqual({ totalCatalogValue: 300, totalOfferValue: 255, discountPercent: 15 });
  });

  it("ohne Katalogwert kein Rabatt", () => {
    expect(computeOfferDraftDiscountTotals([{ quantity: 1, matchedProduct: {} }]).discountPercent).toBe(0);
  });
});

describe("Rabatt-Ampel bei der Anlage", () => {
  const totals = { totalCatalogValue: 1000, totalOfferValue: 750, discountPercent: 25 };
  const level = (approvalType: string, justificationRequired = true) => ({
    levelId: "lvl",
    approvalType,
    justificationRequired,
  });

  it("keine Stufe oder kein Rabatt: frei", () => {
    expect(decideOfferDiscount(null, totals, null)).toEqual({ ok: true, approval: null });
    expect(decideOfferDiscount(level("management"), { ...totals, discountPercent: 0 }, null)).toEqual({
      ok: true,
      approval: null,
    });
  });

  it("Stufe ohne Freigabe: frei", () => {
    expect(decideOfferDiscount(level("none"), totals, null)).toEqual({ ok: true, approval: null });
  });

  it("gesperrte Stufe: nie anlegen", () => {
    expect(decideOfferDiscount(level("blocked"), totals, "Begründung")).toMatchObject({
      ok: false,
      statusCode: 409,
      code: "discount_blocked",
      error: "Rabatt von 25 % ist nicht erlaubt",
    });
  });

  it("Freigabe mit Begründungspflicht: ohne Begründung (z. B. Automatik) gesperrt", () => {
    expect(decideOfferDiscount(level("department_lead"), totals, "  ")).toMatchObject({
      ok: false,
      code: "discount_justification_required",
    });
  });

  it("mit Begründung bzw. ohne Begründungspflicht: anlegen und Freigabe-Eintrag vorsehen", () => {
    expect(decideOfferDiscount(level("management"), totals, "Großprojekt")).toEqual({
      ok: true,
      approval: { levelId: "lvl", approvalType: "management", totals },
    });
    expect(decideOfferDiscount(level("department_lead", false), totals, null)).toMatchObject({
      ok: true,
      approval: { approvalType: "department_lead" },
    });
  });
});

describe("Gründe der Strikt-Regel", () => {
  const t = ((key: string, opts?: Record<string, unknown>) => `${key}${opts ? JSON.stringify(opts) : ""}`) as any;

  it.each([
    ["line_3_price_mismatch", 'strictAutoCreate.line.price_mismatch{"line":"3","defaultValue":"line_3_price_mismatch"}'],
    ["intent_confidence_below_0.95", 'strictAutoCreate.intentConfidenceBelow{"min":95}'],
    ["customer_match_confidence_below_95", 'strictAutoCreate.customerMatchBelow{"min":"95"}'],
    ["margin_below_minimum", 'strictAutoCreate.reason.margin_below_minimum{"defaultValue":"margin_below_minimum"}'],
  ])("%s", (code, expected) => {
    expect(describeStrictReason(code, t)).toBe(expected);
  });
});

describe("Gründe zusammenfassen", () => {
  it("gleiche Positionsgründe in einer Zeile, Reihenfolge bleibt", () => {
    expect(
      groupStrictReasons([
        "auto_create_orders_disabled",
        "line_1_not_matched",
        "line_2_not_matched",
        "line_1_price_unresolved",
        "line_3_not_matched",
        "margin_below_minimum",
      ]),
    ).toEqual([
      "auto_create_orders_disabled",
      "line_1, 2, 3_not_matched",
      "line_1_price_unresolved",
      "margin_below_minimum",
    ]);
  });
});
