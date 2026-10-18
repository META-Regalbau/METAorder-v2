/**
 * Shop-Puls Stufe 2 (S2-1), Maßnahmen-Protokoll: Übernahme aus den automatischen Quellen (Shop-Inhalte,
 * erledigte Meldungen, Deploys, Preisänderungen) ohne Dubletten und Import der Live-Protokolle.
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  actionsFromDeploys,
  actionsFromPriceChanges,
  actionsFromPublications,
  actionsFromResolvedSignals,
  newCandidates,
  type PublicationRow,
} from "../../server/shopPulse/actionLog";
import { parseLiveProtocol } from "../../server/shopPulse/actionImport";
import { industryEntityId } from "../../server/shopContent/shopEntityIds";
import { INDUSTRY_PAGES } from "../../server/products/industryPages";
import { normalizeActionScope, shopPulseActionInputSchema } from "../../shared/shopPulseWeekly";
import type { ShopPulseSignal } from "../../shared/shopPulse";

const TENANT = "8df98804-492e-4ed0-9699-a2f7036dea98";
const NOW = new Date("2026-10-19T06:15:00Z"); // Montag, 8:15 Berlin

const publication = (over: Partial<PublicationRow> = {}): PublicationRow => ({
  id: "p1",
  target: "live",
  status: "ok",
  publishedAt: new Date("2026-10-16T08:13:52Z"),
  publishedByName: "Oliver Steiling",
  revertedAt: null,
  revertedByName: null,
  itemKind: "industry_page",
  itemKey: "kfz",
  itemName: "KFZ-Werkstatt & Reifenhandel",
  versionNo: 3,
  url: "/branchen/kfz-werkstatt-reifenhandel",
  ...over,
});

const signal = (over: Partial<ShopPulseSignal> = {}): ShopPulseSignal => ({
  id: "s1",
  key: "buyability:product:inactive:SW10010",
  source: "buyability",
  code: "topsellerInactive",
  severity: "critical",
  status: "resolved",
  params: { number: "SW10010", name: "Fachbodenregal", revenue: 12000 },
  evidence: {},
  lossPerHour: 3,
  firstSeenAt: "2026-10-14T05:00:00.000Z",
  lastSeenAt: "2026-10-15T05:00:00.000Z",
  resolvedAt: "2026-10-15T09:30:00.000Z",
  resolvedBy: "oliver",
  mutedUntil: null,
  notifiedAt: null,
  notifiedSeverity: "critical",
  ...over,
});

describe("Shop-Inhalte", () => {
  it("nur erfolgreiche Live-Veröffentlichungen; Rücknahme als eigener Eintrag", () => {
    const urls = INDUSTRY_PAGES.map((p) => p.url);
    const list = actionsFromPublications(
      [
        publication(),
        publication({ id: "p2", target: "test" }),
        publication({ id: "p3", status: "failed" }),
        publication({ id: "p4", itemKind: "home_teaser", itemName: "Startseiten-Teaser", url: null, status: "reverted", revertedAt: new Date("2026-10-17T10:00:00Z"), revertedByName: "admin" }),
        publication({ id: "p5", itemKind: "common", itemName: "Gemeinsame Texte", url: null }),
      ],
      urls,
    );
    expect(list.map((a) => a.sourceKey)).toEqual(["content:p1", "content:p4", "content:p4:revert", "content:p5"]);
    expect(list[0]).toMatchObject({
      kind: "contentPublish",
      title: "Live veröffentlicht: KFZ-Werkstatt & Reifenhandel (Version 3)",
      scope: { type: "pages", values: ["/branchen/kfz-werkstatt-reifenhandel"] },
      source: "shopContent",
      actor: "Oliver Steiling",
      occurredAt: "2026-10-16T08:13:52.000Z",
    });
    expect(list[1].scope).toEqual({ type: "pages", values: ["/"] });
    expect(list[2]).toMatchObject({ kind: "contentRevert", actor: "admin", occurredAt: "2026-10-17T10:00:00.000Z" });
    expect(list[3].scope).toEqual({ type: "pages", values: urls });
  });
});

describe("Meldungen, Deploys, Preise", () => {
  it("nur von Hand erledigte Meldungen, Bereich aus der Artikelnummer", () => {
    const list = actionsFromResolvedSignals([signal(), signal({ id: "s2", resolvedBy: null }), signal({ id: "s3", status: "open", resolvedAt: null })]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      kind: "signalResolved",
      sourceKey: "signal:s1:2026-10-15T09:30:00.000Z",
      scope: { type: "products", values: ["SW10010"] },
      actor: "oliver",
      source: "shopPulse",
    });
    expect(list[0].title).toContain("Meldung erledigt:");
  });

  it("Sammelmeldung: alle Artikel aus den Belegen; ohne Artikel der ganze Shop", () => {
    const [a] = actionsFromResolvedSignals([signal({ code: "productsUnavailable", params: { count: 2, examples: "x" }, evidence: { products: ["A1", "A2", "A1"] } })]);
    expect(a.scope).toEqual({ type: "products", values: ["A1", "A2"] });
    const [b] = actionsFromResolvedSignals([signal({ code: "paymentMethodGone", params: { name: "PayPal" }, evidence: {} })]);
    expect(b.scope).toEqual({ type: "shop", values: [] });
  });

  it("Deploys laut Shop-Wächter, Läufe ohne Änderung nicht", () => {
    const list = actionsFromDeploys([
      { startedAt: "2026-10-17T12:00:00.000Z", deployChanges: [{ field: "themeAsset", before: "all.js?1", after: "all.js?2" }, { field: "plugins", before: "A 1.0", after: "A 1.1" }] },
      { startedAt: "2026-10-17T13:00:00.000Z", deployChanges: [] },
    ]);
    expect(list).toEqual([
      expect.objectContaining({
        kind: "deploy",
        sourceKey: "deploy:2026-10-17T12:00:00.000Z",
        title: "Deploy erkannt: Theme, Plugins",
        scope: { type: "shop", values: [] },
        actor: null,
        source: "shopWatch",
      }),
    ]);
    expect(list[0].description).toBe("Theme: all.js?1 → all.js?2\nPlugins: A 1.0 → A 1.1");
  });

  it("Preisänderungen je abgeschlossenem Tag (Berlin), je Artikel erster alter und letzter neuer Preis", () => {
    const list = actionsFromPriceChanges(
      [
        { productNumber: "B2", oldPriceGross: 100, newPriceGross: 110, changedAt: new Date("2026-10-16T22:30:00Z") }, // 0:30 am 17.10. in Berlin
        { productNumber: "A1", oldPriceGross: 50, newPriceGross: 55, changedAt: new Date("2026-10-17T08:00:00Z") },
        { productNumber: "A1", oldPriceGross: 55, newPriceGross: 60, changedAt: new Date("2026-10-17T09:00:00Z") },
        { productNumber: "C3", oldPriceGross: 10, newPriceGross: 12, changedAt: new Date("2026-10-16T08:00:00Z") },
        { productNumber: "D4", oldPriceGross: 10, newPriceGross: 12, changedAt: new Date("2026-10-19T05:00:00Z") }, // heute: noch nicht
      ],
      NOW,
    );
    expect(list.map((a) => a.sourceKey)).toEqual(["prices:2026-10-16", "prices:2026-10-17"]);
    expect(list[1]).toMatchObject({
      kind: "priceChanges",
      title: "Preisänderungen am 17.10.2026: 2 Artikel",
      scope: { type: "products", values: ["A1", "B2"] },
      occurredAt: "2026-10-17T09:00:00.000Z",
    });
    const text = list[1].description.replace(/\u00a0/g, " ");
    expect(text).toContain("A1: 50,00 € → 60,00 €");
    expect(text).toContain("B2: 100,00 € → 110,00 €");
  });

  it("ohne Dubletten: zweite Übernahme derselben Quellen legt nichts an, gleiche Schlüssel nur einmal", () => {
    const build = () => [
      ...actionsFromPublications([publication()], []),
      ...actionsFromResolvedSignals([signal()]),
      ...actionsFromDeploys([{ startedAt: "2026-10-17T12:00:00.000Z", deployChanges: [{ field: "plugins", before: "a", after: "b" }] }]),
      ...actionsFromPriceChanges([{ productNumber: "A1", oldPriceGross: 1, newPriceGross: 2, changedAt: new Date("2026-10-17T08:00:00Z") }], NOW),
    ];
    const first = newCandidates(build(), new Set());
    expect(first).toHaveLength(4);
    const stored = new Set(first.map((c) => c.sourceKey));
    expect(newCandidates(build(), stored)).toEqual([]);
    expect(newCandidates([...build(), ...build()], new Set())).toHaveLength(4);
    // neue Preisänderung an einem weiteren Tag: nur dieser Eintrag
    const more = actionsFromPriceChanges([{ productNumber: "A1", oldPriceGross: 2, newPriceGross: 3, changedAt: new Date("2026-10-18T08:00:00Z") }], NOW);
    expect(newCandidates([...build(), ...more], stored).map((c) => c.sourceKey)).toEqual(["prices:2026-10-18"]);
  });
});

describe("Eingabe von Hand", () => {
  it("Bereich bereinigt, „ganzer Shop“ ohne Werte, leere Werte = ganzer Shop", () => {
    expect(normalizeActionScope({ type: "products", values: [" A1 ", "A1", "", "B2"] })).toEqual({ type: "products", values: ["A1", "B2"] });
    expect(normalizeActionScope({ type: "shop", values: ["x"] })).toEqual({ type: "shop", values: [] });
    expect(normalizeActionScope({ type: "pages", values: [" "] })).toEqual({ type: "shop", values: [] });
    const ok = shopPulseActionInputSchema.safeParse({ occurredAt: "2026-10-18T10:00:00.000Z", title: "Kampagne pausiert", scope: { type: "channel", values: ["META Regalbau DE"] } });
    expect(ok.success && ok.data).toMatchObject({ description: "", actor: null });
    expect(shopPulseActionInputSchema.safeParse({ occurredAt: "gestern", title: "x", scope: { type: "shop" } }).success).toBe(false);
    expect(shopPulseActionInputSchema.safeParse({ occurredAt: "2026-10-18T10:00:00Z", title: " ", scope: { type: "shop" } }).success).toBe(false);
  });
});

describe("Import der Live-Protokolle", () => {
  const file = (name: string, content: unknown) => ({ name, content: JSON.stringify(content) });
  const ok = (r: ReturnType<typeof parseLiveProtocol>) => {
    if (!("candidate" in r)) throw new Error(`übersprungen: ${r.skip}`);
    return r.candidate;
  };

  it("Branchenseiten: Bereich aus den Landingpage-IDs, Zeitpunkt aus dem Inhalt, Schlüssel aus dem Dateinamen", () => {
    const kfz = INDUSTRY_PAGES.find((p) => p.key === "kfz")!;
    const c = ok(
      parseLiveProtocol(
        file("Branchenseiten-Protokoll-Live-2026-10-16-Kennzahlen.json", { tenantId: TENANT, at: "2026-10-16T08:47:24.784Z", landingPages: [industryEntityId("kfz", "lp")], cmsPages: [], faqGroups: [] }),
        TENANT,
      ),
    );
    expect(c).toMatchObject({
      kind: "liveRun",
      source: "import",
      sourceKey: "import:Branchenseiten-Protokoll-Live-2026-10-16-Kennzahlen",
      occurredAt: "2026-10-16T08:47:24.784Z",
      title: "Branchen-Landingpages (Kennzahlen)",
      scope: { type: "pages", values: [kfz.url] },
      actor: null,
    });
    expect(c.description).toContain("Protokoll: Branchenseiten-Protokoll-Live-2026-10-16-Kennzahlen.json");
  });

  it("Kartenzahlung: Zweck als Beschreibung, Kanal als Bereich; Storefront-Bausteine neu/aktualisiert", () => {
    const pay = ok(
      parseLiveProtocol(
        file("Kartenzahlung-Protokoll-Live-2026-10-17T17-02.json", { tenantId: TENANT, at: "2026-10-17T17:02:49.142Z", purpose: "Mollie-App-Kartenzahlung durch PayPal-Kartenzahlung ersetzt", before: { channel: "META Regalbau DE" }, after: { channel: "META Regalbau DE" } }),
        TENANT,
      ),
    );
    expect(pay.scope).toEqual({ type: "channel", values: ["META Regalbau DE"] });
    expect(pay.description.startsWith("Mollie-App-Kartenzahlung durch PayPal-Kartenzahlung ersetzt")).toBe(true);
    const fresh = ok(parseLiveProtocol(file("Suchseite-Protokoll-Live-2026-10-17T12-19.json", { tenantId: TENANT, at: "2026-10-17T12:19:30.932Z", base: "https://shop.meta-online.com", before: null }), TENANT));
    expect(fresh).toMatchObject({ title: "Suchergebnisseite", scope: { type: "pages", values: ["/search"] } });
    expect(fresh.description).toContain("Eintrag neu angelegt");
    const updated = ok(parseLiveProtocol(file("Suchseite-Protokoll-Live-2026-10-17T12-28.json", { tenantId: TENANT, at: "2026-10-17T12:28:14.342Z", before: { id: "x", js: "", css: "" } }), TENANT));
    expect(updated.description).toContain("Eintrag aktualisiert");
    expect(updated.sourceKey).not.toBe(fresh.sourceKey);
  });

  it("Zeitpunkt aus dem Dateinamen, wenn der Inhalt keinen hat; ältere Datei mit „tenant“ statt „tenantId“", () => {
    const c = ok(parseLiveProtocol(file("Kategorie-Layout-Protokoll-Live-2026-10-15T12-39.json", { tenant: TENANT, blocks: ["a", "b", "c", "d"] }), TENANT));
    expect(c.occurredAt).toBe("2026-10-15T12:39:00.000Z");
    expect(c.description).toContain("4 Block/Blöcke");
    const dayOnly = ok(parseLiveProtocol(file("Startseite-Rabatt-Mondu-Protokoll-Live-2026-10-16-ORIGINAL.json", { tenantId: TENANT, homeSlots: [{}, {}] }), TENANT));
    expect(dayOnly).toMatchObject({ occurredAt: "2026-10-16T12:00:00.000Z", title: "Startseiten-Abschnitte „Rabattstaffel“ und „B2B-Zahlung (Mondu)“", scope: { type: "pages", values: ["/"] } });
    expect(dayOnly.description).toContain("Uhrzeit unbekannt");
  });

  it("übersprungen: Testing, kaputtes JSON, anderer Mandant; unbekannter Lauf mit Namen", () => {
    expect(parseLiveProtocol(file("Suchseite-Protokoll-Testing-2026-10-17T12-19.json", { tenantId: TENANT }), TENANT)).toEqual({ skip: "notLive" });
    expect(parseLiveProtocol(file("irgendwas.json", {}), TENANT)).toEqual({ skip: "notLive" });
    expect(parseLiveProtocol({ name: "Suchseite-Protokoll-Live-2026-10-17T12-19.json", content: "{kaputt" }, TENANT)).toEqual({ skip: "invalidJson" });
    expect(parseLiveProtocol(file("Suchseite-Protokoll-Live-2026-10-17T12-19.json", { tenantId: "anderer" }), TENANT)).toEqual({ skip: "otherTenant" });
    const unknown = ok(parseLiveProtocol(file("Neuer-Lauf-Protokoll-Live-2026-10-18T09-00.json", { tenantId: TENANT, at: "2026-10-18T09:00:05.000Z" }), TENANT));
    expect(unknown).toMatchObject({ title: "Live-Schreiblauf Neuer Lauf", scope: { type: "shop", values: [] } });
  });

  it("idempotent: dieselbe Datei ergibt denselben Schlüssel (Pfad im Namen egal)", () => {
    const content = { tenantId: TENANT, at: "2026-10-17T10:14:11.095Z", before: null };
    const a = ok(parseLiveProtocol(file("Warenkorb-Crossselling-Protokoll-Live-2026-10-17T10-14.json", content), TENANT));
    const b = ok(parseLiveProtocol(file("C:\\Downloads\\Warenkorb-Crossselling-Protokoll-Live-2026-10-17T10-14.json", content), TENANT));
    expect(b.sourceKey).toBe(a.sourceKey);
    expect(newCandidates([a, b], new Set())).toHaveLength(1);
    expect(newCandidates([a], new Set([a.sourceKey]))).toEqual([]);
  });
});
