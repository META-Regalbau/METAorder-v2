import { getSharedShopwareToken, invalidateSharedShopwareToken, isShopwareAuthPaused } from "./shopwareTokenCache";
import { cachedMissingEntityResponse, traceShopwareResponse } from "./shopwareHttpTrace";
import type { ShopwareSettings } from "@shared/schema";
import * as ordersApi from "./client/orders";
import * as deliveryApi from "./client/delivery";
import * as documentsApi from "./client/documents";
import * as productsApi from "./client/products";
import * as crossSellingApi from "./client/crossSelling";
import * as customersApi from "./client/customers";
import * as pricingApi from "./client/pricing";
import * as offersApi from "./client/offers";
import * as masterDataApi from "./client/masterData";
import { logger } from "../lib/logger";

const log = logger.child({ component: "shopware/shopware" });

// Bisherige oeffentliche Exporte dieser Datei bleiben erhalten.
export type { ShopwarePriceEntry, ShopwareAdvancedPrice, ShopwareChannelVisibility, ShopwareProductOverview, ProductPriceResetRow, ShopwareCustomerPrice, EnrichedShopwareCustomerPrice, ProductCrmSellingContext, ProductAdvancedPricingDetails, OrderDocument, ParsedProductDeliveryTime } from "./client/types";
export { SHOPWARE_ADMIN_SEARCH_PAGE_SIZE, applyOverviewParentInheritance, isShopwareEntityId, normalizeShopwareEntityId, isProformaOrVorkasse, getRealInvoiceDocument, isMonduPluginShipError, ZUGFERD_EMBEDDED_INVOICE_TYPE } from "./client/mapping";

/**
 * Shopware-Admin-API-Client. Hier liegen nur Kern (Felder, Konstruktor, Authentifizierung, HTTP)
 * und generische Helfer; die fachlichen Methoden liegen je Ressource in ./client/*.ts und werden
 * unten am Prototyp installiert. Felder/Kern-Methoden ohne `private`, weil diese Module per
 * `this` darauf zugreifen - von aussen trotzdem nicht direkt verwenden.
 */
export class ShopwareClient {
  baseUrl: string;
  private publicBaseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  currencyIdCache = new Map<string, string>();

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

