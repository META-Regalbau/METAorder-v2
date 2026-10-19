/**
 * Shop-Puls Stufe 3 (S3-4): Stammkunden-Wache – Bestelltage und üblicher Abstand, Schwellen (3 Bestelltage,
 * 2.000 € im Jahr, Doppeltes des Abstands, Mindesttage), durchgeschleuste Bestellungen, Ursachen (Preis,
 * Lieferbarkeit), Empfänger (Außendienst sonst Oliver), 90-Tage-Regel, Altbestand beim ersten Lauf, Erfolg nach
 * der Meldung, Lauf mit simulierten Quellen.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { analyzeRegulars, deliveryMaxDays, isPassthroughOrder, regularAlertLines, regularCauses, type RegularOrder } from "../../server/shopPulse/regulars";
import { isRegularsDue, mayAlert, regularRecipient, regularState, runRegulars, type RegularDeps, type RegularRow } from "../../server/shopPulse/regularsRun";
import { DEFAULT_SHOP_PULSE_REGULAR_SETTINGS, normalizeRegularSettings } from "../../shared/shopPulseRegulars";

const NOW = new Date("2026-10-19T08:00:00Z"); // Montag 10 Uhr
const S = DEFAULT_SHOP_PULSE_REGULAR_SETTINGS;
let n = 0;
const order = (customerNumber: string, day: string, net = 1000, over: Partial<RegularOrder> = {}): RegularOrder => ({
  orderNumber: `MO${++n}`,
  customerNumber,
  company: `Firma ${customerNumber}`,
  contactName: "Max Kunde",
  customerEmail: "einkauf@firma.de",
  createdAt: new Date(`${day}T09:00:00Z`),
  status: "completed",
  net,
  items: [{ productNumber: "4026212000382", name: "CLIP Ständerrahmen", quantity: 2, netTotal: net * 0.6 }, { productNumber: "4026212003260", name: "MULTIPAL Tiefenauflage", quantity: 1, netTotal: net * 0.4 }],
  ...over,
});

/** Kunde A bestellt alle 6 Wochen, zuletzt vor 12 Wochen (Beispiel aus dem Konzept) */
const A = ["2026-03-02", "2026-04-13", "2026-05-25", "2026-07-06", "2026-07-27"].map((d) => order("A", d));

describe("Kennzahlen und Schwellen", () => {
  it("üblicher Abstand = Median der Abstände zwischen Bestelltagen; überfällig ab dem Doppelten", () => {
    const [a] = analyzeRegulars(A, NOW, S);
    expect(a).toMatchObject({ customerNumber: "A", orders: 5, usualGapDays: 42, daysSinceLast: 84, annualRevenue: 5000, overdue: false });
    const [b] = analyzeRegulars(A.slice(0, 4), NOW, S); // zuletzt 06.07. → 105 Tage > 2 × 42
    expect(b.overdue).toBe(true);
    expect(b.lastItems.map((i) => i.productNumber)).toEqual(["4026212000382", "4026212003260"]);
    expect(b.regularItems[0]).toEqual({ productNumber: "4026212000382", name: "CLIP Ständerrahmen", days: 4 });
  });

  it("mehrere Bestellungen am selben Tag zählen als ein Bestelltag; unter 3 Tagen oder 2.000 € nicht dabei", () => {
    const sameDay = [order("B", "2026-06-01"), order("B", "2026-06-01"), order("B", "2026-06-15")];
    expect(analyzeRegulars(sameDay, NOW, S)).toEqual([]);
    const small = ["2026-06-01", "2026-07-01", "2026-08-01"].map((d) => order("C", d, 500));
    expect(analyzeRegulars(small, NOW, S)).toEqual([]);
    expect(analyzeRegulars(small, NOW, { ...S, minAnnualRevenue: 1000 })).toHaveLength(1);
  });

  it("wöchentliche Kunden erst nach den Mindesttagen", () => {
    const weekly = ["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"].map((d) => order("D", d));
    expect(analyzeRegulars(weekly, NOW, S)[0]).toMatchObject({ usualGapDays: 7, daysSinceLast: 21, overdue: false });
    expect(analyzeRegulars(weekly, NOW, { ...S, minDaysSinceLast: 0 })[0].overdue).toBe(true);
  });

  it("ohne stornierte und ohne durchgeschleuste Bestellungen (Muster-Kunden)", () => {
    expect(isPassthroughOrder({ contactName: "Max Mustermann - DE", customerEmail: "", company: "" })).toBe(true);
    expect(isPassthroughOrder({ contactName: "x", customerEmail: "musterkunde-de2@meta-online.com", company: "" })).toBe(true);
    const list = [...A.slice(0, 4), order("A", "2026-10-01", 1000, { status: "cancelled" }), order("A", "2026-10-02", 1000, { contactName: "Max Mustermann - DE" })];
    expect(analyzeRegulars(list, NOW, S)[0].overdue).toBe(true);
  });

  it("Einstellungen: Standard und Grenzen", () => {
    expect(normalizeRegularSettings(undefined)).toEqual(S);
    expect(normalizeRegularSettings({ minOrders: 5, overdueFactor: 0.5 })).toEqual(S);
    expect(normalizeRegularSettings({ minOrders: 5 })).toEqual({ ...S, minOrders: 5 });
  });
});

