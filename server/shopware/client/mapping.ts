// Hilfsfunktionen und Konstanten der Shopware-Anbindung: Mapping, Normalisierung, Caches (aus server/shopware/shopware.ts ausgelagert).
import type { Order, ProductVariant } from "@shared/schema";
import { parseTrackingCodes, trackingLinkFor, type TrackingLink } from "@shared/tracking";
import type { OrderDocument, ParsedProductDeliveryTime, ShopwareAdvancedPrice, ShopwareChannelVisibility, ShopwareCustomerPrice, ShopwareProductOverview } from "./types";


/** Shopware 6 erwartet UUIDs als 32 Hex-Zeichen ohne Bindestriche (lowercase). */
export function toShopwareUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Memo für fetchProductHerstellpreisLookupKeys — Modul-Scope (pro Shopware-Instanz/baseUrl),
 *  damit er über alle pro Request neu erzeugten ShopwareClient-Instanzen hinweg geteilt wird.
 *  byId: toShopwareUuid(productId) → LookupKey ('' = kein Key, negativ gecacht).
 *  6h wie der productCache: Der Erst-Aufbau über alle Bestellungen kostet ~20s+ (sequenzielle
 *  Shopware-Chunks) — die Zuordnung productId→IFS-Nummer (Custom Field) ändert sich aber nur
 *  bei Produkt-Stammdatenpflege; die Herstellpreis-WERTE selbst kommen weiterhin bei jedem
 *  Request frisch aus der lokalen DB. */
export const HERSTELLPREIS_LOOKUP_TTL_MS = 6 * 60 * 60 * 1000;
export const herstellpreisLookupKeyCache = new Map<string, { fetchedAt: number; byId: Map<string, string> }>();
/** Laufender Memo-Fill je Shopware-Instanz (Single-Flight, s. fetchProductHerstellpreisLookupKeys). */
export const herstellpreisLookupInflight = new Map<string, Promise<void>>();

/** Admin-API: effektives Seitenlimit (Shopware `max_limit`, häufig 100–250). */
export const SHOPWARE_ADMIN_SEARCH_PAGE_SIZE = 250;

export function isBlankOverviewName(name: string | null | undefined): boolean {
  return !String(name ?? "").trim();
}

export function isEmptyOverviewList(value: unknown[] | null | undefined): boolean {
  return !Array.isArray(value) || value.length === 0;
}

export function isZeroOverviewPrice(gross: number | null | undefined, net: number | null | undefined): boolean {
  const g = Number(gross ?? 0);
  const n = Number(net ?? 0);
  return (!Number.isFinite(g) || g === 0) && (!Number.isFinite(n) || n === 0);
}

/**
 * Shopware vererbt bei Varianten ohne eigene Einstellung Werte vom Parent.
 * Für Listenansichten fehlende Child-Felder mit Parent-Werten auffüllen.
 */
