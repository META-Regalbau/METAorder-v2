/**
 * Gemeinsamer OAuth-Token-Cache für Shopware-Admin-API-Clients (ShopwareClient, B2BSellersClient,
 * B2BSellersAdminClient).
 *
 * Hintergrund: Clients werden an sehr vielen Stellen pro Vorgang neu erzeugt; mit Token-Cache nur
 * pro Instanz holt fast jeder Aufruf ein neues Token. Shopware 6.7 begrenzt /api/oauth/token pro
 * Client-IP (Client-Credentials haben keinen Benutzernamen) und meldet das irreführend als
 * „Notification throttled for N seconds" — bei jedem Abgleich alle 3 Minuten im Shop-Log.
 * Deshalb: ein Token pro Shopware + Zugangsschlüssel, parallele Anfragen warten auf denselben Abruf.
 *
 * Abgelehnte Zugangsdaten: Lehnt Shopware die Anmeldung ab (401, „Client authentication failed“),
 * bringt Weiterprobieren nichts - vorher versuchte es der Abgleich alle 3 Minuten, Shopware drosselte
 * daraufhin („Too Many Requests“), ~600 Fehlerzeilen in 7,5 Stunden (Produktion, Testshop-Mandant).
 * Jetzt: Anmeldung mit diesen Zugangsdaten pausiert (REJECTED_PAUSE_MS), Aufrufe scheitern sofort ohne
 * Anfrage an Shopware (ShopwareAuthPausedError). Neue Zugangsdaten werden sofort versucht (andere
 * Kennung); "Verbindung testen" und Speichern heben die Pause auf (clearShopwareAuthPause).
 * Drosselung (429): Pause so lange, wie Shopware angibt.
 */
import { createHash } from "crypto";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "shopware/shopwareTokenCache" });

type CachedToken = { token: string; expiresAt: number };

const tokens = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

/** Abgelehnte Zugangsdaten: erneuter Versuch fruehestens nach 6 Stunden (falls die Integration in Shopware wieder freigeschaltet wird) */
export const REJECTED_PAUSE_MS = 6 * 60 * 60 * 1000;
/** Drosselung ohne Zeitangabe: 5 Minuten; Angaben von Shopware zwischen 30 s und 1 h */
const THROTTLE_DEFAULT_MS = 5 * 60 * 1000;
const THROTTLE_MIN_MS = 30 * 1000;
const THROTTLE_MAX_MS = 60 * 60 * 1000;

type AuthPause = { reason: "rejected" | "throttled"; until: number; host: string };
const pauses = new Map<string, AuthPause>();

const hostOf = (baseUrl: string) => baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "");
const berlinTime = (ms: number) =>
  new Date(ms).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });

/** Anmeldung an Shopware pausiert: abgelehnte Zugangsdaten oder Drosselung. Scheitert sofort, ohne Anfrage. */
export class ShopwareAuthPausedError extends Error {
  readonly code = "shopware_auth_paused";
  constructor(
    readonly host: string,
    readonly reason: "rejected" | "throttled",
    readonly until: number,
  ) {
    super(
      reason === "rejected"
        ? `Shopware lehnt die Zugangsdaten ab (${host}) – Anmeldung pausiert bis ${berlinTime(until)}. Neue Zugangsdaten unter Einstellungen → Shopware werden sofort versucht.`
        : `Shopware drosselt die Anmeldung (${host}) – nächster Versuch ab ${berlinTime(until)}.`,
    );
    this.name = "ShopwareAuthPausedError";
  }
}

export function isShopwareAuthPaused(error: unknown): error is ShopwareAuthPausedError {
  return error instanceof ShopwareAuthPausedError;
}

/** Zugangsdaten abgelehnt (nicht: Netzwerk, Shopware gestoert): 401 oder invalid_client */
function isRejection(status: number, text: string): boolean {
  return status === 401 || (status === 400 && /invalid_client|client authentication failed/i.test(text));
}

/** Wartezeit bei Drosselung: Retry-After oder "throttled for N seconds" aus der Antwort */
function throttleMs(response: Response, text: string): number {
  const header = Number(response.headers.get("retry-after"));
  const fromText = Number(text.match(/throttled for (\d+) seconds?/i)?.[1]);
  const seconds = Number.isFinite(header) && header > 0 ? header : Number.isFinite(fromText) && fromText > 0 ? fromText : 0;
  const ms = seconds > 0 ? seconds * 1000 : THROTTLE_DEFAULT_MS;
  return Math.min(THROTTLE_MAX_MS, Math.max(THROTTLE_MIN_MS, ms));
}

function cacheKey(baseUrl: string, clientId: string, clientSecret: string): string {
  const secretHash = createHash("sha256").update(clientSecret).digest("hex").slice(0, 16);
  return `${baseUrl.replace(/\/+$/, "")}|${clientId}|${secretHash}`;
}

async function requestToken(baseUrl: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  const host = hostOf(baseUrl);
  moduleLog.info(`[ShopwareAuth] Neues Token für ${host}`);
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    const key = cacheKey(baseUrl, clientId, clientSecret);
    if (isRejection(response.status, errorText) || response.status === 429) {
      const reason = response.status === 429 ? "throttled" : "rejected";
      const until = Date.now() + (reason === "rejected" ? REJECTED_PAUSE_MS : throttleMs(response, errorText));
      pauses.set(key, { reason, until, host });
      const error = new ShopwareAuthPausedError(host, reason, until);
      // einmal je Pause loggen (die Aufrufer scheitern danach still mit derselben Meldung)
      moduleLog.warn({ host, status: response.status, reason, pausedUntil: new Date(until).toISOString() }, `[ShopwareAuth] ${error.message}`);
      throw error;
    }
    throw new Error(`Authentication failed: ${response.status} ${response.statusText} - ${errorText}`);
  }
  const data = await response.json();
  // Standard 10 Minuten, eine Minute Puffer vor Ablauf
  const expiresIn = Number(data.expires_in) || 600;
  return { token: String(data.access_token), expiresAt: Date.now() + Math.max(30, expiresIn - 60) * 1000 };
}

/** Gültiges Token aus dem Cache oder genau ein neuer Abruf für alle gleichzeitigen Aufrufer. */
export async function getSharedShopwareToken(
  baseUrl: string,
  clientId: string,
  clientSecret: string
): Promise<CachedToken> {
  const key = cacheKey(baseUrl, clientId, clientSecret);
  const cached = tokens.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached;

  const pause = pauses.get(key);
  if (pause) {
    if (Date.now() < pause.until) throw new ShopwareAuthPausedError(pause.host, pause.reason, pause.until);
    pauses.delete(key);
  }

  let pending = inflight.get(key);
  if (!pending) {
    pending = requestToken(baseUrl, clientId, clientSecret)
      .then((fresh) => {
        tokens.set(key, fresh);
        return fresh;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** Nach einer 401 verwerfen, damit der nächste Aufruf ein frisches Token holt. */
export function invalidateSharedShopwareToken(baseUrl: string, clientId: string, clientSecret: string): void {
  tokens.delete(cacheKey(baseUrl, clientId, clientSecret));
}

/** Pause fuer diese Zugangsdaten aufheben ("Verbindung testen", Einstellungen gespeichert). */
export function clearShopwareAuthPause(baseUrl: string, clientId: string, clientSecret: string): void {
  pauses.delete(cacheKey(baseUrl, clientId, clientSecret));
}

/** Nur fuer Tests: Tokens und Pausen verwerfen. */
export function resetShopwareTokenCacheForTests(): void {
  tokens.clear();
  inflight.clear();
  pauses.clear();
}
