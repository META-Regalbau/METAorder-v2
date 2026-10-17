/**
 * Shop-Puls PR B: Umsatz-Prüfungen auf simulierten Bestellverläufen (Bestell-Lücke, Zahlart verschwunden,
 * Woche gegen Vorwochen und Vorjahr), Zahlen für den Tagesbericht, Berliner Kalender, Spiegel-Zeilen →
 * Shop-Bestellungen, Formatierung der Meldungstexte und ein Lauf, der bei hängendem Abgleich aussetzt.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { addDays, berlinTime, toPulseOrders, weekdayOfDay, type PulseOrder } from "../../server/shopPulse/pulseOrders";
import {
  dailyNumbers,
  orderGapDetections,
  orderGapDetector,
  paymentGoneDetections,
  paymentGoneDetector,
  weekComparisonDetections,
  weekComparisonDetector,
} from "../../server/shopPulse/detectors/revenue";
import { mirrorFreshnessDetector } from "../../server/shopPulse/detectors/mirrorFreshness";
import { buildShopPulseDailyCard, dailyNumbersLines, signalMessage, signalTitle } from "../../server/shopPulse/shopPulseNotify";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { getShopPulseState, SHOP_PULSE_SETTINGS_KEY, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "../../server/shopPulse/shopPulseSettings";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import type { ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import { formatShopPulseParams, SHOP_PULSE_DETECTOR_IDS, type ShopPulseSignal } from "../../shared/shopPulse";
import { SHOP_PULSE_DETECTORS } from "../../server/shopPulse/detectors";

const nb = (s: string) => s.replace(/ /g, " ");

let seq = 0;
/** Bestellung an einem Berliner Tag zu einer Berliner Stunde */
function order(day: string, hour: number, total = 500, paymentMethod: string | null = "Rechnungskauf (30 Tage)"): PulseOrder {
  return {
    orderNumber: `MO${++seq}`,
    createdAt: new Date(`${day}T${String(hour).padStart(2, "0")}:30:00+02:00`),
    day,
    hour,
    total,
    paymentMethod,
  };
}
const times = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));

/** Montag, 19.10.2026, Uhrzeit in Berlin (Sommerzeit, UTC+2) */
const MONDAY = (hh: number, mm = 0) => new Date(`2026-10-19T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00+02:00`);

describe("Prüfungen", () => {
  it("Lauf-Reihenfolge für die Seite: Spiegel-Frische zuerst, dann Umsatz", () => {
    expect(SHOP_PULSE_DETECTORS.map((d) => d.id)).toEqual([...SHOP_PULSE_DETECTOR_IDS]);
    expect(SHOP_PULSE_DETECTORS.filter((d) => d.needsFreshMirror).map((d) => d.source)).toEqual(["revenue", "revenue", "revenue"]);
  });
});

describe("Berliner Kalender", () => {
  it("Tag, Stunde, Wochentag auch über die Zeitumstellung", () => {
    expect(berlinTime(new Date("2026-10-18T22:30:00Z"))).toEqual({ day: "2026-10-19", hour: 0, weekday: 1 });
    expect(berlinTime(new Date("2026-10-25T22:30:00Z"))).toEqual({ day: "2026-10-25", hour: 23, weekday: 7 });
    expect(addDays("2026-10-24", 2)).toBe("2026-10-26");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(weekdayOfDay("2026-10-19")).toBe(1);
    expect(weekdayOfDay("2026-10-18")).toBe(7);
  });
});

