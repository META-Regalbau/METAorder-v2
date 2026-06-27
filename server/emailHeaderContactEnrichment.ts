/**
 * Kontaktdaten aus geparsten E-Mail-Headern (Von:/From:) in extractedData übernehmen.
 * Fill-only — bestehende LLM-/Nutzerwerte bleiben unangetastet.
 */

type LooseRecord = Record<string, unknown>;

function isEmpty(v: unknown): boolean {
  if (typeof v !== "string") return v == null;
  const s = v.trim();
  return !s || /^[-–—.•·]+$/.test(s);
}

function splitPersonName(full: string): { firstName?: string; lastName?: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { lastName: parts[0] };
  return { firstName: parts.slice(0, -1).join(" "), lastName: parts[parts.length - 1] };
}

/** Parsed draft text from formatParsedEmailForDraftExpanded (Von:/From: line). */
export function parseEmailHeaderContact(text: string): {
  firstName?: string;
  lastName?: string;
  email?: string;
} | null {
  if (!text?.trim()) return null;
  const lineMatch = text.match(/^(?:Von|From):\s*(.+)$/im);
  if (!lineMatch) return null;
  const line = lineMatch[1].trim();

  const quoted = line.match(/^"([^"]+)"\s*<([^>]+)>/);
  if (quoted) {
    const names = splitPersonName(quoted[1]);
    return { ...names, email: quoted[2].trim() };
  }

  const angle = line.match(/^([^<]+?)\s*<([^>]+)>/);
  if (angle) {
    const names = splitPersonName(angle[1].replace(/^["']|["']$/g, ""));
    return { ...names, email: angle[2].trim() };
  }

  const emailOnly = line.match(/<?([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})>?/i);
  if (emailOnly) return { email: emailOnly[1] };

  return null;
}

function ensureObject(data: LooseRecord, key: "customer" | "billingAddress"): LooseRecord {
  if (!data[key] || typeof data[key] !== "object") data[key] = {};
  return data[key] as LooseRecord;
}

function fillNameIfEmpty(
  obj: LooseRecord,
  names: { firstName?: string; lastName?: string }
): void {
  if (names.firstName && isEmpty(obj.firstName)) obj.firstName = names.firstName;
  if (names.lastName && isEmpty(obj.lastName)) obj.lastName = names.lastName;
}

/**
 * Übernimmt Ansprechpartner aus E-Mail-Kopfzeile in customer + billingAddress.
 */
export function enrichExtractedDataFromEmailHeaders(
  extractedData: LooseRecord,
  primaryDocumentText?: string | null
): boolean {
  const text = typeof primaryDocumentText === "string" ? primaryDocumentText : "";
  const parsed = parseEmailHeaderContact(text);
  if (!parsed) return false;

  let applied = false;
  const cust = ensureObject(extractedData, "customer");
  const bill = ensureObject(extractedData, "billingAddress");

  const beforeFirst = cust.firstName;
  const beforeLast = cust.lastName;
  fillNameIfEmpty(cust, parsed);
  fillNameIfEmpty(bill, parsed);
  if (cust.firstName !== beforeFirst || cust.lastName !== beforeLast) applied = true;

  if (parsed.email && isEmpty(cust.email)) {
    cust.email = parsed.email;
    applied = true;
  }

  return applied;
}
