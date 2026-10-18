/**
 * Shop-Puls Stufe 2 (S2-2): Angebotsanfragen-Wache (Werktage, Schwere, leere Anfragen, Altbestand, Zuständige,
 * erster Lauf still, keine Entwarnung), Abruf aus B2Bsellers (Status-Filter, Seiten), B2B-Anteil und
 * Verteilung der Bestellwerte, Tages- und Wochenbericht, Lauf mit simulierter Datenbank.
 * Ausführung: npm test
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  businessDaysBetween,
  isOfferWatchDue,
  OFFER_BACKLOG_KEY,
  offerWatchDetections,
  offerWatchDetector,
  type OfferAssignee,
  type OfferRequest,
  type OfferWatchSources,
} from "../../server/shopPulse/detectors/offers";
import { loadOfferRequests, requestedStatusFilter, toOfferRequest } from "../../server/shopPulse/offerRequests";
import { getOfferStatusMapping } from "../../server/b2b/b2bSellersClient";
import { reconcileSignals, type ReconcileResult } from "../../server/shopPulse/shopPulseSignals";
import { b2bShare, isBusinessOrder, offerSummary, quantile, weeklyPayload, weeklyReportData } from "../../server/shopPulse/weeklyReport";
import { b2bShareLines, buildShopPulseDailyCard, buildShopPulseWeeklyCard, offerSummaryLines, signalMessage, signalTitle } from "../../server/shopPulse/shopPulseNotify";
import { runShopPulseForTenant, type ShopPulseDeps } from "../../server/shopPulse/shopPulseScheduler";
import { SHOP_PULSE_SETTINGS_KEY, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "../../server/shopPulse/shopPulseSettings";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import { berlinTime, type PulseOrder } from "../../server/shopPulse/pulseOrders";
import type { ShopPulseDetection, ShopPulseSignal } from "../../shared/shopPulse";
import { isoWeekOf, type ShopPulseWeeklyReport } from "../../shared/shopPulseWeekly";

const WEBHOOK = "https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";
/** Dienstag, 12 Uhr Berlin */
const TUESDAY = new Date("2026-10-20T10:00:00Z");
const nb = (s: string) => s.replace(/[\u00a0\u202f]/g, " ");

const request = (over: Partial<OfferRequest> = {}): OfferRequest => ({
  id: "o1",
  number: "1700",
  createdAt: "2026-10-16T08:00:00.000Z",
  customer: "Muster GmbH",
  customerNumber: "20000001",
  customerEmail: "einkauf@muster.de",
  salesChannelId: "ch-portal",
  net: 1200,
  gross: 1428,
  positions: 3,
  ...over,
});

const REP: OfferAssignee = { name: "Max Außendienst", email: "max@meta-online.com" };
const DEFAULT: OfferAssignee = { name: "isabell", email: "isabell@meta-online.com" };
const input = (over: Partial<Parameters<typeof offerWatchDetections>[1]> = {}) => ({
  now: TUESDAY,
  reps: new Map([["20000001", REP]]),
  fallback: DEFAULT,
  channels: new Map([["ch-portal", "META Händler Portal DE"]]),
  firstRun: false,
  ...over,
});