describe("Spiegel-Zeilen → Shop-Bestellungen", () => {
  const row = (orderNumber: string, over: Record<string, unknown> = {}) => ({
    orderNumber,
    swUpdatedAt: new Date("2026-10-18T10:00:00Z"),
    createdAt: "2026-10-18T22:30:00.000Z",
    total: "1190.50",
    paymentMethod: " PayPal ",
    status: "open",
    ...over,
  });

  it("nur MO, ohne Stornierte, je Nummer die zuletzt geänderte, Berliner Tag aus createdAt", () => {
    const out = toPulseOrders([
      row("MO10001"),
      row("1234567"), // durchgeschleust, kein MO
      row("MO10002", { status: "cancelled" }),
      row("MO10003", { total: "100", swUpdatedAt: new Date("2026-10-18T09:00:00Z") }),
      row("MO10003", { total: "200", swUpdatedAt: new Date("2026-10-18T11:00:00Z") }),
      row("MO10004", { createdAt: null }),
    ]);
    expect(out.map((o) => [o.orderNumber, o.total, o.day, o.hour, o.paymentMethod])).toEqual([
      ["MO10001", 1190.5, "2026-10-19", 0, "PayPal"],
      ["MO10003", 200, "2026-10-19", 0, "PayPal"],
    ]);
  });

  it("die zuletzt geänderte Zeile ist storniert: Bestellung zählt nicht", () => {
    expect(
      toPulseOrders([row("MO1", { swUpdatedAt: new Date("2026-10-18T09:00:00Z") }), row("MO1", { status: "cancelled", swUpdatedAt: new Date("2026-10-18T12:00:00Z") })]),
    ).toEqual([]);
  });
});

/** 8 Montage davor mit je 4 Bestellungen bis 15 Uhr und 2 danach (500 € je Bestellung) */
const gapHistory = (perMorning = 4) =>
  times(8, (k) => addDays("2026-10-19", -7 * (k + 1))).flatMap((day) => [
    ...times(perMorning, (i) => order(day, 9 + i)),
    order(day, 16),
    order(day, 17),
  ]);

describe("Bestell-Lücke", () => {
  it("Werktag ab 15 Uhr, heute nichts, sonst 4 bis 15 Uhr: Warnung mit üblichem Stundenumsatz", () => {
    const found = orderGapDetections(gapHistory(), MONDAY(15, 30));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: "revenue:order-gap", source: "revenue", code: "orderGap", severity: "warning", params: { expected: 4 } });
    expect(found[0].lossPerHour).toBe(250); // 6 × 500 € zwischen 7 und 19 Uhr / 12 Stunden
    expect(found[0].evidence).toMatchObject({ day: "2026-10-19", counts: [4, 4, 4, 4, 4, 4, 4, 4] });
  });

  it("keine Meldung: vor 15 Uhr, mit Bestellung heute, am Samstag, bei nur 3 erwarteten", () => {
    expect(orderGapDetections(gapHistory(), MONDAY(14, 59))).toEqual([]);
    expect(orderGapDetections([...gapHistory(), order("2026-10-19", 15)], MONDAY(15, 30))).toEqual([]);
    expect(orderGapDetections(gapHistory(), new Date("2026-10-24T15:30:00+02:00"))).toEqual([]);
    expect(orderGapDetections(gapHistory(3), MONDAY(15, 30))).toEqual([]);
  });

  it("bleibt am Abend bestehen, solange nichts kommt", () => {
    expect(orderGapDetections(gapHistory(), MONDAY(22, 0))).toHaveLength(1);
  });
});

describe("Zahlart verschwunden", () => {
  // 8 Wochen vor den letzten 7 Tagen: 13.10. ist der erste Tag des Fensters, Grundlage ab 18.08.
  const baseline = (method: string, perWeek: number) =>
    times(8, (w) => addDays("2026-08-18", 7 * w)).flatMap((weekStart) => times(perWeek, (i) => order(addDays(weekStart, i % 5), 10, 500, method)));

  it("sonst 4 pro Woche, 7 Tage keine: Warnung je Zahlart", () => {
    const orders = [...baseline("PayPal", 4), ...baseline("Rechnungskauf (30 Tage)", 13), order("2026-10-14", 10, 500, "Rechnungskauf (30 Tage)")];
    const found = paymentGoneDetections(orders, MONDAY(9));
    expect(found).toEqual([
      expect.objectContaining({ key: "revenue:payment:paypal", code: "paymentGone", severity: "warning", params: { method: "PayPal", perWeek: 4, days: 7 } }),
    ]);
    expect(found[0].evidence).toMatchObject({ baselineFrom: "2026-08-18", baselineOrders: 32, recentFrom: "2026-10-13" });
  });

  it("selten genutzte Zahlart (2 pro Woche) zählt nicht; Sonderzeichen im Schlüssel", () => {
    expect(paymentGoneDetections(baseline("Vorkasse", 2), MONDAY(9))).toEqual([]);
    expect(paymentGoneDetections(baseline("Kredit-/Debitkarte", 3), MONDAY(9))[0].key).toBe("revenue:payment:kredit-debitkarte");
  });

  it("eine Bestellung heute reicht", () => {
    expect(paymentGoneDetections([...baseline("PayPal", 4), order("2026-10-19", 8, 500, "PayPal")], MONDAY(9))).toEqual([]);
  });
});

