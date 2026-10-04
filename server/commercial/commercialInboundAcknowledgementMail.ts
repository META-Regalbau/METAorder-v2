/**
 * Eingangsbestätigung an den Absender einer eingegangenen Bestellung/Anfrage.
 *
 * Zweck: Die meisten Kunden binden nie eine API an, wollen aber wissen, dass ihre Mail
 * angekommen ist und richtig gelesen wurde. Die Mail spiegelt deshalb die erkannten
 * Positionen zurück — Fehler fallen dem Kunden sofort auf, nicht erst beim Wareneingang.
 *
 * Sicherheitsnetz, weil hier automatisch nach außen gesendet wird:
 *   - Standardmäßig **aus** (`inboundAcknowledgementEnabled`)
 *   - nur an echte Absenderadressen, nie an Automaten-/META-eigene Adressen
 *   - genau **einmal** je Vorgang (Marker im Entwurf)
 *   - keine Zusage: Der Text bestätigt ausdrücklich nur den Eingang
 */

import type { OrderAcknowledgement } from "./commercialOrderAcknowledgement";
import { isMetaOwnCompany } from "./metaCompanyBlocklist";

/** Adressen, an die nie automatisch geantwortet wird — sonst drohen Mailschleifen. */
const AUTOMATED_LOCAL_PARTS =
  /^(noreply|no-reply|donotreply|do-not-reply|mailer-daemon|postmaster|bounce|bounces|automailer|notifications?)$/i;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export type AcknowledgementMailDecision =
  | { send: true; recipient: string }
  | {
      send: false;
      reason:
        | "disabled"
        | "already_sent"
        | "no_recipient"
        | "invalid_recipient"
        | "automated_recipient"
        | "own_domain";
    };

export type AcknowledgementMailGuardInput = {
  enabled: boolean;
  recipientEmail: string | null | undefined;
  alreadySentAt: string | null | undefined;
  /** Eigene Domains des Betreibers — an sich selbst wird nicht bestätigt */
  ownDomains?: string[];
  /** Firmenname des Absenders, falls bekannt (META-Blocklist) */
  senderCompany?: string | null;
};

/**
 * Entscheidet, ob gesendet werden darf. Bewusst als reine Funktion, damit jede
 * Sperre einzeln testbar ist — ein Fehler hier verschickt Mail an echte Kunden.
 */
export function decideAcknowledgementMail(
  input: AcknowledgementMailGuardInput
): AcknowledgementMailDecision {
  if (!input.enabled) return { send: false, reason: "disabled" };
  if (input.alreadySentAt) return { send: false, reason: "already_sent" };

  const recipient = (input.recipientEmail || "").trim().toLowerCase();
  if (!recipient) return { send: false, reason: "no_recipient" };
  if (!EMAIL_RE.test(recipient)) return { send: false, reason: "invalid_recipient" };

  const [localPart, domain] = recipient.split("@");
  if (AUTOMATED_LOCAL_PARTS.test(localPart)) {
    return { send: false, reason: "automated_recipient" };
  }

  const ownDomains = (input.ownDomains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean);
  if (ownDomains.some((d) => domain === d || domain.endsWith(`.${d}`))) {
    return { send: false, reason: "own_domain" };
  }
  if (input.senderCompany && isMetaOwnCompany(input.senderCompany)) {
    return { send: false, reason: "own_domain" };
  }

  return { send: true, recipient };
}

function formatQuantity(value: number | null): string {
  if (value === null) return "?";
  return Number.isInteger(value) ? String(value) : String(value);
}

