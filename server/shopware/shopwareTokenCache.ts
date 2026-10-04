/**
 * Gemeinsamer OAuth-Token-Cache für Shopware-Admin-API-Clients (ShopwareClient, B2BSellersClient,
 * B2BSellersAdminClient).
 *
 * Hintergrund: Clients werden an sehr vielen Stellen pro Vorgang neu erzeugt; mit Token-Cache nur
 * pro Instanz holt fast jeder Aufruf ein neues Token. Shopware 6.7 begrenzt /api/oauth/token pro
 * Client-IP (Client-Credentials haben keinen Benutzernamen) und meldet das irreführend als
 * „Notification throttled for N seconds" — bei jedem Abgleich alle 3 Minuten im Shop-Log.
 * Deshalb: ein Token pro Shopware + Zugangsschlüssel, parallele Anfragen warten auf denselben Abruf.
 */
import { createHash } from "crypto";

type CachedToken = { token: string; expiresAt: number };

const tokens = new Map<string, CachedToken>();
const inflight = new Map<string, Promise<CachedToken>>();

function cacheKey(baseUrl: string, clientId: string, clientSecret: string): string {
  const secretHash = createHash("sha256").update(clientSecret).digest("hex").slice(0, 16);
  return `${baseUrl.replace(/\/+$/, "")}|${clientId}|${secretHash}`;
}

async function requestToken(baseUrl: string, clientId: string, clientSecret: string): Promise<CachedToken> {
  console.log(`[ShopwareAuth] Neues Token für ${baseUrl.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`);
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