describe("Werktage", () => {
  it("zählt nur die Zeit Montag bis Freitag (Berlin)", () => {
    // Freitag 15 Uhr → Montag 15 Uhr = ein Werktag
    expect(businessDaysBetween(new Date("2026-10-16T13:00:00Z"), new Date("2026-10-19T13:00:00Z"))).toBeCloseTo(1, 5);
    // Samstag 12 Uhr → Montag 12 Uhr = halber Werktag
    expect(businessDaysBetween(new Date("2026-10-17T10:00:00Z"), new Date("2026-10-19T10:00:00Z"))).toBeCloseTo(0.5, 5);
    // am selben Tag 8 bis 20 Uhr
    expect(businessDaysBetween(new Date("2026-10-19T06:00:00Z"), new Date("2026-10-19T18:00:00Z"))).toBeCloseTo(0.5, 5);
    // über die Zeitumstellung (25.10.): Freitag 12 Uhr → Montag 12 Uhr
    expect(businessDaysBetween(new Date("2026-10-23T10:00:00Z"), new Date("2026-10-26T11:00:00Z"))).toBeCloseTo(1, 5);
    expect(businessDaysBetween(TUESDAY, new Date("2026-10-19T10:00:00Z"))).toBe(0);
  });

  it("prüft höchstens einmal je Stunde", () => {
    expect(isOfferWatchDue(undefined, TUESDAY)).toBe(true);
    expect(isOfferWatchDue({ at: "2026-10-20T09:10:00Z" }, TUESDAY)).toBe(false);
    expect(isOfferWatchDue({ at: "2026-10-20T09:05:00Z" }, TUESDAY)).toBe(true);
  });
});

