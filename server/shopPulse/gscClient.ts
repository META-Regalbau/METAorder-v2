/**
 * Shop-Puls Stufe 2 (S2-5), Search-Console-Anbindung, nur lesend: Dienstkonto (JSON, verschlüsselt wie bei GA4)
 * mit Leserechten in der Property des Shops. Einstellungen: Settings-Key search_console_settings
 * (Schalter, Property „sc-domain:…“ oder URL-Präfix „https://…/“, Dienstkonto-JSON).
 *
 * Anmeldung per JWT (RS256, Scope webmasters.readonly) direkt gegen den Token-Endpunkt aus dem Dienstkonto,
 * ohne zusätzliche Bibliothek. Genutzt werden Suchanalyse (searchAnalytics.query), Sitemaps (sitemaps.list)
 * und URL-Prüfung (urlInspection.index.inspect, Google erlaubt 2.000 je Tag und Property; der Shop-Puls nutzt
 * höchstens GSC_INSPECTIONS_PER_DAY). Abfragen nacheinander.
 *
 * Fehlt etwas, wirft der Zugriff GscNotConfiguredError; die Prüfungen setzen dann aus (Hinweis auf der Seite).
 * Tests simulieren HTTP (tests/unit/shopPulseGsc.test.ts); gegen eine echte Search Console ist das nicht
 * getestet (es ist offen, wem die Property gehört).
 */
import { createSign } from "crypto";
import type { GscSetupProblem } from "@shared/shopPulse";
import type { IStorage } from "../storage";
import { decrypt, encrypt } from "../lib/encryption";

export const GSC_SETTINGS_KEY = "search_console_settings";
export const GSC_SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";
export const GSC_INSPECTIONS_PER_DAY = 200;
const TIMEOUT_MS = 20_000;

export class GscNotConfiguredError extends Error {
  constructor(readonly reason: GscSetupProblem) {
    super(`Search Console nicht eingerichtet (${reason})`);
    this.name = "GscNotConfiguredError";
  }
}

export type GscSettings = { enabled: boolean; property: string; serviceAccountJson: string };

/** Einstellungen (Dienstkonto entschlüsselt) */
export async function getGscSettings(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<GscSettings> {
  const raw = await storage.getSetting(GSC_SETTINGS_KEY, tenantId);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let json = "";
  if (typeof r.serviceAccountJson === "string" && r.serviceAccountJson) {
    try {
      json = decrypt(r.serviceAccountJson);
    } catch {
      json = "";
    }
  }
  return { enabled: r.enabled === true, property: typeof r.property === "string" ? r.property.trim() : "", serviceAccountJson: json };
}

/** Speichern; serviceAccountJson undefined = altes behalten, "" = löschen */
export async function saveGscSettings(storage: Pick<IStorage, "getSetting" | "saveSetting">, tenantId: string | null, update: { enabled?: boolean; property?: string; serviceAccountJson?: string }): Promise<void> {
  const raw = await storage.getSetting(GSC_SETTINGS_KEY, tenantId);
  const current = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...current };
  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.property !== undefined) next.property = update.property.trim();
  if (update.serviceAccountJson !== undefined) next.serviceAccountJson = update.serviceAccountJson.trim() ? encrypt(update.serviceAccountJson.trim()) : "";
  await storage.saveSetting(GSC_SETTINGS_KEY, next, tenantId);
}

export type GscCredentials = { client_email: string; private_key: string; token_uri: string };
export type GscSetup = { ok: true; property: string; credentials: GscCredentials } | { ok: false; reason: GscSetupProblem };

/** Property: „sc-domain:beispiel.de“ oder URL-Präfix mit http(s) und Schrägstrich am Ende */
export function normalizeProperty(raw: string): string | null {
  const p = raw.trim();
  if (/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(p)) return p.toLowerCase();
  if (/^https?:\/\/[^\s/]+(\/[^\s]*)?$/i.test(p)) return p.endsWith("/") ? p : `${p}/`;
  return null;
}

export function checkGscSetup(s: GscSettings): GscSetup {
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (!s.property.trim()) return { ok: false, reason: "noProperty" };
  const property = normalizeProperty(s.property);
  if (!property) return { ok: false, reason: "invalidProperty" };
  if (!s.serviceAccountJson.trim()) return { ok: false, reason: "noServiceAccount" };
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(s.serviceAccountJson);
  } catch {
    return { ok: false, reason: "invalidServiceAccount" };
  }
  if (typeof c?.client_email !== "string" || typeof c?.private_key !== "string") return { ok: false, reason: "invalidServiceAccount" };
  const tokenUri = typeof c.token_uri === "string" && c.token_uri.startsWith("https://") ? c.token_uri : "https://oauth2.googleapis.com/token";
  return { ok: true, property, credentials: { client_email: c.client_email, private_key: c.private_key, token_uri: tokenUri } };
}

// ---------------------------------------------------------------------------------------------
// HTTP

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

