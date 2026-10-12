/**
 * Werte für die Zusatzfelder der Shopware-Bestellung aus dem Entwurf (Einstellung siehe
 * shared/orderFieldMapping.ts). Reine Funktionen; Besteller und Vertriebsmitarbeiter ermittelt
 * orderPeople.ts vorher im Shop.
 */
import {
  DELIVERY_DATE_TARGET,
  ORDER_FIELD_SOURCES,
  type OrderFieldMappingSettings,
  type OrderFieldSource,
  type OrderFieldTarget,
} from "@shared/orderFieldMapping";

export type OrderFieldInputs = {
  customerOrderNumber?: string | null;
  commission?: string | null;
  customerReference?: string | null;
  notes?: string | null;
  confirmationEmail?: string | null;
  invoiceEmail?: string | null;
  offerId?: string | null;
  ordererEmployeeId?: string | null;
  salesRepresentativeId?: string | null;
  deliveryDate?: { earliest: string; latest: string } | null;
  /** Kunden-Artikelnummer und Originaltext je Produkt-ID (ohne Bindestriche, klein) */
  lineCustomerText?: Map<string, string>;
};

export type OrderFieldValues = {
  order: Record<string, unknown>;
  lineItems: Map<string, Record<string, unknown>>;
  delivery: { shippingDateEarliest?: string; shippingDateLatest?: string };
  /** Was wohin ging (für Protokoll und Vorschau) */
  applied: Array<{ source: OrderFieldSource; field: string; value: unknown }>;
};

const TEXT_MAX = 2000;
const LINE_TEXT_MAX = 255;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[A-Za-z]{2,}$/;

export const normProductId = (id: string) => id.replace(/-/g, "").toLowerCase();

const clean = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).replace(/\s+\n/g, "\n").trim();
  return s ? s : null;
};

/** Wert in die Form des Feldtyps bringen; null = nicht übergeben */
function coerce(value: string, target: OrderFieldTarget, isEmail: boolean, max: number): unknown {
  const type = target.type.toLowerCase();
  if (type === "json") {
    if (isEmail) {
      const mails = value.split(/[;,\s]+/).map((m) => m.trim().toLowerCase()).filter((m) => EMAIL_RE.test(m));
      // wie das Portal: {"mail":"mail"}
      return mails.length ? Object.fromEntries(mails.map((m) => [m, m])) : null;
    }
    return value.slice(0, max);
  }
  if (type === "int") {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? n : null;
  }
  if (type === "float") {
    const n = Number(value.replace(",", "."));
    return Number.isFinite(n) ? n : null;
  }
  if (type === "bool" || type === "checkbox" || type === "switch") return null;
  return value.slice(0, max);
}

/** Zweiter Wert für dasselbe Feld: Texte verbinden, Objekte zusammenführen, sonst bleibt der erste */
function merge(existing: unknown, next: unknown, max: number): unknown {
  if (existing === undefined) return next;
  if (typeof existing === "string" && typeof next === "string") {
    if (existing === next || existing.split(" / ").includes(next)) return existing;
    return `${existing} / ${next}`.slice(0, max);
  }
  if (existing && next && typeof existing === "object" && typeof next === "object" && !Array.isArray(existing)) {
    return { ...(existing as object), ...(next as object) };
  }
  return existing;
}

const EMAIL_SOURCES = new Set<OrderFieldSource>(["confirmationEmail", "invoiceEmail"]);

