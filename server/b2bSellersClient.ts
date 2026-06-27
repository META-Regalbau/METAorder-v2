import type { Offer, OfferStatus, OrderAddress, ShopwareSettings } from "@shared/schema";
import {
  buildB2BOfferCreateAttributes,
  formatShopwareWriteError,
  type B2BOfferCustomerContext,
} from "./b2bOfferCreateContext";

type OfferFilters = {
  search?: string;
  status?: string;
  customer?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
  salesChannelIds?: string[] | null;
};

type OfferUpdatePayload = {
  status?: string;
  customerName?: string;
  customerEmail?: string;
  offerNumber?: string;
  expirationDate?: string | null;
  totalPrice?: number;
  netPrice?: number;
  [key: string]: any;
};

type OfferEntityConfig = {
  statusField: string;
  statusReadField: string;
  numberField: string;
  createdField: string;
  updatedField: string;
  expirationField: string;
  customerNameField: string;
  customerEmailField: string;
  customerIdField: string;
  salesChannelField: string;
  totalField: string;
  netField: string;
  itemsField: string;
  associations: string[];
  /** Zusätzliche verschachtelte Assoziationen für GET ?associations[…] (z. B. Rechnungsadresse) */
  nestedAssociationQuery?: string;
};

const OFFER_ENTITY = process.env.B2B_SELLERS_ENTITY_OFFERS || "b2b_offer";
const STATUS_FIELD = process.env.B2B_SELLERS_OFFER_STATUS_FIELD || "statusId";
const STATUS_READ_FIELD = process.env.B2B_SELLERS_OFFER_STATUS_READ_FIELD || "status.label";
const NUMBER_FIELD = process.env.B2B_SELLERS_OFFER_NUMBER_FIELD || "number";
const CREATED_FIELD = process.env.B2B_SELLERS_OFFER_DATE_FIELD || "createdAt";
const UPDATED_FIELD = process.env.B2B_SELLERS_OFFER_UPDATED_FIELD || "updatedAt";
const EXPIRATION_FIELD = process.env.B2B_SELLERS_OFFER_EXPIRATION_FIELD || "validUntil";
const CUSTOMER_NAME_FIELD = process.env.B2B_SELLERS_OFFER_CUSTOMER_NAME_FIELD || "offerCustomer.company";
const CUSTOMER_EMAIL_FIELD = process.env.B2B_SELLERS_OFFER_CUSTOMER_EMAIL_FIELD || "mailTo";
const CUSTOMER_ID_FIELD = process.env.B2B_SELLERS_OFFER_CUSTOMER_ID_FIELD || "offerCustomerId";
const SALES_CHANNEL_FIELD = process.env.B2B_SELLERS_OFFER_SALES_CHANNEL_FIELD || "salesChannelId";
const TOTAL_FIELD = process.env.B2B_SELLERS_OFFER_TOTAL_FIELD || "price.totalPrice";
const NET_FIELD = process.env.B2B_SELLERS_OFFER_NET_FIELD || "price.netPrice";
const ITEMS_FIELD = process.env.B2B_SELLERS_OFFER_ITEMS_FIELD || "items";
const PAYLOAD_MODE = process.env.B2B_SELLERS_PAYLOAD_MODE || "direct";
const PDF_ACTION_ENDPOINT = process.env.B2B_SELLERS_OFFER_PDF_ACTION;
const REJECT_REASON_FIELD = process.env.B2B_SELLERS_OFFER_REJECT_REASON_FIELD || "rejectReason";
const STATUS_APPROVED = process.env.B2B_SELLERS_OFFER_STATUS_APPROVED || "approved";
const STATUS_REJECTED = process.env.B2B_SELLERS_OFFER_STATUS_REJECTED || "rejected";
const STATUS_SENT = process.env.B2B_SELLERS_OFFER_STATUS_SENT || "sent";
const STATUS_SUBMITTED = process.env.B2B_SELLERS_OFFER_STATUS_SUBMITTED || "submitted";
const STATUS_LABEL_SUBMITTED = process.env.B2B_SELLERS_OFFER_STATUS_LABEL_SUBMITTED || "Requested by customer";
const STATUS_LABEL_SENT = process.env.B2B_SELLERS_OFFER_STATUS_LABEL_SENT || "Open";
const STATUS_LABEL_APPROVED = process.env.B2B_SELLERS_OFFER_STATUS_LABEL_APPROVED || "Accepted";
const STATUS_LABEL_REJECTED = process.env.B2B_SELLERS_OFFER_STATUS_LABEL_REJECTED || "Declined";
const STATUS_LABEL_DRAFT = process.env.B2B_SELLERS_OFFER_STATUS_LABEL_DRAFT || "Archived";
const STATUS_ID_SUBMITTED = process.env.B2B_SELLERS_OFFER_STATUS_ID_SUBMITTED;
const STATUS_ID_SENT = process.env.B2B_SELLERS_OFFER_STATUS_ID_SENT;
const STATUS_ID_APPROVED = process.env.B2B_SELLERS_OFFER_STATUS_ID_APPROVED;
const STATUS_ID_REJECTED = process.env.B2B_SELLERS_OFFER_STATUS_ID_REJECTED;
const STATUS_ID_DRAFT = process.env.B2B_SELLERS_OFFER_STATUS_ID_DRAFT;