describe("Woche gegen Vorwochen und Vorjahr", () => {
  // Fenster bis gestern (18.10.): aktuell 12.–18.10., davor 4 Wochen, Vorjahr 13.–19.10.2025
  const week = (to: string, n: number, total: number) => times(n, (i) => order(addDays(to, -(i % 7)), 10, total));
  const prev4 = (n = 20, total = 800) => [1, 2, 3, 4].flatMap((k) => week(addDays("2026-10-18", -7 * k), n, total));

  it("deutlich weniger Bestellungen und Umsatz, ohne Vorjahresdaten", () => {
    const found = weekComparisonDetections([...prev4(), ...week("2026-10-18", 8, 800)], MONDAY(9));
    expect(found.map((f) => f.code)).toEqual(["weekOrdersDown", "weekRevenueDown"]);
    expect(found[0].params).toMatchObject({ from: "2026-10-12", to: "2026-10-18", current: 8, expected: 20, pct: 60, yearOrders: 0 });
    expect(found[1].params).toMatchObject({ current: 6400, expected: 16000, pct: 60 });
  });

  it("Umsatz wie im Vorjahr: nur die Bestellungen werden gemeldet", () => {
    const yearAgo = week(addDays("2026-10-18", -364), 8, 800);
    const found = weekComparisonDetections([...prev4(), ...yearAgo, ...week("2026-10-18", 8, 800)], MONDAY(9));
    expect(found.map((f) => f.code)).toEqual(["weekOrdersDown"]);
    expect(found[0].params).toMatchObject({ yearOrders: 8, yearRevenue: 6400 });
  });

  it("gleich viele Bestellungen, halber Bestellwert: Ø-Bestellwert und Umsatz", () => {
    const found = weekComparisonDetections([...prev4(), ...week("2026-10-18", 20, 400)], MONDAY(9));
    expect(found.map((f) => f.code)).toEqual(["weekRevenueDown", "weekAovDown"]);
    expect(found[1].params).toMatchObject({ current: 400, expected: 800, pct: 50 });
  });

  it("Ø-Bestellwert: auch die Vorjahreswoche muss deutlich höher liegen", () => {
    const yearAgo = week(addDays("2026-10-18", -364), 10, 500);
    const found = weekComparisonDetections([...prev4(), ...yearAgo, ...week("2026-10-18", 20, 400)], MONDAY(9));
    expect(found.map((f) => f.code)).toEqual([]); // Umsatz 8.000 € gegen 5.000 € Vorjahr, Ø 400 € gegen 500 €
  });

  it("Umsatz nur 40 % unter den Vorwochen: noch kein Fund", () => {
    expect(weekComparisonDetections([...prev4(), ...week("2026-10-18", 16, 600)], MONDAY(9))).toEqual([]);
  });

  it("normale Schwankung und mehr Umsatz sind kein Fund", () => {
    expect(weekComparisonDetections([...prev4(), ...week("2026-10-18", 16, 700)], MONDAY(9))).toEqual([]);
    expect(weekComparisonDetections([...prev4(), ...week("2026-10-18", 40, 1200)], MONDAY(9))).toEqual([]);
  });
});