export function buildOrderFieldValues(settings: OrderFieldMappingSettings, inputs: OrderFieldInputs): OrderFieldValues {
  const out: OrderFieldValues = { order: {}, lineItems: new Map(), delivery: {}, applied: [] };
  if (!settings.enabled) return out;

  const scalar: Partial<Record<OrderFieldSource, string | null>> = {
    customerOrderNumber: clean(inputs.customerOrderNumber),
    commission: clean(inputs.commission),
    customerReference: clean(inputs.customerReference),
    notes: clean(inputs.notes),
    confirmationEmail: clean(inputs.confirmationEmail),
    invoiceEmail: clean(inputs.invoiceEmail),
    offer: clean(inputs.offerId),
    orderer: clean(inputs.ordererEmployeeId),
    salesRepresentative: clean(inputs.salesRepresentativeId),
  };

  for (const source of ORDER_FIELD_SOURCES) {
    for (const target of settings.targets[source] ?? []) {
      if (source === "deliveryDate") {
        if (target.field === DELIVERY_DATE_TARGET && inputs.deliveryDate) {
          out.delivery = { shippingDateEarliest: inputs.deliveryDate.earliest, shippingDateLatest: inputs.deliveryDate.latest };
          out.applied.push({ source, field: target.field, value: inputs.deliveryDate });
        }
        continue;
      }
      if (source === "lineCustomerText") {
        for (const [productId, text] of inputs.lineCustomerText ?? []) {
          const value = coerce(text, target, false, LINE_TEXT_MAX);
          if (value == null) continue;
          const fields = out.lineItems.get(productId) ?? {};
          fields[target.field] = merge(fields[target.field], value, LINE_TEXT_MAX);
          out.lineItems.set(productId, fields);
        }
        if (inputs.lineCustomerText?.size) out.applied.push({ source, field: target.field, value: inputs.lineCustomerText.size });
        continue;
      }
      const raw = scalar[source];
      if (!raw) continue;
      const value = coerce(raw, target, EMAIL_SOURCES.has(source), TEXT_MAX);
      if (value == null) continue;
      out.order[target.field] = merge(out.order[target.field], value, TEXT_MAX);
      out.applied.push({ source, field: target.field, value });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Entwurf → Eingaben

const pad = (n: number) => String(n).padStart(2, "0");
const isoDay = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const dayAt = (d: Date) => `${isoDay(d)}T00:00:00.000Z`;

function validDate(y: number, m: number, d: number): Date | null {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date : null;
}

/** Montag der ISO-Kalenderwoche */
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - day + 1 + (week - 1) * 7);
  return monday;
}

/**
 * Wunschliefertermin aus dem Beleg: „2026-10-20“, „20.10.2026“, „20.10.26“, „KW 43“, „KW 43/2026“.
 * Ein Tag → Zeitraum dieses Tages; eine Woche → Montag bis Freitag. Vergangenes oder Unlesbares → null.
 */
export function parseRequestedDeliveryDate(raw: unknown, now = new Date()): { earliest: string; latest: string } | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

  const kw = s.match(/\b(?:kw|kalenderwoche|cw|week)\s*\.?\s*(\d{1,2})(?:\s*[/.\-\s]\s*(\d{2,4}))?/i);
  if (kw) {
    const week = Number(kw[1]);
    if (week < 1 || week > 53) return null;
    const explicitYear = kw[2] ? Number(kw[2].length === 2 ? `20${kw[2]}` : kw[2]) : null;
    let monday = isoWeekMonday(explicitYear ?? today.getUTCFullYear(), week);
    if (!explicitYear && monday.getTime() + 4 * 864e5 < today.getTime()) monday = isoWeekMonday(today.getUTCFullYear() + 1, week);
    const friday = new Date(monday.getTime() + 4 * 864e5);
    if (friday < today) return null;
    return { earliest: dayAt(monday < today ? today : monday), latest: dayAt(friday) };
  }

  let date: Date | null = null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const de = s.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{2,4})\b/);
  if (iso) date = validDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  else if (de) date = validDate(Number(de[3].length === 2 ? `20${de[3]}` : de[3]), Number(de[2]), Number(de[1]));
  if (!date || date < today) return null;
  return { earliest: dayAt(date), latest: dayAt(date) };
}

/**
 * Lieferfenster („KW 39/26“) als Ersatz, wenn der Beleg kein Lieferdatum hat – nur wenn dort
 * ausschließlich ein Datum oder eine Woche steht. Annahmezeiten oder Sperrtage („am 28.09.26 keine
 * Warenannahme“) dürfen kein Liefertermin werden.
 */
export function parseDeliveryWindow(raw: unknown, now = new Date()): { earliest: string; latest: string } | null {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!/^(?:(?:kw|kalenderwoche)\s*\.?\s*\d{1,2}(?:\s*[/.\-\s]\s*\d{2,4})?|\d{1,2}\.\d{1,2}\.\d{2,4}|\d{4}-\d{2}-\d{2})$/i.test(s)) return null;
  return parseRequestedDeliveryDate(s, now);
}