  resolveMediaUrl(url?: string | null): string {
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

  /** Löst Shopware-Media-IDs zu öffentlichen URLs auf (id -> url). Für Bild-Vorschauen. */
  async fetchMediaUrlsByIds(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean).map((id) => String(id)))];
    if (unique.length === 0) return {};
    const result: Record<string, string> = {};
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/media`, {
        method: "POST",
        body: JSON.stringify({
          limit: unique.length,
          filter: [{ type: "equalsAny", field: "id", value: unique }],
          includes: { media: ["id", "url"] },
        }),
      });
      if (!response.ok) return {};
      const data = await response.json();
      for (const raw of data.data || []) {
        const item = raw.attributes || raw;
        const id = raw.id || item.id;
        const url = item.url;
        if (id && url) result[String(id)] = this.resolveMediaUrl(String(url));
      }
    } catch (error: any) {
      log.warn({ err: error }, "[Shopware] fetchMediaUrlsByIds:");
    }
    return result;
  }

  async authenticate(): Promise<string> {
    // Instanz-Cache zuerst; sonst gemeinsames Token (siehe shopwareTokenCache.ts)
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const shared = await getSharedShopwareToken(this.baseUrl, this.apiKey, this.apiSecret);
      this.accessToken = shared.token;
      this.tokenExpiry = shared.expiresAt;
      return shared.token;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      // Anmeldung pausiert (abgelehnte Zugangsdaten/Drosselung): schon einmal geloggt, Meldung unveraendert weiter
      if (isShopwareAuthPaused(error)) throw error;
      log.error({ err: error }, "Shopware authentication error:");
      throw new Error('Failed to authenticate with Shopware API');
    }
  }

  async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    const knownMissing = cachedMissingEntityResponse(url);
    if (knownMissing) return knownMissing;
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
      invalidateSharedShopwareToken(this.baseUrl, this.apiKey, this.apiSecret);
      token = await this.authenticate();
      
      const retryHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      };
      
      const retry = await fetch(url, {
        ...options,
        headers: retryHeaders,
      });
      return traceShopwareResponse(url, { ...options, headers: retryHeaders }, retry);
    }

    return traceShopwareResponse(url, { ...options, headers }, response);
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
      log.error({ err: error }, "Connection test failed:");
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
        log.error({ err: error }, `[ShopwareClient] Failed fetching ${endpoint.source}:`);
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
        "total-count-mode": 1,
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
      if (!isShopwareAuthPaused(error)) log.error({ err: error }, `[Shopware] fetchEntitySearchFingerprint(${entity}) failed:`);
      return null;
    }
  }

  static normalizePriceCurrencyIso(iso: string | null | undefined): string {
    return (iso || "EUR").toUpperCase();
  }

  /**
   * Cache fuer den fixen Versand-SalesChannel (META Regalbau DE). Rechnungsmails
   * werden ausschliesslich aus diesem Channel verschickt (senderName/Absender =
   * "META Regalbau DE"), unabhaengig vom urspruenglichen Bestell-Channel (z. B. AT).
   */
  invoiceSenderChannelCache: any | null = null;
}

// Methoden der Ressourcen-Module: fuer TypeScript per Interface-Merging deklariert,
// zur Laufzeit wie normale Klassenmethoden (nicht aufzaehlbar) am Prototyp installiert.
export interface ShopwareClient {
  // orders
  mapShopwareStatus: typeof ordersApi.mapShopwareStatus;
  mapPaymentStatus: typeof ordersApi.mapPaymentStatus;
  extractInvoiceDateFromDocuments: typeof ordersApi.extractInvoiceDateFromDocuments;
  extractInvoiceInfoFromDocuments: typeof ordersApi.extractInvoiceInfoFromDocuments;
  isPaymentOverdue: typeof ordersApi.isPaymentOverdue;
  fetchOrders: typeof ordersApi.fetchOrders;
  fetchInvoiceInfoByOrderIds: typeof ordersApi.fetchInvoiceInfoByOrderIds;
  fetchLatestOrderMeta: typeof ordersApi.fetchLatestOrderMeta;
  fetchOrdersFingerprintDetails: typeof ordersApi.fetchOrdersFingerprintDetails;
  fetchOrdersFingerprint: typeof ordersApi.fetchOrdersFingerprint;
  fetchOrdersByIds: typeof ordersApi.fetchOrdersByIds;
  fetchCustomerOrderHistory: typeof ordersApi.fetchCustomerOrderHistory;
  fetchOrderById: typeof ordersApi.fetchOrderById;
  fetchOrderByNumber: typeof ordersApi.fetchOrderByNumber;
  fetchAllOrderIds: typeof ordersApi.fetchAllOrderIds;
  findOrderCustomersByCustomerId: typeof ordersApi.findOrderCustomersByCustomerId;
  reassignOrderCustomer: typeof ordersApi.reassignOrderCustomer;
  createOrder: typeof ordersApi.createOrder;
  markOrderPaid: typeof ordersApi.markOrderPaid;
  getOrderVersionId: typeof ordersApi.getOrderVersionId;
  // delivery
  updateOrderShipping: typeof deliveryApi.updateOrderShipping;
  setOrderShipped: typeof deliveryApi.setOrderShipped;
  isMonduPaymentHandler: typeof deliveryApi.isMonduPaymentHandler;
  getTransactionStateTechnicalName: typeof deliveryApi.getTransactionStateTechnicalName;
  cancelSupersededMonduTransactions: typeof deliveryApi.cancelSupersededMonduTransactions;
  transitionOrderDeliveryToShipped: typeof deliveryApi.transitionOrderDeliveryToShipped;
  fetchDeliveryShippedDates: typeof deliveryApi.fetchDeliveryShippedDates;
  getMonduShipInfo: typeof deliveryApi.getMonduShipInfo;
  shipDeliveryWithDocuments: typeof deliveryApi.shipDeliveryWithDocuments;
  // documents
  downloadDocumentPdf: typeof documentsApi.downloadDocumentPdf;
  downloadDocumentPdfBuffer: typeof documentsApi.downloadDocumentPdfBuffer;
  fetchOrderAmountTotalForVersion: typeof documentsApi.fetchOrderAmountTotalForVersion;
  fetchOrderDocuments: typeof documentsApi.fetchOrderDocuments;
  fetchDocumentsByOrderIds: typeof documentsApi.fetchDocumentsByOrderIds;
  downloadInvoicePdf: typeof documentsApi.downloadInvoicePdf;
  updateOrderDocumentNumbers: typeof documentsApi.updateOrderDocumentNumbers;
  setDocumentSent: typeof documentsApi.setDocumentSent;
  checkExistingDocument: typeof documentsApi.checkExistingDocument;
  waitForDocumentPdfGeneration: typeof documentsApi.waitForDocumentPdfGeneration;
  createInvoice: typeof documentsApi.createInvoice;
  createDeliveryNote: typeof documentsApi.createDeliveryNote;
  createProformaInvoice: typeof documentsApi.createProformaInvoice;
  createDunningDocument: typeof documentsApi.createDunningDocument;
  uploadOrderDocumentPdf: typeof documentsApi.uploadOrderDocumentPdf;
  getDefaultMediaFolderId: typeof documentsApi.getDefaultMediaFolderId;
  getDocumentTypeIdForOrderDocument: typeof documentsApi.getDocumentTypeIdForOrderDocument;
  getInvoiceSenderSalesChannel: typeof documentsApi.getInvoiceSenderSalesChannel;
  getInvoiceMailContext: typeof documentsApi.getInvoiceMailContext;
  getInvoiceMailTemplate: typeof documentsApi.getInvoiceMailTemplate;
  sendInvoiceEmail: typeof documentsApi.sendInvoiceEmail;
  getDocumentSentStatus: typeof documentsApi.getDocumentSentStatus;
  // products
  fetchProducts: typeof productsApi.fetchProducts;
  fetchProductsOverviewPage: typeof productsApi.fetchProductsOverviewPage;
  fetchProductsChangedSince: typeof productsApi.fetchProductsChangedSince;
  fetchAllProductIds: typeof productsApi.fetchAllProductIds;
  fetchActiveProductCatalogFingerprint: typeof productsApi.fetchActiveProductCatalogFingerprint;
  searchProductsByIdentifiersIncludeInactive: typeof productsApi.searchProductsByIdentifiersIncludeInactive;
  fetchProductsForDataQuality: typeof productsApi.fetchProductsForDataQuality;
  fetchProductDataQuality: typeof productsApi.fetchProductDataQuality;
  setProductActive: typeof productsApi.setProductActive;
  setProductStock: typeof productsApi.setProductStock;
  iterateAllProductsForPriceReset: typeof productsApi.iterateAllProductsForPriceReset;
  bulkPatchProductPrices: typeof productsApi.bulkPatchProductPrices;
  bulkPatchProductPurchasePrices: typeof productsApi.bulkPatchProductPurchasePrices;
  loadIfsProductNumberCatalog: typeof productsApi.loadIfsProductNumberCatalog;
  searchProductsByIfsProductNumbers: typeof productsApi.searchProductsByIfsProductNumbers;
  searchProductsByProductNumbers: typeof productsApi.searchProductsByProductNumbers;
  uploadProductGlbMedia: typeof productsApi.uploadProductGlbMedia;
  fetchProductActiveStatus: typeof productsApi.fetchProductActiveStatus;
  fetchProductCategoryIds: typeof productsApi.fetchProductCategoryIds;
  setProductCategories: typeof productsApi.setProductCategories;
  fetchProductSalesChannelIds: typeof productsApi.fetchProductSalesChannelIds;
  setProductSalesChannels: typeof productsApi.setProductSalesChannels;
  applyProductVisibilityChanges: typeof productsApi.applyProductVisibilityChanges;
  fetchProductPricesBatch: typeof productsApi.fetchProductPricesBatch;
  fetchProductsByNumbers: typeof productsApi.fetchProductsByNumbers;
  fetchProductsByIds: typeof productsApi.fetchProductsByIds;
  // crossSelling
  fetchProductCrossSelling: typeof crossSellingApi.fetchProductCrossSelling;
  fetchCrossSellingProducts: typeof crossSellingApi.fetchCrossSellingProducts;
  createProductCrossSelling: typeof crossSellingApi.createProductCrossSelling;
  assignProductsToCrossSelling: typeof crossSellingApi.assignProductsToCrossSelling;
  removeProductsFromCrossSelling: typeof crossSellingApi.removeProductsFromCrossSelling;
  deleteProductCrossSelling: typeof crossSellingApi.deleteProductCrossSelling;
  fetchCrossSellingAssignments: typeof crossSellingApi.fetchCrossSellingAssignments;
  syncCrossSellingAssignments: typeof crossSellingApi.syncCrossSellingAssignments;
  searchCrossSellingGroups: typeof crossSellingApi.searchCrossSellingGroups;
  // customers
  fetchCustomerCounts: typeof customersApi.fetchCustomerCounts;
  fetchCustomersChangedSince: typeof customersApi.fetchCustomersChangedSince;
  fetchAllCustomerIds: typeof customersApi.fetchAllCustomerIds;
  fetchBestandskundenFingerprint: typeof customersApi.fetchBestandskundenFingerprint;
  fetchBestandskundenIndex: typeof customersApi.fetchBestandskundenIndex;
  findCustomerByEmail: typeof customersApi.findCustomerByEmail;
  findCustomersByEmail: typeof customersApi.findCustomersByEmail;
  searchCustomers: typeof customersApi.searchCustomers;
  fetchCustomerSalesChannelId: typeof customersApi.fetchCustomerSalesChannelId;
  searchExistingCustomers: typeof customersApi.searchExistingCustomers;
  getCustomerById: typeof customersApi.getCustomerById;
  deactivateCustomer: typeof customersApi.deactivateCustomer;
  fetchCustomerBillingForPdf: typeof customersApi.fetchCustomerBillingForPdf;
  createCustomer: typeof customersApi.createCustomer;
  portalCustomerWriteHeaders: typeof customersApi.portalCustomerWriteHeaders;
  createB2BPortalCustomer: typeof customersApi.createB2BPortalCustomer;
  nextCustomerNumber: typeof customersApi.nextCustomerNumber;
  updateB2BPortalCustomerBillingAddress: typeof customersApi.updateB2BPortalCustomerBillingAddress;
  updateB2BPortalCustomer: typeof customersApi.updateB2BPortalCustomer;
  getPortalCustomerByEmail: typeof customersApi.getPortalCustomerByEmail;
  getPortalCustomerById: typeof customersApi.getPortalCustomerById;
  mapPortalCustomerSnapshot: typeof customersApi.mapPortalCustomerSnapshot;
  testStorefrontLogin: typeof customersApi.testStorefrontLogin;
  // pricing
  fetchCustomerPriceStats: typeof pricingApi.fetchCustomerPriceStats;
  fetchCustomerPricesChangedSince: typeof pricingApi.fetchCustomerPricesChangedSince;
  fetchCustomerSpecificPrices: typeof pricingApi.fetchCustomerSpecificPrices;
  fetchAllCustomerSpecificPrices: typeof pricingApi.fetchAllCustomerSpecificPrices;
  fetchCustomerB2BStandardDiscount: typeof pricingApi.fetchCustomerB2BStandardDiscount;
  fetchProductListAndCatalogNetPrices: typeof pricingApi.fetchProductListAndCatalogNetPrices;
  fetchProductHerstellpreisLookupKeys: typeof pricingApi.fetchProductHerstellpreisLookupKeys;
  fillHerstellpreisLookupKeys: typeof pricingApi.fillHerstellpreisLookupKeys;
  fetchProductCrmSellingContext: typeof pricingApi.fetchProductCrmSellingContext;
  lookupProductPricing: typeof pricingApi.lookupProductPricing;
  enrichCustomerSpecificPricesWithDiscounts: typeof pricingApi.enrichCustomerSpecificPricesWithDiscounts;
  fetchProductAdvancedPricing: typeof pricingApi.fetchProductAdvancedPricing;
  fetchCustomerPriceCurrencies: typeof pricingApi.fetchCustomerPriceCurrencies;
  resolveCurrencyId: typeof pricingApi.resolveCurrencyId;
  buildCustomerPriceCurrencyFilter: typeof pricingApi.buildCustomerPriceCurrencyFilter;
  filterPricesByCurrency: typeof pricingApi.filterPricesByCurrency;
  getCustomerPriceEntityCandidates: typeof pricingApi.getCustomerPriceEntityCandidates;
  fetchIndividualPriceCustomerIndex: typeof pricingApi.fetchIndividualPriceCustomerIndex;
  fetchIndividualPriceDiagnostics: typeof pricingApi.fetchIndividualPriceDiagnostics;
  fetchIndividualPriceCustomerFingerprint: typeof pricingApi.fetchIndividualPriceCustomerFingerprint;
  // offers
  fetchOffers: typeof offersApi.fetchOffers;
  fetchOfferById: typeof offersApi.fetchOfferById;
  fetchOfferPDF: typeof offersApi.fetchOfferPDF;
  // masterData
  fetchSalesChannels: typeof masterDataApi.fetchSalesChannels;
  fetchSalesChannelNameMap: typeof masterDataApi.fetchSalesChannelNameMap;
  fetchCategories: typeof masterDataApi.fetchCategories;
  fetchAvailableFields: typeof masterDataApi.fetchAvailableFields;
  resolveEntityDisplayNames: typeof masterDataApi.resolveEntityDisplayNames;
  resolveDeliveryTimes: typeof masterDataApi.resolveDeliveryTimes;
  fetchCustomerGroups: typeof masterDataApi.fetchCustomerGroups;
  getDefaultLanguageId: typeof masterDataApi.getDefaultLanguageId;
  getSalesChannelAccessKey: typeof masterDataApi.getSalesChannelAccessKey;
  getDefaultSalutationId: typeof masterDataApi.getDefaultSalutationId;
  getDefaultCustomerGroupId: typeof masterDataApi.getDefaultCustomerGroupId;
  getDefaultPaymentMethodId: typeof masterDataApi.getDefaultPaymentMethodId;
  getDefaultSalesChannelId: typeof masterDataApi.getDefaultSalesChannelId;
  getCountryIdByName: typeof masterDataApi.getCountryIdByName;
}

for (const api of [ordersApi, deliveryApi, documentsApi, productsApi, crossSellingApi, customersApi, pricingApi, offersApi, masterDataApi]) {
  for (const [name, fn] of Object.entries(api)) {
    if (Object.prototype.hasOwnProperty.call(ShopwareClient.prototype, name)) {
      throw new Error(`ShopwareClient.${name} ist doppelt definiert`);
    }
    Object.defineProperty(ShopwareClient.prototype, name, { value: fn, writable: true, enumerable: false, configurable: true });
  }
}
