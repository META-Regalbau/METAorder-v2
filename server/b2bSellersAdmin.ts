import type { ShopwareSettings } from "@shared/schema";
import type { B2BEntityMapping } from "@shared/b2bEntityMapping";
import { DEFAULT_B2B_ENTITY_MAPPING, mergeB2BEntityMapping } from "@shared/b2bEntityMapping";
import { storage } from "./storage";
import { ShopwareClient, SHOPWARE_ADMIN_SEARCH_PAGE_SIZE } from "./shopware";

function computeDiscountPercent(priceNet: number | null, pseudoPriceNet: number | null): number | null {
  if (priceNet == null || pseudoPriceNet == null || pseudoPriceNet <= 0 || priceNet >= pseudoPriceNet) {
    return null;
  }
  return Math.round((1 - priceNet / pseudoPriceNet) * 1000) / 10;
}

export type { B2BEntityMapping };
export { DEFAULT_B2B_ENTITY_MAPPING, mergeB2BEntityMapping };

export async function getStoredB2BEntityMapping(): Promise<B2BEntityMapping> {
  const stored = (await storage.getSetting("b2b.entityMapping")) as Partial<B2BEntityMapping> | undefined;
  return mergeB2BEntityMapping(stored);
}

function unwrapEntity(raw: any): any {
  if (!raw) return raw;
  if (raw.attributes && typeof raw.attributes === "object") {
    return { id: raw.id, ...raw.attributes, ...raw };
  }
  return raw;
}

function getField(raw: any, field: string): any {
  const parts = field.split(".");
  let value = unwrapEntity(raw);
  for (const part of parts) {
    if (value == null) return undefined;
    value = value[part];
    if (value?.data?.id) value = value;
  }
  return value;
}

