/**
 * Kundenantworten aus dem E-Mail-Eingang: Mailart, Bestellbezug und KI-Antwortentwurf (rein bis auf den
 * KI-Aufruf, testbar). Regeln (Entscheidung 19.10.2026, Inhalte nur belegt):
 * - Die KI schreibt nur, was in den FAKTEN steht. Fehlt etwas (Liefertermin, Stand einer Reklamation),
 *   setzt sie einen Platzhalter in eckigen Klammern; verschickt wird erst, wenn keiner mehr drinsteht.
 * - Liefertermine aus Shopware gelten nicht: MO-Bestellungen tragen das Anlagedatum, Portal-Zusagen kommen
 *   aus Dummy-Beständen. Bis SAP Lieferdaten liefert, ist der Termin immer ein Platzhalter.
 * - Bestelldaten nur, wenn die Bestellung zur Absenderadresse gehört (sonst Datenschutz).
 */
import type { Order, OrderStatus, PaymentStatus } from "@shared/schema";
import type { EmailIntakeOtherType, EmailIntakeOutcome, EmailIntakeReplyKind } from "@shared/emailIntake";
import { replyPlaceholders } from "@shared/emailIntake";
import { parseLlmJsonResponse } from "../ai/llmChat";

/** Welche Antwort passt zur eingeordneten Mail? null = keine Antwort. */
export function replyKindFor(input: {
  outcome: EmailIntakeOutcome;
  otherType: EmailIntakeOtherType | null;
}): EmailIntakeReplyKind | null {
  if (input.outcome === "offer") return "offer_request";
  if (input.outcome !== "other" || !input.otherType) return null;
  if (input.otherType === "order_status") return "order_status";
  if (input.otherType === "complaint") return "complaint";
  if (input.otherType === "general") return "general";
  return null;
}

