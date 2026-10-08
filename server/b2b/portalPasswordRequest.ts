import type { B2BSellersAdminClient } from "./b2bSellersAdmin";

/**
 * Öffentliche Passwort-Anforderung für das Händlerportal (Seite /portal-zugang).
 *
 * Händler geben Kundennummer und E-Mail ein. Passt beides zu einem aktiven
 * B2Bsellers-Mitarbeiter, lösen wir das „Passwort vergessen“ von B2Bsellers aus:
 * Shopware verschickt eine Mail mit einem Link (2 Stunden gültig), über den der
 * Händler sein Passwort selbst festlegt. Kein Passwort in der Mail, und das
 * bisherige bleibt gültig, bis der Link genutzt wird.
 *
 * Anders als /account/recover im Portal (nur E-Mail) prüft die Seite zusätzlich die
 * Kundennummer und schließt META-eigene Zugänge aus.
 *
 * Die Antwort an den Browser ist immer gleich (kein Rückschluss, ob es den
 * Zugang gibt); das Ergebnis steht nur im Log.
 */

export type PortalPasswordRequestInput = {
  customerNumber: string;
  email: string;
};

export type PortalPasswordRequestOutcome =
  | "sent"
  | "customer_not_found"
  | "employee_not_found"
  | "not_linked"
  | "link_inactive"
  | "excluded"
  | "no_sales_channel"
  | "mail_failed";

/** META-eigene Zugänge laufen nicht über die öffentliche Seite (wie beim Passwort-Rollout). */
const META_OWN_EMAIL_RE = /@(meta-online\.com|meta-regalbau\.[a-z]+|regalpro\.[a-z]+)$/i;

export const DEFAULT_PORTAL_LOGIN_URL = "https://portal.meta-online.com";

/** Portal-Adresse, auf die der Link in der Mail zeigt (<url>/employee/recover/password?hash=…). */
export function portalLoginUrl(): string {
  return (process.env.B2B_PORTAL_LOGIN_URL || DEFAULT_PORTAL_LOGIN_URL).trim().replace(/\/$/, "");
}

export function normalizeCustomerNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export type PortalPasswordRequestDeps = {
  client: Pick<
    B2BSellersAdminClient,
    "findCustomersByNumber" | "findEmployeesByEmail" | "findEmployeeCustomerLink" | "requestEmployeePasswordRecovery"
  >;
  storefrontUrl?: string;
};

/**
 * Prüft Kundennummer + E-Mail und löst bei einem Treffer die Wiederherstellungsmail aus.
 * Liefert das Ergebnis für das Log (nie an den Browser weitergeben).
 */
export async function processPortalPasswordRequest(
  deps: PortalPasswordRequestDeps,
  input: PortalPasswordRequestInput,
): Promise<{ outcome: PortalPasswordRequestOutcome; employeeId?: string; customerId?: string; error?: string }> {
  const customerNumber = normalizeCustomerNumber(input.customerNumber);
  const email = normalizeEmail(input.email);

  if (META_OWN_EMAIL_RE.test(email)) return { outcome: "excluded" };

  const customers = await deps.client.findCustomersByNumber(customerNumber);
  if (customers.length === 0) return { outcome: "customer_not_found" };

  const employees = await deps.client.findEmployeesByEmail(email);
  if (employees.length === 0) return { outcome: "employee_not_found" };

  let inactiveMatch = false;
  for (const customer of customers) {
    for (const employee of employees) {
      const link = await deps.client.findEmployeeCustomerLink(employee.id, customer.id);
      if (!link) continue;
      // Vertriebs-Zugänge (b2b_sales_representative) sind META-intern.
      if (customer.salesRepresentative) return { outcome: "excluded", employeeId: employee.id, customerId: customer.id };
      if (!link.active) {
        inactiveMatch = true;
        continue;
      }

      // B2Bsellers sucht den Mitarbeiter im Kanal, an den er gebunden ist (Händlerportal DE).
      const salesChannelId = employee.boundSalesChannelId || customer.salesChannelId;
      if (!salesChannelId) {
        return { outcome: "no_sales_channel", employeeId: employee.id, customerId: customer.id };
      }
      try {
        await deps.client.requestEmployeePasswordRecovery({
          salesChannelId,
          email,
          storefrontUrl: deps.storefrontUrl ?? portalLoginUrl(),
        });
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return { outcome: "mail_failed", employeeId: employee.id, customerId: customer.id, error };
      }
      return { outcome: "sent", employeeId: employee.id, customerId: customer.id };
    }
  }
  return { outcome: inactiveMatch ? "link_inactive" : "not_linked" };
}

// ---------------------------------------------------------------------------
// Ratenbegrenzung (im Speicher, je Prozess): pro IP und pro Zugang.
// ---------------------------------------------------------------------------

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

const IP_WINDOW_MS = 15 * 60_000;
const IP_MAX = 5;
/** Pro Zugang höchstens eine Mail je Fenster — verhindert Mail-Fluten. */
const ACCOUNT_WINDOW_MS = 15 * 60_000;
const ACCOUNT_MAX = 1;

function hit(key: string, windowMs: number, max: number, now: number): boolean {
  let bucket = buckets.get(key);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= max;
}

export function rateLimitPortalPasswordIp(ip: string, now = Date.now()): boolean {
  return hit(`ip:${ip}`, IP_WINDOW_MS, IP_MAX, now);
}

export function rateLimitPortalPasswordAccount(customerNumber: string, email: string, now = Date.now()): boolean {
  return hit(
    `acc:${normalizeCustomerNumber(customerNumber)}|${normalizeEmail(email)}`,
    ACCOUNT_WINDOW_MS,
    ACCOUNT_MAX,
    now,
  );
}

export function resetPortalPasswordRateLimitsForTests(): void {
  buckets.clear();
}
