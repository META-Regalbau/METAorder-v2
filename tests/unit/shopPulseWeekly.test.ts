/**
 * Shop-Puls Stufe 2 (S2-1), Wochenbericht: Zeitpunkt Montag, Wochenzahlen mit Deckungsbeitrag, Top 5 Hebel,
 * offen je Zuständigem, KI-Text mit Zahlenabgleich und Rückfall auf die Vorlage, Lauf mit simulierter
 * Datenbank (montags statt Tagesbericht, Lernwoche, Rückfall auf den Tagesbericht).
 * Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  berlinMidnight,
  isWeeklyReportDue,
  rankLevers,
  reportedWeekStart,
  WEEK_BUSINESS_HOURS,
  weekFigures,
  weeklyAiText,
  weeklyNumbers,
  weeklyPayload,
  weeklyReportData,
} from "../../server/shopPulse/weeklyReport";
import { buildWeeklyReport, type ShopPulseWeeklyDeps } from "../../server/shopPulse/weeklyReportRun";
import { buildShopPulseWeeklyCard, weeklyNumbersLines } from "../../server/shopPulse/shopPulseNotify";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { getShopPulseState, SHOP_PULSE_SETTINGS_KEY, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "../../server/shopPulse/shopPulseSettings";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import { mirrorFreshnessDetector } from "../../server/shopPulse/detectors/mirrorFreshness";
import type { PulseOrder } from "../../server/shopPulse/pulseOrders";
import type { ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import { berlinTime } from "../../server/shopPulse/pulseOrders";
import { isoWeekOf, type ShopPulseAction, type ShopPulseWeeklyReport, type ShopPulseWeeklyReportData } from "../../shared/shopPulseWeekly";
import type { ShopPulseSignal } from "../../shared/shopPulse";

const WEBHOOK = "https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";
const MONDAY = new Date("2026-10-19T06:15:00Z"); // Montag, 8:15 Berlin
const nb = (s: string) => s.replace(/ /g, " ");

function order(day: string, total: number, items: Array<[string, number, number]> = []): PulseOrder {
  const createdAt = new Date(`${day}T10:00:00Z`);
  const { hour } = berlinTime(createdAt);
  return { orderNumber: `MO${day}${total}`, createdAt, day, hour, total, paymentMethod: "PayPal", items: items.map(([productNumber, quantity, netTotal]) => ({ productNumber, quantity, netTotal })) };
}

const signal = (over: Partial<ShopPulseSignal> = {}): ShopPulseSignal => ({
  id: "s1",
  key: "buyability:product:inactive:A1",
  source: "buyability",
  code: "topsellerInactive",
  severity: "critical",
  status: "open",
  params: { number: "A1", name: "Fachbodenregal", revenue: 50000 },
  evidence: {},
  lossPerHour: 10,
  firstSeenAt: "2026-10-15T05:00:00.000Z",
  lastSeenAt: "2026-10-19T05:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  mutedUntil: null,
  notifiedAt: null,
  notifiedSeverity: "critical",
  ...over,
});

const action = (over: Partial<ShopPulseAction> = {}): ShopPulseAction => ({
  id: "a1",
  occurredAt: "2026-10-16T08:13:52.000Z",
  kind: "contentPublish",
  title: "Live veröffentlicht: KFZ-Werkstatt (Version 3)",
  description: "",
  scope: { type: "pages", values: ["/branchen/kfz-werkstatt-reifenhandel"] },
  source: "shopContent",
  sourceKey: "content:p1",
  actor: "Oliver",
  createdBy: null,
  createdAt: "2026-10-16T08:14:00.000Z",
  updatedAt: "2026-10-16T08:14:00.000Z",
  ...over,
});

describe("Zeitpunkt", () => {
  it("berichtet die abgeschlossene Woche Montag bis Sonntag", () => {
    expect(reportedWeekStart(MONDAY)).toBe("2026-10-12");
    expect(reportedWeekStart(new Date("2026-10-18T20:00:00Z"))).toBe("2026-10-05"); // Sonntag 22 Uhr
    expect(reportedWeekStart(new Date("2026-10-18T22:30:00Z"))).toBe("2026-10-12"); // Montag 0:30 Berlin
    expect(isoWeekOf("2026-10-12")).toBe(42);
    expect(isoWeekOf("2026-12-28")).toBe(53);
    expect(isoWeekOf("2027-01-01")).toBe(53);
  });

  it("montags 8 bis 12 Uhr Berlin, einmal je Woche", () => {
    expect(isWeeklyReportDue({}, new Date("2026-10-19T05:59:00Z"))).toBe(false); // 7:59
    expect(isWeeklyReportDue({}, new Date("2026-10-19T06:00:00Z"))).toBe(true); // 8:00
    expect(isWeeklyReportDue({}, new Date("2026-10-19T10:00:00Z"))).toBe(false); // 12:00
    expect(isWeeklyReportDue({}, new Date("2026-10-20T06:00:00Z"))).toBe(false); // Dienstag
    expect(isWeeklyReportDue({ lastWeeklyReportWeek: "2026-10-12" }, MONDAY)).toBe(false);
    expect(isWeeklyReportDue({ lastWeeklyReportWeek: "2026-10-05" }, MONDAY)).toBe(true);
    // Winterzeit: 8 Uhr Berlin = 7 Uhr UTC
    expect(isWeeklyReportDue({}, new Date("2026-11-02T06:59:00Z"))).toBe(false);
    expect(isWeeklyReportDue({}, new Date("2026-11-02T07:00:00Z"))).toBe(true);
  });

  it("Mitternacht in Berlin, Sommer und Winter", () => {
    expect(berlinMidnight("2026-10-12").toISOString()).toBe("2026-10-11T22:00:00.000Z");
    expect(berlinMidnight("2026-11-02").toISOString()).toBe("2026-11-01T23:00:00.000Z");
  });
});

describe("Wochenzahlen", () => {
  const orders = [
    order("2026-10-12", 1190, [["A1", 2, 600], ["B2", 1, 400]]),
    order("2026-10-18", 595, [["C3", 1, 500]]),
    order("2026-10-19", 9999), // nächste Woche
    order("2026-10-05", 800, [["A1", 1, 300]]),
    order("2025-10-13", 400), // Vorjahr (364 Tage davor)
  ];
  const hk = new Map([["A1", 200], ["B2", 300]]);

  it("Bestellungen, Umsatz, Ø und Deckungsbeitrag wie in der Bestellliste (nur Positionen mit Herstellpreis)", () => {
    const f = weekFigures(orders, "2026-10-12", (pn) => hk.get(pn) ?? null);
    // DB = (600 − 2 × 200) + (400 − 300) = 300, Umsatz mit HK 1.000 von 1.500 netto
    expect(f).toEqual({ from: "2026-10-12", to: "2026-10-18", orders: 2, revenue: 1785, aov: 892.5, db1: 300, db1CoveragePercent: 66.7 });
    expect(weekFigures(orders, "2026-10-12", null)).toMatchObject({ db1: null, db1CoveragePercent: null });
    expect(weekFigures(orders, "2026-10-12", () => null)).toMatchObject({ db1: null });
  });

  it("Vorwoche und Vorjahr; ohne Bestellungen im Vorjahr keine Daten", () => {
    const n = weeklyNumbers(orders, "2026-10-12", (pn) => hk.get(pn) ?? null);
    expect(n.previous).toMatchObject({ from: "2026-10-05", orders: 1, revenue: 800, db1: 100 });
    expect(n.yearAgo).toMatchObject({ from: "2025-10-13", orders: 1, revenue: 400 });
    expect(weeklyNumbers(orders.slice(0, 4), "2026-10-12", null).yearAgo).toBeNull();
    expect(weeklyNumbersLines(n).map(nb)).toEqual([
      "Woche: 2 Shop-Bestellung(en) · 1.785 € · Ø 893 €",
      "Deckungsbeitrag: 300 € (aus 66,7 % des Artikelumsatzes mit Herstellpreis)",
      "Vorwoche: 1 Bestellung(en) · 800 € · Ø 800 € · diese Woche dagegen: Bestellungen +100 %, Umsatz +123 %",
      "Vorjahr: 1 Bestellung(en) · 400 € · Ø 400 € · diese Woche dagegen: Bestellungen +100 %, Umsatz +346 %",
      "Besucher und Conversion: GA4 ist nicht eingerichtet.",
    ]);
  });
});

describe("Hebel und Zuständige", () => {
  const signals = [
    signal(),
    signal({ id: "s2", key: "ga4:search:no-hits", source: "ga4", code: "ga4SearchNoHits", severity: "warning", params: { date: "2026-10-18", count: 3, terms: "x, y, z", searches: 12 }, lossPerHour: null }),
    signal({ id: "s3", key: "revenue:payment:paypal", source: "revenue", code: "paymentGone", severity: "warning", params: { method: "PayPal", perWeek: 4, days: 7 }, lossPerHour: null }),
    signal({ id: "s4", key: "buyability:product:sold-out:B2", code: "topsellerSoldOut", params: { number: "B2", name: "Palettenregal", revenue: 9000 }, lossPerHour: 2, mutedUntil: "2026-10-25T00:00:00.000Z" }),
    signal({ id: "s5", key: "buyability:product:inactive:Z9", status: "resolved" }),
  ];
  const estimates = new Map([["s3", { perHour: 30, basis: "paymentShare" as const }]]);

  it("größter Betrag je Woche zuerst, ohne Schätzung hinten; ruhig gestellte und erledigte nicht", () => {
    const levers = rankLevers(signals, estimates, MONDAY);
    expect(levers.map((l) => [l.signalId, l.perWeek, l.owner, l.step])).toEqual([
      ["s3", 30 * WEEK_BUSINESS_HOURS, "agency", "payment"],
      ["s1", 10 * WEEK_BUSINESS_HOURS, "pim", "product"],
      ["s2", null, "marketing", "search"],
    ]);
    expect(levers[1]).toMatchObject({ basis: "detector", perHour: 10 });
  });

  it("Bericht: Top 5, Summe, Erledigt der Woche, offen je Zuständigem mit Text zum Weiterleiten", () => {
    const many = [...signals, ...Array.from({ length: 6 }, (_, i) => signal({ id: `m${i}`, key: `k${i}`, params: { number: `M${i}`, name: "Regal", revenue: 1 }, lossPerHour: 1 }))];
    const data = weeklyReportData({ numbers: null, signals: many, estimates, actions: [action(), action({ id: "a0", occurredAt: "2026-10-12T07:00:00.000Z", title: "Kampagne pausiert", kind: "manual" })], now: MONDAY });
    expect(data.levers).toHaveLength(5);
    expect(data.openCount).toBe(9);
    expect(data.leversPerWeek).toBe((30 + 10 + 1 + 1 + 1) * WEEK_BUSINESS_HOURS);
    expect(data.done.map((d) => d.id)).toEqual(["a0", "a1"]);
    expect(data.openByOwner.map((o) => [o.owner, o.items.length])).toEqual([["agency", 1], ["marketing", 1], ["pim", 7]]);
    const agency = nb(data.openByOwner[0].text);
    expect(agency).toContain("Shop-Puls: offen für Agentur wirduzen (1)");
    expect(agency).toContain("geschätzt rund 2.520 € je Woche");
    expect(agency).toContain("Nächster Schritt: Zahl- bzw. Versandart im Kanal META Regalbau DE prüfen und wieder aktivieren lassen.");
  });

  it("Teams-Karte: Titel mit KW, Zahlen fehlen bei hängendem Abgleich, Hebel, Erledigt, Zuständige", () => {
    const data = weeklyReportData({ numbers: null, signals, estimates, actions: [action()], now: MONDAY });
    const report: ShopPulseWeeklyReport = { id: "r1", weekStart: "2026-10-12", weekEnd: "2026-10-18", isoWeek: 42, createdAt: MONDAY.toISOString(), sentAt: null, data, ai: null };
    const texts = (buildShopPulseWeeklyCard(report, "https://app.example") as any).attachments[0].content.body.map((b: any) => nb(b.text));
    expect(texts[0]).toBe("Shop-Puls: Wochenbericht KW 42 (12.10.2026 bis 18.10.2026)");
    expect(texts).toContain("Keine Zahlen: Der Bestellabgleich hängt.");
    expect(texts.some((t: string) => t.startsWith("1. 🟡 ") && t.includes("rund 2.520 € je Woche"))).toBe(true);
    expect(texts).toContain("Erledigt letzte Woche (1)");
    expect(texts.some((t: string) => t.includes("Live veröffentlicht: KFZ-Werkstatt (Version 3) (Seiten: /branchen/kfz-werkstatt-reifenhandel · Oliver)"))).toBe(true);
    expect(texts).toContain("Agentur wirduzen (1)");
    const actions = (buildShopPulseWeeklyCard(report, "https://app.example") as any).attachments[0].content.actions;
    expect(actions[0].url).toBe("https://app.example/admin/shop-puls?tab=weekly&week=2026-10-12");
  });
});

describe("KI-Text", () => {
  const data: ShopPulseWeeklyReportData = weeklyReportData({
    numbers: weeklyNumbers([order("2026-10-12", 1000), order("2026-10-13", 800), order("2026-10-06", 900)], "2026-10-12", null),
    signals: [signal()],
    estimates: new Map(),
    actions: [action()],
    now: MONDAY,
  });
  const answer = (o: Record<string, string>) => async () => JSON.stringify(o);

  it("Zahlen aus den Eingabedaten: Text übernommen", async () => {
    const r = await weeklyAiText(
      data,
      MONDAY,
      answer({ zusammenfassung: "2 Bestellungen mit 1.800 € Umsatz, 100 % mehr Bestellungen als in der Vorwoche. Größter Hebel: geschätzt 840 € je Woche.", naechsterSchritt: "Jana (PIM) prüft den Artikel A1." }),
    );
    expect(r).toEqual({ text: "2 Bestellungen mit 1.800 € Umsatz, 100 % mehr Bestellungen als in der Vorwoche. Größter Hebel: geschätzt 840 € je Woche.\nNächster Schritt: Jana (PIM) prüft den Artikel A1." });
    expect(weeklyPayload(data, MONDAY)).toMatchObject({ summeTop5JeWoche: 840 });
  });

  it("erfundene Zahl, leere Antwort, Fehler, Zeitüberschreitung: Vorlage (text null)", async () => {
    expect(await weeklyAiText(data, MONDAY, answer({ zusammenfassung: "Umsatz +35 % zur Vorwoche." }))).toMatchObject({ text: null, rejected: "number", badNumbers: ["35"] });
    expect(await weeklyAiText(data, MONDAY, answer({ naechsterSchritt: "x" }))).toMatchObject({ text: null, rejected: "empty" });
    expect(
      await weeklyAiText(data, MONDAY, async () => {
        throw new Error("down");
      }),
    ).toMatchObject({ text: null, rejected: "error" });
    expect(await weeklyAiText(data, MONDAY, () => new Promise(() => undefined), 20)).toMatchObject({ text: null, rejected: "timeout" });
  });

  it("buildWeeklyReport: ohne KI kein Text, mit verworfenem Text die Notiz mit Grund", async () => {
    const deps = weeklyDeps();
    const input = { tenantId: "t1", now: MONDAY, mirrorStale: false, openSignals: [signal()], estimateFor: async () => null };
    expect((await buildWeeklyReport(deps, { ...input, ai: null })).ai).toBeNull();
    const ai = { configured: async () => true, ask: async () => JSON.stringify({ zusammenfassung: "Umsatz 99.999 €" }), saveNote: async () => undefined, deploys: async () => [], priceChanges: async () => [] };
    const built = await buildWeeklyReport(deps, { ...input, ai });
    expect(built.ai).toMatchObject({ text: null, rejected: "number" });
    expect(built.data.done.map((d) => d.id)).toEqual(["a1"]);
    expect(deps.calls.listActions[1]).toEqual(["2026-10-11T22:00:00.000Z", "2026-10-18T22:00:00.000Z"]);
    expect(deps.calls.sync).toBe(2);
    expect(built.data.numbers?.current).toMatchObject({ orders: 1, db1: 100 });
  });
});

// -------------------------------------------------------------------------------------------------
// Lauf mit simulierter Datenbank

function weeklyDeps(over: Partial<ShopPulseWeeklyDeps> = {}) {
  const saved: ShopPulseWeeklyReport[] = [];
  const calls = { listActions: [] as string[][], sync: 0 };
  const deps: ShopPulseWeeklyDeps = {
    loadOrders: async () => [order("2026-10-13", 595, [["A1", 1, 500]])],
    herstellpreise: async () => new Map([["A1", 400]]),
    ga4: async () => null,
    syncActions: async () => void calls.sync++,
    listActions: async (_t, from, to) => {
      calls.listActions.push([from.toISOString(), to.toISOString()]);
      return [action()];
    },
    saveReport: async (_t, r) => {
      const report: ShopPulseWeeklyReport = { id: `r${saved.length + 1}`, weekStart: r.weekStart, weekEnd: "2026-10-18", isoWeek: isoWeekOf(r.weekStart), createdAt: MONDAY.toISOString(), sentAt: r.sentAt?.toISOString() ?? null, data: r.data, ai: r.ai };
      saved.push(report);
      return report;
    },
    ...over,
  };
  return Object.assign(deps, { saved, calls });
}

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

describe("Lauf: montags Wochenbericht statt Tagesbericht", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  function setup(weekly?: ReturnType<typeof weeklyDeps>) {
    const store = memoryStore();
    const rows: ShopPulseSignal[] = [signal()];
    const notifications: any[] = [];
    let now = MONDAY;
    const synced: string[] = [];
    const deps: ShopPulseDeps = {
      storage: {
        ...store,
        getAllTenants: async () => [{ id: "t1" }] as any,
        getShopwareSettings: async () => ({}) as any,
        getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
        createNotification: async (n: any) => {
          notifications.push(n);
          return { ...n, id: `n${notifications.length}`, createdAt: new Date() };
        },
        getShopwareSyncState: async () => ({ status: "idle", error: null, lastDeltaAt: new Date(now.getTime() - 60_000), updatedAt: new Date() }) as any,
      } as any,
      repo: {
        listSignalsBySources: async (_t, sources) => structuredClone(rows.filter((r) => sources.includes(r.source))),
        listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
        applyReconcile: async (_t: string | null, result: ReconcileResult) => void rows.push(...structuredClone(result.inserts)),
      },
      detectors: [mirrorFreshnessDetector],
      loadOrders: async () => [],
      weekly,
      syncActions: async (t) => void synced.push(String(t)),
      onNotificationCreated: () => undefined,
      baseUrl: "https://app.example",
      now: () => now,
    };
    const outbox = async () => (await getTeamsOutbox(store, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", now)).map((i) => nb((i.message as any).attachments[0].content.body[0].text as string));
    return { store, deps, notifications, outbox, synced, setNow: (d: Date) => (now = d) };
  }
  const enable = (store: ReturnType<typeof memoryStore>, learningUntil = "2026-10-12T00:00:00Z") =>
    store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil, teamsWebhookUrl: WEBHOOK }, "t1");

  it("Montag 8:15: Wochenbericht über Teams und Glocke, archiviert, kein Tagesbericht; einmal je Woche", async () => {
    const weekly = weeklyDeps();
    const { store, deps, notifications, outbox, synced, setNow } = setup(weekly);
    await enable(store);
    const run = await runShopPulseForTenant(deps, "t1");
    expect(run?.weeklyReport).toEqual({ sent: true, weekStart: "2026-10-12", levers: 1, numbers: true });
    expect(run?.dailyReport).toBeNull();
    expect(await outbox()).toEqual(["Shop-Puls: Wochenbericht KW 42 (12.10.2026 bis 18.10.2026)"]);
    expect(notifications).toEqual([expect.objectContaining({ type: "shop_pulse", title: "Shop-Puls: Wochenbericht KW 42", link: "/admin/shop-puls?tab=weekly&week=2026-10-12" })]);
    expect(weekly.saved[0]).toMatchObject({ weekStart: "2026-10-12", sentAt: MONDAY.toISOString() });
    expect(synced).toEqual(["t1"]);
    expect(await getShopPulseState(store, "t1")).toMatchObject({ lastWeeklyReportWeek: "2026-10-12", lastDailyReportDay: "2026-10-19" });

    setNow(new Date("2026-10-19T06:30:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toHaveLength(1);
    expect(weekly.saved).toHaveLength(1);

    // Dienstag: wieder der Tagesbericht
    setNow(new Date("2026-10-20T06:15:00Z"));
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toEqual(["Shop-Puls: Wochenbericht KW 42 (12.10.2026 bis 18.10.2026)", "Shop-Puls: Tagesbericht vom 20.10.2026"]);
  });

  it("Lernwoche: nur ins Archiv, nichts senden", async () => {
    const weekly = weeklyDeps();
    const { store, deps, notifications, outbox } = setup(weekly);
    await enable(store, "2026-10-26T00:00:00Z");
    const run = await runShopPulseForTenant(deps, "t1");
    expect(run?.weeklyReport).toMatchObject({ sent: false });
    expect(weekly.saved[0]).toMatchObject({ sentAt: null, ai: null });
    expect(await outbox()).toEqual([]);
    expect(notifications).toEqual([]);
  });

  it("ausgeschaltet: kein Wochenbericht", async () => {
    const weekly = weeklyDeps();
    const { deps } = setup(weekly);
    const run = await runShopPulseForTenant(deps, "t1");
    expect(run?.weeklyReport).toBeNull();
    expect(weekly.saved).toEqual([]);
  });

  it("Wochenbericht scheitert: Tagesbericht wie bisher, kein zweiter Versuch in dieser Woche", async () => {
    const weekly = weeklyDeps({
      listActions: async () => {
        throw new Error("db down");
      },
    });
    const { store, deps, outbox } = setup(weekly);
    await enable(store);
    const run = await runShopPulseForTenant(deps, "t1");
    expect(run?.weeklyReport).toBeNull();
    expect(run?.dailyReport).toMatchObject({ sent: true });
    expect(await outbox()).toEqual(["Shop-Puls: Tagesbericht vom 19.10.2026"]);
    expect((await getShopPulseState(store, "t1")).lastWeeklyReportWeek).toBe("2026-10-12");
  });

  it("ohne Wochenbericht-Anbindung bleibt es montags beim Tagesbericht", async () => {
    const { store, deps, outbox } = setup(undefined);
    await enable(store);
    await runShopPulseForTenant(deps, "t1");
    expect(await outbox()).toEqual(["Shop-Puls: Tagesbericht vom 19.10.2026"]);
  });
});
