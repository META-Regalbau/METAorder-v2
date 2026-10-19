/**
 * Shop-Puls Stufe 3 (S3-3): Zahlungsanbieter-Wache – Ergebnis je Zahlung (online/offline, offen nach 24 h),
 * zwei Fehlschläge in Folge bei einer Zahlart, die sonst klappt (kritisch), Fehlerquote 14 Tage (Warnung),
 * hängende Online-Zahlungen mit Mondu-Hinweis, Rückblick auf den Mollie-Ausfall ab 13.09.2026.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { backtestPayments, paymentWatchDetector, isMonduMethod, isOnlineMethod, paymentDetections, paymentOutcome, type PaymentOrder } from "../../server/shopPulse/detectors/payments";

const NOW = new Date("2026-10-19T10:00:00Z");
let n = 0;
const order = (at: string, paymentStatus: string, over: Partial<PaymentOrder> = {}): PaymentOrder => ({
  orderNumber: `MO${100000 + ++n}`,
  createdAt: new Date(at),
  method: "Kredit-/Debitkarte",
  paymentStatus,
  orderStatus: "open",
  total: 100,
  ...over,
});

/** Nachbau des Mollie-Verlaufs aus dem Live-Spiegel (Juli bis Oktober 2026) */
const MOLLIE: PaymentOrder[] = [
  order("2026-07-03T13:41:00Z", "paid"),
  order("2026-07-09T10:33:00Z", "authorized"),
  order("2026-08-08T13:25:00Z", "paid"),
  order("2026-08-20T15:36:00Z", "paid"),
  order("2026-08-28T08:29:00Z", "failed"),
  order("2026-09-13T11:04:00Z", "paid", { orderStatus: "in_progress" }),
  order("2026-09-14T14:14:00Z", "failed"),
  order("2026-09-23T07:53:00Z", "failed"),
  order("2026-10-01T09:59:00Z", "failed"),
];

describe("Ergebnis je Zahlung", () => {
  it("online: fehlgeschlagen, abgebrochen und nach 24 h offen sind Fehlschläge; frisch offen zählt noch nicht", () => {
    expect(paymentOutcome(order("2026-10-18T09:00:00Z", "failed"), NOW)).toBe("failed");
    expect(paymentOutcome(order("2026-10-18T09:00:00Z", "cancelled"), NOW)).toBe("failed");
    expect(paymentOutcome(order("2026-10-18T09:00:00Z", "open"), NOW)).toBe("failed");
    expect(paymentOutcome(order("2026-10-19T09:00:00Z", "open"), NOW)).toBe("pending");
    expect(paymentOutcome(order("2026-10-19T09:00:00Z", "open", { orderStatus: "cancelled" }), NOW)).toBe("failed");
    expect(paymentOutcome(order("2026-10-19T09:00:00Z", "authorized"), NOW)).toBe("success");
  });

  it("offline (Vorkasse, wie vereinbart): offen ist normal, nur fehlgeschlagen zählt", () => {
    expect(paymentOutcome(order("2026-09-01T09:00:00Z", "open", { method: "Vorkasse" }), NOW)).toBe("ignore");
    expect(paymentOutcome(order("2026-09-01T09:00:00Z", "cancelled", { method: "wie vereinbart" }), NOW)).toBe("ignore");
    expect(paymentOutcome(order("2026-09-01T09:00:00Z", "failed", { method: "Vorkasse" }), NOW)).toBe("failed");
  });

  it("Zahlarten erkennen", () => {
    for (const m of ["Kredit-/Debitkarte", "Kredit- oder Debitkarte", "Apple Pay", "PayPal", "Echtzeitüberweisung", "Rechnungskauf (30 Tage)", "SEPA-Lastschrift (30 Tage)"]) expect(isOnlineMethod(m)).toBe(true);
    for (const m of ["Vorkasse", "wie vereinbart", null]) expect(isOnlineMethod(m)).toBe(false);
    expect(isMonduMethod("Rechnungskauf (30 Tage)")).toBe(true);
    expect(isMonduMethod("PayPal")).toBe(false);
  });
});