export function applyOverviewParentInheritance(
  products: ShopwareProductOverview[],
): ShopwareProductOverview[] {
  const byId = new Map(products.map((p) => [p.id, p]));

  const resolveParent = (parentId: string | null | undefined, depth = 0): ShopwareProductOverview | null => {
    if (!parentId || depth > 4) return null;
    const parent = byId.get(parentId);
    if (!parent) return null;
    // Wenn Parent selbst Variante ist, weiter nach oben (selten)
    if (parent.parentId && isBlankOverviewName(parent.name)) {
      return resolveParent(parent.parentId, depth + 1) || parent;
    }
    return parent;
  };

  return products.map((child) => {
    if (!child.parentId) return child;
    const parent = resolveParent(child.parentId);
    if (!parent) return child;

    const inheritedFields: string[] = [];
    const next: ShopwareProductOverview = {
      ...child,
      salesChannelIds: Array.isArray(child.salesChannelIds) ? [...child.salesChannelIds] : [],
      salesChannelVisibilities: Array.isArray(child.salesChannelVisibilities)
        ? child.salesChannelVisibilities.map((v) => ({ ...v }))
        : [],
      categories: Array.isArray(child.categories) ? [...child.categories] : [],
      tags: Array.isArray(child.tags) ? [...child.tags] : [],
      advancedPrices: Array.isArray(child.advancedPrices) ? [...child.advancedPrices] : [],
    };

    if (isBlankOverviewName(next.name) && !isBlankOverviewName(parent.name)) {
      next.name = parent.name;
      inheritedFields.push("name");
    }

    if (isEmptyOverviewList(next.salesChannelIds) && !isEmptyOverviewList(parent.salesChannelIds)) {
      next.salesChannelIds = [...parent.salesChannelIds];
      next.salesChannelVisibilities = (parent.salesChannelVisibilities ?? []).map((v) => ({ ...v }));
      inheritedFields.push("salesChannels");
    }

    if (isEmptyOverviewList(next.categories) && !isEmptyOverviewList(parent.categories)) {
      next.categories = [...parent.categories];
      inheritedFields.push("categories");
    }

    if (isEmptyOverviewList(next.tags) && !isEmptyOverviewList(parent.tags)) {
      next.tags = [...parent.tags];
      inheritedFields.push("tags");
    }

    if (
      isEmptyOverviewList(next.advancedPrices) &&
      !isEmptyOverviewList(parent.advancedPrices)
    ) {
      next.advancedPrices = parent.advancedPrices.map((ap) => ({ ...ap }));
      inheritedFields.push("advancedPrices");
    }

    if (
      isZeroOverviewPrice(next.priceGross, next.priceNet) &&
      !isZeroOverviewPrice(parent.priceGross, parent.priceNet)
    ) {
      next.priceGross = parent.priceGross;
      next.priceNet = parent.priceNet;
      inheritedFields.push("price");
    }

    if (
      (next.purchasePriceNet == null || next.purchasePriceNet === 0) &&
      parent.purchasePriceNet != null &&
      parent.purchasePriceNet !== 0
    ) {
      next.purchasePriceNet = parent.purchasePriceNet;
      next.purchasePriceGross = parent.purchasePriceGross;
      inheritedFields.push("purchasePrice");
    }

    if (!next.hasDeliveryTime && parent.hasDeliveryTime) {
      next.deliveryTimeId = parent.deliveryTimeId;
      next.deliveryTimeName = parent.deliveryTimeName;
      next.deliveryTimeMin = parent.deliveryTimeMin;
      next.deliveryTimeMax = parent.deliveryTimeMax;
      next.deliveryTimeUnit = parent.deliveryTimeUnit;
      next.hasDeliveryTime = true;
      inheritedFields.push("deliveryTime");
    }

    if (next.restockTime == null && parent.restockTime != null) {
      next.restockTime = parent.restockTime;
      inheritedFields.push("restockTime");
    }

    if (!next.manufacturerName && parent.manufacturerName) {
      next.manufacturerName = parent.manufacturerName;
      inheritedFields.push("manufacturer");
    }
    if (!next.manufacturerNumber && parent.manufacturerNumber) {
      next.manufacturerNumber = parent.manufacturerNumber;
      if (!inheritedFields.includes("manufacturer")) inheritedFields.push("manufacturer");
    }

    const parentCf =
      parent.customFields && typeof parent.customFields === "object" ? parent.customFields : null;
    const childCf =
      next.customFields && typeof next.customFields === "object" ? next.customFields : null;
    if (parentCf && Object.keys(parentCf).length > 0) {
      const merged = { ...parentCf, ...(childCf || {}) };
      const childKeys = childCf ? Object.keys(childCf) : [];
      const inheritedCf = Object.keys(parentCf).some((k) => !childKeys.includes(k));
      if (inheritedCf || !childCf || Object.keys(childCf).length === 0) {
        next.customFields = merged;
        if (inheritedCf || !childCf || Object.keys(childCf).length === 0) {
          inheritedFields.push("customFields");
        }
      }
    }

    if (!inheritedFields.length) return child;
    return { ...next, inheritedFields };
  });
}

/** Maße aus Produktname parsen (z.B. "Steckrahmen 2000 x 600", "Boden 1000 x 600 vzk").
 *  Shopware speichert in mm. Liefert { width?, height?, length? } mit length = Tiefe. */
export function parseDimensionsFromProductName(
  name?: string | null
): { width?: number; height?: number; length?: number; unit?: string } | null {
  if (!name || typeof name !== "string") return null;
  // Pattern: "2000 x 600" oder "1000 x 600" (Zahl x Zahl)
  const m = name.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/i);
  if (!m) return null;
  const a = parseInt(m[1]!, 10);
  const b = parseInt(m[2]!, 10);
  if (isNaN(a) || isNaN(b)) return null;
  // Ständer/Steckrahmen: "2000 x 600" = Höhe x Tiefe
  const isStand = /steckrahmen|ständer|steher|rahmen/i.test(name);
  if (isStand) {
    return { height: a, length: b, unit: "mm" };
  }
  // Böden/Fachboden: "1000 x 600" = Breite x Tiefe
  return { width: a, length: b, unit: "mm" };
}

/**
 * Liest mögliche SAP-/ERP-Materialnummern aus Shopware customFields.
 * Der Key kann je nach Shop variieren, daher heuristischer Fallback über Schlüsselname.
 */