describe("Ursachen und Text", () => {
  const [a] = analyzeRegulars(A.slice(0, 4), NOW, S);
  it("Preis eines Stammartikels seit der letzten Bestellung ≥ 5 % gestiegen; Lieferbarkeit", () => {
    const causes = regularCauses(
      a,
      [
        { productNumber: "4026212000382", oldPriceGross: 100, newPriceGross: 104, changedAt: new Date("2026-08-01T00:00:00Z") },
        { productNumber: "4026212000382", oldPriceGross: 104, newPriceGross: 112, changedAt: new Date("2026-09-01T00:00:00Z") },
        { productNumber: "4026212003260", oldPriceGross: 50, newPriceGross: 60, changedAt: new Date("2026-06-01T00:00:00Z") },
      ],
      new Map([
        ["4026212000382", { name: "CLIP Ständerrahmen", sellable: true, restockTime: null, deliveryTimeMaxDays: 5 }],
        ["4026212003260", { name: "MULTIPAL Tiefenauflage", sellable: true, restockTime: 35, deliveryTimeMaxDays: 5 }],
      ]),
    );
    expect(causes).toEqual([
      { kind: "price", productNumber: "4026212000382", name: "CLIP Ständerrahmen", oldPrice: 100, newPrice: 112, percent: 12, changedAt: "2026-09-01T00:00:00.000Z" },
      { kind: "delivery", productNumber: "4026212003260", name: "MULTIPAL Tiefenauflage", detail: "longRestock", days: 35 },
    ]);
    const lines = regularAlertLines({ ...a, causes });
    expect(lines[0]).toContain("bestellt sonst etwa alle 42 Tage, zuletzt am 06.07.2026 – seit 105 Tagen nichts mehr");
    expect(lines.find((l) => l.startsWith("Mögliche Ursache"))).toMatch(/\+12 %.*Wiederauffüllzeit 35 Tage/);
    expect(lines[lines.length - 1]).toContain("keine automatische Mail an den Kunden");
  });

  it("Lieferzeit in Tagen", () => {
    expect(deliveryMaxDays(3, "week")).toBe(21);
    expect(deliveryMaxDays(10, "day")).toBe(10);
    expect(deliveryMaxDays(null, "day")).toBeNull();
  });
});

describe("Regeln", () => {
  const row = (over: Partial<RegularRow> = {}): RegularRow => ({ customerNumber: "A", backlog: false, alertedAt: null, alertLastOrderAt: null, recipient: null, recipientSource: null, wonAt: null, wonOrderNumber: null, ...over });
  const overdue = { overdue: true, lastOrderAt: "2026-07-06T09:00:00Z" };

  it("höchstens eine Meldung in 90 Tagen; Altbestand nur von Hand", () => {
    expect(mayAlert(overdue, undefined, NOW)).toBe(true);
    expect(mayAlert(overdue, row({ alertedAt: new Date("2026-08-01T00:00:00Z") }), NOW)).toBe(false);
    expect(mayAlert(overdue, row({ alertedAt: new Date("2026-07-01T00:00:00Z") }), NOW)).toBe(true);
    expect(mayAlert(overdue, row({ backlog: true }), NOW)).toBe(false);
    expect(mayAlert(overdue, row({ backlog: true }), NOW, true)).toBe(true);
    expect(mayAlert({ overdue: false }, undefined, NOW, true)).toBe(false);
  });

  it("Zustand: ok, überfällig, Altbestand, gemeldet, wieder bestellt", () => {
    expect(regularState({ overdue: false, lastOrderAt: "2026-10-01T00:00:00Z" }, undefined)).toBe("ok");
    expect(regularState(overdue, undefined)).toBe("overdue");
    expect(regularState(overdue, row({ backlog: true }))).toBe("backlog");
    expect(regularState(overdue, row({ alertedAt: new Date("2026-10-10T00:00:00Z") }))).toBe("alerted");
    expect(regularState({ overdue: false, lastOrderAt: "2026-10-15T00:00:00Z" }, row({ alertedAt: new Date("2026-10-10T00:00:00Z"), wonAt: new Date("2026-10-15T00:00:00Z") }))).toBe("won");
  });

  it("Empfänger: Außendienst laut Zuordnung, sonst Oliver; täglich Mo–Fr ab 8 Uhr", () => {
    const reps = new Map([["A", { name: "Max Außendienst", email: "max@meta-online.com" }]]);
    expect(regularRecipient("a", reps)).toEqual({ name: "Max Außendienst", email: "max@meta-online.com", source: "rep" });
    expect(regularRecipient("B", reps)).toEqual({ name: "Oliver", email: null, source: "oliver" });
    expect(isRegularsDue({}, NOW)).toBe(true);
    expect(isRegularsDue({ lastRunDay: "2026-10-19" }, NOW)).toBe(false);
    expect(isRegularsDue({}, new Date("2026-10-18T08:00:00Z"))).toBe(false); // Sonntag
    expect(isRegularsDue({}, new Date("2026-10-19T05:00:00Z"))).toBe(false); // 7 Uhr
  });
});

