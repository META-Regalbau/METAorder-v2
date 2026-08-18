/**
 * Auftragsbestätigung für das Kunden-ERP (fachlich eine EDI-ORDRSP).
 *
 * Antwort auf eine per Mail eingegangene Bestellung/Anfrage — positionsweise mit
 * „bestätigt / Menge geändert / Klärung nötig". Bewusst **nicht** der interne Entwurf:
 *
 *   - Der Kunde denkt in **seinen** Nummern (Belegnummer, Positionsnummer, eigene
 *     Artikelnummer). Genau die liefert das Extraktionsschema bereits mit.
 *   - Interne Bewertungsdaten (Confidence, `strictAutoCreateTrace`, Lernhinweise,
 *     Alternativvorschläge, Einkaufspreise) gehören **nicht** nach außen.
 *
 * Dieses Modul ist absichtlich frei von DB- und Netzzugriffen: Es bekommt Entwurf und
 * — sofern vorhanden — die Shopware-Bestellung übergeben und baut daraus die Antwort.
 */

/** Vorgangsstatus aus Sicht des Kunden. */
export type AcknowledgementStatus = "in_review" | "confirmed" | "rejected";

/** Positionsstatus aus Sicht des Kunden. */
export type AcknowledgementLineStatus =
  | "confirmed"
  | "quantity_changed"
  | "clarification_required";

export type AcknowledgementLineItem = {
  /** Positionsnummer aus dem Kundenbeleg */
  position: number | null;
  /** Artikelnummer des Kunden aus seinem Beleg */
  buyer_sku: string | null;
  /** Unsere Artikelnummer — erst gefüllt, wenn zugeordnet */
  supplier_sku: string | null;
  description: string | null;
  quantity_ordered: number | null;
  /** Weicht bei Umrechnungen ab (z. B. Holme → Holmebenen) */
  quantity_confirmed: number | null;
  unit: string | null;
  /** Preis, den der Kunde in seinem Beleg genannt hat */
  unit_price_ordered_net: number | null;
  /** Von Shopware berechneter Preis — nur bei bestätigtem Auftrag */
  unit_price_confirmed_net: number | null;
  line_total_confirmed_net: number | null;
  status: AcknowledgementLineStatus;
  /** Klartext-Begründung, z. B. Umrechnungshinweis */
  note: string | null;
};

export type OrderAcknowledgement = {
  buyer_document_number: string | null;
  document_type: "purchase_order" | "quote_request";
  received_at: string;
  updated_at: string;
  status: AcknowledgementStatus;
  /** Unsere Belegnummer, sobald in Shopware angelegt */
  supplier_order_number: string | null;
  currency: string;
  total_confirmed_net: number | null;
  line_items: AcknowledgementLineItem[];
};

/** Minimale Sicht auf einen Entwurf — bewusst strukturell statt an Drizzle gebunden. */
export type AcknowledgementDraftInput = {
  status: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  shopwareOrderId?: string | null;
  shopwareOfferId?: string | null;
  extractedData?: unknown;
  matchingResults?: unknown;
};

