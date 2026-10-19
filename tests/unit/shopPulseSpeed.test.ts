/**
 * Shop-Puls Stufe 3 (S3-5): Ladezeit – PSI-Antwort auslesen (Labor und CrUX, Domain als Rückfall),
 * Messung mit simulierter API (Schlüssel, Fehler), Verlauf, Vergleich vor/nach Deploy (beide Bedingungen,
 * mindestens 2 Messungen danach), Template-Kommentare im HTML, Fälligkeit, Einrichtung.
 * Gegen die echte PageSpeed-API nicht getestet (ohne Schlüssel Kontingent 0).
 * Ausführung: npm test
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));

import {
  addToHistory,
  commentDetections,
  compareAroundDeploy,
  htmlCommentBytes,
  isSpeedDue,
  measurePage,
  parsePsi,
  speedDetections,
  speedSetupProblem,
  type SpeedDay,
  type SpeedMeasurement,
} from "../../server/shopPulse/pageSpeed";

/** Ausschnitt einer PSI-v5-Antwort (Form laut Dokumentation) */
const psi = (score: number, lcp: number, field = true) => ({
  lighthouseResult: {
    categories: { performance: { score: score / 100 } },
    audits: {
      "largest-contentful-paint": { numericValue: lcp },
      "cumulative-layout-shift": { numericValue: 0.05 },
      "total-blocking-time": { numericValue: 420 },
      "first-contentful-paint": { numericValue: 1800 },
      "speed-index": { numericValue: 3900 },
      "total-byte-weight": { numericValue: 3_400_000 },
    },
  },
  loadingExperience: field ? { overall_category: "AVERAGE", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 3100 }, INTERACTION_TO_NEXT_PAINT: { percentile: 210 }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 8 } } } : {},
  originLoadingExperience: { overall_category: "FAST", metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile: 2400 } } },
});

describe("PSI auslesen und messen", () => {
  it("Laborwerte und Felddaten der Adresse; ohne Felddaten die Domain", () => {
    expect(parsePsi("home", "https://shop/", psi(54, 4200))).toEqual({
      type: "home",
      url: "https://shop/",
      score: 54,
      lcpMs: 4200,
      cls: 0.05,
      tbtMs: 420,
      fcpMs: 1800,
      speedIndexMs: 3900,
      bytes: 3_400_000,
      field: { source: "url", lcpMs: 3100, inpMs: 210, cls: 0.08, category: "AVERAGE" },
    });
    expect(parsePsi("home", "u", psi(54, 4200, false)).field).toEqual({ source: "origin", lcpMs: 2400, inpMs: null, cls: null, category: "FAST" });
  });

  it("ruft mobil mit Schlüssel auf; API-Fehler stehen an der Messung", async () => {
    const urls: string[] = [];
    const ok = await measurePage("KEY", "home", "https://shop.example/", async (u) => (urls.push(String(u)), new Response(JSON.stringify(psi(70, 2500)))));
    expect(ok.score).toBe(70);
    expect(urls[0]).toContain("strategy=mobile");
    expect(urls[0]).toContain("key=KEY");
    expect(urls[0]).toContain("url=https%3A%2F%2Fshop.example%2F");
    const err = await measurePage("KEY", "home", "u", async () => new Response(JSON.stringify({ error: { message: "API key not valid" } }), { status: 400 }));
    expect(err).toMatchObject({ score: null, error: "API key not valid" });
  });

  it("Einrichtung: aus, ohne Schlüssel, bereit", () => {
    expect(speedSetupProblem({ enabled: false, apiKey: "x" })).toBe("disabled");
    expect(speedSetupProblem({ enabled: true, apiKey: " " })).toBe("noKey");
    expect(speedSetupProblem({ enabled: true, apiKey: "x" })).toBeNull();
  });
});

const m = (type: SpeedMeasurement["type"], score: number, lcpMs: number): SpeedMeasurement => ({ type, url: "u", score, lcpMs, cls: 0, tbtMs: 0, fcpMs: 0, speedIndexMs: 0, bytes: 0, field: null });
const day = (d: string, results: SpeedMeasurement[]): SpeedDay => ({ day: d, at: `${d}T05:00:00.000Z`, results });

