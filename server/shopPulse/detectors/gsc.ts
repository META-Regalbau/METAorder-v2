/**
 * Shop-Puls Stufe 2 (S2-5), Search Console: Google-Klicks, Positionen und Indexierung, nur lesend. Einmal am Tag
 * ab 9 Uhr (Berlin). Die Daten der Search Console kommen 2–3 Tage verzögert: Alle Zeiträume enden deshalb
 * drei Tage vor heute („Datenstand“). Ohne Einrichtung setzen die Prüfungen aus (Hinweis auf der Seite).
 *
 * 1. Klickverlust je Seite: 7 Tage bis zum Datenstand gegen den Wochenschnitt der 4 Wochen davor; gemeldet bei
 *    mindestens 20 erwarteten Klicks, höchstens 60 % davon und 2,5 Standardabweichungen (wie GA4). Verdacht aus
 *    dem Maßnahmen-Protokoll (Deploy, Änderung an dieser Seite) in diesen 5 Wochen.
 * 2. Viele Impressionen, wenig Klicks: Seiten mit mindestens 1.000 Impressionen in 28 Tagen auf Position ≤ 10,
 *    deren Klickrate unter der Hälfte des Üblichen für ihre Position liegt (Median der eigenen Seiten derselben
 *    gerundeten Position, mindestens 5 Seiten). Auf der Seite gibt es dazu einen KI-Vorschlag für Meta-Title
 *    und -Description, nur zur Freigabe.
 * 3. Fast auf Seite 1: Suchanfragen auf Position 5–15 mit mindestens 300 Impressionen in 28 Tagen (Liste für den
 *    Wochenbericht: Inhalte nur mit belegten META-Inhalten ausbauen).
 * 4. Neue Seiten indexiert? URL-Prüfung der eigenen Seiten aus dem Katalog des Shop-Wächters, je Seite höchstens
 *    einmal am Tag (zusammen höchstens 200 Abfragen am Tag, Google erlaubt 2.000); gemeldet, wenn eine Seite 14
 *    Tage nach ihrer ersten Prüfung noch nicht indexiert ist.
 * 5. Sitemap: Fehler oder Warnungen in einer eingereichten Sitemap.
 * 6. Zwei Seiten für eine Suche: Suchanfrage mit mindestens 200 Impressionen in 28 Tagen, bei der mindestens zwei
 *    eigene Seiten je mindestens 20 % der Impressionen haben.
 */
import type { ShopPulseDetection } from "@shared/shopPulse";
import type { ShopPulseAction } from "@shared/shopPulseWeekly";
import { addDays, berlinTime } from "../pulseOrders";
import type { GscInspection, GscProperty, GscRow, GscSitemap } from "../gscClient";
import { GSC_INSPECTIONS_PER_DAY } from "../gscClient";
import { normPage } from "../effects";
import { MAIN_LANDING_URLS, SHOP_WATCH_CHECKS } from "../../shopContent/shopWatchChecks";
import { significantDrop } from "./ga4";
import type { ShopPulseDetector, ShopPulseDetectorState } from "./types";

export const GSC_RULES = {
  delayDays: 3,
  drop: { minExpected: 20, maxShare: 0.6, z: 2.5 },
  dropListed: 10,
  ctrMinImpressions: 1000,
  ctrMaxPosition: 10,
  ctrBucketMinPages: 5,
  ctrBucketPageMinImpressions: 100,
  ctrShare: 0.5,
  ctrListed: 10,
  nearMinImpressions: 300,
  nearFrom: 5,
  nearTo: 15,
  nearListed: 20,
  indexAfterDays: 14,
  cannibalMinImpressions: 200,
  cannibalMinShare: 0.2,
  cannibalListed: 15,
} as const;

export const GSC_INDEX_STATE_KEY = "shop_pulse_gsc_index";

/** Eigene Seiten aus dem Katalog des Shop-Wächters (Prüfungen mit Adresse) und die Hauptkategorien */
export function gscCatalogPaths(): string[] {
  const urls = [...SHOP_WATCH_CHECKS.map((c) => c.url).filter((u): u is string => typeof u === "string" && u.startsWith("/")), ...MAIN_LANDING_URLS];
  return Array.from(new Set(urls.map(normPage))).sort();
}

/** Stand der URL-Prüfung je Seite (Settings-Key shop_pulse_gsc_index) */
export type GscIndexState = Record<string, { firstCheckedAt: string; lastCheckedAt: string; verdict: string; coverageState: string; lastCrawlTime: string | null }>;

