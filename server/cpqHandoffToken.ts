/**
 * CPQ-Handoff-Token: kurzlebiger, HMAC-signierter Übergabe-Token, mit dem die
 * Shopware-Produktseite einen Shop-Besucher (Gast oder eingeloggten Kunden) in
 * den METAorder-Konfigurator schickt, ohne eine echte Cross-Domain-Session
 * aufzubauen. Die Shopware-Seite kennt `context.customer` bereits selbst und
 * signiert den Token (siehe Twig-Extension `CpqHandoffTokenExtension.php` im
 * MetaClipCpq-Plugin) — METAorder muss dem Kunden nicht selbst vertrauen,
 * sondern nur der Signatur der Shop-Instanz, die denselben Secret-Wert kennt.
 *
 * Format: base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 * Bewusst kein echtes JWT (kein Alg-Handshake, kein Header) — beide Seiten
 * kennen das Format fest verdrahtet, das reduziert Angriffsfläche und macht
 * eine PHP-Implementierung ohne zusätzliche Composer-Abhängigkeit möglich.
 */
import { createHmac, timingSafeEqual } from "crypto";
import { assertSecureSecret } from "./secretGuard";

const CPQ_HANDOFF_SECRET = assertSecureSecret(
  "CPQ_HANDOFF_SECRET",
  process.env.CPQ_HANDOFF_SECRET || "dev-cpq-handoff-secret-change-me",
);

export type CpqHandoffPayload = {
  /** METAorder-Mandant, dem diese Shopware-Instanz zugeordnet ist. */
  tenantId: string;
  /** Shopware-Kunden-ID, oder null für einen nicht angemeldeten Gast. */
  customerId: string | null;
  salesChannelId?: string | null;
  productId?: string | null;
  /** Unix-Sekunden, Ablaufzeitpunkt. */
  exp: number;
};

function base64url(input: Buffer): string {
  return input.toString("base64url");
}

function sign(payloadB64: string): string {
  return base64url(createHmac("sha256", CPQ_HANDOFF_SECRET).update(payloadB64).digest());
}

/** Für Tests/QA und den internen "Testlink erzeugen"-Endpoint — die echte Ausstellung passiert in PHP. */
export function createCpqHandoffToken(payload: CpqHandoffPayload): string {
  const payloadB64 = base64url(Buffer.from(JSON.stringify(payload), "utf8"));
  return `${payloadB64}.${sign(payloadB64)}`;
}

export function verifyCpqHandoffToken(token: unknown): CpqHandoffPayload | null {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;
  if (!payloadB64 || !sig) return null;

  const expectedSig = sign(payloadB64);
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null;

  let payload: CpqHandoffPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== "object") return null;
  if (typeof payload.tenantId !== "string" || !payload.tenantId) return null;
  if (payload.customerId !== null && typeof payload.customerId !== "string") return null;
  if (typeof payload.exp !== "number" || Date.now() / 1000 > payload.exp) return null;

  return payload;
}
