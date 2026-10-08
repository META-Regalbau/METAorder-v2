/**
 * CRM-Kundenliste: Bestellanzahl, Umsatz und letzte Bestellung je Art der Bestellnummer
 * (alle / nur MO / nur ohne MO), siehe server/analytics/crmOrderStats.ts.
 * Ausführung: npm test
 */
import { describe, expect, it } from "vitest";
import type { Order } from "../../shared/schema";
import { addOrderToCrmStats, pickCrmOrderStats, type CrmOrderStatsByFilter } from "../../server/analytics/crmOrderStats";

const order = (orderNumber: string, day: string, totalAmount: number) =>
  ({ orderNumber, orderDate: `${day}T00:00:00.000+00:00`, totalAmount } as Order);

describe("CRM-Bestellkennzahlen je Bestellnummern-Art", () => {
  const stats: CrmOrderStatsByFilter = {};
  [order("MO100", "2026-05-01", 100), order("294829", "2026-06-01", 50000), order("MO101", "2026-04-01", 20)]
    .forEach((o) => addOrderToCrmStats(stats, o));
  const item = { email: "a@example.com", totalOrders: 3, totalRevenue: 50120, lastOrderNumber: "294829", lastOrderDate: "2026-06-01T00:00:00.000+00:00", orderStatsByFilter: stats };

  it("nur MO: ohne die durchgeschleuste Bestellung, letzte MO-Bestellung", () => {
    expect(pickCrmOrderStats(item, "mo")).toEqual({
      email: "a@example.com", totalOrders: 2, totalRevenue: 120, lastOrderNumber: "MO100", lastOrderDate: "2026-05-01T00:00:00.000+00:00",
    });
  });

  it("nur ohne MO und alle", () => {
    expect(pickCrmOrderStats(item, "non-mo")).toMatchObject({ totalOrders: 1, totalRevenue: 50000, lastOrderNumber: "294829" });
    expect(pickCrmOrderStats(item, "all")).toMatchObject({ totalOrders: 3, totalRevenue: 50120 });
    expect(pickCrmOrderStats(item, "all")).not.toHaveProperty("orderStatsByFilter");
  });

  it("Kunde nur mit durchgeschleusten Bestellungen hat bei MO null Bestellungen", () => {
    const only: CrmOrderStatsByFilter = {};
    addOrderToCrmStats(only, order("294829", "2026-06-01", 50000));
    const muster = { totalOrders: 1, totalRevenue: 50000, lastOrderNumber: "294829", lastOrderDate: "2026-06-01", orderStatsByFilter: only };
    expect(pickCrmOrderStats(muster, "mo")).toEqual({ totalOrders: 0, totalRevenue: 0, lastOrderNumber: null, lastOrderDate: null });
  });

  it("Eintrag ohne Bestellungen (z. B. nur Ticket) behaelt die Ticket-Bestellnummer", () => {
    const ticketOnly = { totalOrders: 0, totalRevenue: 0, lastOrderNumber: "MO555", lastOrderDate: null };
    expect(pickCrmOrderStats(ticketOnly, "mo")).toEqual(ticketOnly);
  });
});
