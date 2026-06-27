/**
 * Vorschau-Text für eine Rückfrage-Mail an den Kunden bei unklaren Commercial-Drafts.
 * Kein Versand — nur { to, subject, body } für UI/API.
 */

export type ClarificationEmailPayload = {
  to: string;
  subject: string;
  body: string;
};

type LooseAddress = {
  firstName?: string;
  lastName?: string;
  street?: string;
  zipCode?: string;
  city?: string;
  country?: string;
  company?: string;
  phone?: string;
};

type LooseCustomer = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  company?: string;
};

type LooseMatchItem = {
  extractedProductName?: string;
  extractedPositionNumber?: string;
  extractedProductNumber?: string;
  quantity?: number;
  status?: string;
  confidence?: number;
  catalogMatchSkipped?: boolean;
  productScreen?: { likelihood?: string; reasons?: string[] };
  matchedProduct?: { name?: string; productNumber?: string };
};

function trim(s: unknown): string {
  return typeof s === "string" ? s.trim() : "";
}

function displayName(c: LooseCustomer | undefined): string {
  if (!c) return "";
  const parts = [trim(c.firstName), trim(c.lastName)].filter(Boolean);
  if (parts.length) return parts.join(" ");
  return trim(c.company);
}

function collectMissingCustomerFields(
  customer: LooseCustomer | undefined,
  billing: LooseAddress | undefined,
  shipping: LooseAddress | undefined,
  kind: "offer" | "order"
): string[] {
  const missing: string[] = [];
  const cust = customer ?? {};
  const bill = billing ?? {};
  const ship = shipping ?? {};

  const hasCompany = !!trim(cust.company) || !!trim(bill.company) || !!trim(ship.company);
  const contactName = displayName(cust) || [trim(bill.firstName), trim(bill.lastName)].filter(Boolean).join(" ");

  if (hasCompany && !trim(cust.company) && !trim(bill.company)) {
    missing.push("Firmenname (bitte vollständig angeben)");
  }
  if (!contactName && !hasCompany) {
    missing.push("Ansprechpartner (Vor- und Nachname oder Firmenname)");
  }

  if (!trim(cust.email)) missing.push("E-Mail-Adresse des Ansprechpartners");
  const phone =
    trim(cust.phone) || trim(bill.phone) || trim(ship.phone);
  if (!phone) missing.push("Telefonnummer für Rückfragen");

  const needBill =
    trim(bill.street) &&
    trim(bill.zipCode) &&
    trim(bill.city) &&
    trim(bill.country);
  if (!needBill) {
    missing.push("Vollständige Rechnungsadresse (Straße, PLZ, Ort, Land)");
  }

  if (kind === "order") {
    const needShip =
      trim(ship.street) &&
      trim(ship.zipCode) &&
      trim(ship.city) &&
      trim(ship.country);
    if (!needShip) {
      missing.push("Lieferadresse (falls abweichend von der Rechnungsadresse — sonst bitte bestätigen)");
    }
  }

  return missing;
}

function isUnclearLineItem(item: LooseMatchItem): boolean {
  if (item.catalogMatchSkipped) return true;
  if (item.productScreen?.likelihood === "unlikely_product") return true;
  if (item.status && item.status !== "matched") return true;
  return false;
}

function lineSummary(item: LooseMatchItem, index: number): string {
  const name = trim(item.extractedProductName) || "(ohne Bezeichnung)";
  const pos = trim(item.extractedPositionNumber);
  const num = trim(item.extractedProductNumber);
  const qty = typeof item.quantity === "number" ? item.quantity : 1;
  const reason = item.productScreen?.reasons?.[0];
  const bits = [
    `${index + 1}. ${name}`,
    pos ? `Pos.-Nr.: ${pos}` : null,
    num ? `Art.-/GTIN-Hinweis: ${num}` : null,
    `Menge: ${qty}`,
  ];
  if (reason) bits.push(`Hinweis: ${reason}`);
  return bits.filter(Boolean).join(" — ");
}

/**
 * Baut Betreff und Fließtext für eine höfliche Rückfrage-Mail (Deutsch).
 */
export function buildCommercialClarificationEmail(params: {
  kind: "offer" | "order";
  originalFileName: string | null | undefined;
  extractedData: Record<string, unknown> | null | undefined;
  matchingResults: { items?: LooseMatchItem[] } | null | undefined;
}): ClarificationEmailPayload {
  const { kind, originalFileName, extractedData, matchingResults } = params;
  const data = extractedData ?? {};
  const customer = data.customer as LooseCustomer | undefined;
  const billing = data.billingAddress as LooseAddress | undefined;
  const shipping = (data.shippingAddress as LooseAddress | undefined) ?? undefined;

  const to = trim(customer?.email);
  const salutationName = displayName(customer) || "geehrte Damen und Herren";

  const docLabel = trim(originalFileName) || (kind === "offer" ? "Ihre Anfrage" : "Ihre Bestellung");

  const missing = collectMissingCustomerFields(customer, billing, shipping, kind);
  const items = matchingResults?.items ?? [];
  const unclearLines = items.map((it, i) => ({ it, i })).filter(({ it }) => isUnclearLineItem(it));

  const subject =
    kind === "offer"
      ? `Rückfrage zu Ihrer Anfrage (${docLabel})`
      : `Rückfrage zu Ihrer Bestellung (${docLabel})`;

  const intro =
    kind === "offer"
      ? "vielen Dank für Ihre Anfrage. Damit wir Ihnen ein passendes Angebot erstellen können, benötigen wir noch folgende Angaben:"
      : "vielen Dank für Ihre Bestellung. Damit wir diese korrekt erfassen können, benötigen wir noch folgende Angaben:";

  const blocks: string[] = [];
  blocks.push(`Sehr geehrte/r ${salutationName},`);
  blocks.push("");
  blocks.push(intro);
  blocks.push("");

  if (missing.length > 0) {
    blocks.push("**Kundendaten / Adresse**");
    missing.forEach((m) => blocks.push(`- ${m}`));
    blocks.push("");
  }

  if (unclearLines.length > 0) {
    blocks.push("**Artikel / Positionen**");
    blocks.push(
      "Für die folgenden Positionen konnten wir keine eindeutige Zuordnung zu unserem Katalog vornehmen. Bitte nennen Sie uns je Position die exakte **Artikelnummer**, **GTIN/EAN** oder die **vollständige Produktbezeichnung** wie im Katalog:"
    );
    blocks.push("");
    unclearLines.forEach(({ it, i }) => {
      blocks.push(`- ${lineSummary(it, i)}`);
    });
    blocks.push("");
  }

  if (missing.length === 0 && unclearLines.length === 0) {
    blocks.push(
      "Aktuell sind keine offenen Klärungspunkte erkannt worden. Falls Sie dennoch eine Ergänzung senden möchten, antworten Sie einfach auf diese Nachricht."
    );
    blocks.push("");
  }

  blocks.push("Mit freundlichen Grüßen");
  blocks.push("Ihr Team");

  const body = blocks.join("\n");

  return {
    to: to || "",
    subject,
    body,
  };
}
