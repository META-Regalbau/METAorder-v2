/**
 * Belegart je Mail-Anhang — deterministisch, ohne LLM.
 *
 * Warum: Kunden schicken neben der Bestellung oft weitere Belege mit (eigener
 * Lieferschein, der der Sendung beizulegen ist; Auftragsbestätigung; Rechnung).
 * Bisher wurde aus JEDEM PDF ein Entwurf — der Lieferschein wurde so zur zweiten
 * Bestellung mit falschen Mengen. Hier wird vor der Extraktion entschieden, welche
 * Anhänge Bestellungen sind und welche nur als Beilage am Entwurf abgelegt werden.
 *
 * Die Erkennung arbeitet auf dem Textauszug (erste ~6000 Zeichen) und dem Dateinamen.
 * Titelbegriffe am Dokumentanfang zählen mehr als Erwähnungen im Fließtext, weil
 * z. B. jeder Lieferschein auch „Ihre Bestellung: …" enthält.
 */

import type { DraftAttachmentKind } from "@shared/schema";

export type AttachmentClassification = {
  kind: DraftAttachmentKind;
  /** 0–1 */
  confidence: number;
  signals: string[];
  references: {
    deliveryNoteNumber?: string | null;
    orderNumber?: string | null;
    invoiceNumber?: string | null;
    commission?: string | null;
    documentDate?: string | null;
  };
};

type Rule = { re: RegExp; weight: number; signal: string };

/**
 * Belegtitel stehen als eigene, kurze Zeile („Lieferschein", „BESTELLUNG 21433803",
 * „Einkauf - Bestellung", „B E S T E L L U N G"). Satzfragmente wie „Wir bitten um eine
 * Auftragsbestätigung" oder „Rechnung an invoice@…" dürfen NICHT als Titel zählen —
 * deshalb arbeiten die Titelregeln auf Zeilenanfängen des Rohtexts (mit Zeilenumbrüchen).
 */
const TITLE_MAX_LINE_LEN = 90;

const TITLE_RULES: Array<{ kind: TitleKind; re: RegExp; signal: string }> = [
  { kind: "delivery_note", re: /^(?:Lieferschein|Liefer-?schein|Delivery\s+Note|Packing\s+(?:List|Slip)|Packzettel)\b/i, signal: "title_lieferschein" },
  { kind: "invoice", re: /^(?:Rechnung|Invoice|Gutschrift|Rechnungskorrektur|Proforma-?\s?Rechnung)\b(?!\s*(?:an|per|nur|bitte|senden|zu)\b)(?!s?(?:adresse|anschrift|empf))/i, signal: "title_rechnung" },
  { kind: "order_confirmation", re: /^(?:Auftragsbest[äa]tigung|Order\s+Confirmation|AB\s*[-:]?\s*Nr)\b/i, signal: "title_auftragsbestaetigung" },
  { kind: "purchase_order", re: /^(?:B\s?E\s?S\s?T\s?E\s?L\s?L\s?U\s?N\s?G|Bestellung|Bestellschein|Einkauf\s*-\s*Bestellung|Purchase\s+Order|Bestellanforderung|Anfrage|Angebotsanfrage|Preisanfrage|Request\s+for\s+Quotation)\b(?!s(?:datum|nummer|bedingungen))/i, signal: "title_bestellung" },
];
type TitleKind = "delivery_note" | "invoice" | "order_confirmation" | "purchase_order";