describe("Zahlen für den Tagesbericht", () => {
  it("Dienstag: gestern gegen die 4 Montage davor; ohne Vorjahr", () => {
    const orders = [order("2026-10-19", 9, 1000), order("2026-10-19", 11, 300), ...[1, 2, 3, 4].map((k) => order(addDays("2026-10-19", -7 * k), 10, 600))];
    const n = dailyNumbers(orders, new Date("2026-10-20T08:15:00+02:00"));
    expect(n).toEqual({
      period: "yesterday",
      days: ["2026-10-19"],
      current: { orders: 2, revenue: 1300, aov: 650 },
      previous4: { orders: 1, revenue: 600, aov: 600 },
      yearAgo: null,
    });
    expect(dailyNumbersLines(n).map(nb)).toEqual([
      "Gestern (19.10.2026): 2 Shop-Bestellung(en) · 1.300 € · Ø 650 €",
      "Schnitt der 4 Wochen davor: 1 Bestellung(en) · 600 €",
      "Vorjahr: keine Daten",
    ]);
  });

  it("Montag: das Wochenende, Vorjahr mit denselben Wochentagen", () => {
    const orders = [order("2026-10-17", 10, 500), order("2026-10-18", 12, 700), order(addDays("2026-10-17", -364), 10, 400)];
    const n = dailyNumbers(orders, MONDAY(8, 15));
    expect(n.period).toBe("weekend");
    expect(n.days).toEqual(["2026-10-17", "2026-10-18"]);
    expect(n.current).toEqual({ orders: 2, revenue: 1200, aov: 600 });
    expect(n.yearAgo).toEqual({ orders: 1, revenue: 400, aov: 400 });
    expect(nb(dailyNumbersLines(n)[0])).toBe("Wochenende (17.10.2026 bis 18.10.2026): 2 Shop-Bestellung(en) · 1.200 € · Ø 600 €");
  });
});

describe("Texte", () => {
  const sig = (code: ShopPulseSignal["code"], params: ShopPulseSignal["params"]) => ({ code, params });

  it("Beträge, Daten und Zahlen formatiert (Teams deutsch)", () => {
    const s = sig("weekRevenueDown", { from: "2026-10-12", to: "2026-10-18", current: 6400, expected: 16000, pct: 60, yearRevenue: 0, yearOrders: 0 });
    expect(signalTitle(s)).toBe("Deutlich weniger Shop-Umsatz (−60 %)");
    expect(nb(signalMessage(s))).toBe("12.10.2026 bis 18.10.2026: 6.400 € Umsatz, in den 4 Wochen davor im Schnitt 16.000 € pro Woche. Vorjahreswoche: 0 €.");
    expect(signalTitle(sig("paymentGone", { method: "PayPal", perWeek: 4, days: 7 }))).toBe("Zahlart „PayPal“ seit 7 Tagen ohne Bestellung");
    expect(signalTitle(sig("orderGap", { expected: 4 }))).toBe("Heute noch keine Shop-Bestellung");
  });

  it("Formatierung je Art; unbekannte Parameter bleiben", () => {
    const f = { money: (v: number) => `€${v}`, date: (d: string) => `D:${d}`, number: (v: number) => `#${v}` };
    expect(formatShopPulseParams("weekAovDown", { from: "2026-10-12", to: "2026-10-18", current: 400, expected: 800, pct: 50 }, f)).toEqual({
      from: "D:2026-10-12",
      to: "D:2026-10-18",
      current: "€400",
      expected: "€800",
      pct: 50,
    });
    expect(formatShopPulseParams("mirrorStale", { minutes: 31 }, f)).toEqual({ minutes: 31 });
  });

  it("Tagesbericht ohne offene Meldungen zeigt die Zahlen", () => {
    const n = dailyNumbers([order("2026-10-19", 9, 1000)], new Date("2026-10-20T08:15:00+02:00"));
    const texts = (buildShopPulseDailyCard([], new Date("2026-10-20T06:15:00Z"), null, n) as any).attachments[0].content.body.map((b: any) => nb(b.text));
    expect(texts).toEqual([
      "Shop-Puls: Tagesbericht vom 20.10.2026",
      "Gestern (19.10.2026): 1 Shop-Bestellung(en) · 1.000 € · Ø 1.000 €",
      "Schnitt der 4 Wochen davor: 0 Bestellung(en) · 0 €",
      "Vorjahr: keine Daten",
      "Keine offenen Meldungen.",
    ]);
  });
});

// -------------------------------------------------------------------------------------------------
// Lauf: Aussetzen bei hängendem Abgleich, Bestellungen einmal je Lauf, Tagesbericht mit Zahlen

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