/** Datenquellen der Search-Console-Prüfungen */
export type GscSources = {
  /** Property; wirft GscNotConfiguredError, wenn nicht eingerichtet */
  property(): Promise<GscProperty>;
  /** Maßnahmen ab dem Zeitpunkt (für den Verdacht beim Klickverlust) */
  actions(since: Date): Promise<ShopPulseAction[]>;
  /** eigene Seiten (Pfade) aus dem Katalog des Shop-Wächters */
  catalogPaths(): string[];
  /** Storefront-Adresse ohne Schrägstrich am Ende (für die URL-Prüfung) */
  shopBaseUrl(): Promise<string>;
  indexState(): Promise<GscIndexState>;
  saveIndexState(state: GscIndexState): Promise<void>;
};

const round1 = (x: number) => Math.round(x * 10) / 10;
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
const short = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const pathOf = (page: string) => normPage(page);

/** Letzter Tag mit verlässlichen Daten (heute − 3, Berlin) */
export const gscDataEnd = (now: Date) => addDays(berlinTime(now).day, -GSC_RULES.delayDays);

/** Einmal am Tag ab 9 Uhr; nicht eingerichtet → in jedem Takt erneut prüfen (billig, nur Einstellungen) */
export function isGscDailyDue(prev: ShopPulseDetectorState | undefined, now: Date): boolean {
  const { day, hour } = berlinTime(now);
  if (hour < 9) return false;
  if (!prev || prev.skipped) return true;
  if (!prev.ok) return now.getTime() - Date.parse(prev.at) >= 2 * 60 * 60 * 1000;
  return berlinTime(new Date(prev.at)).day !== day;
}

// ---------------------------------------------------------------------------------------------
// 1. Klickverlust

/** Maßnahmen, die eine Seite betreffen können: Deploys, ganzer Shop, oder genau diese Seite */
export function suspectsFor(path: string, actions: ShopPulseAction[]): string[] {
  return actions
    .filter((a) => a.kind === "deploy" || a.scope.type === "shop" || (a.scope.type === "pages" && a.scope.values.some((v) => normPage(v) === path)))
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 3)
    .map((a) => `${a.occurredAt.slice(0, 10)} ${short(a.title, 80)}`);
}

export function clickDropDetections(current: GscRow[], base: GscRow[], end: string, actions: ShopPulseAction[]): ShopPulseDetection[] {
  const from = addDays(end, -6);
  const cur = new Map<string, number>();
  for (const r of current) cur.set(pathOf(r.keys[0] ?? ""), (cur.get(pathOf(r.keys[0] ?? "")) ?? 0) + r.clicks);
  const baseWeekly = new Map<string, number>();
  for (const r of base) baseWeekly.set(pathOf(r.keys[0] ?? ""), (baseWeekly.get(pathOf(r.keys[0] ?? "")) ?? 0) + r.clicks / 4);
  return Array.from(baseWeekly.entries())
    .map(([path, expected]) => ({ path, expected: round1(expected), current: cur.get(path) ?? 0 }))
    .filter((p) => significantDrop(p.current, p.expected, GSC_RULES.drop))
    .sort((a, b) => b.expected - b.current - (a.expected - a.current))
    .slice(0, GSC_RULES.dropListed)
    .map((p) => {
      const suspects = suspectsFor(p.path, actions);
      return {
        key: `gsc:search:drop:${p.path}`,
        source: "gsc" as const,
        code: "gscClickDrop" as const,
        severity: "warning" as const,
        params: { page: p.path, current: p.current, expected: Math.round(p.expected), from, to: end, suspects: suspects.length ? suspects.join("; ") : "–" },
        evidence: { page: p.path, current: p.current, expectedWeekly: p.expected, suspects },
      };
    });
}

