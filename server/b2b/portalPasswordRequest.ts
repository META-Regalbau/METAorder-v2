import { randomInt } from "node:crypto";
import type { B2BSellersAdminClient } from "./b2bSellersAdmin";

/**
 * Öffentliche Passwort-Anforderung für das Händlerportal (Seite /portal-zugang).
 *
 * Händler geben Kundennummer und E-Mail ein. Passt beides zu einem aktiven
 * B2Bsellers-Mitarbeiter, bekommt er ein neues Passwort per Mail — mit dem
 * Hinweis, es nach der ersten Anmeldung im Portal zu ändern. Das bisherige
 * Passwort ist nur als Hash gespeichert und lässt sich nicht erneut versenden.
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
  | "mail_disabled"
  | "mail_failed";

export type PortalPasswordMail = { subject: string; text: string; html: string };

/** META-eigene Zugänge laufen nicht über die öffentliche Seite (wie beim Passwort-Rollout). */
const META_OWN_EMAIL_RE = /@(meta-online\.com|meta-regalbau\.[a-z]+|regalpro\.[a-z]+)$/i;

export const DEFAULT_PORTAL_LOGIN_URL = "https://portal.meta-online.com";

export function portalLoginUrl(): string {
  return (process.env.B2B_PORTAL_LOGIN_URL || DEFAULT_PORTAL_LOGIN_URL).trim().replace(/\/$/, "");
}

// Ohne leicht verwechselbare Zeichen (0/O, 1/l/I), damit das Abtippen aus der Mail klappt.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";
const ALL = UPPER + LOWER + DIGITS;

