/**
 * Shop-Puls Stufe 2 (S2-5), Search Console (nur lesend): Einrichtung, JWT-Anmeldung, Abfragen über simuliertes
 * HTTP, die sechs Prüfungen, URL-Prüfung mit Tageslimit, Wochenbericht-Abschnitt und der KI-Vorschlag für
 * Meta-Texte mit Prüfregeln. Gegen eine echte Search Console ist das nicht getestet.
 * Ausführung: npm test
 */
import { createVerify, generateKeyPairSync } from "crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import { checkGscSetup, gscProperty, GSC_INSPECTIONS_PER_DAY, normalizeProperty, signedJwt, type FetchFn, type GscRow } from "../../server/shopPulse/gscClient";
import {
  applyInspection,
  cannibalDetections,
  clickDropDetections,
  gscCatalogPaths,
  gscDataEnd,
  gscIndexDetector,
  indexDetections,
  isGscDailyDue,
  lowCtrDetections,
  nearPageOneDetections,
  planInspections,
  sitemapDetections,
  suspectsFor,
  type GscIndexState,
} from "../../server/shopPulse/detectors/gsc";
import { extractPageMeta, suggestPageMeta, validateSuggestion } from "../../server/shopPulse/gscMeta";
import { gscWeekly } from "../../server/shopPulse/weeklyReport";
import { parseLlmJsonResponse } from "../../server/ai/llmChat";
import type { ShopPulseSignal } from "../../shared/shopPulse";
import type { ShopPulseAction } from "../../shared/shopPulseWeekly";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const SA = JSON.stringify({ client_email: "puls@test.iam.gserviceaccount.com", private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" });
const NOW = new Date("2026-10-19T08:00:00Z");
const row = (keys: string[], clicks: number, impressions = 100, position = 5): GscRow => ({ keys, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });

describe("Einrichtung und Anmeldung", () => {
  it("Property: Domain oder URL-Präfix", () => {
    expect(normalizeProperty("sc-domain:Meta-Online.com")).toBe("sc-domain:meta-online.com");
    expect(normalizeProperty("https://shop.meta-online.com")).toBe("https://shop.meta-online.com/");
    expect(normalizeProperty("shop.meta-online.com")).toBeNull();
  });

  it("prüft Schalter, Property und Dienstkonto", () => {
    expect(checkGscSetup({ enabled: false, property: "", serviceAccountJson: "" })).toEqual({ ok: false, reason: "disabled" });
    expect(checkGscSetup({ enabled: true, property: "", serviceAccountJson: SA })).toEqual({ ok: false, reason: "noProperty" });
    expect(checkGscSetup({ enabled: true, property: "x", serviceAccountJson: SA })).toEqual({ ok: false, reason: "invalidProperty" });
    expect(checkGscSetup({ enabled: true, property: "sc-domain:meta-online.com", serviceAccountJson: "" })).toEqual({ ok: false, reason: "noServiceAccount" });
    expect(checkGscSetup({ enabled: true, property: "sc-domain:meta-online.com", serviceAccountJson: "{}" })).toEqual({ ok: false, reason: "invalidServiceAccount" });
    expect(checkGscSetup({ enabled: true, property: "sc-domain:meta-online.com", serviceAccountJson: SA }).ok).toBe(true);
  });

  it("JWT mit RS256, Scope nur lesend", () => {
    const jwt = signedJwt(JSON.parse(SA), NOW);
    const [h, c, sig] = jwt.split(".");
    expect(JSON.parse(Buffer.from(c, "base64url").toString())).toMatchObject({ iss: "puls@test.iam.gserviceaccount.com", scope: "https://www.googleapis.com/auth/webmasters.readonly", aud: "https://oauth2.googleapis.com/token" });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${c}`);
    expect(v.verify(publicKey, Buffer.from(sig, "base64url"))).toBe(true);
  });
});

describe("Abfragen (simuliertes HTTP)", () => {
  function fake() {
    const calls: Array<{ url: string; body: any; auth?: string }> = [];
    const fetchFn: FetchFn = async (url, init) => {
      calls.push({ url, body: init.body && url.includes("token") ? init.body : init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization });
      const json = url.includes("/token")
        ? { access_token: "tok", expires_in: 3600 }
        : url.includes("searchAnalytics")
          ? { rows: [{ keys: ["https://shop.meta-online.com/fachbodenregale/"], clicks: 10, impressions: 200, ctr: 0.05, position: 3.2 }] }
          : url.includes("sitemaps")
            ? { sitemap: [{ path: "https://shop.meta-online.com/sitemap.xml", errors: "2", warnings: "0" }] }
            : { inspectionResult: { indexStatusResult: { verdict: "NEUTRAL", coverageState: "Gefunden – zurzeit nicht indexiert" } } };
      return { ok: true, status: 200, json: async () => json, text: async () => "" };
    };
    return { calls, fetchFn };
  }
  const setup = checkGscSetup({ enabled: true, property: "sc-domain:meta-online.com", serviceAccountJson: SA });

  it("Token einmal holen, dann Suchanalyse, Sitemaps und URL-Prüfung", async () => {
    const { calls, fetchFn } = fake();
    if (!setup.ok) throw new Error("setup");
    const p = gscProperty(setup, fetchFn, () => NOW);
    const rows = await p.searchAnalytics({ startDate: "2026-09-19", endDate: "2026-10-16", dimensions: ["query"], page: "https://shop.meta-online.com/x" });
    expect(rows[0]).toEqual({ keys: ["https://shop.meta-online.com/fachbodenregale/"], clicks: 10, impressions: 200, ctr: 0.05, position: 3.2 });
    expect((await p.sitemaps())[0]).toMatchObject({ errors: 2, warnings: 0 });
    expect(await p.inspect("https://shop.meta-online.com/regal-lexikon")).toMatchObject({ verdict: "NEUTRAL" });
    expect(calls.filter((c) => c.url.includes("/token"))).toHaveLength(1);
    expect(calls[1].url).toBe("https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Ameta-online.com/searchAnalytics/query");
    expect(calls[1].body).toMatchObject({ dataState: "final", dimensions: ["query"], dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: "https://shop.meta-online.com/x" }] }] });
    expect(calls[1].auth).toBe("Bearer tok");
    expect(calls[3].body).toMatchObject({ inspectionUrl: "https://shop.meta-online.com/regal-lexikon", siteUrl: "sc-domain:meta-online.com" });
  });

  it("verständliche Fehler, ungültige Tage abgelehnt", async () => {
    if (!setup.ok) throw new Error("setup");
    const denied: FetchFn = async (url) => ({ ok: url.includes("/token"), status: url.includes("/token") ? 200 : 403, json: async () => ({ access_token: "t" }), text: async () => "" });
    await expect(gscProperty(setup, denied, () => NOW).sitemaps()).rejects.toThrow("keine Rechte");
    await expect(gscProperty(setup, denied, () => NOW).searchAnalytics({ startDate: "x", endDate: "2026-10-16", dimensions: [] })).rejects.toThrow("Ungültiger Zeitraum");
  });
});

describe("Prüfungen", () => {
  const end = gscDataEnd(NOW);

  it("Datenstand drei Tage vor heute, täglich ab 9 Uhr", () => {
    expect(end).toBe("2026-10-16");
    expect(isGscDailyDue(undefined, new Date("2026-10-19T06:00:00Z"))).toBe(false);
    expect(isGscDailyDue(undefined, NOW)).toBe(true);
  });

  it("1. Klickverlust je Seite mit Verdacht aus dem Maßnahmen-Protokoll", () => {
    const base = [row(["https://shop.meta-online.com/fachbodenregale/"], 400), row(["https://shop.meta-online.com/klein"], 40)];
    const current = [row(["https://shop.meta-online.com/fachbodenregale/"], 20), row(["https://shop.meta-online.com/klein"], 9)];
    const actions = [{ id: "a", occurredAt: "2026-10-10T08:00:00Z", kind: "contentPublish", title: "Live veröffentlicht: Fachbodenregale", scope: { type: "pages", values: ["/fachbodenregale"] } }] as unknown as ShopPulseAction[];
    const found = clickDropDetections(current, base, end, actions);
    expect(found.map((f) => f.key)).toEqual(["gsc:search:drop:/fachbodenregale"]);
    expect(found[0].params).toMatchObject({ current: 20, expected: 100, from: "2026-10-10", to: end, suspects: "2026-10-10 Live veröffentlicht: Fachbodenregale" });
    expect(suspectsFor("/andere", actions)).toEqual([]);
  });

  it("2. Klickrate deutlich unter dem Üblichen für die Position", () => {
    const pages = [1, 2, 3, 4, 5].map((i) => row([`https://s/p${i}`], 50, 1000, 3)).concat([row(["https://s/schwach"], 10, 2000, 3)]);
    const [f] = lowCtrDetections(pages, end);
    expect(f.key).toBe("gsc:search:ctr:/schwach");
    expect(f.params).toMatchObject({ impressions: 2000, ctr: 0.5, expected: 5, lostClicks: 90 });
    expect((f.evidence as any).url).toBe("https://s/schwach");
    // zu wenige Vergleichsseiten → keine Aussage
    expect(lowCtrDetections(pages.slice(2), end)).toEqual([]);
  });

  it("3. fast auf Seite 1", () => {
    const [f] = nearPageOneDetections([row(["fachbodenregal verzinkt"], 5, 900, 7.4), row(["regal"], 50, 5000, 2), row(["selten"], 1, 100, 8)], end);
    expect(f).toMatchObject({ key: "gsc:search:nearpage1", params: { count: 1 } });
    expect((f.evidence as any).queries[0]).toEqual({ query: "fachbodenregal verzinkt", impressions: 900, clicks: 5, position: 7.4 });
  });

  it("4. URL-Prüfung: je Seite einmal am Tag, Meldung erst nach 14 Tagen", () => {
    const paths = ["/regal-lexikon", "/", "/regal-lexikon/"];
    let state: GscIndexState = {};
    expect(planInspections(paths, state, NOW).sort()).toEqual(["/", "/regal-lexikon"]);
    state = applyInspection(state, "/regal-lexikon", { url: "", verdict: "NEUTRAL", coverageState: "Gefunden – zurzeit nicht indexiert", lastCrawlTime: null }, new Date("2026-10-01T08:00:00Z"));
    state = applyInspection(state, "/regal-lexikon", { url: "", verdict: "NEUTRAL", coverageState: "Gefunden – zurzeit nicht indexiert", lastCrawlTime: null }, NOW);
    expect(state["/regal-lexikon"].firstCheckedAt).toBe("2026-10-01T08:00:00.000Z");
    expect(planInspections(paths, state, NOW)).toEqual(["/"]);
    expect(indexDetections(state, paths, NOW).map((f) => f.key)).toEqual(["gsc:index:url:/regal-lexikon"]);
    expect(indexDetections(state, paths, new Date("2026-10-10T08:00:00Z"))).toEqual([]);
    expect(GSC_INSPECTIONS_PER_DAY).toBeLessThanOrEqual(2000);
  });

  it("5. Sitemap mit Fehlern oder Warnungen", () => {
    expect(sitemapDetections([{ path: "s.xml", errors: 0, warnings: 3, lastDownloaded: null, isPending: false }, { path: "ok.xml", errors: 0, warnings: 0, lastDownloaded: null, isPending: false }]).map((f) => f.key)).toEqual(["gsc:index:sitemap:s.xml"]);
  });

  it("6. zwei eigene Seiten für eine Suche", () => {
    const [f] = cannibalDetections([row(["palettenregal", "https://s/a"], 5, 150), row(["palettenregal", "https://s/b"], 3, 120), row(["palettenregal", "https://s/c"], 0, 10), row(["klein", "https://s/a"], 1, 50), row(["klein", "https://s/b"], 1, 50)], end);
    expect(f.params).toMatchObject({ count: 1 });
    expect((f.evidence as any).queries[0]).toMatchObject({ query: "palettenregal", impressions: 280, pages: [{ page: "/a" }, { page: "/b" }] });
  });

  it("Katalog des Shop-Wächters enthält die eigenen Seiten", () => {
    const paths = gscCatalogPaths();
    expect(paths).toContain("/regal-schnellkonfigurator");
    expect(paths).toContain("/fachbodenregale");
  });

  it("URL-Prüfung im Detektor speichert den Stand", async () => {
    let saved: GscIndexState | null = null;
    const inspected: string[] = [];
    const ctx: any = {
      now: NOW,
      gsc: {
        property: async () => ({ sitemaps: async () => [], inspect: async (url: string) => (inspected.push(url), { url, verdict: "PASS", coverageState: "Indexiert", lastCrawlTime: null }) }),
        catalogPaths: () => ["/", "/regal-lexikon"],
        shopBaseUrl: async () => "https://shop.meta-online.com",
        indexState: async () => ({}),
        saveIndexState: async (s: GscIndexState) => {
          saved = s;
        },
      },
    };
    expect(await gscIndexDetector.run(ctx)).toEqual([]);
    expect(inspected).toEqual(["https://shop.meta-online.com/", "https://shop.meta-online.com/regal-lexikon"]);
    expect(Object.keys(saved!)).toEqual(["/", "/regal-lexikon"]);
  });
});

describe("Wochenbericht", () => {
  it("Klicks und Listen aus den offenen Meldungen; Hinweis wenn nicht eingerichtet", () => {
    const signals = [
      { status: "open", key: "gsc:search:nearpage1", code: "gscNearPageOne", evidence: { queries: [{ query: "fachbodenregal", impressions: 900, clicks: 5, position: 7.4 }] } },
      { status: "open", key: "gsc:search:cannibal", code: "gscCannibalization", evidence: { queries: [{ query: "palettenregal", impressions: 280, pages: [{ page: "/a" }, { page: "/b" }] }] } },
      { status: "open", key: "gsc:index:url:/x", code: "gscNotIndexed", evidence: {} },
    ] as unknown as ShopPulseSignal[];
    const w = gscWeekly({ from: "2026-10-10", to: "2026-10-16", clicks: 500, impressions: 20000, previousClicks: 450 }, { from: "2026-10-10", to: "2026-10-16" }, signals);
    expect(w).toEqual({
      configured: true,
      from: "2026-10-10",
      to: "2026-10-16",
      clicks: 500,
      impressions: 20000,
      previousClicks: 450,
      nearPageOne: [{ query: "fachbodenregal", impressions: 900, clicks: 5, position: 7.4 }],
      cannibalization: [{ query: "palettenregal", impressions: 280, pages: ["/a", "/b"] }],
      notIndexed: 1,
      openCount: 3,
    });
    expect(gscWeekly(null, { from: "a", to: "b" }, [], "noProperty")).toEqual({ configured: false, problem: "noProperty" });
  });
});

describe("KI-Vorschlag für Meta-Texte", () => {
  const html = `<html><head><title>Fachbodenregale | META</title><meta name="description" content="Fachbodenregale von META in vielen Größen."></head><body><main><h1>Fachbodenregale</h1><p>Steckregale CLIP mit 5 Böden, Tragkraft 150 kg je Boden.</p></main><script>var x=1</script></body></html>`;
  const page = extractPageMeta(html);

  it("liest Title, Description, Überschrift und Text", () => {
    expect(page).toMatchObject({ title: "Fachbodenregale | META", description: "Fachbodenregale von META in vielen Größen.", h1: "Fachbodenregale" });
    expect(page.text).toContain("Tragkraft 150 kg");
    expect(page.text).not.toContain("var x");
  });

  it("Prüfregeln: Länge, keine fremden Zahlen, keine Versprechen, die die Seite nicht macht", () => {
    const ok = { metaTitle: "Fachbodenregale CLIP mit 150 kg je Boden | META", metaDescription: "Steckregale CLIP von META: Fachbodenregale mit 5 Böden und 150 kg Tragkraft je Boden, in vielen Größen für Lager und Werkstatt." };
    expect(validateSuggestion(page, ["fachbodenregal"], ok)).toBeNull();
    expect(validateSuggestion(page, [], { ...ok, metaTitle: "Kurz" })).toBe("title_length");
    expect(validateSuggestion(page, [], { ...ok, metaDescription: `${ok.metaDescription.slice(0, 100)} Jetzt versandkostenfrei bestellen.` })).toBe("claim_shipping");
    expect(validateSuggestion(page, [], { ...ok, metaTitle: "Fachbodenregale CLIP mit 300 kg je Boden | META" })).toBe("number");
  });

  it("fragt einmal nach, wenn der erste Vorschlag durchfällt", async () => {
    const answers = [
      JSON.stringify({ metaTitle: "Fachbodenregale gratis", metaDescription: "zu kurz" }),
      JSON.stringify({ metaTitle: "Fachbodenregale CLIP mit 150 kg je Boden | META", metaDescription: "Steckregale CLIP von META: Fachbodenregale mit 5 Böden und 150 kg Tragkraft je Boden, in vielen Größen für Lager und Werkstatt." }),
    ];
    const asked: string[] = [];
    const r = await suggestPageMeta(
      async (m) => {
        asked.push(m[1].content);
        return answers.shift()!;
      },
      parseLlmJsonResponse,
      { url: "https://shop.meta-online.com/fachbodenregale", page, queries: ["fachbodenregal"] },
    );
    expect(r.suggestion?.metaTitle).toBe("Fachbodenregale CLIP mit 150 kg je Boden | META");
    expect(asked[1]).toContain("fiel durch");
    const never = await suggestPageMeta(async () => "kein json", parseLlmJsonResponse, { url: "x", page, queries: [] });
    expect(never).toEqual({ suggestion: null, rejected: "empty" });
  });
});