const ORDER_NUMBER_RES = [
  /\b(MO\d{5,8})\b/gi,
  /\b(?:bestell(?:ung|nummer|nr)|auftrag(?:snummer|snr)?|order(?:\s*(?:no|number|nr))?)\.?\s*[:#]?\s*([A-Z]{0,4}\d{5,10})\b/gi,
];

/** Bestellnummern aus Betreff und Text (MO… sowie „Bestellnummer 123456“), höchstens 3 */
export function findOrderNumbers(...texts: string[]): string[] {
  const found: string[] = [];
  for (const text of texts) {
    for (const re of ORDER_NUMBER_RES) {
      for (const match of text.matchAll(re)) {
        const value = match[1].toUpperCase();
        if (!found.includes(value)) found.push(value);
      }
    }
  }
  return found.slice(0, 3);
}

const ORDER_STATUS_TEXT: Record<OrderStatus, string> = {
  open: "eingegangen, noch nicht in Bearbeitung",
  in_progress: "in Bearbeitung",
  completed: "abgeschlossen",
  cancelled: "storniert",
};

const PAYMENT_STATUS_TEXT: Partial<Record<PaymentStatus, string>> = {
  open: "offen",
  paid: "bezahlt",
  authorized: "autorisiert",
  partially_paid: "teilweise bezahlt",
  refunded: "erstattet",
  cancelled: "storniert",
  reminded: "gemahnt",
  failed: "fehlgeschlagen",
};

export type ReplyOrderFacts = {
  orderNumber: string;
  orderDate: string | null;
  status: string;
  paymentStatus: string | null;
  shippingMethod: string | null;
  shipped: boolean;
  shippedDate: string | null;
  carrier: string | null;
  trackingCodes: string[];
  trackingLinks: string[];
  items: string[];
};

export type ReplyFacts = {
  /** Gefundene Nummern im Text */
  orderNumbers: string[];
  /** Bestellung gefunden und gehört zum Absender */
  order: ReplyOrderFacts | null;
  /** Hinweis für das Ticket, warum keine Bestelldaten verwendet wurden */
  orderNote: string | null;
  /** Verlinkter Angebotsentwurf (Angebotsanfrage) */
  offerDraftId?: string | null;
  /** Kundenmail für „Neu erstellen“ */
  mail: { subject: string; from: string; text: string };
  /** Begründung der KI, falls keine Antwort nötig */
  reason?: string | null;
};

function isoDay(value: string | undefined | null): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Fakten einer Bestellung für die Antwort (ohne Shopware-Liefertermine, siehe Kopf). */
/**
 * Sendungsnummern, die keine sind: Testwerte aus Shopware („1234567890“), eine Ziffer wiederholt oder zu
 * kurz. Sie würden dem Kunden eine falsche Sendungsverfolgung nennen.
 */
export function isPlausibleTrackingCode(code: string): boolean {
  const value = code.trim();
  if (value.length < 8) return false;
  if (/^(.)\1+$/.test(value)) return false;
  if (/test|dummy|xxx/i.test(value)) return false;
  if (/^\d+$/.test(value) && ("01234567890123456789".includes(value) || "98765432109876543210".includes(value))) return false;
  return true;
}

/** Fakten einer Bestellung für die Antwort (ohne Shopware-Liefertermine, siehe Kopf). */
export function orderFactsFor(order: Order): ReplyOrderFacts {
  const info = order.shippingInfo ?? {};
  const cancelled = order.status === "cancelled";
  const raw = info.trackingCodes?.length ? info.trackingCodes : info.trackingNumber ? info.trackingNumber.split(/,\s*/) : [];
  // Storniert: keine Versandangaben, auch wenn in Shopware noch eine Nummer steht
  const codes = cancelled ? [] : raw.filter((c) => c && isPlausibleTrackingCode(c)).slice(0, 5);
  const links = cancelled ? [] : (info.trackingLinks ?? []).filter((l) => l.url && codes.includes(l.code)).map((l) => l.url);
  return {
    orderNumber: order.orderNumber,
    orderDate: isoDay(order.orderDate || order.createdAt),
    status: ORDER_STATUS_TEXT[order.status] ?? order.status,
    paymentStatus: PAYMENT_STATUS_TEXT[order.paymentStatus] ?? null,
    shippingMethod: order.shippingMethod || null,
    shipped: !cancelled && Boolean(info.shippedDate || codes.length > 0),
    shippedDate: cancelled ? null : isoDay(info.shippedDate),
    carrier: cancelled ? null : info.carrier || null,
    trackingCodes: codes,
    trackingLinks: links.slice(0, 5),
    items: (order.items ?? []).slice(0, 10).map((i) => `${i.quantity} × ${i.name}`),
  };
}

/**
 * Bestellung zur Absenderadresse wählen: bei doppelten Nummern die zuletzt geänderte. Gehört keine
 * Bestellung mit dieser Nummer zum Absender, werden keine Daten verwendet.
 */
export function pickOrderForSender(
  candidates: Order[],
  senderEmail: string,
): { order: Order | null; note: string | null } {
  if (candidates.length === 0) return { order: null, note: "Bestellnummer nicht gefunden" };
  const sender = senderEmail.trim().toLowerCase();
  const own = candidates
    .filter((o) => (o.customerEmail || "").trim().toLowerCase() === sender)
    .sort((a, b) => String(b.updatedAt ?? b.createdAt ?? "").localeCompare(String(a.updatedAt ?? a.createdAt ?? "")));
  if (own.length === 0) {
    return { order: null, note: "Bestellung gehört zu einer anderen E-Mail-Adresse, Daten nicht verwendet" };
  }
  return { order: own[0], note: null };
}

const KIND_TASK: Record<EmailIntakeReplyKind, string> = {
  order_status:
    "Der Kunde fragt nach dem Stand seiner Bestellung oder Lieferung. Nenne den Stand aus den FAKTEN (Status, versendet ja/nein, Versandart, Sendungsnummer mit Link). " +
    "Ist die Bestellung storniert: teile das mit, nenne keine Versandangaben und biete an, Fragen zur Stornierung zu klären. " +
    "Einen Liefertermin kennst du nicht: Ist die Bestellung nicht versendet, schreibe den Satz zum voraussichtlichen Liefertermin mit dem Platzhalter [Liefertermin eintragen]. " +
    "Ist eine Bestellnummer genannt, die Bestellung fehlt aber in den FAKTEN: schreibe, dass wir den Stand prüfen, und setze [Stand der Bestellung eintragen]. " +
    "Ist keine Bestellnummer genannt: bitte nur höflich um die Bestellnummer, ohne Platzhalter.",
  complaint:
    "Der Kunde reklamiert. Bestätige den Eingang, entschuldige dich für die Unannehmlichkeiten, ohne Schuld anzuerkennen oder etwas zuzusagen (kein Ersatz, keine Gutschrift, keine Frist). " +
    "Bitte um das, was zur Prüfung fehlt: Bestellnummer (falls nicht genannt), Fotos des Schadens bzw. der betroffenen Teile, bei Transportschäden Fotos der Verpackung. " +
    "Schreibe, dass wir uns nach der Prüfung melden, mit dem Platzhalter [nächster Schritt eintragen].",
  general:
    "Der Kunde stellt eine Frage. Beantworte nur, was eindeutig aus den FAKTEN hervorgeht. Für alles Fachliche (Maße, Tragfähigkeit, Montage, Preise, Verfügbarkeit) " +
    "setze Platzhalter wie [Antwort zur Frage eintragen], statt etwas zu behaupten.",
  offer_request:
    "Der Kunde hat ein Angebot angefragt. Bestätige freundlich den Eingang der Anfrage und dass er das Angebot in Kürze erhält. Nenne keine Preise, Rabatte oder Lieferzeiten.",
};

export const REPLY_SYSTEM = [
  "Du schreibst Antwort-E-Mails für META Regalbau (Hersteller von Regalsystemen) an Kunden.",
  "Regeln:",
  "- Deutsch, Sie-Form, Wir-Form für META, freundlich und sachlich, kurz (höchstens 120 Wörter ohne Gruß). Keine Floskeln wie „Wir hoffen, diese E-Mail erreicht Sie gut“.",
  "- Verwende ausschließlich Angaben aus den FAKTEN und aus der Kundenmail. Erfinde nichts: keine Termine, Preise, Zusagen, Namen oder Telefonnummern.",
  "- Fehlt eine Angabe, die in die Antwort gehört, setze einen kurzen Platzhalter in eckigen Klammern, z. B. [Liefertermin eintragen]. Sonst keine eckigen Klammern.",
  "- Beginne immer mit der Anrede: mit Namen, wenn er in der Kundenmail eindeutig ist (z. B. „Guten Tag Herr Müller,“), sonst „Guten Tag,“.",
  "- Kein Gruß und keine Signatur am Ende, die werden angehängt.",
  "- needsReply=false nur, wenn die Mail keine Antwort braucht (z. B. reiner Dank, Bestätigung ohne Frage, kein Kunde).",
  'Antworte nur mit JSON: {"needsReply": true|false, "reason": "kurz, warum", "reply": "Text der Antwort ohne Gruß"}',
].join("\n");

export function buildReplyPrompt(input: {
  kind: EmailIntakeReplyKind;
  facts: ReplyFacts;
}): string {
  const { kind, facts } = input;
  const lines = [`AUFGABE: ${KIND_TASK[kind]}`, "", "FAKTEN:"];
  if (facts.order) {
    const o = facts.order;
    lines.push(`- Bestellnummer: ${o.orderNumber}`);
    if (o.orderDate) lines.push(`- Bestelldatum: ${o.orderDate}`);
    lines.push(`- Status: ${o.status}`);
    if (o.paymentStatus) lines.push(`- Zahlung: ${o.paymentStatus}`);
    if (o.shippingMethod) lines.push(`- Versandart: ${o.shippingMethod}`);
    lines.push(`- Versendet: ${o.shipped ? `ja${o.shippedDate ? ` (am ${o.shippedDate})` : ""}` : "nein"}`);
    if (o.carrier) lines.push(`- Versanddienstleister: ${o.carrier}`);
    if (o.trackingCodes.length) lines.push(`- Sendungsnummer(n): ${o.trackingCodes.join(", ")}`);
    if (o.trackingLinks.length) lines.push(`- Sendungsverfolgung: ${o.trackingLinks.join(" ")}`);
    if (o.items.length) lines.push(`- Positionen: ${o.items.join("; ")}`);
    lines.push("- Liefertermin: unbekannt");
  } else if (facts.orderNumbers.length) {
    lines.push(`- Genannte Bestellnummer(n): ${facts.orderNumbers.join(", ")} (Stand liegt nicht vor)`);
  } else {
    lines.push("- Keine Bestellnummer genannt");
  }
  lines.push("", "KUNDENMAIL:", `Von: ${facts.mail.from}`, `Betreff: ${facts.mail.subject}`, "", facts.mail.text.slice(0, 6000));
  return lines.join("\n");
}

export type ReplyLlmResult = { needsReply: boolean; reason: string; reply: string };

export function interpretReplyResponse(raw: string): ReplyLlmResult | null {
  const parsed = parseLlmJsonResponse(raw) as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object") return null;
  const reply = typeof parsed.reply === "string" ? parsed.reply.trim() : "";
  const needsReply = parsed.needsReply !== false;
  if (needsReply && !reply) return null;
  return { needsReply, reason: typeof parsed.reason === "string" ? parsed.reason.trim().slice(0, 300) : "", reply };
}

const GREETING_RE = /^(guten\s+(tag|morgen|abend)|hallo|sehr\s+geehrte|liebe[rs]?\s|moin|grüß\s*gott|servus)/i;

/** Die KI lässt die Anrede manchmal weg: dann „Guten Tag,“ davor. */
export function ensureGreeting(reply: string): string {
  const body = reply.trim();
  if (GREETING_RE.test(body)) return body;
  return `Guten Tag,\n\n${body.charAt(0).toUpperCase()}${body.slice(1)}`;
}

/** Gruß anhängen; ohne eingestellte Signatur bleibt ein Platzhalter, damit niemand ohne Namen verschickt. */
export function withSignature(reply: string, signature: string): string {
  const body = ensureGreeting(reply).replace(/\n{3,}/g, "\n\n");
  return `${body}\n\nMit freundlichen Grüßen\n${signature.trim() || "[Name eintragen]"}`;
}

export { replyPlaceholders };
