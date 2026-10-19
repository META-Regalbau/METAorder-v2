/**
 * Shop-Puls Stufe 3 (S3-1): Weitergabe-Text mit Belegen, Erinnerung nach 2 Werktagen, Erledigung über die
 * Meldung, Jana-Liste (neu/erledigt, montags), Fälligkeit von Tickets, Versand an Oliver (Teams + Glocke),
 * Suchwörter: Zuordnung Begriff → Artikel, Zusammenführen ohne Überschreiben, Rücknahme, Begriffe aus GA4.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { buildHandoffText, dueReminders, evidenceLines, handoffsDoneBySignal, janaDiff, relevantDeploys } from "../../server/shopPulse/handoff";
import { currentWeekStart, defaultDueDay, dueDateOf, isJanaListDue, sendToOliver } from "../../server/shopPulse/handoffRun";
import { compactText, editDistance, matchSearchTerm, mergeKeywords, normalizeText, prepareProducts, removeKeyword, termTokens, type KeywordProduct } from "../../server/shopPulse/searchKeywords";
import { ga4TermsOf, isAutoEligible, keywordShop } from "../../server/shopPulse/searchKeywordsRun";
import { dataGapsOf, dataGapsCsv } from "../../server/shopPulse/detectors/buyability";
import { SHOP_PULSE_SETTINGS_KEY, SHOP_PULSE_TEAMS_OUTBOX_KEY } from "../../server/shopPulse/shopPulseSettings";
import { getTeamsOutbox } from "../../server/lib/teamsOutbox";
import type { ShopPulseSignal } from "../../shared/shopPulse";
import type { ShopPulseHandoff, ShopPulseSearchKeyword } from "../../shared/shopPulseHandoff";

const WEBHOOK = "https://prod-01.westeurope.logic.azure.com/workflows/abc/triggers/manual/paths/invoke?sig=x";

const signal = (over: Partial<ShopPulseSignal> = {}): ShopPulseSignal => ({
  id: "s1",
  key: "storefront:product:123",
  source: "buyability",
  code: "productPageStatus",
  severity: "critical",
  status: "open",
  params: { number: "4026212439625", name: "META CLIP Fachbodenregal", revenue: 12000, status: 500 },
  evidence: { url: "https://shop.meta-online.com/clip-fachbodenregal", status: 500, step: "Produktseite" },
  lossPerHour: 3,
  firstSeenAt: "2026-10-19T06:15:00.000Z",
  lastSeenAt: "2026-10-19T09:15:00.000Z",
  resolvedAt: null,
  resolvedBy: null,
  mutedUntil: null,
  notifiedAt: null,
  notifiedSeverity: null,
  ...over,
});

const handoff = (over: Partial<ShopPulseHandoff> = {}): ShopPulseHandoff => ({
  id: "h1",
  signalId: "s1",
  signalKey: "k",
  kind: "agency",
  recipient: "wirduzen (Agentur)",
  text: "…",
  ticketId: null,
  ticketNumber: null,
  createdAt: "2026-10-16T13:00:00.000Z", // Freitag 15 Uhr
  createdBy: "oliver",
  doneAt: null,
  doneBy: null,
  remindedAt: null,
  ...over,
});

describe("Weitergabe-Text", () => {
  it("nennt Empfänger, Meldung, Zeitpunkte, Verlust, Deploy und Belege", () => {
    const text = buildHandoffText({
      signal: signal(),
      kind: "agency",
      deploys: [
        { at: "2026-10-18T20:00:00.000Z", changes: [{ field: "plugins", before: "A 1.0", after: "A 1.1" }] },
        { at: "2026-10-10T20:00:00.000Z", changes: [{ field: "themeAsset", before: "x", after: "y" }] },
      ],
      shopUrl: "https://shop.meta-online.com/",
      now: new Date("2026-10-19T10:00:00Z"),
    });
    expect(text).toMatch(/^An: wirduzen \(Agentur\)\nBetreff: Onlineshop – /);
    expect(text).toContain("im Onlineshop shop.meta-online.com ist uns Folgendes aufgefallen");
    expect(text).toContain("zuerst gesehen: 19.10.2026, 08:15 Uhr, zuletzt: 19.10.2026, 11:15 Uhr");
    expect(text).toContain("Schwere: kritisch");
    expect(text).toMatch(/geschätzter Umsatzverlust: 3\s€ pro Stunde/);
    expect(text).toContain("Deploy laut Shop-Wächter am 18.10.2026, 22:00 Uhr: Plugins A 1.0 → A 1.1");
    expect(text).not.toContain("Theme"); // älter als 72 Stunden vor dem ersten Auftreten
    expect(text).toContain("- Seite: https://shop.meta-online.com/clip-fachbodenregal");
    expect(text).toContain("- HTTP-Status: 500");
    expect(text.trim().endsWith("Viele Grüße")).toBe(true);
  });

  it("Smarketer, ohne Deploy, Suchbegriffe aus den Belegen", () => {
    const text = buildHandoffText({
      signal: signal({ code: "ga4SearchNoHits", severity: "warning", lossPerHour: null, params: { date: "2026-10-18", count: 2, searches: 9, terms: "„x“" }, evidence: { terms: [{ term: "Kragarm", count: 5 }, { term: "313422", count: 4 }], checked: 12 } }),
      kind: "marketing",
      deploys: [],
      shopUrl: null,
      now: new Date("2026-10-19T10:00:00Z"),
    });
    expect(text).toMatch(/^An: Smarketer/);
    expect(text).toContain("im Onlineshop ist uns");
    expect(text).toContain("kein Deploy laut Shop-Wächter in den 72 Stunden davor");
    expect(text).toContain("- Suchbegriffe: term Kragarm, count 5; term 313422, count 4");
    expect(text).toContain("- geprüft: 12");
    expect(text).not.toContain("Umsatzverlust");
  });

  it("Belege: leere Werte weg, lange Listen gekürzt", () => {
    const lines = evidenceLines({ a: null, b: [], url: "/x", products: Array.from({ length: 12 }, (_, i) => `P${i}`) });
    expect(lines).toEqual(["Seite: /x", "Artikel: P0; P1; P2; P3; P4; P5; P6; P7; P8; P9 … (12 insgesamt)"]);
  });

  it("Deploys im Fenster von 72 Stunden vor dem ersten Auftreten bis jetzt", () => {
    const d = (at: string) => ({ at, changes: [] });
    const now = new Date("2026-10-19T10:00:00Z");
    expect(relevantDeploys([d("2026-10-16T06:14:00Z"), d("2026-10-16T06:16:00Z"), d("2026-10-19T11:00:00Z")], "2026-10-19T06:15:00Z", now).map((x) => x.at)).toEqual(["2026-10-16T06:16:00Z"]);
  });
});

describe("Erinnerung und Erledigung", () => {
  it("erinnert nach 2 Werktagen einmal, nicht bei Tickets, erledigten oder schon erinnerten", () => {
    const list = [handoff(), handoff({ id: "t", kind: "ticket" }), handoff({ id: "d", doneAt: "2026-10-19T08:00:00Z" }), handoff({ id: "r", remindedAt: "2026-10-20T08:00:00Z" })];
    // Freitag 15 Uhr → Dienstag 14:59 Uhr: noch keine 2 Werktage
    expect(dueReminders(list, new Date("2026-10-20T12:59:00Z"))).toEqual([]);
    expect(dueReminders(list, new Date("2026-10-20T13:01:00Z")).map((h) => h.id)).toEqual(["h1"]);
  });

  it("Weitergabe erledigt sich mit der Meldung", () => {
    const signals = new Map([
      ["s1", { status: "resolved" as const }],
      ["s2", { status: "open" as const }],
    ]);
    expect(handoffsDoneBySignal([handoff(), handoff({ id: "h2", signalId: "s2" }), handoff({ id: "h3", doneAt: "x" })], signals).map((h) => h.id)).toEqual(["h1"]);
  });
});

describe("Tickets", () => {
  it("Fälligkeit 17 Uhr Berlin, Sommer- und Winterzeit", () => {
    expect(dueDateOf("2026-10-21").toISOString()).toBe("2026-10-21T15:00:00.000Z");
    expect(dueDateOf("2026-11-02").toISOString()).toBe("2026-11-02T16:00:00.000Z");
  });
  it("Vorschlag: in 2 Werktagen", () => {
    expect(defaultDueDay(new Date("2026-10-16T10:00:00Z"))).toBe("2026-10-20"); // Freitag → Dienstag
    expect(defaultDueDay(new Date("2026-10-19T10:00:00Z"))).toBe("2026-10-21");
  });
});

describe("Jana-Liste", () => {
  const gap = (code: "noImage" | "noCategory", pn: string) => ({ code, productNumber: pn, name: pn, active: true, value: "", hint: "" });
  it("neu und erledigt gegenüber der letzten Liste", () => {
    expect(janaDiff([gap("noImage", "1"), gap("noCategory", "1")], null)).toEqual({ keys: ["noCategory|1", "noImage|1"], added: 2, fixed: 0 });
    const prev = { week: "2026-10-12", sentAt: "x", keys: ["noCategory|1", "noImage|2"], total: 2, added: 2, fixed: 0 };
    expect(janaDiff([gap("noImage", "1"), gap("noCategory", "1")], prev)).toEqual({ keys: ["noCategory|1", "noImage|1"], added: 1, fixed: 1 });
  });
  it("montags 8–12 Uhr, einmal je Woche", () => {
    const monday9 = new Date("2026-10-19T07:00:00Z");
    expect(currentWeekStart(monday9)).toBe("2026-10-19");
    expect(isJanaListDue(null, monday9)).toBe(true);
    expect(isJanaListDue({ week: "2026-10-19", sentAt: "", keys: [], total: 0, added: 0, fixed: 0 }, monday9)).toBe(false);
    expect(isJanaListDue({ week: "2026-10-12", sentAt: "", keys: [], total: 0, added: 0, fixed: 0 }, monday9)).toBe(true);
    expect(isJanaListDue(null, new Date("2026-10-19T10:30:00Z"))).toBe(false); // 12:30 Uhr
    expect(isJanaListDue(null, new Date("2026-10-20T07:00:00Z"))).toBe(false); // Dienstag
  });
  it("Lieferzeit gehört zu den Datenlücken, mit Jana-Zeile in der CSV", () => {
    const gaps = dataGapsOf([{ productNumber: "9", name: "Regal", active: true, salesChannelIds: [], priceGross: 1, stock: 1, deliveryTimeId: null, restockTime: null, categoryCount: 1, isVariant: false, coverId: "c" }]);
    expect(gaps.map((g) => g.code)).toEqual(["noDeliveryTime"]);
    expect(dataGapsCsv({ at: "2026-10-19T03:00:00Z", items: gaps })).toContain("Shop-Puls: Lieferzeit;2026-10-19;9;aktiv;Regal;Lieferzeit;keine Lieferzeit;Lieferzeit zuordnen");
  });
});

describe("Versand an Oliver", () => {
  it("Teams-Karte (falls eingerichtet) und Glocke aller Administratoren", async () => {
    const settings = new Map<string, unknown>([[`${SHOP_PULSE_SETTINGS_KEY}|t1`, { enabled: true, teamsWebhookUrl: WEBHOOK }]]);
    const notes: any[] = [];
    const storage = {
      getSetting: async (key: string, t?: string | null) => structuredClone(settings.get(`${key}|${t}`)),
      saveSetting: async (key: string, v: unknown, t?: string | null) => void settings.set(`${key}|${t}`, structuredClone(v)),
      getUsersWithPermissionInTenant: async () => [{ id: "u1", username: "oliver", email: null }],
      createNotification: async (n: any) => ({ ...n, id: "n1" }),
    };
    const teams = await sendToOliver(
      { storage: storage as any, onNotificationCreated: (n) => notes.push(n), baseUrl: "https://app.example" },
      "t1",
      { heading: "📨 Test <b>", paragraphs: ["Zeile 1", "", "Zeile *2*"], bell: { title: "T", message: "M" }, link: "/admin/shop-puls?signal=s1", actions: [{ title: "Rückgängig", query: "?tab=keywords&action=revert" }] },
      new Date("2026-10-19T10:00:00Z"),
    );
    expect(teams).toBe(true);
    const [item] = await getTeamsOutbox(storage, SHOP_PULSE_TEAMS_OUTBOX_KEY, "t1", new Date("2026-10-19T10:00:00Z"));
    const card = (item.message as any).attachments[0].content;
    expect(card.body.map((b: any) => b.text)).toEqual(["📨 Test b", "Zeile 1", "Zeile 2"]);
    expect(card.actions).toEqual([{ type: "Action.OpenUrl", title: "Rückgängig", url: "https://app.example/admin/shop-puls?tab=keywords&action=revert" }]);
    expect(notes).toEqual([expect.objectContaining({ userId: "u1", type: "shop_pulse", title: "T", link: "/admin/shop-puls?signal=s1" })]);
  });
});

// ---------------------------------------------------------------------------------------------
// Suchwörter

const product = (over: Partial<KeywordProduct>): KeywordProduct => ({ id: `id-${over.productNumber}`, productNumber: "1", name: "", ean: null, manufacturerNumber: null, ...over });
const PRODUCTS = prepareProducts([
  product({ productNumber: "4026212439625", name: "META CLIP | Fachbodenregal | Anbauregal | 2000 x 1300 x 600 mm | Fachlast 230 kg", ean: "4026212439625", manufacturerNumber: "313422" }),
  product({ productNumber: "4026212439793", name: "META CLIP S3 | Fachbodenregal | Doppel-Grundregal | 2000 x 1300 x 600 mm | Fachlast 150 kg", ean: "4026212439793", manufacturerNumber: "313439" }),
  product({ productNumber: "4026212400001", name: "META Kragarmregal MULTIPAL einseitig Grundregal", manufacturerNumber: "500100" }),
  product({ productNumber: "4026212400002", name: "Gitterboxen-Zubehör Sichtlagerkasten blau", manufacturerNumber: "500200" }),
]);
const REVENUE = new Map([["4026212439625", 5000.4], ["4026212439793", 9000]]);

describe("Suchwörter: Zuordnung", () => {
  it("Text und Wörter normalisieren", () => {
    expect(normalizeText("Größe Über-Regal, 2.000 mm")).toBe("groesse ueber regal 2 000 mm");
    expect(compactText("SW-10 001")).toBe("sw10001");
    expect(termTokens("Regal für die Garage mit 4 Böden")).toEqual(["regal", "garage", "4", "boeden"]);
  });

  it("Tippfehler-Abstand mit Vertauschung", () => {
    expect(editDistance("kragarm", "kragram", 1)).toBe(1);
    expect(editDistance("fachbodenregal", "fachbodnregl", 2)).toBe(2);
    expect(editDistance("abc", "xyz", 1)).toBe(2);
  });

  it("Nummer: genau ein Artikel → eindeutig", () => {
    expect(matchSearchTerm("313422", PRODUCTS, REVENUE)).toEqual({ kind: "number", candidates: [{ productId: "id-4026212439625", productNumber: "4026212439625", name: expect.any(String), revenue: 5000, reason: "manufacturerNumber" }] });
    expect(matchSearchTerm("4026 2124 39793", PRODUCTS, REVENUE).kind).toBe("number");
  });

  it("Name: ein Artikel, ein Wort ähnlich geschrieben bzw. als Wortteil → eindeutig", () => {
    const m = matchSearchTerm("Kragramregal", PRODUCTS, REVENUE);
    expect(m.kind).toBe("name");
    expect(m.candidates.map((c) => c.productNumber)).toEqual(["4026212400001"]);
    expect(matchSearchTerm("sichtlager kasten", PRODUCTS, REVENUE)).toMatchObject({ kind: "name" });
  });

  it("alle Wörter genau so im Namen → Hinweis auf den Suchindex, kein Automatismus", () => {
    expect(matchSearchTerm("Kragarmregal Multipal", PRODUCTS, REVENUE).kind).toBe("exact");
  });

  it("mehrere Artikel → Vorschlag, nach Umsatz sortiert", () => {
    const m = matchSearchTerm("fachbodenregal clip", PRODUCTS, REVENUE);
    expect(m.kind).toBe("ambiguous");
    expect(m.candidates.map((c) => c.productNumber)).toEqual(["4026212439793", "4026212439625"]);
  });

  it("nichts Passendes bzw. nur Maße → none", () => {
    expect(matchSearchTerm("Werkbank", PRODUCTS, REVENUE).kind).toBe("none");
    expect(matchSearchTerm("2000 600", PRODUCTS, REVENUE).kind).toBe("none");
    expect(matchSearchTerm("999", PRODUCTS, REVENUE).kind).toBe("none");
  });

  it("ergänzt, ohne vorhandene zu überschreiben; doppelt nicht; Rücknahme nur des Begriffs", () => {
    expect(mergeKeywords(["Boden", "Zusatzboden"], "313422")).toEqual(["Boden", "Zusatzboden", "313422"]);
    expect(mergeKeywords(null, "  Kragram  regal ")).toEqual(["Kragram regal"]);
    expect(mergeKeywords(["kragarm"], "Kragarm")).toBeNull();
    expect(removeKeyword(["Boden", "313422", "Neu"], "313422")).toEqual(["Boden", "Neu"]);
  });
});

describe("Suchwörter: Quellen und Shopware", () => {
  it("Begriffe aus der offenen GA4-Meldung, je Begriff die höchste Zahl", () => {
    const s = signal({ code: "ga4SearchNoHits", evidence: { terms: [{ term: "Kragram", count: 3 }, { term: "kragram", count: 5 }, { term: "ab", count: 9 }, { term: "313422", count: 4 }] } });
    expect(ga4TermsOf([s, signal({ code: "ga4SearchNoHits", status: "resolved", evidence: { terms: [{ term: "alt", count: 99 }] } })])).toEqual([
      { term: "kragram", count: 5 },
      { term: "313422", count: 4 },
    ]);
  });

  it("automatisch nur eindeutige GA4-Vorschläge mit genau einem Artikel", () => {
    const k = (over: Partial<ShopPulseSearchKeyword>): ShopPulseSearchKeyword => ({
      id: "k",
      term: "x",
      source: "ga4",
      searches: 1,
      status: "suggested",
      matchKind: "number",
      candidates: [{ productId: "p", productNumber: "1", name: "", revenue: 0, reason: "ean" }],
      applied: [],
      appliedAt: null,
      appliedBy: null,
      revertedAt: null,
      revertedBy: null,
      error: null,
      createdAt: "",
      updatedAt: "",
      ...over,
    });
    expect(isAutoEligible(k({}))).toBe(true);
    expect(isAutoEligible(k({ source: "manual" }))).toBe(false);
    expect(isAutoEligible(k({ matchKind: "exact" }))).toBe(false);
    expect(isAutoEligible(k({ matchKind: "ambiguous" }))).toBe(false);
    expect(isAutoEligible(k({ status: "failed" }))).toBe(false);
  });

  it("liest eigenen und wirksamen Wert, schreibt nur das Feld customSearchKeywords", async () => {
    const calls: any[] = [];
    const api = async (method: string, path: string, body?: any) => {
      calls.push({ method, path, body });
      if (path === "search/product") return { data: [{ id: "p1", productNumber: "1", customSearchKeywords: null, translated: { customSearchKeywords: ["Boden"] } }] };
      return null;
    };
    const shop = keywordShop(api);
    expect(await shop.read(["p1"])).toEqual(new Map([["p1", { own: null, effective: ["Boden"], productNumber: "1" }]]));
    await shop.write("p1", ["Boden", "313422"]);
    expect(calls[1]).toEqual({ method: "PATCH", path: "product/p1", body: { customSearchKeywords: ["Boden", "313422"] } });
  });
});