describe("Funde", () => {
  it("ab einem Werktag Warnung, ab drei Werktagen oder 2.500 € netto kritisch", () => {
    const found = offerWatchDetections(
      [
        request({ id: "young", number: "1701", createdAt: "2026-10-19T11:00:00Z" }), // 0,96 Werktage
        request({ id: "two", number: "1702", createdAt: "2026-10-16T08:00:00Z" }), // Fr 10 Uhr: 2,08
        request({ id: "four", number: "1703", createdAt: "2026-10-14T08:00:00Z" }), // Mi 10 Uhr: 4,08
        request({ id: "big", number: "1704", createdAt: "2026-10-19T08:00:00Z", net: 3000 }), // 1,08, hoher Wert
        request({ id: "weekend", number: "1705", createdAt: "2026-10-17T10:00:00Z" }), // Samstag: 1,5
      ],
      input(),
    );
    expect(found.map((d) => [d.key, d.code, d.severity, d.params?.businessDays])).toEqual([
      ["b2b:offer:two", "offerUnanswered", "warning", 2],
      ["b2b:offer:four", "offerUnanswered", "critical", 4],
      ["b2b:offer:big", "offerUnanswered", "critical", 1],
      ["b2b:offer:weekend", "offerUnanswered", "warning", 1],
    ]);
    expect(found[0]).toMatchObject({
      source: "b2b",
      params: { offerNumber: "1702", customer: "Muster GmbH", customerNumber: "20000001", net: 1200, since: "2026-10-16", assignee: "Max Außendienst (max@meta-online.com)", channel: "META Händler Portal DE", positions: 3 },
      evidence: { offerId: "two", assigneeSource: "rep", assigneeEmail: "max@meta-online.com", highValue: false },
    });
    expect(found[0].quiet).toBeUndefined();
    expect(nb(signalMessage(found[0] as any))).toBe(
      "Die Angebotsanfrage 1702 von Muster GmbH (Kd.-Nr. 20000001, META Händler Portal DE) über 1.200 € netto ist seit 2 Werktag(en) unbeantwortet (eingegangen am 16.10.2026). Zuständig: Max Außendienst (max@meta-online.com).",
    );
  });

  it("zuständig: Außendienst, sonst Standard-Bearbeiter, sonst niemand", () => {
    const r = request({ customerNumber: "99" });
    expect(offerWatchDetections([r], input())[0]).toMatchObject({ params: { assignee: "isabell (isabell@meta-online.com)" }, evidence: { assigneeSource: "default" } });
    expect(offerWatchDetections([r], input({ fallback: null }))[0]).toMatchObject({ params: { assignee: "–" }, evidence: { assigneeSource: "none" } });
    expect(offerWatchDetections([request({ customerNumber: "" })], input({ fallback: null }))[0].params).toMatchObject({ customerNumber: "–" });
  });

  it("leere Anfrage ist ein Datenfehler: ab einer Stunde, nie kritisch, ohne Wert", () => {
    const found = offerWatchDetections(
      [
        request({ id: "e1", positions: 0, net: 0, createdAt: "2026-10-20T09:30:00Z" }), // 30 Minuten
        request({ id: "e2", positions: 0, net: 0, createdAt: "2026-10-20T08:00:00Z" }), // 2 Stunden
        request({ id: "e3", positions: 0, net: 0, createdAt: "2026-10-12T08:00:00Z" }), // 6 Werktage
      ],
      input(),
    );
    expect(found.map((d) => [d.key, d.code, d.severity])).toEqual([
      ["b2b:offer:e2", "offerEmpty", "warning"],
      ["b2b:offer:e3", "offerEmpty", "warning"],
    ]);
    expect(found[0].params).not.toHaveProperty("net");
    expect(nb(signalTitle(found[0] as any))).toBe("Angebotsanfrage 1700 von Muster GmbH ohne Positionen");
  });

  it("älter als 20 Werktage: gesammelt in einer Warnung", () => {
    const found = offerWatchDetections(
      [request({ id: "new" }), request({ id: "a", number: "1500", createdAt: "2026-09-10T08:00:00Z", net: 500 }), request({ id: "b", number: "1400", createdAt: "2026-08-03T08:00:00Z", net: 700, positions: 0 })],
      input(),
    );
    expect(found.map((d) => d.key)).toEqual(["b2b:offer:new", OFFER_BACKLOG_KEY]);
    expect(found[1]).toMatchObject({ code: "offerBacklog", severity: "warning", params: { count: 2, net: 1200, oldestNumber: "1400", oldestSince: "2026-08-03" } });
    expect((found[1].evidence as any).offers).toHaveLength(2);
    expect(nb(signalMessage(found[1] as any))).toContain("2 Angebotsanfragen über zusammen 1.200 € netto sind älter als 4 Wochen");
  });

  it("erster Lauf der Prüfung: alles still", () => {
    const found = offerWatchDetections([request(), request({ id: "old", createdAt: "2026-08-01T08:00:00Z" })], input({ firstRun: true }));
    expect(found.every((d) => d.quiet === true)).toBe(true);
  });

  it("Detektor liest Anfragen, Außendienst nur für vorhandene Kundennummern, Kanäle", async () => {
    const calls: string[] = [];
    const b2b: OfferWatchSources = {
      requests: async () => (calls.push("requests"), [request(), request({ id: "x", customerNumber: "" })]),
      salesReps: async (numbers) => (calls.push(`reps:${numbers.join(",")}`), new Map()),
      defaultAssignee: async () => (calls.push("default"), null),
      channelNames: async (ids) => (calls.push(`channels:${ids.join(",")}`), new Map()),
    };
    const found = await offerWatchDetector.run({ now: TUESDAY, b2b, firstRun: false } as any);
    expect(calls).toEqual(["requests", "reps:20000001", "default", "channels:ch-portal"]);
    expect(found).toHaveLength(2);
  });
});

describe("Meldungen: still und ohne Entwarnung", () => {
  const opts = { now: TUESDAY, learning: false, completeSources: ["b2b" as const], newId: () => "id1" };
  const critical: ShopPulseDetection = { key: "b2b:offer:o1", source: "b2b", code: "offerUnanswered", severity: "critical", params: { offerNumber: "1700" } };

  it("quiet: Schwere still berücksichtigt, später keine Nachricht für dieselbe Schwere", () => {
    const first = reconcileSignals([], [{ ...critical, quiet: true }], opts);
    expect(first.notices).toEqual([]);
    expect(first.inserts[0]).toMatchObject({ notifiedSeverity: "critical", notifiedAt: null });
    const second = reconcileSignals(first.inserts, [critical], { ...opts, now: new Date(TUESDAY.getTime() + 3600_000) });
    expect(second.notices).toEqual([]);
  });

  it("ohne quiet: kritisch sofort; beantwortet → erledigt, aber kein „Behoben“", () => {
    const first = reconcileSignals([], [critical], opts);
    expect(first.notices.map((n) => n.kind)).toEqual(["new"]);
    const gone = reconcileSignals(first.inserts, [], { ...opts, now: new Date(TUESDAY.getTime() + 3600_000) });
    expect(gone.updates).toEqual([{ id: "id1", patch: expect.objectContaining({ status: "resolved" }) }]);
    expect(gone.notices).toEqual([]);
  });
});

