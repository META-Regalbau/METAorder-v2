/**
 * Shop-Puls Stufe 3 (S3-5), Ladezeit und Core Web Vitals (Konzept 19.10.2026, Abschnitt 3; Tests in
 * tests/unit/shopPulseSpeed.test.ts).
 *
 * Einmal am Tag je Seitentyp (Startseite, Kategorie-Landingpage, Listing, Produktseite, Warenkorb, Suche) eine
 * Messung über die PageSpeed-Insights-API v5 (mobil, Kategorie Leistung): Laborwerte aus Lighthouse
 * (Leistungswert, LCP, CLS, TBT, FCP, Speed Index, Seitengewicht) und Felddaten echter Nutzer aus dem Chrome UX
 * Report, die PSI mitliefert (loadingExperience je Adresse, sonst originLoadingExperience der Domain: LCP, INP,
 * CLS als 75. Perzentil der letzten 28 Tage).
 *
 * Verschlechterung nach einem Deploy (vom Shop-Wächter erkannt, Shopware-Version oder Plugins): Median der
 * Messungen vor dem Deploy (bis 7 Tage) gegen den Median danach, sobald es danach mindestens 2 Messungen gibt.
 * Gemeldet (kritisch, an Oliver mit Vorher/Nachher), wenn der Leistungswert um mindestens 15 Punkte fällt UND
 * der LCP um mindestens 30 % (und 500 ms) steigt – Laborwerte schwanken, eine Bedingung allein wäre Lärm.
 * Ohne API-Schlüssel setzt die Prüfung aus (Hinweis „nicht eingerichtet“ auf der Seite).
 */
import { PAGE_SPEED_TYPES, type PageSpeedType, type ShopPulseDetection, type SpeedSetupProblem } from "@shared/shopPulse";
import type { IStorage } from "../storage";
import { decrypt, encrypt } from "../lib/encryption";
import { berlinTime } from "./pulseOrders";

export const PAGE_SPEED_SETTINGS_KEY = "pagespeed_settings";
export const PAGE_SPEED_HISTORY_KEY = "shop_pulse_speed_history";
export const PAGE_TYPES = PAGE_SPEED_TYPES;
export type PageType = PageSpeedType;

/** Pfade je Seitentyp (Produktseite: leer = umsatzstärkster kaufbarer Artikel über die Admin-API) */
export const DEFAULT_PAGE_PATHS: Record<PageType, string> = {
  home: "/",
  landing: "/fachbodenregale/",
  listing: "/clip-grundregale",
  product: "",
  cart: "/checkout/cart",
  search: "/search?search=fachbodenregal",
};

export const SPEED_RULE = { scoreDrop: 15, lcpRatio: 1.3, lcpMinMs: 500, minAfter: 2, beforeDays: 7, historyDays: 60 } as const;
const PSI_URL = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";
const TIMEOUT_MS = 90_000;


export class SpeedNotConfiguredError extends Error {
  constructor(readonly reason: SpeedSetupProblem) {
    super(`PageSpeed nicht eingerichtet (${reason})`);
    this.name = "SpeedNotConfiguredError";
  }
}

export type PageSpeedSettings = { enabled: boolean; apiKey: string; paths: Record<PageType, string> };

export async function getPageSpeedSettings(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<PageSpeedSettings> {
  const raw = await storage.getSetting(PAGE_SPEED_SETTINGS_KEY, tenantId);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let apiKey = "";
  if (typeof r.apiKey === "string" && r.apiKey) {
    try {
      apiKey = decrypt(r.apiKey);
    } catch {
      apiKey = "";
    }
  }
  const stored = r.paths && typeof r.paths === "object" ? (r.paths as Record<string, unknown>) : {};
  const paths = Object.fromEntries(PAGE_TYPES.map((t) => [t, typeof stored[t] === "string" ? String(stored[t]).trim() : DEFAULT_PAGE_PATHS[t]])) as Record<PageType, string>;
  return { enabled: r.enabled === true, apiKey, paths };
}

/** Speichern; apiKey undefined = alten behalten, "" = löschen */
export async function savePageSpeedSettings(
  storage: Pick<IStorage, "getSetting" | "saveSetting">,
  tenantId: string | null,
  update: { enabled?: boolean; apiKey?: string; paths?: Partial<Record<PageType, string>> },
): Promise<void> {
  const raw = await storage.getSetting(PAGE_SPEED_SETTINGS_KEY, tenantId);
  const current = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...current };
  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.apiKey !== undefined) next.apiKey = update.apiKey.trim() ? encrypt(update.apiKey.trim()) : "";
  if (update.paths) next.paths = { ...((current.paths as object) ?? {}), ...update.paths };
  await storage.saveSetting(PAGE_SPEED_SETTINGS_KEY, next, tenantId);
}