export type OfferStatusMappingEntry = {
  label: string;
  id?: string | null;
};

export type OfferStatusMapping = {
  submitted: OfferStatusMappingEntry;
  sent: OfferStatusMappingEntry;
  approved: OfferStatusMappingEntry;
  rejected: OfferStatusMappingEntry;
  draft: OfferStatusMappingEntry;
};

export type OfferStatusMappingOverrides = Partial<OfferStatusMapping>;

export class B2BSellersClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;
  private statusMapping: OfferStatusMapping;
  private resolvedEntityName: string | null = null;
  private resolvedEntityConfig: OfferEntityConfig | null = null;
  private readonly shopwareSettings: ShopwareSettings;

  constructor(settings: ShopwareSettings, options?: { statusMapping?: OfferStatusMappingOverrides }) {
    this.shopwareSettings = settings;
    const trimmedUrl = settings.shopwareUrl.replace(/\/$/, "");
    const isLocalUrl = (url: string) => {
      try {
        const host = new URL(url).hostname;
        return host === "localhost" || host === "127.0.0.1" || host === "host.docker.internal";
      } catch {
        return false;
      }
    };

    this.baseUrl = trimmedUrl;
    if (process.env.SHOPWARE_INTERNAL_URL && isLocalUrl(trimmedUrl)) {
      this.baseUrl = process.env.SHOPWARE_INTERNAL_URL.replace(/\/$/, "");
    }
    this.apiKey = settings.apiKey;
    this.apiSecret = settings.apiSecret;
    this.statusMapping = resolveOfferStatusMapping(options?.statusMapping);
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        grant_type: "client_credentials",
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
    const expiresIn = data.expires_in || 600;
    this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return this.accessToken as string;
  }

  private async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    let token = await this.authenticate();

    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      token = await this.authenticate();

      const retryHeaders = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
        Authorization: `Bearer ${token}`,
      };

      return await fetch(url, {
        ...options,
        headers: retryHeaders,
      });
    }

    return response;
  }

  private getApiEntityName(): string {
    return this.resolvedEntityName || OFFER_ENTITY.replace(/_/g, "-");
  }

  private getEntityConfig(entity: string): OfferEntityConfig {
    if (entity === "quote") {
      return {
        statusField: "stateId",
        statusReadField: "stateMachineState.name",
        numberField: "quoteNumber",
        createdField: "createdAt",
        updatedField: "updatedAt",
        expirationField: "expirationDate",
        customerNameField: "customer.company",
        customerEmailField: "customer.email",
        customerIdField: "customerId",
        salesChannelField: "salesChannelId",
        totalField: "price.totalPrice",
        netField: "price.netPrice",
        itemsField: "lineItems",
        associations: ["customer", "stateMachineState", "lineItems"],
        nestedAssociationQuery:
          "associations[customer][associations][defaultBillingAddress][]=true" +
          "&associations[customer][associations][defaultBillingAddress][associations][country][]=true",
      };
    }

    return {
      statusField: STATUS_FIELD,
      statusReadField: STATUS_READ_FIELD,
      numberField: NUMBER_FIELD,
      createdField: CREATED_FIELD,
      updatedField: UPDATED_FIELD,
      expirationField: EXPIRATION_FIELD,
      customerNameField: CUSTOMER_NAME_FIELD,
      customerEmailField: CUSTOMER_EMAIL_FIELD,
      customerIdField: CUSTOMER_ID_FIELD,
      salesChannelField: SALES_CHANNEL_FIELD,
      totalField: TOTAL_FIELD,
      netField: NET_FIELD,
      itemsField: ITEMS_FIELD,
      associations: ["offerCustomer", "status", "items"],
      nestedAssociationQuery:
        "associations[offerCustomer][associations][defaultBillingAddress][]=true" +
        "&associations[offerCustomer][associations][defaultBillingAddress][associations][country][]=true",
    };
  }

  private buildStatusFilter(status: string, config: OfferEntityConfig): { field: string; value: string | boolean } {
    const normalized = status.toLowerCase();
    if (normalized === "draft") {
      if (this.statusMapping.draft.id) {
        return { field: config.statusField, value: this.statusMapping.draft.id };
      }
      return { field: config.statusReadField, value: this.statusMapping.draft.label };
    }
    if (normalized === "submitted" || normalized === "sent") {
      const id = normalized === "submitted" ? this.statusMapping.submitted.id : this.statusMapping.sent.id;
      if (id) {
        return { field: config.statusField, value: id };
      }
      return {
        field: config.statusReadField,
        value: normalized === "submitted" ? this.statusMapping.submitted.label : this.statusMapping.sent.label,
      };
    }
    if (normalized === "approved") {
      if (this.statusMapping.approved.id) {
        return { field: config.statusField, value: this.statusMapping.approved.id };
      }
      return { field: config.statusReadField, value: this.statusMapping.approved.label };
    }
    if (normalized === "rejected") {
      if (this.statusMapping.rejected.id) {
        return { field: config.statusField, value: this.statusMapping.rejected.id };
      }
      return { field: config.statusReadField, value: this.statusMapping.rejected.label };
    }

    const externalStatus = mapStatusToExternal(status);
    const statusField = isUuid(externalStatus) ? config.statusField : config.statusReadField;
    return { field: statusField, value: externalStatus };
  }

  private getEntityCandidates(): string[] {
    const raw = OFFER_ENTITY;
    const dashed = raw.replace(/_/g, "-");
    const common = [
      "b2b_offer",
      "b2b-offer",
      "b2b_sellers_offer",
      "b2b-sellers-offer",
      "b2bsellers_offer",
      "b2bsellers-offer",
      "quote",
      "prems_individual_offer",
      "prems-individual-offer",
    ];
    const candidates = [dashed, raw, ...common];
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private async makeEntityRequest(buildPath: (entity: string) => string, options: RequestInit = {}) {
    const baseCandidates = this.resolvedEntityName ? [this.resolvedEntityName] : this.getEntityCandidates();
    let lastResponse: Response | null = null;
    const tryCandidates = async (candidates: string[]) => {
      for (const candidate of candidates) {
        const response = await this.makeAuthenticatedRequest(buildPath(candidate), options);
        lastResponse = response;
        if (response.status !== 404) {
          if (response.ok) {
            this.resolvedEntityName = candidate;
            this.resolvedEntityConfig = this.getEntityConfig(candidate);
          }
          return response;
        }
      }
      return null;
    };

    const baseResponse = await tryCandidates(baseCandidates);
    if (baseResponse) return baseResponse;

    const discovered = await this.discoverOfferEntities();
    if (discovered.length > 0) {
      const discoveredResponse = await tryCandidates(discovered);
      if (discoveredResponse) return discoveredResponse;
    }

    if (!lastResponse) {
      throw new Error("No response received while resolving offer entity.");
    }
    return lastResponse;
  }

  private async discoverOfferEntities(): Promise<string[]> {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_info/entity-schema`, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) return [];
      const schema = await response.json();
      let entities: string[] = [];
      if (schema?.entities && typeof schema.entities === "object") {
        entities = Object.keys(schema.entities);
      } else if (schema?.definitions && typeof schema.definitions === "object") {
        entities = Object.keys(schema.definitions);
      } else if (schema?.components?.schemas && typeof schema.components.schemas === "object") {
        entities = Object.keys(schema.components.schemas);
      }
      const filtered = entities.filter((name) => /offer|quote/i.test(name));
      return Array.from(new Set(filtered));
    } catch (error) {
      console.warn("[B2B] Failed to discover offer entities:", error);
      return [];
    }
  }

  async fetchOffers(filters: OfferFilters): Promise<{ offers: Offer[]; total: number }> {
    const limit = filters.limit || 50;
    const page = filters.page || 1;

    const candidates = this.resolvedEntityName ? [this.resolvedEntityName] : this.getEntityCandidates();
    let response: Response | null = null;
    let config: OfferEntityConfig | null = null;
    for (const candidate of candidates) {
      const currentConfig = this.getEntityConfig(candidate);
      const criteria: any = {
        limit,
        page,
        totalCountMode: 1,
        sort: [{ field: currentConfig.createdField, order: "DESC" }],
        filter: [],
        associations: currentConfig.associations.reduce((acc, name) => {
          acc[name] = {};
          return acc;
        }, {} as Record<string, any>),
      };

      if (filters.status) {
        const statusFilter = this.buildStatusFilter(filters.status, currentConfig);
        criteria.filter.push({
          type: "equals",
          field: statusFilter.field,
          value: statusFilter.value,
        });
      }

      if (filters.salesChannelIds && filters.salesChannelIds.length > 0) {
        criteria.filter.push({
          type: "equalsAny",
          field: currentConfig.salesChannelField,
          value: filters.salesChannelIds,
        });
      }

      if (filters.search) {
        criteria.filter.push({
          type: "multi",
          operator: "or",
          queries: [
            { type: "contains", field: currentConfig.numberField, value: filters.search },
            { type: "contains", field: currentConfig.customerNameField, value: filters.search },
            { type: "contains", field: currentConfig.customerEmailField, value: filters.search },
            { type: "contains", field: "matchcode", value: filters.search },
          ],
        });
      }

      if (filters.customer) {
        criteria.filter.push({
          type: "multi",
          operator: "or",
          queries: [
            { type: "contains", field: currentConfig.customerNameField, value: filters.customer },
            { type: "contains", field: currentConfig.customerEmailField, value: filters.customer },
            { type: "contains", field: "matchcode", value: filters.customer },
          ],
        });
      }

      if (filters.dateFrom || filters.dateTo) {
        criteria.filter.push({
          type: "range",
          field: currentConfig.createdField,
          parameters: {
            ...(filters.dateFrom ? { gte: filters.dateFrom } : {}),
            ...(filters.dateTo ? { lte: filters.dateTo } : {}),
          },
        });
      }

      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${candidate}`, {
        method: "POST",
        body: JSON.stringify(criteria),
      });

      if (response.status === 404) {
        continue;
      }

      if (response.ok) {
        this.resolvedEntityName = candidate;
        this.resolvedEntityConfig = currentConfig;
        config = currentConfig;
        break;
      }
    }

    if (!response) {
      response = await this.makeEntityRequest((entity) => `${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({ limit, page, totalCountMode: 1 }),
      });
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch offers: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    const rawOffers = result.data || [];
    const total = result.total || result.meta?.total || rawOffers.length;

    return {
      offers: rawOffers.map((raw: any) => this.mapOffer(raw, config || this.resolvedEntityConfig || this.getEntityConfig(this.getApiEntityName()))),
      total,
    };
  }

  async fetchOfferById(offerId: string): Promise<{ data: any; included?: any[] }> {
    const config = this.resolvedEntityConfig || this.getEntityConfig(this.getApiEntityName());
    const flatQuery = config.associations.map((name) => `associations[${name}][]=true`).join("&");
    const fullQuery = config.nestedAssociationQuery?.trim()
      ? `${flatQuery}&${config.nestedAssociationQuery.trim()}`
      : flatQuery;

    let response = await this.makeEntityRequest(
      (entity) => `${this.baseUrl}/api/${entity}/${offerId}?${fullQuery}`,
      { method: "GET" },
    );

    // Verschachtelte associations[offerCustomer][associations][…] werden von manchen Shopware-/Plugin-Versionen mit 4xx abgewiesen.
    if (!response.ok && config.nestedAssociationQuery?.trim()) {
      response = await this.makeEntityRequest(
        (entity) => `${this.baseUrl}/api/${entity}/${offerId}?${flatQuery}`,
        { method: "GET" },
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch offer: ${response.statusText} - ${errorText}`);
    }

    const result = await response.json();
    const data = result.data || result;
    const inc = result.included;
    const included = Array.isArray(inc) ? inc : [];
    return { data, included };
  }

  async updateOffer(offerId: string, payload: OfferUpdatePayload): Promise<void> {
    const normalizedPayload = mapOfferUpdatePayload(payload, this.statusMapping);
    const body =
      PAYLOAD_MODE === "jsonapi"
        ? JSON.stringify({
            data: {
              id: offerId,
              type: OFFER_ENTITY,
              attributes: normalizedPayload,
            },
          })
        : JSON.stringify(normalizedPayload);

    const response = await this.makeEntityRequest(
      (entity) => `${this.baseUrl}/api/${entity}/${offerId}`,
      {
        method: "PATCH",
        body,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update offer: ${response.statusText} - ${errorText}`);
    }
  }

  async approveOffer(offerId: string): Promise<void> {
    const statusId = this.statusMapping.approved.id;
    await this.updateOffer(offerId, statusId ? { [STATUS_FIELD]: statusId } : { [STATUS_FIELD]: STATUS_APPROVED });
  }

  async rejectOffer(offerId: string, reason?: string): Promise<void> {
    const statusId = this.statusMapping.rejected.id;
    await this.updateOffer(offerId, {
      [STATUS_FIELD]: statusId || STATUS_REJECTED,
      ...(reason ? { [REJECT_REASON_FIELD]: reason } : {}),
    });
  }

  /**
   * Erstellt ein neues Angebot in Shopware über die B2B-Sellers-Suite Admin API.
   * Das Angebot wird als Entwurf (Draft) angelegt.
   */
  async createOffer(params: {
    customerId: string;
    salesChannelId: string;
    lineItems: Array<{
      productId: string;
      quantity: number;
      type?: string;
      /** B2B/Shopware: MetaCalc-kompatibles payload (z. B. aus CPQ-Stückliste) */
      payload?: Record<string, unknown>;
    }>;
    /** Kunden-/Adressdaten aus Entwurf; für vollständige B2B-Pflichtfelder */
    customerContext?: B2BOfferCustomerContext;
  }): Promise<{ id: string }> {
    const attributes = await buildB2BOfferCreateAttributes(this.shopwareSettings, {
      shopwareCustomerId: params.customerId,
      salesChannelId: params.salesChannelId,
      lineItems: params.lineItems,
      customerContext: params.customerContext,
      statusMapping: this.statusMapping,
    });

    const entityType = this.getApiEntityName();
    const body =
      PAYLOAD_MODE === "jsonapi"
        ? JSON.stringify({
            data: {
              type: entityType,
              attributes,
            },
          })
        : JSON.stringify(attributes);

    const response = await this.makeEntityRequest(
      (entity) => `${this.baseUrl}/api/${entity}`,
      {
        method: "POST",
        body,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `[B2BSellers] createOffer ${response.status} ${entityType} – Shopware error:`,
        errorText
      );
      const detail = formatShopwareWriteError(errorText);
      throw new Error(`Angebot konnte nicht erstellt werden: ${detail}`);
    }

    // Shopware antwortet bei erfolgreichem Schreiben oft mit 204 No Content
    // (leerer Body, neue ID im Location-Header). Daher zuerst die im Payload
    // mitgegebene ID nutzen, dann Location-Header, dann ggf. JSON-Body.
    const attributeId =
      typeof (attributes as Record<string, unknown>).id === "string"
        ? ((attributes as Record<string, unknown>).id as string)
        : undefined;

    const locationHeader = response.headers.get("location") || response.headers.get("Location");
    const locationId = locationHeader?.split("/").filter(Boolean).pop();

    let bodyId: string | undefined;
    const rawBody = await response.text();
    if (rawBody.trim().length > 0) {
      try {
        const result = JSON.parse(rawBody);
        bodyId =
          result?.data?.id ??
          result?.data?.[0]?.id ??
          result?.id ??
          (Array.isArray(result?.data) && result.data[0] ? result.data[0].id : undefined);
      } catch {
        /* leerer/kein JSON-Body bei 204 */
      }
    }

    const id = attributeId ?? bodyId ?? locationId;

    if (!id) {
      throw new Error("Offer created but no ID returned from API");
    }

    return { id };
  }

  async fetchOfferPdf(offerId: string): Promise<Buffer> {
    if (!PDF_ACTION_ENDPOINT) {
      throw new Error("PDF not available for B2B offers");
    }

    const endpoint = PDF_ACTION_ENDPOINT.replace("{id}", offerId);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}${endpoint}`, {
      method: "GET",
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch offer PDF: ${response.statusText} - ${errorText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  private getIncludedItems(raw: any, included?: any[]): any[] {
    if (!Array.isArray(included) || !raw?.id) return [];
    const offerId = raw.id;
    const items = included.filter((item) =>
      item?.type?.includes("offer_item") || item?.type?.includes("offer-item") || item?.type?.includes("offeritem")
    );
    return items
      .filter((item) => item?.attributes?.offerId === offerId)
      .map((item) => ({
        id: item.id,
        type: item.attributes?.type ?? item.type ?? null,
        label: item.attributes?.label,
        quantity: item.attributes?.quantity,
        unitPrice: item.attributes?.unitPrice,
        totalPrice: item.attributes?.totalPrice,
        taxRate:
          item.attributes?.price?.taxRules?.[0]?.taxRate ??
          item.attributes?.priceDefinition?.taxRules?.[0]?.taxRate ??
          0,
        productNumber:
          item.attributes?.payload?.productNumber ??
          item.attributes?.payload?.product_number ??
          null,
        payload: item.attributes?.payload ?? null,
        children: item.attributes?.children ?? item.children ?? null,
      }));
  }

  private formatCountryField(country: any): string {
    if (country == null) return "";
    if (typeof country === "string") return country;
    return String(country.name || country.translated?.name || "");
  }

  private mapFlatToOrderAddress(src: any): OrderAddress | undefined {
    if (!src || typeof src !== "object") return undefined;
    const a = src.attributes || src;
    const street = String(a.street || "").trim();
    const zipCode = String(a.zipcode || a.zipCode || "").trim();
    const city = String(a.city || "").trim();
    const firstName = String(a.firstName || "").trim();
    const lastName = String(a.lastName || "").trim();
    const company = a.company != null && String(a.company).trim() ? String(a.company).trim() : undefined;
    const hasAny = Boolean(street || zipCode || city || company || firstName || lastName);
    if (!hasAny) return undefined;
    return {
      firstName,
      lastName,
      street,
      zipCode,
      city,
      country: this.formatCountryField(a.country),
      company,
      phoneNumber: a.phoneNumber ? String(a.phoneNumber).trim() : undefined,
    };
  }

  private addressNeedsStreetOrCity(a: OrderAddress | undefined): boolean {
    if (!a) return true;
    const s = String(a.street || "").trim();
    const z = String(a.zipCode || "").trim();
    const c = String(a.city || "").trim();
    return !s || (!z && !c);
  }

  private resolveOfferParty(raw: any, included: any[] | undefined, useCustomerAssociation: boolean): any | null {
    const key = useCustomerAssociation ? "customer" : "offerCustomer";
    const nested = (raw as any)?.[key];
    if (nested && typeof nested === "object") return nested;
    const rid = raw?.relationships?.[key]?.data?.id;
    if (!rid || !Array.isArray(included)) return null;
    const matches = included.filter((x) => x?.id === rid);
    return (
      matches.find((x) => /customer|offer/i.test(String(x?.type || ""))) || matches[0] || null
    );
  }

  /**
   * Kundennummer + Rechnungsadresse aus expandiertem Angebot / included (JSON:API).
   */
  private extractRecipientFromOffer(raw: any, included?: any[]): {
    customerNumber?: string;
    billingAddress?: OrderAddress;
  } {
    const entityType = String(raw?.type || this.resolvedEntityName || "").toLowerCase();
    const useCustomerAssoc = entityType === "quote";
    const party = this.resolveOfferParty(raw, included, useCustomerAssoc);
    if (!party) return {};

    const attrs = party.attributes || party;
    const cnRaw = attrs.customerNumber ?? attrs.customerNo ?? attrs.number;
    const customerNumber =
      cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : undefined;

    let billingAddress: OrderAddress | undefined;
    const nestedAddr = party.defaultBillingAddress ?? attrs.defaultBillingAddress;
    if (nestedAddr) {
      let resolved: any = nestedAddr;
      if (nestedAddr.data?.id && Array.isArray(included)) {
        const aid = nestedAddr.data.id;
        const inc =
          included.find((x) => x.id === aid && /address/i.test(String(x.type || ""))) ||
          included.find((x) => x.id === aid);
        if (inc) resolved = inc;
      }
      billingAddress = this.mapFlatToOrderAddress(resolved);
    }

    if (this.addressNeedsStreetOrCity(billingAddress)) {
      const direct = this.mapFlatToOrderAddress(attrs);
      if (direct) {
        if (!this.addressNeedsStreetOrCity(direct)) billingAddress = direct;
        else if (!billingAddress) billingAddress = direct;
      }
    }

    return {
      customerNumber,
      billingAddress,
    };
  }

  mapOffer(raw: any, config?: OfferEntityConfig, included?: any[]): Offer {
    const resolvedConfig = config || this.resolvedEntityConfig || this.getEntityConfig(this.getApiEntityName());
    const statusId = this.getField(raw, resolvedConfig.statusField);
    const statusLabel = this.getField(raw, resolvedConfig.statusReadField);
    const statusRaw = statusLabel || statusId;
    const expiration = this.getField(raw, resolvedConfig.expirationField);
    const status = normalizeOfferStatus(statusRaw, expiration, this.statusMapping);
    const rawItems = this.getField(raw, resolvedConfig.itemsField);
    const fallbackItems = this.getIncludedItems(raw, included);
    const items = Array.isArray(rawItems) && rawItems.length > 0 ? rawItems : fallbackItems;

    const recipient = this.extractRecipientFromOffer(raw, included);

    return {
      id: raw.id,
      offerNumber: this.getField(raw, resolvedConfig.numberField) || "N/A",
      customerId: this.getField(raw, resolvedConfig.customerIdField) || "",
      customerNumber: recipient.customerNumber,
      billingAddress: recipient.billingAddress,
      customerName: this.getFirstField(raw, [
        resolvedConfig.customerNameField,
        "offerCustomer.name",
        "offerCustomer.company",
        "matchcode",
        "customer.name",
        "customer.company",
      ]),
      customerEmail: this.getFirstField(raw, [
        resolvedConfig.customerEmailField,
        "offerCustomer.email",
        "mailTo",
        "customer.email",
      ]),
      salesChannelId: this.getField(raw, resolvedConfig.salesChannelField) || "",
      totalPrice: Number(this.getField(raw, resolvedConfig.totalField) || 0),
      netPrice: Number(this.getField(raw, resolvedConfig.netField) || 0),
      taxStatus: this.getField(raw, "taxStatus") || "",
      status,
      statusId,
      statusLabel,
      offered: status === "sent",
      accepted: status === "approved",
      declined: status === "rejected",
      offerExpiration: expiration || "",
      createdAt: this.getField(raw, resolvedConfig.createdField) || new Date().toISOString(),
      updatedAt: this.getField(raw, resolvedConfig.updatedField) || new Date().toISOString(),
      items: items || [],
    };
  }

  private getField(raw: any, field: string): any {
    if (!field) return undefined;
    const parts = field.split(".");
    const getFrom = (source: any) => {
      let value = source;
      for (const part of parts) {
        if (value == null) return undefined;
        value = value[part];
      }
      return value;
    };
    const direct = getFrom(raw);
    if (direct !== undefined) return direct;
    if (raw?.attributes) {
      return getFrom(raw.attributes);
    }
    return undefined;
  }

  private getFirstField(raw: any, fields: string[]): any {
    for (const field of fields) {
      const value = this.getField(raw, field);
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return undefined;
  }
}

export function normalizeOfferStatus(
  rawStatus: string | undefined,
  expirationDate?: string | null,
  mapping: OfferStatusMapping = resolveOfferStatusMapping()
): OfferStatus {
  const normalized = (rawStatus || "").toLowerCase();
  const mapped = resolveStatusFromMapping(normalized, mapping);
  if (mapped) {
    return applyExpiration(mapped, expirationDate);
  }

  const statusMap: Record<string, OfferStatus> = {
    draft: "draft",
    [STATUS_SUBMITTED.toLowerCase()]: "submitted",
    submitted: "submitted",
    [STATUS_SENT.toLowerCase()]: "sent",
    offered: "sent",
    sent: "sent",
    [STATUS_APPROVED.toLowerCase()]: "approved",
    approved: "approved",
    accepted: "approved",
    [STATUS_REJECTED.toLowerCase()]: "rejected",
    rejected: "rejected",
    declined: "rejected",
  };

  const status = statusMap[normalized] || "draft";
  return applyExpiration(status, expirationDate);
}

function mapStatusToExternal(status: string): string {
  switch (status) {
    case "submitted":
      return STATUS_SUBMITTED;
    case "sent":
      return STATUS_SENT;
    case "approved":
      return STATUS_APPROVED;
    case "rejected":
      return STATUS_REJECTED;
    default:
      return status;
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

function buildStatusFilter(
  status: string,
  mapping: OfferStatusMapping
): { field: string; value: string | boolean } {
  const normalized = status.toLowerCase();
  if (normalized === "draft") {
    if (mapping.draft.id) {
      return { field: STATUS_FIELD, value: mapping.draft.id };
    }
    return { field: STATUS_READ_FIELD, value: mapping.draft.label };
  }
  if (normalized === "submitted" || normalized === "sent") {
    const id = normalized === "submitted" ? mapping.submitted.id : mapping.sent.id;
    if (id) {
      return { field: STATUS_FIELD, value: id };
    }
    return {
      field: STATUS_READ_FIELD,
      value: normalized === "submitted" ? mapping.submitted.label : mapping.sent.label,
    };
  }
  if (normalized === "approved") {
    if (mapping.approved.id) {
      return { field: STATUS_FIELD, value: mapping.approved.id };
    }
    return { field: STATUS_READ_FIELD, value: mapping.approved.label };
  }
  if (normalized === "rejected") {
    if (mapping.rejected.id) {
      return { field: STATUS_FIELD, value: mapping.rejected.id };
    }
    return { field: STATUS_READ_FIELD, value: mapping.rejected.label };
  }

  const externalStatus = mapStatusToExternal(status);
  const statusField = isUuid(externalStatus) ? STATUS_FIELD : STATUS_READ_FIELD;
  return { field: statusField, value: externalStatus };
}

function applyExpiration(status: OfferStatus, expirationDate?: string | null): OfferStatus {
  if (!expirationDate) {
    return status;
  }
  const expires = new Date(expirationDate);
  if (!isNaN(expires.getTime()) && expires < new Date()) {
    return "expired";
  }
  return status;
}

export function getOfferStatusMapping(
  overrides?: OfferStatusMappingOverrides
): OfferStatusMapping {
  return resolveOfferStatusMapping(overrides);
}

function resolveOfferStatusMapping(overrides?: OfferStatusMappingOverrides): OfferStatusMapping {
  return {
    submitted: {
      label: overrides?.submitted?.label ?? STATUS_LABEL_SUBMITTED,
      id: overrides?.submitted?.id ?? STATUS_ID_SUBMITTED ?? null,
    },
    sent: {
      label: overrides?.sent?.label ?? STATUS_LABEL_SENT,
      id: overrides?.sent?.id ?? STATUS_ID_SENT ?? null,
    },
    approved: {
      label: overrides?.approved?.label ?? STATUS_LABEL_APPROVED,
      id: overrides?.approved?.id ?? STATUS_ID_APPROVED ?? null,
    },
    rejected: {
      label: overrides?.rejected?.label ?? STATUS_LABEL_REJECTED,
      id: overrides?.rejected?.id ?? STATUS_ID_REJECTED ?? null,
    },
    draft: {
      label: overrides?.draft?.label ?? STATUS_LABEL_DRAFT,
      id: overrides?.draft?.id ?? STATUS_ID_DRAFT ?? null,
    },
  };
}

function resolveStatusFromMapping(normalized: string, mapping: OfferStatusMapping): OfferStatus | null {
  const entries: Array<[OfferStatus, OfferStatusMappingEntry]> = [
    ["submitted", mapping.submitted],
    ["sent", mapping.sent],
    ["approved", mapping.approved],
    ["rejected", mapping.rejected],
    ["draft", mapping.draft],
  ];
  for (const [status, entry] of entries) {
    if (entry.id && entry.id.toLowerCase() === normalized) {
      return status;
    }
    if (entry.label && entry.label.toLowerCase() === normalized) {
      return status;
    }
  }
  return null;
}

function mapOfferUpdatePayload(
  payload: OfferUpdatePayload,
  mapping: OfferStatusMapping
): OfferUpdatePayload {
  if (!payload.status) {
    return payload;
  }

  const normalized = payload.status.toLowerCase();
  const entry = (mapping as Record<string, OfferStatusMappingEntry>)[normalized];
  if (entry?.id) {
    const { status, ...rest } = payload;
    return { ...rest, [STATUS_FIELD]: entry.id };
  }

  if (isUuid(payload.status)) {
    const { status, ...rest } = payload;
    return { ...rest, [STATUS_FIELD]: payload.status };
  }

  return payload;
}