describe("Abruf aus B2Bsellers", () => {
  it("Status-Filter: ID aus der Zuordnung, sonst die Bezeichnungen", () => {
    expect(requestedStatusFilter(getOfferStatusMapping({ submitted: { label: "Angefragt von Kunde", id: "3730574503094101ac91bcedc3787195" } }))).toEqual({
      type: "equals",
      field: "statusId",
      value: "3730574503094101ac91bcedc3787195",
    });
    expect(requestedStatusFilter(getOfferStatusMapping({ submitted: { label: "Requested by customer", id: null } }))).toEqual({
      type: "equalsAny",
      field: "status.label",
      value: ["Requested by customer", "Angefragt von Kunde"],
    });
  });

  it("Zeile → Anfrage: Firma, sonst Ansprechpartner; Positionen gezählt", () => {
    expect(
      toOfferRequest({
        id: "abc",
        number: "1629",
        createdAt: "2026-09-30T13:32:45.724+00:00",
        salesChannelId: "ch",
        price: { netPrice: 20604.1, totalPrice: 24518.88 },
        offerCustomer: { company: " META Musterregale ", customerNumber: "12692", email: "A@B.DE" },
        items: [{ id: "1" }, { id: "2" }],
      }),
    ).toEqual({ id: "abc", number: "1629", createdAt: "2026-09-30T13:32:45.724+00:00", customer: "META Musterregale", customerNumber: "12692", customerEmail: "a@b.de", salesChannelId: "ch", net: 20604.1, gross: 24518.88, positions: 2 });
    expect(toOfferRequest({ id: "x", createdAt: "2026-10-01", offerCustomer: { firstName: "Eva", lastName: "Muster" } })).toMatchObject({ customer: "Eva Muster", positions: 0, net: 0, number: "x" });
    expect(toOfferRequest({ id: "", createdAt: "2026-10-01" })).toBeNull();
  });

  it("Seiten nacheinander, Filter auf Status und 365 Tage, schmale Antwort", async () => {
    const bodies: any[] = [];
    let open = 0;
    const api = async (_m: string, path: string, body: any) => {
      expect(open).toBe(0); // nie parallel
      open++;
      await Promise.resolve();
      open--;
      bodies.push({ path, body });
      const n = body.page === 1 ? 100 : 3;
      return { data: Array.from({ length: n }, (_, i) => ({ id: `p${body.page}-${i}`, createdAt: "2026-10-01T00:00:00Z", items: [] })) };
    };
    const mapping = getOfferStatusMapping({ submitted: { label: "Angefragt von Kunde", id: "st1" } });
    const rows = await loadOfferRequests(api, mapping, TUESDAY);
    expect(rows).toHaveLength(103);
    expect(bodies.map((b) => b.path)).toEqual(["search/b2bsellers-offer", "search/b2bsellers-offer"]);
    expect(bodies[0].body.filter).toEqual([
      { type: "equals", field: "statusId", value: "st1" },
      { type: "range", field: "createdAt", parameters: { gte: "2025-10-20T10:00:00.000Z" } },
    ]);
    expect(bodies[0].body.includes.b2bsellers_offer_item).toEqual(["id"]);
  });
});

// -------------------------------------------------------------------------------------------------
// Berichte