export function speedSetupProblem(s: Pick<PageSpeedSettings, "enabled" | "apiKey">): SpeedSetupProblem | null {
  if (!s.enabled) return "disabled";
  if (!s.apiKey.trim()) return "noKey";
  return null;
}

// ---------------------------------------------------------------------------------------------
// Messung

export type FieldMetrics = { source: "url" | "origin"; lcpMs: number | null; inpMs: number | null; cls: number | null; category: string | null };

export type SpeedMeasurement = {
  type: PageType;
  url: string;
  /** Leistungswert 0–100 (mobil) */
  score: number | null;
  lcpMs: number | null;
  cls: number | null;
  tbtMs: number | null;
  fcpMs: number | null;
  speedIndexMs: number | null;
  bytes: number | null;
  field: FieldMetrics | null;
  error?: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function fieldOf(exp: any, source: "url" | "origin"): FieldMetrics | null {
  const m = exp?.metrics;
  if (!m || typeof m !== "object" || !Object.keys(m).length) return null;
  const cls = num(m.CUMULATIVE_LAYOUT_SHIFT_SCORE?.percentile);
  return {
    source,
    lcpMs: num(m.LARGEST_CONTENTFUL_PAINT_MS?.percentile),
    inpMs: num(m.INTERACTION_TO_NEXT_PAINT?.percentile),
    // CrUX liefert CLS als Perzentil × 100 (z. B. 12 = 0,12)
    cls: cls === null ? null : cls / 100,
    category: typeof exp.overall_category === "string" ? exp.overall_category : null,
  };
}

/** Antwort der PSI-API v5 auslesen */
export function parsePsi(type: PageType, url: string, body: any): SpeedMeasurement {
  const lr = body?.lighthouseResult;
  const audits = lr?.audits ?? {};
  const score = num(lr?.categories?.performance?.score);
  return {
    type,
    url,
    score: score === null ? null : Math.round(score * 100),
    lcpMs: num(audits["largest-contentful-paint"]?.numericValue),
    cls: num(audits["cumulative-layout-shift"]?.numericValue),
    tbtMs: num(audits["total-blocking-time"]?.numericValue),
    fcpMs: num(audits["first-contentful-paint"]?.numericValue),
    speedIndexMs: num(audits["speed-index"]?.numericValue),
    bytes: num(audits["total-byte-weight"]?.numericValue),
    field: fieldOf(body?.loadingExperience, "url") ?? fieldOf(body?.originLoadingExperience, "origin"),
  };
}

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

/** Eine Seite messen (mobil); Fehler der API als error an der Messung, nicht als Ausnahme */
export async function measurePage(apiKey: string, type: PageType, url: string, fetchImpl: FetchLike = fetch): Promise<SpeedMeasurement> {
  const q = new URLSearchParams({ url, strategy: "mobile", category: "performance", key: apiKey });
  try {
    const res = await fetchImpl(`${PSI_URL}?${q.toString()}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const message = String(body?.error?.message ?? `HTTP ${res.status}`).slice(0, 300);
      return { ...parsePsi(type, url, null), error: message };
    }
    return parsePsi(type, url, body);
  } catch (err) {
    return { ...parsePsi(type, url, null), error: err instanceof Error ? err.message.slice(0, 300) : String(err) };
  }
}

// ---------------------------------------------------------------------------------------------
// Verlauf und Vergleich

export type SpeedDay = { day: string; at: string; results: SpeedMeasurement[] };
export type SpeedHistory = { days: SpeedDay[] };

export function addToHistory(history: SpeedHistory, day: SpeedDay): SpeedHistory {
  const days = [...history.days.filter((d) => d.day !== day.day), day].sort((a, b) => a.day.localeCompare(b.day));
  return { days: days.slice(-SPEED_RULE.historyDays) };
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export type SpeedCompare = { type: PageType; before: { score: number; lcpMs: number; n: number }; after: { score: number; lcpMs: number; n: number } };

/** Vergleich vor/nach dem Deploy je Seitentyp (nur mit genug Messungen) */
export function compareAroundDeploy(history: SpeedHistory, deployAt: Date): SpeedCompare[] {
  const deployDay = berlinTime(deployAt).day;
  const out: SpeedCompare[] = [];
  for (const type of PAGE_TYPES) {
    const values = (days: SpeedDay[]) =>
      days.flatMap((d) => d.results.filter((r) => r.type === type && !r.error && r.score !== null && r.lcpMs !== null).map((r) => ({ score: r.score!, lcpMs: r.lcpMs! })));
    const beforeDays = history.days.filter((d) => Date.parse(d.at) < deployAt.getTime() && d.day >= shiftDay(deployDay, -SPEED_RULE.beforeDays));
    const afterDays = history.days.filter((d) => Date.parse(d.at) > deployAt.getTime());
    const before = values(beforeDays);
    const after = values(afterDays);
    if (!before.length || after.length < SPEED_RULE.minAfter) continue;
    out.push({
      type,
      before: { score: median(before.map((v) => v.score)), lcpMs: Math.round(median(before.map((v) => v.lcpMs))), n: before.length },
      after: { score: median(after.map((v) => v.score)), lcpMs: Math.round(median(after.map((v) => v.lcpMs))), n: after.length },
    });
  }
  return out;
}

function shiftDay(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const isWorse = (c: SpeedCompare) =>
  c.before.score - c.after.score >= SPEED_RULE.scoreDrop && c.after.lcpMs >= c.before.lcpMs * SPEED_RULE.lcpRatio && c.after.lcpMs - c.before.lcpMs >= SPEED_RULE.lcpMinMs;

/** Funde: je Seitentyp mit deutlicher Verschlechterung nach dem letzten Deploy eine kritische Meldung */
export function speedDetections(history: SpeedHistory, deploy: { at: string; changes: string } | null): ShopPulseDetection[] {
  if (!deploy) return [];
  const pathOf = (type: PageType) => {
    const url = [...history.days].reverse().flatMap((d) => d.results).find((r) => r.type === type)?.url ?? "";
    try {
      const u = new URL(url);
      return `${u.pathname}${u.search}`;
    } catch {
      return type;
    }
  };
  return compareAroundDeploy(history, new Date(deploy.at))
    .filter(isWorse)
    .map((c) => ({
      key: `system:speed:${c.type}`,
      source: "system" as const,
      code: "speedAfterDeploy" as const,
      severity: "critical" as const,
      params: {
        page: c.type,
        path: pathOf(c.type),
        deployDay: berlinTime(new Date(deploy.at)).day,
        scoreBefore: c.before.score,
        scoreAfter: c.after.score,
        lcpBefore: Math.round(c.before.lcpMs / 100) / 10,
        lcpAfter: Math.round(c.after.lcpMs / 100) / 10,
      },
      evidence: { deployAt: deploy.at, deployChanges: deploy.changes, before: c.before, after: c.after },
    }));
}

/** Fällig: einmal am Tag ab 6 Uhr Berlin (vor dem Tagesbericht) */
export function isSpeedDue(history: SpeedHistory, now: Date): boolean {
  const { day, hour } = berlinTime(now);
  return hour >= 6 && !history.days.some((d) => d.day === day);
}

// ---------------------------------------------------------------------------------------------
// Template-Kommentare im HTML (Befund aus dem SEO/GEO-Audit 16.10.2026: rund 1,3 MB auf der Startseite)

/** Ab so vielen Bytes HTML-Kommentaren auf der Startseite wird gemeldet (Warnung, Agentur-Liste) */
export const HTML_COMMENT_LIMIT_BYTES = 300_000;

/** Bytes der Seite und davon in HTML-Kommentaren (<!-- … -->, UTF-8) */
export function htmlCommentBytes(html: string): { total: number; comments: number } {
  const total = Buffer.byteLength(html, "utf8");
  let comments = 0;
  for (const m of html.matchAll(/<!--[\s\S]*?-->/g)) comments += Buffer.byteLength(m[0], "utf8");
  return { total, comments };
}

export function commentDetections(path: string, size: { total: number; comments: number }): ShopPulseDetection[] {
  if (size.comments < HTML_COMMENT_LIMIT_BYTES) return [];
  return [
    {
      key: `system:html-comments:${path}`,
      source: "system",
      code: "speedHtmlComments",
      severity: "warning",
      params: { path, commentsKb: Math.round(size.comments / 1024), totalKb: Math.round(size.total / 1024), share: Math.round((size.comments / size.total) * 1000) / 10 },
      evidence: { bytes: size },
    },
  ];
}
