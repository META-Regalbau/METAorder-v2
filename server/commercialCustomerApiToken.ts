/**
 * Kundengebundene Zugangs-Token für den Rückmelde-Endpunkt.
 *
 * Gleiches Muster wie die Angebots-Links ([`offerToken.ts`](./offerToken.ts)): Der
 * Klartext existiert nur im Moment der Ausstellung, gespeichert wird ausschließlich der
 * SHA-256-Hash. Ein Datenbank-Leak gibt damit keinen Zugriff.
 *
 * Der entscheidende Unterschied zu `tenant_integration_api_keys`: Jedes Token hier ist an
 * genau **eine** `shopwareCustomerId` gebunden. Der Endpunkt filtert ausschließlich darauf,
 * ein Kunde kann also unter keinen Umständen fremde Vorgänge sehen.
 */

import { createHash, randomBytes, timingSafeEqual } from "crypto";

/** Prefix macht den Token in Logs und Konfigurationen sofort erkennbar. */
const TOKEN_PREFIX = "moc_";

export function hashCommercialCustomerToken(plainToken: string): string {
  return createHash("sha256").update(plainToken, "utf8").digest("hex");
}

/** URL-sicherer Klartext-Token — wird nur einmal bei der Ausstellung zurückgegeben. */
export function generateCommercialCustomerToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Liest den Token aus `Authorization: Bearer …` oder dem Header `X-METAORDER-Customer-Token`.
 * Query-Parameter werden bewusst **nicht** unterstützt: Sie landen in Server-Logs,
 * Proxy-Logs und Browser-Historien.
 */
export function readCustomerTokenFromRequest(headers: {
  authorization?: string | string[];
  "x-metaorder-customer-token"?: string | string[];
}): string | null {
  const single = (v: string | string[] | undefined): string =>
    (Array.isArray(v) ? v[0] : v || "").trim();

  const bearer = single(headers.authorization);
  if (/^bearer\s+/i.test(bearer)) {
    const token = bearer.replace(/^bearer\s+/i, "").trim();
    if (token) return token;
  }
  const direct = single(headers["x-metaorder-customer-token"]);
  return direct || null;
}

export type CommercialCustomerTokenRecord = {
  id: string;
  tenantId: string;
  shopwareCustomerId: string;
  expiresAt: Date | string | null;
  revokedAt: Date | string | null;
};

export type CustomerTokenValidation =
  | { ok: true; token: CommercialCustomerTokenRecord }
  | { ok: false; reason: "unknown" | "revoked" | "expired" };

/**
 * Prüft Gültigkeit ohne DB-Zugriff — der Aufrufer lädt den Datensatz per Hash.
 * Getrennt gehalten, damit die Regeln (widerrufen, abgelaufen) testbar bleiben.
 */
export function validateCustomerToken(
  record: CommercialCustomerTokenRecord | null | undefined,
  now: Date = new Date()
): CustomerTokenValidation {
  if (!record) return { ok: false, reason: "unknown" };
  if (record.revokedAt) return { ok: false, reason: "revoked" };
  if (record.expiresAt) {
    const expires = record.expiresAt instanceof Date ? record.expiresAt : new Date(record.expiresAt);
    if (Number.isFinite(expires.getTime()) && expires.getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }
  }
  return { ok: true, token: record };
}

/**
 * Zeitkonstanter Vergleich zweier Hex-Hashes. Wird für den Lookup selbst nicht gebraucht
 * (der läuft über einen Unique-Index), aber für Vergleiche im Anwendungscode, damit dort
 * kein Timing-Seitenkanal entsteht.
 */
export function constantTimeHashEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