describe("Vergleich vor und nach dem Deploy", () => {
  const before = ["2026-10-12", "2026-10-13", "2026-10-14"].map((d) => day(d, [m("home", 60, 3000), m("product", 50, 4000)]));
  const after1 = day("2026-10-16", [m("home", 40, 4500), m("product", 48, 4200)]);
  const after2 = day("2026-10-17", [m("home", 42, 4300), m("product", 47, 4300)]);
  const deploy = { at: "2026-10-15T20:00:00.000Z", changes: "Plugins A 1.0 → A 1.1" };

  it("erst ab 2 Messungen danach; Medians vorher/nachher", () => {
    expect(compareAroundDeploy({ days: [...before, after1] }, new Date(deploy.at))).toEqual([]);
    const c = compareAroundDeploy({ days: [...before, after1, after2] }, new Date(deploy.at));
    expect(c.find((x) => x.type === "home")).toEqual({ type: "home", before: { score: 60, lcpMs: 3000, n: 3 }, after: { score: 41, lcpMs: 4400, n: 2 } });
  });

  it("kritisch nur, wenn Leistungswert UND LCP deutlich schlechter sind", () => {
    const found = speedDetections({ days: [...before, after1, after2] }, deploy);
    expect(found).toEqual([
      expect.objectContaining({ key: "system:speed:home", code: "speedAfterDeploy", severity: "critical", params: { page: "home", path: "home", deployDay: "2026-10-15", scoreBefore: 60, scoreAfter: 41, lcpBefore: 3, lcpAfter: 4.4 } }),
    ]);
    expect(speedDetections({ days: [...before, after1, after2] }, null)).toEqual([]);
  });

  it("Verlauf: ein Tag je Datum, höchstens 60 Tage", () => {
    let h = { days: [] as SpeedDay[] };
    for (let i = 0; i < 65; i++) h = addToHistory(h, day(new Date(Date.UTC(2026, 7, 1 + i)).toISOString().slice(0, 10), []));
    h = addToHistory(h, day("2026-10-04", [m("home", 1, 1)]));
    expect(h.days).toHaveLength(60);
    expect(h.days.filter((d) => d.day === "2026-10-04")[0].results).toHaveLength(1);
  });

  it("einmal am Tag ab 6 Uhr Berlin", () => {
    expect(isSpeedDue({ days: [] }, new Date("2026-10-19T03:30:00Z"))).toBe(false);
    expect(isSpeedDue({ days: [] }, new Date("2026-10-19T04:30:00Z"))).toBe(true);
    expect(isSpeedDue({ days: [day("2026-10-19", [])] }, new Date("2026-10-19T08:00:00Z"))).toBe(false);
  });
});

describe("Template-Kommentare", () => {
  it("zählt Bytes in HTML-Kommentaren und meldet ab 300 KB", () => {
    const html = `<html><!-- ${"x".repeat(400_000)} --><body>ä</body></html>`;
    const size = htmlCommentBytes(html);
    expect(size.comments).toBe(400_009);
    expect(size.total).toBe(Buffer.byteLength(html));
    const [d] = commentDetections("/", size);
    expect(d).toMatchObject({ code: "speedHtmlComments", severity: "warning", params: { path: "/", commentsKb: 391 } });
    expect(commentDetections("/", { total: 1000, comments: 100 })).toEqual([]);
  });
});

describe("Prüfungen im Lauf", () => {
  it("Seitengewicht: Startseite über die Storefront (Sperre), Kommentare ab 300 KB", async () => {
    const { pageWeightDetector } = await import("../../server/shopPulse/detectors/speed");
    const html = `<html><!-- ${"y".repeat(320_000)} --></html>`;
    const ctx: any = { storefront: { withShop: (fn: any) => fn({ storefront: "https://shop.example", fetchImpl: async () => new Response(html, { status: 200 }), pauseMs: 0 }) } };
    const found = await pageWeightDetector.run(ctx);
    expect(found.map((d) => d.code)).toEqual(["speedHtmlComments"]);
  });

  it("PageSpeed: ohne Schlüssel ausgesetzt; mit Schlüssel 6 Seitentypen, Produktseite = Topseller, Verlauf gespeichert", async () => {
    const { pageSpeedDetector } = await import("../../server/shopPulse/detectors/speed");
    const { SpeedNotConfiguredError, DEFAULT_PAGE_PATHS } = await import("../../server/shopPulse/pageSpeed");
    const saved: any[] = [];
    const urls: string[] = [];
    const ctx = (apiKey: string): any => ({
      now: new Date("2026-10-19T05:00:00Z"),
      storefront: { withShop: (fn: any) => fn({ storefront: "https://shop.example/" }) },
      buyability: {
        products: async () => [
          { id: "p1", productNumber: "A", name: "A", active: true, salesChannelIds: ["018ec134507f703b82a76467791e7e61"], isVariant: false, childCount: 0 },
          { id: "p2", productNumber: "B", name: "B", active: true, salesChannelIds: ["018ec134507f703b82a76467791e7e61"], isVariant: false, childCount: 0 },
        ],
        revenue: async () => new Map([["A", 10], ["B", 99]]),
      },
      speed: {
        settings: async () => ({ enabled: true, apiKey, paths: { ...DEFAULT_PAGE_PATHS } }),
        history: async () => ({ days: [] }),
        saveHistory: async (h: any) => void saved.push(h),
        lastDeploy: async () => null,
        measure: async (_k: string, type: any, url: string) => (urls.push(url), { type, url, score: 50, lcpMs: 3000, cls: 0, tbtMs: 0, fcpMs: 0, speedIndexMs: 0, bytes: 0, field: null }),
      },
    });
    await expect(pageSpeedDetector.run(ctx(""))).rejects.toBeInstanceOf(SpeedNotConfiguredError);
    expect(await pageSpeedDetector.run(ctx("KEY"))).toEqual([]);
    expect(urls).toEqual([
      "https://shop.example/",
      "https://shop.example/fachbodenregale/",
      "https://shop.example/clip-grundregale",
      "https://shop.example/detail/p2",
      "https://shop.example/checkout/cart",
      "https://shop.example/search?search=fachbodenregal",
    ]);
    expect(saved[0].days[0]).toMatchObject({ day: "2026-10-19" });
  });
});
