/**
 * Fracht nach Lieferbedingung (Kunden-Tag → Versandregel → Warenwert-Staffel mit wduPercentualValue).
 * Werte aus dem Testshop 11.10.2026: LB54 bei Spedition National.
 *
 *   Ausführung: npm test
 */
import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { pickShippingTier, shippingCostFor, smallVolumeApplies, type ShippingTierRow } from "../../server/shopware/dealerShipping";

const NATIONAL = "019d7865826a74f49399b79903054ec2";
const LB54: ShippingTierRow[] = [
  { shippingMethodId: NATIONAL, ruleId: "lb54", calculation: 2, from: 0, to: 399.99, fixedNet: 0, percentOfGoods: 12 },
  { shippingMethodId: NATIONAL, ruleId: "lb54", calculation: 2, from: 400, to: 899.99, fixedNet: 0, percentOfGoods: 10 },
  { shippingMethodId: NATIONAL, ruleId: "lb54", calculation: 2, from: 900, to: null, fixedNet: 0, percentOfGoods: 0 },
];

describe("Fracht-Staffel", () => {
  it("LB54: 12 % unter 400 €, 10 % bis 899,99 €, ab 900 € frei", () => {
    const cost = (goods: number) => shippingCostFor(pickShippingTier(LB54, goods)!, goods);
    assert.equal(cost(216), 25.92);
    assert.equal(cost(6), 0.72);
    assert.equal(cost(400), 40);
    assert.equal(cost(899.99), 90);
    assert.equal(cost(900), 0);
    assert.equal(cost(3837), 0);
  });

  it("frachtfrei: feste 0 €; feste Beträge ohne Prozent", () => {
    const frei: ShippingTierRow[] = [{ shippingMethodId: NATIONAL, ruleId: "frei", calculation: 2, from: 0, to: null, fixedNet: 0, percentOfGoods: null }];
    assert.equal(shippingCostFor(pickShippingTier(frei, 500)!, 500), 0);
    const fix: ShippingTierRow[] = [{ shippingMethodId: "x", ruleId: "r", calculation: 2, from: 0, to: null, fixedNet: 49, percentOfGoods: null }];
    assert.equal(shippingCostFor(pickShippingTier(fix, 10)!, 10), 49);
  });

  it("bevorzugte Versandart gewinnt, Gewichtsstaffeln zählen nicht", () => {
    const rows: ShippingTierRow[] = [
      { shippingMethodId: "dpd", ruleId: "r", calculation: 2, from: 0, to: null, fixedNet: 0, percentOfGoods: 5 },
      { shippingMethodId: NATIONAL, ruleId: "r", calculation: 2, from: 0, to: null, fixedNet: 0, percentOfGoods: 8 },
      { shippingMethodId: NATIONAL, ruleId: "r", calculation: 3, from: 0, to: null, fixedNet: 130, percentOfGoods: null },
    ];
    assert.equal(pickShippingTier(rows, 100, NATIONAL)?.percentOfGoods, 8);
    assert.equal(pickShippingTier(rows, 100, null)?.shippingMethodId, "dpd");
    assert.equal(pickShippingTier([], 100), null);
  });
});

describe("Mindermengenzuschlag", () => {
  it("nur unter der Grenze und mit Betrag", () => {
    assert.equal(smallVolumeApplies(25, 75, 6), 25);
    assert.equal(smallVolumeApplies(25, 75, 74.99), 25);
    assert.equal(smallVolumeApplies(25, 75, 75), null);
    assert.equal(smallVolumeApplies(0, 0, 6), null);
    assert.equal(smallVolumeApplies(15, 0, 6), null);
    assert.equal(smallVolumeApplies(undefined, undefined, 6), null);
  });
});
