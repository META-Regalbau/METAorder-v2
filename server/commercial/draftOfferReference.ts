/**
 * Bestellung „laut Angebot …“: Positionen aus dem META-Angebot übernehmen (Entscheidung 11.10.2026).
 *
 * Händler bestellen konfigurierte Anlagen oft als eine Position mit Gesamtpreis und Verweis auf unser
 * Angebot (Steinke: „META MULTIPAL Palettenregal – Einseitige Regalzeile … laut Angebot 291037“).
 * Kein Katalogartikel passt; die verbindlichen Positionen stehen im Angebot (B2Bsellers).
 *
 * Ablauf (nach der Kundenzuordnung, vor dem KI-Abgleich):
 *   - Angebotsnummer aus references.supplier_offer_number oder dem Text („Angebot 291037“).
 *   - Angebot über die Nummer suchen (Händlerportal und Onlineshop). Gehört es einem anderen Kunden,
 *     wird nichts übernommen.
 *   - Sind schon alle Positionen sicher zugeordnet, nur den Verweis vermerken.
 *   - Sonst: Angebotspositionen werden die Entwurfspositionen (Treffer 100 %, Strategie „offer“).
 *     Konfigurationen werden in ihre Stückliste aufgelöst. Die Originalpositionen der Bestellung
 *     bleiben in offerReference.originalLineItems zur Kontrolle.
 */
import type { Offer, Product } from "@shared/schema";
import type { IStorage } from "../storage";
import type { LineItemMatch, MatchingResult } from "../products/productMatcher";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftOfferReference" });