// ---------------------------------------------------------------------------------------------
// 2. Viele Impressionen, wenig Klicks

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function lowCtrDetections(pages: GscRow[], end: string): ShopPulseDetection[] {
  const buckets = new Map<number, number[]>();
  for (const r of pages) {
    if (r.impressions < GSC_RULES.ctrBucketPageMinImpressions || r.position <= 0) continue;
    const b = Math.max(1, Math.round(r.position));
    buckets.set(b, [...(buckets.get(b) ?? []), r.ctr]);
  }
  const typical = new Map(Array.from(buckets.entries()).filter(([, list]) => list.length >= GSC_RULES.ctrBucketMinPages).map(([b, list]) => [b, median(list)]));
  return pages
    .filter((r) => r.impressions >= GSC_RULES.ctrMinImpressions && r.position > 0 && r.position <= GSC_RULES.ctrMaxPosition)
    .map((r) => ({ r, expected: typical.get(Math.max(1, Math.round(r.position))) }))
    .filter((x): x is { r: GscRow; expected: number } => x.expected != null && x.r.ctr < x.expected * GSC_RULES.ctrShare)
    .map((x) => ({ ...x, lost: Math.round(x.r.impressions * (x.expected - x.r.ctr)) }))
    .sort((a, b) => b.lost - a.lost)
    .slice(0, GSC_RULES.ctrListed)
    .map(({ r, expected, lost }) => {
      const path = pathOf(r.keys[0] ?? "");
      return {
        key: `gsc:search:ctr:${path}`,
        source: "gsc" as const,
        code: "gscLowCtr" as const,
        severity: "warning" as const,
        params: { page: path, impressions: r.impressions, ctr: round1(r.ctr * 100), expected: round1(expected * 100), position: round1(r.position), lostClicks: lost, to: end },
        evidence: { page: path, url: r.keys[0] ?? "", impressions: r.impressions, clicks: r.clicks, ctr: r.ctr, position: r.position, typicalCtr: expected, days: 28 },
      };
    });
}

// ---------------------------------------------------------------------------------------------
// 3. Fast auf Seite 1