describe("Fehlschläge in Folge", () => {
  it("Mollie: kritisch ab dem zweiten Fehlschlag nach der letzten Zahlung (23.09.2026), mit Belegen", () => {
    const before = paymentDetections(MOLLIE.slice(0, 7), new Date("2026-09-20T10:00:00Z"));
    expect(before.filter((d) => d.code === "paymentFailStreak")).toEqual([]);
    const [d] = paymentDetections(MOLLIE.slice(0, 8), new Date("2026-09-23T10:00:00Z")).filter((x) => x.code === "paymentFailStreak");
    expect(d).toMatchObject({
      key: "revenue:payfail:kredit-debitkarte",
      severity: "critical",
      params: { method: "Kredit-/Debitkarte", count: 2, since: "2026-09-14", lastSuccess: "2026-09-13" },
    });
    expect((d.evidence as any).baseline).toMatchObject({ success: 5 });
  });

  it("Rückblick: erste Meldung am 23.09.2026, erledigt sich nach 30 Tagen ohne neuen Versuch nicht vorher", () => {
    const eps = backtestPayments(MOLLIE, "2026-09-01", "2026-10-19").filter((e) => e.key === "revenue:payfail:kredit-debitkarte");
    expect(eps).toEqual([{ key: "revenue:payfail:kredit-debitkarte", from: "2026-09-23", to: "2026-10-19", severity: "critical" }]);
  });

  it("erledigt sich mit der nächsten erfolgreichen Zahlung", () => {
    const fixed = [...MOLLIE, order("2026-10-17T15:15:00Z", "paid")];
    expect(paymentDetections(fixed, NOW).filter((d) => d.code === "paymentFailStreak")).toEqual([]);
  });

  it("nicht bei einer Zahlart, die nie klappt (Apple Pay), und nicht nach 30 Tagen ohne Versuch", () => {
    const apple = [order("2026-06-11T09:31:00Z", "failed", { method: "Apple Pay" }), order("2026-08-30T19:40:00Z", "failed", { method: "Apple Pay", orderStatus: "cancelled" })];
    expect(paymentDetections(apple, new Date("2026-09-01T10:00:00Z")).filter((d) => d.code === "paymentFailStreak")).toEqual([]);
    expect(paymentDetections(MOLLIE, new Date("2026-11-05T10:00:00Z")).filter((d) => d.code === "paymentFailStreak")).toEqual([]);
  });
});

describe("Fehlerquote und hängende Zahlungen", () => {
  it("Warnung: Quote der letzten 14 Tage ≥ 50 % und doppelt so hoch wie sonst", () => {
    const m = "Echtzeitüberweisung";
    const list = [
      ...Array.from({ length: 10 }, (_, i) => order(`2026-08-${String(i + 1).padStart(2, "0")}T10:00:00Z`, "paid", { method: m })),
      order("2026-10-10T10:00:00Z", "failed", { method: m }),
      order("2026-10-12T10:00:00Z", "paid", { method: m }),
      order("2026-10-15T10:00:00Z", "failed", { method: m }),
    ];
    const [d] = paymentDetections(list, NOW).filter((x) => x.code === "paymentFailRate");
    expect(d).toMatchObject({ severity: "warning", params: { method: m, fails: 2, attempts: 3, share: 66.7, expected: 0 } });
  });

  it("hängende Online-Zahlungen nach 24 h als Liste, Mondu gezählt; Vorkasse, frische und stornierte nicht", () => {
    const list = [
      order("2026-10-15T10:00:00Z", "open", { method: "Rechnungskauf (30 Tage)", total: 500.4 }),
      order("2026-10-17T10:00:00Z", "open", { method: "PayPal", total: 99.6 }),
      order("2026-10-19T09:00:00Z", "open", { method: "PayPal" }),
      order("2026-10-10T10:00:00Z", "open", { method: "Vorkasse" }),
      order("2026-10-12T10:00:00Z", "open", { method: "PayPal", orderStatus: "cancelled" }),
      order("2026-08-01T10:00:00Z", "open", { method: "PayPal" }),
    ];
    const [d] = paymentDetections(list, NOW).filter((x) => x.code === "paymentsPending");
    expect(d.params).toMatchObject({ count: 2, total: 600, mondu: 1 });
    expect((d.evidence as any).orders.map((o: any) => o.method)).toEqual(["Rechnungskauf (30 Tage)", "PayPal"]);
    expect((d.evidence as any).orders[0].mondu).toBe(true);
  });
});

describe("Prüfung im Lauf", () => {
  it("liest die Zahlungen ab gut 8 Monaten; erster Lauf meldet still", async () => {
    let since: Date | null = null;
    const ctx = (firstRun: boolean) => ({ now: new Date("2026-09-23T10:00:00Z"), firstRun, payments: { orders: async (s: Date) => ((since = s), MOLLIE.slice(0, 8)) } }) as any;
    const first = await paymentWatchDetector.run(ctx(true));
    expect(first.every((d) => d.quiet)).toBe(true);
    const later = await paymentWatchDetector.run(ctx(false));
    expect(later.find((d) => d.code === "paymentFailStreak")?.quiet).toBeUndefined();
    expect(since!.toISOString().slice(0, 10)).toBe("2026-01-12");
  });
});
