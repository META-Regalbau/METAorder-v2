/**
 * Shop-Puls Stufe 3 (S3-6), Google-Merchant-Center-Anbindung, nur lesend (Merchant API, Nachfolger der Content
 * API for Shopping). Einstellungen: Settings-Key merchant_center_settings (Schalter, Händler-ID, Dienstkonto-JSON
 * verschlüsselt wie bei Search Console und GA4). Das Dienstkonto braucht im Merchant Center Lesezugriff.
 *
 * Anmeldung per JWT (RS256, Scope content) direkt gegen den Token-Endpunkt aus dem Dienstkonto, ohne zusätzliche
 * Bibliothek. Gelesen wird nur die Artikelliste (products.list, seitenweise, 1.000 je Seite) mit Status je Ziel
 * und Problemen je Artikel. Fehlt etwas, wirft der Zugriff MerchantNotConfiguredError; die Prüfung setzt dann aus.
 *
 * Tests simulieren HTTP (tests/unit/shopPulseMerchant.test.ts). **Gegen ein echtes Merchant Center ist das nicht
 * getestet** (Zugang liegt vermutlich bei Smarketer); Feldnamen nach der Dokumentation der Merchant API v1,
 * ältere Namen (attributes statt productAttributes) werden mitgelesen.
 */
import { createSign } from "crypto";
import type { IStorage } from "../storage";
import { decrypt, encrypt } from "../lib/encryption";
import { MERCHANT_SETUP_PROBLEMS, type MerchantSetupProblem } from "@shared/shopPulse";

export const MERCHANT_SETTINGS_KEY = "merchant_center_settings";
export const MERCHANT_SCOPE = "https://www.googleapis.com/auth/content";
export const MERCHANT_API_BASE = "https://merchantapi.googleapis.com/products/v1";
const TIMEOUT_MS = 30_000;
const MAX_PAGES = 50;

export { MERCHANT_SETUP_PROBLEMS };

export class MerchantNotConfiguredError extends Error {
  constructor(readonly reason: MerchantSetupProblem) {
    super(`Merchant Center nicht eingerichtet (${reason})`);
    this.name = "MerchantNotConfiguredError";
  }
}

export type MerchantSettings = { enabled: boolean; merchantId: string; serviceAccountJson: string };

export async function getMerchantSettings(storage: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<MerchantSettings> {
  const raw = await storage.getSetting(MERCHANT_SETTINGS_KEY, tenantId);
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  let json = "";
  if (typeof r.serviceAccountJson === "string" && r.serviceAccountJson) {
    try {
      json = decrypt(r.serviceAccountJson);
    } catch {
      json = "";
    }
  }
  return { enabled: r.enabled === true, merchantId: typeof r.merchantId === "string" ? r.merchantId.trim() : "", serviceAccountJson: json };
}

/** Speichern; serviceAccountJson undefined = altes behalten, "" = löschen */
export async function saveMerchantSettings(storage: Pick<IStorage, "getSetting" | "saveSetting">, tenantId: string | null, update: { enabled?: boolean; merchantId?: string; serviceAccountJson?: string }): Promise<void> {
  const raw = await storage.getSetting(MERCHANT_SETTINGS_KEY, tenantId);
  const current = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const next: Record<string, unknown> = { ...current };
  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.merchantId !== undefined) next.merchantId = update.merchantId.trim();
  if (update.serviceAccountJson !== undefined) next.serviceAccountJson = update.serviceAccountJson.trim() ? encrypt(update.serviceAccountJson.trim()) : "";
  await storage.saveSetting(MERCHANT_SETTINGS_KEY, next, tenantId);
}

export type MerchantCredentials = { client_email: string; private_key: string; token_uri: string };
export type MerchantSetup = { ok: true; merchantId: string; credentials: MerchantCredentials } | { ok: false; reason: MerchantSetupProblem };

export function checkMerchantSetup(s: MerchantSettings): MerchantSetup {
  if (!s.enabled) return { ok: false, reason: "disabled" };
  if (!s.merchantId) return { ok: false, reason: "noMerchant" };
  if (!/^\d{5,20}$/.test(s.merchantId)) return { ok: false, reason: "invalidMerchant" };
  if (!s.serviceAccountJson.trim()) return { ok: false, reason: "noServiceAccount" };
  let c: Record<string, unknown>;
  try {
    c = JSON.parse(s.serviceAccountJson);
  } catch {
    return { ok: false, reason: "invalidServiceAccount" };
  }
  if (typeof c?.client_email !== "string" || typeof c?.private_key !== "string") return { ok: false, reason: "invalidServiceAccount" };
  const tokenUri = typeof c.token_uri === "string" && c.token_uri.startsWith("https://") ? c.token_uri : "https://oauth2.googleapis.com/token";
  return { ok: true, merchantId: s.merchantId, credentials: { client_email: c.client_email, private_key: c.private_key, token_uri: tokenUri } };
}

// ---------------------------------------------------------------------------------------------
// HTTP

export type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url");

