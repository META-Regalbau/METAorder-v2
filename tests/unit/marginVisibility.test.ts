/**
 * DB-Ampel mit zwei Schwellen (rot / gelb / grün) und Recht „DB-Werte sehen“ (viewMarginDetails):
 * Ohne das Recht liefert der Server nur die Ampel, keine Herstellkosten, DB1 oder Prozente.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import type { Order, OrderItem } from "../../shared/schema";
import {
  DEFAULT_CRM_MIN_MARGIN_PERCENT,
  DEFAULT_CRM_WARN_MARGIN_PERCENT,
  parseCrmProfitabilitySettings,
} from "../../server/analytics/crmProfitabilitySettings";
import { computeCrmProfitabilityVerdict } from "../../server/products/herstellpreisMargin";
import {
  enrichOrderItem,
  summarizeOrderItems,
} from "../../server/analytics/orderProfitabilityAnalysis";
import {
  applyCustomerPriceMarginVisibility,
  applyOrderMarginVisibility,
} from "../../server/analytics/profitabilityVisibility";
import { canViewMarginDetails } from "../../server/auth/auth";

const thresholds = { minMarginPercent: 20, warnMarginPercent: 7 };

function item(netPrice: number, quantity = 1): OrderItem {
  return {
    id: `i-${netPrice}`,
    name: "Regal",
    quantity,
    price: netPrice * 1.19,
    netPrice,
    total: netPrice * 1.19 * quantity,
    netTotal: netPrice * quantity,
    taxRate: 19,
    productNumber: "A",
  };
}

describe("Ampel-Schwellen", () => {
  it("ohne gespeicherte Werte: grün ab 20 %, rot unter 7 %", () => {
    expect(parseCrmProfitabilitySettings(null)).toEqual({
      minMarginPercent: DEFAULT_CRM_MIN_MARGIN_PERCENT,
      warnMarginPercent: DEFAULT_CRM_WARN_MARGIN_PERCENT,
    });
  });

  it("alte Einstellung nur mit Mindestmarge bekommt die Standard-Warnschwelle", () => {
    expect(parseCrmProfitabilitySettings({ minMarginPercent: 25 })).toEqual({
      minMarginPercent: 25,
      warnMarginPercent: 7,
    });
  });

  it("Warnschwelle über der Mindestmarge wird auf die Mindestmarge begrenzt", () => {
    expect(parseCrmProfitabilitySettings({ minMarginPercent: 5, warnMarginPercent: "12,5" })).toEqual({
      minMarginPercent: 5,
      warnMarginPercent: 5,
    });
  });

  it("ungültige Warnschwelle fällt auf den Standard zurück", () => {
    expect(parseCrmProfitabilitySettings({ minMarginPercent: 20, warnMarginPercent: -3 }).warnMarginPercent).toBe(7);
  });
});

describe("Ampel", () => {
  it.each([
    [25, "green"],
    [20, "green"],
    [19.9, "yellow"],
    [7, "yellow"],
    [6.9, "red"],
    [-10, "red"],
  ] as const)("Aufschlag %s %% ist %s", (margin, verdict) => {
    expect(computeCrmProfitabilityVerdict(margin, 20, 7)).toBe(verdict);
  });

  it("ohne Warnschwelle nur grün oder rot (wie bisher)", () => {
    expect(computeCrmProfitabilityVerdict(15, 20)).toBe("red");
  });

  it("ohne Herstellpreis keine Ampel", () => {
    expect(computeCrmProfitabilityVerdict(null, 20, 7)).toBe("none");
  });

  it("Position und Bestellung bekommen Gelb zwischen den Schwellen", () => {
    // HK 100, VK 110 → 10 % Aufschlag
    const line = enrichOrderItem(item(110, 2), 100, thresholds);
    expect(line.crmVerdict).toBe("yellow");
    expect(line.db1Abs).toBe(20);
    expect(summarizeOrderItems([line], thresholds).crmVerdict).toBe("yellow");
  });
});

describe("Recht „DB-Werte sehen“", () => {
  const role = (name: string, permissions: Record<string, boolean>) => ({ roleDetails: { name, permissions } });

  it("Administrator sieht immer genaue Werte", () => {
    expect(canViewMarginDetails(role("Administrator", {}))).toBe(true);
    expect(canViewMarginDetails({ role: "admin" })).toBe(true);
  });

  it("andere Rollen nur mit viewMarginDetails", () => {
    expect(canViewMarginDetails(role("Sachbearbeitung", { viewOrders: true }))).toBe(false);
    expect(canViewMarginDetails(role("Vertriebsleitung", { viewMarginDetails: true }))).toBe(true);
    expect(canViewMarginDetails(undefined)).toBe(false);
  });
});

describe("Werte ausblenden", () => {
  const line = enrichOrderItem(item(110, 2), 100, thresholds);
  const order = {
    id: "o1",
    items: [line, item(50)],
    profitability: summarizeOrderItems([line], thresholds),
  } as unknown as Order;

  it("ohne Recht bleiben nur Ampel und Abdeckung", () => {
    const [hidden] = applyOrderMarginVisibility([order], false);
    expect(hidden!.profitability).toMatchObject({
      crmVerdict: "yellow",
      herstellkostenTotal: null,
      db1Total: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
      linesWithHerstellpreis: 1,
      productLineCount: 1,
    });
    expect(hidden!.items[0]).toMatchObject({
      crmVerdict: "yellow",
      herstellpreisNet: null,
      herstellkostenTotal: null,
      db1Abs: null,
      marginPercent: null,
      marginOnRevenuePercent: null,
    });
    // Position ohne DB-Daten bleibt unverändert
    expect(hidden!.items[1]).toEqual(order.items[1]);
    expect(JSON.stringify(hidden)).not.toContain("\"herstellpreisNet\":100");
  });

  it("mit Recht bleibt alles unverändert", () => {
    expect(applyOrderMarginVisibility([order], true)[0]).toBe(order);
  });

  it("Kundenpreise: Prozent weg, Ampel bleibt", () => {
    const prices = [{ productId: "p", herstellMarginPercent: 12.5, herstellMarginVerdict: "yellow" }];
    expect(applyCustomerPriceMarginVisibility(prices, false)).toEqual([
      { productId: "p", herstellMarginPercent: null, herstellMarginVerdict: "yellow" },
    ]);
    expect(applyCustomerPriceMarginVisibility(prices, true)).toBe(prices);
  });
});
