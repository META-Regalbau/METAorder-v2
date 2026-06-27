/**
 * Deterministischer „Sub-Agent" für Footer-/Briefkopf-Adressblock:
 * Firmenname, Straße, PLZ, Ort, Land, Telefon, E-Mail.
 *
 * Wrappt die offline-Heuristik aus companyNameHeuristics.ts und legt das
 * Ergebnis konservativ in `extractedData.customer.*` und
 * `extractedData.billingAddress.*` ab — ABER NUR wenn das jeweilige Feld
 * leer ist. Bestehende LLM-Werte werden nie überschrieben (vom Nutzer
 * explizit so gewünscht: „fill-only").
 *
 * Zusätzlich werden alle vom Footer/Briefkopf eingesammelten Tokens
 * (Straße, PLZ, Ort, Telefon, E-Mail) in extractedData.companyNameHeuristic
 * gespeichert, damit die Line-Item-Sanitization sie auch dort als
 * Adress-Salat erkennt und entfernt.
 */

import {
  pickCompanyFromTextSources,
  type CompanyNameHeuristicResult,
  type SignatureAddressBlock,
  COMPANY_NAME_HEURISTICS_VERSION,
} from "./companyNameHeuristics";
import { sanitizePhoneField } from "./buyerContactFieldUtils";
import { enrichExtractedDataFromEmailHeaders } from "./emailHeaderContactEnrichment";

type LooseRecord = Record<string, unknown>;

type AddressFieldKey =
  | "customer.company"
  | "customer.email"
  | "customer.phone"
  | "billingAddress.company"
  | "billingAddress.street"
  | "billingAddress.zipCode"
  | "billingAddress.city"
  | "billingAddress.country"
  | "billingAddress.phone";

/**
 * Sehr defensive Prüfung „Feld ist nicht sinnvoll gefüllt".
 * Behandelt sowohl `undefined` als auch leere/whitespace-Strings und
 * einzeilige Müll-Token wie „-" / „n/a".
 */
function isEmptyCompanyValue(v: unknown): boolean {
  if (typeof v !== "string") return v == null;
  const s = v.trim();
  if (!s) return true;
  if (/^[-–—.•·]+$/.test(s)) return true;
  if (/^(n\/?a|na|none|unbekannt|unknown)$/i.test(s)) return true;
  return false;
}

function readField(obj: LooseRecord | undefined, key: string): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  const v = (obj as Record<string, unknown>)[key];
  return typeof v === "string" ? v : undefined;
}
function readCompany(obj: LooseRecord | undefined): string | undefined {
  return readField(obj, "company");
}
function readEmail(obj: LooseRecord | undefined): string | undefined {
  return readField(obj, "email");
}

export type CompanyNameAgentInput = {
  extractedData: LooseRecord;
  /** Vorrang: vom Aufrufer übergebener Plain-Text der Hauptdatei. */
  primaryDocumentText?: string | null;
  /** E-Mail-Betreff + Body derselben Nachricht (sofern Email-Pipeline). */
  emailContext?: string | null;
  /** Texte weiterer Anhänge derselben Mail. */
  siblingPdfExcerpts?: string | null;
  /** Optional: explizit bekannte Absender-Mailadresse für Domain-Match. */
  senderEmailAddress?: string | null;
};

export type CompanyNameAgentTrace = {
  /** Wurde überhaupt ein Firmen-Treffer mit ausreichendem Score gefunden? */
  matched: boolean;
  /** Wurde mindestens ein Feld in extractedData übernommen? */
  applied: boolean;
  /** Welche Felder wurden bestückt (für Debug-UI sichtbar). */
  appliedTo: AddressFieldKey[];
  /** Komplettes Heuristik-Ergebnis, inkl. aller Kandidaten + Adressblock. */
  heuristic: CompanyNameHeuristicResult;
  /**
   * Gesammelte Roh-Tokens aus Footer/Briefkopf (Straße, PLZ, Ort, Telefon,
   * E-Mail). Wird von der Line-Item-Sanitization genutzt, um identische
   * Strings nicht versehentlich als Produkt zu akzeptieren.
   */
  collectedAddressTokens: string[];
  /** Falls Firma nicht übernommen wurde: kurzer Grund. */
  skippedReason?:
    | "already_filled"
    | "no_candidate"
    | "low_score"
    | "blocked_meta_own_company";
  version: string;
};

function ensureObject(extractedData: LooseRecord, key: "customer" | "billingAddress"): LooseRecord {
  if (!extractedData[key] || typeof extractedData[key] !== "object") {
    extractedData[key] = {};
  }
  return extractedData[key] as LooseRecord;
}

function fillIfEmpty(
  trace: CompanyNameAgentTrace,
  obj: LooseRecord,
  fieldName: string,
  value: string | undefined,
  fullKey: AddressFieldKey
): void {
  if (!value) return;
  const existing = obj[fieldName];
  const existingStr = typeof existing === "string" ? existing : undefined;
  if (fieldName === "company") {
    if (!isEmptyCompanyValue(existingStr)) return;
  } else if (existingStr !== undefined && existingStr.trim().length > 0) {
    return;
  }
  obj[fieldName] = value;
  trace.appliedTo.push(fullKey);
}