const offerSignal = (over: Partial<ShopPulseSignal> = {}): ShopPulseSignal => ({
  id: "s1",
  key: "b2b:offer:o1",
  source: "b2b",
  code: "offerUnanswered",
  severity: "critical",
  status: "open",
  params: { offerNumber: "1700", customer: "Muster GmbH", customerNumber: "20000001", net: 3000, since: "2026-10-14", businessDays: 4, assignee: "Max Außendienst", channel: "META Händler Portal DE", positions: 3 },
  evidence: { assigneeSource: "rep" },
  lossPerHour: null,
  firstSeenAt: "2026-10-15T08:00:00.000Z",
  lastSeenAt: "2026-10-20T10:00:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  mutedUntil: null,
  notifiedAt: null,
  notifiedSeverity: "critical",
  ...over,
});

const OFFER_SIGNALS: ShopPulseSignal[] = [
  offerSignal(),
  offerSignal({ id: "s2", key: "b2b:offer:o2", severity: "warning", params: { ...offerSignal().params, offerNumber: "1701", net: 800, businessDays: 1 }, evidence: { assigneeSource: "default" } }),
  offerSignal({ id: "s3", key: "b2b:offer:o3", code: "offerEmpty", severity: "warning", params: { offerNumber: "1702", customer: "Leer AG", customerNumber: "5", since: "2026-10-19", businessDays: 0, assignee: "–", channel: "META Regalbau DE", positions: 0 }, evidence: { assigneeSource: "none" } }),
  offerSignal({ id: "s4", key: OFFER_BACKLOG_KEY, code: "offerBacklog", severity: "warning", params: { count: 7, net: 9100, oldestNumber: "1000", oldestSince: "2026-02-16" }, evidence: {} }),
  offerSignal({ id: "s5", key: "b2b:offer:o5", status: "resolved" }),
];

describe("Angebotsanfragen im Tages- und Wochenbericht", () => {
  it("Zusammenfassung: unbeantwortet mit Wert, leer, Altbestand; größter Wert zuerst, leere am Ende", () => {
    const o = offerSummary(OFFER_SIGNALS);
    expect(o).toMatchObject({ unanswered: 2, critical: 1, net: 3800, empty: 1, backlog: 7, backlogNet: 9100 });
    expect(o.items.map((i) => [i.offerNumber, i.assigneeSource, i.empty])).toEqual([
      ["1700", "rep", false],
      ["1701", "default", false],
      ["1702", "none", true],
    ]);
    expect(offerSummaryLines(o).map(nb)).toEqual([
      "Angebotsanfragen: 2 unbeantwortet (3.800 € netto), davon 1 kritisch",
      "Angebotsanfragen ohne Positionen: 1 (Datenfehler)",
      "Älter als 4 Wochen, Status noch „Angefragt von Kunde“: 7 (9.100 € netto)",
    ]);
    expect(offerSummaryLines(offerSummary([]))).toEqual([]);
  });

  it("Tagesbericht nennt die Angebotsanfragen", () => {
    const open = OFFER_SIGNALS.filter((s) => s.status === "open");
    const card = buildShopPulseDailyCard(open, TUESDAY, null, null, null, offerSummary(open)) as any;
    const texts = card.attachments[0].content.body.map((b: any) => nb(String(b.text)));
    expect(texts).toContain("Angebotsanfragen: 2 unbeantwortet (3.800 € netto), davon 1 kritisch");
  });
});

function pulseOrder(day: string, net: number, company: string, customerNumber = ""): PulseOrder {
  const createdAt = new Date(`${day}T10:00:00Z`);
  return { orderNumber: `MO${day}${net}${company}`, createdAt, day, hour: berlinTime(createdAt).hour, total: Math.round(net * 1.19), paymentMethod: null, customer: { net, company, customerNumber } };
}