export class B2BSellersAdminClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private entityMapping: B2BEntityMapping;
  private shopwareSettings: ShopwareSettings;

  constructor(settings: ShopwareSettings, entityMapping?: Partial<B2BEntityMapping>) {
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
    this.entityMapping = mergeB2BEntityMapping(entityMapping);
  }

  getEntityMapping(): B2BEntityMapping {
    return this.entityMapping;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }
    const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

  async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    let token = await this.authenticate();
    const headers = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
      Authorization: `Bearer ${token}`,
    };
    let response = await fetch(url, { ...options, headers });
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      token = await this.authenticate();
      response = await fetch(url, {
        ...options,
        headers: { ...headers, Authorization: `Bearer ${token}` },
      });
    }
    return response;
  }

  resolveEntityName(key: keyof B2BEntityMapping): string {
    return this.entityMapping[key];
  }

  async searchEntity(entityKey: keyof B2BEntityMapping, criteria: Record<string, unknown>): Promise<{ data: any[]; total: number }> {
    const entityName = this.resolveEntityName(entityKey);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entityName}`, {
      method: "POST",
      body: JSON.stringify(criteria),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to search ${entityName}: ${response.statusText} - ${errorText}`);
    }
    const result = await response.json();
    return {
      data: result.data || [],
      total: result.total ?? result.meta?.total ?? (result.data?.length ?? 0),
    };
  }

  async getEntity(entityKey: keyof B2BEntityMapping, id: string, associationQuery?: string): Promise<any> {
    const entityName = this.resolveEntityName(entityKey);
    const query = associationQuery?.trim() ? `?${associationQuery}` : "";
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/${entityName}/${id}${query}`, {
      method: "GET",
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch ${entityName}/${id}: ${response.statusText} - ${errorText}`);
    }
    const result = await response.json();
    return result.data || result;
  }

  async createEntity(entityKey: keyof B2BEntityMapping, payload: Record<string, unknown>): Promise<{ id: string }> {
    const entityName = this.resolveEntityName(entityKey);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/${entityName}`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create ${entityName}: ${response.statusText} - ${errorText}`);
    }
    const attributeId = typeof payload.id === "string" ? payload.id : undefined;
    const locationHeader = response.headers.get("location") || response.headers.get("Location");
    const locationId = locationHeader?.split("/").filter(Boolean).pop();
    const rawBody = await response.text();
    let bodyId: string | undefined;
    if (rawBody.trim()) {
      try {
        const parsed = JSON.parse(rawBody);
        bodyId = parsed?.data?.id ?? parsed?.id;
      } catch {
        /* 204 */
      }
    }
    const id = attributeId ?? bodyId ?? locationId;
    if (!id) throw new Error(`Created ${entityName} but no ID returned`);
    return { id };
  }

  async patchEntity(entityKey: keyof B2BEntityMapping, id: string, payload: Record<string, unknown>): Promise<void> {
    const entityName = this.resolveEntityName(entityKey);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/${entityName}/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to update ${entityName}/${id}: ${response.statusText} - ${errorText}`);
    }
  }

  async deleteEntity(entityKey: keyof B2BEntityMapping, id: string): Promise<void> {
    const entityName = this.resolveEntityName(entityKey);
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/${entityName}/${id}`, {
      method: "DELETE",
    });
    if (!response.ok && response.status !== 204) {
      const errorText = await response.text();
      throw new Error(`Failed to delete ${entityName}/${id}: ${response.statusText} - ${errorText}`);
    }
  }

  private buildAssociations(names: string[]): Record<string, object> {
    return names.reduce((acc, name) => {
      acc[name] = {};
      return acc;
    }, {} as Record<string, object>);
  }

  private mapCustomerAsCompany(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      customerId: u.id,
      company: getField(u, "company") || "",
      email: getField(u, "email") || "",
      customerNumber: getField(u, "customerNumber") || null,
      active: getField(u, "active") ?? true,
      createdAt: getField(u, "createdAt") || null,
      salesChannelId: getField(u, "salesChannelId") || getField(u, "boundSalesChannelId") || null,
      salesChannelName:
        getField(u, "salesChannel.name") ||
        getField(u, "salesChannel.translated.name") ||
        null,
    };
  }

  private dedupeCompaniesByCustomerId<T extends { id: string; customerId: string | null }>(companies: T[]): T[] {
    const byCustomer = new Map<string, T>();
    for (const company of companies) {
      const key = (company.customerId || company.id || "").trim();
      if (!key) continue;
      const existing = byCustomer.get(key);
      if (!existing) {
        byCustomer.set(key, company);
        continue;
      }
      const incomingIsOffer = company.id !== company.customerId;
      const existingIsOffer = existing.id !== existing.customerId;
      if (incomingIsOffer && !existingIsOffer) {
        byCustomer.set(key, company);
      }
    }
    return Array.from(byCustomer.values());
  }

  private buildBusinessCustomerSearchCriteria(filters: {
    search?: string;
    page?: number;
    limit?: number;
    salesChannelIds?: string[];
  }) {
    const customerCriteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      associations: {
        salesChannel: {},
      },
      filter: [{ type: "equals", field: "accountType", value: "business" }],
    };
    const directChannelFilter = this.buildSalesChannelCustomerFilter(filters.salesChannelIds, "");
    if (directChannelFilter) {
      (customerCriteria.filter as any[]).push(directChannelFilter);
    }
    if (filters.search) {
      (customerCriteria.filter as any[]).push({
        type: "multi",
        operator: "or",
        queries: [
          { type: "contains", field: "company", value: filters.search },
          { type: "contains", field: "email", value: filters.search },
        ],
      });
    }
    return customerCriteria;
  }

  private async searchBusinessCustomers(filters: {
    search?: string;
    page?: number;
    limit?: number;
    salesChannelIds?: string[];
  }) {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify(this.buildBusinessCustomerSearchCriteria(filters)),
    });
    if (!response.ok) {
      return { companies: [] as Array<ReturnType<B2BSellersAdminClient["mapCustomerAsCompany"]>>, total: 0 };
    }
    const parsed = await response.json();
    const rows = (parsed.data || []).filter((c: any) => getField(c, "company"));
    return {
      companies: rows.map((r: any) => this.mapCustomerAsCompany(r)),
      total: parsed.total ?? rows.length,
    };
  }

  private sortCompaniesByCreatedAt<T extends { createdAt: string | null }>(companies: T[]): T[] {
    return companies.toSorted((a, b) => {
      const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bTime - aTime;
    });
  }

  private buildCompanyEntitySearchCriteria(filters: {
    search?: string;
    page?: number;
    limit?: number;
    salesChannelIds?: string[];
  }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      associations: {
        customer: {
          associations: {
            salesChannel: {},
          },
        },
      },
      filter: [],
    };
    const channelFilter = this.buildSalesChannelCustomerFilter(filters.salesChannelIds, "customer.");
    if (channelFilter) {
      (criteria.filter as any[]).push(channelFilter);
    }
    if (filters.search) {
      (criteria.filter as any[]).push({
        type: "multi",
        operator: "or",
        queries: [
          { type: "contains", field: "company", value: filters.search },
          { type: "contains", field: "customer.company", value: filters.search },
          { type: "contains", field: "email", value: filters.search },
        ],
      });
    }
    return criteria;
  }

  private async searchAllCompanyEntities(filters: {
    search?: string;
    salesChannelIds?: string[];
  }) {
    const pageSize = SHOPWARE_ADMIN_SEARCH_PAGE_SIZE;
    let page = 1;
    const companies: ReturnType<B2BSellersAdminClient["mapCompany"]>[] = [];

    while (true) {
      const result = await this.searchEntity(
        "company",
        this.buildCompanyEntitySearchCriteria({ ...filters, limit: pageSize, page }),
      );
      const batch = result.data.map((row) => this.mapCompany(row));
      companies.push(...batch);
      if (batch.length < pageSize) break;
      page += 1;
    }

    return companies;
  }

  private async searchAllBusinessCustomers(filters: {
    search?: string;
    salesChannelIds?: string[];
  }) {
    const pageSize = SHOPWARE_ADMIN_SEARCH_PAGE_SIZE;
    let page = 1;
    const companies: ReturnType<B2BSellersAdminClient["mapCustomerAsCompany"]>[] = [];

    while (true) {
      const result = await this.searchBusinessCustomers({ ...filters, limit: pageSize, page });
      companies.push(...result.companies);
      if (result.companies.length < pageSize) break;
      page += 1;
    }

    return companies;
  }

  mapCompany(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      customerId: getField(u, "customerId") || getField(u, "customer.id") || null,
      company: getField(u, "company") || getField(u, "customer.company") || getField(u, "name") || "",
      email: getField(u, "email") || getField(u, "customer.email") || "",
      customerNumber: getField(u, "customerNumber") || getField(u, "customer.customerNumber") || null,
      active: getField(u, "active") ?? getField(u, "customer.active") ?? true,
      createdAt: getField(u, "createdAt") || null,
      salesChannelId:
        getField(u, "customer.salesChannelId") ||
        getField(u, "customer.boundSalesChannelId") ||
        null,
      salesChannelName:
        getField(u, "customer.salesChannel.name") ||
        getField(u, "customer.salesChannel.translated.name") ||
        null,
    };
  }

  private buildSalesChannelCustomerFilter(
    salesChannelIds: string[] | undefined,
    nestedPrefix: "customer." | "",
  ): Record<string, unknown> | null {
    if (!salesChannelIds || salesChannelIds.length === 0) return null;
    const salesChannelField = `${nestedPrefix}salesChannelId`;
    const boundSalesChannelField = `${nestedPrefix}boundSalesChannelId`;
    return {
      type: "multi",
      operator: "or",
      queries: [
        { type: "equalsAny", field: salesChannelField, value: salesChannelIds },
        { type: "equalsAny", field: boundSalesChannelField, value: salesChannelIds },
      ],
    };
  }

  private mapAddress(raw: any) {
    const u = unwrapEntity(raw);
    if (!u) return null;
    const street = String(getField(u, "street") || "").trim();
    const city = String(getField(u, "city") || "").trim();
    const zipCode = String(getField(u, "zipcode") || getField(u, "zipCode") || "").trim();
    if (!street && !city && !zipCode && !String(getField(u, "company") || "").trim()) return null;
    return {
      company: getField(u, "company") || null,
      firstName: getField(u, "firstName") || null,
      lastName: getField(u, "lastName") || null,
      street,
      zipCode,
      city,
      country: getField(u, "country.name") || getField(u, "country.translated.name") || null,
      phoneNumber: getField(u, "phoneNumber") || null,
    };
  }

  private async resolveCustomerContext(companyId: string): Promise<{ customerId: string; offerCustomerRaw: any | null }> {
    const id = companyId.trim();
    try {
      const offer = await this.getEntity("company", id);
      const customerId = getField(offer, "customerId") || getField(offer, "customer.id");
      if (customerId) return { customerId, offerCustomerRaw: offer };
    } catch {
      /* not an offer-customer id */
    }

    try {
      const found = await this.searchEntity("company", {
        limit: 1,
        filter: [{ type: "equals", field: "customerId", value: id }],
        associations: this.buildAssociations(["customer"]),
      });
      if (found.data[0]) {
        return { customerId: id, offerCustomerRaw: found.data[0] };
      }
    } catch {
      /* entity may not exist */
    }

    return { customerId: id, offerCustomerRaw: null };
  }

  async fetchCompanyDetail(companyId: string) {
    const { customerId, offerCustomerRaw } = await this.resolveCustomerContext(companyId);
    const offer = offerCustomerRaw ? unwrapEntity(offerCustomerRaw) : null;

    const customerResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1,
        filter: [{ type: "equals", field: "id", value: customerId }],
        associations: {
          defaultBillingAddress: { associations: { country: {} } },
          group: {},
          salesChannel: {},
        },
      }),
    });
    if (!customerResponse.ok) {
      const errorText = await customerResponse.text();
      throw new Error(`Failed to fetch customer ${customerId}: ${customerResponse.status} ${errorText}`);
    }
    const customerPayload = await customerResponse.json();
    const customerRaw = customerPayload.data?.[0];
    if (!customerRaw) {
      throw new Error(`Customer not found: ${customerId}`);
    }
    const customer = unwrapEntity(customerRaw);

    const billingAddress =
      this.mapAddress(getField(customer, "defaultBillingAddress")) ||
      this.mapAddress(getField(offer, "customer.defaultBillingAddress"));

    const vatIdsRaw = getField(customer, "vatIds");
    const vatIds = Array.isArray(vatIdsRaw) ? vatIdsRaw.map(String) : [];

    const customFields = getField(customer, "customFields") || getField(offer, "customFields") || null;
    const customerNumber =
      getField(offer, "customerNumber") ||
      getField(customer, "customerNumber") ||
      null;

    const shopware = new ShopwareClient(this.shopwareSettings);
    const [employeesResult, budgetsResult, priceResult] = await Promise.all([
      this.fetchEmployees({ customerId, limit: 100 }),
      this.fetchBudgets({ customerId, limit: 50 }).catch(() => ({ budgets: [], total: 0 })),
      shopware
        .fetchCustomerSpecificPrices({
          customerId,
          customerNumber: customerNumber ? String(customerNumber) : null,
          limit: 200,
        })
        .catch(() => ({ available: false, total: 0, prices: [], entity: null })),
    ]);

    return {
      offerCustomerId: offer?.id || null,
      customerId,
      company:
        getField(offer, "company") ||
        getField(customer, "company") ||
        "",
      email: getField(offer, "email") || getField(customer, "email") || "",
      firstName: getField(offer, "firstName") || getField(customer, "firstName") || null,
      lastName: getField(offer, "lastName") || getField(customer, "lastName") || null,
      customerNumber: customerNumber ? String(customerNumber) : null,
      active: getField(customer, "active") ?? getField(offer, "active") ?? true,
      accountType: getField(customer, "accountType") || null,
      vatIds,
      phoneNumber: billingAddress?.phoneNumber || null,
      lastLogin: getField(customer, "lastLogin") || null,
      orderCount: getField(customer, "orderCount") ?? null,
      orderTotalAmount: getField(customer, "orderTotalAmount") ?? null,
      createdAt: getField(customer, "createdAt") || getField(offer, "createdAt") || null,
      customFields: customFields && typeof customFields === "object" ? customFields : null,
      billingAddress,
      salesChannelName:
        getField(customer, "salesChannel.name") ||
        getField(customer, "salesChannel.translated.name") ||
        null,
      customerGroupName:
        getField(customer, "group.name") ||
        getField(customer, "group.translated.name") ||
        null,
      employees: employeesResult.employees,
      budgets: budgetsResult.budgets,
      customerPrices: {
        available: priceResult.available,
        total: priceResult.total,
        pluginDetected: priceResult.entity != null,
        prices: priceResult.prices.map((price) => ({
          id: price.id,
          productId: price.productId,
          productNumber: price.productNumber,
          productName: price.productName,
          from: price.from,
          to: price.to,
          priceNet: price.priceNet,
          pseudoPriceNet: price.pseudoPriceNet,
          discountPercent: computeDiscountPercent(price.priceNet, price.pseudoPriceNet),
          currencyIsoCode: price.currencyIsoCode,
          validFrom: price.validFrom,
          validUntil: price.validUntil,
        })),
      },
    };
  }

  mapEmployee(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      email: getField(u, "email") || "",
      firstName: getField(u, "firstName") || "",
      lastName: getField(u, "lastName") || "",
      department: getField(u, "department") || null,
      phoneNumber: getField(u, "phoneNumber") || null,
      active: Boolean(getField(u, "active")),
      createdAt: getField(u, "createdAt") || null,
    };
  }

  mapRole(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      name: getField(u, "name") || getField(u, "translated.name") || "",
      technicalName: getField(u, "technicalName") || null,
    };
  }

  mapBudget(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      name: getField(u, "name") || "",
      sum: Number(getField(u, "sum") ?? 0),
      periodType: getField(u, "budgetPeriodType.name") || getField(u, "periodType") || null,
      active: getField(u, "active") ?? true,
      customerId: getField(u, "customerId") || null,
      notificationPercentage: getField(u, "notificationPercentage") ?? null,
      createdAt: getField(u, "createdAt") || null,
    };
  }

  mapProductList(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      name: getField(u, "name") || "",
      customerId: getField(u, "customerId") || "",
      employeeId: getField(u, "employeeId") || null,
      listTypeId: getField(u, "listTypeId") || null,
      salesChannelId: getField(u, "salesChannelId") || null,
      createdAt: getField(u, "createdAt") || null,
    };
  }

  mapProductListItem(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      productListId: getField(u, "productListId") || getField(u, "listId") || null,
      productId: getField(u, "productId") || null,
      productNumber: getField(u, "product.productNumber") || getField(u, "productNumber") || null,
      quantity: Number(getField(u, "quantity") ?? 1),
    };
  }

  mapCustomerSku(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      customerId: getField(u, "customerId") || null,
      productId: getField(u, "productId") || null,
      customerProductNumber: getField(u, "customerProductNumber") || getField(u, "number") || "",
      productNumber: getField(u, "product.productNumber") || null,
    };
  }

  mapExplodedView(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      name: getField(u, "name") || getField(u, "translated.name") || "",
      productId: getField(u, "productId") || null,
      mediaId: getField(u, "mediaId") || null,
      active: getField(u, "active") ?? true,
    };
  }

  mapEmployeeOrder(raw: any) {
    const u = unwrapEntity(raw);
    return {
      id: u.id,
      orderId: getField(u, "orderId") || null,
      orderNumber: getField(u, "order.orderNumber") || null,
      employeeId: getField(u, "employeeId") || null,
      status: getField(u, "status") || getField(u, "stateMachineState.name") || "pending",
      totalPrice: Number(getField(u, "order.amountTotal") ?? getField(u, "amountTotal") ?? 0),
      createdAt: getField(u, "createdAt") || null,
    };
  }

  async fetchCompanies(filters: {
    search?: string;
    page?: number;
    limit?: number;
    salesChannelIds?: string[];
  }) {
    const limit = filters.limit || 50;
    const page = filters.page || 1;
    const channelFiltered = Boolean(filters.salesChannelIds?.length);
    try {
      if (channelFiltered) {
        const [companyEntities, businessCustomers] = await Promise.all([
          this.searchAllCompanyEntities({
            search: filters.search,
            salesChannelIds: filters.salesChannelIds,
          }),
          this.searchAllBusinessCustomers({
            search: filters.search,
            salesChannelIds: filters.salesChannelIds,
          }),
        ]);
        const knownCustomerIds = new Set(companyEntities.map((c) => c.customerId || c.id));
        const supplemental = businessCustomers.filter((c) => !knownCustomerIds.has(c.customerId || c.id));
        const companies = this.sortCompaniesByCreatedAt(
          this.dedupeCompaniesByCustomerId([...companyEntities, ...supplemental]),
        );
        const start = (page - 1) * limit;
        return {
          companies: companies.slice(start, start + limit),
          total: companies.length,
        };
      }

      const result = await this.searchEntity(
        "company",
        this.buildCompanyEntitySearchCriteria({ ...filters, limit, page }),
      );
      const companies = this.dedupeCompaniesByCustomerId(result.data.map((r) => this.mapCompany(r)));
      return { companies, total: result.total };
    } catch (primaryError) {
      const business = await this.searchBusinessCustomers(filters);
      if (business.companies.length === 0) {
        const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError);
        throw new Error(`Failed to fetch B2B companies (${primaryMessage})`);
      }
      const companies = this.dedupeCompaniesByCustomerId(business.companies);
      return { companies, total: business.total };
    }
  }

  async fetchEmployees(filters: { companyId?: string; customerId?: string; search?: string; page?: number; limit?: number }) {
    const limit = filters.limit || 50;
    const page = filters.page || 1;
    const criteria: Record<string, unknown> = {
      limit,
      page,
      totalCountMode: 1,
      sort: [{ field: "lastName", order: "ASC" }],
      associations: this.buildAssociations(["customers"]),
      filter: [],
    };
    if (filters.search) {
      (criteria.filter as any[]).push({
        type: "multi",
        operator: "or",
        queries: [
          { type: "contains", field: "email", value: filters.search },
          { type: "contains", field: "firstName", value: filters.search },
          { type: "contains", field: "lastName", value: filters.search },
        ],
      });
    }
    if (filters.customerId) {
      try {
        const links = await this.searchEntity("employeeCustomer", {
          limit: 500,
          filter: [{ type: "equals", field: "customerId", value: filters.customerId }],
        });
        const employeeIds = links.data.map((l) => getField(l, "employeeId")).filter(Boolean);
        if (employeeIds.length === 0) return { employees: [], total: 0 };
        (criteria.filter as any[]).push({ type: "equalsAny", field: "id", value: employeeIds });
      } catch {
        /* entity may not exist */
      }
    }
    const result = await this.searchEntity("employee", criteria);
    return { employees: result.data.map((r) => this.mapEmployee(r)), total: result.total };
  }

  async setEmployeeActive(employeeId: string, active: boolean): Promise<void> {
    await this.patchEntity("employee", employeeId, { active });
  }

  async deleteEmployee(employeeId: string): Promise<void> {
    try {
      const links = await this.searchEntity("employeeCustomer", {
        limit: 500,
        filter: [{ type: "equals", field: "employeeId", value: employeeId }],
      });
      for (const link of links.data) {
        const linkId = getField(unwrapEntity(link), "id");
        if (linkId) {
          await this.deleteEntity("employeeCustomer", linkId);
        }
      }
    } catch {
      /* employeeCustomer entity may not exist */
    }
    await this.deleteEntity("employee", employeeId);
  }

  async fetchRoles() {
    const result = await this.searchEntity("employeeRole", {
      limit: 200,
      sort: [{ field: "name", order: "ASC" }],
    });
    return result.data.map((r) => this.mapRole(r));
  }

  async fetchBudgets(filters: { customerId?: string; page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      associations: this.buildAssociations(["budgetPeriodType", "customer"]),
      filter: [],
    };
    if (filters.customerId) {
      (criteria.filter as any[]).push({ type: "equals", field: "customerId", value: filters.customerId });
    }
    const result = await this.searchEntity("budget", criteria);
    return { budgets: result.data.map((r) => this.mapBudget(r)), total: result.total };
  }

  async fetchPendingApprovals(filters: { page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      associations: this.buildAssociations(["order", "employee", "stateMachineState"]),
      filter: [],
    };
    try {
      (criteria.filter as any[]).push({
        type: "multi",
        operator: "or",
        queries: [
          { type: "equals", field: "status", value: "pending" },
          { type: "contains", field: "stateMachineState.name", value: "pending" },
          { type: "contains", field: "stateMachineState.name", value: "open" },
        ],
      });
      const result = await this.searchEntity("employeeOrder", criteria);
      return { approvals: result.data.map((r) => this.mapEmployeeOrder(r)), total: result.total };
    } catch {
      return { approvals: [], total: 0 };
    }
  }

  async fetchProductLists(filters: { customerId?: string; page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      associations: this.buildAssociations(["customer", "employee", "items"]),
      filter: [],
    };
    if (filters.customerId) {
      (criteria.filter as any[]).push({ type: "equals", field: "customerId", value: filters.customerId });
    }
    const result = await this.searchEntity("productList", criteria);
    return { lists: result.data.map((r) => this.mapProductList(r)), total: result.total };
  }

  async fetchProductListItems(listId: string) {
    const result = await this.searchEntity("productListItem", {
      limit: 500,
      filter: [{ type: "equals", field: "productListId", value: listId }],
      associations: this.buildAssociations(["product"]),
    });
    return result.data.map((r) => this.mapProductListItem(r));
  }

  async fetchCustomerSkus(filters: { customerId?: string; search?: string; page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "customerProductNumber", order: "ASC" }],
      associations: this.buildAssociations(["product"]),
      filter: [],
    };
    if (filters.customerId) {
      (criteria.filter as any[]).push({ type: "equals", field: "customerId", value: filters.customerId });
    }
    if (filters.search) {
      (criteria.filter as any[]).push({
        type: "multi",
        operator: "or",
        queries: [
          { type: "contains", field: "customerProductNumber", value: filters.search },
          { type: "contains", field: "number", value: filters.search },
        ],
      });
    }
    const result = await this.searchEntity("customerProductNumber", criteria);
    return { skus: result.data.map((r) => this.mapCustomerSku(r)), total: result.total };
  }

  async fetchAssortments(filters: { customerId?: string; page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      associations: this.buildAssociations(["product", "customer"]),
      filter: [],
    };
    if (filters.customerId) {
      (criteria.filter as any[]).push({ type: "equals", field: "customerId", value: filters.customerId });
    }
    try {
      const result = await this.searchEntity("customerPrice", criteria);
      return {
        assortments: result.data.map((r: any) => {
          const u = unwrapEntity(r);
          return {
            id: u.id,
            customerId: getField(u, "customerId") || null,
            productId: getField(u, "productId") || null,
            productNumber: getField(u, "product.productNumber") || null,
            price: Number(getField(u, "price") ?? getField(u, "priceNet") ?? 0),
          };
        }),
        total: result.total,
      };
    } catch (err) {
      throw err;
    }
  }

  async fetchExplodedViews(filters: { search?: string; page?: number; limit?: number }) {
    const criteria: Record<string, unknown> = {
      limit: filters.limit || 50,
      page: filters.page || 1,
      totalCountMode: 1,
      sort: [{ field: "createdAt", order: "DESC" }],
      filter: [],
    };
    if (filters.search) {
      (criteria.filter as any[]).push({
        type: "contains",
        field: "name",
        value: filters.search,
      });
    }
    const result = await this.searchEntity("productExplodedView", criteria);
    return { views: result.data.map((r) => this.mapExplodedView(r)), total: result.total };
  }

  async fetchExplodedViewItems(viewId: string) {
    const result = await this.searchEntity("productExplodedViewItem", {
      limit: 500,
      filter: [{ type: "equals", field: "productExplodedViewId", value: viewId }],
      associations: this.buildAssociations(["product"]),
    });
    return result.data.map((r: any) => {
      const u = unwrapEntity(r);
      return {
        id: u.id,
        productId: getField(u, "productId") || null,
        productNumber: getField(u, "product.productNumber") || null,
        label: getField(u, "label") || getField(u, "name") || null,
        positionX: getField(u, "positionX") ?? null,
        positionY: getField(u, "positionY") ?? null,
      };
    });
  }
}

export async function createB2BAdminClient(settings: ShopwareSettings): Promise<B2BSellersAdminClient> {
  const mapping = await getStoredB2BEntityMapping();
  return new B2BSellersAdminClient(settings, mapping);
}