export function extractSapProductNumberFromCustomFields(customFields: Record<string, unknown> | undefined): string | undefined {
  if (!customFields || typeof customFields !== "object") return undefined;

  const directCandidates = [
    "sapProductNumber",
    "sap_product_number",
    "sap_material_number",
    "materialNumberSap",
    "material_number",
    "matnr",
    "meta_sap_product_number",
    "wdu_ifs_productnumber",
  ];
  for (const key of directCandidates) {
    const value = customFields[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const [key, value] of Object.entries(customFields)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (/(^|[_\-.])(sap|matnr|material|ifs)([_\-.]|$)/i.test(key)) {
      return value.trim();
    }
  }

  return undefined;
}

export function normalizeShopwareProductEntity(raw: any): any {
  if (!raw) return raw;
  const attrs = raw.attributes || {};
  return {
    id: raw.id,
    productNumber: raw.productNumber ?? attrs.productNumber,
    name: raw.name ?? attrs.name,
    price: raw.price ?? attrs.price,
    stock: raw.stock ?? attrs.stock,
    available: raw.available ?? attrs.available,
    tax: raw.tax,
    options: raw.options,
    relationships: raw.relationships,
  };
}

export function shopwareEntityName(entity: any): string {
  if (!entity || typeof entity !== "object") return "";
  const attrs = entity.attributes || {};
  return String(
    entity.translated?.name ||
      attrs.translated?.name ||
      entity.name ||
      attrs.name ||
      "",
  ).trim();
}

/** Shopware-UUID (32 Hex oder mit Bindestrichen). */
export function isShopwareEntityId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  return (
    /^[0-9a-f]{32}$/i.test(s) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)
  );
}

export function normalizeShopwareEntityId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

export function mapShopwareOptionsForVariant(
  cp: any,
  includedMap: Map<string, any>
): Array<{ group: string; option: string }> {
  const out: Array<{ group: string; option: string }> = [];
  if (cp.options && Array.isArray(cp.options)) {
    for (const opt of cp.options) {
      const groupName = shopwareEntityName(opt.group) || String(opt.groupName || "").trim();
      const optionName = shopwareEntityName(opt) || String(opt.optionName || "").trim();
      if (groupName && optionName) out.push({ group: groupName, option: optionName });
    }
  } else if (cp.relationships?.options?.data) {
    for (const optRef of cp.relationships.options.data) {
      const prop = includedMap.get(`property_group_option-${optRef.id}`);
      if (!prop) continue;
      const optionName = shopwareEntityName(prop);
      let groupName = "";
      if (prop.group) groupName = shopwareEntityName(prop.group);
      else if (prop.relationships?.group?.data?.id) {
        const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
        groupName = shopwareEntityName(group);
      }
      if (groupName && optionName) out.push({ group: groupName, option: optionName });
    }
  }
  return out;
}

export function mapShopwarePropertiesForLabel(
  sp: any,
  includedMap: Map<string, any>,
): Array<{ groupName: string; optionName: string }> {
  const out: Array<{ groupName: string; optionName: string }> = [];
  if (Array.isArray(sp.properties)) {
    for (const prop of sp.properties) {
      const groupName = shopwareEntityName(prop.group) || String(prop.groupName || "").trim();
      const optionName = shopwareEntityName(prop) || String(prop.optionName || "").trim();
      if (groupName && optionName) out.push({ groupName, optionName });
    }
    return out;
  }
  if (!Array.isArray(sp.relationships?.properties?.data)) return out;
  for (const propRef of sp.relationships.properties.data) {
    const prop = includedMap.get(`property_group_option-${propRef.id}`);
    if (!prop) continue;
    const optionName = shopwareEntityName(prop);
    let groupName = "";
    if (prop.group) groupName = shopwareEntityName(prop.group);
    else if (prop.relationships?.group?.data?.id) {
      const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
      groupName = shopwareEntityName(group);
    }
    if (groupName && optionName) out.push({ groupName, optionName });
  }
  return out;
}

export function extractGrossNetFromShopwarePrice(cp: any, taxRate: number): { price: number; netPrice: number } {
  let price = 0;
  let netPrice = 0;
  if (cp.price && Array.isArray(cp.price)) {
    const eurPrice = cp.price.find((p: any) => p.currencyId || true);
    if (eurPrice) {
      price = eurPrice.gross || 0;
      netPrice = eurPrice.net || 0;
      if (!netPrice && price) netPrice = price / (1 + taxRate / 100);
    }
  } else if (cp.attributes?.price && Array.isArray(cp.attributes.price)) {
    const eurPrice = cp.attributes.price.find((p: any) => p.currencyId || true);
    if (eurPrice) {
      price = eurPrice.gross || 0;
      netPrice = eurPrice.net || 0;
      if (!netPrice && price) netPrice = price / (1 + taxRate / 100);
    }
  }
  return { price, netPrice };
}

export function resolveShopwareChildProducts(sp: any, includedMap: Map<string, any>): any[] {
  if (sp.children && Array.isArray(sp.children) && sp.children.length > 0) {
    return sp.children;
  }
  const refs = sp.relationships?.children?.data;
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const list: any[] = [];
  for (const ref of refs) {
    const id = ref?.id;
    if (!id) continue;
    const ent =
      includedMap.get(`product-${id}`) ||
      includedMap.get(`product-${String(id).replace(/-/g, "")}`);
    if (ent) list.push(ent);
  }
  return list;
}