export function nearPageOneDetections(queries: GscRow[], end: string): ShopPulseDetection[] {
  const list = queries
    .filter((r) => r.impressions >= GSC_RULES.nearMinImpressions && r.position >= GSC_RULES.nearFrom && r.position <= GSC_RULES.nearTo)
    .sort((a, b) => b.impressions - a.impressions);
  if (!list.length) return [];
  return [
    {
      key: "gsc:search:nearpage1",
      source: "gsc",
      code: "gscNearPageOne",
      severity: "warning",
      params: {
        count: list.length,
        examples: list
          .slice(0, 5)
          .map((r) => `„${short(r.keys[0] ?? "", 40)}“ (Pos. ${round1(r.position).toLocaleString("de-DE")})`)
          .join(", "),
        to: end,
      },
      evidence: { days: 28, queries: list.slice(0, GSC_RULES.nearListed).map((r) => ({ query: r.keys[0] ?? "", impressions: r.impressions, clicks: r.clicks, position: round1(r.position) })) },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// 4. Indexierung

export type IndexPlan = { toInspect: string[]; state: GscIndexState };

/** Welche Seiten heute geprüft werden (je Seite einmal am Tag, zusammen höchstens das Tageslimit) */
export function planInspections(paths: string[], state: GscIndexState, now: Date): string[] {
  const today = berlinTime(now).day;
  return Array.from(new Set(paths.map(normPage)))
    .filter((p) => !state[p] || berlinTime(new Date(state[p].lastCheckedAt)).day !== today)
    .sort((a, b) => (state[a]?.lastCheckedAt ?? "").localeCompare(state[b]?.lastCheckedAt ?? ""))
    .slice(0, GSC_INSPECTIONS_PER_DAY);
}

export function applyInspection(state: GscIndexState, path: string, r: GscInspection, now: Date): GscIndexState {
  const prev = state[path];
  return { ...state, [path]: { firstCheckedAt: prev?.firstCheckedAt ?? now.toISOString(), lastCheckedAt: now.toISOString(), verdict: r.verdict, coverageState: r.coverageState, lastCrawlTime: r.lastCrawlTime } };
}

export function indexDetections(state: GscIndexState, paths: string[], now: Date): ShopPulseDetection[] {
  const limit = now.getTime() - GSC_RULES.indexAfterDays * 24 * 60 * 60 * 1000;
  return Array.from(new Set(paths.map(normPage)))
    .map((p) => ({ p, s: state[p] }))
    .filter(({ s }) => s && s.verdict !== "PASS" && Date.parse(s.firstCheckedAt) <= limit)
    .map(({ p, s }) => ({
      key: `gsc:index:url:${p}`,
      source: "gsc" as const,
      code: "gscNotIndexed" as const,
      severity: "warning" as const,
      params: { page: p, coverage: s!.coverageState || s!.verdict, since: s!.firstCheckedAt.slice(0, 10) },
      evidence: { ...s },
    }));
}

// ---------------------------------------------------------------------------------------------
// 5. Sitemap

export function sitemapDetections(sitemaps: GscSitemap[]): ShopPulseDetection[] {
  return sitemaps
    .filter((s) => s.errors > 0 || s.warnings > 0)
    .map((s) => ({
      key: `gsc:index:sitemap:${s.path}`,
      source: "gsc" as const,
      code: "gscSitemapIssues" as const,
      severity: "warning" as const,
      params: { sitemap: s.path, errors: s.errors, warnings: s.warnings },
      evidence: { ...s },
    }));
}

// ---------------------------------------------------------------------------------------------
// 6. Zwei Seiten für eine Suche

export function cannibalDetections(queryPages: GscRow[], end: string): ShopPulseDetection[] {
  const byQuery = new Map<string, Array<{ page: string; impressions: number; clicks: number; position: number }>>();
  for (const r of queryPages) {
    const q = (r.keys[0] ?? "").trim();
    if (!q) continue;
    byQuery.set(q, [...(byQuery.get(q) ?? []), { page: pathOf(r.keys[1] ?? ""), impressions: r.impressions, clicks: r.clicks, position: round1(r.position) }]);
  }
  const hits = Array.from(byQuery.entries())
    .map(([query, pages]) => {
      const total = sum(pages.map((p) => p.impressions));
      const strong = pages.filter((p) => total > 0 && p.impressions / total >= GSC_RULES.cannibalMinShare).sort((a, b) => b.impressions - a.impressions);
      return { query, total, strong };
    })
    .filter((h) => h.total >= GSC_RULES.cannibalMinImpressions && h.strong.length >= 2)
    .sort((a, b) => b.total - a.total);
  if (!hits.length) return [];
  return [
    {
      key: "gsc:search:cannibal",
      source: "gsc",
      code: "gscCannibalization",
      severity: "warning",
      params: {
        count: hits.length,
        examples: hits
          .slice(0, 3)
          .map((h) => `„${short(h.query, 40)}“: ${h.strong.map((p) => p.page).slice(0, 3).join(" / ")}`)
          .join("; "),
        to: end,
      },
      evidence: { days: 28, queries: hits.slice(0, GSC_RULES.cannibalListed).map((h) => ({ query: h.query, impressions: h.total, pages: h.strong.slice(0, 4) })) },
    },
  ];
}

// ---------------------------------------------------------------------------------------------
// Detektoren

/** Suchanalyse: Klickverlust, Klickrate, fast Seite 1, zwei Seiten (fünf Abfragen) */
export const gscSearchDetector: ShopPulseDetector = {
  id: "gscSearch",
  source: "gsc",
  keyPrefix: "gsc:search:",
  due: isGscDailyDue,
  async run(ctx) {
    const property = await ctx.gsc.property();
    const end = gscDataEnd(ctx.now);
    const current = await property.searchAnalytics({ startDate: addDays(end, -6), endDate: end, dimensions: ["page"] });
    const base = await property.searchAnalytics({ startDate: addDays(end, -34), endDate: addDays(end, -7), dimensions: ["page"] });
    const pages = await property.searchAnalytics({ startDate: addDays(end, -27), endDate: end, dimensions: ["page"] });
    const queries = await property.searchAnalytics({ startDate: addDays(end, -27), endDate: end, dimensions: ["query"] });
    const queryPages = await property.searchAnalytics({ startDate: addDays(end, -27), endDate: end, dimensions: ["query", "page"], rowLimit: 25000 });
    const actions = await ctx.gsc.actions(new Date(Date.parse(`${addDays(end, -34)}T00:00:00Z`))).catch(() => []);
    return [...clickDropDetections(current, base, end, actions), ...lowCtrDetections(pages, end), ...nearPageOneDetections(queries, end), ...cannibalDetections(queryPages, end)];
  },
};

/** Sitemaps und URL-Prüfung der eigenen Seiten */
export const gscIndexDetector: ShopPulseDetector = {
  id: "gscIndex",
  source: "gsc",
  keyPrefix: "gsc:index:",
  due: isGscDailyDue,
  async run(ctx) {
    const property = await ctx.gsc.property();
    const found = sitemapDetections(await property.sitemaps());
    const paths = ctx.gsc.catalogPaths();
    let state = await ctx.gsc.indexState();
    const toInspect = planInspections(paths, state, ctx.now);
    if (toInspect.length) {
      const base = await ctx.gsc.shopBaseUrl();
      for (const p of toInspect) state = applyInspection(state, p, await property.inspect(`${base}${p === "/" ? "/" : p}`), ctx.now);
      await ctx.gsc.saveIndexState(state);
    }
    return [...found, ...indexDetections(state, paths, ctx.now)];
  },
};

export const GSC_DETECTORS: ShopPulseDetector[] = [gscSearchDetector, gscIndexDetector];
