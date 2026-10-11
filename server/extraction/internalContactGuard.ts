/**
 * Namen aus der internen Weiterleitung sind keine Kundenkontakte (Live 11.10.2026, Böttcher AG:
 * Kunde und Rechnungsadresse „Oliver Steiling“, weil die KI den Absender der Weiterleitung als
 * Ansprechpartner nahm).
 *
 * META-Leute erkennt man an der eigenen Domain: „Name <x@meta-online.com>“ in Von/An/Cc oder
 * irgendwo im Text. Deren Namen und Adressen werden aus Kunde, Rechnungs- und Lieferadresse,
 * Ansprechpartner und Lieferkontakt entfernt – lieber leer als ein Kollege.
 */
import { isOwnOperatorEmail } from "../commercial/draftCustomerEmailResolution";

type Loose = Record<string, any>;

const NAMED_ADDRESS_RE = /(?:"([^"]{2,80})"|([A-Za-zÀ-ÖØ-öø-ÿ][\wÀ-ÖØ-öø-ÿ .,'-]{1,80}?))\s*<\s*([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\s*>/gi;
const HEADER_LINE_RE = /^(?:von|from|an|to|cc|gesendet von|sent by)\s*:\s*(.+)$/gim;

function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/["'()]/g, " ")
    .split(/[\s,]+/)
    .filter((t) => t.length >= 2 && !/^(herr|frau|hr|fr|dr|prof|mr|mrs|ms)\.?$/.test(t))
    .sort()
    .join(" ");
}

export type InternalIdentities = { names: Set<string>; emails: Set<string> };

export function collectInternalIdentities(texts: Array<string | null | undefined>): InternalIdentities {
  const names = new Set<string>();
  const emails = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const scan = (chunk: string) => {
      NAMED_ADDRESS_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = NAMED_ADDRESS_RE.exec(chunk)) !== null) {
        const email = m[3].toLowerCase();
        if (!isOwnOperatorEmail(email)) continue;
        emails.add(email);
        const key = nameKey((m[1] ?? m[2] ?? "").replace(/^(?:von|from|an|to|cc)\s*:\s*/i, ""));
        if (key.split(" ").length >= 2) names.add(key);
      }
    };
    HEADER_LINE_RE.lastIndex = 0;
    let h: RegExpExecArray | null;
    while ((h = HEADER_LINE_RE.exec(text)) !== null) scan(h[1]);
    scan(text);
    for (const e of text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? []) if (isOwnOperatorEmail(e)) emails.add(e.toLowerCase());
  }
  return { names, emails };
}

function isInternalName(first: unknown, last: unknown, ids: InternalIdentities): boolean {
  const full = [first, last].filter((v) => typeof v === "string" && v.trim()).join(" ");
  const key = nameKey(full);
  return key.split(" ").length >= 2 && ids.names.has(key);
}

const isInternalEmail = (v: unknown, ids: InternalIdentities) =>
  typeof v === "string" && (ids.emails.has(v.trim().toLowerCase()) || isOwnOperatorEmail(v.trim()));

/** Entfernt interne Namen/Adressen (in place). Gibt die bereinigten Felder zurück. */
export function stripInternalContacts(extractedData: Loose, texts: Array<string | null | undefined>): string[] {
  const ids = collectInternalIdentities(texts);
  const removed: string[] = [];
  for (const key of ["customer", "billingAddress", "shippingAddress"] as const) {
    const obj = extractedData[key] as Loose | undefined;
    if (!obj || typeof obj !== "object") continue;
    if (isInternalName(obj.firstName, obj.lastName, ids)) {
      delete obj.firstName;
      delete obj.lastName;
      removed.push(`${key}.name`);
    }
    if (isInternalEmail(obj.email, ids)) {
      delete obj.email;
      removed.push(`${key}.email`);
    }
  }
  const de = extractedData.documentExtraction as Loose | undefined;
  if (de?.buyer) {
    if (typeof de.buyer.contact_person === "string" && ids.names.has(nameKey(de.buyer.contact_person))) {
      de.buyer.contact_person = null;
      removed.push("documentExtraction.buyer.contact_person");
    }
    if (isInternalEmail(de.buyer.email, ids)) {
      de.buyer.email = null;
      removed.push("documentExtraction.buyer.email");
    }
  }
  const refs = extractedData.documentReferences as Loose | undefined;
  if (refs) {
    if (typeof refs.deliveryContactName === "string" && ids.names.has(nameKey(refs.deliveryContactName))) {
      delete refs.deliveryContactName;
      removed.push("documentReferences.deliveryContactName");
    }
    for (const f of ["deliveryContactEmail", "orderConfirmationEmail", "invoiceEmail"]) {
      if (isInternalEmail(refs[f], ids)) {
        delete refs[f];
        removed.push(`documentReferences.${f}`);
      }
    }
  }
  return removed;
}