export function mapChildToProductVariant(
  raw: any,
  includedMap: Map<string, any>,
  fallbackTaxRate: number
): ProductVariant {
  const cp = normalizeShopwareProductEntity(raw);
  let childTax = fallbackTaxRate;
  if (raw.tax?.taxRate != null) childTax = raw.tax.taxRate;
  else if (raw.relationships?.tax?.data?.id) {
    const taxEnt = includedMap.get(`tax-${raw.relationships.tax.data.id}`);
    childTax = taxEnt?.attributes?.taxRate ?? fallbackTaxRate;
  }
  const { price, netPrice } = extractGrossNetFromShopwarePrice(
    raw.attributes ? { ...cp, price: raw.attributes.price ?? cp.price } : cp,
    childTax
  );
  const num = cp.productNumber != null && String(cp.productNumber).trim() !== "" ? String(cp.productNumber) : undefined;
  return {
    id: String(cp.id),
    name: String(cp.name || ""),
    productNumber: num,
    options: mapShopwareOptionsForVariant(raw, includedMap),
    price,
    netPrice,
    stock: Number(cp.stock ?? 0),
    available: Boolean(cp.available),
  };
}

/** Liefert das createdAt einer Delivery (direkt oder aus attributes). */
export function getDeliveryCreatedAt(d: any): string {
  return d?.createdAt ?? d?.attributes?.createdAt ?? "";
}

/** Ermittelt die letzte (neueste) Lieferung aus einer Liste – in Shopware kann die Reihenfolge variieren. */
export function getLatestDelivery(deliveries: any[]): any {
  if (!deliveries?.length) return undefined;
  if (deliveries.length === 1) return deliveries[0];
  const sorted = [...deliveries].sort((a, b) => {
    const at = getDeliveryCreatedAt(a);
    const bt = getDeliveryCreatedAt(b);
    return bt.localeCompare(at); // DESC: neueste zuerst
  });
  return sorted[0];
}

/** Lieferstatus, bei denen die Ware das Lager verlassen hat (auch wenn sie danach zurueckkam). */
export const SHIPPED_DELIVERY_STATES = new Set(["shipped", "shipped_partially", "returned", "returned_partially"]);

/** Versandrelevante Angaben einer Shopware-Lieferung. */
export type DeliveryShippingFacts = {
  id: string;
  createdAt: string;
  trackingCodes: string[];
  /** technicalName des Lieferstatus */
  state?: string;
  /** Name der Versandart (z. B. "DPD") */
  shippingMethodName?: string;
  /** Tracking-URL der Versandart mit Platzhalter %s */
  trackingUrl?: string;
};

/** Versandangaben einer Lieferung - aus der normalen Antwort oder dem JSON:API-Format. */
export function deliveryShippingFacts(delivery: any, includedMap?: Map<string, any>): DeliveryShippingFacts {
  const attrs = delivery?.attributes ?? delivery ?? {};
  const stateRef = delivery?.relationships?.stateMachineState?.data?.id;
  const state =
    delivery?.stateMachineState?.technicalName ??
    (stateRef ? includedMap?.get(`state_machine_state-${stateRef}`)?.attributes?.technicalName : undefined);
  const codes: unknown[] = Array.isArray(attrs.trackingCodes) ? attrs.trackingCodes : [];
  const methodRef = delivery?.relationships?.shippingMethod?.data?.id;
  const method = delivery?.shippingMethod ?? (methodRef ? includedMap?.get(`shipping_method-${methodRef}`)?.attributes : undefined);
  const shippingMethodName = method?.translated?.name || method?.name;
  const trackingUrl = method?.translated?.trackingUrl || method?.trackingUrl;
  return {
    id: String(delivery?.id ?? ""),
    createdAt: getDeliveryCreatedAt(delivery),
    trackingCodes: codes.map((c) => String(c ?? "").trim()).filter(Boolean),
    state: state || undefined,
    ...(shippingMethodName ? { shippingMethodName: String(shippingMethodName) } : {}),
    ...(trackingUrl ? { trackingUrl: String(trackingUrl) } : {}),
  };
}

/** Lieferungen, deren Versanddatum aus der Status-Historie kommen muss (versendet, kein eigenes Datum). */
export function deliveryIdsNeedingShippedDate(
  deliveries: DeliveryShippingFacts[],
  customFields: Record<string, any> | null | undefined,
): string[] {
  if (customFields?.meta_shipped_date) return [];
  return deliveries.filter((d) => d.id && d.state && SHIPPED_DELIVERY_STATES.has(d.state)).map((d) => d.id);
}