export function merchantJwt(c: MerchantCredentials, now: Date): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: c.client_email, scope: MERCHANT_SCOPE, aud: c.token_uri, iat, exp: iat + 3600 }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(c.private_key))}`;
}

function explain(status: number, body: string): Error {
  if (status === 401 || /invalid_grant|unauthorized_client/i.test(body)) return new Error("Merchant Center: Anmeldung mit dem Dienstkonto gescheitert");
  if (status === 403) return new Error("Merchant Center: Das Dienstkonto hat keinen Zugriff auf dieses Konto");
  if (status === 404) return new Error("Merchant Center: Konto nicht gefunden");
  if (status === 429) return new Error("Merchant Center: Kontingent erschöpft");
  return new Error(`Merchant Center: HTTP ${status}`);
}

/** Ein Artikel im Merchant Center, wie die Prüfung ihn braucht */
export type MerchantItem = {
  offerId: string;
  gtin: string | null;
  title: string;
  /** Preis brutto in der Währung des Feeds */
  price: number | null;
  currency: string | null;
  /** in_stock, out_of_stock, preorder, backorder (klein, mit Unterstrich) */
  availability: string | null;
  /** Deutschland abgelehnt (Ziel oder Problem mit Schwere „abgelehnt“) */
  disapproved: boolean;
  /** Gründe (Beschreibung der Probleme mit Schwere abgelehnt bzw. herabgestuft) */
  issues: Array<{ code: string; severity: string; description: string; attribute: string | null }>;
};

const normAvailability = (v: unknown) => (typeof v === "string" && v ? v.trim().toLowerCase().replace(/[\s-]+/g, "_") : null);

/** Ein Eintrag aus products.list → MerchantItem (Feldnamen v1, ältere mitgelesen) */
export function toMerchantItem(p: any, country = "DE"): MerchantItem {
  const a = p?.productAttributes ?? p?.attributes ?? {};
  const price = a.price ?? null;
  const micros = Number(price?.amountMicros);
  const gtins: unknown[] = Array.isArray(a.gtins) ? a.gtins : a.gtin ? [a.gtin] : [];
  const status = p?.productStatus ?? {};
  const destinations: any[] = Array.isArray(status.destinationStatuses) ? status.destinationStatuses : [];
  const rawIssues: any[] = Array.isArray(status.itemLevelIssues) ? status.itemLevelIssues : [];
  const applies = (countries: unknown) => !Array.isArray(countries) || !countries.length || countries.map(String).includes(country);
  const issues = rawIssues
    .filter((i) => /DISAPPROVED|DEMOTED/i.test(String(i?.severity ?? "")) && applies(i?.applicableCountries))
    .map((i) => ({ code: String(i.code ?? ""), severity: String(i.severity ?? "").toUpperCase(), description: String(i.description ?? i.detail ?? i.code ?? "").slice(0, 200), attribute: i.attribute ? String(i.attribute) : null }));
  const disapproved =
    destinations.some((d) => Array.isArray(d?.disapprovedCountries) && d.disapprovedCountries.map(String).includes(country)) || issues.some((i) => i.severity === "DISAPPROVED");
  return {
    offerId: String(p?.offerId ?? "").trim(),
    gtin: gtins.length ? String(gtins[0]).trim() : null,
    title: String(a.title ?? p?.title ?? "").slice(0, 200),
    price: Number.isFinite(micros) ? micros / 1_000_000 : null,
    currency: typeof price?.currencyCode === "string" ? price.currencyCode : null,
    availability: normAvailability(a.availability),
    disapproved,
    issues,
  };
}

export type MerchantAccount = { merchantId: string; products(): Promise<MerchantItem[]> };
export type MerchantAccess = { account(): Promise<MerchantAccount> };

export function merchantAccount(setup: Extract<MerchantSetup, { ok: true }>, fetchFn: FetchFn, now: () => Date = () => new Date()): MerchantAccount {
  let token: { value: string; until: number } | null = null;
  const timed: FetchFn = async (url, init) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      return await fetchFn(url, { ...init, signal: ctrl.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const get = async (url: string): Promise<any> => {
    if (!token || token.until <= now().getTime()) {
      const res = await timed(setup.credentials.token_uri, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: merchantJwt(setup.credentials, now()) }).toString(),
      });
      if (!res.ok) throw explain(res.status, await res.text().catch(() => ""));
      const j = await res.json();
      token = { value: String(j.access_token ?? ""), until: now().getTime() + (Number(j.expires_in) || 3600) * 1000 - 60_000 };
    }
    const res = await timed(url, { method: "GET", headers: { authorization: `Bearer ${token.value}` } });
    if (!res.ok) throw explain(res.status, await res.text().catch(() => ""));
    return res.json();
  };
  return {
    merchantId: setup.merchantId,
    async products() {
      const out: MerchantItem[] = [];
      let pageToken = "";
      for (let page = 0; page < MAX_PAGES; page++) {
        const q = new URLSearchParams({ pageSize: "1000", ...(pageToken ? { pageToken } : {}) });
        const j = await get(`${MERCHANT_API_BASE}/accounts/${setup.merchantId}/products?${q.toString()}`);
        for (const p of Array.isArray(j?.products) ? j.products : []) out.push(toMerchantItem(p));
        pageToken = typeof j?.nextPageToken === "string" ? j.nextPageToken : "";
        if (!pageToken) break;
      }
      return out;
    },
  };
}

/** Merchant Center des Mandanten; Einstellungen und Token je Lauf einmal */
export function merchantAccess(storage: Pick<IStorage, "getSetting">, tenantId: string | null, fetchFn: FetchFn = fetch as unknown as FetchFn): MerchantAccess {
  let a: Promise<MerchantAccount> | null = null;
  return {
    account: () =>
      (a ??= (async () => {
        const setup = checkMerchantSetup(await getMerchantSettings(storage, tenantId));
        if (!setup.ok) throw new MerchantNotConfiguredError(setup.reason);
        return merchantAccount(setup, fetchFn);
      })()),
  };
}