/** Zufälliges Passwort (12 Zeichen, mind. je ein Groß-, Kleinbuchstabe und Ziffer). */
export function generatePortalPassword(length = 12): string {
  const chars = [
    UPPER[randomInt(UPPER.length)],
    LOWER[randomInt(LOWER.length)],
    DIGITS[randomInt(DIGITS.length)],
  ];
  while (chars.length < length) {
    chars.push(ALL[randomInt(ALL.length)]);
  }
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

export function normalizeCustomerNumber(raw: string): string {
  return raw.trim().replace(/\s+/g, "");
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Mail mit dem neuen Passwort (Deutsch, darunter Englisch für die Auslandshändler). */
export function buildPortalPasswordMail(params: {
  firstName: string;
  lastName: string;
  email: string;
  customerNumber: string;
  password: string;
  loginUrl: string;
}): PortalPasswordMail {
  const name = `${params.firstName} ${params.lastName}`.trim();
  const greetingDe = name ? `Guten Tag ${name},` : "Guten Tag,";
  const greetingEn = name ? `Dear ${name},` : "Hello,";

  const text = [
    greetingDe,
    "",
    "Sie haben ein Passwort für das META Händlerportal angefordert.",
    "",
    `Portal: ${params.loginUrl}`,
    `Kundennummer: ${params.customerNumber}`,
    `E-Mail (Benutzername): ${params.email}`,
    `Passwort: ${params.password}`,
    "",
    "WICHTIG: Bitte ändern Sie dieses Passwort direkt nach der ersten Anmeldung im Portal in Ihrem Konto. Das Passwort wurde per E-Mail übertragen und sollte deshalb nicht dauerhaft verwendet werden.",
    "",
    "Sie haben kein Passwort angefordert? Dann melden Sie sich bitte bei Ihrem META-Ansprechpartner. Ihr bisheriges Passwort ist durch diese Anforderung nicht mehr gültig.",
    "",
    "Mit freundlichen Grüßen",
    "Ihr META-Team",
    "",
    "----------------------------------------",
    "",
    greetingEn,
    "",
    "You have requested a password for the META dealer portal.",
    "",
    `Portal: ${params.loginUrl}`,
    `Customer number: ${params.customerNumber}`,
    `E-mail (user name): ${params.email}`,
    `Password: ${params.password}`,
    "",
    "IMPORTANT: Please change this password in your account in the portal right after your first login. It was sent by e-mail and should not be used permanently.",
    "",
    "Did not request a password? Please contact your META representative. Your previous password is no longer valid.",
    "",
    "Kind regards",
    "Your META team",
  ].join("\n");

  const e = {
    greetingDe: escapeHtml(greetingDe),
    greetingEn: escapeHtml(greetingEn),
    loginUrl: escapeHtml(params.loginUrl),
    customerNumber: escapeHtml(params.customerNumber),
    email: escapeHtml(params.email),
    password: escapeHtml(params.password),
  };
  const credentialTable = (labels: { customerNumber: string; email: string; password: string }) => `
    <table cellpadding="6" cellspacing="0" style="border-collapse:collapse;margin:16px 0;">
      <tr><td style="color:#555;">${labels.customerNumber}</td><td><strong>${e.customerNumber}</strong></td></tr>
      <tr><td style="color:#555;">${labels.email}</td><td><strong>${e.email}</strong></td></tr>
      <tr><td style="color:#555;">${labels.password}</td><td><strong style="font-family:Consolas,Menlo,monospace;font-size:16px;letter-spacing:1px;">${e.password}</strong></td></tr>
    </table>`;
  const notice = (textHtml: string) =>
    `<p style="background:#fff4e5;border-left:4px solid #e8a33d;padding:10px 14px;margin:16px 0;">${textHtml}</p>`;
  const button = (label: string) =>
    `<p><a href="${e.loginUrl}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:4px;">${label}</a></p>`;

  const html = `<!doctype html>
<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1a1a1a;">
  <p>${e.greetingDe}</p>
  <p>Sie haben ein Passwort für das META Händlerportal angefordert.</p>
  ${credentialTable({ customerNumber: "Kundennummer", email: "E-Mail (Benutzername)", password: "Passwort" })}
  ${button("Zum Händlerportal")}
  ${notice("<strong>Wichtig:</strong> Bitte ändern Sie dieses Passwort direkt nach der ersten Anmeldung im Portal in Ihrem Konto. Das Passwort wurde per E-Mail übertragen und sollte deshalb nicht dauerhaft verwendet werden.")}
  <p>Sie haben kein Passwort angefordert? Dann melden Sie sich bitte bei Ihrem META-Ansprechpartner. Ihr bisheriges Passwort ist durch diese Anforderung nicht mehr gültig.</p>
  <p>Mit freundlichen Grüßen<br>Ihr META-Team</p>
  <hr style="border:none;border-top:1px solid #ddd;margin:28px 0;">
  <p>${e.greetingEn}</p>
  <p>You have requested a password for the META dealer portal.</p>
  ${credentialTable({ customerNumber: "Customer number", email: "E-mail (user name)", password: "Password" })}
  ${button("Go to the dealer portal")}
  ${notice("<strong>Important:</strong> Please change this password in your account in the portal right after your first login. It was sent by e-mail and should not be used permanently.")}
  <p>Did not request a password? Please contact your META representative. Your previous password is no longer valid.</p>
  <p>Kind regards<br>Your META team</p>
</body></html>`;

  return {
    subject: "Ihr Passwort für das META Händlerportal / Your META dealer portal password",
    text,
    html,
  };
}

export type PortalPasswordRequestDeps = {
  client: Pick<
    B2BSellersAdminClient,
    "findCustomersByNumber" | "findEmployeesByEmail" | "findEmployeeCustomerLink" | "setEmployeePassword"
  >;
  sendMail: (mail: PortalPasswordMail & { to: string }) => Promise<unknown>;
  /** Mailversand eingerichtet? Ohne ihn darf kein Passwort gesetzt werden (sonst kennt es niemand). */
  mailReady: () => Promise<boolean>;
  loginUrl?: string;
  generatePassword?: () => string;
};

/**
 * Prüft Kundennummer + E-Mail und verschickt bei einem Treffer ein neues Passwort.
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

      if (!(await deps.mailReady())) {
        return { outcome: "mail_disabled", employeeId: employee.id, customerId: customer.id };
      }

      const password = (deps.generatePassword ?? generatePortalPassword)();
      await deps.client.setEmployeePassword(employee.id, password);
      const mail = buildPortalPasswordMail({
        firstName: employee.firstName,
        lastName: employee.lastName,
        email,
        customerNumber: customer.customerNumber || customerNumber,
        password,
        loginUrl: deps.loginUrl ?? portalLoginUrl(),
      });
      try {
        await deps.sendMail({ ...mail, to: email });
      } catch (err) {
        // Passwort ist schon gesetzt — der Händler muss es erneut anfordern.
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
/** Pro Zugang höchstens eine Mail je Fenster — verhindert Mail-Fluten und Dauer-Zurücksetzen. */
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
