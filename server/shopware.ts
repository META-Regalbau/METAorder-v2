import type {
  Order,
  OrderAddress,
  OrderStatus,
  PaymentStatus,
  OrderItem,
  ShopwareSettings,
  SalesChannel,
  Product,
  ProductPriceRule,
  ProductVariant,
  CrossSellingGroup,
  CrossSellingProduct,
} from "@shared/schema";
import { randomUUID } from "crypto";
import { productCache } from "./productCache";

/** Shopware 6 erwartet UUIDs als 32 Hex-Zeichen ohne Bindestriche (lowercase). */
function toShopwareUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/** Admin-API: effektives Seitenlimit (Shopware `max_limit`, häufig 100–250). */
export const SHOPWARE_ADMIN_SEARCH_PAGE_SIZE = 250;

/** Ein Eintrag im Shopware-Produkt-`price`-Array (inkl. optional regulationPrice). */
export type ShopwarePriceEntry = Record<string, unknown>;

/** Eine Staffel/erweiterter Preis aus `product.prices`. */
export interface ShopwareAdvancedPrice {
  quantityStart: number;
  quantityEnd: number | null;
  gross: number | null;
  net: number | null;
  ruleId: string | null;
}

/** Angereicherte Produktzeile für die Produkt-Übersicht. */
export interface ShopwareProductOverview {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  stock: number | null;
  ean?: string;
  manufacturerNumber?: string;
  manufacturerName?: string;
  priceGross: number;
  priceNet: number;
  /** Netto-Einkaufspreis (purchasePrices). null = kein EK hinterlegt. */
  purchasePriceNet: number | null;
  purchasePriceGross: number | null;
  taxRate: number;
  currency: "EUR";
  /** Zugeordnete Verkaufskanal-IDs (aus visibilities). Namensauflösung im Aufrufer. */
  salesChannelIds: string[];
  advancedPrices: ShopwareAdvancedPrice[];
  categories: string[];
  customFields?: Record<string, unknown>;
  propertyCount: number;
  parentId: string | null;
  childCount: number | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface ProductPriceResetRow {
  id: string;
  price: ShopwarePriceEntry[];
}

/**
 * Kundenindividueller Preis aus dem "B2Bsellers Suite"-Plugin.
 * Entität: `b2bsellers_customer_price` (ältere Versionen: `b2b_customer_price`).
 */
export interface ShopwareCustomerPrice {
  id: string;
  productId: string | null;
  productNumber: string | null;
  productName: string | null;
  customerId: string | null;
  customerNumber: string | null;
  /** Mengenstaffel von (Stückzahl). */
  from: number | null;
  /** Mengenstaffel bis (Stückzahl). null = unbegrenzt. */
  to: number | null;
  priceNet: number | null;
  pseudoPriceNet: number | null;
  currencyIsoCode: string | null;
  validFrom: string | null;
  validUntil: string | null;
}

/** Maße aus Produktname parsen (z.B. "Steckrahmen 2000 x 600", "Boden 1000 x 600 vzk").
 *  Shopware speichert in mm. Liefert { width?, height?, length? } mit length = Tiefe. */
function parseDimensionsFromProductName(
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
function extractSapProductNumberFromCustomFields(customFields: Record<string, unknown> | undefined): string | undefined {
  if (!customFields || typeof customFields !== "object") return undefined;

  const directCandidates = [
    "sapProductNumber",
    "sap_product_number",
    "sap_material_number",
    "materialNumberSap",
    "material_number",
    "matnr",
    "meta_sap_product_number",
  ];
  for (const key of directCandidates) {
    const value = customFields[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  for (const [key, value] of Object.entries(customFields)) {
    if (typeof value !== "string" || !value.trim()) continue;
    if (/(^|[_\-.])(sap|matnr|material)([_\-.]|$)/i.test(key)) {
      return value.trim();
    }
  }

  return undefined;
}

function normalizeShopwareProductEntity(raw: any): any {
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

function mapShopwareOptionsForVariant(
  cp: any,
  includedMap: Map<string, any>
): Array<{ group: string; option: string }> {
  const out: Array<{ group: string; option: string }> = [];
  if (cp.options && Array.isArray(cp.options)) {
    for (const opt of cp.options) {
      const groupName = opt.group?.name || opt.groupName || "";
      const optionName = opt.name || opt.optionName || "";
      if (groupName && optionName) out.push({ group: groupName, option: optionName });
    }
  } else if (cp.relationships?.options?.data) {
    for (const optRef of cp.relationships.options.data) {
      const prop = includedMap.get(`property_group_option-${optRef.id}`);
      if (!prop) continue;
      const optionName = prop.attributes?.name || prop.name || "";
      let groupName = "";
      if (prop.group?.name) groupName = prop.group.name;
      else if (prop.relationships?.group?.data?.id) {
        const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
        groupName = group?.attributes?.name || group?.name || "";
      }
      if (groupName && optionName) out.push({ group: groupName, option: optionName });
    }
  }
  return out;
}

function extractGrossNetFromShopwarePrice(cp: any, taxRate: number): { price: number; netPrice: number } {
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

function resolveShopwareChildProducts(sp: any, includedMap: Map<string, any>): any[] {
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

function mapChildToProductVariant(
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
function getDeliveryCreatedAt(d: any): string {
  return d?.createdAt ?? d?.attributes?.createdAt ?? "";
}

/** Ermittelt die letzte (neueste) Lieferung aus einer Liste – in Shopware kann die Reihenfolge variieren. */
function getLatestDelivery(deliveries: any[]): any {
  if (!deliveries?.length) return undefined;
  if (deliveries.length === 1) return deliveries[0];
  const sorted = [...deliveries].sort((a, b) => {
    const at = getDeliveryCreatedAt(a);
    const bt = getDeliveryCreatedAt(b);
    return bt.localeCompare(at); // DESC: neueste zuerst
  });
  return sorted[0];
}

function extractShopwareOrderCustomerNumber(order: any, includedMap: Map<string, any>): string | undefined {
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

export type OrderDocument = {
  id: string;
  type: string;
  number: string;
  deepLinkCode: string;
  createdAt?: string;
  /** Shopware document.sent: true wenn das Dokument bereits per Mail verschickt wurde */
  sent?: boolean;
  /** Brutto-Bestellsumme zum Zeitpunkt des Dokuments (über orderVersionId), sofern ermittelbar */
  amountGross?: number | null;
};

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

function readEntityTechnicalName(entity: any): string {
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
function normalizeOrderDocumentType(technicalName: string): string {
  const raw = (technicalName || "").trim().toLowerCase();
  if (!raw || raw === "unknown") return "unknown";

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

export class ShopwareClient {
  private baseUrl: string;
  private publicBaseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(settings: ShopwareSettings) {
    const trimmedUrl = settings.shopwareUrl.replace(/\/$/, '');
    const isLocalUrl = (url: string) => {
      try {
        const host = new URL(url).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "host.docker.internal";
      } catch {
        return false;
      }
    };

    this.baseUrl = trimmedUrl;
    this.publicBaseUrl = trimmedUrl;

    if (process.env.SHOPWARE_INTERNAL_URL && isLocalUrl(trimmedUrl)) {
      this.baseUrl = process.env.SHOPWARE_INTERNAL_URL.replace(/\/$/, '');
    }
    if (process.env.SHOPWARE_PUBLIC_URL && isLocalUrl(trimmedUrl)) {
      this.publicBaseUrl = process.env.SHOPWARE_PUBLIC_URL.replace(/\/$/, '');
    }
    this.apiKey = settings.apiKey;
    this.apiSecret = settings.apiSecret;
  }

  private resolveMediaUrl(url?: string | null): string {
    if (!url) return '';
    if (url.startsWith('http://') || url.startsWith('https://')) {
      if (this.publicBaseUrl && this.baseUrl && url.startsWith(this.baseUrl)) {
        return `${this.publicBaseUrl}${url.slice(this.baseUrl.length)}`;
      }
      return url;
    }
    if (url.startsWith('//')) {
      return `https:${url}`;
    }
    if (url.startsWith('/')) {
      return `${this.publicBaseUrl}${url}`;
    }
    return url;
  }

  private async authenticate(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.apiSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Authentication failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      // Set expiry time (default to 10 minutes if not provided, with 1 minute buffer)
      const expiresIn = data.expires_in || 600;
      this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
      return this.accessToken as string;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      console.error('Shopware authentication error:', error);
      throw new Error('Failed to authenticate with Shopware API');
    }
  }

  private async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    let token = await this.authenticate();

    // Ensure JSON headers are preserved
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // If we get a 401, token might have expired - try once more with fresh token
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      token = await this.authenticate();
      
      const retryHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      };
      
      return await fetch(url, {
        ...options,
        headers: retryHeaders,
      });
    }

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by fetching a lightweight endpoint
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_info/config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return response.ok;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async fetchEntitySchema(): Promise<{ source: string; schema: any }> {
    const endpoints = [
      { source: "entity-schema", url: `${this.baseUrl}/api/_info/entity-schema` },
      { source: "open-api", url: `${this.baseUrl}/api/_info/open-api-schema.json` },
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await this.makeAuthenticatedRequest(endpoint.url, {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          continue;
        }

        const schema = await response.json();
        return { source: endpoint.source, schema };
      } catch (error) {
        console.error(`[ShopwareClient] Failed fetching ${endpoint.source}:`, error);
      }
    }

    throw new Error("Failed to fetch Shopware entity schema");
  }

  async searchEntity(entityName: string, criteria: Record<string, any>): Promise<any> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entityName}`, {
      method: "POST",
      body: JSON.stringify(criteria),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search entity ${entityName}: ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  }

  /**
   * Reserviert eine Nummer aus einem Shopware Number-Range (z. B. für B2B-Angebote).
   * Liefert die generierte Nummer als String.
   */
  async reserveNumberRange(technicalName: string, salesChannelId?: string): Promise<string> {
    const base = `${this.baseUrl}/api/_action/number-range/reserve/${encodeURIComponent(technicalName)}`;
    const url = salesChannelId ? `${base}/${encodeURIComponent(salesChannelId)}` : base;
    const response = await this.makeAuthenticatedRequest(url, { method: "GET" });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Number-Range-Reservierung fehlgeschlagen (${technicalName}): ${response.status} ${errorText}`
      );
    }

    const data = await response.json();
    const number = data?.number ?? data?.data?.number;
    if (number === undefined || number === null || String(number).trim() === "") {
      throw new Error(`Number-Range ${technicalName} lieferte keine Nummer zurück`);
    }
    return String(number);
  }

  async fetchSalesChannels(): Promise<SalesChannel[]> {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 100,
          filter: [
            {
              type: 'equals',
              field: 'active',
              value: true,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch sales channels: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const channels = data.data || [];

      return channels.map((channel: any) => ({
        id: channel.id,
        name: channel.name || channel.attributes?.name || 'Unknown Channel',
        active: channel.active !== undefined ? channel.active : (channel.attributes?.active || true),
      }));
    } catch (error) {
      console.error('Error fetching sales channels from Shopware:', error);
      throw error;
    }
  }

  private mapShopwareStatus(shopwareStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      'open': 'open',
      'in_progress': 'in_progress',
      'done': 'completed',
      'completed': 'completed',
      'cancelled': 'cancelled',
    };
    return statusMap[shopwareStatus] || 'open';
  }

  private mapPaymentStatus(shopwarePaymentStatus: string): PaymentStatus {
    const paymentStatusMap: Record<string, PaymentStatus> = {
      'open': 'open',
      'in_progress': 'open',
      'paid': 'paid',
      'paid_partially': 'partially_paid',
      'partially_paid': 'partially_paid',
      'refunded': 'refunded',
      'refunded_partially': 'partially_paid',
      'partially_refunded': 'partially_paid',
      'cancelled': 'cancelled',
      'reminded': 'reminded',
      'failed': 'failed',
    };
    return paymentStatusMap[shopwarePaymentStatus] || 'open';
  }

  /**
   * Extract invoice creation date (Invoice created at) from order documents.
   * Supports both direct documents array and JSON:API relationships + included.
   */
  private extractInvoiceDateFromDocuments(
    shopwareOrder: any,
    includedMap?: Map<string, any>
  ): string | undefined {
    const getDocType = (doc: any): string | undefined => {
      if (doc.documentType?.technicalName) return doc.documentType.technicalName;
      if (doc.documentType?.attributes?.technicalName) return doc.documentType.attributes.technicalName;
      const typeId = doc.documentTypeId ?? doc.attributes?.documentTypeId ?? doc.relationships?.documentType?.data?.id;
      if (typeId && includedMap) {
        const dt = includedMap.get(`document_type-${typeId}`);
        return dt?.technicalName ?? dt?.attributes?.technicalName;
      }
      return undefined;
    };
    const getCreatedAt = (doc: any): string | undefined =>
      doc.createdAt ?? doc.attributes?.createdAt;

    // Primary: direct documents array
    const directDocs = shopwareOrder.documents || [];
    for (const doc of directDocs) {
      if (getDocType(doc) === 'invoice') {
        const createdAt = getCreatedAt(doc);
        if (createdAt) return createdAt;
      }
    }

    // Fallback: resolve from relationships + included (JSON:API can return array or single object)
    const docRefsRaw = shopwareOrder.relationships?.documents?.data;
    const docRefs = Array.isArray(docRefsRaw) ? docRefsRaw : docRefsRaw ? [docRefsRaw] : [];
    if (docRefs.length > 0 && includedMap) {
      for (const ref of docRefs) {
        const doc = includedMap.get(`document-${ref.id}`);
        if (!doc) continue;
        if (getDocType(doc) === 'invoice') {
          const createdAt = getCreatedAt(doc);
          if (createdAt) return createdAt;
        }
      }
    }

    return undefined;
  }

  /**
   * Ermittelt fuer die Bestelluebersicht, ob echte Rechnungsdokumente existieren
   * und ob sie verschickt wurden. Proforma-/Vorkasse-Rechnungen (Nummern VKRE/PF)
   * werden ausgeschlossen. invoiceSent ist nur true, wenn ALLE Rechnungen verschickt
   * sind (sent=true) – so faellt eine nicht verschickte (z. B. SAP-Import) sofort auf.
   */
  private extractInvoiceInfoFromDocuments(
    shopwareOrder: any,
    includedMap?: Map<string, any>
  ): { hasInvoice: boolean; count: number; sent: boolean } {
    const getDocType = (doc: any): string | undefined => {
      if (doc.documentType?.technicalName) return doc.documentType.technicalName;
      if (doc.documentType?.attributes?.technicalName) return doc.documentType.attributes.technicalName;
      const typeId = doc.documentTypeId ?? doc.attributes?.documentTypeId ?? doc.relationships?.documentType?.data?.id;
      if (typeId && includedMap) {
        const dt = includedMap.get(`document_type-${typeId}`);
        return dt?.technicalName ?? dt?.attributes?.technicalName;
      }
      return undefined;
    };
    const getNumber = (doc: any): string | undefined => doc.documentNumber ?? doc.attributes?.documentNumber;
    const getSent = (doc: any): boolean => Boolean(doc.sent ?? doc.attributes?.sent ?? false);

    const collected: boolean[] = []; // pro echter Rechnung: sent?
    const consider = (doc: any) => {
      if (getDocType(doc) !== 'invoice') return;
      const number = getNumber(doc);
      // Proforma-/Vorkasse-Rechnungen sind keine "echten" Rechnungen
      if (number && isProformaOrVorkasse(String(number))) return;
      collected.push(getSent(doc));
    };

    const directDocs = shopwareOrder.documents || [];
    for (const doc of directDocs) consider(doc);

    if (collected.length === 0) {
      const docRefsRaw = shopwareOrder.relationships?.documents?.data;
      const docRefs = Array.isArray(docRefsRaw) ? docRefsRaw : docRefsRaw ? [docRefsRaw] : [];
      if (docRefs.length > 0 && includedMap) {
        for (const ref of docRefs) {
          const doc = includedMap.get(`document-${ref.id}`);
          if (doc) consider(doc);
        }
      }
    }

    if (collected.length === 0) return { hasInvoice: false, count: 0, sent: false };
    return { hasInvoice: true, count: collected.length, sent: collected.every(Boolean) };
  }

  /**
   * Check if a payment is overdue (30 days after invoice creation)
   * Only for invoices with payment status 'open' or 'authorized'
   */
  private isPaymentOverdue(invoiceDate: string | undefined, paymentStatus: PaymentStatus): boolean {
    if (!invoiceDate) return false;
    if (paymentStatus !== 'open' && paymentStatus !== 'authorized') return false;

    const invoiceDateObj = new Date(invoiceDate);
    const now = new Date();
    const daysDiff = Math.floor((now.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));

    return daysDiff > 30;
  }

  /**
   * Fetch all orders (non-paginated, used by analytics)
   * @param salesChannelIds Optional array of sales channel IDs to filter by (server-side filtering for security)
   * @returns Array of orders (filtered if salesChannelIds provided)
   */
  async fetchOrders(
    salesChannelIds?: string[] | null,
    options?: { includeInvoiceInfo?: boolean },
  ): Promise<Order[]> {
    try {
      const limit = 500; // Fetch 500 orders per request for efficiency
      let page = 1;
      let allOrders: any[] = [];
      let allIncluded: any[] = [];
      let hasMore = true;
      
      // Build filter array for Shopware API
      const filters: any[] = [];
      
      // SECURITY: Add sales channel filter if provided
      if (salesChannelIds && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'salesChannelId',
          value: salesChannelIds,
        });
        console.log(`[fetchOrders] SECURITY: Filtering by sales channels:`, salesChannelIds);
      }

      // Fetch all orders with pagination - continue until we get no more results
      while (hasMore) {
        const requestBody: any = {
          limit: limit,
          page: page,
          sort: [
            {
              field: 'orderDate',
              order: 'DESC',
            },
            // Stabiler Zweit-Sort: orderDate ist nicht eindeutig (viele teilen
            // sich ein Datum). Ohne deterministischen Tiebreaker koennen sich
            // Seitengrenzen ueberschneiden und dieselbe Bestellung mehrfach
            // liefern. id ist eindeutig und macht die Paginierung deterministisch.
            {
              field: 'id',
              order: 'ASC',
            },
          ],
          includes: {
              order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries', 'documents'],
              order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
              order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'referencedId', 'type', 'payload', 'productNumber'],
              state_machine_state: ['technicalName'],
              sales_channel: ['id', 'name'],
              order_transaction: ['stateMachineState', 'paymentMethod'],
              payment_method: ['name', 'translated'],
              order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
              order_delivery: ['shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest', 'shippingMethod'],
              shipping_method: ['name', 'translated'],
              document: ['id', 'documentTypeId', 'createdAt', 'documentNumber', 'sent'],
              document_type: ['id', 'technicalName'],
            },
            associations: {
              orderCustomer: {},
              lineItems: {},
              stateMachineState: {},
              salesChannel: {},
              billingAddress: {},
              deliveries: {
                associations: {
                  shippingOrderAddress: {},
                  shippingMethod: {},
                },
              },
              transactions: {
                limit: 10, // Fetch up to 10 transactions per order (usually only 1-2)
                sort: [{ field: 'createdAt', order: 'DESC' }], // Latest transaction first
                associations: {
                  stateMachineState: {},
                  paymentMethod: {},
                },
              },
              documents: {
                associations: {
                  documentType: {},
                },
              },
            },
        };
        
        // Add sales channel filter if provided
        if (filters.length > 0) {
          requestBody.filter = filters;
        }
        
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch orders: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        
        // Shopware returns data and optionally included sections
        const orders = data.data || [];
        const included = data.included || [];
        
        if (orders.length === 0) {
          // No more orders to fetch
          hasMore = false;
          break;
        }
        
        allOrders = allOrders.concat(orders);
        allIncluded = allIncluded.concat(included);
        
        console.log(`Fetched page ${page}: ${orders.length} orders (total collected: ${allOrders.length})`);
        
        // Log first order number on first page for debugging
        if (page === 1 && orders.length > 0) {
          const firstOrder = orders[0];
          console.log(`First order (newest): ${firstOrder.orderNumber || firstOrder.attributes?.orderNumber || 'N/A'}`);
        }
        
        // If we got fewer results than the limit, we're done
        if (orders.length < limit) {
          hasMore = false;
        }
        
        page++;
      }

      console.log(`Total orders fetched: ${allOrders.length}`);
      
      // Shopware returns data and optionally included sections
      const orders = allOrders;
      const included = allIncluded;
      
      // Create a map of included entities by type and id for quick lookup
      const includedMap = new Map<string, any>();
      included.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      // Step 1: Collect all unique product IDs from all orders for batch price lookup
      const productIds = new Set<string>();
      let debugItemCount = 0;
      let debugProductCount = 0;
      
      orders.forEach((shopwareOrder: any) => {
        if (shopwareOrder.lineItems) {
          shopwareOrder.lineItems.forEach((item: any) => {
            debugItemCount++;
            const productId = item.productId || item.referencedId;
            const itemType = item.type;
            
            // Debug first item structure
            if (debugProductCount === 0) {
              console.log('[Debug] First line item structure:', {
                id: item.id,
                type: itemType,
                productId: item.productId,
                referencedId: item.referencedId,
                label: item.label,
                keys: Object.keys(item)
              });
            }
            
            if (productId && itemType === 'product') {
              productIds.add(productId);
              debugProductCount++;
            }
          });
        } else if (shopwareOrder.relationships?.lineItems?.data) {
          shopwareOrder.relationships.lineItems.data.forEach((lineItemRef: any) => {
            debugItemCount++;
            const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
            const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
            const itemType = lineItem?.attributes?.type || 'product';
            
            // Debug first item structure
            if (debugProductCount === 0 && lineItem) {
              console.log('[Debug] First line item structure (from relationships):', {
                id: lineItem.id,
                type: itemType,
                productId: lineItem.attributes?.productId,
                referencedId: lineItem.attributes?.referencedId,
                label: lineItem.attributes?.label,
                keys: lineItem.attributes ? Object.keys(lineItem.attributes) : []
              });
            }
            
            if (productId && itemType === 'product') {
              productIds.add(productId);
              debugProductCount++;
            }
          });
        }
      });
      
      console.log(`[fetchOrders] Found ${debugProductCount} product items out of ${debugItemCount} total line items`);

      // Step 2: Fetch catalog prices for all products in one batch request
      console.log(`[fetchOrders] Found ${productIds.size} unique products across all orders`);
      const catalogPrices = await this.fetchProductPricesBatch(Array.from(productIds));

      const mappedOrders: Order[] = orders.map((shopwareOrder: any) => {
        // Get customer data from relationships or direct inclusion
        let customerName = 'Unknown Customer';
        let customerEmail = '';
        let customerPhone = '';
        
        if (shopwareOrder.orderCustomer) {
          const customer = shopwareOrder.orderCustomer;
          customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
          customerEmail = customer.email || '';
        } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
          const customerId = shopwareOrder.relationships.orderCustomer.data.id;
          const customer = includedMap.get(`order_customer-${customerId}`);
          if (customer) {
            customerName = `${customer.attributes?.firstName || ''} ${customer.attributes?.lastName || ''}`.trim() || 'Unknown Customer';
            customerEmail = customer.attributes?.email || '';
          }
        }

        const customerNumber = extractShopwareOrderCustomerNumber(shopwareOrder, includedMap);
        
        // Get billing address
        let billingAddress = undefined;
        if (shopwareOrder.billingAddress) {
          const addr = shopwareOrder.billingAddress;
          billingAddress = {
            firstName: addr.firstName || '',
            lastName: addr.lastName || '',
            street: addr.street || '',
            zipCode: addr.zipcode || '',
            city: addr.city || '',
            country: addr.country?.name || '',
            company: addr.company,
            phoneNumber: addr.phoneNumber,
          };
          // Use billing address phone as customer phone if available
          if (addr.phoneNumber) {
            customerPhone = addr.phoneNumber;
          }
        } else if (shopwareOrder.relationships?.billingAddress?.data?.id) {
          const addrId = shopwareOrder.relationships.billingAddress.data.id;
          const addr = includedMap.get(`order_address-${addrId}`);
          if (addr?.attributes) {
            billingAddress = {
              firstName: addr.attributes.firstName || '',
              lastName: addr.attributes.lastName || '',
              street: addr.attributes.street || '',
              zipCode: addr.attributes.zipcode || '',
              city: addr.attributes.city || '',
              country: addr.attributes.country?.name || '',
              company: addr.attributes.company,
              phoneNumber: addr.attributes.phoneNumber,
            };
            if (addr.attributes.phoneNumber) {
              customerPhone = addr.attributes.phoneNumber;
            }
          }
        }
        
        // Get shipping address, delivery dates, and shipping method (letzte Lieferung, da in Shopware oft mehrere)
        let shippingAddress = undefined;
        let deliveryDateEarliest = undefined;
        let deliveryDateLatest = undefined;
        let shippingMethod: string | undefined;
        
        if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
          const delivery = getLatestDelivery(shopwareOrder.deliveries);
          
          // Extract delivery dates
          if (delivery.shippingDateEarliest) {
            deliveryDateEarliest = delivery.shippingDateEarliest;
          }
          if (delivery.shippingDateLatest) {
            deliveryDateLatest = delivery.shippingDateLatest;
          }
          
          // Extract shipping method name
          if (delivery.shippingMethod) {
            shippingMethod = delivery.shippingMethod.translated?.name || delivery.shippingMethod.name;
          }
          
          if (delivery.shippingOrderAddress) {
            const addr = delivery.shippingOrderAddress;
            shippingAddress = {
              firstName: addr.firstName || '',
              lastName: addr.lastName || '',
              street: addr.street || '',
              zipCode: addr.zipcode || '',
              city: addr.city || '',
              country: addr.country?.name || '',
              company: addr.company,
              phoneNumber: addr.phoneNumber,
            };
          }
        } else if (shopwareOrder.relationships?.deliveries?.data && shopwareOrder.relationships.deliveries.data.length > 0) {
          const deliveryRefs = shopwareOrder.relationships.deliveries.data;
          const deliveryEntities = deliveryRefs
            .map((ref: { id: string }) => includedMap.get(`order_delivery-${ref.id}`))
            .filter(Boolean);
          const delivery = getLatestDelivery(deliveryEntities);
          
          if (delivery?.attributes?.shippingDateEarliest) {
            deliveryDateEarliest = delivery.attributes.shippingDateEarliest;
          }
          if (delivery?.attributes?.shippingDateLatest) {
            deliveryDateLatest = delivery.attributes.shippingDateLatest;
          }
          
          if (delivery?.relationships?.shippingMethod?.data?.id) {
            const shippingMethodId = delivery.relationships.shippingMethod.data.id;
            const shippingMethodData = includedMap.get(`shipping_method-${shippingMethodId}`);
            if (shippingMethodData?.attributes) {
              shippingMethod = shippingMethodData.attributes.translated?.name || shippingMethodData.attributes.name;
            }
          }
          
          if (delivery?.relationships?.shippingOrderAddress?.data?.id) {
            const addrId = delivery.relationships.shippingOrderAddress.data.id;
            const addr = includedMap.get(`order_address-${addrId}`);
            if (addr?.attributes) {
              shippingAddress = {
                firstName: addr.attributes.firstName || '',
                lastName: addr.attributes.lastName || '',
                street: addr.attributes.street || '',
                zipCode: addr.attributes.zipcode || '',
                city: addr.attributes.city || '',
                country: addr.attributes.country?.name || '',
                company: addr.attributes.company,
                phoneNumber: addr.attributes.phoneNumber,
              };
            }
          }
        }

        // Get line items from relationships or direct inclusion
        let items: OrderItem[] = [];
        let lineItemsWithProductIds: Array<{ item: OrderItem; productId: string }> = [];
        
        if (shopwareOrder.lineItems) {
          items = shopwareOrder.lineItems.map((item: any, idx: number) => {
            const netPrice = item.unitPrice || 0;
            const netTotal = item.totalPrice || 0;
            const quantity = item.quantity || 1;
            // Extract tax rate first
            const taxRate = item.price?.taxRules?.[0]?.taxRate || 19;
            
            // Extract gross prices from Shopware's price structure
            // Shopware line items contain NET prices in unitPrice/totalPrice
            // The gross price is calculated by adding the tax from calculatedTaxes
            let grossPrice = netPrice;
            let grossTotal = netTotal;
            
            if (item.price && typeof item.price === 'object') {
              if (item.price.calculatedTaxes && Array.isArray(item.price.calculatedTaxes) && item.price.calculatedTaxes.length > 0) {
                // Shopware provides the exact tax amount in calculatedTaxes
                // Sum all tax entries (can be multiple for mixed rates, cross-border, etc.)
                const totalTax = item.price.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
                const unitTax = quantity > 0 ? totalTax / quantity : 0;
                
                grossPrice = netPrice + unitTax;
                grossTotal = netTotal + totalTax;
              } else {
                // Fallback: calculate from tax rate
                grossPrice = netPrice * (1 + taxRate / 100);
                grossTotal = netTotal * (1 + taxRate / 100);
              }
            }
            
            // Get product ID and look up weight from cache
            const productId = item.productId || item.referencedId;
            const itemType = item.type || 'product';
            let weight: number | undefined = undefined;
            let productNumber: string | undefined = item?.productNumber;
            const itemPayload = item?.payload || item?.attributes?.payload;
            
            if (productId && itemType === 'product') {
              const cacheStatus = productCache.getStatus();
              if (!cacheStatus.isPopulated) {
                console.log(`[Weight] Product cache not populated - skipping weight lookup for product ${productId}`);
              } else {
                const cachedProduct = productCache.getProductById(productId);
                if (cachedProduct) {
                  weight = cachedProduct.weight;
                  productNumber = cachedProduct.productNumber;
                } else {
                  console.log(`[Weight] Product ${productId} not found in cache (cache has ${cacheStatus.productCount} products)`);
                }
              }
            }
            
            if (!productNumber && itemPayload) {
              productNumber = itemPayload.productNumber || itemPayload.product_number;
            }

            const orderItem: OrderItem = {
              id: item.id,
              name: item.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
              weight,
              productNumber,
            };

            // Track product IDs for discount calculation
            if (productId && itemType === 'product') {
              lineItemsWithProductIds.push({ item: orderItem, productId });
            }

            return orderItem;
          });
        } else if (shopwareOrder.relationships?.lineItems?.data) {
          items = shopwareOrder.relationships.lineItems.data.map((lineItemRef: any) => {
            const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
            const netPrice = lineItem?.attributes?.unitPrice || 0;
            const netTotal = lineItem?.attributes?.totalPrice || 0;
            const quantity = lineItem?.attributes?.quantity || 1;
            const taxRate = lineItem?.attributes?.price?.taxRules?.[0]?.taxRate || 19;
            
            // Extract gross prices from Shopware's price structure
            // Shopware line items contain NET prices in unitPrice/totalPrice
            let grossPrice = netPrice;
            let grossTotal = netTotal;
            
            const priceObj = lineItem?.attributes?.price;
            if (priceObj && typeof priceObj === 'object') {
              if (priceObj.calculatedTaxes && Array.isArray(priceObj.calculatedTaxes) && priceObj.calculatedTaxes.length > 0) {
                // Sum all tax entries (can be multiple for mixed rates, cross-border, etc.)
                const totalTax = priceObj.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
                const unitTax = quantity > 0 ? totalTax / quantity : 0;
                
                grossPrice = netPrice + unitTax;
                grossTotal = netTotal + totalTax;
              } else {
                // Fallback: calculate from tax rate
                grossPrice = netPrice * (1 + taxRate / 100);
                grossTotal = netTotal * (1 + taxRate / 100);
              }
            }
            
            // Get product ID and look up weight from cache
            const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
            const itemType = lineItem?.attributes?.type || 'product';
            let weight: number | undefined = undefined;
            let productNumber: string | undefined = lineItem?.attributes?.productNumber;
            const itemPayload = lineItem?.attributes?.payload;
            
            if (productId && itemType === 'product') {
              const cacheStatus = productCache.getStatus();
              if (!cacheStatus.isPopulated) {
                // Log once per order for efficiency (only first item logs)
              } else {
                const cachedProduct = productCache.getProductById(productId);
                if (cachedProduct) {
                  weight = cachedProduct.weight;
                  productNumber = cachedProduct.productNumber;
                }
              }
            }
            
            if (!productNumber && itemPayload) {
              productNumber = itemPayload.productNumber || itemPayload.product_number;
            }

            const orderItem: OrderItem = {
              id: lineItemRef.id,
              name: lineItem?.attributes?.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
              weight,
              productNumber,
            };

            // Track product IDs for discount calculation
            if (productId && itemType === 'product') {
              lineItemsWithProductIds.push({ item: orderItem, productId });
            }

            return orderItem;
          });
        }

        // Get status from relationships or direct inclusion
        let status: OrderStatus = 'open';
        
        if (shopwareOrder.stateMachineState?.technicalName) {
          status = this.mapShopwareStatus(shopwareOrder.stateMachineState.technicalName);
        } else if (shopwareOrder.relationships?.stateMachineState?.data?.id) {
          const stateId = shopwareOrder.relationships.stateMachineState.data.id;
          const state = includedMap.get(`state_machine_state-${stateId}`);
          if (state?.attributes?.technicalName) {
            status = this.mapShopwareStatus(state.attributes.technicalName);
          }
        }

        // Get payment status and payment method from transactions (letzte Zahlart; Transaktionen sind nach createdAt DESC sortiert)
        let paymentStatus: PaymentStatus = 'open';
        let paymentMethod: string | undefined;
        
        if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
          const latestTransaction = shopwareOrder.transactions[0]; // neueste zuerst (sort: createdAt DESC)
          if (latestTransaction.stateMachineState?.technicalName) {
            paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
          } else {
            console.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: Transaction exists but missing stateMachineState`);
          }
          
          // Extract payment method name
          if (latestTransaction.paymentMethod) {
            paymentMethod = latestTransaction.paymentMethod.translated?.name || latestTransaction.paymentMethod.name;
          }
        } else if (shopwareOrder.relationships?.transactions?.data && shopwareOrder.relationships.transactions.data.length > 0) {
          // Fallback to relationships - also use FIRST (sorted DESC)
          const latestTransactionRef = shopwareOrder.relationships.transactions.data[0];
          const transaction = includedMap.get(`order_transaction-${latestTransactionRef.id}`);
          if (transaction?.relationships?.stateMachineState?.data?.id) {
            const paymentStateId = transaction.relationships.stateMachineState.data.id;
            const paymentState = includedMap.get(`state_machine_state-${paymentStateId}`);
            if (paymentState?.attributes?.technicalName) {
              paymentStatus = this.mapPaymentStatus(paymentState.attributes.technicalName);
            }
          }
          
          // Extract payment method from relationships
          if (transaction?.relationships?.paymentMethod?.data?.id) {
            const paymentMethodId = transaction.relationships.paymentMethod.data.id;
            const paymentMethodData = includedMap.get(`payment_method-${paymentMethodId}`);
            if (paymentMethodData?.attributes) {
              paymentMethod = paymentMethodData.attributes.translated?.name || paymentMethodData.attributes.name;
            }
          }
        } else {
          // No transactions found - log warning
          console.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: No transactions found, payment status defaults to 'open'`);
        }

        // Get sales channel data
        let salesChannelId = shopwareOrder.salesChannelId || shopwareOrder.attributes?.salesChannelId || '';
        let salesChannelName = '';
        
        if (shopwareOrder.salesChannel?.name) {
          salesChannelName = shopwareOrder.salesChannel.name;
        } else if (shopwareOrder.relationships?.salesChannel?.data?.id) {
          const channelId = shopwareOrder.relationships.salesChannel.data.id;
          const channel = includedMap.get(`sales_channel-${channelId}`);
          if (channel?.attributes?.name) {
            salesChannelName = channel.attributes.name;
          }
        }

        // Extract custom fields for ERP document numbers
        const customFields = shopwareOrder.customFields || shopwareOrder.attributes?.customFields || {};
        
        // Extract gross and net total amounts from Shopware
        const grossTotal = shopwareOrder.amountTotal || shopwareOrder.attributes?.amountTotal || 0;
        const netTotal = shopwareOrder.amountNet || shopwareOrder.attributes?.amountNet || shopwareOrder.price?.netPrice || grossTotal / 1.19;

        // Calculate discount by comparing catalog prices with actual paid prices
        let discount: { amount: number; percentage: number } | undefined;
        
        // Check if we can use catalog-based discount calculation
        // Requirements:
        // 1. All line items must be products with catalog prices (no custom discounts, shipping, etc.)
        // 2. All products must have valid catalog prices available
        const totalLineItems = shopwareOrder.lineItems?.length || 
          shopwareOrder.relationships?.lineItems?.data?.length || 0;
        
        const canUseCatalogPrices = 
          lineItemsWithProductIds.length > 0 &&
          lineItemsWithProductIds.length === totalLineItems && // All items are products
          lineItemsWithProductIds.every(({ productId }) => {
            const catalogPrice = catalogPrices.get(productId);
            return catalogPrice && catalogPrice.grossPrice > 0;
          });
        
        // Debug logging for discount calculation method selection
        if (!canUseCatalogPrices && lineItemsWithProductIds.length > 0) {
          const reasons = [];
          if (lineItemsWithProductIds.length !== totalLineItems) {
            reasons.push(`mixed line items (${lineItemsWithProductIds.length} products vs ${totalLineItems} total)`);
          }
          const missingPrices = lineItemsWithProductIds.filter(({ productId }) => {
            const catalogPrice = catalogPrices.get(productId);
            return !catalogPrice || catalogPrice.grossPrice <= 0;
          });
          if (missingPrices.length > 0) {
            reasons.push(`${missingPrices.length} products without catalog prices`);
          }
          if (reasons.length > 0) {
            console.log(`[Discount] Order ${shopwareOrder.orderNumber}: Using legacy discount calculation - ${reasons.join(', ')}`);
          }
        }
        
        if (canUseCatalogPrices) {
          // Method 1: Compare catalog prices with actual paid prices for each line item
          // Only use this method if ALL products have catalog prices to avoid mixed calculations
          let totalCatalogPrice = 0;
          let totalPaidPrice = 0;
          
          lineItemsWithProductIds.forEach(({ item, productId }) => {
            const catalogPrice = catalogPrices.get(productId);
            
            if (catalogPrice && catalogPrice.grossPrice > 0) {
              // Catalog price for this line item (quantity included)
              const catalogLineTotal = catalogPrice.grossPrice * item.quantity;
              totalCatalogPrice += catalogLineTotal;
              
              // Actual paid price for this line item
              totalPaidPrice += item.total;
            }
          });
          
          // Calculate discount from catalog vs paid
          if (totalCatalogPrice > totalPaidPrice && totalCatalogPrice > 0) {
            const discountAmount = totalCatalogPrice - totalPaidPrice;
            const discountPercentage = (discountAmount / totalCatalogPrice) * 100;
            
            if (discountAmount > 0.01) { // Only add discount if it's more than 1 cent
              discount = {
                amount: discountAmount,
                percentage: Math.round(discountPercentage * 100) / 100, // Round to 2 decimals
              };
            }
          }
        } else {
          // Fallback Method 2: Use Shopware's positionPrice vs totalPrice (old method)
          // Use this when catalog prices are not available for all products
          const priceObj = shopwareOrder.price || shopwareOrder.attributes?.price;
          
          if (priceObj) {
            // Shopware stores discount in positionPrice (sum of line items before discount) vs totalPrice
            const positionPrice = priceObj.positionPrice || 0;
            const totalPrice = priceObj.totalPrice || grossTotal;
            
            if (positionPrice > totalPrice && positionPrice > 0) {
              const discountAmount = positionPrice - totalPrice;
              const discountPercentage = (discountAmount / positionPrice) * 100;
              
              if (discountAmount > 0.01) { // Only add discount if it's more than 1 cent
                discount = {
                  amount: discountAmount,
                  percentage: Math.round(discountPercentage * 100) / 100, // Round to 2 decimals
                };
              }
            }
          }
        }

        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
          customerNumber: customerNumber || undefined,
          customerName,
          customerEmail,
          customerPhone: customerPhone || undefined,
          orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
          deliveryDateEarliest,
          deliveryDateLatest,
          totalAmount: grossTotal,
          netTotalAmount: netTotal,
          status,
          paymentStatus,
          paymentMethod,
          shippingMethod,
          salesChannelId,
          salesChannelName,
          billingAddress,
          shippingAddress,
          items,
          discount,
          customFields: shopwareOrder.customFields || undefined,
        };

        // Add ERP document numbers from custom fields
        if (customFields.custom_order_numbers_order) {
          order.erpNumber = customFields.custom_order_numbers_order;
        }
        if (customFields.custom_order_numbers_deliveryNo) {
          order.deliveryNoteNumber = customFields.custom_order_numbers_deliveryNo;
        }
        if (customFields.custom_order_numbers_invoice) {
          order.invoiceNumber = customFields.custom_order_numbers_invoice;
        }
        if (customFields.custom_order_proforma_number) {
          order.proformaNumber = customFields.custom_order_proforma_number;
        }
        if (customFields.custom_order_numbers_vorkasse) {
          order.vorkasseInvoiceNumber = customFields.custom_order_numbers_vorkasse;
        }

        // Extract invoice date from documents (Invoice created at) - supports direct and relationships+included
        order.invoiceDate = this.extractInvoiceDateFromDocuments(shopwareOrder, includedMap);

        // Rechnungsstatus fuer die Bestelluebersicht (vorhanden? verschickt?)
        const invoiceInfo = this.extractInvoiceInfoFromDocuments(shopwareOrder, includedMap);
        order.hasInvoiceDocument = invoiceInfo.hasInvoice;
        order.invoiceDocumentCount = invoiceInfo.count;
        order.invoiceSent = invoiceInfo.sent;

        // Check if payment is overdue
        order.isPaymentOverdue = this.isPaymentOverdue(order.invoiceDate, order.paymentStatus);

        return order;
      });

      // Duplikate entfernen: Die paginierte Suche kann dieselbe Bestellung
      // mehrfach liefern (Seitengrenzen-Ueberlappung -> gleiche id) und
      // Shopware-Order-Versionen erscheinen mit gleicher Bestellnummer aber
      // unterschiedlicher id. orderNumber ist in Shopware eindeutig und damit
      // eine sichere Dedup-Basis; zusaetzlich dedupen wir hart ueber die id.
      const seenIds = new Set<string>();
      const seenNumbers = new Set<string>();
      const dedupedOrders: Order[] = [];
      let duplicateCount = 0;
      for (const o of mappedOrders) {
        if (o.id && seenIds.has(o.id)) {
          duplicateCount++;
          continue;
        }
        if (o.orderNumber && seenNumbers.has(o.orderNumber)) {
          duplicateCount++;
          continue;
        }
        if (o.id) seenIds.add(o.id);
        if (o.orderNumber) seenNumbers.add(o.orderNumber);
        dedupedOrders.push(o);
      }
      if (duplicateCount > 0) {
        console.log(
          `[fetchOrders] Removed ${duplicateCount} duplicate order(s); ${dedupedOrders.length} unique remaining`,
        );
      }

      // Die documents-Association wird in der Listen-Query nicht zuverlaessig
      // mitgeliefert. Fuer die Bestelluebersicht laden wir die echten
      // Rechnungsdokumente daher gebatcht ueber einen separaten Endpoint nach.
      if (options?.includeInvoiceInfo && dedupedOrders.length > 0) {
        try {
          const invoiceInfo = await this.fetchInvoiceInfoByOrderIds(
            dedupedOrders.map((o) => o.id),
          );
          for (const o of dedupedOrders) {
            const info = invoiceInfo.get(o.id);
            o.hasInvoiceDocument = !!info && info.count > 0;
            o.invoiceDocumentCount = info?.count ?? 0;
            o.invoiceSent = info ? info.sent : false;
          }
        } catch (infoError) {
          console.warn('[fetchOrders] invoice info fetch failed:', infoError);
        }
      }

      return dedupedOrders;
    } catch (error) {
      console.error('Error fetching orders from Shopware:', error);
      throw error;
    }
  }

  /**
   * Laedt fuer eine Menge von Bestell-IDs gebatcht die echten Rechnungsdokumente
   * (technicalName 'invoice', ohne Proforma/Vorkasse) und ob alle verschickt
   * wurden. Wird fuer die Bestelluebersicht genutzt, da die documents-Association
   * in der Listen-Query nicht zuverlaessig mitgeladen wird.
   */
  async fetchInvoiceInfoByOrderIds(
    orderIds: string[],
  ): Promise<Map<string, { count: number; sent: boolean }>> {
    const result = new Map<string, { count: number; sent: boolean }>();
    const ids = Array.from(new Set((orderIds || []).filter(Boolean)));
    if (ids.length === 0) return result;

    // Alle Dokumenttypen einmalig laden (wenige Eintraege) -> id -> technicalName
    const typeNames = new Map<string, string>();
    try {
      const typesResp = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: 100,
            includes: { document_type: ['id', 'technicalName'] },
          }),
        },
      );
      if (typesResp.ok) {
        const typesData = await typesResp.json();
        for (const item of typesData.data || []) {
          typeNames.set(item.id, readEntityTechnicalName(item));
        }
      }
    } catch (e) {
      console.warn('[fetchInvoiceInfoByOrderIds] document-type fetch failed:', e);
    }

    const CHUNK = 200;
    const PAGE_LIMIT = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const chunk = ids.slice(i, i + CHUNK);
      let page = 1;
      let hasMore = true;
      while (hasMore) {
        const response = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/search/document`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              limit: PAGE_LIMIT,
              page,
              filter: [{ type: 'equalsAny', field: 'orderId', value: chunk }],
              includes: {
                document: ['id', 'orderId', 'documentTypeId', 'documentNumber', 'sent'],
              },
            }),
          },
        );

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(
            `Failed to fetch invoice info: ${response.statusText} - ${errorText}`,
          );
        }

        const data = await response.json();
        const documents = data.data || [];

        for (const doc of documents) {
          const orderId =
            doc.orderId ??
            doc.attributes?.orderId ??
            doc.relationships?.order?.data?.id;
          if (!orderId) continue;

          const typeId =
            doc.documentTypeId ??
            doc.attributes?.documentTypeId ??
            doc.relationships?.documentType?.data?.id;
          const technicalName = typeId ? typeNames.get(typeId) : undefined;
          if (technicalName !== 'invoice') continue;

          const number = doc.documentNumber ?? doc.attributes?.documentNumber;
          if (number && isProformaOrVorkasse(String(number))) continue;

          const sent = Boolean(doc.sent ?? doc.attributes?.sent ?? false);
          const prev = result.get(orderId) ?? { count: 0, sent: true };
          result.set(orderId, { count: prev.count + 1, sent: prev.sent && sent });
        }

        hasMore = documents.length === PAGE_LIMIT;
        page++;
      }
    }

    return result;
  }

  async fetchLatestOrderMeta(): Promise<{ id: string; orderNumber: string; updatedAt?: string; orderDate?: string } | null> {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 1,
          page: 1,
          sort: [{ field: 'orderDate', order: 'DESC' }],
          includes: {
            order: ['id', 'orderNumber', 'orderDate', 'updatedAt'],
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch latest order meta: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const latest = data?.data?.[0];
      if (!latest) {
        return null;
      }

      return {
        id: latest.id,
        orderNumber: latest.orderNumber || latest.attributes?.orderNumber,
        orderDate: latest.orderDate || latest.attributes?.orderDate,
        updatedAt: latest.updatedAt || latest.attributes?.updatedAt,
      };
    } catch (error) {
      console.error('Error fetching latest order meta from Shopware:', error);
      return null;
    }
  }

  /**
   * Leichter Änderungs-Fingerprint für Search-Endpoints: Anzahl + jüngstes updatedAt.
   * Ein API-Call statt voller Pagination — Basis für Hash-Cache-Invalidierung.
   */
  async fetchEntitySearchFingerprint(
    entity: string,
    options?: {
      filter?: any[];
      sortField?: string;
    },
  ): Promise<{ total: number; latestUpdatedAt: string | null; latestId: string | null } | null> {
    try {
      const sortField = options?.sortField ?? "updatedAt";
      const body: Record<string, unknown> = {
        limit: 1,
        page: 1,
        totalCountMode: 1,
        sort: [{ field: sortField, order: "DESC" }],
      };
      if (options?.filter?.length) {
        body.filter = options.filter;
      }

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch ${entity} fingerprint: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const latest = data?.data?.[0];
      const total = Number(data?.meta?.total ?? data?.total ?? 0);
      const attrs = latest?.attributes ?? latest;

      return {
        total,
        latestUpdatedAt: (attrs?.updatedAt ?? latest?.updatedAt ?? null) as string | null,
        latestId: (latest?.id ?? null) as string | null,
      };
    } catch (error) {
      console.error(`[Shopware] fetchEntitySearchFingerprint(${entity}) failed:`, error);
      return null;
    }
  }

  /** Fingerprint-String für Bestandskunden-Index (Portal/Händler-Gruppen). */
  async fetchBestandskundenFingerprint(groupNameTerms: string[]): Promise<string | null> {
    const terms = (groupNameTerms || []).map((term) => (term || "").trim()).filter((term) => term.length >= 2);
    if (terms.length === 0) return null;

    const filter = [
      {
        type: "multi",
        operator: "OR",
        queries: terms.map((value) => ({ type: "contains", field: "group.name", value })),
      },
    ];

    const fp = await this.fetchEntitySearchFingerprint("customer", { filter });
    if (!fp) return null;

    const { stableFingerprint } = await import("./contentHashCache");
    return stableFingerprint({
      scope: "bestandskunden",
      terms: terms.join(","),
      total: fp.total,
      latestUpdatedAt: fp.latestUpdatedAt,
      latestId: fp.latestId,
    });
  }

  /** Fingerprint für aktive Produkte (entspricht Product-Cache-Refresh). */
  async fetchActiveProductCatalogFingerprint(): Promise<string | null> {
    const filter = [{ type: "equals", field: "active", value: true }];
    const fp = await this.fetchEntitySearchFingerprint("product", { filter, sortField: "updatedAt" });
    if (!fp) return null;

    const { stableFingerprint } = await import("./contentHashCache");
    return stableFingerprint({
      scope: "active_products",
      total: fp.total,
      latestUpdatedAt: fp.latestUpdatedAt,
      latestId: fp.latestId,
    });
  }

  /** Fingerprint für Bestellungen (Count + jüngste Änderung). */
  async fetchOrdersFingerprint(): Promise<string | null> {
    const fp = await this.fetchEntitySearchFingerprint("order", { sortField: "updatedAt" });
    if (!fp) return null;

    const { stableFingerprint } = await import("./contentHashCache");
    return stableFingerprint({
      scope: "orders",
      total: fp.total,
      latestUpdatedAt: fp.latestUpdatedAt,
      latestId: fp.latestId,
    });
  }

  /**
   * Fetch orders with pagination support
   * @param limit Maximum number of orders to return (default: 50)
   * @param offset Number of orders to skip (default: 0)
   * @param salesChannelIds Optional array of sales channel IDs to filter by (server-side filtering for security)
   * @returns Object with orders array and total count (total is filtered if salesChannelIds provided)
   */
  async fetchOrdersPaginated(limit: number = 50, offset: number = 0, salesChannelIds?: string[] | null): Promise<{ orders: Order[]; total: number }> {
    try {
      // Calculate page number from offset (Shopware uses page-based pagination)
      const page = Math.floor(offset / limit) + 1;
      
      // Build filter array for Shopware API
      const filters: any[] = [];
      
      // SECURITY: Add sales channel filter if provided
      if (salesChannelIds && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'salesChannelId',
          value: salesChannelIds,
        });
        console.log(`[fetchOrdersPaginated] SECURITY: Filtering by sales channels:`, salesChannelIds);
      }
      
      const requestBody: any = {
        limit: limit,
        page: page,
        sort: [
          {
            field: 'orderDate',
            order: 'DESC',
          },
          // Stabiler Zweit-Sort fuer deterministische Paginierung (siehe fetchOrders)
          {
            field: 'id',
            order: 'ASC',
          },
        ],
        includes: {
            order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries', 'documents'],
            order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'referencedId', 'type', 'payload', 'productNumber'],
            state_machine_state: ['technicalName'],
            sales_channel: ['id', 'name'],
            order_transaction: ['stateMachineState', 'paymentMethod'],
            payment_method: ['name', 'translated'],
            order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
            order_delivery: ['shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest', 'shippingMethod'],
            shipping_method: ['name', 'translated'],
            document: ['id', 'documentTypeId', 'createdAt', 'documentNumber', 'sent'],
            document_type: ['id', 'technicalName'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {},
            stateMachineState: {},
            salesChannel: {},
            billingAddress: {},
            deliveries: {
              associations: {
                shippingOrderAddress: {},
                shippingMethod: {},
              },
            },
            transactions: {
              limit: 10,
              sort: [{ field: 'createdAt', order: 'DESC' }],
              associations: {
                stateMachineState: {},
                paymentMethod: {},
              },
            },
            documents: {
              associations: {
                documentType: {},
              },
            },
          },
      };
      
      // Add sales channel filter if provided
      if (filters.length > 0) {
        requestBody.filter = filters;
      }
      
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch orders: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const ordersData = data.data || [];
      const included = data.included || [];
      const total = data.total || 0;

      console.log(`[fetchOrdersPaginated] Fetched ${ordersData.length} orders (offset: ${offset}, limit: ${limit}, total: ${total})`);

      // Create a map of included entities by type and id for quick lookup
      const includedMap = new Map<string, any>();
      included.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      // Collect all unique product IDs from this page for batch price lookup
      const productIds = new Set<string>();
      const lineItemsWithProductIds: Array<{ item: any; productId: string }> = [];
      
      ordersData.forEach((shopwareOrder: any) => {
        if (shopwareOrder.lineItems) {
          shopwareOrder.lineItems.forEach((item: any) => {
            const productId = item.productId || item.referencedId;
            const itemType = item.type;
            
            if (productId && itemType === 'product') {
              productIds.add(productId);
              lineItemsWithProductIds.push({ item, productId });
            }
          });
        } else if (shopwareOrder.relationships?.lineItems?.data) {
          shopwareOrder.relationships.lineItems.data.forEach((lineItemRef: any) => {
            const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
            const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
            const itemType = lineItem?.attributes?.type || 'product';
            
            if (productId && itemType === 'product' && lineItem) {
              productIds.add(productId);
              lineItemsWithProductIds.push({ item: lineItem.attributes, productId });
            }
          });
        }
      });

      // Fetch catalog prices for all products in this page
      const catalogPrices = await this.fetchProductPricesBatch(Array.from(productIds));

      // Map orders using the same logic as fetchOrders()
      const orders = ordersData.map((shopwareOrder: any) => {
        // Get customer data
        let customerName = 'Unknown Customer';
        let customerEmail = '';
        let customerPhone = '';
        
        if (shopwareOrder.orderCustomer) {
          const customer = shopwareOrder.orderCustomer;
          customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
          customerEmail = customer.email || '';
        } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
          const customerId = shopwareOrder.relationships.orderCustomer.data.id;
          const customer = includedMap.get(`order_customer-${customerId}`);
          if (customer) {
            customerName = `${customer.attributes?.firstName || ''} ${customer.attributes?.lastName || ''}`.trim() || 'Unknown Customer';
            customerEmail = customer.attributes?.email || '';
          }
        }

        const customerNumber = extractShopwareOrderCustomerNumber(shopwareOrder, includedMap);
        
        // Get billing address
        let billingAddress = undefined;
        if (shopwareOrder.billingAddress) {
          const addr = shopwareOrder.billingAddress;
          billingAddress = {
            firstName: addr.firstName || '',
            lastName: addr.lastName || '',
            street: addr.street || '',
            zipCode: addr.zipcode || '',
            city: addr.city || '',
            country: addr.country?.name || '',
            company: addr.company,
            phoneNumber: addr.phoneNumber,
          };
          if (addr.phoneNumber) {
            customerPhone = addr.phoneNumber;
          }
        } else if (shopwareOrder.relationships?.billingAddress?.data?.id) {
          const addrId = shopwareOrder.relationships.billingAddress.data.id;
          const addr = includedMap.get(`order_address-${addrId}`);
          if (addr?.attributes) {
            billingAddress = {
              firstName: addr.attributes.firstName || '',
              lastName: addr.attributes.lastName || '',
              street: addr.attributes.street || '',
              zipCode: addr.attributes.zipcode || '',
              city: addr.attributes.city || '',
              country: addr.attributes.country?.name || '',
              company: addr.attributes.company,
              phoneNumber: addr.attributes.phoneNumber,
            };
            if (addr.attributes.phoneNumber) {
              customerPhone = addr.attributes.phoneNumber;
            }
          }
        }
        
        // Get shipping address, delivery dates, and shipping method (letzte Lieferung, da in Shopware oft mehrere)
        let shippingAddress = undefined;
        let deliveryDateEarliest = undefined;
        let deliveryDateLatest = undefined;
        let shippingMethod: string | undefined;
        
        if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
          const delivery = getLatestDelivery(shopwareOrder.deliveries);
          
          if (delivery.shippingDateEarliest) {
            deliveryDateEarliest = delivery.shippingDateEarliest;
          }
          if (delivery.shippingDateLatest) {
            deliveryDateLatest = delivery.shippingDateLatest;
          }
          
          if (delivery.shippingMethod) {
            shippingMethod = delivery.shippingMethod.translated?.name || delivery.shippingMethod.name;
          }
          
          if (delivery.shippingOrderAddress) {
            const addr = delivery.shippingOrderAddress;
            shippingAddress = {
              firstName: addr.firstName || '',
              lastName: addr.lastName || '',
              street: addr.street || '',
              zipCode: addr.zipcode || '',
              city: addr.city || '',
              country: addr.country?.name || '',
              company: addr.company,
              phoneNumber: addr.phoneNumber,
            };
          }
        } else if (shopwareOrder.relationships?.deliveries?.data && shopwareOrder.relationships.deliveries.data.length > 0) {
          const deliveryRefs = shopwareOrder.relationships.deliveries.data;
          const deliveryEntities = deliveryRefs
            .map((ref: { id: string }) => includedMap.get(`order_delivery-${ref.id}`))
            .filter(Boolean);
          const delivery = getLatestDelivery(deliveryEntities);
          
          if (delivery?.attributes?.shippingDateEarliest) {
            deliveryDateEarliest = delivery.attributes.shippingDateEarliest;
          }
          if (delivery?.attributes?.shippingDateLatest) {
            deliveryDateLatest = delivery.attributes.shippingDateLatest;
          }
          
          if (delivery?.relationships?.shippingMethod?.data?.id) {
            const shippingMethodId = delivery.relationships.shippingMethod.data.id;
            const shippingMethodData = includedMap.get(`shipping_method-${shippingMethodId}`);
            if (shippingMethodData?.attributes) {
              shippingMethod = shippingMethodData.attributes.translated?.name || shippingMethodData.attributes.name;
            }
          }
          
          if (delivery?.relationships?.shippingOrderAddress?.data?.id) {
            const addrId = delivery.relationships.shippingOrderAddress.data.id;
            const addr = includedMap.get(`order_address-${addrId}`);
            if (addr?.attributes) {
              shippingAddress = {
                firstName: addr.attributes.firstName || '',
                lastName: addr.attributes.lastName || '',
                street: addr.attributes.street || '',
                zipCode: addr.attributes.zipcode || '',
                city: addr.attributes.city || '',
                country: addr.attributes.country?.name || '',
                company: addr.attributes.company,
                phoneNumber: addr.attributes.phoneNumber,
              };
            }
          }
        }

        // Get line items
        let items: OrderItem[] = [];
        
        if (shopwareOrder.lineItems) {
          items = shopwareOrder.lineItems.map((item: any) => {
            const netPrice = item.unitPrice || 0;
            const netTotal = item.totalPrice || 0;
            const quantity = item.quantity || 1;
            const taxRate = item.price?.taxRules?.[0]?.taxRate || 19;
            
            let grossPrice = netPrice;
            let grossTotal = netTotal;
            
            if (item.price && typeof item.price === 'object') {
              if (item.price.calculatedTaxes && Array.isArray(item.price.calculatedTaxes) && item.price.calculatedTaxes.length > 0) {
                const totalTax = item.price.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
                const unitTax = quantity > 0 ? totalTax / quantity : 0;
                
                grossPrice = netPrice + unitTax;
                grossTotal = netTotal + totalTax;
              } else {
                grossPrice = netPrice * (1 + taxRate / 100);
                grossTotal = netTotal * (1 + taxRate / 100);
              }
            }
            
            const orderItem: OrderItem = {
              id: item.id,
              name: item.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
            };

            const productId = item.productId || item.referencedId;
            if (productId && item.type === 'product') {
              lineItemsWithProductIds.push({ item: orderItem, productId });
            }

            return orderItem;
          });
        } else if (shopwareOrder.relationships?.lineItems?.data) {
          items = shopwareOrder.relationships.lineItems.data.map((lineItemRef: any) => {
            const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
            const netPrice = lineItem?.attributes?.unitPrice || 0;
            const netTotal = lineItem?.attributes?.totalPrice || 0;
            const quantity = lineItem?.attributes?.quantity || 1;
            const taxRate = lineItem?.attributes?.price?.taxRules?.[0]?.taxRate || 19;
            
            let grossPrice = netPrice;
            let grossTotal = netTotal;
            
            const priceObj = lineItem?.attributes?.price;
            if (priceObj && typeof priceObj === 'object') {
              if (priceObj.calculatedTaxes && Array.isArray(priceObj.calculatedTaxes) && priceObj.calculatedTaxes.length > 0) {
                const totalTax = priceObj.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
                const unitTax = quantity > 0 ? totalTax / quantity : 0;
                
                grossPrice = netPrice + unitTax;
                grossTotal = netTotal + totalTax;
              } else {
                grossPrice = netPrice * (1 + taxRate / 100);
                grossTotal = netTotal * (1 + taxRate / 100);
              }
            }
            
            const orderItem: OrderItem = {
              id: lineItemRef.id,
              name: lineItem?.attributes?.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
            };

            const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
            const itemType = lineItem?.attributes?.type || 'product';
            if (productId && itemType === 'product' && lineItem) {
              lineItemsWithProductIds.push({ item: orderItem, productId });
            }

            return orderItem;
          });
        }

        // Get status
        let status: OrderStatus = 'open';
        
        if (shopwareOrder.stateMachineState?.technicalName) {
          status = this.mapShopwareStatus(shopwareOrder.stateMachineState.technicalName);
        } else if (shopwareOrder.relationships?.stateMachineState?.data?.id) {
          const stateId = shopwareOrder.relationships.stateMachineState.data.id;
          const state = includedMap.get(`state_machine_state-${stateId}`);
          if (state?.attributes?.technicalName) {
            status = this.mapShopwareStatus(state.attributes.technicalName);
          }
        }

        // Get payment status and payment method from transactions (letzte Zahlart; Transaktionen sind nach createdAt DESC sortiert)
        let paymentStatus: PaymentStatus = 'open';
        let paymentMethod: string | undefined;
        
        if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
          const latestTransaction = shopwareOrder.transactions[0]; // neueste zuerst (sort: createdAt DESC)
          if (latestTransaction.stateMachineState?.technicalName) {
            paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
          }
          
          if (latestTransaction.paymentMethod) {
            paymentMethod = latestTransaction.paymentMethod.translated?.name || latestTransaction.paymentMethod.name;
          }
        } else if (shopwareOrder.relationships?.transactions?.data && shopwareOrder.relationships.transactions.data.length > 0) {
          const latestTransactionRef = shopwareOrder.relationships.transactions.data[0];
          const transaction = includedMap.get(`order_transaction-${latestTransactionRef.id}`);
          if (transaction?.relationships?.stateMachineState?.data?.id) {
            const paymentStateId = transaction.relationships.stateMachineState.data.id;
            const paymentState = includedMap.get(`state_machine_state-${paymentStateId}`);
            if (paymentState?.attributes?.technicalName) {
              paymentStatus = this.mapPaymentStatus(paymentState.attributes.technicalName);
            }
          }
          
          if (transaction?.relationships?.paymentMethod?.data?.id) {
            const paymentMethodId = transaction.relationships.paymentMethod.data.id;
            const paymentMethodData = includedMap.get(`payment_method-${paymentMethodId}`);
            if (paymentMethodData?.attributes) {
              paymentMethod = paymentMethodData.attributes.translated?.name || paymentMethodData.attributes.name;
            }
          }
        }

        // Get sales channel data
        let salesChannelId = shopwareOrder.salesChannelId || shopwareOrder.attributes?.salesChannelId || '';
        let salesChannelName = '';
        
        if (shopwareOrder.salesChannel?.name) {
          salesChannelName = shopwareOrder.salesChannel.name;
        } else if (shopwareOrder.relationships?.salesChannel?.data?.id) {
          const channelId = shopwareOrder.relationships.salesChannel.data.id;
          const channel = includedMap.get(`sales_channel-${channelId}`);
          if (channel?.attributes?.name) {
            salesChannelName = channel.attributes.name;
          }
        }

        // Extract custom fields for ERP document numbers
        const customFields = shopwareOrder.customFields || shopwareOrder.attributes?.customFields || {};
        
        // Extract gross and net total amounts
        const grossTotal = shopwareOrder.amountTotal || shopwareOrder.attributes?.amountTotal || 0;
        const netTotal = shopwareOrder.amountNet || shopwareOrder.attributes?.amountNet || shopwareOrder.price?.netPrice || grossTotal / 1.19;

        // Calculate discount
        let discount: { amount: number; percentage: number } | undefined;
        
        // Match lineItemsWithProductIds with current order's items by ID
        const currentPageLineItems = lineItemsWithProductIds.filter(({ item }) => {
          return items.some(orderItem => orderItem.id === item.id);
        });
        
        const totalLineItems = shopwareOrder.lineItems?.length || 
          shopwareOrder.relationships?.lineItems?.data?.length || 0;
        
        const canUseCatalogPrices = 
          currentPageLineItems.length > 0 &&
          currentPageLineItems.length === totalLineItems &&
          currentPageLineItems.every(({ productId }) => {
            const catalogPrice = catalogPrices.get(productId);
            return catalogPrice && catalogPrice.grossPrice > 0;
          });
        
        if (canUseCatalogPrices) {
          let totalCatalogPrice = 0;
          let totalPaidPrice = 0;
          
          currentPageLineItems.forEach(({ item, productId }) => {
            const catalogPrice = catalogPrices.get(productId);
            
            if (catalogPrice && catalogPrice.grossPrice > 0) {
              const quantity = item.quantity || 0;
              const catalogLineTotal = catalogPrice.grossPrice * quantity;
              totalCatalogPrice += catalogLineTotal;
              
              // Use OrderItem fields (total, not totalPrice)
              const paidPrice = item.total || 0;
              totalPaidPrice += paidPrice;
            }
          });
          
          if (totalCatalogPrice > totalPaidPrice && totalCatalogPrice > 0) {
            const discountAmount = totalCatalogPrice - totalPaidPrice;
            const discountPercentage = (discountAmount / totalCatalogPrice) * 100;
            
            if (discountAmount > 0.01) {
              discount = {
                amount: discountAmount,
                percentage: Math.round(discountPercentage * 100) / 100,
              };
            }
          }
        } else {
          const priceObj = shopwareOrder.price || shopwareOrder.attributes?.price;
          
          if (priceObj) {
            const positionPrice = priceObj.positionPrice || 0;
            const totalPrice = priceObj.totalPrice || grossTotal;
            
            if (positionPrice > totalPrice && positionPrice > 0) {
              const discountAmount = positionPrice - totalPrice;
              const discountPercentage = (discountAmount / positionPrice) * 100;
              
              if (discountAmount > 0.01) {
                discount = {
                  amount: discountAmount,
                  percentage: Math.round(discountPercentage * 100) / 100,
                };
              }
            }
          }
        }

        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
          customerNumber: customerNumber || undefined,
          customerName,
          customerEmail,
          customerPhone: customerPhone || undefined,
          orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
          deliveryDateEarliest,
          deliveryDateLatest,
          totalAmount: grossTotal,
          netTotalAmount: netTotal,
          status,
          paymentStatus,
          paymentMethod,
          shippingMethod,
          salesChannelId,
          salesChannelName,
          billingAddress,
          shippingAddress,
          items,
          discount,
          customFields: shopwareOrder.customFields || undefined,
        };

        // Add ERP document numbers from custom fields
        if (customFields.custom_order_numbers_order) {
          order.erpNumber = customFields.custom_order_numbers_order;
        }
        if (customFields.custom_order_numbers_deliveryNo) {
          order.deliveryNoteNumber = customFields.custom_order_numbers_deliveryNo;
        }
        if (customFields.custom_order_numbers_invoice) {
          order.invoiceNumber = customFields.custom_order_numbers_invoice;
        }
        if (customFields.custom_order_proforma_number) {
          order.proformaNumber = customFields.custom_order_proforma_number;
        }
        if (customFields.custom_order_numbers_vorkasse) {
          order.vorkasseInvoiceNumber = customFields.custom_order_numbers_vorkasse;
        }

        // Extract invoice date from documents (Invoice created at) - supports direct and relationships+included
        order.invoiceDate = this.extractInvoiceDateFromDocuments(shopwareOrder, includedMap);

        // Rechnungsstatus fuer die Bestelluebersicht (vorhanden? verschickt?)
        const invoiceInfo = this.extractInvoiceInfoFromDocuments(shopwareOrder, includedMap);
        order.hasInvoiceDocument = invoiceInfo.hasInvoice;
        order.invoiceDocumentCount = invoiceInfo.count;
        order.invoiceSent = invoiceInfo.sent;

        // Check if payment is overdue
        order.isPaymentOverdue = this.isPaymentOverdue(order.invoiceDate, order.paymentStatus);

        return order;
      });

      // Duplikate innerhalb der Seite entfernen (Order-Versionen mit gleicher,
      // eindeutiger Bestellnummer bzw. doppelte ids). Siehe fetchOrders.
      const seenIds = new Set<string>();
      const seenNumbers = new Set<string>();
      const dedupedOrders: Order[] = [];
      for (const o of orders) {
        if (o.id && seenIds.has(o.id)) continue;
        if (o.orderNumber && seenNumbers.has(o.orderNumber)) continue;
        if (o.id) seenIds.add(o.id);
        if (o.orderNumber) seenNumbers.add(o.orderNumber);
        dedupedOrders.push(o);
      }

      return {
        orders: dedupedOrders,
        total,
      };
    } catch (error) {
      console.error('[fetchOrdersPaginated] Error fetching orders from Shopware:', error);
      throw error;
    }
  }

  // Fetch specific orders by their IDs (for ticket sales channel filtering)
  async fetchOrdersByIds(orderIds: string[]): Promise<Map<string, { id: string; salesChannelId: string }>> {
    try {
      if (orderIds.length === 0) {
        return new Map();
      }

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: orderIds.length,
          filter: [
            {
              type: 'equalsAny',
              field: 'id',
              value: orderIds.join('|'), // Shopware requires pipe-delimited string
            },
          ],
          includes: {
            order: ['id', 'salesChannelId'],
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch orders by IDs: ${response.statusText} - ${errorText}`);
        return new Map(); // Return empty map on error to fail permissively
      }

      const data = await response.json();
      const orders = data.data || [];
      
      const orderMap = new Map<string, { id: string; salesChannelId: string }>();
      orders.forEach((order: any) => {
        if (order.id && order.salesChannelId) {
          orderMap.set(order.id, {
            id: order.id,
            salesChannelId: order.salesChannelId,
          });
        }
      });

      return orderMap;
    } catch (error) {
      console.error('Error fetching orders by IDs from Shopware:', error);
      return new Map(); // Return empty map on error to fail permissively
    }
  }

  /**
   * Fetch customer order history by email (lightweight version for display)
   * Returns compact order summaries: id, orderNumber, orderDate, totalAmount, status
   * @param customerEmail Customer email to search for
   * @param excludeOrderId Optional order ID to exclude (current order)
   * @param limit Maximum number of orders to return (default: 10)
   * @param salesChannelIds Optional array of sales channel IDs to filter by
   */
  async fetchCustomerOrderHistory(
    customerEmail: string,
    excludeOrderId?: string,
    limit: number = 10,
    salesChannelIds?: string[] | null
  ): Promise<Array<{
    id: string;
    orderNumber: string;
    orderDate: string;
    totalAmount: number;
    status: string;
  }>> {
    try {
      // SECURITY: Explicitly handle undefined - treat as an error condition
      // undefined should not occur if called correctly, but if it does, return empty results
      if (salesChannelIds === undefined) {
        console.error(`[fetchCustomerOrderHistory] SECURITY: Received undefined salesChannelIds, returning empty results`);
        return [];
      }

      // SECURITY: Empty array means no access - this should be caught at route level but double-check here
      if (salesChannelIds !== null && salesChannelIds.length === 0) {
        console.log(`[fetchCustomerOrderHistory] SECURITY: Empty salesChannelIds array, returning empty results`);
        return [];
      }

      if (!customerEmail) {
        return [];
      }

      // Build filter array
      const filters: any[] = [
        {
          type: 'equals',
          field: 'orderCustomer.email',
          value: customerEmail,
        },
      ];

      // Exclude current order if provided
      if (excludeOrderId) {
        filters.push({
          type: 'not',
          queries: [
            {
              type: 'equals',
              field: 'id',
              value: excludeOrderId,
            },
          ],
        });
      }

      // Add sales channel filter if provided
      if (salesChannelIds && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'salesChannelId',
          value: salesChannelIds,
        });
      }

      const requestBody = {
        limit: limit,
        page: 1,
        sort: [
          {
            field: 'orderDate',
            order: 'DESC',
          },
        ],
        filter: filters,
        includes: {
          order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'stateMachineState'],
          state_machine_state: ['technicalName'],
        },
        associations: {
          stateMachineState: {},
        },
      };

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch customer order history: ${response.statusText} - ${errorText}`);
        return [];
      }

      const data = await response.json();
      const orders = data.data || [];

      console.log(`[fetchCustomerOrderHistory] Found ${orders.length} orders for customer ${customerEmail}`);

      return orders.map((order: any) => {
        const status = this.mapShopwareStatus(order.stateMachineState?.technicalName || 'open');
        return {
          id: order.id,
          orderNumber: order.orderNumber || 'N/A',
          orderDate: order.orderDate || new Date().toISOString(),
          totalAmount: order.amountTotal || 0,
          status,
        };
      });
    } catch (error) {
      console.error('Error fetching customer order history from Shopware:', error);
      return [];
    }
  }

  /**
   * Fetch a single order by ID with optional sales channel access enforcement
   * Uses the same filtering logic as fetchOrders for consistency
   * @param orderId The order ID to fetch
   * @param salesChannelIds Optional array of allowed sales channel IDs (null = all access)
   * @returns The order or null if not found/access denied
   */
  async fetchOrderById(orderId: string, salesChannelIds?: string[] | null): Promise<Order | null> {
    try {
      // SECURITY: Explicitly handle undefined - treat as an error condition
      // undefined should not occur if called correctly, but if it does, deny access
      if (salesChannelIds === undefined) {
        console.error(`[fetchOrderById] SECURITY: Received undefined salesChannelIds, denying access`);
        return null;
      }

      // Build filter array
      const filters: any[] = [
        {
          type: 'equals',
          field: 'id',
          value: orderId,
        },
      ];

      // Add sales channel filter if provided (for access control)
      // null = full access (admin), [] = no access (should be caught at route level), [...ids] = specific channels
      if (salesChannelIds !== null && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'salesChannelId',
          value: salesChannelIds,
        });
        console.log(`[fetchOrderById] SECURITY: Filtering by sales channels:`, salesChannelIds);
      } else if (salesChannelIds !== null && salesChannelIds.length === 0) {
        // Empty array means no access - this should be caught at route level but double-check here
        console.error(`[fetchOrderById] SECURITY: Empty salesChannelIds array, denying access`);
        return null;
      }

      const requestBody: any = {
        limit: 1,
        filter: filters,
        includes: {
          order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries', 'documents'],
          order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
          order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'referencedId', 'type', 'payload', 'productNumber'],
          state_machine_state: ['technicalName'],
          sales_channel: ['id', 'name'],
          order_transaction: ['stateMachineState', 'paymentMethod'],
          payment_method: ['name', 'translated'],
          order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
          order_delivery: ['shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest', 'shippingMethod'],
          shipping_method: ['name', 'translated'],
          document: ['id', 'documentTypeId', 'createdAt', 'documentNumber', 'sent'],
          document_type: ['id', 'technicalName'],
        },
        associations: {
          orderCustomer: {},
          lineItems: {},
          stateMachineState: {},
          salesChannel: {},
          billingAddress: {},
          deliveries: {
            associations: {
              shippingOrderAddress: {},
              shippingMethod: {},
            },
          },
          transactions: {
            limit: 10,
            sort: [{ field: 'createdAt', order: 'DESC' }],
            associations: {
              stateMachineState: {},
              paymentMethod: {},
            },
          },
          documents: {
            associations: {
              documentType: {},
            },
          },
        },
      };

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch order by ID: ${response.statusText} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      const orders = data.data || [];
      const included = data.included || [];

      if (orders.length === 0) {
        console.log(`[fetchOrderById] Order ${orderId} not found or access denied`);
        return null;
      }

      const shopwareOrder = orders[0];
      const includedMap = new Map<string, any>();
      included.forEach((item: any) => {
        includedMap.set(`${item.type}-${item.id}`, item);
      });

      // Transform the Shopware order to our Order type (aligned with fetchOrders/fetchOrdersPaginated)
      // Get customer data
      let customerName = 'Unknown Customer';
      let customerEmail = '';
      let customerPhone = '';
      
      if (shopwareOrder.orderCustomer) {
        const customer = shopwareOrder.orderCustomer;
        customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
        customerEmail = customer.email || '';
      } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
        const customerId = shopwareOrder.relationships.orderCustomer.data.id;
        const customer = includedMap.get(`order_customer-${customerId}`);
        if (customer?.attributes) {
          customerName =
            `${customer.attributes.firstName || ''} ${customer.attributes.lastName || ''}`.trim() || 'Unknown Customer';
          customerEmail = customer.attributes.email || '';
        }
      }

      const customerNumber = extractShopwareOrderCustomerNumber(shopwareOrder, includedMap);

      // Get billing address
      let billingAddress = undefined;
      if (shopwareOrder.billingAddress) {
        const addr = shopwareOrder.billingAddress;
        billingAddress = {
          firstName: addr.firstName || '',
          lastName: addr.lastName || '',
          street: addr.street || '',
          zipCode: addr.zipcode || '',
          city: addr.city || '',
          country: addr.country?.name || '',
          company: addr.company,
          phoneNumber: addr.phoneNumber,
        };
        if (addr.phoneNumber) {
          customerPhone = addr.phoneNumber;
        }
      } else if (shopwareOrder.relationships?.billingAddress?.data?.id) {
        const addrId = shopwareOrder.relationships.billingAddress.data.id;
        const addr = includedMap.get(`order_address-${addrId}`);
        if (addr?.attributes) {
          billingAddress = {
            firstName: addr.attributes.firstName || '',
            lastName: addr.attributes.lastName || '',
            street: addr.attributes.street || '',
            zipCode: addr.attributes.zipcode || '',
            city: addr.attributes.city || '',
            country: addr.attributes.country?.name || '',
            company: addr.attributes.company,
            phoneNumber: addr.attributes.phoneNumber,
          };
          if (addr.attributes.phoneNumber) {
            customerPhone = addr.attributes.phoneNumber;
          }
        }
      }
      
      // Get shipping address and delivery info (letzte Lieferung, da in Shopware oft mehrere)
      let shippingAddress = undefined;
      let deliveryDateEarliest: string | undefined;
      let deliveryDateLatest: string | undefined;
      let shippingMethod: string | undefined;
      
      if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
        const delivery = getLatestDelivery(shopwareOrder.deliveries);
        if (delivery.shippingDateEarliest) deliveryDateEarliest = delivery.shippingDateEarliest;
        if (delivery.shippingDateLatest) deliveryDateLatest = delivery.shippingDateLatest;
        if (delivery.shippingMethod?.translated?.name || delivery.shippingMethod?.name) {
          shippingMethod = delivery.shippingMethod.translated?.name || delivery.shippingMethod.name;
        }
        if (delivery.shippingOrderAddress) {
          const addr = delivery.shippingOrderAddress;
          shippingAddress = {
            firstName: addr.firstName || '',
            lastName: addr.lastName || '',
            street: addr.street || '',
            zipCode: addr.zipcode || '',
            city: addr.city || '',
            country: addr.country?.name || '',
            company: addr.company,
            phoneNumber: addr.phoneNumber,
          };
        }
      }
      
      // Map line items (aligned with fetchOrders: price, netPrice, total, netTotal, taxRate)
      const mapLineItem = (item: any): OrderItem => {
        const attrs = item.attributes || item;
        const netPrice = attrs.unitPrice || 0;
        const netTotal = attrs.totalPrice || 0;
        const quantity = attrs.quantity || 1;
        const taxRate = attrs.price?.taxRules?.[0]?.taxRate || 19;
        let grossPrice = netPrice;
        let grossTotal = netTotal;
        const priceObj = attrs.price;
        if (priceObj && typeof priceObj === 'object') {
          if (priceObj.calculatedTaxes && Array.isArray(priceObj.calculatedTaxes) && priceObj.calculatedTaxes.length > 0) {
            const totalTax = priceObj.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
            const unitTax = quantity > 0 ? totalTax / quantity : 0;
            grossPrice = netPrice + unitTax;
            grossTotal = netTotal + totalTax;
          } else {
            grossPrice = netPrice * (1 + taxRate / 100);
            grossTotal = netTotal * (1 + taxRate / 100);
          }
        }
        return {
          id: item.id || attrs.id,
          name: attrs.label || 'Unknown Product',
          quantity,
          price: grossPrice,
          netPrice,
          total: grossTotal,
          netTotal,
          taxRate,
        };
      };
      let lineItemsRaw: any[] = shopwareOrder.lineItems || [];
      if (lineItemsRaw.length === 0 && shopwareOrder.relationships?.lineItems?.data) {
        const refs = Array.isArray(shopwareOrder.relationships.lineItems.data)
          ? shopwareOrder.relationships.lineItems.data
          : [shopwareOrder.relationships.lineItems.data];
        lineItemsRaw = refs.map((ref: any) =>
          includedMap.get(`order_line_item-${ref.id}`) || ref
        ).filter(Boolean);
      }
      const items: OrderItem[] = lineItemsRaw.map(mapLineItem);
      
      // Get payment method and status
      let paymentMethod: string | undefined;
      let paymentStatus = 'open';
      if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
        const transaction = shopwareOrder.transactions[0];
        if (transaction.paymentMethod?.translated?.name || transaction.paymentMethod?.name) {
          paymentMethod = transaction.paymentMethod.translated?.name || transaction.paymentMethod.name;
        }
        if (transaction.stateMachineState?.technicalName) {
          paymentStatus = this.mapPaymentStatus(transaction.stateMachineState.technicalName);
        }
      }
      
      // Get sales channel
      let salesChannelName = 'Unknown Channel';
      if (shopwareOrder.salesChannel?.name) {
        salesChannelName = shopwareOrder.salesChannel.name;
      }
      
      // Map order status
      const status = this.mapShopwareStatus(shopwareOrder.stateMachineState?.technicalName || 'open');

      // Extract ERP document numbers (custom_order_numbers_* first, fallback to meta_erp_* / jtl_*)
      const customFields = shopwareOrder.customFields || {};
      const erpOrderNumber = customFields.custom_order_numbers_order
        || customFields.meta_erp_order_number
        || customFields.jtl_order_number;
      const erpDeliveryNoteNumber = customFields.custom_order_numbers_deliveryNo
        || customFields.meta_erp_delivery_note_number;
      const erpInvoiceNumber = customFields.custom_order_numbers_invoice
        || customFields.meta_erp_invoice_number
        || customFields.jtl_invoice_number;
      const proformaNumber = customFields.custom_order_proforma_number;
      const vorkasseInvoiceNumber = customFields.custom_order_numbers_vorkasse;

      // Extract invoice date from documents (Invoice created at)
      const invoiceDate = this.extractInvoiceDateFromDocuments(shopwareOrder, includedMap);
      let invoiceInfo = this.extractInvoiceInfoFromDocuments(shopwareOrder, includedMap);
      // documents-Association liefert in Einzelabfragen oft unvollstaendig — wie in fetchOrders nachladen.
      if (!invoiceInfo.hasInvoice) {
        try {
          const batch = await this.fetchInvoiceInfoByOrderIds([shopwareOrder.id]);
          const info = batch.get(shopwareOrder.id);
          if (info && info.count > 0) {
            invoiceInfo = { hasInvoice: true, count: info.count, sent: info.sent };
          }
        } catch (fallbackErr) {
          console.warn(
            `[fetchOrderById] invoice info fallback failed for ${shopwareOrder.id}:`,
            fallbackErr,
          );
        }
      }

      const order: Order = {
        id: shopwareOrder.id,
        orderNumber: shopwareOrder.orderNumber || 'N/A',
        customerNumber: customerNumber || undefined,
        orderDate: shopwareOrder.orderDate || new Date().toISOString(),
        customerName,
        customerEmail,
        customerPhone,
        status: status as any,
        paymentStatus: paymentStatus as any,
        paymentMethod,
        shippingMethod,
        totalAmount: shopwareOrder.amountTotal || 0,
        netTotalAmount: shopwareOrder.amountNet || 0,
        items,
        salesChannelId: shopwareOrder.salesChannelId,
        salesChannelName,
        billingAddress,
        shippingAddress,
        deliveryDateEarliest,
        deliveryDateLatest,
        erpNumber: erpOrderNumber,
        deliveryNoteNumber: erpDeliveryNoteNumber,
        invoiceNumber: erpInvoiceNumber,
        proformaNumber,
        vorkasseInvoiceNumber,
        invoiceDate,
        hasInvoiceDocument: invoiceInfo.hasInvoice,
        invoiceDocumentCount: invoiceInfo.count,
        invoiceSent: invoiceInfo.sent,
        isPaymentOverdue: this.isPaymentOverdue(invoiceDate, paymentStatus as PaymentStatus),
        customFields: shopwareOrder.customFields || undefined,
        customerComment: shopwareOrder.customerComment || undefined,
      };
      
      return order;
    } catch (error) {
      console.error('Error fetching order by ID from Shopware:', error);
      return null;
    }
  }

  async fetchOrderByNumber(orderNumber: string, salesChannelIds?: string[] | null): Promise<{ id: string; orderNumber: string } | null> {
    try {
      // SECURITY: Explicitly handle undefined - treat as an error condition
      if (salesChannelIds === undefined) {
        console.error(`[fetchOrderByNumber] SECURITY: Received undefined salesChannelIds, denying access`);
        return null;
      }

      const normalizedOrderNumber = orderNumber?.trim();
      if (!normalizedOrderNumber) {
        return null;
      }

      const filters: any[] = [
        {
          type: 'equals',
          field: 'orderNumber',
          value: normalizedOrderNumber,
        },
      ];

      // Add sales channel filter if provided (for access control)
      // null = full access (admin), [] = no access, [...ids] = specific channels
      if (salesChannelIds !== null && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'salesChannelId',
          value: salesChannelIds,
        });
        console.log(`[fetchOrderByNumber] SECURITY: Filtering by sales channels:`, salesChannelIds);
      } else if (salesChannelIds !== null && salesChannelIds.length === 0) {
        console.error(`[fetchOrderByNumber] SECURITY: Empty salesChannelIds array, denying access`);
        return null;
      }

      const requestBody: any = {
        limit: 1,
        filter: filters,
        includes: {
          order: ['id', 'orderNumber'],
        },
      };

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`Failed to fetch order by order number: ${response.statusText} - ${errorText}`);
        return null;
      }

      const data = await response.json();
      const order = data.data?.[0];
      if (!order?.id) {
        return null;
      }

      return {
        id: order.id,
        orderNumber: order.orderNumber || order.attributes?.orderNumber || normalizedOrderNumber,
      };
    } catch (error) {
      console.error('Error fetching order by order number from Shopware:', error);
      return null;
    }
  }

  async downloadDocumentPdf(documentId: string, deepLinkCode: string): Promise<Blob> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/pdf',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to download document: ${response.statusText} - ${errorText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Error downloading document from Shopware:', error);
      throw error;
    }
  }

  async downloadDocumentPdfBuffer(documentId: string, deepLinkCode: string): Promise<Buffer> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/pdf',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to download document: ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Error downloading document from Shopware:', error);
      throw error;
    }
  }

  /**
   * Bestell-Brutto (amountTotal) für eine konkrete Order-Version (Dokument-Snapshot).
   */
  private async fetchOrderAmountTotalForVersion(
    orderId: string,
    orderVersionId: string,
  ): Promise<number | null> {
    const vid = orderVersionId?.trim();
    if (!vid) return null;
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}`,
        {
          method: 'GET',
          headers: {
            'Sw-Version-Id': vid,
          },
        },
      );
      if (!response.ok) {
        return null;
      }
      const json = await response.json();
      const entity = json.data;
      if (!entity) return null;
      const total =
        entity.amountTotal ?? entity.attributes?.amountTotal ?? null;
      if (typeof total === 'number' && Number.isFinite(total)) {
        return Math.round(total * 100) / 100;
      }
      return null;
    } catch {
      return null;
    }
  }

  async fetchOrderDocuments(orderId: string): Promise<OrderDocument[]> {
    try {
      // List documents for this order; request createdAt explicitly (Admin API document list)
      const docsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'orderId',
                value: orderId,
              },
            ],
            includes: {
              document: [
                'id',
                'documentTypeId',
                'documentNumber',
                'deepLinkCode',
                'createdAt',
                'orderVersionId',
                'sent',
              ],
              document_type: ['id', 'technicalName'],
            },
            associations: {
              documentType: {},
            },
          }),
        }
      );

      if (!docsResponse.ok) {
        const errorText = await docsResponse.text();
        throw new Error(`Failed to retrieve documents: ${docsResponse.statusText} - ${errorText}`);
      }

      const docsData = await docsResponse.json();
      const documents = docsData.data || [];
      const included = docsData.included || [];

      const documentTypes = new Map<string, string>();
      for (const inc of included) {
        if (inc?.type === "document_type" && inc.id) {
          documentTypes.set(inc.id, readEntityTechnicalName(inc));
        }
      }

      // Collect all unique document type IDs
      const documentTypeIds = new Set<string>();
      for (const doc of documents) {
        const tid =
          doc.documentTypeId ??
          doc.attributes?.documentTypeId ??
          doc.relationships?.documentType?.data?.id;
        if (tid) {
          documentTypeIds.add(tid);
        }
      }

      // Fetch document types in a batch request (JSON:API liefert technicalName oft nur unter attributes)
      if (documentTypeIds.size > 0) {
        const typeFilters = Array.from(documentTypeIds).map(id => ({
          type: 'equals',
          field: 'id',
          value: id,
        }));

        const typesResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/search/document-type`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filter: [
                {
                  type: 'multi',
                  operator: 'or',
                  queries: typeFilters,
                },
              ],
            }),
          }
        );

        if (typesResponse.ok) {
          const typesData = await typesResponse.json();
          for (const typeItem of typesData.data || []) {
            documentTypes.set(typeItem.id, readEntityTechnicalName(typeItem));
          }
        }
      }

      const typesWithOrderTotal = new Set([
        'invoice',
        'proforma_invoice',
        'vorkasse_invoice',
        'cancellation',
        'credit_note',
      ]);

      const versionAmountCache = new Map<string, number | null>();

      const rows: Array<OrderDocument & { orderVersionId: string | null }> = documents.map((doc: any) => {
        // Extract document number and deep link code from root level (Shopware 6 API)
        const docNumber = doc.documentNumber || doc.attributes?.documentNumber || '';
        // deepLinkCode is directly on the root object in Shopware 6
        const deepLink = doc.deepLinkCode || doc.attributes?.deepLinkCode || '';
        const orderVersionId =
          doc.orderVersionId ?? doc.attributes?.orderVersionId ?? null;

        // Get document type from documentTypeId or fallback to document number prefix
        let docType = 'unknown';
        const docTypeId =
          doc.documentTypeId ??
          doc.attributes?.documentTypeId ??
          doc.relationships?.documentType?.data?.id;
        if (docTypeId && documentTypes.has(docTypeId)) {
          docType = documentTypes.get(docTypeId) || 'unknown';
        } else if (docNumber) {
          // Fallback: determine type from document number prefix
          const n = docNumber.trim().toUpperCase();
          if (n.startsWith('RE-')) {
            docType = 'invoice';
          } else if (n.startsWith('VKRE')) {
            docType = 'vorkasse_invoice';
          } else if (n.startsWith('PF')) {
            docType = 'proforma_invoice';
          } else if (n.startsWith('LS-')) {
            docType = 'delivery_note';
          } else if (n.startsWith('GS-')) {
            docType = 'credit_note';
          } else if (n.startsWith('ST-')) {
            docType = 'cancellation';
          }
        }

        docType = normalizeOrderDocumentType(docType);

        return {
          id: doc.id,
          type: docType,
          number: docNumber,
          deepLinkCode: deepLink,
          createdAt: doc.createdAt || doc.attributes?.createdAt,
          sent: Boolean(doc.sent ?? doc.attributes?.sent ?? false),
          orderVersionId,
        };
      });

      return await Promise.all(
        rows.map(async (row) => {
          const { orderVersionId, ...rest } = row;
          let amountGross: number | null = null;
          if (
            orderVersionId &&
            typeof orderVersionId === 'string' &&
            typesWithOrderTotal.has(rest.type)
          ) {
            if (!versionAmountCache.has(orderVersionId)) {
              versionAmountCache.set(
                orderVersionId,
                await this.fetchOrderAmountTotalForVersion(orderId, orderVersionId),
              );
            }
            amountGross = versionAmountCache.get(orderVersionId) ?? null;
          }
          const out: OrderDocument = { ...rest };
          if (amountGross != null) {
            out.amountGross = amountGross;
          }
          return out;
        }),
      );
    } catch (error) {
      console.error('Error fetching documents from Shopware:', error);
      throw error;
    }
  }

  async downloadInvoicePdf(orderId: string): Promise<Blob> {
    try {
      // Step 1: Get existing invoice documents for this order
      const docsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'orderId',
                value: orderId,
              },
              {
                type: 'equals',
                field: 'documentType.technicalName',
                value: 'invoice',
              },
            ],
            limit: 1,
            associations: {
              documentMediaFile: {},
            },
          }),
        }
      );

      if (!docsResponse.ok) {
        const errorText = await docsResponse.text();
        throw new Error(`Failed to retrieve invoice document: ${docsResponse.statusText} - ${errorText}`);
      }

      const docsData = await docsResponse.json();
      if (!docsData.data || docsData.data.length === 0) {
        throw new Error('No invoice document found for this order. Please generate the invoice in Shopware first.');
      }

      const document = docsData.data[0];
      
      const documentId = document.id;
      // The deepLinkCode is in the extensions.foreignKeys object
      const foreignKeys = document.extensions?.foreignKeys;
      const deepLinkCode = foreignKeys?.deepLinkCode;

      console.log('Document ID:', documentId);
      console.log('Deep Link Code:', deepLinkCode);
      console.log('Foreign Keys object:', JSON.stringify(foreignKeys, null, 2));

      if (!documentId || !deepLinkCode) {
        console.error('Missing document fields - documentId:', documentId, 'deepLinkCode:', deepLinkCode);
        throw new Error(`Document ID or deep link code missing - documentId: ${documentId}, deepLinkCode: ${deepLinkCode}`);
      }

      console.log(`Downloading invoice: documentId=${documentId}, deepLinkCode=${deepLinkCode}`);

      // Step 2: Download the PDF using the correct Shopware 6 endpoint
      const downloadResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/pdf',
          },
        }
      );

      if (!downloadResponse.ok) {
        const errorText = await downloadResponse.text();
        throw new Error(`Failed to download invoice: ${downloadResponse.statusText} - ${errorText}`);
      }

      return await downloadResponse.blob();
    } catch (error) {
      console.error('Error downloading invoice from Shopware:', error);
      throw error;
    }
  }

  async fetchProducts(
    limit: number = 100, 
    page: number = 1, 
    search?: string, 
    categoryId?: string,
    showInactive: boolean = false,
    width?: number,
    height?: number,
    depth?: number,
    includeInactive: boolean = false,
    salesChannelIds?: string[],
    onlyWithVariants: boolean = false,
    includeVariantChildren: boolean = false,
    /** When set, load exactly this product UUID (cross-selling / rule engine). */
    productId?: string
  ): Promise<{ products: Product[], total: number }> {
    try {
      const requestBody: any = {
        limit,
        page,
        sort: [
          {
            field: 'productNumber',
            order: 'ASC',
          },
        ],
      };

      // Build filter array
      const filters: any[] = [];

      if (productId && String(productId).trim()) {
        filters.push({
          type: "equals",
          field: "id",
          value: String(productId).trim(),
        });
      }

      // Filter by active status
      if (showInactive) {
        // Admin only: Show only inactive products
        filters.push({
          type: 'equals',
          field: 'active',
          value: false,
        });
      } else if (includeInactive) {
        // Admin tools: Include both active and inactive products
        filters.push({
          type: 'multi',
          operator: 'OR',
          queries: [
            {
              type: 'equals',
              field: 'active',
              value: true,
            },
            {
              type: 'equals',
              field: 'active',
              value: false,
            },
          ],
        });
      } else {
        // Default: Show only active products
        filters.push({
          type: 'equals',
          field: 'active',
          value: true,
        });
      }

      // Filter by category if provided
      if (categoryId) {
        filters.push({
          type: 'equals',
          field: 'categoryIds',
          value: categoryId,
        });
      }

      // Filter by dimensions if provided
      if (width) {
        filters.push({
          type: 'equals',
          field: 'width',
          value: width,
        });
      }

      if (height) {
        filters.push({
          type: 'equals',
          field: 'height',
          value: height,
        });
      }

      if (depth) {
        filters.push({
          type: 'equals',
          field: 'length', // Shopware uses 'length' for depth
          value: depth,
        });
      }

      if (onlyWithVariants) {
        filters.push({
          type: "range",
          field: "childCount",
          parameters: {
            gte: 1,
          },
        });
      }

      if (salesChannelIds && salesChannelIds.length > 0) {
        filters.push({
          type: 'equalsAny',
          field: 'visibilities.salesChannelId',
          value: salesChannelIds,
        });
        requestBody.associations = {
          ...(requestBody.associations || {}),
          visibilities: {},
        };
      }

      // Set the filters array
      requestBody.filter = filters;

      // Add search term if provided
      if (search && search.trim()) {
        requestBody.term = search.trim();
      }

      const productIncludesList = [
        "id",
        "productNumber",
        "name",
        "description",
        "price",
        "stock",
        "available",
        "manufacturerNumber",
        "ean",
        "weight",
        "width",
        "height",
        "length",
        "packagingUnit",
        "minPurchase",
        "maxPurchase",
        "purchaseUnit",
        "deliveryTimeId",
        "customFields",
        "createdAt",
        "updatedAt",
        "active",
        "manufacturer",
        "categories",
        "cover",
        "tax",
        "prices",
        "properties",
        "parentId",
        "childCount",
      ];

      const fetchAssociations: Record<string, unknown> = {
        manufacturer: {},
        categories: {},
        cover: {
          associations: {
            media: {},
          },
        },
        media: {
          associations: {
            media: {},
          },
        },
        visibilities: {},
        deliveryTime: {},
        tax: {},
        prices: {},
        properties: {
          associations: {
            group: {},
          },
        },
      };
      if (includeVariantChildren) {
        fetchAssociations.children = {
          associations: {
            options: { associations: { group: {} } },
            tax: {},
            prices: {},
          },
        };
      }

      console.log(
        `[fetchProducts] Requesting products - page: ${page}, limit: ${limit}, search: ${search || "none"}, category: ${categoryId || "all"}, showInactive: ${showInactive}, width: ${width || "any"}, height: ${height || "any"}, depth: ${depth || "any"}, onlyWithVariants: ${onlyWithVariants}, includeVariantChildren: ${includeVariantChildren}`
      );
      console.log(`[fetchProducts] Request body filter:`, JSON.stringify(requestBody.filter, null, 2));

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...requestBody,
          includes: {
            product: productIncludesList,
            product_manufacturer: ["name"],
            category: ["name"],
            product_media: ["media"],
            media: ["url"],
            tax: ["taxRate"],
            product_price: ["quantityStart", "quantityEnd", "price"],
            property_group_option: ["name", "group"],
            property_group: ["name"],
            product_visibility: ["id", "salesChannelId"],
          },
          associations: fetchAssociations,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch products: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const shopwareProducts = data.data || [];
      const total = data.total ?? data.meta?.total ?? shopwareProducts.length;
      
      console.log(`[fetchProducts] Shopware API response - returned: ${shopwareProducts.length}, total in DB: ${total}`);
      console.log(`[fetchProducts] Meta object:`, JSON.stringify(data.meta, null, 2));

      // Build a map of included entities
      const includedMap = new Map<string, any>();
      if (data.included) {
        data.included.forEach((item: any) => {
          const key = `${item.type}-${item.id}`;
          includedMap.set(key, item);
          if (item.type === "product" && item.id) {
            const compactId = String(item.id).replace(/-/g, "");
            if (compactId !== item.id) {
              includedMap.set(`product-${compactId}`, item);
            }
          }
        });
      }

      const products: Product[] = shopwareProducts.map((sp: any, index: number) => {
        // Get manufacturer name
        let manufacturerName = '';
        if (sp.manufacturer?.name) {
          manufacturerName = sp.manufacturer.name;
        } else if (sp.relationships?.manufacturer?.data?.id) {
          const manufacturer = includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`);
          manufacturerName = manufacturer?.attributes?.name || '';
        }

        // Get categories
        const categoryNames: string[] = [];
        if (sp.categories) {
          categoryNames.push(...sp.categories.map((cat: any) => cat.name || '').filter(Boolean));
        } else if (sp.relationships?.categories?.data) {
          sp.relationships.categories.data.forEach((catRef: any) => {
            const category = includedMap.get(`category-${catRef.id}`);
            if (category?.attributes?.name) {
              categoryNames.push(category.attributes.name);
            }
          });
        }

        // Get cover image
        let imageUrl = '';
        if (sp.cover?.media?.url) {
          imageUrl = this.resolveMediaUrl(sp.cover.media.url);
        } else if (sp.relationships?.cover?.data?.id) {
          const coverMedia = includedMap.get(`product_media-${sp.relationships.cover.data.id}`);
          if (coverMedia?.relationships?.media?.data?.id) {
            const media = includedMap.get(`media-${coverMedia.relationships.media.data.id}`);
            imageUrl = this.resolveMediaUrl(media?.attributes?.url || '');
          }
        }

        // Get properties (Eigenschaften)
        const properties: Array<{ groupName: string; optionName: string }> = [];
        if (sp.properties && Array.isArray(sp.properties)) {
          sp.properties.forEach((prop: any) => {
            const groupName = prop.group?.name || prop.groupName || '';
            const optionName = prop.name || prop.optionName || '';
            if (groupName && optionName) {
              properties.push({ groupName, optionName });
            }
          });
        } else if (sp.relationships?.properties?.data) {
          sp.relationships.properties.data.forEach((propRef: any) => {
            const prop = includedMap.get(`property_group_option-${propRef.id}`);
            if (prop) {
              const optionName = prop.attributes?.name || prop.name || '';
              let groupName = '';
              if (prop.group?.name) {
                groupName = prop.group.name;
              } else if (prop.relationships?.group?.data?.id) {
                const group = includedMap.get(`property_group-${prop.relationships.group.data.id}`);
                groupName = group?.attributes?.name || group?.name || '';
              }
              if (groupName && optionName) {
                properties.push({ groupName, optionName });
              }
            }
          });
        }

        // Get tax rate
        let taxRate = 19; // Default
        if (sp.tax?.taxRate) {
          taxRate = sp.tax.taxRate;
        } else if (sp.relationships?.tax?.data?.id) {
          const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
          taxRate = tax?.attributes?.taxRate || 19;
        }

        // Get price - Shopware stores prices in a complex structure with both gross and net
        let price = 0; // Gross price
        let netPrice = 0;
        if (sp.price && Array.isArray(sp.price)) {
          // Price is an array with currency-specific prices
          const eurPrice = sp.price.find((p: any) => p.currencyId || true); // Take first price
          if (eurPrice) {
            price = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            // Fallback calculation if net price is missing
            if (!netPrice && price) {
              netPrice = price / (1 + taxRate / 100);
            }
          }
        } else if (sp.attributes?.price && Array.isArray(sp.attributes.price)) {
          const eurPrice = sp.attributes.price.find((p: any) => p.currencyId || true);
          if (eurPrice) {
            price = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            if (!netPrice && price) {
              netPrice = price / (1 + taxRate / 100);
            }
          }
        }

        // Get graduated prices for CPQ
        const priceRules: ProductPriceRule[] = [];
        if (sp.prices && Array.isArray(sp.prices)) {
          sp.prices.forEach((priceRule: any) => {
            const quantityStart = priceRule.quantityStart || 1;
            const priceObj = priceRule.price?.[0];
            const rulePrice = priceObj?.gross || 0;
            const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
            priceRules.push({
              quantity: quantityStart,
              price: rulePrice,
              netPrice: ruleNetPrice,
            });
          });
        } else if (sp.relationships?.prices?.data) {
          sp.relationships.prices.data.forEach((priceRef: any) => {
            const priceRule = includedMap.get(`product_price-${priceRef.id}`);
            if (priceRule) {
              const quantityStart = priceRule.attributes?.quantityStart || 1;
              const priceObj = priceRule.attributes?.price?.[0];
              const rulePrice = priceObj?.gross || 0;
              const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
              priceRules.push({
                quantity: quantityStart,
                price: rulePrice,
                netPrice: ruleNetPrice,
              });
            }
          });
        }

        const visibilityCount = Array.isArray(sp.relationships?.visibilities?.data)
          ? sp.relationships.visibilities.data.length
          : Array.isArray(sp.visibilities)
            ? sp.visibilities.length
            : 0;
        const hasDeliveryTime = Boolean(
          sp.deliveryTimeId ||
            sp.attributes?.deliveryTimeId ||
            sp.relationships?.deliveryTime?.data?.id
        );
        const mediaCount = Array.isArray(sp.relationships?.media?.data)
          ? sp.relationships.media.data.length
          : Array.isArray(sp.media)
            ? sp.media.length
            : 0;
        const imageCount = (imageUrl ? 1 : 0) + mediaCount;
        const criteriaCount = 13;
        let points = 0;
        if (sp.productNumber || sp.attributes?.productNumber) points += 1;
        if (sp.manufacturerNumber || sp.attributes?.manufacturerNumber) points += 1;
        if (sp.ean || sp.attributes?.ean) points += 1;
        if (sp.description || sp.attributes?.description) points += 1;
        if (properties.length > 2) points += 1;
        if (hasDeliveryTime) points += 1;
        if (visibilityCount > 0) points += 1;
        if (categoryNames.length > 0) points += 1;
        if (imageCount > 0) points += 1;
        if (sp.width || sp.attributes?.width) points += 1;
        if (sp.height || sp.attributes?.height) points += 1;
        if (sp.length || sp.attributes?.length) points += 1;
        if (sp.weight || sp.attributes?.weight) points += 1;
        const dataQualityScore = Math.round((points / criteriaCount) * 100);

        const childCountRaw = sp.childCount ?? sp.attributes?.childCount;
        const parentIdRaw = sp.parentId ?? sp.attributes?.parentId;

        const customFields = (sp.customFields || sp.attributes?.customFields) as Record<string, unknown> | undefined;
        const sapProductNumber = extractSapProductNumberFromCustomFields(customFields);

        const product: Product = {
          id: sp.id,
          productNumber: sp.productNumber || sp.attributes?.productNumber || '',
          name: sp.name || sp.attributes?.name || 'Unknown Product',
          description: sp.description || sp.attributes?.description,
          price,
          netPrice,
          currency: 'EUR',
          taxRate,
          stock: sp.stock || sp.attributes?.stock || 0,
          available: sp.available !== undefined ? sp.available : (sp.attributes?.available || false),
        active: sp.active !== undefined ? sp.active : (sp.attributes?.active ?? undefined),
          manufacturerName,
          manufacturerNumber: sp.manufacturerNumber || sp.attributes?.manufacturerNumber,
          sapProductNumber: sapProductNumber || undefined,
          categoryNames: categoryNames.length > 0 ? categoryNames : undefined,
          imageUrl: imageUrl || undefined,
          ean: sp.ean || sp.attributes?.ean,
          weight: sp.weight || sp.attributes?.weight,
          dataQualityScore,
          packagingUnit: sp.packagingUnit || sp.attributes?.packagingUnit || sp.purchaseUnit || sp.attributes?.purchaseUnit,
          minOrderQuantity: sp.minPurchase || sp.attributes?.minPurchase,
          maxOrderQuantity: sp.maxPurchase || sp.attributes?.maxPurchase,
          priceRules: priceRules.length > 0 ? priceRules : undefined,
          customFields,
          properties: properties.length > 0 ? properties : undefined,
          createdAt: sp.createdAt || sp.attributes?.createdAt,
          updatedAt: sp.updatedAt || sp.attributes?.updatedAt,
        };

        // Add dimensions if available (Shopware 6.7: Felder können unter attributes liegen)
        const width = sp.width ?? sp.attributes?.width;
        const height = sp.height ?? sp.attributes?.height;
        const length = sp.length ?? sp.attributes?.length;
        if (width != null || height != null || length != null) {
          product.dimensions = {
            width,
            height,
            length,
            unit: 'mm',
          };
        } else {
          // Fallback: Maße aus Produktname parsen (z.B. "Steckrahmen 2000 x 600", "Boden 1000 x 600")
          const parsed = parseDimensionsFromProductName(product.name);
          if (parsed) {
            product.dimensions = parsed;
          }
        }

        if (childCountRaw != null && childCountRaw !== "" && !Number.isNaN(Number(childCountRaw))) {
          product.childCount = Number(childCountRaw);
        }
        if (parentIdRaw !== undefined) {
          product.parentId =
            parentIdRaw == null || parentIdRaw === "" ? null : String(parentIdRaw);
        }

        if (includeVariantChildren) {
          const rawChildren = resolveShopwareChildProducts(sp, includedMap);
          if (rawChildren.length > 0) {
            product.variants = rawChildren.map((raw) =>
              mapChildToProductVariant(raw, includedMap, taxRate)
            );
          }
        }

        return product;
      });

      return { products, total };
    } catch (error) {
      console.error('Error fetching products from Shopware:', error);
      throw error;
    }
  }

  /**
   * Lädt eine Seite Produkte mit allen für die Produkt-Übersicht relevanten Infos:
   * Verkaufskanal-Zuordnungen (visibilities), erweiterte/Staffel-Preise (prices),
   * Kategorien, Customfields, Eigenschaften, Steuer, Lagerbestand u. v. m.
   * Die salesChannelIds werden zurückgegeben; die Namensauflösung erfolgt im Aufrufer.
   */
  async fetchProductsOverviewPage(
    limit: number,
    page: number,
    options?: { includeInactive?: boolean; salesChannelIds?: string[] },
  ): Promise<{ products: ShopwareProductOverview[]; total: number }> {
    const includeInactive = options?.includeInactive ?? true;

    const requestBody: any = {
      limit,
      page,
      "total-count-mode": 1,
      sort: [{ field: "productNumber", order: "ASC" }],
      filter: [],
      includes: {
        product: [
          "id",
          "productNumber",
          "name",
          "active",
          "stock",
          "available",
          "ean",
          "manufacturerNumber",
          "manufacturer",
          "price",
          "purchasePrices",
          "customFields",
          "tax",
          "categories",
          "prices",
          "visibilities",
          "properties",
          "parentId",
          "childCount",
          "createdAt",
          "updatedAt",
        ],
        product_manufacturer: ["name"],
        category: ["id", "name"],
        tax: ["taxRate"],
        product_price: ["quantityStart", "quantityEnd", "price", "ruleId"],
        product_visibility: ["id", "salesChannelId", "visibility"],
        property_group_option: ["id"],
      },
      associations: {
        manufacturer: {},
        categories: {},
        tax: {},
        prices: {},
        visibilities: {},
        properties: {},
      },
    };

    if (!includeInactive) {
      requestBody.filter.push({ type: "equals", field: "active", value: true });
    }

    if (options?.salesChannelIds && options.salesChannelIds.length > 0) {
      requestBody.filter.push({
        type: "equalsAny",
        field: "visibilities.salesChannelId",
        value: options.salesChannelIds,
      });
    }

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch products overview: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const total = data.total ?? data.meta?.total ?? (data.data || []).length;

    const includedMap = new Map<string, any>();
    if (Array.isArray(data.included)) {
      data.included.forEach((item: any) => includedMap.set(`${item.type}-${item.id}`, item));
    }

    const products: ShopwareProductOverview[] = (data.data || []).map((sp: any) => {
      const attributes = sp.attributes || sp;

      // Steuer
      let taxRate = 19;
      if (sp.tax?.taxRate != null) {
        taxRate = sp.tax.taxRate;
      } else if (sp.relationships?.tax?.data?.id) {
        const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
        taxRate = tax?.attributes?.taxRate ?? 19;
      }

      // Grundpreis (brutto/netto)
      let priceGross = 0;
      let priceNet = 0;
      const priceArray = Array.isArray(sp.price) ? sp.price : Array.isArray(attributes?.price) ? attributes.price : null;
      if (priceArray && priceArray.length > 0) {
        const first = priceArray[0];
        priceGross = first?.gross ?? 0;
        priceNet = first?.net ?? (priceGross && taxRate ? priceGross / (1 + taxRate / 100) : priceGross);
      }

      // Einkaufspreis (netto/brutto) aus purchasePrices
      let purchasePriceNet: number | null = null;
      let purchasePriceGross: number | null = null;
      const purchaseArray = Array.isArray(sp.purchasePrices)
        ? sp.purchasePrices
        : Array.isArray(attributes?.purchasePrices)
          ? attributes.purchasePrices
          : null;
      if (purchaseArray && purchaseArray.length > 0) {
        const first = purchaseArray[0];
        const net = typeof first?.net === "number" ? first.net : null;
        const gross = typeof first?.gross === "number" ? first.gross : null;
        purchasePriceGross = gross;
        purchasePriceNet = net ?? (gross != null && taxRate ? gross / (1 + taxRate / 100) : gross);
      }

      // Hersteller
      let manufacturerName: string | undefined;
      if (sp.manufacturer?.name) {
        manufacturerName = sp.manufacturer.name;
      } else if (sp.relationships?.manufacturer?.data?.id) {
        manufacturerName = includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`)?.attributes?.name;
      }

      // Kategorien (Namen)
      const categories: string[] = [];
      if (Array.isArray(sp.categories)) {
        sp.categories.forEach((c: any) => c?.name && categories.push(c.name));
      } else if (Array.isArray(sp.relationships?.categories?.data)) {
        sp.relationships.categories.data.forEach((ref: any) => {
          const name = includedMap.get(`category-${ref.id}`)?.attributes?.name;
          if (name) categories.push(name);
        });
      }

      // Verkaufskanäle (IDs aus visibilities)
      const salesChannelIds = new Set<string>();
      const visEntries = Array.isArray(sp.visibilities)
        ? sp.visibilities
        : Array.isArray(sp.relationships?.visibilities?.data)
          ? sp.relationships.visibilities.data.map((ref: any) => includedMap.get(`product_visibility-${ref.id}`)).filter(Boolean)
          : [];
      for (const v of visEntries) {
        const scId = v?.salesChannelId ?? v?.attributes?.salesChannelId;
        if (scId) salesChannelIds.add(scId);
      }

      // Erweiterte Preise / Staffelpreise (product.prices)
      const advancedPrices: ShopwareAdvancedPrice[] = [];
      const priceRuleEntries = Array.isArray(sp.prices)
        ? sp.prices
        : Array.isArray(sp.relationships?.prices?.data)
          ? sp.relationships.prices.data.map((ref: any) => includedMap.get(`product_price-${ref.id}`)).filter(Boolean)
          : [];
      for (const pr of priceRuleEntries) {
        const a = pr?.attributes || pr;
        const priceObj = Array.isArray(a?.price) ? a.price[0] : undefined;
        advancedPrices.push({
          quantityStart: a?.quantityStart ?? 1,
          quantityEnd: a?.quantityEnd ?? null,
          gross: priceObj?.gross ?? null,
          net: priceObj?.net ?? null,
          ruleId: a?.ruleId ?? null,
        });
      }

      // Eigenschaften zählen
      const propertyOptionIds = new Set<string>();
      if (Array.isArray(sp.properties)) {
        sp.properties.forEach((p: any) => p?.id && propertyOptionIds.add(p.id));
      } else if (Array.isArray(sp.relationships?.properties?.data)) {
        sp.relationships.properties.data.forEach((ref: any) => ref?.id && propertyOptionIds.add(ref.id));
      }

      const customFields = (sp.customFields || attributes?.customFields) as Record<string, unknown> | undefined;
      const childCountRaw = sp.childCount ?? attributes?.childCount;
      const parentIdRaw = sp.parentId ?? attributes?.parentId;

      return {
        id: sp.id,
        productNumber: sp.productNumber || attributes?.productNumber || "",
        name: sp.name || attributes?.name || "",
        active: sp.active !== undefined ? sp.active : attributes?.active ?? null,
        stock: sp.stock ?? attributes?.stock ?? null,
        ean: sp.ean || attributes?.ean || undefined,
        manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber || undefined,
        manufacturerName,
        priceGross,
        priceNet,
        purchasePriceNet,
        purchasePriceGross,
        taxRate,
        currency: "EUR",
        salesChannelIds: Array.from(salesChannelIds),
        advancedPrices,
        categories,
        customFields: customFields && typeof customFields === "object" ? customFields : undefined,
        propertyCount: propertyOptionIds.size,
        parentId: parentIdRaw == null || parentIdRaw === "" ? null : String(parentIdRaw),
        childCount: childCountRaw != null && !Number.isNaN(Number(childCountRaw)) ? Number(childCountRaw) : null,
        createdAt: sp.createdAt || attributes?.createdAt || undefined,
        updatedAt: sp.updatedAt || attributes?.updatedAt || undefined,
      } satisfies ShopwareProductOverview;
    });

    return { products, total };
  }

  /**
   * Einmaliger Abgleich gegen EAN, productNumber und manufacturerNumber — inkl. inaktiver Produkte.
   * Für Commercial-Drafts, wenn der aktive Katalog-Cache keinen Treffer liefert.
   */
  async searchProductsByIdentifiersIncludeInactive(identifiers: string[]): Promise<Product[]> {
    const uniq = [...new Set(identifiers.map((s) => String(s).trim()).filter(Boolean))].slice(0, 12);
    if (uniq.length === 0) return [];

    const idQueries = uniq.flatMap((id) => [
      { type: "equals", field: "ean", value: id },
      { type: "equals", field: "productNumber", value: id },
      { type: "equals", field: "manufacturerNumber", value: id },
    ]);
    const queries = idQueries.slice(0, 36);

    const requestBody: any = {
      limit: 25,
      page: 1,
      filter: [
        {
          type: "multi",
          operator: "OR",
          queries,
        },
        {
          type: "multi",
          operator: "OR",
          queries: [
            { type: "equals", field: "active", value: true },
            { type: "equals", field: "active", value: false },
          ],
        },
      ],
    };

    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...requestBody,
          includes: {
            product: [
              "id",
              "productNumber",
              "name",
              "price",
              "manufacturerNumber",
              "ean",
              "customFields",
              "active",
              "tax",
            ],
            tax: ["taxRate"],
          },
          associations: {
            tax: {},
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`searchProductsByIdentifiersIncludeInactive: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const shopwareProducts = data.data || [];
      const includedMap = new Map<string, any>();
      if (data.included) {
        data.included.forEach((item: any) => {
          includedMap.set(`${item.type}-${item.id}`, item);
        });
      }

      return shopwareProducts.map((sp: any) => {
        let taxRate = 19;
        if (sp.tax?.taxRate) {
          taxRate = sp.tax.taxRate;
        } else if (sp.relationships?.tax?.data?.id) {
          const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
          taxRate = tax?.attributes?.taxRate || 19;
        }
        let price = 0;
        if (sp.price && Array.isArray(sp.price)) {
          const eurPrice = sp.price.find((p: any) => p.currencyId || true);
          if (eurPrice) price = eurPrice.gross || 0;
        } else if (sp.attributes?.price && Array.isArray(sp.attributes.price)) {
          const eurPrice = sp.attributes.price.find((p: any) => p.currencyId || true);
          if (eurPrice) price = eurPrice.gross || 0;
        }

        const netPrice = taxRate > 0 ? price / (1 + taxRate / 100) : price;
        const customFields = (sp.customFields || sp.attributes?.customFields) as Record<string, unknown> | undefined;
        const sapProductNumber = extractSapProductNumberFromCustomFields(customFields);
        return {
          id: sp.id,
          productNumber: sp.productNumber || sp.attributes?.productNumber || "",
          name: sp.name || sp.attributes?.name || "Unknown Product",
          description: sp.description || sp.attributes?.description,
          price,
          netPrice,
          currency: "EUR" as const,
          taxRate,
          stock: sp.stock || sp.attributes?.stock || 0,
          available: sp.available !== undefined ? sp.available : (sp.attributes?.available || false),
          active: sp.active !== undefined ? sp.active : (sp.attributes?.active ?? undefined),
          manufacturerNumber: sp.manufacturerNumber || sp.attributes?.manufacturerNumber,
          ean: sp.ean || sp.attributes?.ean,
          sapProductNumber: sapProductNumber || undefined,
          customFields,
        } satisfies Product;
      });
    } catch (e) {
      console.warn("[Shopware] searchProductsByIdentifiersIncludeInactive failed:", e);
      return [];
    }
  }

  async fetchProductsForDataQuality(
    limit: number = 200,
    page: number = 1,
    salesChannelIds?: string[],
    includeInactive: boolean = true
  ): Promise<{
    products: Array<{
      id: string;
      productNumber?: string;
      manufacturerNumber?: string;
      ean?: string;
      description?: string;
      propertyCount: number;
      hasDeliveryTime: boolean;
      categoryCount: number;
      visibilityCount: number;
      imageCount: number;
      width?: number;
      height?: number;
      length?: number;
      weight?: number;
    }>;
    total: number;
  }> {
    const requestBody: any = {
      limit,
      page,
      "total-count-mode": 1,
      sort: [
        {
          field: "productNumber",
          order: "ASC",
        },
      ],
      filter: [],
      includes: {
        product: [
          "id",
          "productNumber",
          "manufacturerNumber",
          "ean",
          "description",
          "properties",
          "options",
          "width",
          "height",
          "length",
          "weight",
          "deliveryTimeId",
        ],
        product_visibility: ["id", "salesChannelId"],
        product_media: ["id"],
        product_delivery_time: ["id"],
        category: ["id"],
      },
      associations: {
        categories: {},
        properties: {
          associations: {
            group: {},
          },
        },
        options: {
          associations: {
            group: {},
          },
        },
        visibilities: {},
        deliveryTime: {},
        cover: {
          associations: {
            media: {},
          },
        },
        media: {
          associations: {
            media: {},
          },
        },
      },
    };

    if (includeInactive) {
      requestBody.filter.push({
        type: "multi",
        operator: "OR",
        queries: [
          {
            type: "equals",
            field: "active",
            value: true,
          },
          {
            type: "equals",
            field: "active",
            value: false,
          },
        ],
      });
    } else {
      requestBody.filter.push({
        type: "equals",
        field: "active",
        value: true,
      });
    }

    if (salesChannelIds && salesChannelIds.length > 0) {
      requestBody.filter.push({
        type: "equalsAny",
        field: "visibilities.salesChannelId",
        value: salesChannelIds,
      });
    }

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch products for data quality: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const total = data.total ?? data.meta?.total ?? (data.data || []).length;

    const products = (data.data || []).map((sp: any) => {
      const attributes = sp.attributes || sp;
      const propertyOptionIds = new Set<string>();
      if (Array.isArray(sp.properties)) {
        sp.properties.forEach((prop: any) => prop?.id && propertyOptionIds.add(prop.id));
      }
      if (Array.isArray(sp.relationships?.properties?.data)) {
        sp.relationships.properties.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
      }
      if (Array.isArray(sp.options)) {
        sp.options.forEach((opt: any) => opt?.id && propertyOptionIds.add(opt.id));
      }
      if (Array.isArray(sp.relationships?.options?.data)) {
        sp.relationships.options.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
      }
      const propertiesCount = propertyOptionIds.size;
      const categoryCount = Array.isArray(sp.categories)
        ? sp.categories.length
        : Array.isArray(sp.relationships?.categories?.data)
          ? sp.relationships.categories.data.length
          : 0;
      const visibilityCount = Array.isArray(sp.visibilities)
        ? sp.visibilities.length
        : Array.isArray(sp.relationships?.visibilities?.data)
          ? sp.relationships.visibilities.data.length
          : 0;
      const mediaCount = Array.isArray(sp.media)
        ? sp.media.length
        : Array.isArray(sp.relationships?.media?.data)
          ? sp.relationships.media.data.length
          : 0;
      const hasCover = Boolean(sp.cover || sp.coverId || sp.relationships?.cover?.data?.id);
      const imageCount = (hasCover ? 1 : 0) + mediaCount;
      const hasDeliveryTime = Boolean(
        sp.deliveryTime ||
          sp.deliveryTimeId ||
          attributes?.deliveryTimeId ||
          sp.relationships?.deliveryTime?.data?.id
      );

      return {
        id: sp.id,
        productNumber: sp.productNumber || attributes?.productNumber,
        manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber,
        ean: sp.ean || attributes?.ean,
        description: sp.description || attributes?.description,
        propertyCount: propertiesCount,
        hasDeliveryTime,
        categoryCount,
        visibilityCount,
        imageCount,
        width: sp.width ?? attributes?.width,
        height: sp.height ?? attributes?.height,
        length: sp.length ?? attributes?.length,
        weight: sp.weight ?? attributes?.weight,
      };
    });

    return { products, total };
  }

  async fetchProductDataQuality(productId: string): Promise<{
    id: string;
    productNumber?: string;
    manufacturerNumber?: string;
    ean?: string;
    description?: string;
    propertyCount: number;
    hasDeliveryTime: boolean;
    categoryCount: number;
    visibilityCount: number;
    imageCount: number;
    width?: number;
    height?: number;
    length?: number;
    weight?: number;
  }> {
    const response = await this.searchEntity("product", {
      limit: 1,
      filter: [
        {
          type: "equals",
          field: "id",
          value: productId,
        },
      ],
      includes: {
        product: [
          "id",
          "productNumber",
          "manufacturerNumber",
          "ean",
          "description",
          "properties",
          "options",
          "width",
          "height",
          "length",
          "weight",
          "deliveryTimeId",
          "coverId",
        ],
        property_group_option: ["id", "name", "group"],
        property_group: ["id", "name"],
        product_visibility: ["id", "salesChannelId"],
        product_media: ["id"],
        product_delivery_time: ["id"],
        category: ["id"],
      },
      associations: {
        categories: {},
        properties: {
          associations: {
            group: {},
          },
        },
        options: {
          associations: {
            group: {},
          },
        },
        visibilities: {},
        deliveryTime: {},
        cover: {
          associations: {
            media: {},
          },
        },
        media: {
          associations: {
            media: {},
          },
        },
      },
    });

    const sp = response?.data?.[0];
    if (!sp) {
      throw new Error("Product not found");
    }

    const attributes = sp.attributes || sp;
    const propertyOptionIds = new Set<string>();
    if (Array.isArray(sp.properties)) {
      sp.properties.forEach((prop: any) => prop?.id && propertyOptionIds.add(prop.id));
    }
    if (Array.isArray(sp.relationships?.properties?.data)) {
      sp.relationships.properties.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
    }
    if (Array.isArray(sp.options)) {
      sp.options.forEach((opt: any) => opt?.id && propertyOptionIds.add(opt.id));
    }
    if (Array.isArray(sp.relationships?.options?.data)) {
      sp.relationships.options.data.forEach((entry: any) => entry?.id && propertyOptionIds.add(entry.id));
    }
    if (Array.isArray(response?.included)) {
      response.included.forEach((item: any) => {
        if (item.type === "property_group_option" && item.id) {
          propertyOptionIds.add(item.id);
        }
      });
    }
    const propertiesCount = propertyOptionIds.size;
    const categoryCount = Array.isArray(sp.categories)
      ? sp.categories.length
      : Array.isArray(sp.relationships?.categories?.data)
        ? sp.relationships.categories.data.length
        : 0;
    const visibilityCount = Array.isArray(sp.visibilities)
      ? sp.visibilities.length
      : Array.isArray(sp.relationships?.visibilities?.data)
        ? sp.relationships.visibilities.data.length
        : 0;
    const mediaCount = Array.isArray(sp.media)
      ? sp.media.length
      : Array.isArray(sp.relationships?.media?.data)
        ? sp.relationships.media.data.length
        : 0;
    const hasCover = Boolean(sp.cover || sp.coverId || sp.relationships?.cover?.data?.id);
    const imageCount = (hasCover ? 1 : 0) + mediaCount;
    const hasDeliveryTime = Boolean(
      sp.deliveryTime ||
        sp.deliveryTimeId ||
        attributes?.deliveryTimeId ||
        sp.relationships?.deliveryTime?.data?.id
    );

    return {
      id: sp.id,
      productNumber: sp.productNumber || attributes?.productNumber,
      manufacturerNumber: sp.manufacturerNumber || attributes?.manufacturerNumber,
      ean: sp.ean || attributes?.ean,
      description: sp.description || attributes?.description,
      propertyCount: propertiesCount,
      hasDeliveryTime,
      categoryCount,
      visibilityCount,
      imageCount,
      width: sp.width ?? attributes?.width,
      height: sp.height ?? attributes?.height,
      length: sp.length ?? attributes?.length,
      weight: sp.weight ?? attributes?.weight,
    };
  }

  async setProductActive(productId: string, active: boolean): Promise<void> {
    const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      body: JSON.stringify({
        "write-product": {
          entity: "product",
          action: "upsert",
          payload: [
            {
              id: productId,
              active,
            },
          ],
        },
      }),
    });

    if (syncResponse.ok) {
      return;
    }

    const syncError = await syncResponse.text();

    const jsonApiResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          id: productId,
          type: "product",
          attributes: {
            active,
          },
        },
      }),
    });

    if (jsonApiResponse.ok) {
      return;
    }

    const jsonApiError = await jsonApiResponse.text();

    // Fallback for older Shopware API behavior
    const legacyResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({ active }),
    });

    if (!legacyResponse.ok) {
      const legacyError = await legacyResponse.text();
      throw new Error(
        `Failed to update product status: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${jsonApiResponse.statusText} - ${jsonApiError} | Legacy: ${legacyResponse.statusText} - ${legacyError}`
      );
    }
  }

  /**
   * Paginiert alle Produkte (aktiv + inaktiv, inkl. Varianten) mit minimalem Payload fuer regulationPrice-Reset.
   */
  async *iterateAllProductsForPriceReset(
    pageSize = 500
  ): AsyncGenerator<ProductPriceResetRow, void, unknown> {
    let page = 1;

    while (true) {
      const data = await this.searchEntity("product", {
        limit: pageSize,
        page,
        "total-count-mode": "exact",
        includes: {
          product: ["id", "price"],
        },
      });

      const rows: any[] = data.data || [];
      for (const sp of rows) {
        const id = sp.id ?? sp.attributes?.id;
        if (!id) continue;
        const priceRaw = sp.price ?? sp.attributes?.price;
        const price = Array.isArray(priceRaw) ? (priceRaw as ShopwarePriceEntry[]) : [];
        yield { id: String(id), price };
      }

      if (rows.length < pageSize) {
        break;
      }

      const total = data.total ?? data.meta?.total;
      if (typeof total === "number" && page * pageSize >= total) {
        break;
      }

      page += 1;
    }
  }

  /** Setzt nur `price` per Sync-Upsert (z. B. regulationPrice auf null). */
  async bulkPatchProductPrices(payload: Array<{ id: string; price: ShopwarePriceEntry[] }>): Promise<void> {
    if (payload.length === 0) {
      return;
    }

    const syncPayload = payload.map((row) => ({
      id: toShopwareUuid(row.id),
      price: row.price,
    }));

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      body: JSON.stringify({
        "write-product-regulation-price-reset": {
          entity: "product",
          action: "upsert",
          payload: syncPayload,
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to bulk patch product prices: ${response.status} ${response.statusText} - ${errorText}`
      );
    }
  }

  /** GLB-Datei in Shopware Medien hochladen und dem Produkt zuordnen */
  async uploadProductGlbMedia(productId: string, glbBuffer: Buffer, filename: string): Promise<{ mediaId: string }> {
    const mediaId = toShopwareUuid(randomUUID());
    const productIdNorm = toShopwareUuid(productId);
    const baseFilename = filename.replace(/\.glb$/i, "").replace(/\?.*$/, "");

    const createRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/media`, {
      method: "POST",
      body: JSON.stringify({ id: mediaId }),
    });
    if (!createRes.ok) {
      const err = await createRes.text();
      throw new Error(`Media-Entity konnte nicht erstellt werden (${createRes.status}): ${err}`);
    }

    const token = await this.authenticate();
    const uploadUrl = `${this.baseUrl}/api/_action/media/${mediaId}/upload?extension=glb&fileName=${encodeURIComponent(baseFilename)}`;
    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "model/gltf-binary",
      },
      body: glbBuffer,
    });
    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      throw new Error(`GLB-Upload fehlgeschlagen (${uploadRes.status}): ${err}`);
    }

    const productMediaId = toShopwareUuid(randomUUID());
    const linkRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product-media`, {
      method: "POST",
      body: JSON.stringify({
        id: productMediaId,
        productId: productIdNorm,
        mediaId,
      }),
    });
    if (!linkRes.ok) {
      const err = await linkRes.text();
      const patchRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productIdNorm}`, {
        method: "PATCH",
        body: JSON.stringify({ coverId: mediaId }),
      });
      if (!patchRes.ok) {
        const patchErr = await patchRes.text();
        throw new Error(`Produkt-Medien-Verknüpfung fehlgeschlagen (${linkRes.status}): ${err}. Cover-Fallback (${patchRes.status}): ${patchErr}`);
      }
    }

    return { mediaId };
  }

  async fetchProductActiveStatus(productId: string): Promise<boolean | null> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch product: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    if (typeof data?.data?.attributes?.active === "boolean") {
      return data.data.attributes.active;
    }
    if (typeof data?.active === "boolean") {
      return data.active;
    }
    return null;
  }

  async fetchProductCategoryIds(productId: string): Promise<{ categoryIds: string[]; categoryNames: string[] }> {
    const response = await this.searchEntity("product", {
      limit: 1,
      filter: [
        {
          type: "equals",
          field: "id",
          value: productId,
        },
      ],
      associations: {
        categories: {},
      },
      includes: {
        product: ["id"],
        category: ["id", "name"],
      },
    });

    const product = response?.data?.[0];
    const relationshipIds = (product?.relationships?.categories?.data || []).map((entry: any) => entry.id);
    const includedCategories = (response?.included || []).filter((item: any) => item.type === "category");
    const categoryNames = includedCategories
      .filter((item: any) => relationshipIds.includes(item.id))
      .map((item: any) => item.attributes?.name || item.name)
      .filter(Boolean);

    return {
      categoryIds: relationshipIds,
      categoryNames,
    };
  }

  async setProductCategories(productId: string, categoryIds: string[]): Promise<void> {
    const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
      method: "POST",
      body: JSON.stringify({
        "write-product-categories": {
          entity: "product",
          action: "upsert",
          payload: [
            {
              id: productId,
              categories: categoryIds.map((id) => ({ id })),
            },
          ],
        },
      }),
    });

    if (syncResponse.ok) {
      return;
    }

    const syncError = await syncResponse.text();

    const jsonApiResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/vnd.api+json",
      },
      body: JSON.stringify({
        data: {
          id: productId,
          type: "product",
          relationships: {
            categories: {
              data: categoryIds.map((id) => ({ type: "category", id })),
            },
          },
        },
      }),
    });

    if (jsonApiResponse.ok) {
      return;
    }

    const jsonApiError = await jsonApiResponse.text();

    const legacyResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
      method: "PATCH",
      body: JSON.stringify({
        categories: categoryIds.map((id) => ({ id })),
        categoryIds,
      }),
    });

    if (!legacyResponse.ok) {
      const legacyError = await legacyResponse.text();
      throw new Error(
        `Failed to update product categories: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${jsonApiResponse.statusText} - ${jsonApiError} | Legacy: ${legacyResponse.statusText} - ${legacyError}`
      );
    }
  }

  async fetchProductSalesChannelIds(productId: string): Promise<{ salesChannelIds: string[] }> {
    try {
      const response = await this.searchEntity("product-visibility", {
        limit: 500,
        filter: [
          {
            type: "equals",
            field: "productId",
            value: productId,
          },
        ],
        includes: {
          product_visibility: ["id", "salesChannelId", "visibility"],
        },
      });

      const entries = response?.data || [];
      const salesChannelIds = entries
        .map((entry: any) => entry?.salesChannelId || entry?.attributes?.salesChannelId)
        .filter(Boolean);

      return { salesChannelIds };
    } catch (error) {
      console.warn("Failed to fetch product visibilities via product_visibility. Falling back:", error);
    }

    const productResponse = await this.searchEntity("product", {
      limit: 1,
      filter: [
        {
          type: "equals",
          field: "id",
          value: productId,
        },
      ],
      associations: {
        visibilities: {},
      },
      includes: {
        product: ["id"],
        product_visibility: ["id", "salesChannelId", "visibility"],
      },
    });

    const product = productResponse?.data?.[0];
    const visibilityIds = (product?.relationships?.visibilities?.data || []).map((entry: any) => entry.id);
    const includedVisibilities = (productResponse?.included || []).filter(
      (item: any) => item.type === "product_visibility"
    );
    const salesChannelIds = includedVisibilities
      .filter((item: any) => visibilityIds.includes(item.id))
      .map((item: any) => item.attributes?.salesChannelId || item.salesChannelId)
      .filter(Boolean);

    return { salesChannelIds };
  }

  async setProductSalesChannels(productId: string, salesChannelIds: string[]): Promise<void> {
    const desiredIds = Array.from(new Set(salesChannelIds));
    const visibility = 30;
    let currentEntries: Array<{ id?: string; salesChannelId?: string }> = [];

    try {
      const current = await this.searchEntity("product-visibility", {
        limit: 500,
        filter: [
          {
            type: "equals",
            field: "productId",
            value: productId,
          },
        ],
        includes: {
          product_visibility: ["id", "salesChannelId"],
        },
      });
      currentEntries = (current?.data || []).map((entry: any) => ({
        id: entry?.id,
        salesChannelId: entry?.salesChannelId || entry?.attributes?.salesChannelId,
      }));
    } catch (error) {
      console.warn("Failed to fetch existing product visibilities, continuing with upsert:", error);
    }

    const currentByChannel = new Map(
      currentEntries
        .filter((entry) => entry.salesChannelId)
        .map((entry) => [entry.salesChannelId as string, entry])
    );

    const upsertPayload = desiredIds.map((salesChannelId) => {
      const existing = currentByChannel.get(salesChannelId);
      const id = existing?.id || randomUUID().replace(/-/g, "");
      return {
        id,
        productId,
        salesChannelId,
        visibility,
      };
    });

    const deletePayload = currentEntries
      .filter((entry) => entry.salesChannelId && !desiredIds.includes(entry.salesChannelId))
      .filter((entry) => entry.id)
      .map((entry) => ({ id: entry.id }));

    const syncPayload: Record<string, any> = {};
    if (upsertPayload.length > 0) {
      syncPayload["upsert-product-visibility"] = {
        entity: "product_visibility",
        action: "upsert",
        payload: upsertPayload,
      };
    }
    if (deletePayload.length > 0) {
      syncPayload["delete-product-visibility"] = {
        entity: "product_visibility",
        action: "delete",
        payload: deletePayload,
      };
    }

    if (Object.keys(syncPayload).length > 0) {
      const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
        method: "POST",
        body: JSON.stringify(syncPayload),
      });

      if (syncResponse.ok) {
        return;
      }

      const syncError = await syncResponse.text();
      // Fallback to product PATCH with visibilities
      const patchResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/product/${productId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/vnd.api+json",
        },
        body: JSON.stringify({
          data: {
            id: productId,
            type: "product",
            attributes: {
              visibilities: desiredIds.map((salesChannelId) => ({
                salesChannelId,
                visibility,
              })),
            },
          },
        }),
      });

      if (patchResponse.ok) {
        return;
      }

      const patchError = await patchResponse.text();
      throw new Error(
        `Failed to update product sales channels: Sync: ${syncResponse.statusText} - ${syncError} | JSON:API: ${patchResponse.statusText} - ${patchError}`
      );
    }
  }

  // Fetch categories that have products by extracting them from actual products
  async fetchCategories(): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
    try {
      console.log('[fetchCategories] Fetching categories with products from Shopware...');
      
      // Step 1: Fetch products with their category information
      const productsResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 500, // Get a large sample of products
          includes: {
            product: ['categories'],
            category: ['id', 'name', 'parentId']
          },
          associations: {
            categories: {}
          }
        }),
      });

      if (!productsResponse.ok) {
        throw new Error(`Failed to fetch products: ${productsResponse.statusText}`);
      }

      const productsData = await productsResponse.json();
      const products = productsData.data || [];

      // Step 2: Extract unique categories from products
      const categoryMap = new Map<string, { id: string; name: string; parentId: string | null }>();
      
      products.forEach((product: any) => {
        const categories = product.categories || product.attributes?.categories || [];
        categories.forEach((cat: any) => {
          if (cat.id && !categoryMap.has(cat.id)) {
            categoryMap.set(cat.id, {
              id: cat.id,
              name: cat.name || cat.attributes?.name || 'Unnamed Category',
              parentId: cat.parentId || cat.attributes?.parentId || null,
            });
          }
        });
      });

      // Convert map to array and sort by name
      const categories = Array.from(categoryMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );

      console.log(`[fetchCategories] Found ${categories.length} categories with products (from ${products.length} products)`);
      return categories;
    } catch (error) {
      console.error('Error fetching categories from Shopware:', error);
      throw error;
    }
  }

  // Fetch catalog prices for multiple products in batch requests (chunked for API limits)
  async fetchProductPricesBatch(productIds: string[]): Promise<Map<string, { grossPrice: number; netPrice: number }>> {
    try {
      if (productIds.length === 0) {
        return new Map();
      }

      console.log(`[fetchProductPricesBatch] Fetching catalog prices for ${productIds.length} unique products...`);

      // Chunk product IDs to avoid Shopware API limits (max 100 per request)
      const CHUNK_SIZE = 100;
      const chunks: string[][] = [];
      for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
        chunks.push(productIds.slice(i, i + CHUNK_SIZE));
      }

      const priceMap = new Map<string, { grossPrice: number; netPrice: number }>();

      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        console.log(`[fetchProductPricesBatch] Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} products)...`);

        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: chunk.length,
            filter: [
              {
                type: 'equalsAny',
                field: 'id',
                value: chunk,
              },
            ],
            includes: {
              product: ['id', 'productNumber', 'price', 'tax', 'parentId'],
              tax: ['taxRate'],
            },
            associations: {
              tax: {},
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[fetchProductPricesBatch] Failed to fetch chunk ${chunkIndex + 1}: ${response.statusText} - ${errorText}`);
          continue; // Skip this chunk but continue with others
        }

        const data = await response.json();
        const products = data.data || [];
        const included = data.included || [];

        // Create a map of included entities for tax lookup
        const includedMap = new Map<string, any>();
        included.forEach((item: any) => {
          const key = `${item.type}-${item.id}`;
          includedMap.set(key, item);
        });

        products.forEach((product: any) => {
          // Extract tax rate
          let taxRate = 19; // Default VAT rate
          const taxId = product.taxId || product.attributes?.taxId;
          if (taxId) {
            const taxEntity = includedMap.get(`tax-${taxId}`);
            if (taxEntity) {
              taxRate = taxEntity.taxRate || taxEntity.attributes?.taxRate || 19;
            }
          }

          // Extract catalog price (gross)
          let grossPrice = 0;
          let netPrice = 0;

          if (product.price && Array.isArray(product.price)) {
            const eurPrice = product.price.find((p: any) => p.currencyId || true);
            if (eurPrice) {
              grossPrice = eurPrice.gross || 0;
              netPrice = eurPrice.net || 0;
              if (!netPrice && grossPrice) {
                netPrice = grossPrice / (1 + taxRate / 100);
              }
            }
          } else if (product.attributes?.price && Array.isArray(product.attributes.price)) {
            const eurPrice = product.attributes.price.find((p: any) => p.currencyId || true);
            if (eurPrice) {
              grossPrice = eurPrice.gross || 0;
              netPrice = eurPrice.net || 0;
              if (!netPrice && grossPrice) {
                netPrice = grossPrice / (1 + taxRate / 100);
              }
            }
          }

          if (grossPrice > 0) {
            priceMap.set(product.id, { grossPrice, netPrice });
            console.log(`[fetchProductPricesBatch] Product ${product.productNumber || product.id}: Catalog gross €${grossPrice.toFixed(2)}, net €${netPrice.toFixed(2)}`);
          } else {
            console.log(`[fetchProductPricesBatch] Product ${product.productNumber || product.id}: NO PRICE FOUND`);
          }
        });
      }

      console.log(`[fetchProductPricesBatch] ✓ Retrieved catalog prices for ${priceMap.size}/${productIds.length} products`);
      if (priceMap.size < productIds.length) {
        console.log(`[fetchProductPricesBatch] ⚠ Missing prices for ${productIds.length - priceMap.size} products`);
      }
      
      return priceMap;
    } catch (error) {
      console.error('[fetchProductPricesBatch] Error fetching product prices batch:', error);
      return new Map();
    }
  }

  /**
   * Fetch products by their product numbers for enrichment
   */
  async fetchProductsByNumbers(productNumbers: string[]): Promise<Map<string, any>> {
    try {
      if (productNumbers.length === 0) {
        return new Map();
      }

      console.log(`[fetchProductsByNumbers] Fetching ${productNumbers.length} products...`);

      // Chunk product numbers to avoid API limits (25 per request)
      const CHUNK_SIZE = 25;
      const chunks: string[][] = [];
      for (let i = 0; i < productNumbers.length; i += CHUNK_SIZE) {
        chunks.push(productNumbers.slice(i, i + CHUNK_SIZE));
      }

      const productMap = new Map<string, any>();

      // Process each chunk
      for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
        const chunk = chunks[chunkIndex];
        console.log(`[fetchProductsByNumbers] Processing chunk ${chunkIndex + 1}/${chunks.length} (${chunk.length} products)...`);

        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: chunk.length,
            filter: [
              {
                type: 'equalsAny',
                field: 'productNumber',
                value: chunk,
              },
            ],
            includes: {
              product: ['id', 'productNumber', 'name', 'manufacturerId', 'coverId'],
              media: ['id', 'url'],
              product_manufacturer: ['id', 'name'],
            },
            associations: {
              cover: {
                associations: {
                  media: {},
                },
              },
              manufacturer: {},
            },
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`[fetchProductsByNumbers] Failed to fetch chunk ${chunkIndex + 1}: ${response.statusText} - ${errorText}`);
          continue;
        }

        const data = await response.json();
        const products = data.data || [];

        products.forEach((product: any) => {
          if (product.productNumber) {
            productMap.set(product.productNumber, {
              id: product.id,
              productNumber: product.productNumber,
              name: product.name || product.translated?.name,
              manufacturer: {
                name: product.manufacturer?.name || product.manufacturer?.translated?.name,
              },
              cover: {
                url: product.cover?.media?.url,
              },
            });
          }
        });
      }

      console.log(`[fetchProductsByNumbers] ✓ Retrieved ${productMap.size}/${productNumbers.length} products`);
      if (productMap.size < productNumbers.length) {
        console.log(`[fetchProductsByNumbers] ⚠ Missing ${productNumbers.length - productMap.size} products`);
      }
      
      return productMap;
    } catch (error) {
      console.error('[fetchProductsByNumbers] Error fetching products by numbers:', error);
      return new Map();
    }
  }

  async fetchProductsByIds(
    productIds: string[],
  ): Promise<Map<string, { id: string; productNumber: string; name: string; coverImageUrl?: string }>> {
    try {
      if (productIds.length === 0) return new Map();

      const CHUNK_SIZE = 25;
      const chunks: string[][] = [];
      for (let i = 0; i < productIds.length; i += CHUNK_SIZE) {
        chunks.push(productIds.slice(i, i + CHUNK_SIZE));
      }

      const result = new Map<string, { id: string; productNumber: string; name: string; coverImageUrl?: string }>();

      for (const chunk of chunks) {
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            limit: chunk.length,
            ids: chunk,
            includes: {
              product: ["id", "productNumber", "name", "translated", "coverId"],
              media: ["id", "url"],
            },
            associations: {
              cover: {
                associations: {
                  media: {},
                },
              },
            },
          }),
        });

        if (!response.ok) continue;

        const data = await response.json();
        for (const p of data.data || []) {
          const coverUrl = p.cover?.media?.url;
          result.set(p.id, {
            id: p.id,
            productNumber: p.productNumber || "",
            name: p.name || p.translated?.name || "",
            coverImageUrl: this.resolveMediaUrl(coverUrl || undefined) || undefined,
          });
        }
      }

      return result;
    } catch (error) {
      console.error("[fetchProductsByIds] Error:", error);
      return new Map();
    }
  }

  // Cross-Selling Methods
  async fetchProductCrossSelling(productId: string): Promise<CrossSellingGroup[]> {
    try {
      // Use search endpoint to get ALL cross-selling groups (both productList and productStream)
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'productId',
                value: productId,
              },
            ],
            // No type filter - load both productList AND productStream
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch cross-selling: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      // Debug: Log the full response to understand Shopware's structure
      console.log('Shopware Cross-Selling Response:', JSON.stringify(data, null, 2));
      
      const crossSellings = data.data || data || [];

      const result = crossSellings.map((cs: any) => ({
        id: cs.id,
        name: cs.name || cs.attributes?.name || 'Unnamed Group',
        type: cs.type || cs.attributes?.type || 'productList',
        active: cs.active !== undefined ? cs.active : (cs.attributes?.active || false),
        products: [], // Will be populated separately if needed
      }));
      
      console.log(`Found ${result.length} cross-selling groups (productList + productStream) for product ${productId}`);
      
      return result;
    } catch (error) {
      console.error('Error fetching cross-selling from Shopware:', error);
      throw error;
    }
  }

  async fetchCrossSellingProducts(productId: string, crossSellingId: string): Promise<CrossSellingProduct[]> {
    try {
      console.log(`Fetching products for cross-selling group ${crossSellingId}...`);
      
      // Step 1: Get assigned product IDs
      const assignmentsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'crossSellingId',
                value: crossSellingId,
              },
            ],
          }),
        }
      );

      if (!assignmentsResponse.ok) {
        const errorText = await assignmentsResponse.text();
        throw new Error(`Failed to fetch cross-selling assignments: ${assignmentsResponse.statusText} - ${errorText}`);
      }

      const assignmentsData = await assignmentsResponse.json();
      const assignments = assignmentsData.data || [];
      
      if (assignments.length === 0) {
        console.log(`No products assigned to cross-selling group ${crossSellingId}`);
        return [];
      }

      // Step 2: Extract product IDs
      const productIds = assignments.map((a: any) => a.productId);
      console.log(`Found ${productIds.length} assigned product IDs:`, productIds);

      // Step 3: Fetch full product details
      const productsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equalsAny',
                field: 'id',
                value: productIds,
              },
            ],
            associations: {
              cover: {
                associations: {
                  media: {},
                },
              },
              tax: {},
            },
          }),
        }
      );

      if (!productsResponse.ok) {
        const errorText = await productsResponse.text();
        throw new Error(`Failed to fetch product details: ${productsResponse.statusText} - ${errorText}`);
      }

      const productsData = await productsResponse.json();
      const products = productsData.data || [];
      
      console.log(`Fetched ${products.length} product details`);

      // Step 4: Map to CrossSellingProduct format
      const result = products.map((p: any) => {
        const priceObj = p.price?.[0];
        const grossPrice = priceObj?.gross || 0;
        const taxRate = p.tax?.taxRate || 19;
        const netPrice = priceObj?.net || grossPrice / (1 + taxRate / 100);
        return {
          id: p.id,
          productNumber: p.productNumber || '',
          name: p.name || 'Unknown Product',
          price: grossPrice,
          netPrice: netPrice,
          taxRate: taxRate,
          imageUrl: this.resolveMediaUrl(p.cover?.media?.url || undefined) || undefined,
          stock: p.stock || 0,
          available: p.available || false,
        };
      });
      
      console.log(`Found ${result.length} products in cross-selling group ${crossSellingId}`);
      
      return result;
    } catch (error) {
      console.error('Error fetching cross-selling products from Shopware:', error);
      throw error;
    }
  }

  async createProductCrossSelling(productId: string, name: string, type: 'productList' | 'productStream' = 'productList'): Promise<string> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/product-cross-selling`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            productId,
            name,
            type,
            active: true,
            position: 1,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create cross-selling: ${response.statusText} - ${errorText}`);
      }

      // Check if response has content
      const contentLength = response.headers.get('content-length');
      let createdId: string | null = null;

      // Try to get ID from response body if there is content
      if (contentLength && parseInt(contentLength) > 0) {
        try {
          const data = await response.json();
          // Shopware returns the created ID in different formats depending on API version
          // Try data first (direct response), then data.data (wrapped response)
          createdId = data?.id || data?.data?.id;
        } catch (jsonError) {
          console.log('Response body is not valid JSON, checking headers...');
        }
      }

      // If no ID from body, try to extract from Location header
      if (!createdId) {
        const locationHeader = response.headers.get('location');
        if (locationHeader) {
          // Location header format: /api/product-cross-selling/{id}
          const matches = locationHeader.match(/\/api\/product-cross-selling\/([a-f0-9]+)/i);
          if (matches && matches[1]) {
            createdId = matches[1];
          }
        }
      }

      if (!createdId) {
        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
        throw new Error('Failed to get cross-selling ID from response (checked body and Location header)');
      }

      return createdId;
    } catch (error) {
      console.error('Error creating cross-selling in Shopware:', error);
      throw error;
    }
  }

  async assignProductsToCrossSelling(crossSellingId: string, productIds: string[]): Promise<void> {
    try {
      console.log(`assignProductsToCrossSelling called with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(productIds)}`);
      
      // Shopware expects assigned products to be created individually
      const assignments = productIds.map((productId, index) => ({
        crossSellingId: crossSellingId, // Shopware expects 'crossSellingId', not 'productCrossSellingId'
        productId,
        position: index + 1,
      }));

      console.log('Assignments to send to Shopware:', JSON.stringify(assignments, null, 2));

      const requestBody = {
        'write-product-cross-selling-assigned-products': {
          entity: 'product_cross_selling_assigned_products',
          action: 'upsert',
          payload: assignments,
        },
      };
      
      console.log('Full request body:', JSON.stringify(requestBody, null, 2));

      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Shopware sync error response:', errorText);
        throw new Error(`Failed to assign products to cross-selling: ${response.statusText} - ${errorText}`);
      }
      
      console.log('Products assigned successfully');
    } catch (error) {
      console.error('Error assigning products to cross-selling in Shopware:', error);
      throw error;
    }
  }

  async removeProductsFromCrossSelling(crossSellingId: string, productIds: string[]): Promise<void> {
    try {
      // First, fetch existing assignments to get their IDs
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'productCrossSellingId',
                value: crossSellingId,
              },
              {
                type: 'equalsAny',
                field: 'productId',
                value: productIds,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch assignments for removal');
      }

      const data = await response.json();
      const assignmentIds = (data.data || []).map((a: any) => a.id);

      if (assignmentIds.length === 0) {
        return; // Nothing to delete
      }

      // Delete assignments
      const deleteResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            'delete-assignments': {
              entity: 'product_cross_selling_assigned_products',
              action: 'delete',
              payload: assignmentIds.map((id: string) => ({ id })),
            },
          }),
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        throw new Error(`Failed to remove products from cross-selling: ${deleteResponse.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error removing products from cross-selling in Shopware:', error);
      throw error;
    }
  }

  async deleteProductCrossSelling(crossSellingId: string): Promise<void> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/product-cross-selling/${crossSellingId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete cross-selling: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error deleting cross-selling from Shopware:', error);
      throw error;
    }
  }

  async fetchAvailableFields(): Promise<{
    standardFields: Array<{ field: string; label: string; description: string }>;
    customFields: Array<{ field: string; label: string; type: string }>;
  }> {
    try {
      // Standard product fields that are commonly used in rules
      const standardFields = [
        { field: 'name', label: 'Product Name', description: 'The product name' },
        { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
        { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
        { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
        { field: 'stock', label: 'Stock', description: 'Current stock level' },
        { field: 'available', label: 'Available', description: 'Product availability status' },
        { field: 'price', label: 'Price', description: 'Product price' },
        { field: 'weight', label: 'Weight', description: 'Product weight' },
        { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
        { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
        { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
        { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
        { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
      ];

      // Fetch custom fields from Shopware
      const customFields: Array<{ field: string; label: string; type: string }> = [];
      
      try {
        const response = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/search/custom-field`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              limit: 500, // Get many custom fields
              filter: [
                {
                  type: 'equals',
                  field: 'active',
                  value: true,
                },
              ],
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const fields = data.data || [];

          fields.forEach((cf: any) => {
            const fieldName = cf.name || cf.attributes?.name;
            const fieldLabel = cf.config?.label?.['en-GB'] || cf.config?.label?.['de-DE'] || cf.attributes?.config?.label?.['en-GB'] || cf.attributes?.config?.label?.['de-DE'] || fieldName;
            const fieldType = cf.type || cf.attributes?.type || 'text';

            if (fieldName) {
              customFields.push({
                field: `customFields.${fieldName}`,
                label: fieldLabel || fieldName,
                type: fieldType,
              });
            }
          });

          console.log(`Fetched ${customFields.length} custom fields from Shopware`);
        }
      } catch (customFieldError) {
        console.warn('Could not fetch custom fields from Shopware:', customFieldError);
        // Continue with empty custom fields array
      }

      return {
        standardFields,
        customFields,
      };
    } catch (error) {
      console.error('Error fetching available fields:', error);
      throw error;
    }
  }

  /**
   * Create a new order in Shopware
   * Note: This is a simplified order creation for AI-powered order drafts
   * In production, you may need additional fields based on your Shopware setup
   */
  /**
   * Search for a customer by email in Shopware
   * Returns the customer if found, null otherwise
   */
  async findCustomerByEmail(email: string): Promise<any | null> {
    try {
      console.log(`[Shopware] Searching for customer with email: ${email}`);
      
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 1,
          filter: [
            {
              type: 'equals',
              field: 'email',
              value: email,
            },
          ],
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to search customer: ${response.statusText}`);
      }

      const data = await response.json();
      const customers = data.data || [];
      
      if (customers.length > 0) {
        console.log(`[Shopware] Found existing customer: ${customers[0].id}`);
        return customers[0];
      }
      
      console.log(`[Shopware] No customer found with email: ${email}`);
      return null;
    } catch (error: any) {
      console.error('Error searching for customer:', error);
      throw new Error(`Failed to search for customer: ${error.message}`);
    }
  }

  /**
   * Search customers by term (email, firstName, lastName) for picker/UI.
   * Returns array of { id, email, firstName?, lastName?, company? }.
   */
  async searchCustomers(searchTerm: string, limit: number = 20): Promise<Array<{ id: string; email?: string; firstName?: string; lastName?: string; company?: string }>> {
    const term = (searchTerm || '').trim();
    if (term.length < 2) return [];

    try {
      const body: { limit: number; filter?: any[]; includes?: any } = {
        limit,
        filter: [
          {
            type: 'multi',
            operator: 'OR',
            queries: [
              { type: 'contains', field: 'email', value: term },
              { type: 'contains', field: 'firstName', value: term },
              { type: 'contains', field: 'lastName', value: term },
            ],
          },
        ],
      };

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
        method: 'POST',
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new Error(`Search customer failed: ${response.statusText} - ${err}`);
      }

      const data = await response.json();
      const list = data.data || [];
      return list.map((c: any) => {
        const attrs = c.attributes || c;
        return {
          id: c.id,
          email: attrs.email,
          firstName: attrs.firstName,
          lastName: attrs.lastName,
          company: attrs.company,
        };
      });
    } catch (error: any) {
      console.error('[Shopware] searchCustomers error:', error);
      return [];
    }
  }

  /**
   * Erweiterte Kundensuche für den CRM-Bestandskundenabgleich.
   * Sucht über mehrere Felder (E-Mail exakt, Vor-/Nachname, Firma, Kundennummer)
   * und liefert je Treffer Kundennummer + Rechnungsadresse zur Identitätsprüfung.
   * Wirft nicht; bei Fehler leeres Array.
   */
  async searchExistingCustomers(params: {
    email?: string | null;
    firstName?: string | null;
    lastName?: string | null;
    name?: string | null;
    company?: string | null;
    customerNumber?: string | null;
    limit?: number;
  }): Promise<Array<{
    id: string;
    customerNumber: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    groupId: string | null;
    groupName: string | null;
    billingAddress?: OrderAddress;
  }>> {
    const queries: any[] = [];
    const addContains = (field: string, value?: string | null) => {
      const v = (value || '').trim();
      if (v.length >= 2) queries.push({ type: 'contains', field, value: v });
    };

    const email = (params.email || '').trim();
    if (email) queries.push({ type: 'equals', field: 'email', value: email });
    addContains('firstName', params.firstName);
    addContains('lastName', params.lastName);
    addContains('company', params.company);
    // "Vorname Nachname" -> einzelne Tokens als Nachname-Treffer ergänzen.
    for (const token of (params.name || '').split(/\s+/)) {
      if (token.trim().length >= 2) {
        queries.push({ type: 'contains', field: 'lastName', value: token.trim() });
      }
    }
    const cn = (params.customerNumber || '').trim();
    if (cn) queries.push({ type: 'equals', field: 'customerNumber', value: cn });

    if (queries.length === 0) return [];

    const mapAddress = (addr: any, includedMap: Map<string, any>): OrderAddress | undefined => {
      if (!addr) return undefined;
      const a = addr.attributes || addr;
      let countryStr = '';
      const c = a.country;
      if (typeof c === 'string') countryStr = c;
      else if (c?.name) countryStr = String(c.name);
      else if (c?.translated?.name) countryStr = String(c.translated.name);
      else if (c?.data?.id) {
        const cent = includedMap.get(`country-${c.data.id}`);
        const ca = cent?.attributes || cent;
        if (ca?.name) countryStr = String(ca.name);
        else if (ca?.translated?.name) countryStr = String(ca.translated.name);
      }
      const street = String(a.street || '').trim();
      const zipCode = String(a.zipcode || a.zipCode || '').trim();
      const city = String(a.city || '').trim();
      if (!street && !zipCode && !city && !String(a.company || '').trim()) return undefined;
      return {
        firstName: String(a.firstName || '').trim(),
        lastName: String(a.lastName || '').trim(),
        street,
        zipCode,
        city,
        country: countryStr,
        company: a.company ? String(a.company).trim() : undefined,
        phoneNumber: a.phoneNumber ? String(a.phoneNumber).trim() : undefined,
      };
    };

    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: params.limit ?? 25,
          filter: [{ type: 'multi', operator: 'OR', queries }],
          associations: { defaultBillingAddress: { associations: { country: {} } }, group: {} },
        }),
      });
      if (!response.ok) return [];

      const data = await response.json();
      const list = data.data || [];
      const includedMap = new Map<string, any>();
      for (const item of data.included || []) {
        if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
      }

      return list.map((row: any) => {
        const a = row.attributes || row;
        const cnRaw = a.customerNumber ?? a.customerNo;
        let billingAddress = mapAddress(row.defaultBillingAddress, includedMap);
        const relId = row.relationships?.defaultBillingAddress?.data?.id;
        if (!billingAddress && relId) {
          const fromInc =
            includedMap.get(`customer_address-${relId}`) ||
            [...includedMap.values()].find((x) => x.id === relId && /address/i.test(String(x.type || '')));
          billingAddress = mapAddress(fromInc, includedMap);
        }

        // Kundengruppe auflösen (für Bestandskunde- vs. Shopkunde-Klassifizierung).
        let groupName: string | null = null;
        const grp = row.group;
        if (grp) {
          const ga = grp.attributes || grp;
          groupName = ga?.translated?.name || ga?.name || null;
        }
        const grpRelId = row.relationships?.group?.data?.id;
        if (!groupName && grpRelId) {
          const gent = includedMap.get(`customer_group-${grpRelId}`);
          const ga = gent?.attributes || gent;
          groupName = ga?.translated?.name || ga?.name || null;
        }
        const groupId = (a.groupId ?? grpRelId ?? null) as string | null;

        return {
          id: row.id,
          customerNumber: cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : null,
          email: a.email ?? null,
          firstName: a.firstName ?? null,
          lastName: a.lastName ?? null,
          company: a.company ? String(a.company).trim() : null,
          groupId,
          groupName,
          billingAddress,
        };
      });
    } catch (error: any) {
      console.error('[Shopware] searchExistingCustomers error:', error?.message || error);
      return [];
    }
  }

  /**
   * Lädt einen Shopware-Kunden per ID (für den Merge-Abgleich). Wirft nicht.
   */
  async getCustomerById(customerId: string): Promise<{
    id: string;
    customerNumber: string | null;
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    active: boolean;
  } | null> {
    const raw = (customerId || '').trim();
    if (!raw) return null;
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: 1, filter: [{ type: 'equals', field: 'id', value: toShopwareUuid(raw) }] }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const row = data.data?.[0];
      if (!row) return null;
      const a = row.attributes || row;
      const cnRaw = a.customerNumber ?? a.customerNo;
      return {
        id: row.id,
        customerNumber: cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : null,
        email: a.email ?? null,
        firstName: a.firstName ?? null,
        lastName: a.lastName ?? null,
        company: a.company ? String(a.company).trim() : null,
        active: a.active !== false,
      };
    } catch (error: any) {
      console.error('[Shopware] getCustomerById error:', error?.message || error);
      return null;
    }
  }

  /**
   * Liefert alle order_customer-Snapshots eines Kontos (per customerId) inkl.
   * Order-Nummer und Verkaufskanal. Für das Umhängen beim Kunden-Merge.
   */
  async findOrderCustomersByCustomerId(customerId: string): Promise<Array<{
    orderCustomerId: string;
    orderId: string | null;
    orderNumber: string | null;
    salesChannelId: string | null;
    email: string | null;
  }>> {
    const id = toShopwareUuid((customerId || '').trim());
    if (!id) return [];
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order-customer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 500,
          filter: [{ type: 'equals', field: 'customerId', value: id }],
          associations: { order: {} },
        }),
      });
      if (!response.ok) return [];
      const data = await response.json();
      const list = data.data || [];
      const includedMap = new Map<string, any>();
      for (const item of data.included || []) {
        if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
      }
      return list.map((row: any) => {
        const a = row.attributes || row;
        const relId = row.relationships?.order?.data?.id;
        let order = row.order;
        if (!order && relId) order = includedMap.get(`order-${relId}`);
        const oa = order?.attributes || order || {};
        return {
          orderCustomerId: row.id,
          orderId: relId || order?.id || null,
          orderNumber: oa.orderNumber ?? null,
          salesChannelId: oa.salesChannelId ?? null,
          email: a.email ?? null,
        };
      });
    } catch (error: any) {
      console.error('[Shopware] findOrderCustomersByCustomerId error:', error?.message || error);
      return [];
    }
  }

  /**
   * Hängt einen order_customer-Snapshot auf einen anderen Kunden um.
   * Wirft bei Fehler (für saubere Fehlerbehandlung im Merge).
   */
  async reassignOrderCustomer(
    orderCustomerId: string,
    target: { customerId: string; customerNumber?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null },
  ): Promise<boolean> {
    const ocId = (orderCustomerId || '').trim();
    if (!ocId) throw new Error('orderCustomerId is required');
    const payload: Record<string, any> = { customerId: toShopwareUuid(target.customerId) };
    if (target.customerNumber) payload.customerNumber = target.customerNumber;
    if (target.email) payload.email = target.email;
    if (target.firstName) payload.firstName = target.firstName;
    if (target.lastName) payload.lastName = target.lastName;

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/order-customer/${ocId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`reassignOrderCustomer ${ocId} failed: ${response.status} ${err}`);
    }
    return true;
  }

  /**
   * Deaktiviert einen Kunden (active = false). Wirft bei Fehler.
   */
  async deactivateCustomer(customerId: string): Promise<boolean> {
    const id = (customerId || '').trim();
    if (!id) throw new Error('customerId is required');
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer/${toShopwareUuid(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    if (!response.ok) {
      const err = await response.text().catch(() => '');
      throw new Error(`deactivateCustomer ${id} failed: ${response.status} ${err}`);
    }
    return true;
  }

  /**
   * Lädt alle Bestandskunden anhand der Kundengruppen-Namen (z.B. "Händler
   * Portal") inkl. Firma + Kundennummer. Für den CRM-Filter "möglicher
   * Bestandskunde". Server-seitig grob über group.name vorgefiltert.
   */
  async fetchBestandskundenIndex(groupNameTerms: string[]): Promise<Array<{ company: string; customerNumber: string | null }>> {
    const terms = (groupNameTerms || []).map((term) => (term || '').trim()).filter((term) => term.length >= 2);
    if (terms.length === 0) return [];

    const out: Array<{ company: string; customerNumber: string | null }> = [];
    const pageSize = SHOPWARE_ADMIN_SEARCH_PAGE_SIZE;
    let page = 1;

    while (true) {
      try {
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: pageSize,
            page,
            totalCountMode: 1,
            filter: [{ type: 'multi', operator: 'OR', queries: terms.map((value) => ({ type: 'contains', field: 'group.name', value })) }],
            associations: { group: {}, defaultBillingAddress: {} },
          }),
        });
        if (!response.ok) break;

        const data = await response.json();
        const list = data.data || [];
        const includedMap = new Map<string, any>();
        for (const item of data.included || []) {
          if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
        }

        for (const row of list) {
          const a = row.attributes || row;
          let company = a.company ? String(a.company).trim() : '';
          if (!company) {
            const ba = row.defaultBillingAddress?.attributes || row.defaultBillingAddress;
            if (ba?.company) {
              company = String(ba.company).trim();
            } else {
              const relId = row.relationships?.defaultBillingAddress?.data?.id;
              if (relId) {
                const inc = includedMap.get(`customer_address-${relId}`);
                const ia = inc?.attributes || inc;
                if (ia?.company) company = String(ia.company).trim();
              }
            }
          }
          if (!company) continue;
          const cnRaw = a.customerNumber ?? a.customerNo;
          out.push({ company, customerNumber: cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : null });
        }

        if (list.length < pageSize) break;
        page += 1;
      } catch (error: any) {
        console.error('[Shopware] fetchBestandskundenIndex error:', error?.message || error);
        break;
      }
    }
    return out;
  }

  /**
   * Liest kundenindividuelle Preise aus dem "B2Bsellers Suite"-Plugin.
   * Probiert die bekannten Entitätsnamen (neu: `b2bsellers-customer-price`,
   * alt: `b2b-customer-price`) und kann per Env `B2B_SELLERS_CUSTOMER_PRICE_ENTITY`
   * überschrieben werden. Filtert nach customerId (UUID) oder – falls nicht
   * vorhanden – customerNumber.
   */
  async fetchCustomerSpecificPrices(opts: {
    customerId?: string | null;
    customerNumber?: string | null;
    limit?: number;
    page?: number;
  }): Promise<{ available: boolean; total: number; prices: ShopwareCustomerPrice[]; entity: string | null }> {
    const limit = opts.limit ?? 100;
    const page = opts.page ?? 1;

    const filter: any[] = [];
    if (opts.customerId) {
      filter.push({ type: "equals", field: "customerId", value: toShopwareUuid(opts.customerId) });
    } else if (opts.customerNumber) {
      filter.push({ type: "equals", field: "customerNumber", value: opts.customerNumber });
    } else {
      return { available: false, total: 0, prices: [], entity: null };
    }

    const criteria = {
      limit,
      page,
      totalCountMode: 1,
      filter,
      sort: [{ field: "productNumber", order: "ASC" }],
      associations: { product: {} },
    };

    const envEntity = process.env.B2B_SELLERS_CUSTOMER_PRICE_ENTITY;
    const candidates = Array.from(
      new Set(
        [
          envEntity,
          "b2bsellers-customer-price",
          "b2b-customer-price",
          "b2bsellers_customer_price",
          "b2b_customer_price",
        ].filter(Boolean) as string[],
      ),
    );

    for (const entity of candidates) {
      let response: Response;
      try {
        response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
          method: "POST",
          body: JSON.stringify(criteria),
        });
      } catch (error: any) {
        console.error(`[B2B] fetchCustomerSpecificPrices request error (${entity}):`, error?.message || error);
        continue;
      }

      // Entität existiert nicht in dieser Installation -> nächsten Kandidaten testen.
      if (response.status === 404) continue;

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.warn(`[B2B] fetchCustomerSpecificPrices ${response.status} (${entity}): ${errText}`);
        continue;
      }

      const data = await response.json();
      const list: any[] = Array.isArray(data.data) ? data.data : [];
      const includedById = new Map<string, any>();
      for (const item of data.included || []) {
        if (item?.id) includedById.set(`${item.type}-${item.id}`, item);
      }

      const resolveProductName = (raw: any, attrs: any): string | null => {
        const nested = raw.product?.attributes || raw.product;
        if (nested?.translated?.name) return String(nested.translated.name);
        if (nested?.name) return String(nested.name);
        const rel = raw.relationships?.product?.data;
        if (rel?.id) {
          const inc = includedById.get(`product-${rel.id}`);
          const incAttrs = inc?.attributes || inc;
          if (incAttrs?.translated?.name) return String(incAttrs.translated.name);
          if (incAttrs?.name) return String(incAttrs.name);
        }
        return null;
      };

      const num = (v: any): number | null =>
        v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

      const prices: ShopwareCustomerPrice[] = list.map((raw) => {
        const attrs = raw.attributes || raw;
        return {
          id: raw.id,
          productId: attrs.productId ? String(attrs.productId) : null,
          productNumber: attrs.productNumber ? String(attrs.productNumber) : null,
          productName: resolveProductName(raw, attrs),
          customerId: attrs.customerId ? String(attrs.customerId) : null,
          customerNumber: attrs.customerNumber ? String(attrs.customerNumber) : null,
          from: num(attrs.from),
          to: num(attrs.to),
          priceNet: num(attrs.priceNet),
          pseudoPriceNet: num(attrs.pseudoPriceNet),
          currencyIsoCode: attrs.currencyIsoCode ? String(attrs.currencyIsoCode) : null,
          validFrom: attrs.validFrom ? String(attrs.validFrom) : null,
          validUntil: attrs.validUntil ? String(attrs.validUntil) : null,
        } satisfies ShopwareCustomerPrice;
      });

      const total = typeof data.total === "number" ? data.total : prices.length;
      return { available: total > 0, total, prices, entity };
    }

    // Keine passende Entität gefunden (Plugin evtl. nicht installiert).
    return { available: false, total: 0, prices: [], entity: null };
  }

  /** Bekannte Entitätsnamen der B2Bsellers-Customer-Price-Entität (überschreibbar per Env). */
  private getCustomerPriceEntityCandidates(): string[] {
    const envEntity = process.env.B2B_SELLERS_CUSTOMER_PRICE_ENTITY;
    return Array.from(
      new Set(
        [
          envEntity,
          "b2bsellers-customer-price",
          "b2b-customer-price",
          "b2bsellers_customer_price",
          "b2b_customer_price",
        ].filter(Boolean) as string[],
      ),
    );
  }

  /**
   * Liefert die Menge aller Kunden, die im B2Bsellers-Suite-Plugin mindestens einen
   * kundenindividuellen Preis hinterlegt haben. Nutzt eine Terms-Aggregation auf
   * `customerId` (Pflichtfeld der Entität) und löst anschließend die E-Mail-Adressen
   * der Kunden auf, damit der Aufrufer gegen lokale CRM-Kunden (per E-Mail) matchen kann.
   */
  async fetchIndividualPriceCustomerIndex(): Promise<{
    entity: string | null;
    customerCount: number;
    emails: string[];
    customers: Array<{
      id: string;
      email: string;
      name: string;
      company: string | null;
      phone: string | null;
      salesChannelId: string | null;
    }>;
  }> {
    // Sicherheitsgrenze, um bei sehr vielen Kunden nicht endlos E-Mails aufzulösen.
    const MAX_CUSTOMERS = 5000;
    const empty = {
      entity: null as string | null,
      customerCount: 0,
      emails: [] as string[],
      customers: [] as Array<{
        id: string;
        email: string;
        name: string;
        company: string | null;
        phone: string | null;
        salesChannelId: string | null;
      }>,
    };

    for (const entity of this.getCustomerPriceEntityCandidates()) {
      let response: Response;
      try {
        response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
          method: "POST",
          body: JSON.stringify({
            limit: 1,
            aggregations: [
              { name: "byCustomer", type: "terms", field: "customerId", limit: MAX_CUSTOMERS },
            ],
          }),
        });
      } catch (error: any) {
        console.error(`[B2B] fetchIndividualPriceCustomerIndex request error (${entity}):`, error?.message || error);
        continue;
      }

      if (response.status === 404) continue;
      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        console.warn(`[B2B] fetchIndividualPriceCustomerIndex ${response.status} (${entity}): ${errText}`);
        continue;
      }

      const data = await response.json();
      const buckets: any[] = data?.aggregations?.byCustomer?.buckets || [];
      const customerIds = buckets
        .map((b) => (b?.key != null ? String(b.key) : null))
        .filter((k): k is string => !!k);

      const customerCount = customerIds.length;
      if (customerCount === 0) {
        return { entity, customerCount: 0, emails: [], customers: [] };
      }

      // Kundendaten in Chunks auflösen (equalsAny über die Kunden-IDs).
      const emails = new Set<string>();
      const customers: Array<{
        id: string;
        email: string;
        name: string;
        company: string | null;
        phone: string | null;
        salesChannelId: string | null;
      }> = [];
      const CHUNK = 100;
      for (let i = 0; i < customerIds.length; i += CHUNK) {
        const chunk = customerIds.slice(i, i + CHUNK).map((id) => toShopwareUuid(id));
        try {
          const custResp = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
            method: "POST",
            body: JSON.stringify({
              limit: CHUNK,
              filter: [{ type: "equalsAny", field: "id", value: chunk }],
              includes: { customer: ["id", "email", "firstName", "lastName", "company", "salesChannelId"] },
              associations: { defaultBillingAddress: {} },
            }),
          });
          if (!custResp.ok) continue;
          const custData = await custResp.json();
          const includedMap = new Map<string, any>();
          for (const item of custData.included || []) {
            if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
          }
          for (const row of custData.data || []) {
            const attrs = row.attributes || row;
            const email = attrs?.email ? String(attrs.email).trim().toLowerCase() : "";
            if (!email) continue;
            emails.add(email);

            const billingRel = attrs.defaultBillingAddress?.data?.id ?? attrs.defaultBillingAddress?.id;
            const billingEntity = billingRel
              ? includedMap.get(`customer_address-${billingRel}`)
              : undefined;
            const billingAttrs = billingEntity?.attributes || billingEntity;
            const company =
              (billingAttrs?.company ? String(billingAttrs.company).trim() : "") ||
              (attrs?.company ? String(attrs.company).trim() : "") ||
              null;
            const firstName = String(attrs?.firstName || "").trim();
            const lastName = String(attrs?.lastName || "").trim();
            const name = [firstName, lastName].filter(Boolean).join(" ") || company || email;
            const phone = billingAttrs?.phoneNumber
              ? String(billingAttrs.phoneNumber).trim()
              : null;
            const salesChannelId = attrs?.salesChannelId ? String(attrs.salesChannelId) : null;

            customers.push({
              id: String(attrs?.id || row.id),
              email,
              name,
              company,
              phone,
              salesChannelId,
            });
          }
        } catch (error: any) {
          console.warn("[B2B] fetchIndividualPriceCustomerIndex email resolve error:", error?.message || error);
        }
      }

      return {
        entity,
        customerCount: customers.length,
        emails: Array.from(emails),
        customers,
      };
    }

    // Plugin/Entität nicht vorhanden.
    return empty;
  }

  /**
   * Leichter Fingerprint für den Individual-Prices-Index (Aggregation, ohne E-Mail-Auflösung).
   */
  async fetchIndividualPriceCustomerFingerprint(): Promise<string | null> {
    const { stableFingerprint } = await import("./contentHashCache");

    for (const entity of this.getCustomerPriceEntityCandidates()) {
      try {
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
          method: "POST",
          body: JSON.stringify({
            limit: 1,
            totalCountMode: 1,
            aggregations: [{ name: "byCustomer", type: "terms", field: "customerId", limit: 5 }],
          }),
        });
        if (response.status === 404) continue;
        if (!response.ok) continue;

        const data = await response.json();
        const buckets: any[] = data?.aggregations?.byCustomer?.buckets || [];
        const fp = await this.fetchEntitySearchFingerprint(entity, { sortField: "updatedAt" });

        return stableFingerprint({
          scope: "individual_prices",
          entity,
          docTotal: data?.meta?.total ?? 0,
          distinctCustomers: buckets.length,
          latestUpdatedAt: fp?.latestUpdatedAt ?? null,
        });
      } catch {
        continue;
      }
    }
    return stableFingerprint({ scope: "individual_prices", entity: "none" });
  }

  /**
   * Kundennummer + Standard-Rechnungsadresse für PDFs (z. B. Konfigurations-Angebot).
   * Nutzt Admin-Suche mit Assoziationen; bei Fehler/null ohne Wurf.
   */
  async fetchCustomerBillingForPdf(customerId: string): Promise<{
    customerNumber?: string;
    billingAddress?: OrderAddress;
  } | null> {
    const rawId = (customerId || "").trim();
    if (!rawId) return null;
    const id = toShopwareUuid(rawId);
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          filter: [{ type: "equals", field: "id", value: id }],
          associations: {
            defaultBillingAddress: {
              associations: { country: {} },
            },
          },
        }),
      });
      if (!response.ok) return null;
      const data = await response.json();
      const row = data.data?.[0];
      if (!row) return null;

      const includedMap = new Map<string, any>();
      for (const item of data.included || []) {
        if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
      }

      const custAttrs = row.attributes || row;
      const cnRaw = custAttrs.customerNumber ?? custAttrs.customerNo;
      const customerNumber =
        cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : undefined;

      const mapAddressEntity = (addr: any): OrderAddress | undefined => {
        if (!addr) return undefined;
        const a = addr.attributes || addr;
        let countryStr = "";
        const c = a.country;
        if (typeof c === "string") countryStr = c;
        else if (c?.name) countryStr = String(c.name);
        else if (c?.translated?.name) countryStr = String(c.translated.name);
        else if (c?.data?.id) {
          const cent = includedMap.get(`country-${c.data.id}`);
          const ca = cent?.attributes || cent;
          if (ca?.name) countryStr = String(ca.name);
          else if (ca?.translated?.name) countryStr = String(ca.translated.name);
        }
        const street = String(a.street || "").trim();
        const zipCode = String(a.zipcode || a.zipCode || "").trim();
        const city = String(a.city || "").trim();
        if (!street && !zipCode && !city && !String(a.company || "").trim()) return undefined;
        return {
          firstName: String(a.firstName || "").trim(),
          lastName: String(a.lastName || "").trim(),
          street,
          zipCode,
          city,
          country: countryStr,
          company: a.company ? String(a.company).trim() : undefined,
          phoneNumber: a.phoneNumber ? String(a.phoneNumber).trim() : undefined,
        };
      };

      let billingAddress = mapAddressEntity(row.defaultBillingAddress);
      const relId = row.relationships?.defaultBillingAddress?.data?.id;
      if (!billingAddress && relId) {
        const fromInc =
          includedMap.get(`customer_address-${relId}`) ||
          [...includedMap.values()].find((x) => x.id === relId && /address/i.test(String(x.type || "")));
        billingAddress = mapAddressEntity(fromInc);
      }

      const out: { customerNumber?: string; billingAddress?: OrderAddress } = {};
      if (customerNumber) out.customerNumber = customerNumber;
      if (billingAddress) out.billingAddress = billingAddress;
      return Object.keys(out).length ? out : null;
    } catch (e) {
      console.warn("[Shopware] fetchCustomerBillingForPdf:", e);
      return null;
    }
  }

  /**
   * Create a new customer in Shopware
   * Returns the created customer object
   */
  async createCustomer(customerData: {
    email: string;
    firstName?: string;
    lastName?: string;
    company?: string;
    billingAddress: {
      firstName?: string;
      lastName?: string;
      street: string;
      zipCode: string;
      city: string;
      country: string;
      company?: string;
    };
    shippingAddress?: {
      firstName?: string;
      lastName?: string;
      street: string;
      zipCode: string;
      city: string;
      country: string;
      company?: string;
    };
  }): Promise<any> {
    try {
      console.log(`[Shopware] Creating new customer: ${customerData.email}`);
      
      // Shopware requires specific structure for customer creation
      // We need to get the sales channel ID and customer group ID

      const billingCountryId = await this.getCountryIdByName(customerData.billingAddress.country);
      if (!billingCountryId?.trim()) {
        throw new Error(
          `Land für Rechnungsadresse nicht gefunden: "${customerData.billingAddress.country}". Bitte ISO-Code (z. B. DE, AT, CH) oder einen bekannten Landesnamen verwenden.`,
        );
      }

      let shippingCountryId: string | undefined;
      if (customerData.shippingAddress) {
        shippingCountryId = await this.getCountryIdByName(customerData.shippingAddress.country);
        if (!shippingCountryId?.trim()) {
          throw new Error(
            `Land für Lieferadresse nicht gefunden: "${customerData.shippingAddress.country}". Bitte ISO-Code (z. B. DE, AT, CH) oder einen bekannten Landesnamen verwenden.`,
          );
        }
      }
      
      const requestBody: any = {
        email: customerData.email,
        firstName: customerData.firstName || customerData.billingAddress.firstName || customerData.company || 'N/A',
        lastName: customerData.lastName || customerData.billingAddress.lastName || 'Customer',
        salutationId: await this.getDefaultSalutationId(),
        customerNumber: `DRAFT-${Date.now()}`, // Auto-generated customer number
        defaultPaymentMethodId: await this.getDefaultPaymentMethodId(),
        defaultBillingAddress: {
          firstName: customerData.billingAddress.firstName || customerData.firstName || customerData.company || 'N/A',
          lastName: customerData.billingAddress.lastName || customerData.lastName || 'Customer',
          street: customerData.billingAddress.street,
          zipcode: customerData.billingAddress.zipCode,
          city: customerData.billingAddress.city,
          countryId: billingCountryId,
          salutationId: await this.getDefaultSalutationId(),
        },
        defaultShippingAddress: customerData.shippingAddress && shippingCountryId ? {
          firstName: customerData.shippingAddress.firstName || customerData.firstName || customerData.company || 'N/A',
          lastName: customerData.shippingAddress.lastName || customerData.lastName || 'Customer',
          street: customerData.shippingAddress.street,
          zipcode: customerData.shippingAddress.zipCode,
          city: customerData.shippingAddress.city,
          countryId: shippingCountryId,
          salutationId: await this.getDefaultSalutationId(),
        } : undefined,
        groupId: await this.getDefaultCustomerGroupId(),
        salesChannelId: await this.getDefaultSalesChannelId(),
      };

      // Add company name if present
      if (customerData.company) {
        requestBody.company = customerData.company;
        if (requestBody.defaultBillingAddress) {
          requestBody.defaultBillingAddress.company = customerData.billingAddress.company || customerData.company;
        }
        if (requestBody.defaultShippingAddress && customerData.shippingAddress?.company) {
          requestBody.defaultShippingAddress.company = customerData.shippingAddress.company;
        }
      }

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create customer: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      const customer = result.data || result;
      
      console.log(`[Shopware] Customer created successfully: ${customer.id}`);
      return customer;
    } catch (error: any) {
      console.error('Error creating customer:', error);
      throw new Error(`Failed to create customer: ${error.message}`);
    }
  }

  /**
   * Helper: Get default salutation ID (required for customer creation)
   */
  private async getDefaultSalutationId(): Promise<string> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/salutation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    });
    const data = await response.json();
    return data.data?.[0]?.id || 'not_specified';
  }

  /**
   * Helper: Get default customer group ID
   */
  private async getDefaultCustomerGroupId(): Promise<string> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer-group`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    });
    const data = await response.json();
    return data.data?.[0]?.id || '';
  }

  /**
   * Helper: Get default payment method ID
   */
  private async getDefaultPaymentMethodId(): Promise<string> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/payment-method`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        limit: 1,
        filter: [{
          type: 'equals',
          field: 'active',
          value: true,
        }],
      }),
    });
    const data = await response.json();
    return data.data?.[0]?.id || '';
  }

  /**
   * Helper: Get default sales channel ID
   */
  private async getDefaultSalesChannelId(): Promise<string> {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 1 }),
    });
    const data = await response.json();
    return data.data?.[0]?.id || '';
  }

  /**
   * Helper: Get country ID by name (e.g., "Deutschland" → country ID)
   */
  private async getCountryIdByName(countryName: string): Promise<string> {
    const raw = (countryName || '').trim();
    if (!raw) return '';

    // Map common country names to ISO codes
    const countryMap: Record<string, string> = {
      deutschland: 'DE',
      germany: 'DE',
      österreich: 'AT',
      oesterreich: 'AT',
      austria: 'AT',
      schweiz: 'CH',
      switzerland: 'CH',
      frankreich: 'FR',
      france: 'FR',
      italien: 'IT',
      italy: 'IT',
      spanien: 'ES',
      spain: 'ES',
      niederlande: 'NL',
      netherlands: 'NL',
      belgien: 'BE',
      belgium: 'BE',
      polen: 'PL',
      poland: 'PL',
      'vereinigte staaten': 'US',
      'united states': 'US',
      usa: 'US',
    };

    const lower = raw.toLowerCase();
    let isoCode: string;
    if (/^[a-z]{2}$/i.test(raw)) {
      isoCode = raw.toUpperCase();
    } else {
      isoCode = countryMap[lower] || 'DE';
    }

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/country`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 1,
        filter: [{
          type: 'equals',
          field: 'iso',
          value: isoCode,
        }],
      }),
    });
    const data = await response.json();
    const id = data.data?.[0]?.id || '';
    if (!id) {
      console.warn(`[Shopware] No country entity for iso=${isoCode} (input="${countryName}")`);
    }
    return id;
  }

  async createOrder(orderData: {
    lineItems: Array<{ productId: string; quantity: number }>;
    customer?: any;
    billingAddress?: any;
    shippingAddress?: any;
    customerComment?: string;
  }): Promise<any> {
    try {
      // Shopware order creation is complex and typically requires:
      // - Customer context
      // - Sales channel context
      // - Line items with proper structure
      // - Payment and shipping methods
      
      // For this implementation, we'll create a simplified order
      // You may need to adjust this based on your Shopware setup
      
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          lineItems: orderData.lineItems.map(item => ({
            referencedId: item.productId,
            type: 'product',
            quantity: item.quantity,
          })),
          customerComment: orderData.customerComment || '',
          // Note: Add customer, billing/shipping addresses, payment method, etc.
          // based on your Shopware configuration
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create order: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      
      // Return the created order
      return result.data || result;
    } catch (error: any) {
      console.error('Error creating order in Shopware:', error);
      throw new Error(`Failed to create order in Shopware: ${error.message}`);
    }
  }

  /**
   * Update order shipping information and set status to "shipped"
   * This combines setting tracking codes and transitioning the delivery state
   */
  async updateOrderShipping(
    orderId: string,
    shippingInfo: {
      carrier?: string;
      trackingNumber?: string;
      shippedDate?: string;
    }
  ): Promise<void> {
    try {
      // Step 1: Fetch order to get delivery ID
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}?associations[deliveries][]`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch order: ${response.statusText} - ${errorText}`);
      }

      const orderData = await response.json();
      const deliveries = orderData.data?.deliveries || [];

      if (deliveries.length === 0) {
        throw new Error('Order has no deliveries');
      }

      // Get the first delivery (most orders have only one delivery)
      const deliveryId = deliveries[0].id;

      // Step 2: Update tracking codes if provided
      if (shippingInfo.trackingNumber) {
        const trackingCodes = [shippingInfo.trackingNumber];
        
        const updateResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/order-delivery/${deliveryId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              trackingCodes: trackingCodes,
            }),
          }
        );

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          console.warn(`Warning: Failed to update tracking codes: ${updateResponse.statusText} - ${errorText}`);
          // Continue anyway - tracking codes are optional
        }
      }

      // Step 3: Transition delivery state to "shipped"
      await this.transitionOrderDeliveryToShipped(orderId, deliveryId);

      // Step 4: Persist shipping info in order customFields (for analytics / Versandzeiten)
      const customFields: Record<string, string> = {};
      if (shippingInfo.shippedDate) customFields.meta_shipped_date = shippingInfo.shippedDate;
      if (shippingInfo.carrier) customFields.meta_shipped_carrier = shippingInfo.carrier;
      if (shippingInfo.trackingNumber) customFields.meta_shipped_tracking = shippingInfo.trackingNumber;
      if (Object.keys(customFields).length > 0) {
        const orderPatchResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/order/${orderId}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ customFields }),
          }
        );
        if (!orderPatchResponse.ok) {
          const errorText = await orderPatchResponse.text();
          console.warn(`Warning: Failed to persist shipping customFields on order: ${orderPatchResponse.statusText} - ${errorText}`);
        }
      }

      console.log(`Order ${orderId} marked as shipped in Shopware`);
    } catch (error) {
      console.error('Error updating order shipping:', error);
      throw error;
    }
  }

  async markOrderPaid(orderId: string): Promise<void> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}?associations[transactions][]=stateMachineState`,
        { method: "GET" }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch order for payment update: ${response.statusText} - ${errorText}`);
      }

      const orderData = await response.json();
      const transactions =
        orderData.data?.transactions ||
        orderData.data?.relationships?.transactions?.data ||
        [];

      const firstTransaction = Array.isArray(transactions) ? transactions[0] : null;
      const transactionId =
        firstTransaction?.id ||
        firstTransaction?.data?.id ||
        null;

      if (!transactionId) {
        throw new Error("Order has no transaction to update");
      }

      const stateResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order_transaction/${transactionId}/state/paid`,
        { method: "POST", body: JSON.stringify({}) }
      );

      if (!stateResponse.ok) {
        const errorText = await stateResponse.text();
        throw new Error(`Failed to mark order paid: ${stateResponse.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error("Error marking order as paid:", error);
      throw error;
    }
  }

  /**
   * Update order document numbers (invoice, delivery note, ERP) in Shopware custom fields
   */
  async updateOrderDocumentNumbers(
    orderId: string,
    documents: {
      invoiceNumber?: string;
      vorkasseInvoiceNumber?: string;
      deliveryNoteNumber?: string;
      erpNumber?: string;
      proformaNumber?: string;
    }
  ): Promise<void> {
    try {
      // Build custom fields object
      const customFields: Record<string, any> = {};
      
      if (documents.invoiceNumber !== undefined) {
        customFields.custom_order_numbers_invoice = documents.invoiceNumber;
      }
      
      if (documents.vorkasseInvoiceNumber !== undefined) {
        customFields.custom_order_numbers_vorkasse = documents.vorkasseInvoiceNumber;
      }
      
      if (documents.deliveryNoteNumber !== undefined) {
        customFields.custom_order_numbers_deliveryNo = documents.deliveryNoteNumber;
      }
      
      if (documents.erpNumber !== undefined) {
        customFields.custom_order_numbers_order = documents.erpNumber;
      }
      
      if (documents.proformaNumber !== undefined) {
        customFields.custom_order_proforma_number = documents.proformaNumber;
      }

      // Update order with custom fields
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            customFields
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to update document numbers: ${response.statusText} - ${errorText}`);
      }

      console.log(`Order ${orderId} document numbers updated in Shopware:`, documents);
    } catch (error) {
      console.error('Error updating order document numbers:', error);
      throw error;
    }
  }

  /**
   * Fetch orders for analytics with optional date and sales channel filtering
   */
  async fetchOrdersForAnalytics(dateFrom?: string, dateTo?: string, salesChannelIds?: string[]): Promise<Order[]> {
    try {
      const limit = 500;
      let page = 1;
      let allOrders: any[] = [];
      let allIncluded: any[] = [];
      let hasMore = true;

      while (hasMore) {
        // Build filter array
        const filters: any[] = [];
        
        if (dateFrom) {
          filters.push({
            type: 'range',
            field: 'orderDate',
            parameters: {
              gte: dateFrom,
            },
          });
        }
        
        if (dateTo) {
          filters.push({
            type: 'range',
            field: 'orderDate',
            parameters: {
              lte: dateTo,
            },
          });
        }

        if (salesChannelIds && salesChannelIds.length > 0) {
          filters.push({
            type: 'equalsAny',
            field: 'salesChannelId',
            value: salesChannelIds,
          });
        }

        const requestBody: any = {
          limit,
          page,
          sort: [
            {
              field: 'orderDate',
              order: 'DESC',
            },
          ],
          includes: {
            order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price'],
            order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'product', 'payload', 'productNumber'],
            state_machine_state: ['technicalName'],
            sales_channel: ['id', 'name'],
            order_transaction: ['stateMachineState'],
            product: ['id', 'productNumber', 'name', 'categories'],
            category: ['id', 'name'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {
              associations: {
                product: {
                  associations: {
                    categories: {},
                  },
                },
              },
            },
            stateMachineState: {},
            salesChannel: {},
            transactions: {
              limit: 10,
              sort: [{ field: 'createdAt', order: 'DESC' }],
              associations: {
                stateMachineState: {},
              },
            },
          },
        };

        if (filters.length > 0) {
          requestBody.filter = filters;
        }

        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch orders for analytics: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        const orders = data.data || [];
        const included = data.included || [];

        if (orders.length === 0) {
          hasMore = false;
          break;
        }

        allOrders = allOrders.concat(orders);
        allIncluded = allIncluded.concat(included);

        if (orders.length < limit) {
          hasMore = false;
        }

        page++;
      }

      console.log(`[Analytics] Fetched ${allOrders.length} orders for analysis`);

      // Create a map of included entities
      const includedMap = new Map<string, any>();
      allIncluded.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      // Map to Order format (simplified for analytics)
      return allOrders.map((shopwareOrder: any) => {
        let customerName = 'Unknown Customer';
        let customerEmail = '';

        if (shopwareOrder.orderCustomer) {
          const customer = shopwareOrder.orderCustomer;
          customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
          customerEmail = customer.email || '';
        } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
          const customerId = shopwareOrder.relationships.orderCustomer.data.id;
          const customer = includedMap.get(`order_customer-${customerId}`);
          if (customer) {
            customerName = `${customer.attributes?.firstName || ''} ${customer.attributes?.lastName || ''}`.trim() || 'Unknown Customer';
            customerEmail = customer.attributes?.email || '';
          }
        }

        // Get order status
        let orderStatus: OrderStatus = 'open';
        if (shopwareOrder.stateMachineState?.technicalName) {
          orderStatus = this.mapShopwareStatus(shopwareOrder.stateMachineState.technicalName);
        } else if (shopwareOrder.relationships?.stateMachineState?.data?.id) {
          const stateId = shopwareOrder.relationships.stateMachineState.data.id;
          const state = includedMap.get(`state_machine_state-${stateId}`);
          if (state?.attributes?.technicalName) {
            orderStatus = this.mapShopwareStatus(state.attributes.technicalName);
          }
        }

        // Get payment status
        let paymentStatus: PaymentStatus = 'open';
        if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
          const latestTransaction = shopwareOrder.transactions[0];
          if (latestTransaction.stateMachineState?.technicalName) {
            paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
          }
        } else if (shopwareOrder.relationships?.transactions?.data && shopwareOrder.relationships.transactions.data.length > 0) {
          const transactionId = shopwareOrder.relationships.transactions.data[0].id;
          const transaction = includedMap.get(`order_transaction-${transactionId}`);
          if (transaction?.relationships?.stateMachineState?.data?.id) {
            const stateId = transaction.relationships.stateMachineState.data.id;
            const state = includedMap.get(`state_machine_state-${stateId}`);
            if (state?.attributes?.technicalName) {
              paymentStatus = this.mapPaymentStatus(state.attributes.technicalName);
            }
          }
        }

        // Get line items with category information
        const lineItems: OrderItem[] = [];
        if (shopwareOrder.lineItems) {
          shopwareOrder.lineItems.forEach((item: any) => {
            const unitPrice = item.price?.unitPrice || 0;
            const quantity = item.quantity || 0;
            const taxRate = item.price?.taxRules?.[0]?.taxRate || 19; // Default to 19% if not specified
            const netUnitPrice = unitPrice / (1 + taxRate / 100);
            
            const lineItem: OrderItem = {
              id: item.id,
              name: item.label || 'Unknown Product',
              quantity,
              price: unitPrice,
              netPrice: netUnitPrice,
              total: unitPrice * quantity,
              netTotal: netUnitPrice * quantity,
              taxRate,
            };

            lineItems.push(lineItem);
          });
        }

        // Get sales channel
        let salesChannelName = '';
        if (shopwareOrder.salesChannel?.name) {
          salesChannelName = shopwareOrder.salesChannel.name;
        } else if (shopwareOrder.relationships?.salesChannel?.data?.id) {
          const channelId = shopwareOrder.relationships.salesChannel.data.id;
          const channel = includedMap.get(`sales_channel-${channelId}`);
          if (channel?.attributes?.name) {
            salesChannelName = channel.attributes.name;
          }
        }

        // Map shipping info from order customFields (for Versandzeiten analytics)
        const customFields = shopwareOrder.customFields || shopwareOrder.attributes?.customFields || {};
        let shippingInfo: { carrier?: string; trackingNumber?: string; shippedDate?: string } | undefined;
        if (customFields.meta_shipped_date || customFields.meta_shipped_carrier || customFields.meta_shipped_tracking) {
          shippingInfo = {};
          if (customFields.meta_shipped_date) shippingInfo.shippedDate = customFields.meta_shipped_date;
          if (customFields.meta_shipped_carrier) shippingInfo.carrier = customFields.meta_shipped_carrier;
          if (customFields.meta_shipped_tracking) shippingInfo.trackingNumber = customFields.meta_shipped_tracking;
        }

        return {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || 'N/A',
          orderDate: shopwareOrder.orderDate || new Date().toISOString(),
          customerName,
          customerEmail,
          customerPhone: '',
          totalAmount: shopwareOrder.amountTotal || 0,
          netTotalAmount: shopwareOrder.amountNet || 0,
          status: orderStatus,
          paymentStatus,
          salesChannelId: shopwareOrder.salesChannelId || '',
          salesChannelName,
          items: lineItems,
          shippingInfo,
        } as Order;
      });
    } catch (error) {
      console.error('Error fetching orders for analytics:', error);
      throw error;
    }
  }

  /**
   * Fetch all offers from PremSoft Individual Offer plugin
   */
  async fetchOffers(): Promise<any[]> {
    try {
      const limit = 100;
      let page = 1;
      let allOffers: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/prems-individual-offer`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Failed to fetch offers: ${response.statusText} - ${errorText}`);
        }

        const result = await response.json();
        const offers = result.data || [];
        
        allOffers = allOffers.concat(offers);
        
        // Check if there are more pages
        const total = result.meta?.total || offers.length;
        hasMore = allOffers.length < total;
        page++;
        
        // Safety check to avoid infinite loops
        if (page > 100) {
          console.warn('Reached maximum page limit for offers');
          break;
        }
      }

      return allOffers;
    } catch (error) {
      console.error('Error fetching offers from Shopware:', error);
      throw error;
    }
  }

  /**
   * Fetch single offer with full details from PremSoft plugin
   */
  async fetchOfferById(offerId: string): Promise<any> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/prems-individual-offer/${offerId}?associations[items][]=&associations[customer][]=`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch offer: ${response.statusText} - ${errorText}`);
      }

      const result = await response.json();
      return result.data || result;
    } catch (error) {
      console.error('Error fetching offer by ID:', error);
      throw error;
    }
  }

  /**
   * Fetch offer PDF from PremSoft plugin
   */
  async fetchOfferPDF(offerId: string, customerId: string, salesChannelId: string): Promise<Buffer> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/prems/offer/renderpdf/${offerId}?customerId=${customerId}&salesChannelId=${salesChannelId}`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch offer PDF: ${response.statusText} - ${errorText}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error('Error fetching offer PDF:', error);
      throw error;
    }
  }

  /**
   * Mark an existing document as sent / not sent (Shopware document.sent flag).
   * Used e.g. for ERP-imported invoices that exist in the shop but were never
   * dispatched from the shop ("Rechnung vorhanden, aber nicht verschickt").
   */
  async setDocumentSent(documentId: string, sent: boolean): Promise<void> {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/document/${documentId}`,
      {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sent }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to set document ${documentId} sent=${sent}: ${response.statusText} - ${errorText}`
      );
    }
    console.log(`[Shopware API] Document ${documentId} marked sent=${sent}`);
  }

  /**
   * Check if a document of a specific type already exists for an order
   * Returns: { exists: boolean, documentNumber?: string, documentId?: string, conflict: boolean }
   * For invoice: only "real" invoices count (VKRE/PF are proforma/vorkasse and do not block creating the final invoice).
   */
  async checkExistingDocument(
    orderId: string,
    documentType: 'invoice' | 'delivery_note',
    requestedNumber?: string
  ): Promise<{ exists: boolean; documentNumber?: string; documentId?: string; conflict: boolean }> {
    try {
      const documents = await this.fetchOrderDocuments(orderId);

      if (documentType === 'invoice') {
        // Only consider "real" invoices (exclude VKRE/PF proforma/vorkasse)
        const realInvoices = documents.filter(
          doc => (doc.type === 'invoice' || doc.type === 'proforma_invoice' || doc.type === 'vorkasse_invoice') && !isProformaOrVorkasse(doc.number)
        );
        const matching = requestedNumber ? realInvoices.find(d => d.number === requestedNumber) : undefined;
        const anyOtherReal = requestedNumber ? realInvoices.find(d => d.number !== requestedNumber) : undefined;

        return {
          exists: !!matching,
          documentNumber: matching?.number ?? anyOtherReal?.number,
          documentId: matching?.id ?? anyOtherReal?.id,
          conflict: !!requestedNumber && realInvoices.length > 0 && !matching,
        };
      }

      const existingDoc = documents.find(doc => doc.type === documentType);
      if (!existingDoc) {
        return { exists: false, conflict: false };
      }

      const conflict = requestedNumber && existingDoc.number && existingDoc.number !== requestedNumber;
      return {
        exists: true,
        documentNumber: existingDoc.number,
        documentId: existingDoc.id,
        conflict: !!conflict,
      };
    } catch (error: any) {
      console.error(`Error checking existing ${documentType} document:`, error);
      return { exists: false, conflict: false };
    }
  }

  /**
   * Wait for document PDF generation to complete (polls Shopware API)
   * Shopware uses async message queues for PDF generation
   */
  private async waitForDocumentPdfGeneration(documentId: string, maxAttempts = 15): Promise<boolean> {
    const pollInterval = 2000; // 2 seconds
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Fetch the document with associations to check if PDF exists
        const docResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/document/${documentId}`,
          {
            method: 'GET',
            headers: {
              'Content-Type': 'application/json',
            },
          }
        );

        if (docResponse.ok) {
          const docData = await docResponse.json();
          const document = docData.data;
          
          // Check if PDF has been generated (documentMediaFileId exists)
          if (document?.documentMediaFileId) {
            console.log(`[PDF Generation] ✓ PDF generated successfully after ${attempt * 2} seconds`);
            return true;
          }
        }

        // Wait before next attempt
        if (attempt < maxAttempts) {
          console.log(`[PDF Generation] Waiting for PDF generation... (attempt ${attempt}/${maxAttempts})`);
          await new Promise(resolve => setTimeout(resolve, pollInterval));
        }
      } catch (error) {
        console.error(`[PDF Generation] Error checking document status:`, error);
      }
    }

    console.warn(`[PDF Generation] ⚠ PDF generation timeout after ${maxAttempts * 2} seconds. Document created but PDF may still be processing in background.`);
    return false;
  }

  /**
   * Create an invoice document for an order with ERP invoice number and order number
   */
  async createInvoice(
    orderId: string,
    erpInvoiceNumber?: string,
    erpOrderNumber?: string,
    documentDate?: string,
    sent: boolean = true
  ): Promise<{ documentId: string; invoiceNumber: string }> {
    try {
      console.log(`[Shopware API] Creating invoice for order ${orderId} with ERP invoice number: ${erpInvoiceNumber}`);

      // First, get document type ID for invoice
      const docTypeResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: 'invoice',
              },
            ],
          }),
        }
      );

      if (!docTypeResponse.ok) {
        const errorText = await docTypeResponse.text();
        throw new Error(`Failed to get invoice document type: ${docTypeResponse.statusText} - ${errorText}`);
      }

      const docTypeData = await docTypeResponse.json();
      const invoiceDocType = docTypeData.data?.[0];
      
      if (!invoiceDocType) {
        throw new Error('Invoice document type not found in Shopware');
      }

      // Create invoice document using Shopware 6 document API
      // Build config object dynamically to avoid sending undefined values
      const config: any = {
        documentNumber: erpInvoiceNumber || undefined,
        // Optional: override the invoice document date (e.g. original ERP/SAP Fakturadatum)
        documentDate: documentDate || undefined,
      };
      
      // Remove undefined values
      Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);
      
      const requestBody: any = {
        orderId,
        fileType: 'pdf',
        static: false,
        referencedDocumentId: null,
        // ERP-Importe koennen als "nicht verschickt" (sent=false) angelegt werden,
        // da der Versand ueber SAP und nicht ueber den Shop erfolgt.
        sent,
      };
      
      // Only add config if it has values
      if (Object.keys(config).length > 0) {
        requestBody.config = config;
      }
      
      console.log('[Shopware API] Creating invoice with request body:', JSON.stringify(requestBody, null, 2));
      
      const createResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order/document/invoice/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([requestBody]),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[Shopware API] Invoice creation failed:', {
          status: createResponse.status,
          statusText: createResponse.statusText,
          body: errorText,
        });
        
        // Try to parse Shopware error response to extract meaningful error message
        let errorMessage = errorText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.errors && errorData.errors.length > 0) {
            // Extract error detail from Shopware API error format
            const firstError = errorData.errors[0];
            errorMessage = firstError.detail || firstError.title || errorText;
          }
        } catch (e) {
          // If not JSON, use raw error text
          errorMessage = errorText;
        }
        
        throw new Error(`Failed to create invoice: ${errorMessage}`);
      }

      const responseText = await createResponse.text();
      console.log('[Shopware API] Invoice creation response:', responseText);
      
      const parsedResponse = JSON.parse(responseText);
      // Shopware liefert je nach Version entweder ein Array [{documentId,...}]
      // oder ein Objekt { data: [{documentId,...}], errors: [] }.
      const createData = Array.isArray(parsedResponse)
        ? parsedResponse[0]
        : Array.isArray(parsedResponse?.data)
          ? parsedResponse.data[0]
          : parsedResponse?.data ?? parsedResponse;
      if (!createData) {
        throw new Error('No document created - Shopware returned empty response');
      }
      const documentId = createData.documentId || createData.id || createData.data?.id;
      const invoiceNumber = createData.documentNumber || erpInvoiceNumber || '';

      console.log(`[Shopware API] Invoice created successfully: ${invoiceNumber} (Document ID: ${documentId})`);

      // Wait for PDF generation to complete (Shopware uses async message queues)
      if (documentId) {
        console.log(`[PDF Generation] Waiting for invoice PDF generation...`);
        await this.waitForDocumentPdfGeneration(documentId);
      }

      return {
        documentId,
        invoiceNumber,
      };
    } catch (error: any) {
      console.error('Error creating invoice in Shopware:', error);
      throw error;
    }
  }

  /**
   * Create a delivery note document for an order
   */
  async createDeliveryNote(
    orderId: string,
    deliveryNoteNumber?: string,
    erpOrderNumber?: string
  ): Promise<{ documentId: string; deliveryNoteNumber: string }> {
    try {
      console.log(`[Shopware API] Creating delivery note for order ${orderId} with delivery note number: ${deliveryNoteNumber}`);

      // First, get document type ID for delivery_note
      const docTypeResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: 'delivery_note',
              },
            ],
          }),
        }
      );

      if (!docTypeResponse.ok) {
        const errorText = await docTypeResponse.text();
        throw new Error(`Failed to get delivery note document type: ${docTypeResponse.statusText} - ${errorText}`);
      }

      const docTypeData = await docTypeResponse.json();
      const deliveryNoteDocType = docTypeData.data?.[0];
      
      if (!deliveryNoteDocType) {
        throw new Error('Delivery note document type not found in Shopware');
      }

      // Create delivery note document using Shopware 6 document API
      // Build config object dynamically to avoid sending undefined values
      const config: any = {
        documentNumber: deliveryNoteNumber || undefined,
      };
      
      // Remove undefined values
      Object.keys(config).forEach(key => config[key] === undefined && delete config[key]);
      
      const requestBody: any = {
        orderId,
        fileType: 'pdf',
        static: false,
        referencedDocumentId: null,
        sent: true,
      };
      
      // Only add config if it has values
      if (Object.keys(config).length > 0) {
        requestBody.config = config;
      }
      
      console.log('[Shopware API] Creating delivery note with request body:', JSON.stringify(requestBody, null, 2));
      
      const createResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order/document/delivery_note/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([requestBody]),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[Shopware API] Delivery note creation failed:', {
          status: createResponse.status,
          statusText: createResponse.statusText,
          body: errorText,
        });
        
        // Try to parse Shopware error response to extract meaningful error message
        let errorMessage = errorText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.errors && errorData.errors.length > 0) {
            // Extract error detail from Shopware API error format
            const firstError = errorData.errors[0];
            errorMessage = firstError.detail || firstError.title || errorText;
          }
        } catch (e) {
          // If not JSON, use raw error text
          errorMessage = errorText;
        }
        
        throw new Error(`Failed to create delivery note: ${errorMessage}`);
      }

      const responseText = await createResponse.text();
      console.log('[Shopware API] Delivery note creation response:', responseText);
      
      const responseArray = JSON.parse(responseText);
      const [createData] = responseArray;
      if (!createData) {
        throw new Error('No document created - Shopware returned empty response array');
      }
      const documentId = createData.documentId || createData.data?.id;
      const finalDeliveryNoteNumber = createData.documentNumber || deliveryNoteNumber || '';

      console.log(`[Shopware API] Delivery note created successfully: ${finalDeliveryNoteNumber} (Document ID: ${documentId})`);

      // Wait for PDF generation to complete (Shopware uses async message queues)
      if (documentId) {
        console.log(`[PDF Generation] Waiting for delivery note PDF generation...`);
        await this.waitForDocumentPdfGeneration(documentId);
      }

      return {
        documentId,
        deliveryNoteNumber: finalDeliveryNoteNumber,
      };
    } catch (error: any) {
      console.error('Error creating delivery note in Shopware:', error);
      throw error;
    }
  }

  /**
   * Create a proforma invoice document for an order
   * Uses Shopware's own number range (no documentNumber provided)
   */
  async createProformaInvoice(
    orderId: string,
    buyerReference?: string,
    customerComment?: string,
    documentNumber?: string
  ): Promise<{ documentId: string; invoiceNumber: string }> {
    try {
      console.log(`[Shopware API] Creating proforma invoice for order ${orderId}`);

      // First, check if proforma_invoice document type exists in Shopware
      let docTypeTechnicalName = 'proforma_invoice';
      let docTypeResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: 'proforma_invoice',
              },
            ],
          }),
        }
      );

      let docTypeData = await docTypeResponse.json();
      let proformaDocType = docTypeData.data?.[0];
      
      // Fallback: If proforma_invoice doesn't exist, use regular invoice
      if (!proformaDocType) {
        console.log('[Shopware API] proforma_invoice document type not found, falling back to invoice');
        docTypeTechnicalName = 'invoice';
        
        docTypeResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/search/document-type`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              filter: [
                {
                  type: 'equals',
                  field: 'technicalName',
                  value: 'invoice',
                },
              ],
            }),
          }
        );
        
        docTypeData = await docTypeResponse.json();
        proformaDocType = docTypeData.data?.[0];
        
        if (!proformaDocType) {
          throw new Error('Invoice document type not found in Shopware');
        }
      }

      // Create proforma invoice document using Shopware 6 document API
      // IMPORTANT: NO documentNumber provided - Shopware will use its own number range
      const config: any = {
        custom: {
          proforma: true, // Mark as proforma for template
        },
      };
      
      // Add additional custom fields
      if (buyerReference) {
        config.custom.buyerReference = buyerReference;
      }
      if (customerComment) {
        config.custom.customerComment = customerComment;
      }
      if (documentNumber) {
        config.documentNumber = documentNumber;
      }
      
      const requestBody: any = {
        orderId,
        fileType: 'pdf',
        static: false,
        referencedDocumentId: null,
        sent: true,
        config,
      };
      
      console.log('[Shopware API] Creating proforma invoice with request body:', JSON.stringify(requestBody, null, 2));
      
      // Use appropriate endpoint based on document type
      const endpoint = docTypeTechnicalName === 'proforma_invoice' 
        ? `${this.baseUrl}/api/_action/order/document/proforma_invoice/create`
        : `${this.baseUrl}/api/_action/order/document/invoice/create`;
      
      const createResponse = await this.makeAuthenticatedRequest(
        endpoint,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([requestBody]),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[Shopware API] Proforma invoice creation failed:', {
          status: createResponse.status,
          statusText: createResponse.statusText,
          body: errorText,
        });
        
        // Try to parse Shopware error response
        let errorMessage = errorText;
        try {
          const errorData = JSON.parse(errorText);
          if (errorData.errors && errorData.errors.length > 0) {
            const firstError = errorData.errors[0];
            errorMessage = firstError.detail || firstError.title || errorText;
          }
        } catch (e) {
          errorMessage = errorText;
        }
        
        throw new Error(`Failed to create proforma invoice: ${errorMessage}`);
      }

      const responseText = await createResponse.text();
      console.log('[Shopware API] Proforma invoice creation response:', responseText);
      
      const responseJson = JSON.parse(responseText);
      const responseArray = Array.isArray(responseJson)
        ? responseJson
        : Array.isArray(responseJson?.data)
          ? responseJson.data
          : [];
      const [createData] = responseArray;
      if (!createData) {
        throw new Error('No document created - Shopware returned empty response');
      }
      const documentId = createData.documentId || createData.data?.id;
      const invoiceNumber = createData.documentNumber || documentNumber || '';

      console.log(`[Shopware API] Proforma invoice created successfully: ${invoiceNumber} (Document ID: ${documentId})`);

      // Wait for PDF generation to complete
      if (documentId) {
        console.log(`[PDF Generation] Waiting for proforma invoice PDF generation...`);
        await this.waitForDocumentPdfGeneration(documentId);
      }

      return {
        documentId,
        invoiceNumber,
      };
    } catch (error: any) {
      console.error('Error creating proforma invoice in Shopware:', error);
      throw error;
    }
  }

  /**
   * Create a dunning document for an order
   */
  async createDunningDocument(
    orderId: string,
    documentTypeTechnicalName: string,
    stage: number
  ): Promise<{ documentId: string; documentNumber: string }> {
    try {
      console.log(`[Shopware API] Creating dunning document (${documentTypeTechnicalName}) for order ${orderId} (stage ${stage})`);

      const docTypeResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document-type`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: documentTypeTechnicalName,
              },
            ],
          }),
        }
      );

      if (!docTypeResponse.ok) {
        const errorText = await docTypeResponse.text();
        throw new Error(`Failed to get document type ${documentTypeTechnicalName}: ${docTypeResponse.statusText} - ${errorText}`);
      }

      const docTypeData = await docTypeResponse.json();
      const docType = docTypeData.data?.[0];
      if (!docType) {
        throw new Error(`Document type ${documentTypeTechnicalName} not found in Shopware`);
      }

      const config: any = {
        custom: {
          stage,
        },
      };

      const requestBody: any = {
        orderId,
        fileType: 'pdf',
        static: false,
        referencedDocumentId: null,
        sent: true,
        config,
      };

      console.log('[Shopware API] Creating dunning document with request body:', JSON.stringify(requestBody, null, 2));

      const createResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order/document/${documentTypeTechnicalName}/create`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify([requestBody]),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        console.error('[Shopware API] Dunning document creation failed:', {
          status: createResponse.status,
          statusText: createResponse.statusText,
          body: errorText,
        });
        throw new Error(`Failed to create dunning document: ${errorText}`);
      }

      const responseText = await createResponse.text();
      console.log('[Shopware API] Dunning document creation response:', responseText);

      const responseJson = JSON.parse(responseText);
      const responseArray = Array.isArray(responseJson)
        ? responseJson
        : Array.isArray(responseJson?.data)
          ? responseJson.data
          : [];
      const [createData] = responseArray;
      if (!createData) {
        throw new Error('No document created - Shopware returned empty response');
      }

      const documentId = createData.documentId || createData.data?.id;
      const documentNumber = createData.documentNumber || '';

      console.log(`[Shopware API] Dunning document created successfully: ${documentNumber} (Document ID: ${documentId})`);

      if (documentId) {
        console.log(`[PDF Generation] Waiting for dunning document PDF generation...`);
        await this.waitForDocumentPdfGeneration(documentId);
      }

      return {
        documentId,
        documentNumber,
      };
    } catch (error: any) {
      console.error('Error creating dunning document in Shopware:', error);
      throw error;
    }
  }

  /**
   * Upload a PDF to Shopware media and attach it to an order as document so it appears in the order.
   * Step 1: Create media entity. Step 2: Upload binary. Step 3: Create document linked to order + media.
   */
  async uploadOrderDocumentPdf(
    orderId: string,
    pdfBuffer: Buffer,
    fileName: string,
    options?: { preferredTechnicalName?: string; documentNumber?: string },
  ): Promise<{ documentId?: string; documentNumber?: string }> {
    const mediaId = toShopwareUuid(randomUUID());
    console.log(`[Shopware API] uploadOrderDocumentPdf: orderId=${orderId}, fileName=${fileName}, mediaId=${mediaId}`);
    try {
      const mediaPayload: Record<string, unknown> = { id: mediaId };
      const mediaFolderId = await this.getDefaultMediaFolderId();
      if (mediaFolderId) mediaPayload.mediaFolderId = mediaFolderId;

      const createRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/media`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(mediaPayload),
      });
      if (!createRes.ok) {
        const errText = await createRes.text();
        console.error("[Shopware API] Media create failed:", createRes.status, errText);
        throw new Error(`Failed to create media: ${createRes.statusText} - ${errText}`);
      }
      console.log("[Shopware API] Media entity created");

      const uploadUrl = `${this.baseUrl}/api/_action/media/${mediaId}/upload?extension=pdf&fileName=${encodeURIComponent(fileName)}`;
      const uploadRes = await this.makeAuthenticatedRequest(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: pdfBuffer,
      });
      if (!uploadRes.ok) {
        const errText = await uploadRes.text();
        console.error("[Shopware API] Media upload failed:", uploadRes.status, errText);
        throw new Error(`Failed to upload media: ${uploadRes.statusText} - ${errText}`);
      }
      console.log("[Shopware API] PDF binary uploaded");

      const documentTypeId = await this.getDocumentTypeIdForOrderDocument(
        options?.preferredTechnicalName ?? "dunning",
      );
      if (!documentTypeId) {
        console.warn("[Shopware API] No document type dunning/invoice/delivery_note found, PDF is in Media only");
        return {};
      }
      console.log("[Shopware API] Document type id:", documentTypeId);

      const orderVersionId = await this.getOrderVersionId(orderId);
      console.log("[Shopware API] Order versionId:", orderVersionId ?? "(null)");
      const documentId = toShopwareUuid(randomUUID());
      const deepLinkCode = randomUUID().replace(/-/g, "").slice(0, 32);

      const documentPayload = {
        id: documentId,
        orderId,
        orderVersionId: orderVersionId ?? orderId,
        documentTypeId,
        documentMediaFileId: mediaId,
        config: options?.documentNumber ? { documentNumber: options.documentNumber } : {},
        sent: true,
        static: true,
        deepLinkCode,
      };

      const docRes = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/document`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(documentPayload),
      });
      if (!docRes.ok) {
        const errText = await docRes.text();
        console.error("[Shopware API] Document create failed:", docRes.status, errText);
        return {};
      }
      console.log("[Shopware API] Document created, documentId=", documentId);
      return {
        documentId,
        documentNumber:
          options?.documentNumber?.trim() || fileName.replace(/\.pdf$/i, ""),
      };
    } catch (error: any) {
      console.error("[Shopware API] uploadOrderDocumentPdf failed:", error?.message || error);
      throw error;
    }
  }

  private async getDefaultMediaFolderId(): Promise<string | null> {
    try {
      const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/media-folder`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
      });
      if (!res.ok) return null;
      const data = await res.json();
      const id = data?.data?.[0]?.id ?? data?.data?.[0]?.attributes?.id;
      return id ?? null;
    } catch {
      return null;
    }
  }

  private async getDocumentTypeIdForOrderDocument(preferredTechnicalName: string): Promise<string | null> {
    const names = [preferredTechnicalName, "invoice", "delivery_note"].filter(
      (v, i, a) => a.indexOf(v) === i
    );
    for (const name of names) {
      const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/document-type`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: [{ type: "equals", field: "technicalName", value: name }],
        }),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const id = data?.data?.[0]?.id;
      if (id) return id;
    }
    return null;
  }

  private async getOrderVersionId(orderId: string): Promise<string | null> {
    const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: [{ type: "equals", field: "id", value: orderId }],
        limit: 1,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const order = data?.data?.[0];
    if (!order) return null;
    return order.versionId ?? order.attributes?.versionId ?? null;
  }

  /**
   * Set order status to shipped
   */
  async setOrderShipped(orderId: string): Promise<void> {
    try {
      console.log(`[Shopware API] Setting order ${orderId} to shipped status`);

      // First get the "shipped" state machine state ID
      const stateResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/state-machine-state`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'technicalName',
                value: 'shipped',
              },
              {
                type: 'equals',
                field: 'stateMachine.technicalName',
                value: 'order_delivery.state',
              },
            ],
          }),
        }
      );

      if (!stateResponse.ok) {
        const errorText = await stateResponse.text();
        throw new Error(`Failed to get shipped state: ${stateResponse.statusText} - ${errorText}`);
      }

      const stateData = await stateResponse.json();
      const shippedState = stateData.data?.[0];

      if (!shippedState) {
        throw new Error('Shipped state not found in Shopware');
      }

      // Get order deliveries
      const orderResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/order`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'id',
                value: orderId,
              },
            ],
            associations: {
              deliveries: {},
            },
          }),
        }
      );

      if (!orderResponse.ok) {
        const errorText = await orderResponse.text();
        throw new Error(`Failed to get order deliveries: ${orderResponse.statusText} - ${errorText}`);
      }

      const orderData = await orderResponse.json();
      const order = orderData.data?.[0];
      const delivery = order?.deliveries?.data?.[0] || order?.deliveries?.[0];

      if (!delivery) {
        throw new Error('No delivery found for order');
      }

      await this.transitionOrderDeliveryToShipped(orderId, delivery.id);

      console.log(`[Shopware API] Order ${orderId} set to shipped status successfully`);
    } catch (error) {
      console.error('Error setting order to shipped:', error);
      throw error;
    }
  }

  private isMonduPaymentHandler(transaction: any): boolean {
    const handler =
      transaction?.paymentMethod?.handlerIdentifier ??
      transaction?.attributes?.paymentMethod?.handlerIdentifier;
    return typeof handler === "string" && handler.startsWith("Mondu\\MonduPayment\\");
  }

  private getTransactionStateTechnicalName(transaction: any): string | null {
    return (
      transaction?.stateMachineState?.technicalName ??
      transaction?.attributes?.stateMachineState?.technicalName ??
      null
    );
  }

  /**
   * Storniert aeltere Mondu-Transaktionen, wenn im Checkout die Zahlart gewechselt
   * wurde (z. B. Mondu → PayPal). Das Mondu-Plugin wertet sonst oft noch die
   * Historie und blockiert den Lieferstatus "versandt" mit "Corrupt order".
   */
  async cancelSupersededMonduTransactions(orderId: string): Promise<number> {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/order`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filter: [{ type: "equals", field: "id", value: orderId }],
          associations: {
            transactions: {
              associations: { paymentMethod: {}, stateMachineState: {} },
              sort: [{ field: "createdAt", order: "DESC" }],
            },
          },
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to load order transactions for Mondu cleanup: ${response.statusText} - ${errorText}`,
      );
    }

    const data = await response.json();
    const transactions: any[] = data.data?.[0]?.transactions ?? [];
    if (transactions.length <= 1) return 0;

    const sorted = [...transactions].sort((a, b) => {
      const ta = new Date(a?.createdAt ?? a?.attributes?.createdAt ?? 0).getTime();
      const tb = new Date(b?.createdAt ?? b?.attributes?.createdAt ?? 0).getTime();
      return tb - ta;
    });

    const latestId = sorted[0]?.id;
    let cancelled = 0;

    for (const transaction of sorted) {
      if (!transaction?.id || transaction.id === latestId) continue;
      if (!this.isMonduPaymentHandler(transaction)) continue;

      const state = this.getTransactionStateTechnicalName(transaction);
      if (state === "cancelled" || state === "failed") continue;

      const cancelResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order_transaction/${transaction.id}/state/cancel`,
        { method: "POST", body: JSON.stringify({}) },
      );

      if (cancelResponse.ok) {
        cancelled += 1;
        console.log(
          `[Shopware] Cancelled superseded Mondu transaction ${transaction.id} on order ${orderId}`,
        );
      } else {
        const errorText = await cancelResponse.text();
        console.warn(
          `[Shopware] Could not cancel Mondu transaction ${transaction.id} on order ${orderId}: ${cancelResponse.statusText} - ${errorText}`,
        );
      }
    }

    return cancelled;
  }

  /**
   * Lieferung auf "versandt" setzen. Bei Zahlartwechsel (historische Mondu-Transaktion,
   * aktive Zahlart nicht Mondu) wird bei Mondu-Plugin-Fehler zuerst aufgeraeumt und
   * erneut versucht.
   */
  async transitionOrderDeliveryToShipped(orderId: string, deliveryId: string): Promise<void> {
    const monduInfo = await this.getMonduShipInfo(orderId);
    if (
      monduInfo.deliveryState === "shipped" ||
      monduInfo.deliveryState === "shipped_partially"
    ) {
      return;
    }

    const shipOnce = async () => {
      const stateResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order_delivery/${deliveryId}/state/ship`,
        { method: "POST", body: JSON.stringify({}) },
      );
      if (!stateResponse.ok) {
        const errorText = await stateResponse.text();
        throw new Error(
          `Failed to set order to shipped: ${stateResponse.statusText} - ${errorText}`,
        );
      }
    };

    try {
      await shipOnce();
      return;
    } catch (firstError) {
      const message = firstError instanceof Error ? firstError.message : String(firstError);
      if (
        !monduInfo.isMondu &&
        monduInfo.hasHistoricalMonduTransaction &&
        isMonduPluginShipError(message)
      ) {
        console.log(
          `[Shopware] Mondu plugin blocked ship for order ${orderId} ` +
            `(active payment: ${monduInfo.activePaymentMethod ?? "?"}), cleaning stale Mondu transactions…`,
        );
        const cancelled = await this.cancelSupersededMonduTransactions(orderId);
        if (cancelled > 0) {
          try {
            await shipOnce();
            console.log(
              `[Shopware] Ship succeeded for order ${orderId} after cancelling ${cancelled} stale Mondu transaction(s)`,
            );
            return;
          } catch (retryError) {
            const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
            throw new Error(`MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH: ${retryMsg}`);
          }
        }
        throw new Error(`MONDU_SHIP_BLOCKED_AFTER_PAYMENT_SWITCH: ${message}`);
      }
      throw firstError;
    }
  }

  /**
   * Ermittelt, ob es sich um eine Mondu-Bestellung handelt (Zahlart-Handler aus
   * dem offiziellen Mondu-Plugin, z. B. Mondu\MonduPayment\...\MonduHandler) und
   * liefert die erste Lieferung samt aktuellem Lieferstatus.
   *
   * Hintergrund: Das Mondu-Plugin uebergibt die Rechnung NUR beim Lieferstatus-
   * Uebergang auf "versandt" mit genau einem angehaengten Rechnungsdokument an
   * Mondu (entspricht dem Haken "Rechnung anhaengen"). Reine Mailversand-Hooks
   * gibt es nicht.
   */
  async getMonduShipInfo(orderId: string): Promise<{
    isMondu: boolean;
    deliveryId: string | null;
    deliveryState: string | null;
    /** Name der aktuell gueltigen Zahlart (juengste Transaktion). */
    activePaymentMethod?: string | null;
    /** true, wenn aeltere Transaktionen noch Mondu waren (Checkout-Zahlart gewechselt). */
    hasHistoricalMonduTransaction?: boolean;
  }> {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/order`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filter: [{ type: 'equals', field: 'id', value: orderId }],
          associations: {
            transactions: {
              associations: { paymentMethod: {} },
              sort: [{ field: 'createdAt', order: 'DESC' }],
            },
            deliveries: { associations: { stateMachineState: {} } },
          },
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to load order for Mondu check: ${response.statusText} - ${errorText}`
      );
    }

    const data = await response.json();
    const order = data.data?.[0];

    const transactions: any[] = order?.transactions ?? [];
    const sortedTransactions = [...transactions].sort((a, b) => {
      const ta = new Date(a?.createdAt ?? a?.attributes?.createdAt ?? 0).getTime();
      const tb = new Date(b?.createdAt ?? b?.attributes?.createdAt ?? 0).getTime();
      return tb - ta;
    });

    const isMonduHandler = (t: any): boolean => this.isMonduPaymentHandler(t);

    const latestTransaction = sortedTransactions[0];
    const isMondu = latestTransaction ? isMonduHandler(latestTransaction) : false;
    const hasHistoricalMonduTransaction =
      !isMondu && sortedTransactions.some((t) => isMonduHandler(t));

    const activePaymentMethod =
      latestTransaction?.paymentMethod?.translated?.name ??
      latestTransaction?.paymentMethod?.name ??
      null;

    const delivery = order?.deliveries?.[0];
    const deliveryState =
      delivery?.stateMachineState?.technicalName ?? null;

    if (hasHistoricalMonduTransaction) {
      console.log(
        `[Mondu] Order ${orderId}: aktive Zahlart "${activePaymentMethod ?? "?"}" ist nicht Mondu, ` +
          `aber aeltere Mondu-Transaktion(en) vorhanden — Rechnungsversand per E-Mail.`,
      );
    }

    return {
      isMondu,
      deliveryId: delivery?.id ?? null,
      deliveryState,
      activePaymentMethod,
      hasHistoricalMonduTransaction,
    };
  }

  /**
   * Setzt eine Lieferung auf "versandt" und haengt die uebergebenen Dokumente an
   * (documentIds). Shopware legt daraus die Context-Extension "mail-attachments"
   * an; das Mondu-Plugin liest daraus genau ein Rechnungsdokument und uebertraegt
   * die Rechnung an Mondu (Aequivalent zum Haken "Rechnung anhaengen"). Zusaetzlich
   * loest der Uebergang den konfigurierten Shopware-Flow aus (Versandmail an den
   * Kunden, ggf. Bestellung -> abgeschlossen).
   */
  async shipDeliveryWithDocuments(deliveryId: string, documentIds: string[]): Promise<void> {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order_delivery/${deliveryId}/state/ship`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentIds, mediaIds: [] }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to ship delivery ${deliveryId}: ${response.statusText} - ${errorText}`
      );
    }
  }

  /**
   * Cache fuer den fixen Versand-SalesChannel (META Regalbau DE). Rechnungsmails
   * werden ausschliesslich aus diesem Channel verschickt (senderName/Absender =
   * "META Regalbau DE"), unabhaengig vom urspruenglichen Bestell-Channel (z. B. AT).
   */
  private invoiceSenderChannelCache: any | null = null;

  /**
   * Ermittelt den SalesChannel, aus dem Rechnungsmails versendet werden sollen.
   * Aufloesung: ENV SHOPWARE_INVOICE_SALES_CHANNEL_ID -> Name "META Regalbau DE"
   * -> bekannte Default-ID. Liefert die Entitaet inkl. domains-Association.
   */
  private async getInvoiceSenderSalesChannel(): Promise<any | null> {
    if (this.invoiceSenderChannelCache) return this.invoiceSenderChannelCache;

    const envId = process.env.SHOPWARE_INVOICE_SALES_CHANNEL_ID?.trim();
    const targetName = (process.env.SHOPWARE_INVOICE_SALES_CHANNEL_NAME || 'META Regalbau DE').trim();
    const fallbackId = '018ec134507f703b82a76467791e7e61'; // META Regalbau DE

    const fetchById = async (id: string): Promise<any | null> => {
      const res = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/sales-channel`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: [{ type: 'equals', field: 'id', value: id }],
            associations: { domains: {} },
            limit: 1,
          }),
        },
      );
      if (!res.ok) return null;
      const d = await res.json();
      return d?.data?.[0] ?? null;
    };

    let channel: any | null = null;
    if (envId) channel = await fetchById(envId);

    if (!channel) {
      const res = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/sales-channel`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: [{ type: 'equals', field: 'name', value: targetName }],
            associations: { domains: {} },
            limit: 1,
          }),
        },
      );
      if (res.ok) {
        const d = await res.json();
        channel = d?.data?.[0] ?? null;
      }
    }

    if (!channel) channel = await fetchById(fallbackId);

    if (channel) this.invoiceSenderChannelCache = channel;
    return channel;
  }

  /**
   * Laedt den fuer den Mailversand noetigen Kontext einer Bestellung:
   * SalesChannel, Sprache und Empfaenger (Kunden-E-Mail/Name) sowie die
   * Order-/SalesChannel-Entitaeten als mailTemplateData fuer das Twig-Rendering.
   *
   * Wichtig: Der Versand erfolgt grundsaetzlich aus dem DE-Channel
   * (META Regalbau DE), nicht aus dem Bestell-Channel. Dadurch ist der Absender
   * immer "META Regalbau DE" (Template-senderName = {{ salesChannel.name }}).
   */
  private async getInvoiceMailContext(orderId: string): Promise<{
    order: any;
    salesChannel: any;
    salesChannelId: string;
    languageId?: string;
    recipientEmail?: string;
    recipientName?: string;
  }> {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/order`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: [{ type: 'equals', field: 'id', value: orderId }],
          associations: {
            // salutation wird vom Twig-Rechnungstemplate genutzt
            // (order.orderCustomer.salutation.translated.letterName)
            orderCustomer: { associations: { salutation: {} } },
            // domains wird im a11y-Block des Templates referenziert
            // (salesChannel.domains|first.url)
            salesChannel: { associations: { domains: {} } },
            billingAddress: {},
            deliveries: {},
            lineItems: {},
            transactions: {},
            currency: {},
            language: {},
            addresses: {},
          },
          limit: 1,
        }),
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to load order for mail: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const order = data?.data?.[0];
    if (!order) {
      throw new Error(`Order ${orderId} not found while preparing invoice mail`);
    }

    const oc = order.orderCustomer ?? {};
    const recipientEmail: string | undefined = oc.email ?? undefined;
    const recipientName =
      [oc.firstName, oc.lastName].filter(Boolean).join(' ').trim() || recipientEmail;

    // Rechnungsmails werden ausschliesslich aus dem DE-Channel verschickt.
    const senderChannel = await this.getInvoiceSenderSalesChannel();
    const sendSalesChannel = senderChannel ?? order.salesChannel ?? null;
    const sendSalesChannelId = senderChannel?.id ?? order.salesChannelId;
    const sendLanguageId = senderChannel?.languageId ?? order.languageId;

    if (!senderChannel) {
      console.warn(
        '[Shopware API] DE-Versand-SalesChannel (META Regalbau DE) nicht gefunden – ' +
          `falle auf Bestell-Channel ${order.salesChannelId} zurueck.`,
      );
    }

    return {
      // Bestelldaten bleiben aus der echten Bestellung; nur der Absende-Channel
      // wird auf DE gesetzt (mailTemplateData.salesChannel => senderName = DE).
      order,
      salesChannel: sendSalesChannel,
      salesChannelId: sendSalesChannelId,
      languageId: sendLanguageId,
      recipientEmail,
      recipientName,
    };
  }

  /**
   * Sucht die in Shopware hinterlegte Rechnungs-Mailvorlage (mail_template_type
   * "document_invoice"). Bevorzugt die dem SalesChannel zugewiesene Vorlage,
   * sonst die System-Default-Vorlage. Robuste Fallbacks fuer abweichende
   * technicalNames.
   */
  private async getInvoiceMailTemplate(
    salesChannelId?: string,
    languageId?: string,
  ): Promise<{
    id?: string;
    subject: string;
    contentHtml: string;
    contentPlain: string;
    senderName: string;
  } | null> {
    const extraHeaders: Record<string, string> = {};
    if (languageId) extraHeaders['sw-language-id'] = languageId;

    // Hinweis: mail_template hat in dieser Shopware-Version KEINE "salesChannels"-
    // Association (führt zu 500). Daher nur ueber den mail_template_type selektieren.
    const queryTemplates = async (technicalName: string): Promise<any[]> => {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/mail-template`,
        {
          method: 'POST',
          headers: extraHeaders,
          body: JSON.stringify({
            filter: [
              { type: 'equals', field: 'mailTemplateType.technicalName', value: technicalName },
            ],
            associations: { mailTemplateType: {} },
            limit: 50,
          }),
        }
      );
      if (!response.ok) {
        const errorText = await response.text();
        console.warn(
          `[Shopware API] mail-template lookup (${technicalName}) failed: ${response.status} - ${errorText}`,
        );
        return [];
      }
      const data = await response.json();
      return Array.isArray(data?.data) ? data.data : [];
    };

    // 1) Bekannte technicalNames fuer Rechnungs-Mailvorlagen (versionsabhaengig).
    let templates: any[] = [];
    for (const tn of ['invoice_mail', 'document_invoice']) {
      templates = await queryTemplates(tn);
      if (templates.length > 0) break;
    }

    // 2) Fallback: passenden mail_template_type per Heuristik ermitteln.
    if (templates.length === 0) {
      const typesResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/mail-template-type`,
        { method: 'POST', body: JSON.stringify({ limit: 500 }) }
      );
      if (typesResponse.ok) {
        const typesData = await typesResponse.json();
        const types: any[] = Array.isArray(typesData?.data) ? typesData.data : [];
        const match = types.find((t) => {
          const tn = String(t?.technicalName ?? '').toLowerCase();
          return (
            tn.includes('invoice') &&
            !tn.includes('credit') &&
            !tn.includes('cancel') &&
            !tn.includes('storno')
          );
        });
        if (match?.technicalName) {
          templates = await queryTemplates(match.technicalName);
        }
      }
    }

    if (templates.length === 0) return null;

    // Mehrere Vorlagen gleichen Typs moeglich (z. B. zusaetzliche "Reminder"-Vorlage).
    // Reminder/Mahnungs-Vorlagen aussortieren, damit die echte Rechnungsmail genutzt wird.
    const looksLikeReminder = (tpl: any) => {
      const s = `${tpl?.subject ?? tpl?.translated?.subject ?? ''} ${
        tpl?.name ?? tpl?.translated?.name ?? ''
      }`.toLowerCase();
      return (
        s.includes('reminder') ||
        s.includes('erinner') ||
        s.includes('mahn') ||
        s.includes('payment reminder')
      );
    };

    const preferred = templates.filter((t) => !looksLikeReminder(t));
    const chosen = preferred[0] ?? templates[0];

    const t = chosen.translated ?? {};
    return {
      id: chosen.id,
      subject: chosen.subject ?? t.subject ?? '',
      contentHtml: chosen.contentHtml ?? t.contentHtml ?? '',
      contentPlain: chosen.contentPlain ?? t.contentPlain ?? '',
      senderName: chosen.senderName ?? t.senderName ?? '',
    };
  }

  /**
   * Verschickt die Rechnung per Mail an den Kunden ueber die native
   * Shopware-Funktion (POST /api/_action/mail-template/send). Das angehaengte
   * Dokument wird als PDF mitgesendet. Die "echte" Markierung document.sent=true
   * erfolgt anschliessend ueber setDocumentSent() im aufrufenden Service.
   */
  async sendInvoiceEmail(orderId: string, documentId: string): Promise<void> {
    try {
      console.log(
        `[Shopware API] Sending invoice email for order ${orderId}, document ${documentId}`,
      );

      const ctx = await this.getInvoiceMailContext(orderId);
      if (!ctx.recipientEmail) {
        throw new Error(`Keine Kunden-E-Mail fuer Bestellung ${orderId} gefunden`);
      }
      if (!ctx.salesChannelId) {
        throw new Error(`Bestellung ${orderId} hat keinen SalesChannel`);
      }

      const template = await this.getInvoiceMailTemplate(ctx.salesChannelId, ctx.languageId);
      if (!template) {
        throw new Error(
          'Keine Rechnungs-Mailvorlage (mail_template_type "invoice_mail"/"document_invoice") in Shopware gefunden. ' +
            'Bitte in Shopware unter Einstellungen → E-Mail-Vorlagen eine Rechnungsvorlage anlegen.',
        );
      }

      const extraHeaders: Record<string, string> = {};
      if (ctx.languageId) extraHeaders['sw-language-id'] = ctx.languageId;

      // Absenderadresse fuer Rechnungsmails fix auf shop@meta-online.com
      // (ueberschreibt die SalesChannel-Adresse; Absendername bleibt via Template
      // {{ salesChannel.name }} = "META Regalbau DE"). Per ENV ueberschreibbar.
      const senderEmail =
        process.env.SHOPWARE_INVOICE_SENDER_EMAIL?.trim() || 'shop@meta-online.com';

      const payload: Record<string, unknown> = {
        recipients: { [ctx.recipientEmail]: ctx.recipientName ?? ctx.recipientEmail },
        senderEmail,
        salesChannelId: ctx.salesChannelId,
        contentHtml: template.contentHtml,
        contentPlain: template.contentPlain,
        subject: template.subject,
        senderName: template.senderName,
        mediaIds: [],
        documentIds: [documentId],
        mailTemplateData: {
          order: ctx.order,
          salesChannel: ctx.salesChannel,
          // a11yDocuments wird vom Rechnungstemplate referenziert
          // ({% if a11yDocuments %}/{% for a11y in a11yDocuments %}). Fehlt die
          // Variable, scheitert das Twig-Rendering und Shopware liefert size:0
          // zurueck (Mail wird NICHT erzeugt/versendet, ohne Fehlerstatus).
          a11yDocuments: [],
        },
      };
      if (template.id) payload.templateId = template.id;

      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/mail-template/send`,
        {
          method: 'POST',
          headers: extraHeaders,
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to send invoice email: ${response.statusText} - ${errorText}`);
      }

      // Shopware antwortet mit { size: <Laenge des erzeugten Mailbodys> }.
      // size === 0 bedeutet: das Twig-Rendering ist fehlgeschlagen und es wurde
      // KEINE Mail erzeugt/versendet (z. B. fehlende Template-Variablen). Das
      // muss als Fehler behandelt werden, sonst entsteht ein False-Positive.
      let mailSize: number | null = null;
      try {
        const result = await response.json();
        if (result && typeof result.size === 'number') mailSize = result.size;
      } catch {
        // Body nicht parsebar -> size unbekannt, weiter unten als Fehler behandeln.
      }

      if (mailSize === 0) {
        throw new Error(
          `Shopware hat keine Mail erzeugt (size=0). Das Rendering der Rechnungs-Mailvorlage ` +
            `ist vermutlich fehlgeschlagen (fehlende Template-Variablen/Associations). ` +
            `Es wurde KEINE Mail versendet.`,
        );
      }

      console.log(
        `[Shopware API] Invoice email sent for order ${orderId} from ${senderEmail} to ${ctx.recipientEmail} (size=${mailSize ?? 'unbekannt'})`,
      );
    } catch (error) {
      console.error('Error sending invoice email:', error);
      throw error;
    }
  }

  /**
   * Liest den aktuellen sent-Status eines einzelnen Dokuments direkt aus
   * Shopware (Verifikation nach dem Versand).
   */
  async getDocumentSentStatus(documentId: string): Promise<boolean | null> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: [{ type: 'equals', field: 'id', value: documentId }],
            includes: { document: ['id', 'sent'] },
            limit: 1,
          }),
        }
      );
      if (!response.ok) return null;
      const data = await response.json();
      const doc = data?.data?.[0];
      if (!doc) return null;
      const sent = doc.sent ?? doc.attributes?.sent;
      return sent === true;
    } catch (error) {
      console.warn(`[Shopware API] Could not read sent status for document ${documentId}:`, error);
      return null;
    }
  }
}