/**
 * Versandangaben einer Bestellung (Order.shippingInfo):
 * - Sendungsnummern: Tracking-Codes aller Lieferungen (aelteste Lieferung zuerst, ohne Doppelte),
 *   sonst das Zusatzfeld meta_shipped_tracking (schreibt METAorder beim Versand); als Liste und als
 *   Text "A, B". Links zur Sendungsverfolgung ueber die Tracking-URL der Versandart der Lieferung.
 * - Versanddienstleister: Zusatzfeld meta_shipped_carrier - Shopware kennt keinen eigenen; sonst
 *   die Versandart der (neuesten) Lieferung, aber nur, wenn es ueberhaupt Versandangaben gibt.
 * - Versanddatum: Zusatzfeld meta_shipped_date (beim Versand in METAorder eingegeben), sonst der
 *   letzte Uebergang nach "versendet" laut Status-Historie, sofern die Lieferung noch als versendet
 *   (oder zurueckgesendet) gilt - nicht, wenn sie danach wieder geoeffnet oder storniert wurde.
 */
export function deriveShippingInfo(
  deliveries: DeliveryShippingFacts[],
  customFields: Record<string, any> | null | undefined,
  shippedAtByDeliveryId?: Map<string, string>,
): NonNullable<Order["shippingInfo"]> | undefined {
  const cf = customFields ?? {};
  const oldestFirst = [...deliveries].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const codes: string[] = [];
  const links: TrackingLink[] = [];
  for (const d of oldestFirst) {
    for (const code of d.trackingCodes) {
      if (codes.includes(code)) continue;
      codes.push(code);
      const url = trackingLinkFor(d.trackingUrl, code);
      if (url) links.push({ code, url });
    }
  }
  let shippedDate: string | undefined = cf.meta_shipped_date ? String(cf.meta_shipped_date) : undefined;
  if (!shippedDate && shippedAtByDeliveryId) {
    for (const id of deliveryIdsNeedingShippedDate(deliveries, cf)) {
      const at = shippedAtByDeliveryId.get(id);
      if (at && (!shippedDate || at > shippedDate)) shippedDate = at;
    }
  }
  const info: NonNullable<Order["shippingInfo"]> = {};
  if (cf.meta_shipped_carrier) info.carrier = String(cf.meta_shipped_carrier);
  const trackingCodes = codes.length > 0 ? codes : parseTrackingCodes(cf.meta_shipped_tracking ? String(cf.meta_shipped_tracking) : "");
  if (trackingCodes.length > 0) {
    info.trackingNumber = trackingCodes.join(", ");
    info.trackingCodes = trackingCodes;
  }
  if (links.length > 0) info.trackingLinks = links;
  if (shippedDate) info.shippedDate = shippedDate;
  if (Object.keys(info).length === 0) return undefined;
  if (!info.carrier) {
    const method = oldestFirst.reverse().find((d) => d.shippingMethodName)?.shippingMethodName;
    if (method) info.carrier = method;
  }
  return info;
}

export function extractShopwareOrderCustomerNumber(order: any, includedMap: Map<string, any>): string | undefined {
  const oc = order?.orderCustomer;
  const fromNested = oc?.customerNumber ?? oc?.attributes?.customerNumber;
  if (fromNested != null && String(fromNested).trim()) return String(fromNested).trim();
  const rid = order?.relationships?.orderCustomer?.data?.id;
  if (rid) {
    const ent = includedMap.get(`order_customer-${rid}`);
    const n = ent?.attributes?.customerNumber ?? ent?.attributes?.customerNo;
    if (n != null && String(n).trim()) return String(n).trim();
  }
  return undefined;
}

/**
 * True if the document number is a proforma or advance payment (Vorkasse) invoice.
 * Used to distinguish from the "real" final invoice (e.g. for conflict checks and display).
 */
export function isProformaOrVorkasse(documentNumber: string): boolean {
  const n = (documentNumber ?? "").trim().toUpperCase();
  return n.startsWith("VKRE") || n.startsWith("PF");
}

/**
 * From a list of order documents, return the "real" (final) invoice when present,
 * otherwise the first invoice-like document (e.g. for mark as shipped / Mondu / dunning).
 */
export function getRealInvoiceDocument(documents: OrderDocument[]): OrderDocument | undefined {
  const invoiceLike = documents.filter(
    d => d.type === 'invoice' || d.type === 'proforma_invoice' || d.type === 'vorkasse_invoice'
  );
  const real = invoiceLike.find(d => !isProformaOrVorkasse(d.number));
  return real ?? invoiceLike[0];
}

/** Fehlermeldungen des Mondu-Shopware-Plugins beim Lieferstatus-Uebergang. */
export function isMonduPluginShipError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    message.includes("MONDU__ERROR") ||
    lower.includes("corrupt order") ||
    message.includes("MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH")
  );
}

export function readEntityTechnicalName(entity: any): string {
  if (!entity) return "unknown";
  const t =
    entity.technicalName ??
    entity.attributes?.technicalName;
  return typeof t === "string" && t.length > 0 ? t : "unknown";
}

/**
 * Shopware document_type.technical_name (und übliche Varianten/Plugins) → METAorder-Typ für UI/Logik.
 * Stornorechnungen heißen je nach Version z. B. storno, cancellation_invoice, nicht immer cancellation.
 */