describe("Lauf", () => {
  function deps(orders: RegularOrder[], rows: RegularRow[] = [], settings: Record<string, unknown> = {}) {
    const store = new Map<string, unknown>([["shop_pulse_regular_settings", settings]]);
    const saved = new Map(rows.map((r) => [r.customerNumber, r]));
    const sent = { mails: [] as string[], teams: 0, bells: 0, actions: [] as string[] };
    const d: RegularDeps = {
      storage: { getSetting: async (k: string) => store.get(k), saveSetting: async (k: string, v: unknown) => void store.set(k, v) } as any,
      loadOrders: async () => orders,
      products: async () => new Map(),
      priceChanges: async () => [],
      salesReps: async () => new Map([["A", { name: "Max Außendienst", email: "max@meta-online.com" }]]),
      rows: async () => Array.from(saved.values()),
      saveRow: async (_t, r) => void saved.set(r.customerNumber, r),
      sendMail: async (_t, to) => void sent.mails.push(to),
      enqueueTeams: async () => void sent.teams++,
      notify: async () => void sent.bells++,
      insertActions: async (_t, c) => void sent.actions.push(...c.map((x) => x.kind)),
      pageUrl: null,
    };
    return { d, store, saved, sent };
  }
  const overdueOrders = [...A.slice(0, 4), ...["2026-05-04", "2026-06-01", "2026-06-29"].map((d) => order("E", d))];

  it("erster Lauf: überfällige als Altbestand, nichts gesendet", async () => {
    const { d, saved, sent } = deps(overdueOrders);
    expect(await runRegulars(d, null, NOW, { silent: false })).toMatchObject({ customers: 2, overdue: 2, alerts: 0, backlog: 2 });
    expect(sent).toEqual({ mails: [], teams: 0, bells: 0, actions: [] });
    expect(saved.get("A")?.backlog).toBe(true);
  });

  it("späterer Lauf: neu überfällige melden (Mail an den Außendienst, Teams, Glocke, Protokoll); Lernwoche still", async () => {
    const { d, store, sent } = deps(overdueOrders);
    store.set("shop_pulse_regular_state", { lastRunAt: "2026-10-16T08:00:00Z", lastRunDay: "2026-10-16" });
    expect(await runRegulars(d, null, NOW, { silent: true })).toMatchObject({ alerts: 0 });
    expect(await runRegulars(d, null, NOW, { silent: false })).toMatchObject({ alerts: 2 });
    expect(sent.mails).toEqual(["max@meta-online.com"]);
    expect(sent).toMatchObject({ teams: 2, bells: 2, actions: ["regularAlert", "regularAlert"] });
    // zweiter Lauf am selben Tag meldet nicht erneut (90 Tage)
    expect(await runRegulars(d, null, NOW, { silent: false })).toMatchObject({ alerts: 0 });
  });

  it("nach der Meldung bestellt → Erfolg im Maßnahmen-Protokoll", async () => {
    const alerted: RegularRow = { customerNumber: "A", backlog: false, alertedAt: new Date("2026-10-01T08:00:00Z"), alertLastOrderAt: new Date("2026-07-06T09:00:00Z"), recipient: "Max", recipientSource: "rep", wonAt: null, wonOrderNumber: null };
    const { d, store, saved, sent } = deps([...A.slice(0, 4), order("A", "2026-10-14")], [alerted]);
    store.set("shop_pulse_regular_state", { lastRunAt: "2026-10-16T08:00:00Z" });
    expect(await runRegulars(d, null, NOW, { silent: false })).toMatchObject({ won: 1, alerts: 0 });
    expect(saved.get("A")?.wonAt?.toISOString()).toBe("2026-10-14T09:00:00.000Z");
    expect(sent.actions).toEqual(["regularWon"]);
  });

  it("ausgeschaltet: kein Lauf", async () => {
    const { d } = deps(overdueOrders, [], { enabled: false });
    expect(await runRegulars(d, null, NOW, { silent: false })).toBeNull();
  });
});