describe("B2B-Anteil", () => {
  const orders = [
    pulseOrder("2026-10-13", 1200, "Muster GmbH"),
    pulseOrder("2026-10-14", 300, ""),
    pulseOrder("2026-10-15", 600, "", "20000042"), // nur B2B-Kennzeichen
    pulseOrder("2026-10-16", 6000, "Groß AG"),
    pulseOrder("2026-09-01", 100, ""), // im Quartal, Vorwochen
    pulseOrder("2026-07-20", 2600, "Alt GmbH"), // 13 Wochen ab 20.07. – erste Woche des Quartals
    pulseOrder("2026-07-19", 9999, "Zu alt GmbH"), // davor
    pulseOrder("2026-10-19", 9999, "Nächste Woche GmbH"),
  ];
  const flagged = new Set(["20000042"]);

  it("Geschäftskunde: Firma oder B2B-Kennzeichen", () => {
    expect(isBusinessOrder({ net: 1, company: "X", customerNumber: "" }, new Set())).toBe(true);
    expect(isBusinessOrder({ net: 1, company: "", customerNumber: "20000042" }, flagged)).toBe(true);
    expect(isBusinessOrder({ net: 1, company: "", customerNumber: "1" }, flagged)).toBe(false);
  });

  it("Woche und 13 Wochen, Verteilung, Quantile, Schwellen", () => {
    const b = b2bShare(orders, "2026-10-12", flagged)!;
    expect(b.week).toEqual({ from: "2026-10-12", to: "2026-10-18", orders: 4, b2bOrders: 3, net: 8100, b2bNet: 7800, ordersPercent: 75, netPercent: 96.3 });
    expect(b.quarter).toMatchObject({ from: "2026-07-20", to: "2026-10-18", orders: 6, b2bOrders: 4, net: 10800, b2bNet: 10400 });
    expect(b.basis).toEqual({ company: 3, flagOnly: 1 });
    expect(b.buckets).toEqual([
      { from: 0, to: 250, b2b: 0, private: 1 },
      { from: 250, to: 500, b2b: 0, private: 1 },
      { from: 500, to: 1000, b2b: 1, private: 0 },
      { from: 1000, to: 2500, b2b: 1, private: 0 },
      { from: 2500, to: 5000, b2b: 1, private: 0 },
      { from: 5000, to: null, b2b: 1, private: 0 },
    ]);
    // B2B netto sortiert: 600, 1200, 2600, 6000
    expect(b.b2bQuantiles).toEqual({ p50: 1900, p75: 3450, p90: 4980 });
    expect(b.atLeast).toEqual([
      { threshold: 500, orders: 4, percent: 100, perWeek: 0.3 },
      { threshold: 1000, orders: 3, percent: 75, perWeek: 0.2 },
      { threshold: 2500, orders: 2, percent: 50, perWeek: 0.2 },
    ]);
    expect(b2bShareLines(b).map(nb).slice(0, 4)).toEqual([
      "Woche: 3 von 4 Bestellungen (75 %) · 7.800 € von 8.100 € netto (96,3 %)",
      "13 Wochen (20.07.2026 bis 18.10.2026): 4 von 6 Bestellungen (66,7 %) · 10.400 € von 10.800 € netto (96,3 %)",
      "Bestellwerte der Geschäftskunden (13 Wochen, netto): Median 1.900 € · 75 % bis 3.450 € · 90 % bis 4.980 €",
      "ab 500 € netto: 4 Bestellung(en) (100 % der Geschäftskunden-Bestellungen), rund 0,3 je Woche",
    ]);
  });

  it("ohne Kundendaten oder ohne Bestellungen", () => {
    expect(b2bShare([{ ...orders[0], customer: undefined }], "2026-10-12", flagged)).toBeNull();
    const empty = b2bShare([], "2026-10-12", flagged)!;
    expect(empty.week).toMatchObject({ orders: 0, ordersPercent: null, netPercent: null });
    expect(empty.b2bQuantiles).toBeNull();
    expect(quantile([], 0.5)).toBe(0);
  });

  it("Wochenbericht: Abschnitte Angebotsanfragen und B2B-Anteil, Eingabe der KI", () => {
    const data = weeklyReportData({ numbers: null, signals: OFFER_SIGNALS.filter((s) => s.status === "open"), estimates: new Map(), actions: [], now: TUESDAY, b2b: b2bShare(orders, "2026-10-12", flagged) });
    expect(data.offers).toMatchObject({ unanswered: 2, empty: 1, backlog: 7 });
    expect(data.openByOwner.map((o) => [o.owner, o.items.length])).toEqual([["sales", 4]]);
    const report: ShopPulseWeeklyReport = { id: "r1", weekStart: "2026-10-12", weekEnd: "2026-10-18", isoWeek: isoWeekOf("2026-10-12"), createdAt: TUESDAY.toISOString(), sentAt: null, data, ai: null };
    const texts = (buildShopPulseWeeklyCard(report, null) as any).attachments[0].content.body.map((b: any) => nb(String(b.text)));
    expect(texts).toEqual(expect.arrayContaining(["Angebotsanfragen", "B2B-Anteil (Geschäftskunden)", "- 1700 · Muster GmbH · 3.000 € netto · 4 Werktag(e) · Zuständig: Max Außendienst"]));
    const payload = weeklyPayload(data, TUESDAY) as any;
    expect(payload.angebotsanfragen).toMatchObject({ unbeantwortet: 2, wertNetto: 3800 });
    expect(payload.b2bAnteil).toMatchObject({ wocheBestellungenProzent: 75, quartalMedianBestellwertNetto: 1900 });
    // ältere Berichte ohne die Abschnitte
    const old = { ...report, data: { ...data, offers: undefined, b2b: undefined } };
    const oldTexts = (buildShopPulseWeeklyCard(old, null) as any).attachments[0].content.body.map((b: any) => String(b.text));
    expect(oldTexts).not.toContain("Angebotsanfragen");
  });
});