function setup(now: Date, lastDeltaAt: Date, orders: PulseOrder[]) {
  const store = memoryStore();
  const rows: ShopPulseSignal[] = [];
  const loads: Date[] = [];
  const deps: ShopPulseDeps = {
    storage: {
      ...store,
      getAllTenants: async () => [{ id: "t1" }] as any,
      getShopwareSettings: async () => ({}) as any,
      getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
      createNotification: async (n: any) => ({ ...n, id: "n1", createdAt: new Date() }),
      getShopwareSyncState: async () => ({ status: "idle", error: null, lastDeltaAt, updatedAt: lastDeltaAt }) as any,
    } as any,
    repo: {
      listSignalsBySources: async (_t, sources) => structuredClone(rows.filter((r) => sources.includes(r.source))),
      listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
      applyReconcile: async (_t, result: ReconcileResult) => {
        rows.push(...structuredClone(result.inserts));
        for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
      },
    },
    detectors: [mirrorFreshnessDetector, orderGapDetector, paymentGoneDetector, weekComparisonDetector],
    loadOrders: async (_t, since) => {
      loads.push(since);
      return orders;
    },
    onNotificationCreated: () => undefined,
    baseUrl: null,
    now: () => now,
  };
  return { store, rows, loads, deps };
}

const WEBHOOK = "https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";

describe("Lauf mit Umsatz-Prüfungen", () => {
  it("Bestellungen einmal je Lauf geladen (gut 13 Monate); Bestell-Lücke und (letzte Rechnung vor 7 Tagen) Zahlart", async () => {
    const now = MONDAY(15, 30);
    const { deps, rows, loads, store } = setup(now, new Date(now.getTime() - 2 * 60000), gapHistory());
    await runShopPulseForTenant(deps, "t1");
    expect(loads).toHaveLength(1);
    expect(Math.round((now.getTime() - loads[0].getTime()) / 86400000)).toBe(400);
    expect(rows.map((r) => [r.key, r.status])).toEqual([
      ["revenue:order-gap", "open"],
      ["revenue:payment:rechnungskauf-30-tage", "open"],
    ]);
    expect((await getShopPulseState(store, "t1")).detectors).toMatchObject({
      mirrorFreshness: { ok: true, findings: 0 },
      orderGap: { ok: true, findings: 1 },
      paymentGone: { ok: true, findings: 1 },
      weekComparison: { ok: true, findings: 0 },
    });
  });

  it("Abgleich hängt: Umsatz-Prüfungen setzen aus, offene Umsatz-Meldung bleibt offen, keine Zahlen im Bericht", async () => {
    const now = new Date("2026-10-20T08:15:00+02:00"); // Dienstag, Tagesbericht fällig
    const { deps, rows, loads, store } = setup(now, new Date(now.getTime() - 60 * 60000), gapHistory());
    rows.push({
      id: "gap",
      key: "revenue:order-gap",
      source: "revenue",
      code: "orderGap",
      severity: "warning",
      status: "open",
      params: { expected: 4 },
      evidence: {},
      lossPerHour: 250,
      firstSeenAt: "2026-10-19T13:30:00.000Z",
      lastSeenAt: "2026-10-19T21:45:00.000Z",
      resolvedAt: null,
      resolvedBy: null,
      mutedUntil: null,
      notifiedAt: null,
      notifiedSeverity: "warning",
    });
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-12T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");
    const run = await runShopPulseForTenant(deps, "t1");
    expect(loads).toEqual([]);
    expect(rows.find((r) => r.id === "gap")?.status).toBe("open");
    expect((await getShopPulseState(store, "t1")).detectors).toMatchObject({
      orderGap: { skipped: "mirror" },
      paymentGone: { skipped: "mirror" },
      weekComparison: { skipped: "mirror" },
    });
    expect(run?.dailyReport).toEqual({ sent: true, signals: 2, numbers: false });
  });

  it("Tagesbericht mit Zahlen auch ohne offene Meldungen", async () => {
    const now = new Date("2026-10-20T08:15:00+02:00");
    const { deps, store } = setup(now, new Date(now.getTime() - 60000), [order("2026-10-19", 9, 1000)]);
    await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-12T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");
    const run = await runShopPulseForTenant(deps, "t1");
    expect(run?.dailyReport).toEqual({ sent: true, signals: 0, numbers: true });
    const cards = await getTeamsOutbox(store, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", now);
    expect(cards).toHaveLength(1);
    expect(nb((cards[0].message as any).attachments[0].content.body[1].text)).toBe("Gestern (19.10.2026): 1 Shop-Bestellung(en) · 1.000 € · Ø 1.000 €");
  });
});