const TEXT = {
  de: {
    subjectOrder: (doc: string | null) =>
      doc ? `Ihre Bestellung ${doc} ist bei uns eingegangen` : "Ihre Bestellung ist bei uns eingegangen",
    subjectQuote: (doc: string | null) =>
      doc ? `Ihre Anfrage ${doc} ist bei uns eingegangen` : "Ihre Anfrage ist bei uns eingegangen",
    greeting: "Guten Tag,",
    receivedOrder: "vielen Dank für Ihre Bestellung. Wir haben sie erhalten und wie folgt erfasst:",
    receivedQuote: "vielen Dank für Ihre Anfrage. Wir haben sie erhalten und wie folgt erfasst:",
    documentNumber: "Ihre Belegnummer",
    positions: "Erfasste Positionen",
    noPositions: "Aus Ihrem Dokument konnten wir keine Positionen automatisch erfassen.",
    statusConfirmed: "erfasst",
    statusQuantityChanged: "Menge angepasst",
    statusClarification: "Rückfrage nötig",
    quantityChangedHint:
      "Bei den oben mit „Menge angepasst“ markierten Positionen weicht die Liefermenge bewusst von Ihrer Bestellmenge ab (siehe Hinweis in Klammern). Bitte prüfen Sie das für Ihre Unterlagen.",
    clarificationHint:
      "Zu den mit „Rückfrage nötig“ markierten Positionen melden wir uns bei Ihnen.",
    closingCheck:
      "Diese Nachricht bestätigt ausschließlich den Eingang — sie ist noch keine Auftragsbestätigung. Ein Mitarbeiter prüft Ihren Vorgang; die verbindliche Bestätigung erhalten Sie separat.",
    mismatchHint:
      "Sollte etwas nicht korrekt erfasst sein, antworten Sie einfach auf diese E-Mail.",
    signature: "Mit freundlichen Grüßen",
  },
  en: {
    subjectOrder: (doc: string | null) =>
      doc ? `We received your order ${doc}` : "We received your order",
    subjectQuote: (doc: string | null) =>
      doc ? `We received your enquiry ${doc}` : "We received your enquiry",
    greeting: "Hello,",
    receivedOrder: "thank you for your order. We received it and recorded it as follows:",
    receivedQuote: "thank you for your enquiry. We received it and recorded it as follows:",
    documentNumber: "Your document number",
    positions: "Recorded line items",
    noPositions: "We could not automatically read any line items from your document.",
    statusConfirmed: "recorded",
    statusQuantityChanged: "quantity adjusted",
    statusClarification: "clarification needed",
    quantityChangedHint:
      "For the items marked “quantity adjusted”, the delivered quantity intentionally differs from your ordered quantity (see the note in brackets). Please check this for your records.",
    clarificationHint: "We will get back to you regarding the items marked “clarification needed”.",
    closingCheck:
      "This message confirms receipt only — it is not yet an order confirmation. A member of our team is reviewing your document; you will receive the binding confirmation separately.",
    mismatchHint: "If anything was recorded incorrectly, simply reply to this email.",
    signature: "Kind regards",
  },
} as const;

export type AcknowledgementMailContent = { subject: string; text: string };

/**
 * Baut Betreff und Text. Reiner Text ohne HTML: geht durch jeden Client, landet seltener
 * im Spam und enthält keine nachladbaren Inhalte.
 */
export function buildAcknowledgementMail(params: {
  acknowledgement: OrderAcknowledgement;
  language?: string | null;
  senderName?: string | null;
}): AcknowledgementMailContent {
  const { acknowledgement } = params;
  const lang = (params.language || "").toLowerCase().startsWith("en") ? "en" : "de";
  const t = TEXT[lang];
  const isOrder = acknowledgement.document_type === "purchase_order";
  const docNumber = acknowledgement.buyer_document_number;

  const subject = isOrder ? t.subjectOrder(docNumber) : t.subjectQuote(docNumber);

  const lines: string[] = [];
  lines.push(t.greeting);
  lines.push("");
  lines.push(isOrder ? t.receivedOrder : t.receivedQuote);
  lines.push("");
  if (docNumber) {
    lines.push(`${t.documentNumber}: ${docNumber}`);
    lines.push("");
  }

  if (acknowledgement.line_items.length === 0) {
    lines.push(t.noPositions);
  } else {
    lines.push(`${t.positions}:`);
    let hasQuantityChange = false;
    let hasClarification = false;

    for (const item of acknowledgement.line_items) {
      const position = item.position !== null ? `${item.position}.` : "-";
      const sku = item.buyer_sku || item.supplier_sku || "";
      const description = item.description || sku || "-";
      let statusLabel: string;
      let extra = "";

      if (item.status === "quantity_changed") {
        hasQuantityChange = true;
        statusLabel = t.statusQuantityChanged;
        extra = `: ${formatQuantity(item.quantity_ordered)} -> ${formatQuantity(item.quantity_confirmed)}`;
        if (item.note) extra += ` (${item.note})`;
      } else if (item.status === "clarification_required") {
        hasClarification = true;
        statusLabel = t.statusClarification;
      } else {
        statusLabel = t.statusConfirmed;
      }

      const quantity =
        item.status === "quantity_changed"
          ? ""
          : ` ${formatQuantity(item.quantity_ordered)} x`;
      const skuSuffix = sku && sku !== description ? ` (${sku})` : "";
      lines.push(`  ${position}${quantity} ${description}${skuSuffix} — ${statusLabel}${extra}`);
    }

    if (hasQuantityChange) {
      lines.push("");
      lines.push(t.quantityChangedHint);
    }
    if (hasClarification) {
      lines.push("");
      lines.push(t.clarificationHint);
    }
  }

  lines.push("");
  lines.push(t.closingCheck);
  lines.push("");
  lines.push(t.mismatchHint);
  lines.push("");
  lines.push(t.signature);
  if (params.senderName?.trim()) {
    lines.push(params.senderName.trim());
  }

  return { subject, text: lines.join("\n") };
}