// -------------------------------------------------------------------------------------------------
// Lauf mit simulierter Datenbank

function memoryStore() {
  const settings = new Map<string, any>();
  const k = (key: string, t?: string | null) => `${t ?? "_"}:${key}`;
  return {
    getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(k(key, t))),
    saveSetting: async (key: string, value: any, t?: string | null) => void settings.set(k(key, t), structuredClone(value)),
  };
}

describe("Lauf: Angebotsanfragen-Wache", () => {
  beforeAll(() => vi.useFakeTimers());
  afterAll(() => vi.useRealTimers());

  function setup() {
    const store = memoryStore();
    const rows: ShopPulseSignal[] = [];
    let now = TUESDAY;
    let requests: OfferRequest[] = [request({ id: "old-critical", number: "1600", createdAt: "2026-10-12T08:00:00Z" })];
    let loads = 0;
    const deps: ShopPulseDeps = {
      storage: {
        ...store,
        getAllTenants: async () => [{ id: "t1" }] as any,
        getShopwareSettings: async () => ({}) as any,
        getUsersWithPermissionInTenant: async () => [{ id: "admin-1", username: "admin", email: null }],
        createNotification: async (n: any) => ({ ...n, id: "n1", createdAt: new Date() }),
        getShopwareSyncState: async () => undefined,
      } as any,
      repo: {
        listSignalsBySources: async (_t, sources) => structuredClone(rows.filter((r) => sources.includes(r.source))),
        listOpenSignals: async () => structuredClone(rows.filter((r) => r.status === "open")),
        applyReconcile: async (_t: string | null, result: ReconcileResult) => {
          rows.push(...structuredClone(result.inserts));
          for (const u of result.updates) Object.assign(rows.find((r) => r.id === u.id)!, structuredClone(u.patch));
        },
      },
      detectors: [offerWatchDetector],
      loadOrders: async () => [],
      loadOfferWatch: () => ({
        requests: async () => (loads++, structuredClone(requests)),
        salesReps: async () => new Map([["20000001", REP]]),
        defaultAssignee: async () => DEFAULT,
        channelNames: async () => new Map([["ch-portal", "META Händler Portal DE"]]),
      }),
      onNotificationCreated: () => undefined,
      baseUrl: null,
      now: () => now,
      newId: (() => {
        let i = 0;
        return () => `sig${++i}`;
      })(),
    };
    const outbox = async () => (await getTeamsOutbox(store, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", now)).map((i) => (i.message as any).attachments[0].content.body.map((b: any) => nb(String(b.text))));
    return {
      store,
      deps,
      rows,
      outbox,
      loads: () => loads,
      setNow: (d: Date) => (now = d),
      setRequests: (r: OfferRequest[]) => (requests = r),
    };
  }

  it("erster Lauf still, danach neue kritische Anfrage sofort; beantwortet → still erledigt; stündlich", async () => {
    const t = setup();
    // eingeschaltet, Lernwoche vorbei; 12 Uhr: kein Tagesbericht mehr fällig
    await t.store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: "2026-10-01T00:00:00Z", teamsWebhookUrl: WEBHOOK }, "t1");
    const first = await runShopPulseForTenant(t.deps, "t1");
    expect(first?.detectors.offerWatch).toMatchObject({ ok: true, findings: 1 });
    expect(t.rows).toMatchObject([{ key: "b2b:offer:old-critical", source: "b2b", severity: "critical", notifiedSeverity: "critical", notifiedAt: null }]);
    expect(await t.outbox()).toEqual([]);

    // 30 Minuten später: nicht fällig
    t.setNow(new Date(TUESDAY.getTime() + 30 * 60_000));
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.loads()).toBe(1);

    // eine Stunde später: neue Anfrage mit hohem Wert → sofort
    t.setNow(new Date(TUESDAY.getTime() + 60 * 60_000));
    t.setRequests([request({ id: "old-critical", number: "1600", createdAt: "2026-10-12T08:00:00Z" }), request({ id: "big", number: "1800", createdAt: "2026-10-19T08:00:00Z", net: 4000 })]);
    await runShopPulseForTenant(t.deps, "t1");
    const sent = await t.outbox();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toBe("🔴 Angebotsanfrage 1800 von Muster GmbH unbeantwortet");
    expect(sent[0][1]).toContain("über 4.000 € netto ist seit 1 Werktag(en) unbeantwortet");

    // beantwortet: Meldung erledigt, keine Entwarnung
    t.setNow(new Date(TUESDAY.getTime() + 120 * 60_000));
    t.setRequests([request({ id: "old-critical", number: "1600", createdAt: "2026-10-12T08:00:00Z" })]);
    await runShopPulseForTenant(t.deps, "t1");
    expect(t.rows.find((r) => r.key === "b2b:offer:big")).toMatchObject({ status: "resolved" });
    expect(await t.outbox()).toHaveLength(1);
  });

  it("Abruf scheitert: Prüfung fehlgeschlagen, offene Meldungen bleiben offen", async () => {
    const t = setup();
    await t.store.saveSetting(SHOP_PULSE_SETTINGS_KEY, { enabled: true, learningUntil: null, teamsWebhookUrl: WEBHOOK }, "t1");
    await runShopPulseForTenant(t.deps, "t1");
    t.deps.loadOfferWatch = () => ({
      requests: async () => {
        throw new Error("Shopware 500");
      },
      salesReps: async () => new Map(),
      defaultAssignee: async () => null,
      channelNames: async () => new Map(),
    });
    t.setNow(new Date(TUESDAY.getTime() + 60 * 60_000));
    const run = await runShopPulseForTenant(t.deps, "t1");
    expect(run?.detectors.offerWatch).toMatchObject({ ok: false, error: "Shopware 500" });
    expect(t.rows[0]).toMatchObject({ status: "open" });
  });
});
