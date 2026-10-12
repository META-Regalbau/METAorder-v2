/**
 * Filter des E-Mail-Eingangs vor jeder Auswertung (ohne KI, ohne Anhänge zu lesen).
 *
 * Gerade an persönlichen Postfächern kommt viel Post, die mit Bestellungen und Anfragen nichts
 * zu tun hat. Solche Mails bekommen nur die Kategorie „METAorder: ignoriert“ und bleiben im
 * Posteingang. Reihenfolge der Regeln:
 *   1. Erlaubtliste (Absender/Domain) → immer verarbeiten
 *   2. Sperrliste → ignorieren
 *   3. Betreff-Stichwörter → ignorieren
 *   4. Interne Mails (Kollegen) → ignorieren, außer weitergeleitete Kundenmails
 *   5. Newsletter/Massenmails → ignorieren, außer mit Bestell-/Anfrage-Anhang
 */
import type { EmailIntakeFilterRule, EmailIntakeFilterSettings } from "@shared/emailIntake";

export type EmailIntakeFilterInput = {
  /** Kopf-Absender („Name <adresse>“ oder Adresse) */
  headerFrom: string;
  /** Absender der eigentlichen Kundenmail nach dem Auspacken interner Weiterleitungen */
  customerEmail: string | null;
  /** Interne Weiterleitung erkannt (Kollege leitet Kundenmail weiter) */
  internalForward: boolean;
  subject: string;
  /** Kopfzeilen für Massenmails (klein geschriebene Namen) */
  listUnsubscribe?: string | null;
  listId?: string | null;
  precedence?: string | null;
  /** Dateinamen der Anhänge */
  attachmentNames: string[];
};

export type EmailIntakeFilterDecision =
  | { action: "process"; rule: "allow_list" | null; reason: string }
  | { action: "ignore"; rule: Exclude<EmailIntakeFilterRule, "allow_list">; reason: string };

/** Adresse aus „Name <adresse>“ (klein); null ohne erkennbare Adresse */
export function emailAddressOf(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(text);
  const plain = angle ? angle[1] : /[^\s<>"']+@[^\s<>"']+/.exec(text)?.[0];
  return plain ? plain.toLowerCase().replace(/[.,;]+$/, "") : null;
}

function domainOf(address: string): string {
  return address.split("@")[1] ?? "";
}

/** Passt eine Adresse auf ein Muster (volle Adresse oder Domain inkl. Subdomains)? */
export function senderMatches(address: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase().replace(/^@/, "");
  if (!p) return false;
  if (p.includes("@")) return address === p;
  const domain = domainOf(address);
  return domain === p || domain.endsWith(`.${p}`);
}

function isInternal(address: string | null, internalDomains: string[]): boolean {
  return Boolean(address && internalDomains.some((d) => senderMatches(address, d)));
}

const BULK_LOCAL_PART_RE =
  /^(no-?reply|do-?not-?reply|donotreply|newsletter|news|marketing|mailer|mailing|notifications?|notify|info-?mail|campaign|bounce[s]?)([+._-].*)?$/i;

/** Anhang, der wie eine Bestellung oder Anfrage heißt, bzw. Bestell-XML (openTRANS u. a.) */
const COMMERCIAL_ATTACHMENT_RE =
  /(bestell|order|auftrag|anfrage|angebot|quot|rfq|purchase|beschaffung|\bpo[-_ ]?\d)/i;

function hasCommercialAttachment(names: string[]): boolean {
  return names.some((name) => COMMERCIAL_ATTACHMENT_RE.test(name) || /\.xml$/i.test(name));
}

export function evaluateEmailIntakeFilter(
  input: EmailIntakeFilterInput,
  settings: EmailIntakeFilterSettings,
  internalDomains: string[],
): EmailIntakeFilterDecision {
  const headerAddress = emailAddressOf(input.headerFrom);
  const customerAddress = input.customerEmail ? input.customerEmail.trim().toLowerCase() : null;
  // Bei interner Weiterleitung zählt der Kunde, sonst der Kopf-Absender
  const senders = [customerAddress, headerAddress].filter((a): a is string => Boolean(a));

  const allowed = settings.allowSenders.find((p) => senders.some((a) => senderMatches(a, p)));
  if (allowed) {
    return { action: "process", rule: "allow_list", reason: `Absender auf der Erlaubtliste (${allowed})` };
  }

  const blocked = settings.blockSenders.find((p) => senders.some((a) => senderMatches(a, p)));
  if (blocked) {
    return { action: "ignore", rule: "block_list", reason: `Absender auf der Sperrliste (${blocked})` };
  }

  const subject = input.subject.toLowerCase();
  const keyword = settings.blockSubjectKeywords.find((k) => k.trim() && subject.includes(k.trim().toLowerCase()));
  if (keyword) {
    return { action: "ignore", rule: "subject_keyword", reason: `Betreff enthält „${keyword}“` };
  }

  if (settings.ignoreInternal && isInternal(headerAddress, internalDomains)) {
    // Weitergeleitete Kundenmail: Kunde ist extern → verarbeiten
    const forwardedCustomer = input.internalForward && customerAddress && !isInternal(customerAddress, internalDomains);
    if (!forwardedCustomer) {
      return { action: "ignore", rule: "internal", reason: `Interne Mail von ${headerAddress}` };
    }
  }

  if (settings.ignoreBulk) {
    const precedence = (input.precedence ?? "").trim().toLowerCase();
    const localPart = (customerAddress ?? headerAddress ?? "").split("@")[0] ?? "";
    const signal = input.listUnsubscribe
      ? "Kopfzeile List-Unsubscribe"
      : input.listId
        ? "Kopfzeile List-Id"
        : ["bulk", "list", "junk"].includes(precedence)
          ? `Kopfzeile Precedence: ${precedence}`
          : BULK_LOCAL_PART_RE.test(localPart)
            ? `Absender ${localPart}@…`
            : null;
    if (signal && !hasCommercialAttachment(input.attachmentNames)) {
      return { action: "ignore", rule: "bulk", reason: `Newsletter/Massenmail (${signal})` };
    }
  }

  return { action: "process", rule: null, reason: "Keine Filterregel trifft zu" };
}