/**
 * Wendet die Heuristik auf extractedData an. Idempotent: mehrfacher Aufruf
 * verändert nichts mehr, sobald die Felder gesetzt sind.
 *
 * Wichtig: alle Felder werden NUR befüllt, wenn sie aktuell leer/`n/a` sind.
 * Bestehende Werte (LLM-Output) werden niemals überschrieben.
 */
export function enrichExtractedDataWithCompanyHeuristic(
  input: CompanyNameAgentInput
): CompanyNameAgentTrace {
  const { extractedData, primaryDocumentText, emailContext, siblingPdfExcerpts, senderEmailAddress } = input;

  const customer = (extractedData.customer as LooseRecord | undefined) ?? undefined;
  const billing = (extractedData.billingAddress as LooseRecord | undefined) ?? undefined;

  const existingCustomerCompany = readCompany(customer);
  const existingBillingCompany = readCompany(billing);
  const existingEmail =
    readEmail(customer) ??
    readEmail(billing) ??
    (typeof extractedData.customerEmail === "string"
      ? (extractedData.customerEmail as string)
      : undefined) ??
    (typeof extractedData.emailFrom === "string"
      ? (extractedData.emailFrom as string)
      : undefined);

  const sources = [
    { source: "emailContext", text: typeof emailContext === "string" ? emailContext : "" },
    { source: "primaryDocumentText", text: typeof primaryDocumentText === "string" ? primaryDocumentText : "" },
    { source: "siblingPdfExcerpts", text: typeof siblingPdfExcerpts === "string" ? siblingPdfExcerpts : "" },
  ].filter((s) => s.text.length > 0);

  const emailAddresses: string[] = [];
  if (typeof senderEmailAddress === "string" && senderEmailAddress.trim()) emailAddresses.push(senderEmailAddress);
  if (existingEmail) emailAddresses.push(existingEmail);

  const heuristic = pickCompanyFromTextSources({
    sources,
    emailAddresses,
    blockNames: [existingCustomerCompany, existingBillingCompany],
  });

  const trace: CompanyNameAgentTrace = {
    matched: !!heuristic.top,
    applied: false,
    appliedTo: [],
    heuristic,
    collectedAddressTokens: heuristic.address.rawTokens.slice(),
    version: COMPANY_NAME_HEURISTICS_VERSION,
  };

  // Wenn weder Firma noch Adressblock-Tokens gefunden: nur Trace schreiben.
  if (!heuristic.top && trace.collectedAddressTokens.length === 0) {
    trace.skippedReason = heuristic.candidates.length === 0 ? "no_candidate" : "low_score";
    (extractedData as LooseRecord).companyNameHeuristic = trace;
    return trace;
  }

  // --- Firma ---
  if (heuristic.top) {
    const candidate = heuristic.top.display;
    const bothFilled =
      !isEmptyCompanyValue(existingCustomerCompany) && !isEmptyCompanyValue(existingBillingCompany);
    if (!bothFilled) {
      const cust = ensureObject(extractedData, "customer");
      const bill = ensureObject(extractedData, "billingAddress");
      fillIfEmpty(trace, cust, "company", candidate, "customer.company");
      fillIfEmpty(trace, bill, "company", candidate, "billingAddress.company");
    } else {
      trace.skippedReason = "already_filled";
    }
  } else {
    trace.skippedReason = heuristic.candidates.length === 0 ? "no_candidate" : "low_score";
  }

  // --- Adressblock (Straße, PLZ, Ort, Land) — auf billingAddress ---
  const addr: SignatureAddressBlock = heuristic.address;
  if (addr.street || addr.zipCode || addr.city || addr.country || addr.phone) {
    const bill = ensureObject(extractedData, "billingAddress");
    fillIfEmpty(trace, bill, "street", addr.street, "billingAddress.street");
    fillIfEmpty(trace, bill, "zipCode", addr.zipCode, "billingAddress.zipCode");
    fillIfEmpty(trace, bill, "city", addr.city, "billingAddress.city");
    fillIfEmpty(trace, bill, "country", addr.country, "billingAddress.country");
    const billPhone = sanitizePhoneField(addr.phone);
    fillIfEmpty(trace, bill, "phone", billPhone, "billingAddress.phone");
  }

  // --- Kontaktdaten (E-Mail, Telefon) — auf customer ---
  if (addr.email || addr.phone) {
    const cust = ensureObject(extractedData, "customer");
    fillIfEmpty(trace, cust, "email", addr.email, "customer.email");
    const custPhone = sanitizePhoneField(addr.phone);
    fillIfEmpty(trace, cust, "phone", custPhone, "customer.phone");
  }

  trace.applied = trace.appliedTo.length > 0;
  (extractedData as LooseRecord).companyNameHeuristic = trace;

  enrichExtractedDataFromEmailHeaders(extractedData, primaryDocumentText);

  return trace;
}