/** Körper-Signale (whitespace-normalisiert), bewusst niedrig gewichtet. */
const DELIVERY_NOTE_BODY: Rule[] = [
  { re: /\bLS-?\s?Nr\.?\b/i, weight: 3, signal: "ls_number_label" },
  { re: /\b(Colli|Packst[üu]cke)\b/i, weight: 2, signal: "packages" },
  { re: /vollz[äa]hlig\s+und\s+in\s+einwandfreiem\s+Zustand/i, weight: 3, signal: "receipt_confirmation_text" },
  { re: /\bAbladestelle\b/i, weight: 1, signal: "unloading_point" },
  { re: /\bTour\s*:/i, weight: 1, signal: "tour_label" },
  { re: /\bWarenempf[äa]nger\b/i, weight: 1, signal: "goods_recipient" },
];
const INVOICE_BODY: Rule[] = [
  { re: /\bRechnungs-?\s?(Nr|Nummer)\b/i, weight: 3, signal: "invoice_number_label" },
  { re: /\bRechnungsbetrag\b/i, weight: 2, signal: "invoice_amount" },
  { re: /\b(zahlbar\s+bis|F[äa]lligkeitsdatum|f[äa]llig\s+am)\b/i, weight: 2, signal: "due_terms" },
  { re: /\bLeistungsdatum\b/i, weight: 2, signal: "service_date" },
];
const ORDER_CONFIRMATION_BODY: Rule[] = [
  { re: /\bwir\s+best[äa]tigen\s+(Ihnen\s+)?(Ihren|den|die)\s+(Auftrag|Bestellung)/i, weight: 3, signal: "we_confirm" },
  { re: /\bAB-?\s?Nr\.?\s*:/i, weight: 2, signal: "ab_number_label" },
];
const PURCHASE_ORDER_BODY: Rule[] = [
  { re: /\b(wir\s+bestellen|hiermit\s+bestellen|bestellen\s+wir)\b/i, weight: 4, signal: "we_order" },
  { re: /\bbeauftragen\b/i, weight: 2, signal: "commission_verb" },
  { re: /\bBestell-?\s?(Nr|Nummer)\b/i, weight: 2, signal: "order_number_label" },
  { re: /\bLiefertermin\b/i, weight: 1, signal: "delivery_date" },
  { re: /\b(Auftragsbest[äa]tigung|AB)\s+(an|senden|zukommen|erbitten|erbeten)/i, weight: 2, signal: "asks_for_confirmation" },
  { re: /\bbitten\s+(wir\s+)?um\s+(eine\s+)?(schriftl\.?\s+)?Auftragsbest[äa]tigung/i, weight: 2, signal: "asks_for_confirmation" },
  { re: /\bBestellung\b/i, weight: 1, signal: "bestellung_mention" },
];

const FILENAME_RULES: Array<{ re: RegExp; kind: TitleKind; weight: number; signal: string }> = [
  { re: /lieferschein|liefsch|delivery[-_ ]?note|packing/i, kind: "delivery_note", weight: 3, signal: "filename_delivery_note" },
  { re: /rechnung|invoice|gutschrift/i, kind: "invoice", weight: 3, signal: "filename_invoice" },
  { re: /auftragsbest|order[-_ ]?conf|\bab[-_]?\d/i, kind: "order_confirmation", weight: 3, signal: "filename_order_confirmation" },
  { re: /bestell|order|purchase|auftrag|anfrage|rfq|\bpo[-_ ]?\d/i, kind: "purchase_order", weight: 2, signal: "filename_purchase_order" },
];

function bodyScore(text: string, rules: Rule[]): { score: number; signals: string[] } {
  let total = 0;
  const signals: string[] = [];
  for (const r of rules) {
    if (r.re.test(text)) {
      total += r.weight;
      signals.push(r.signal);
    }
  }
  return { score: total, signals };
}

function titleSignals(rawText: string): Map<TitleKind, string[]> {
  const found = new Map<TitleKind, string[]>();
  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 400);
  for (const line of lines) {
    if (line.length > TITLE_MAX_LINE_LEN) continue;
    for (const rule of TITLE_RULES) {
      if (rule.re.test(line)) {
        const list = found.get(rule.kind) ?? [];
        if (!list.includes(rule.signal)) list.push(rule.signal);
        found.set(rule.kind, list);
      }
    }
  }
  return found;
}

/** Label-Wörter, die im PDF-Textlayer direkt hinter einem anderen Label stehen können („Bestell-Nr.: Datum: 381345/000"). */
const LABEL_WORD_RE = /^(datum|lieferant|kundennr|kunde|seite|telefon|fax|nr|nummer|ansprechp\w*|ihre|unsere|bestell\w*|liefer\w*)$/i;

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const globalRe = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    for (const m of text.matchAll(globalRe)) {
      if (!m[1]) continue;
      const v = m[1].trim().replace(/[.,;:]+$/, "");
      if (v.length < 2 || v.length > 40) continue;
      if (!/\d/.test(v)) continue; // Kennnummern enthalten Ziffern — sonst war es ein Folge-Label
      if (LABEL_WORD_RE.test(v)) continue;
      return v;
    }
  }
  return null;
}