/** Signiertes JWT für den Token-Austausch (RS256) */
export function signedJwt(c: GscCredentials, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: c.client_email, scope: GSC_SCOPE, aud: c.token_uri, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(c.private_key))}`;
}

function explain(status: number, body: string): Error {
  if (status === 401 || /invalid_grant|unauthorized_client/i.test(body)) return new Error("Search Console: Anmeldung mit dem Dienstkonto gescheitert");
  if (status === 403) return new Error("Search Console: Das Dienstkonto hat keine Rechte in dieser Property");
  if (status === 404) return new Error("Search Console: Property nicht gefunden");
  if (status === 429) return new Error("Search Console: Kontingent erschöpft");
  return new Error(`Search Console: HTTP ${status}`);
}

export type GscRow = { keys: string[]; clicks: number; impressions: number; ctr: number; position: number };
export type GscQuery = { startDate: string; endDate: string; dimensions: Array<"page" | "query" | "date">; rowLimit?: number; /** nur diese Seite (volle Adresse) */ page?: string };
export type GscSitemap = { path: string; errors: number; warnings: number; lastDownloaded: string | null; isPending: boolean };
/** Ergebnis der URL-Prüfung: Urteil (PASS = indexiert), Abdeckung laut Google, letzter Crawl */
export type GscInspection = { url: string; verdict: string; coverageState: string; lastCrawlTime: string | null };

export type GscProperty = {
  property: string;
  searchAnalytics(q: GscQuery): Promise<GscRow[]>;
  sitemaps(): Promise<GscSitemap[]>;
  inspect(url: string): Promise<GscInspection>;
};

export type GscAccess = { property(): Promise<GscProperty> };

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function gscProperty(setup: Extract<GscSetup, { ok: true }>, fetchFn: FetchFn, now: () => Date = () => new Date()): GscProperty {
  let token: { value: string; until: number } | null = null;
  /** Abruf mit Zeitlimit */
  const timed: FetchFn = async (url, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetchFn(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const call = async (method: string, url: string, body?: unknown): Promise<any> => {
    if (!token || token.until <= now().getTime()) {
      const res = await timed(setup.credentials.token_uri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: signedJwt(setup.credentials, now()) }).toString(),
      });
      if (!res.ok) throw explain(res.status, await res.text().catch(() => ""));
      const j = await res.json();
      token = { value: String(j.access_token ?? ""), until: now().getTime() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
    }
    const res = await timed(url, { method, headers: { authorization: `Bearer ${token.value}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw explain(res.status, await res.text().catch(() => ""));
    return res.json();
  };
  const site = encodeURIComponent(setup.property);
  return {
    property: setup.property,
    async searchAnalytics(q) {
      if (!ISO_DAY.test(q.startDate) || !ISO_DAY.test(q.endDate)) throw new Error("Ungültiger Zeitraum");
      const j = await call("POST", `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`, {
        startDate: q.startDate,
        endDate: q.endDate,
        dimensions: q.dimensions,
        rowLimit: q.rowLimit ?? 5000,
        dataState: "final",
        ...(q.page ? { dimensionFilterGroups: [{ filters: [{ dimension: "page", operator: "equals", expression: q.page }] }] } : {}),
      });
      return (Array.isArray(j?.rows) ? j.rows : []).map((r: any) => ({
        keys: Array.isArray(r.keys) ? r.keys.map(String) : [],
        clicks: Number(r.clicks) || 0,
        impressions: Number(r.impressions) || 0,
        ctr: Number(r.ctr) || 0,
        position: Number(r.position) || 0,
      }));
    },
    async sitemaps() {
      const j = await call("GET", `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/sitemaps`);
      return (Array.isArray(j?.sitemap) ? j.sitemap : []).map((s: any) => ({
        path: String(s.path ?? ""),
        errors: Number(s.errors) || 0,
        warnings: Number(s.warnings) || 0,
        lastDownloaded: typeof s.lastDownloaded === "string" ? s.lastDownloaded : null,
        isPending: s.isPending === true,
      }));
    },
    async inspect(url) {
      const j = await call("POST", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", { inspectionUrl: url, siteUrl: setup.property, languageCode: "de-DE" });
      const r = j?.inspectionResult?.indexStatusResult ?? {};
      return { url, verdict: String(r.verdict ?? "VERDICT_UNSPECIFIED"), coverageState: String(r.coverageState ?? ""), lastCrawlTime: typeof r.lastCrawlTime === "string" ? r.lastCrawlTime : null };
    },
  };
}

/** Search Console des Mandanten; Einstellungen und Token je Lauf einmal */
export function gscAccess(storage: Pick<IStorage, "getSetting">, tenantId: string | null, fetchFn: FetchFn = fetch as unknown as FetchFn): GscAccess {
  let p: Promise<GscProperty> | null = null;
  return {
    property: () =>
      (p ??= (async () => {
        const setup = checkGscSetup(await getGscSettings(storage, tenantId));
        if (!setup.ok) throw new GscNotConfiguredError(setup.reason);
        return gscProperty(setup, fetchFn);
      })()),
  };
}
