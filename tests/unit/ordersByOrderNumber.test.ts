/**
 * DB-Berechnung fuer eine einzelne Bestellnummer (Bestell-DB-Analyse): findOrdersByOrderNumber
 * sucht exakt (ohne Teiltreffer), unabhaengig von Gross-/Kleinschreibung und Leerzeichen, und
 * liefert bei mehrfach vergebenen Shopware-Nummern alle Bestellungen, neueste zuerst.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import type { Order } from "../../shared/schema";
import { findOrdersByOrderNumber } from "../../server/shopware/ordersList";

function order(id: string, orderNumber: string, orderDate: string): Order {
  return {
    id,
    orderNumber,
    customerName: "Kunde",
    customerEmail: "kunde@example.com",
    orderDate,
    totalAmount: 119,
    netTotalAmount: 100,
    status: "open",
    paymentStatus: "open",
    salesChannelId: "sc",
    items: [],
  } as Order;
}

describe("findOrdersByOrderNumber", () => {
  const orders = [
    order("a", "MO10001", "2026-09-01T10:00:00Z"),
    order("b", "MO100011", "2026-09-02T10:00:00Z"),
    order("c", "mo10001", "2026-09-05T10:00:00Z"),
    order("d", "MO20002", "2026-09-03T10:00:00Z"),
  ];

  it("findet nur exakte Treffer, Gross-/Kleinschreibung egal, neueste zuerst", () => {
    expect(findOrdersByOrderNumber(orders, "  Mo10001 ").map((o) => o.id)).toEqual(["c", "a"]);
  });

  it("keine Teiltreffer und keine Suche ohne Nummer", () => {
    expect(findOrdersByOrderNumber(orders, "MO1000")).toEqual([]);
    expect(findOrdersByOrderNumber(orders, "   ")).toEqual([]);
  });
});