/** Shopware 6.7+: Rechnung als PDF mit eingebettetem ZUGFeRD-XML (E-Rechnung). */
export const ZUGFERD_EMBEDDED_INVOICE_TYPE = "zugferd_embedded_invoice";

export function normalizeOrderDocumentType(technicalName: string): string {
  const raw = (technicalName || "").trim().toLowerCase();
  if (!raw || raw === "unknown") return "unknown";

  // E-Rechnung (PDF + eingebettetes XML) ist fachlich eine normale Rechnung.
  if (raw === ZUGFERD_EMBEDDED_INVOICE_TYPE) return "invoice";

  if (raw === "credit_note") return "credit_note";

  if (
    raw === "cancellation" ||
    raw === "cancellation_invoice" ||
    raw === "storno" ||
    raw === "storno_invoice" ||
    raw === "invoice_cancellation" ||
    raw.endsWith("_storno") ||
    raw.includes("storno")
  ) {
    return "cancellation";
  }

  return raw;
}

/**
 * Shopware-"Live"-Version. Alle Entitäten, die im Shop tatsächlich aktiv sind,
 * tragen diese versionId. Versionierte Kopien (z. B. Entwürfe, Bestell-Snapshots)
 * haben abweichende versionIds und dürfen in der Produkt-Übersicht nicht als
 * eigenständige (Staffel-)Preise erscheinen.
 */
export const SHOPWARE_LIVE_VERSION_ID = "0fa91ce3e96a4bc2be4bd9ce752c3425";