/** Ausschnitt der Shopware-Bestellung, der in die Bestätigung einfließt. */
export type AcknowledgementShopwareOrder = {
  orderNumber?: string | null;
  amountNet?: number | null;
  lineItems?: Array<{
    productNumber?: string | null;
    quantity?: number | null;
    unitPrice?: number | null;
    totalPrice?: number | null;
  }> | null;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function trimmedOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoOf(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

/**
 * Belegnummer des Kunden aus der Extraktion — der Schlüssel, mit dem sein ERP fragt.
 * Wird beim Anlegen des Entwurfs in die Spalte `buyerDocumentNumber` denormalisiert.
 */
export function extractBuyerDocumentNumber(extractedData: unknown): string | null {
  const doc = asRecord(asRecord(asRecord(extractedData)?.documentExtraction)?.document);
  return trimmedOrNull(doc?.number);
}

/**
 * Übersetzt den internen Entwurfsstatus in die Kundensicht.
 *
 * Wichtig: Nicht durchreichen. Intern heißt `rejected` „Sachbearbeiter hat den Entwurf
 * verworfen" und `approved` lediglich „Extraktion sauber" — ein Kunde läse daraus
 * fälschlich eine Zu- oder Absage. Verbindlich ist ausschließlich die in Shopware
 * angelegte Bestellung.
 */
export function mapDraftStatusToAcknowledgement(draft: {
  status: string;
  shopwareOrderId?: string | null;
  shopwareOfferId?: string | null;
}): AcknowledgementStatus {
  if (draft.status === "rejected") return "rejected";
  if (draft.status === "created" && (draft.shopwareOrderId || draft.shopwareOfferId)) {
    return "confirmed";
  }
  return "in_review";
}

function lineStatusOf(params: {
  matchStatus: string | null;
  hasMatchedProduct: boolean;
  catalogMatchSkipped: boolean;
  quantityOrdered: number | null;
  quantityConfirmed: number | null;
}): AcknowledgementLineStatus {
  const { matchStatus, hasMatchedProduct, catalogMatchSkipped } = params;
  if (catalogMatchSkipped || !hasMatchedProduct || matchStatus !== "matched") {
    return "clarification_required";
  }
  const { quantityOrdered, quantityConfirmed } = params;
  if (
    quantityOrdered !== null &&
    quantityConfirmed !== null &&
    quantityOrdered !== quantityConfirmed
  ) {
    return "quantity_changed";
  }
  return "confirmed";
}

/**
 * Baut die Auftragsbestätigung.
 *
 * `shopwareOrder` wird nur bei bestätigtem Auftrag übergeben — die dort hinterlegten
 * Preise sind die einzigen verbindlichen, weil Shopware sie mit den Konditionen des
 * Kunden berechnet hat. Solange der Vorgang in Prüfung ist, werden bewusst **keine**
 * Preise als bestätigt ausgewiesen.
 */
export function buildOrderAcknowledgement(params: {
  draft: AcknowledgementDraftInput;
  draftKind: "offer" | "order";
  shopwareOrder?: AcknowledgementShopwareOrder | null;
}): OrderAcknowledgement {
  const { draft, draftKind, shopwareOrder } = params;

  const extracted = asRecord(draft.extractedData);
  const documentExtraction = asRecord(extracted?.documentExtraction);
  const documentSection = asRecord(documentExtraction?.document);
  const docLineItems = asArray(documentExtraction?.line_items);
  const legacyLineItems = asArray(extracted?.lineItems);
  const matchItems = asArray(asRecord(draft.matchingResults)?.items);

  const status = mapDraftStatusToAcknowledgement(draft);
  const confirmed = status === "confirmed";

  // Bestätigte Preise über die Artikelnummer zuordnen: Shopware fasst identische
  // Artikel zu einer Position zusammen, unsere Reihenfolge muss also nicht passen.
  const confirmedBySku = new Map<string, { unitPrice: number | null; totalPrice: number | null }>();
  if (confirmed && shopwareOrder?.lineItems) {
    for (const li of shopwareOrder.lineItems) {
      const sku = trimmedOrNull(li?.productNumber);
      if (!sku) continue;
      confirmedBySku.set(sku, {
        unitPrice: finiteOrNull(li?.unitPrice),
        totalPrice: finiteOrNull(li?.totalPrice),
      });
    }
  }

  // Führend ist die Zahl der erkannten Positionen; die Quellen sind indexgleich
  // (documentExtractionTranslate hält Legacy- und Snake-Case-Liste synchron).
  const lineCount = Math.max(matchItems.length, docLineItems.length, legacyLineItems.length);
  const lineItems: AcknowledgementLineItem[] = [];

  for (let i = 0; i < lineCount; i++) {
    const match = asRecord(matchItems[i]);
    const docLine = asRecord(docLineItems[i]);
    const legacyLine = asRecord(legacyLineItems[i]);
    const matchedProduct = asRecord(match?.matchedProduct);

    const quantityOrdered =
      finiteOrNull(match?.originalQuantity) ??
      finiteOrNull(docLine?.quantity) ??
      finiteOrNull(legacyLine?.quantity) ??
      finiteOrNull(match?.quantity);
    const quantityConfirmed =
      finiteOrNull(match?.convertedQuantity) ?? finiteOrNull(match?.quantity) ?? quantityOrdered;

    const supplierSku =
      trimmedOrNull(matchedProduct?.productNumber) ?? trimmedOrNull(docLine?.supplier_sku);

    const lineStatus = lineStatusOf({
      matchStatus: trimmedOrNull(match?.status),
      hasMatchedProduct: Boolean(matchedProduct) || Boolean(match?.bundle),
      catalogMatchSkipped: match?.catalogMatchSkipped === true,
      quantityOrdered,
      quantityConfirmed,
    });

    const confirmedPrice = supplierSku ? confirmedBySku.get(supplierSku) : undefined;

    const positionRaw =
      finiteOrNull(docLine?.position) ??
      finiteOrNull(Number(trimmedOrNull(legacyLine?.extractedPositionNumber)));

    lineItems.push({
      position: positionRaw !== null && Number.isFinite(positionRaw) ? positionRaw : i + 1,
      buyer_sku: trimmedOrNull(docLine?.buyer_sku),
      supplier_sku: supplierSku,
      description:
        trimmedOrNull(docLine?.description) ??
        trimmedOrNull(match?.extractedProductName) ??
        trimmedOrNull(legacyLine?.extractedProductName),
      quantity_ordered: quantityOrdered,
      quantity_confirmed: lineStatus === "clarification_required" ? null : quantityConfirmed,
      unit: trimmedOrNull(docLine?.unit),
      unit_price_ordered_net:
        finiteOrNull(docLine?.unit_price_net) ?? finiteOrNull(legacyLine?.extractedPrice),
      unit_price_confirmed_net: confirmedPrice?.unitPrice ?? null,
      line_total_confirmed_net: confirmedPrice?.totalPrice ?? null,
      status: lineStatus,
      note: trimmedOrNull(match?.conversionNote),
    });
  }

  const declaredType = trimmedOrNull(documentSection?.type);
  const documentType: OrderAcknowledgement["document_type"] =
    declaredType === "purchase_order" || declaredType === "quote_request"
      ? declaredType
      : draftKind === "order"
        ? "purchase_order"
        : "quote_request";

  return {
    buyer_document_number: extractBuyerDocumentNumber(draft.extractedData),
    document_type: documentType,
    received_at: isoOf(draft.createdAt),
    updated_at: isoOf(draft.updatedAt),
    status,
    supplier_order_number: confirmed ? trimmedOrNull(shopwareOrder?.orderNumber) : null,
    currency: trimmedOrNull(documentSection?.currency) ?? "EUR",
    total_confirmed_net: confirmed ? finiteOrNull(shopwareOrder?.amountNet) : null,
    line_items: lineItems,
  };
}