/** Kennnummern, die nachgelagerte Systeme (DMS) als Index brauchen. */
export function extractAttachmentReferences(text: string): AttachmentClassification["references"] {
  const t = text.replace(/\s+/g, " ");
  return {
    deliveryNoteNumber: firstMatch(t, [
      /\bLS-?\s?Nr\.?\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
      // Spaltenlayout im PDF-Textlayer: Wert steht VOR dem Label („… 2000528678 1433099 LS-Nr.:")
      /(\d{5,12})\s+LS-?\s?Nr\.?\s*:/i,
      /\bLieferschein(?:-|\s)?(?:Nr\.?|Nummer)\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
      /\bDelivery\s+Note\s+(?:No\.?|Number)\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
    ]),
    orderNumber: firstMatch(t, [
      /\b(?:Ihre|Unsere)?\s?Bestell(?:ung)?(?:s)?-?\s?(?:Nr\.?|Nummer)\s*:?\s*(?:Datum\s*:?\s*)?([A-Za-z0-9][\w\/.-]{1,30})/i,
      /\bBestellung\s+(?:Nr\.?\s*)?:?\s*([0-9][\w\/.-]{2,30})/i,
      /\b(?:Ihre\s+)?Bestellung\s*:\s*([0-9][\w\/ .-]{2,30}?)(?=\s(?:Bestelldatum|Datum|Kunde|Seite)|$)/i,
      /\bPurchase\s+Order\s+(?:No\.?|Number)?\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
      /\bPO-?\s?(?:No\.?|Nr\.?|Number)\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
    ]),
    invoiceNumber: firstMatch(t, [
      /\bRechnungs-?\s?(?:Nr\.?|Nummer)\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
      /\bInvoice\s+(?:No\.?|Number)\s*:?\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
    ]),
    commission: firstMatch(t, [
      /\bKom(?:m|mission)?\.?\s*(?:Nr\.?)?\s*:\s*([A-Za-z0-9][\w\/.-]{1,30})/i,
      /\bKommission\s+([A-Za-z0-9][\w\/.-]{1,30})/i,
    ]),
    documentDate: firstMatch(t, [/\bDatum\s*:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i]),
  };
}

export function classifyCommercialAttachment(params: {
  filename: string;
  /** Rohtext MIT Zeilenumbrüchen (extractPlainTextForDraft) — Titelzeilen brauchen die Zeilenstruktur. */
  text: string;
}): AttachmentClassification {
  const raw = params.text || "";
  const text = raw.replace(/\s+/g, " ").trim();
  const references = extractAttachmentReferences(text);

  if (!text || text.length < 40) {
    // Kein Text (Scan ohne OCR, Bild): nicht raten — bleibt Bestell-Kandidat und geht
    // in die Extraktion (dort greift PDF-Vision).
    return { kind: "unknown", confidence: 0, signals: ["no_text"], references };
  }

  const titles = titleSignals(raw);
  const scores: Record<TitleKind, { score: number; signals: string[] }> = {
    delivery_note: bodyScore(text, DELIVERY_NOTE_BODY),
    invoice: bodyScore(text, INVOICE_BODY),
    order_confirmation: bodyScore(text, ORDER_CONFIRMATION_BODY),
    purchase_order: bodyScore(text, PURCHASE_ORDER_BODY),
  };
  for (const [kind, sigs] of titles) {
    scores[kind].score += 6;
    scores[kind].signals.push(...sigs);
  }
  for (const rule of FILENAME_RULES) {
    if (rule.re.test(params.filename)) {
      scores[rule.kind].score += rule.weight;
      scores[rule.kind].signals.push(rule.signal);
      break;
    }
  }
  if (references.deliveryNoteNumber) {
    scores.delivery_note.score += 2;
    scores.delivery_note.signals.push("delivery_note_number_found");
  }
  // Ein Lieferschein/eine AB erwähnt praktisch immer die Bestellung („Ihre Bestellung: …") —
  // Bestell-Körpersignale zählen nur ohne fremde Titelzeile.
  const foreignTitle = [...titles.keys()].some((k) => k !== "purchase_order");
  if (foreignTitle && !titles.has("purchase_order")) {
    scores.purchase_order.score = Math.max(0, scores.purchase_order.score - 3);
  }

  const ranked = (Object.entries(scores) as Array<[TitleKind, { score: number; signals: string[] }]>).sort(
    (a, b) => b[1].score - a[1].score
  );
  const [bestKind, best] = ranked[0];
  const second = ranked[1]?.[1].score ?? 0;

  if (best.score < 4) {
    return { kind: "unknown", confidence: 0.2, signals: best.signals, references };
  }

  const margin = best.score - second;
  const hasTitle = titles.has(bestKind);
  const confidence = Math.max(
    0.35,
    Math.min(0.99, (hasTitle ? 0.6 : 0.45) + margin * 0.07 + best.score * 0.015)
  );
  return { kind: bestKind, confidence, signals: best.signals, references };
}

/** Anhänge dieser Art werden extrahiert (Entwurf); alle anderen nur als Beilage abgelegt. */
export function attachmentKindProducesDraft(kind: DraftAttachmentKind, confidence: number): boolean {
  if (kind === "purchase_order" || kind === "unknown") return true;
  // Unsichere Nicht-Bestellungen lieber extrahieren als verlieren.
  return confidence < 0.6;
}

export function attachmentKindLabelDe(kind: DraftAttachmentKind): string {
  switch (kind) {
    case "delivery_note":
      return "Lieferschein";
    case "invoice":
      return "Rechnung";
    case "order_confirmation":
      return "Auftragsbestätigung";
    case "purchase_order":
      return "Bestellung";
    case "other":
      return "Sonstiges";
    default:
      return "Unbekannt";
  }
}