export function normalizeOverviewQuantityEnd(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export function overviewAdvancedPriceTierKey(quantityStart: number, quantityEnd: number | null): string {
  const end = quantityEnd == null ? "" : String(quantityEnd);
  return `${quantityStart}|${end}`;
}

export function normalizeCustomerPriceCurrencyIso(iso: string | null | undefined): string {
  return (iso || "EUR").toUpperCase();
}

/** Eindeutiger Schlüssel für logisch identische Kundenpreise (ohne Shopware-Zeilen-ID). */
export function customerSpecificPriceSignature(price: ShopwareCustomerPrice): string {
  const product = String(price.productNumber ?? price.productId ?? price.id).trim();
  const from = price.from ?? "";
  const to = price.to ?? "";
  const net = price.priceNet ?? "";
  const currency = normalizeCustomerPriceCurrencyIso(price.currencyIsoCode);
  const validFrom = price.validFrom ?? "";
  const validUntil = price.validUntil ?? "";
  return `${product}|${from}|${to}|${net}|${currency}|${validFrom}|${validUntil}`;
}

export function pickPreferredCustomerPrice(
  existing: ShopwareCustomerPrice,
  candidate: ShopwareCustomerPrice,
): ShopwareCustomerPrice {
  if (candidate.productName && !existing.productName) return candidate;
  if (existing.productName && !candidate.productName) return existing;
  if (candidate.currencyIsoCode && !existing.currencyIsoCode) return candidate;
  if (existing.currencyIsoCode && !candidate.currencyIsoCode) return existing;
  return existing;
}

export function dedupeCustomerSpecificPrices(prices: ShopwareCustomerPrice[]): ShopwareCustomerPrice[] {
  const bySignature = new Map<string, ShopwareCustomerPrice>();
  for (const price of prices) {
    const key = customerSpecificPriceSignature(price);
    const existing = bySignature.get(key);
    bySignature.set(key, existing ? pickPreferredCustomerPrice(existing, price) : price);
  }
  return Array.from(bySignature.values());
}

/** Sammelt product_price-Einträge einmalig (Relationships + included, dedupliziert nach ID). */
export function collectOverviewProductPriceEntries(
  sp: any,
  includedMap: Map<string, any>,
): any[] {
  const byId = new Map<string, any>();

  const add = (raw: any) => {
    if (!raw) return;
    const id = raw.id ?? raw.attributes?.id;
    let resolved = raw;
    if (id && includedMap.has(`product_price-${id}`)) {
      resolved = includedMap.get(`product_price-${id}`);
    } else if (!raw.attributes && !raw.quantityStart && id) {
      resolved = includedMap.get(`product_price-${id}`) ?? raw;
    }
    const resolvedId = resolved?.id ?? resolved?.attributes?.id ?? id;
    if (resolvedId) {
      if (byId.has(resolvedId)) return;
      byId.set(resolvedId, resolved);
      return;
    }
    byId.set(`${byId.size}-${overviewAdvancedPriceTierKey(
      Number(resolved?.attributes?.quantityStart ?? resolved?.quantityStart ?? 1),
      normalizeOverviewQuantityEnd(resolved?.attributes?.quantityEnd ?? resolved?.quantityEnd),
    )}`, resolved);
  };

  if (Array.isArray(sp.relationships?.prices?.data)) {
    for (const ref of sp.relationships.prices.data) {
      add(includedMap.get(`product_price-${ref.id}`) ?? ref);
    }
  } else if (Array.isArray(sp.prices)) {
    for (const pr of sp.prices) add(pr);
  }

  return Array.from(byId.values());
}

export function pickPreferredOverviewPriceEntry(
  existing: { price: ShopwareAdvancedPrice; isLive: boolean; updatedAt: number },
  candidate: { price: ShopwareAdvancedPrice; isLive: boolean; updatedAt: number },
): boolean {
  if (candidate.isLive && !existing.isLive) return true;
  if (!candidate.isLive && existing.isLive) return false;
  if (candidate.updatedAt !== existing.updatedAt) return candidate.updatedAt > existing.updatedAt;
  // Bei gleicher Staffel/Preis: bevorzugt Eintrag mit aufgelöster Regel.
  const existingHasRule = !!existing.price.ruleName || !!existing.price.ruleId;
  const candidateHasRule = !!candidate.price.ruleName || !!candidate.price.ruleId;
  if (candidateHasRule && !existingHasRule) return true;
  return false;
}

/** Erweiterte Preise (Staffelpreise) aus einem Produkt-Suchtreffer parsen. */
export function parseProductAdvancedPrices(sp: any, includedMap: Map<string, any>): ShopwareAdvancedPrice[] {
  const priceRuleEntries = collectOverviewProductPriceEntries(sp, includedMap);
  const advancedPriceByTier = new Map<
    string,
    { price: ShopwareAdvancedPrice; isLive: boolean; updatedAt: number }
  >();

  for (const pr of priceRuleEntries) {
    const a = pr?.attributes || pr;
    const priceEntries = Array.isArray(a?.price) ? a.price : a?.price ? [a.price] : [];
    const priceObj = priceEntries[0];
    const quantityStart = Number(a?.quantityStart ?? 1);
    const quantityEnd = normalizeOverviewQuantityEnd(a?.quantityEnd);
    const ruleId = a?.ruleId ?? null;
    const versionId = a?.versionId ?? pr?.versionId ?? null;
    const isLive = versionId == null || versionId === SHOPWARE_LIVE_VERSION_ID;
    const updatedAt = Date.parse(a?.updatedAt ?? a?.createdAt ?? "") || 0;

    if (!isLive) continue;

    let ruleName: string | null =
      shopwareEntityName(a?.rule) ||
      shopwareEntityName(pr?.rule) ||
      a?.rule?.attributes?.name ||
      null;
    if (!ruleName && ruleId) {
      ruleName = shopwareEntityName(includedMap.get(`rule-${ruleId}`)) || null;
    }

    // Gruppierung pro Preisregel UND Mengenstaffel: Ohne ruleId würden mehrere
    // Regeln (z. B. verschiedene Kundengruppen) mit gleicher Staffel zu einer
    // Zeile kollabieren und Preise "verschwinden".
    const tierKey = `${ruleId ?? "__default__"}|${overviewAdvancedPriceTierKey(quantityStart, quantityEnd)}`;
    const candidate = {
      price: {
        quantityStart,
        quantityEnd,
        gross: priceObj?.gross ?? null,
        net: priceObj?.net ?? null,
        ruleId,
        ruleName,
      } satisfies ShopwareAdvancedPrice,
      isLive,
      updatedAt,
    };

    const existing = advancedPriceByTier.get(tierKey);
    if (!existing || pickPreferredOverviewPriceEntry(existing, candidate)) {
      advancedPriceByTier.set(tierKey, candidate);
    }
  }

  const advancedPrices: ShopwareAdvancedPrice[] = Array.from(advancedPriceByTier.values())
    .map((entry) => entry.price)
    .sort((x, y) => {
      // Zuerst nach Regel (Name, dann Id) gruppieren, dann nach Mengenstaffel.
      const ruleCompare = (x.ruleName ?? "").localeCompare(y.ruleName ?? "");
      if (ruleCompare !== 0) return ruleCompare;
      const ruleIdCompare = (x.ruleId ?? "").localeCompare(y.ruleId ?? "");
      if (ruleIdCompare !== 0) return ruleIdCompare;
      return x.quantityStart - y.quantityStart;
    });

  const seenPriceSignature = new Set<string>();
  return advancedPrices.filter((p) => {
    const signature = `${p.ruleId ?? ""}|${p.quantityStart}|${p.quantityEnd ?? ""}|${p.net ?? ""}|${p.gross ?? ""}`;
    if (seenPriceSignature.has(signature)) return false;
    seenPriceSignature.add(signature);
    return true;
  });
}

/** Shopware apiAlias ist `delivery_time` (nicht product_delivery_time). */
export function getIncludedDeliveryTime(
  includedMap: Map<string, any>,
  id: string | null | undefined,
): any | undefined {
  if (!id) return undefined;
  return (
    includedMap.get(`delivery_time-${id}`) ||
    includedMap.get(`product_delivery_time-${id}`)
  );
}

/** Lieferzeit aus Produkt-Suchtreffer parsen (product.deliveryTime / deliveryTimeId). */
export function parseProductDeliveryTime(sp: any, includedMap: Map<string, any>): ParsedProductDeliveryTime {
  const attributes = sp.attributes || sp;
  const relId = sp.relationships?.deliveryTime?.data?.id ?? null;
  let dt = sp.deliveryTime || attributes?.deliveryTime || null;
  if (!dt && relId) {
    dt = getIncludedDeliveryTime(includedMap, relId);
  }

  const deliveryTimeIdRaw =
    sp.deliveryTimeId ??
    attributes?.deliveryTimeId ??
    relId ??
    dt?.id ??
    dt?.attributes?.id ??
    null;
  const deliveryTimeId = deliveryTimeIdRaw == null || deliveryTimeIdRaw === "" ? null : String(deliveryTimeIdRaw);

  if (!dt && deliveryTimeId) {
    dt = getIncludedDeliveryTime(includedMap, deliveryTimeId);
  }

  if (!dt && !deliveryTimeId) {
    return {
      deliveryTimeId: null,
      deliveryTimeName: null,
      deliveryTimeMin: null,
      deliveryTimeMax: null,
      deliveryTimeUnit: null,
      hasDeliveryTime: false,
    };
  }

  const dtAttrs = dt?.attributes || dt || {};
  const deliveryTimeName =
    shopwareEntityName(dt) ||
    dtAttrs.translated?.name ||
    dtAttrs.name ||
    dt?.name ||
    dt?.translated?.name ||
    null;
  const minRaw = dtAttrs.min ?? dt?.min;
  const maxRaw = dtAttrs.max ?? dt?.max;
  const deliveryTimeMin = minRaw != null && !Number.isNaN(Number(minRaw)) ? Number(minRaw) : null;
  const deliveryTimeMax = maxRaw != null && !Number.isNaN(Number(maxRaw)) ? Number(maxRaw) : null;
  const deliveryTimeUnit =
    dtAttrs.unit ?? dt?.unit ?? (deliveryTimeMin != null || deliveryTimeMax != null ? "day" : null);

  const hasDeliveryTime = Boolean(deliveryTimeId || deliveryTimeName || deliveryTimeMin != null || deliveryTimeMax != null);

  return {
    deliveryTimeId,
    deliveryTimeName: deliveryTimeName ? String(deliveryTimeName) : null,
    deliveryTimeMin,
    deliveryTimeMax,
    deliveryTimeUnit: deliveryTimeUnit ? String(deliveryTimeUnit) : null,
    hasDeliveryTime,
  };
}


/**
 * Verkaufskanal-Sichtbarkeiten aus einer Shopware-Produktantwort lesen.
 * Unterstuetzt sowohl die flache (`visibilities`) als auch die JSON:API-Form
 * (`relationships.visibilities` + `included`).
 */
export function parseProductVisibilities(
  sp: any,
  includedMap: Map<string, any>,
): { salesChannelIds: string[]; salesChannelVisibilities: ShopwareChannelVisibility[] } {
  const visEntries: any[] = Array.isArray(sp?.visibilities)
    ? sp.visibilities
    : Array.isArray(sp?.relationships?.visibilities?.data)
      ? sp.relationships.visibilities.data
          .map((ref: any) => includedMap.get(`product_visibility-${ref.id}`))
          .filter(Boolean)
      : [];

  // null = Kanal zugeordnet, Stufe aber unbekannt (z. B. Query ohne visibility-Feld)
  const byChannel = new Map<string, number | null>();
  for (const entry of visEntries) {
    const scId = entry?.salesChannelId ?? entry?.attributes?.salesChannelId;
    if (!scId) continue;
    const rawVisibility = Number(entry?.visibility ?? entry?.attributes?.visibility);
    const visibility = Number.isFinite(rawVisibility) ? rawVisibility : null;
    const previous = byChannel.get(String(scId));
    // Mehrfacheintraege je Kanal sollte es nicht geben; falls doch, gewinnt der sichtbarste Wert.
    byChannel.set(
      String(scId),
      previous == null || visibility == null ? (visibility ?? previous ?? null) : Math.max(previous, visibility),
    );
  }

  const salesChannelVisibilities: ShopwareChannelVisibility[] = [];
  for (const [salesChannelId, visibility] of byChannel.entries()) {
    if (visibility == null) continue;
    salesChannelVisibilities.push({ salesChannelId, visibility });
  }

  return { salesChannelIds: Array.from(byChannel.keys()), salesChannelVisibilities };
}

/** Wiederauffüllzeit in Tagen (Shopware-Feld restockTime). */
export function parseProductRestockTime(sp: any): number | null {
  const attributes = sp.attributes || sp;
  const raw = sp.restockTime ?? attributes?.restockTime;
  if (raw == null || raw === "") return null;
  const value = Number(raw);
  return Number.isNaN(value) ? null : value;
}