const HIDDEN_TYPES = new Set(["subtotal", "headline", "discount", "promotion"]);
const OFFER_IN_TEXT_RE = /\b(?:laut\s+|lt\.?\s+|gem(?:äß|aess)\s+|zu\s+(?:ihrem\s+|unserem\s+)?)?(?:angebot|angebots-?nr\.?|angebotsnummer|offer|quotation)\s*(?:nr\.?|no\.?|nummer)?\s*[:#]?\s*(\d{4,10})\b/gi;

export type DraftOfferReference = {
  offerNumber: string;
  offerId: string | null;
  /** Positionen aus dem Angebot übernommen */
  applied: boolean;
  /** Warum nicht übernommen (oder Hinweis), deutsch für Protokoll */
  note: string | null;
  /** Hinweis als Code für die Oberfläche (übersetzt) */
  noteCode: "not_found" | "other_customer" | "already_matched" | "products_missing" | "no_lines" | "optional_skipped" | null;
  noteCount?: number;
  offerNet: number | null;
  documentNet: number | null;
  /** Bestellwert und Angebotswert (netto) weichen höchstens 2 % ab */
  totalsMatch: boolean | null;
  originalLineItems?: Array<Record<string, unknown>>;
};

type Line = {
  extractedProductName: string;
  extractedProductNumber?: string;
  extractedPositionNumber?: string;
  quantity: number;
  extractedPrice?: number;
};

/** Angebotsnummern aus Verweis-Feld und Positionstexten (ohne Dubletten, Verweis-Feld zuerst). */
export function detectOfferNumbers(extractedData: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => {
    const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
    const digits = s.match(/\d{4,10}/)?.[0];
    if (digits && !out.includes(digits)) out.push(digits);
  };
  const de = extractedData.documentExtraction as { references?: { supplier_offer_number?: unknown }; terms?: { notes?: unknown } } | undefined;
  push(de?.references?.supplier_offer_number);
  const refs = extractedData.documentReferences as { supplierOfferNumber?: unknown } | undefined;
  push(refs?.supplierOfferNumber);
  const texts = [
    ...((extractedData.lineItems as Line[] | undefined) ?? []).map((l) => l.extractedProductName),
    typeof extractedData.orderNotes === "string" ? extractedData.orderNotes : "",
    typeof de?.terms?.notes === "string" ? de.terms.notes : "",
  ];
  for (const text of texts) {
    for (const m of (text || "").matchAll(OFFER_IN_TEXT_RE)) push(m[1]);
  }
  return out.slice(0, 3);
}

type OfferLine = {
  productId: string | null;
  productNumber: string | null;
  label: string;
  quantity: number;
  unitPriceNet: number | null;
  fromConfiguration: boolean;
  /** Konfiguration: Gruppe und Gesamtpreis netto (wird auf die Stücklistenteile verteilt) */
  configGroup?: number;
  configTotalNet?: number | null;
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Angebotspositionen als Bestellzeilen; Konfigurationen in ihre Stückliste aufgelöst, Optionen weggelassen. */
export function offerToLines(offer: Pick<Offer, "items" | "taxStatus">): { lines: OfferLine[]; skippedOptional: number } {
  const gross = offer.taxStatus === "gross";
  const lines: OfferLine[] = [];
  let skippedOptional = 0;
  for (const item of offer.items ?? []) {
    const type = String(item?.type ?? "product");
    if (HIDDEN_TYPES.has(type)) continue;
    if (item?.optional === true) {
      skippedOptional += 1;
      continue;
    }
    const quantity = num(item?.quantity) ?? 0;
    if (quantity <= 0) continue;
    const taxRate = num(item?.price?.taxRules?.[0]?.taxRate) ?? num(item?.priceDefinition?.taxRules?.[0]?.taxRate) ?? 19;
    const unit = num(item?.unitPrice);
    const unitNet = unit == null ? null : Math.round((gross ? unit / (1 + taxRate / 100) : unit) * 100) / 100;
    const mcp = item?.payload?.metaCalcConfigurationPayload;
    const parts: any[] = mcp ? [...(mcp.partsList ?? []), ...(mcp.accessoryList ?? [])] : [];
    if (parts.length) {
      const configGroup = lines.length;
      const configTotalNet = unitNet == null ? null : Math.round(unitNet * quantity * 100) / 100;
      for (const part of parts) {
        const q = num(part?.quantity) ?? 0;
        if (q <= 0) continue;
        lines.push({
          productId: str(part?.productId),
          productNumber: str(part?.productNumber) ?? str(part?.ean),
          label: str(part?.description) ?? str(part?.productName) ?? str(part?.productNumber) ?? "Stücklistenteil",
          quantity: q * quantity,
          unitPriceNet: null,
          fromConfiguration: true,
          configGroup,
          configTotalNet,
        });
      }
      continue;
    }
    lines.push({
      productId: str(item?.productId),
      productNumber: str(item?.payload?.productNumber) ?? str(item?.product?.productNumber),
      label: str(item?.label) ?? str(item?.description) ?? "Angebotsposition",
      quantity,
      unitPriceNet: unitNet,
      fromConfiguration: false,
    });
  }
  return { lines, skippedOptional };
}

export type OfferLookup = (offerNumber: string) => Promise<Offer | null>;

function catalogNetPrice(product: Product): number | null {
  const net = num((product as { netPrice?: unknown }).netPrice);
  if (net != null && net > 0) return net;
  const gross = num(product.price);
  return gross != null && gross > 0 ? gross : null;
}

/**
 * Netto-Stückpreis je Zeile nach Angebot. Konfigurationsteile: Gesamtpreis der Konfiguration im
 * Verhältnis der Katalogpreise verteilt; fehlt einem Teil der Katalogpreis, bleibt die Gruppe ohne Preis.
 */
export function distributeOfferPrices(rows: Array<{ line: Pick<OfferLine, "unitPriceNet" | "quantity" | "configGroup" | "configTotalNet">; catalogNet: number | null }>): Array<number | null> {
  const out: Array<number | null> = rows.map((r) => (r.line.configGroup === undefined ? r.line.unitPriceNet : null));
  const groups = new Map<number, number[]>();
  rows.forEach((r, i) => {
    if (r.line.configGroup !== undefined) groups.set(r.line.configGroup, [...(groups.get(r.line.configGroup) ?? []), i]);
  });
  for (const indices of groups.values()) {
    const total = rows[indices[0]].line.configTotalNet;
    if (total == null || indices.some((i) => rows[i].catalogNet == null)) continue;
    const catalogSum = indices.reduce((s, i) => s + rows[i].catalogNet! * rows[i].line.quantity, 0);
    if (catalogSum <= 0) continue;
    const factor = total / catalogSum;
    for (const i of indices) out[i] = Math.round(rows[i].catalogNet! * factor * 100) / 100;
  }
  return out;
}

function documentNet(extractedData: Record<string, unknown>, lines: Line[]): number | null {
  const de = extractedData.documentExtraction as { document?: { total_net?: unknown } } | undefined;
  const total = num(de?.document?.total_net);
  if (total != null) return total;
  const sum = lines.reduce((s, l) => s + (typeof l.extractedPrice === "number" ? l.extractedPrice * (l.quantity || 0) : 0), 0);
  return sum > 0 ? Math.round(sum * 100) / 100 : null;
}

function allLinesSure(items: LineItemMatch[]): boolean {
  return items.length > 0 && items.every((i) => i.catalogMatchSkipped || (i.status === "matched" && i.confidence >= 90 && i.matchedProduct));
}

/**
 * Prüft Angebotsverweise und übernimmt ggf. die Positionen (in place: extractedData.lineItems,
 * matchingResults.items, extractedData.offerReference). Gibt den Verweis zurück oder null.
 */
export async function applyOfferReference(params: {
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  shopwareCustomerId: string | null;
  lookup: OfferLookup;
  products: { byId: (id: string) => Product | undefined; byIdentifier: (nr: string) => Product | undefined };
}): Promise<DraftOfferReference | null> {
  const { extractedData, matchingResults } = params;
  const numbers = detectOfferNumbers(extractedData);
  if (!numbers.length) return null;

  let offer: Offer | null = null;
  let offerNumber = numbers[0];
  for (const n of numbers) {
    offer = await params.lookup(n).catch((err) => {
      log.warn({ err, offerNumber: n }, "[DraftOfferReference] Angebot nicht geladen");
      return null;
    });
    if (offer) {
      offerNumber = n;
      break;
    }
  }
  const lines = (extractedData.lineItems as Line[] | undefined) ?? [];
  const docNet = documentNet(extractedData, lines);
  const base: DraftOfferReference = { offerNumber, offerId: offer?.id ?? null, applied: false, note: null, noteCode: null, offerNet: offer ? offer.netPrice || null : null, documentNet: docNet, totalsMatch: null };

  if (!offer) {
    const ref: DraftOfferReference = { ...base, note: "Angebot nicht in Shopware gefunden", noteCode: "not_found" };
    extractedData.offerReference = ref;
    return ref;
  }
  if (base.offerNet != null && docNet != null && base.offerNet > 0) {
    base.totalsMatch = Math.abs(docNet - base.offerNet) / base.offerNet <= 0.02;
  }
  if (params.shopwareCustomerId && offer.customerId && offer.customerId !== params.shopwareCustomerId) {
    const ref: DraftOfferReference = { ...base, note: "Angebot gehört zu einem anderen Kunden – nicht übernommen", noteCode: "other_customer" };
    extractedData.offerReference = ref;
    return ref;
  }
  if (matchingResults && allLinesSure(matchingResults.items)) {
    const ref: DraftOfferReference = { ...base, note: "Alle Positionen schon sicher zugeordnet – nur Verweis vermerkt", noteCode: "already_matched" };
    extractedData.offerReference = ref;
    return ref;
  }

  const { lines: offerLines, skippedOptional } = offerToLines(offer);
  const resolved = offerLines.map((l) => ({
    line: l,
    product: (l.productId ? params.products.byId(l.productId) : undefined) ?? (l.productNumber ? params.products.byIdentifier(l.productNumber) : undefined),
  }));
  if (!resolved.length || resolved.some((r) => !r.product)) {
    const missing = resolved.filter((r) => !r.product).length;
    const ref: DraftOfferReference = resolved.length
      ? { ...base, note: `${missing} Angebotsposition(en) nicht im Katalog – nicht übernommen`, noteCode: "products_missing", noteCount: missing }
      : { ...base, note: "Angebot ohne übernehmbare Positionen", noteCode: "no_lines" };
    extractedData.offerReference = ref;
    return ref;
  }

  // Vereinbarter Preis: Angebotsposition direkt; Konfiguration anteilig nach Katalogpreis auf die Teile
  const agreed = distributeOfferPrices(resolved.map((r) => ({ line: r.line, catalogNet: catalogNetPrice(r.product!) })));
  const newLines: Line[] = resolved.map(({ line, product }, i) => ({
    extractedProductName: product!.name,
    extractedProductNumber: product!.productNumber,
    extractedPositionNumber: String(i + 1),
    quantity: line.quantity,
    ...(agreed[i] != null ? { extractedPrice: agreed[i]! } : {}),
  }));
  const newItems: LineItemMatch[] = resolved.map(({ line, product }, i) => ({
    extractedProductName: product!.name,
    extractedProductNumber: product!.productNumber,
    extractedPositionNumber: String(i + 1),
    quantity: line.quantity,
    matchedProduct: {
      id: product!.id,
      productNumber: product!.productNumber,
      name: product!.name,
      price: product!.price,
      confidence: 100,
      reasoning: `Aus Angebot ${offerNumber}${line.fromConfiguration ? " (Stückliste der Konfiguration)" : ""}`,
      // Angebotspreis gilt (wie ein im Prüffenster geänderter Preis; die Anlage übernimmt ihn)
      ...(agreed[i] != null ? { manualUnitPriceNet: agreed[i]!, manualPriceChangedBy: `Angebot ${offerNumber}` } : {}),
    },
    confidence: 100,
    status: "matched",
    matchStrategy: "offer",
  }));

  const ref: DraftOfferReference = {
    ...base,
    applied: true,
    note: skippedOptional ? `${skippedOptional} optionale Angebotsposition(en) nicht übernommen` : null,
    noteCode: skippedOptional ? "optional_skipped" : null,
    ...(skippedOptional ? { noteCount: skippedOptional } : {}),
    originalLineItems: lines.map((l) => ({ ...l })),
  };
  extractedData.offerReference = ref;
  extractedData.lineItems = newLines;
  // Plausibilität bezog sich auf die alten Zeilen
  extractedData.lineItemPlausibility = newLines.map((_, index) => ({ index, skipCatalogMatching: false, quantityWasZero: false }));
  if (matchingResults) {
    matchingResults.items = newItems;
    matchingResults.overallConfidence = 100;
  }
  log.info(
    { event: "draft_offer_reference_applied", offerNumber, offerId: offer.id, lines: newLines.length, totalsMatch: ref.totalsMatch },
    `[DraftOfferReference] ${newLines.length} Positionen aus Angebot ${offerNumber} übernommen`,
  );
  return ref;
}

/** Pipeline-Schritt (Bestellung und Angebot): sucht das Angebot über B2Bsellers im Mandanten. */
export async function runDraftOfferReferenceStep(params: {
  storage: IStorage;
  tenantId: string | null;
  extractedData: Record<string, unknown>;
  matchingResults: MatchingResult | null;
  shopwareCustomerId: string | null;
}): Promise<DraftOfferReference | null> {
  if (!detectOfferNumbers(params.extractedData).length) return null;
  try {
    const settings = await params.storage.getShopwareSettings(params.tenantId);
    if (!settings) return null;
    const { B2BSellersClient } = await import("../b2b/b2bSellersClient");
    const { matchOffersByNumber } = await import("../analytics/offerProfitability");
    const { productCache } = await import("../products/productCache");
    const statusMapping = await params.storage.getSetting("b2b.offerStatusMapping", params.tenantId);
    const client = new B2BSellersClient(settings, { statusMapping });
    const lookup: OfferLookup = async (offerNumber) => {
      const { offers } = await client.fetchOffers({ search: offerNumber, limit: 50 });
      const match = matchOffersByNumber(offers, offerNumber)[0];
      if (!match) return null;
      const raw = await client.fetchOfferById(match.id);
      const offer = client.mapOffer(raw.data, undefined, raw.included);
      const price = raw.data?.price ?? raw.data?.attributes?.price;
      return { ...offer, taxStatus: typeof price?.taxStatus === "string" ? price.taxStatus : offer.taxStatus };
    };
    return await applyOfferReference({
      extractedData: params.extractedData,
      matchingResults: params.matchingResults,
      shopwareCustomerId: params.shopwareCustomerId,
      lookup,
      products: {
        byId: (id) => productCache.getProductById(id),
        byIdentifier: (nr) => productCache.getProductByIdentifier(nr) ?? productCache.getProductByNumber(nr),
      },
    });
  } catch (err) {
    log.warn({ err }, "[DraftOfferReference] Schritt übersprungen");
    return null;
  }
}