type Loose = Record<string, any>;

type MatchItem = {
  extractedProductName?: string;
  extractedPositionNumber?: string;
  matchedProduct?: { id: string } | null;
  bundle?: unknown;
};

const normText = (s: unknown) => (typeof s === "string" ? s.toLowerCase().replace(/\s+/g, " ").trim() : "");

/**
 * Je Produkt: Kunden-Artikelnummer (nur wenn Position und Text zur Belegzeile passen) und der
 * Originaltext der Bestellung. Mehrere Zeilen desselben Artikels werden mit „ | “ verbunden.
 */
export function collectLineCustomerTexts(extractedData: Loose, items: MatchItem[]): Map<string, string> {
  const docLines = ((extractedData.documentExtraction as Loose | undefined)?.line_items ?? []) as Array<Loose>;
  const out = new Map<string, string>();
  for (const item of items) {
    if (item.bundle || !item.matchedProduct?.id) continue;
    const text = clean(item.extractedProductName);
    const pos = clean(item.extractedPositionNumber);
    const docLine = pos ? docLines.find((l) => String(l.position ?? "") === pos) : undefined;
    const buyerSku =
      docLine && normText(docLine.description) && normText(docLine.description) === normText(item.extractedProductName)
        ? clean(docLine.buyer_sku)
        : null;
    const part = [buyerSku ? `Kd.-Art.-Nr. ${buyerSku}` : null, text].filter(Boolean).join(" · ");
    if (!part) continue;
    const key = normProductId(item.matchedProduct.id);
    const prev = out.get(key);
    out.set(key, (prev && prev !== part ? `${prev} | ${part}` : part).slice(0, LINE_TEXT_MAX));
  }
  return out;
}

/** Alles aus dem Entwurf, was ohne Shop-Abfrage feststeht */
export function collectOrderFieldInputs(
  draft: { extractedData?: unknown; buyerDocumentNumber?: string | null; matchingResults?: { items?: MatchItem[] } | null },
  now = new Date(),
): OrderFieldInputs {
  const ed = (draft.extractedData ?? {}) as Loose;
  const refs = (ed.documentReferences ?? {}) as Loose;
  const doc = ((ed.documentExtraction as Loose | undefined)?.document ?? {}) as Loose;
  const orderNumber = clean(draft.buyerDocumentNumber) ?? clean(doc.number);
  const commission = clean(refs.commission);
  const offerRef = ed.offerReference as Loose | undefined;
  const offerId =
    offerRef?.offerId && offerRef.noteCode !== "other_customer" && offerRef.noteCode !== "not_found" ? clean(offerRef.offerId) : null;
  const notes = [clean(ed.orderNotes), clean(refs.deliveryNoteInstructions) ? `Lieferschein/Anlieferung: ${clean(refs.deliveryNoteInstructions)}` : null]
    .filter(Boolean)
    .join("\n");
  return {
    customerOrderNumber: orderNumber,
    commission: commission && commission !== orderNumber ? commission : null,
    customerReference: clean(refs.customerReference),
    notes: notes || null,
    confirmationEmail: clean(refs.orderConfirmationEmail),
    invoiceEmail: clean(refs.invoiceEmail),
    offerId,
    deliveryDate: parseRequestedDeliveryDate(doc.delivery_date, now) ?? parseDeliveryWindow((ed.documentExtraction as Loose | undefined)?.delivery_address?.delivery_window, now),
    lineCustomerText: collectLineCustomerTexts(ed, draft.matchingResults?.items ?? []),
  };
}

/** E-Mails, über die der Besteller als B2B-Mitarbeiter gesucht wird (Reihenfolge = Vorrang) */
export function ordererEmailCandidates(extractedData: unknown): string[] {
  const ed = (extractedData ?? {}) as Loose;
  const list = [
    ed.customer?.email,
    (ed.documentExtraction as Loose | undefined)?.buyer?.email,
    ed.documentReferences?.orderConfirmationEmail,
  ];
  const out: string[] = [];
  for (const v of list) {
    const e = typeof v === "string" ? v.trim().toLowerCase() : "";
    if (EMAIL_RE.test(e) && !out.includes(e)) out.push(e);
  }
  return out;
}
