// Shopware: Kunden und B2B-Portal-Benutzer (Suche, Anlage, Pflege, Fingerprints, Storefront-Login).
import type { ShopwareClient } from "../shopware";
import { toShopwareUuid, SHOPWARE_ADMIN_SEARCH_PAGE_SIZE } from "./mapping";
import type { OrderAddress } from "@shared/schema";
import { logger } from "../../lib/logger";

const moduleLog = logger.child({ component: "shopware/client/customers" });

/**
 * Zählt die Kunden im Shop (gesamt) und pro Verkaufskanal.
 * Nutzt total-count-mode "exact" für die Gesamtzahl und eine Terms-
 * Aggregation auf salesChannelId für die Aufschlüsselung je Kanal
 * (z. B. Shop vs. Händler-Portal).
 */
export async function fetchCustomerCounts(this: ShopwareClient): Promise<{
  total: number;
  byChannel: Array<{ salesChannelId: string | null; salesChannelName: string; count: number }>;
}> {
  const nameMap = await this.fetchSalesChannelNameMap().catch(
    () => new Map<string, string>(),
  );
  const data = await this.searchEntity("customer", {
    limit: 1,
    "total-count-mode": "exact",
    aggregations: [
      { name: "byChannel", type: "terms", field: "salesChannelId", limit: 500 },
    ],
  });
  const total = Number(data?.total ?? data?.meta?.total ?? 0);
  const buckets: any[] = data?.aggregations?.byChannel?.buckets || [];
  const byChannel = buckets
    .map((b) => {
      const id =
        b?.key != null && String(b.key).trim() !== "" ? String(b.key) : null;
      const name = id ? nameMap.get(id) ?? id : "Unbekannter Kanal";
      return {
        salesChannelId: id,
        salesChannelName: name,
        count: Number(b?.count ?? 0),
      };
    })
    .sort((a, b) => b.count - a.count);
  return { total, byChannel };
}

/** Fingerprint-String für Bestandskunden-Index (Portal/Händler-Gruppen). */
export async function fetchBestandskundenFingerprint(this: ShopwareClient, groupNameTerms: string[]): Promise<string | null> {
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

  const { stableFingerprint } = await import("../../lib/contentHashCache");
  return stableFingerprint({
    scope: "bestandskunden",
    terms: terms.join(","),
    total: fp.total,
    latestUpdatedAt: fp.latestUpdatedAt,
    latestId: fp.latestId,
  });
}

/**
 * Kunden mit updatedAt >= since (ASC), fuer Delta-Sync.
 */
export async function fetchCustomersChangedSince(
  this: ShopwareClient,
  since: string | Date | null,
  limit: number = 250,
  page: number = 1,
): Promise<{
  customers: Array<{
    id: string;
    customerNumber: string | null;
    email: string | null;
    company: string | null;
    firstName: string | null;
    lastName: string | null;
    phone: string | null;
    groupId: string | null;
    groupName: string | null;
    salesChannelId: string | null;
    active: boolean | null;
    createdAt: string | null;
    updatedAt: string | null;
  }>;
  total: number;
}> {
  const sinceIso =
    since == null ? null : typeof since === "string" ? since : since.toISOString();

  const filter: any[] = [];
  if (sinceIso) {
    filter.push({
      type: "range",
      field: "updatedAt",
      parameters: { gte: sinceIso },
    });
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit,
      page,
      "total-count-mode": 1,
      sort: [{ field: "updatedAt", order: "ASC" }],
      filter,
      associations: { group: {}, defaultBillingAddress: {} },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to fetch customers changed since: ${response.statusText} - ${errorText}`);
  }

  const data = await response.json();
  const list = data.data || [];
  const includedMap = new Map<string, any>();
  for (const item of data.included || []) {
    if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
  }

  const customers = list.map((row: any) => {
    const a = row.attributes || row;
    let company = a.company ? String(a.company).trim() : "";
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

    let groupId: string | null = null;
    let groupName: string | null = null;
    const groupNested = row.group?.attributes || row.group;
    if (groupNested?.id || row.groupId) {
      groupId = String(groupNested?.id || row.groupId || a.groupId || "");
      groupName = groupNested?.name ? String(groupNested.name) : null;
    } else if (row.relationships?.group?.data?.id) {
      groupId = String(row.relationships.group.data.id);
      const g = includedMap.get(`customer_group-${groupId}`);
      groupName = g?.attributes?.name ? String(g.attributes.name) : null;
    }

    const cnRaw = a.customerNumber ?? a.customerNo;
    return {
      id: String(row.id),
      customerNumber: cnRaw != null && String(cnRaw).trim() ? String(cnRaw).trim() : null,
      email: a.email ? String(a.email).trim().toLowerCase() : null,
      company: company || null,
      firstName: a.firstName ? String(a.firstName) : null,
      lastName: a.lastName ? String(a.lastName) : null,
      phone: a.defaultBillingAddress?.phoneNumber
        ? String(a.defaultBillingAddress.phoneNumber)
        : a.phoneNumber
          ? String(a.phoneNumber)
          : null,
      groupId,
      groupName,
      salesChannelId: a.salesChannelId ? String(a.salesChannelId) : null,
      active: a.active !== undefined ? Boolean(a.active) : null,
      createdAt: a.createdAt ? String(a.createdAt) : null,
      updatedAt: a.updatedAt ? String(a.updatedAt) : null,
    };
  });

  const total = Number(data?.meta?.total ?? data?.total ?? customers.length);
  return { customers, total };
}

/** Leichter ID-Sweep aller Kunden-IDs. */
export async function fetchAllCustomerIds(this: ShopwareClient): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  const BATCH = 500;
  let page = 1;
  let total = 0;

  while (true) {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: BATCH,
        page,
        "total-count-mode": 1,
        includes: { customer: ["id"] },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch customer ids: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    total = Number(data?.meta?.total ?? data?.total ?? total);
    const list = data.data || [];
    for (const row of list) {
      if (row?.id) ids.push(String(row.id));
    }
    if (list.length < BATCH) break;
    page += 1;
  }
  return { ids, total: total || ids.length };
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
export async function findCustomerByEmail(this: ShopwareClient, email: string): Promise<any | null> {
  try {
    moduleLog.info(`[Shopware] Searching for customer with email: ${email}`);
    
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
      moduleLog.info(`[Shopware] Found existing customer: ${customers[0].id}`);
      return customers[0];
    }
    
    moduleLog.info(`[Shopware] No customer found with email: ${email}`);
    return null;
  } catch (error: any) {
    moduleLog.error({ err: error }, "Error searching for customer:");
    throw new Error(`Failed to search for customer: ${error.message}`);
  }
}

/**
 * Liefert ALLE Shopware-Kunden mit dieser E-Mail. Wichtig, weil dieselbe Person
 * in mehreren Verkaufskanälen (bound sales channel) als separate Kunden mit
 * gleicher E-Mail existieren kann – z. B. einmal im Portal (mit individuellen
 * Preisen) und einmal im Shop (ohne). Wir brauchen alle IDs/Kundennummern, um
 * die Preise vollständig aufzulösen.
 */
export async function findCustomersByEmail(
  this: ShopwareClient,
  email: string,
  limit: number = 25,
): Promise<Array<{ id: string; customerNumber: string | null; salesChannelId: string | null }>> {
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit,
        filter: [{ type: 'equals', field: 'email', value: email }],
        includes: { customer: ['id', 'customerNumber', 'salesChannelId'] },
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list: any[] = Array.isArray(data.data) ? data.data : [];
    return list.map((raw) => {
      const attrs = raw.attributes || raw;
      return {
        id: String(raw.id ?? attrs.id),
        customerNumber: attrs.customerNumber ? String(attrs.customerNumber) : null,
        salesChannelId: attrs.salesChannelId ? String(attrs.salesChannelId) : null,
      };
    });
  } catch (error: any) {
    moduleLog.error({ err: error }, "[Shopware] findCustomersByEmail error:");
    return [];
  }
}

/**
 * Search customers by term (email, firstName, lastName) for picker/UI.
 * Returns array of { id, email, firstName?, lastName?, company? }.
 */
export async function searchCustomers(this: ShopwareClient, searchTerm: string, limit: number = 20): Promise<Array<{ id: string; email?: string; firstName?: string; lastName?: string; company?: string; customerNumber?: string; zipCode?: string; city?: string; salesChannelId?: string; salesChannelName?: string }>> {
  const term = (searchTerm || '').trim();
  if (term.length < 2) return [];

  try {
    const body: { limit: number; filter?: any[]; associations?: any } = {
      limit,
      filter: [
        {
          type: 'multi',
          operator: 'OR',
          queries: [
            { type: 'contains', field: 'email', value: term },
            { type: 'contains', field: 'firstName', value: term },
            { type: 'contains', field: 'lastName', value: term },
            // B2B: Kunden werden über Firma und Kundennummer gesucht, nicht über den
            // Ansprechpartner — ohne diese Felder fand „Blumenbecker Industriebedarf GmbH"
            // keinen der elf vorhandenen Accounts.
            { type: 'contains', field: 'company', value: term },
            { type: 'contains', field: 'customerNumber', value: term },
            { type: 'contains', field: 'defaultBillingAddress.company', value: term },
            { type: 'equals', field: 'defaultBillingAddress.zipcode', value: term },
          ],
        },
      ],
      associations: { salesChannel: {}, defaultBillingAddress: {} },
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
      const salesChannel = attrs.salesChannel;
      return {
        id: c.id,
        email: attrs.email,
        firstName: attrs.firstName,
        lastName: attrs.lastName,
        company: attrs.company || attrs.defaultBillingAddress?.company || undefined,
        customerNumber: attrs.customerNumber ?? undefined,
        zipCode: attrs.defaultBillingAddress?.zipcode ?? undefined,
        city: attrs.defaultBillingAddress?.city ?? undefined,
        salesChannelId: salesChannel?.id ?? attrs.salesChannelId ?? undefined,
        salesChannelName: salesChannel?.name ?? salesChannel?.translated?.name ?? undefined,
      };
    });
  } catch (error: any) {
    moduleLog.error({ err: error }, "[Shopware] searchCustomers error:");
    return [];
  }
}

/** Liefert den an einen Kunden gebundenen Verkaufskanal (für Angebotserstellung aus CPQ). */
export async function fetchCustomerSalesChannelId(this: ShopwareClient, customerId: string): Promise<{ id: string; name: string | null } | null> {
  const id = toShopwareUuid(customerId);
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: 'POST',
      body: JSON.stringify({
        limit: 1,
        filter: [{ type: 'equals', field: 'id', value: id }],
        associations: { salesChannel: {} },
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const attrs = data.data?.[0]?.attributes ?? data.data?.[0];
    const salesChannel = attrs?.salesChannel;
    const channelId = salesChannel?.id ?? attrs?.salesChannelId ?? null;
    if (!channelId) return null;
    return { id: channelId, name: salesChannel?.name ?? salesChannel?.translated?.name ?? null };
  } catch (error: any) {
    moduleLog.warn({ err: error }, "[Shopware] fetchCustomerSalesChannelId error:");
    return null;
  }
}

/**
 * Erweiterte Kundensuche für den CRM-Bestandskundenabgleich.
 * Sucht über mehrere Felder (E-Mail exakt, Vor-/Nachname, Firma, Kundennummer)
 * und liefert je Treffer Kundennummer + Rechnungsadresse zur Identitätsprüfung.
 * Wirft nicht; bei Fehler leeres Array.
 */
export async function searchExistingCustomers(this: ShopwareClient, params: {
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
    moduleLog.error({ err: error }, "[Shopware] searchExistingCustomers error:");
    return [];
  }
}

/**
 * Lädt einen Shopware-Kunden per ID (für den Merge-Abgleich). Wirft nicht.
 */
export async function getCustomerById(this: ShopwareClient, customerId: string): Promise<{
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
    moduleLog.error({ err: error }, "[Shopware] getCustomerById error:");
    return null;
  }
}

/**
 * Deaktiviert einen Kunden (active = false). Wirft bei Fehler.
 */
export async function deactivateCustomer(this: ShopwareClient, customerId: string): Promise<boolean> {
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
export async function fetchBestandskundenIndex(this: ShopwareClient, groupNameTerms: string[]): Promise<Array<{ company: string; customerNumber: string | null }>> {
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
          "total-count-mode": 1,
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
      moduleLog.error({ err: error }, "[Shopware] fetchBestandskundenIndex error:");
      break;
    }
  }
  return out;
}

/**
 * Kundennummer + Standard-Rechnungsadresse für PDFs (z. B. Konfigurations-Angebot).
 * Nutzt Admin-Suche mit Assoziationen; bei Fehler/null ohne Wurf.
 */
export async function fetchCustomerBillingForPdf(this: ShopwareClient, customerId: string): Promise<{
  customerNumber?: string;
  billingAddress?: OrderAddress;
  email?: string;
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
    const email = String(custAttrs.email || "").trim() || undefined;

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

    const out: { customerNumber?: string; billingAddress?: OrderAddress; email?: string } = {};
    if (customerNumber) out.customerNumber = customerNumber;
    if (billingAddress) out.billingAddress = billingAddress;
    if (email) out.email = email;
    return Object.keys(out).length ? out : null;
  } catch (e) {
    moduleLog.warn({ err: e }, "[Shopware] fetchCustomerBillingForPdf:");
    return null;
  }
}

/**
 * Create a new customer in Shopware
 * Returns the created customer object
 */
export async function createCustomer(this: ShopwareClient, customerData: {
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
    moduleLog.info(`[Shopware] Creating new customer: ${customerData.email}`);
    
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

    // Shopware 6 antwortet auf POST /api/customer mit 204 No Content und der neuen ID
    // nur im Location-Header. Ein blindes response.json() warf hier "Unexpected end of
    // JSON input", obwohl der Kunde bereits angelegt war — der Aufrufer meldete dann
    // "fehlgeschlagen" und legte beim nächsten Lauf einen Dubletten-Kunden an.
    const rawBody = await response.text();
    let customer: any = null;
    if (rawBody.trim()) {
      try {
        const result = JSON.parse(rawBody);
        customer = result.data || result;
      } catch {
        customer = null;
      }
    }
    if (!customer?.id) {
      const location = response.headers.get("location") || "";
      const idFromLocation = location.split("/").filter(Boolean).pop() || "";
      const idFromBody = typeof (requestBody as { id?: unknown }).id === "string" ? (requestBody as { id: string }).id : "";
      const resolvedId = idFromLocation || idFromBody;
      if (!resolvedId) {
        throw new Error("Shopware returned no customer id (no body, no Location header)");
      }
      customer = { ...(customer || {}), id: resolvedId };
    }

    moduleLog.info(`[Shopware] Customer created successfully: ${customer.id}`);
    return customer;
  } catch (error: any) {
    moduleLog.error({ err: error }, "Error creating customer:");
    throw new Error(`Failed to create customer: ${error.message}`);
  }
}

/**
 * Creates a B2B portal customer with login credentials and business account type.
 */
export function portalCustomerWriteHeaders(this: ShopwareClient, sendEmails?: boolean): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (!sendEmails) {
    headers["sw-skip-trigger-flow"] = "1";
  }
  return headers;
}

export async function createB2BPortalCustomer(
  this: ShopwareClient,
  customerData: {
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    company?: string;
    groupId: string;
    salesChannelId?: string;
    billingAddress: {
      firstName?: string;
      lastName?: string;
      street: string;
      zipCode: string;
      city: string;
      country: string;
      company?: string;
    };
    active?: boolean;
    customFields?: Record<string, unknown>;
  },
  options?: { sendEmails?: boolean },
): Promise<{ id: string; email: string; customerNumber?: string }> {
  const billingCountryId = await this.getCountryIdByName(customerData.billingAddress.country);
  if (!billingCountryId?.trim()) {
    throw new Error(
      `Land für Rechnungsadresse nicht gefunden: "${customerData.billingAddress.country}". Bitte ISO-Code (z. B. DE, AT, CH) oder einen bekannten Landesnamen verwenden.`,
    );
  }

  const salutationId = await this.getDefaultSalutationId();
  const companyName = customerData.company?.trim() || customerData.billingAddress.company?.trim() || undefined;
  const salesChannelId = customerData.salesChannelId?.trim() || (await this.getDefaultSalesChannelId());
  const requestBody: Record<string, unknown> = {
    email: customerData.email.trim().toLowerCase(),
    password: customerData.password,
    firstName: customerData.firstName.trim(),
    lastName: customerData.lastName.trim(),
    accountType: "business",
    active: customerData.active ?? true,
    salutationId,
    // Kundennummer aus dem Shopware-Nummernkreis (wie bei einer Registrierung
    // im Storefront), nicht mehr als Zeitstempel-Kunstnummer.
    customerNumber: await this.nextCustomerNumber(salesChannelId),
    defaultPaymentMethodId: await this.getDefaultPaymentMethodId(),
    groupId: customerData.groupId,
    salesChannelId,
    // Wie bei einer Storefront-Registrierung mit aktiver Option „Kunden an
    // Verkaufskanal binden“: Der Portal-Kunde gehört zu genau diesem Kanal.
    boundSalesChannelId: salesChannelId,
    defaultBillingAddress: {
      firstName: customerData.billingAddress.firstName || customerData.firstName,
      lastName: customerData.billingAddress.lastName || customerData.lastName,
      street: customerData.billingAddress.street,
      zipcode: customerData.billingAddress.zipCode,
      city: customerData.billingAddress.city,
      countryId: billingCountryId,
      salutationId,
      company: companyName || customerData.billingAddress.company,
    },
  };

  if (companyName) {
    requestBody.company = companyName;
  }

  const customFields: Record<string, unknown> = {
    ...(customerData.customFields ?? {}),
    b2b_platform_access: true,
  };
  requestBody.customFields = customFields;

  if (options?.sendEmails) {
    requestBody._sendWelcomeMail = true;
  }

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer`, {
    method: "POST",
    headers: this.portalCustomerWriteHeaders(options?.sendEmails),
    body: JSON.stringify(requestBody),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to create B2B portal customer: ${response.statusText} - ${errorText}`);
  }

  const locationHeader = response.headers.get("location") || response.headers.get("Location");
  const locationId = locationHeader?.split("/").filter(Boolean).pop();
  const rawBody = await response.text();
  let result: any = {};
  if (rawBody.trim()) {
    try {
      result = JSON.parse(rawBody);
    } catch {
      /* Shopware liefert bei Erfolg oft 204 ohne JSON-Body */
    }
  }
  const customer = result.data || result;
  const id = customer?.id || locationId;
  if (!id) {
    throw new Error("B2B portal customer created but no ID returned");
  }

  return {
    id: String(id),
    email: customerData.email.trim().toLowerCase(),
    customerNumber: customer?.attributes?.customerNumber ?? customer?.customerNumber,
  };
}

/**
 * Nächste Kundennummer aus dem Nummernkreis `customer` des Verkaufskanals.
 * Fällt der Nummernkreis aus, bleibt die bisherige Zeitstempel-Nummer als Notlösung.
 */
export async function nextCustomerNumber(this: ShopwareClient, salesChannelId?: string): Promise<string> {
  try {
    return await this.reserveNumberRange("customer", salesChannelId);
  } catch (error) {
    moduleLog.warn({ err: error }, "[Shopware] Kundennummer aus Nummernkreis nicht verfügbar, Fallback auf Zeitstempel:");
    return `B2B-${Date.now()}`;
  }
}

/**
 * Aktualisiert nur die Rechnungsadresse — ohne den Kunden-Datensatz anzufassen.
 */
export async function updateB2BPortalCustomerBillingAddress(
  this: ShopwareClient,
  customerId: string,
  customerData: {
    firstName: string;
    lastName: string;
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
  },
  options?: { sendEmails?: boolean },
): Promise<void> {
  const id = toShopwareUuid(customerId.trim());
  if (!id) throw new Error("Kunden-ID fehlt");

  const existingResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer/${id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!existingResponse.ok) {
    const errorText = await existingResponse.text();
    throw new Error(`Kunde nicht gefunden: ${existingResponse.statusText} - ${errorText}`);
  }

  const existingRaw = await existingResponse.json();
  const existing = existingRaw.data || existingRaw;
  const existingAttrs = existing.attributes || existing;
  const defaultBillingAddressId =
    existingAttrs.defaultBillingAddressId || existing.defaultBillingAddressId || null;

  const billingCountryId = await this.getCountryIdByName(customerData.billingAddress.country);
  if (!billingCountryId?.trim()) {
    throw new Error(
      `Land für Rechnungsadresse nicht gefunden: "${customerData.billingAddress.country}".`,
    );
  }

  const salutationId = await this.getDefaultSalutationId();
  const companyName = customerData.company?.trim() || customerData.billingAddress.company?.trim() || undefined;
  const writeHeaders = this.portalCustomerWriteHeaders(options?.sendEmails);

  const billingAddressPayload: Record<string, unknown> = {
    firstName: customerData.billingAddress.firstName || customerData.firstName,
    lastName: customerData.billingAddress.lastName || customerData.lastName,
    street: customerData.billingAddress.street,
    zipcode: customerData.billingAddress.zipCode,
    city: customerData.billingAddress.city,
    countryId: billingCountryId,
    salutationId,
    company: companyName || customerData.billingAddress.company,
  };

  if (defaultBillingAddressId) {
    const addressResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/customer-address/${defaultBillingAddressId}`,
      {
        method: "PATCH",
        headers: writeHeaders,
        body: JSON.stringify(billingAddressPayload),
      },
    );
    if (!addressResponse.ok) {
      const errorText = await addressResponse.text();
      throw new Error(`Failed to update billing address: ${addressResponse.statusText} - ${errorText}`);
    }
    return;
  }

  const createAddressResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer-address`, {
    method: "POST",
    headers: writeHeaders,
    body: JSON.stringify({
      customerId: id,
      ...billingAddressPayload,
    }),
  });
  if (!createAddressResponse.ok) {
    const errorText = await createAddressResponse.text();
    throw new Error(`Failed to create billing address: ${createAddressResponse.statusText} - ${errorText}`);
  }
}

/**
 * Updates an existing B2B portal customer (group, sales channel, address).
 * Nicht für Vertriebsmitarbeiter verwenden — dort läuft Login über den Employee.
 */
export async function updateB2BPortalCustomer(
  this: ShopwareClient,
  customerId: string,
  customerData: {
    firstName: string;
    lastName: string;
    company?: string;
    groupId: string;
    salesChannelId: string;
    password?: string;
    customFields?: Record<string, unknown>;
    billingAddress: {
      firstName?: string;
      lastName?: string;
      street: string;
      zipCode: string;
      city: string;
      country: string;
      company?: string;
    };
  },
  options?: { sendEmails?: boolean },
): Promise<{ id: string }> {
  const id = toShopwareUuid(customerId.trim());
  if (!id) throw new Error("Kunden-ID fehlt");

  const existingResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer/${id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!existingResponse.ok) {
    const errorText = await existingResponse.text();
    throw new Error(`Kunde nicht gefunden: ${existingResponse.statusText} - ${errorText}`);
  }

  const existingRaw = await existingResponse.json();
  const existing = existingRaw.data || existingRaw;
  const existingAttrs = existing.attributes || existing;
  const defaultBillingAddressId =
    existingAttrs.defaultBillingAddressId || existing.defaultBillingAddressId || null;

  const billingCountryId = await this.getCountryIdByName(customerData.billingAddress.country);
  if (!billingCountryId?.trim()) {
    throw new Error(
      `Land für Rechnungsadresse nicht gefunden: "${customerData.billingAddress.country}".`,
    );
  }

  const salutationId = await this.getDefaultSalutationId();
  const companyName = customerData.company?.trim() || customerData.billingAddress.company?.trim() || undefined;
  const writeHeaders = this.portalCustomerWriteHeaders(options?.sendEmails);

  const syncPayload: Record<string, unknown> = {
    id,
    groupId: customerData.groupId,
    salesChannelId: customerData.salesChannelId,
  };
  if (companyName) syncPayload.company = companyName;
  if (customerData.customFields && Object.keys(customerData.customFields).length > 0) {
    syncPayload.customFields = customerData.customFields;
  }
  if (options?.sendEmails) {
    syncPayload._sendWelcomeMail = true;
  }

  const syncHeaders = {
    ...writeHeaders,
    "sw-skip-trigger-flow": options?.sendEmails ? "0" : "1",
  };

  const syncResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_action/sync`, {
    method: "POST",
    headers: syncHeaders,
    body: JSON.stringify({
      "portal-user-customer": {
        entity: "customer",
        action: "upsert",
        payload: [syncPayload],
      },
    }),
  });

  const syncRaw = await syncResponse.text();
  const employeeEmailConflict = /already assigned to an employee/i.test(syncRaw);
  if (!syncResponse.ok) {
    if (!employeeEmailConflict) {
      throw new Error(`Failed to update B2B portal customer: ${syncResponse.statusText} - ${syncRaw}`);
    }
    moduleLog.warn(`[Shopware] Skipping customer core update for ${id} (email linked to B2B employee); updating address only`);
  } else if (employeeEmailConflict) {
    moduleLog.warn(`[Shopware] Sync reported employee email conflict for ${id}; continuing with address/employee updates`);
  }

  const billingAddressPayload: Record<string, unknown> = {
    firstName: customerData.billingAddress.firstName || customerData.firstName,
    lastName: customerData.billingAddress.lastName || customerData.lastName,
    street: customerData.billingAddress.street,
    zipcode: customerData.billingAddress.zipCode,
    city: customerData.billingAddress.city,
    countryId: billingCountryId,
    salutationId,
    company: companyName || customerData.billingAddress.company,
  };

  if (defaultBillingAddressId) {
    const addressResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/customer-address/${defaultBillingAddressId}`,
      {
        method: "PATCH",
        headers: writeHeaders,
        body: JSON.stringify(billingAddressPayload),
      },
    );
    if (!addressResponse.ok) {
      const errorText = await addressResponse.text();
      throw new Error(`Failed to update billing address: ${addressResponse.statusText} - ${errorText}`);
    }
  } else {
    const createAddressResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer-address`, {
      method: "POST",
      headers: writeHeaders,
      body: JSON.stringify({
        customerId: id,
        ...billingAddressPayload,
      }),
    });
    if (!createAddressResponse.ok) {
      const errorText = await createAddressResponse.text();
      throw new Error(`Failed to create billing address: ${createAddressResponse.statusText} - ${errorText}`);
    }
    const locationHeader =
      createAddressResponse.headers.get("location") || createAddressResponse.headers.get("Location");
    const addressId = locationHeader?.split("/").filter(Boolean).pop();
    if (addressId) {
      const linkResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer/${id}`, {
        method: "PATCH",
        headers: writeHeaders,
        body: JSON.stringify({ defaultBillingAddressId: addressId }),
      });
      if (!linkResponse.ok) {
        const errorText = await linkResponse.text();
        throw new Error(`Failed to link billing address: ${linkResponse.statusText} - ${errorText}`);
      }
    }
  }

  return { id: String(id) };
}

export async function getPortalCustomerByEmail(this: ShopwareClient, email: string): Promise<{
  id: string;
  email: string;
  active: boolean;
  accountType: string | null;
  salesChannelId: string | null;
  groupId: string | null;
  customFields: Record<string, unknown>;
} | null> {
  const customer = await this.findCustomerByEmail(email.trim().toLowerCase());
  if (!customer) return null;
  return this.mapPortalCustomerSnapshot(customer);
}

export async function getPortalCustomerById(this: ShopwareClient, customerId: string): Promise<{
  id: string;
  email: string;
  active: boolean;
  accountType: string | null;
  salesChannelId: string | null;
  groupId: string | null;
  customFields: Record<string, unknown>;
} | null> {
  const id = toShopwareUuid(customerId.trim());
  if (!id) return null;

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/customer/${id}`, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
  if (!response.ok) return null;

  const raw = await response.json();
  const customer = raw.data || raw;
  if (!customer) return null;
  return this.mapPortalCustomerSnapshot(customer);
}

export function mapPortalCustomerSnapshot(this: ShopwareClient, customer: any): {
  id: string;
  email: string;
  active: boolean;
  accountType: string | null;
  salesChannelId: string | null;
  groupId: string | null;
  customFields: Record<string, unknown>;
} {
  const attrs = customer.attributes || customer;
  const customFields =
    attrs.customFields && typeof attrs.customFields === "object"
      ? (attrs.customFields as Record<string, unknown>)
      : {};
  return {
    id: String(customer.id || attrs.id),
    email: String(attrs.email || customer.email || "").toLowerCase(),
    active: attrs.active !== false && customer.active !== false,
    accountType: attrs.accountType != null ? String(attrs.accountType) : null,
    salesChannelId: attrs.salesChannelId != null ? String(attrs.salesChannelId) : null,
    groupId: attrs.groupId != null ? String(attrs.groupId) : null,
    customFields,
  };
}

export async function testStorefrontLogin(this: ShopwareClient, params: {
  email: string;
  password: string;
  salesChannelId: string;
}): Promise<{ success: boolean; message: string }> {
  const accessKey = await this.getSalesChannelAccessKey(params.salesChannelId);
  if (!accessKey) {
    return { success: false, message: "Access-Key für den Verkaufskanal nicht gefunden" };
  }

  const loginResponse = await fetch(`${this.baseUrl}/store-api/account/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "sw-access-key": accessKey,
      "sw-context-token": "",
    },
    body: JSON.stringify({
      username: params.email.trim().toLowerCase(),
      password: params.password,
    }),
  });

  if (!loginResponse.ok) {
    let message = loginResponse.statusText;
    try {
      const errorBody = await loginResponse.text();
      if (errorBody.trim()) {
        const parsed = JSON.parse(errorBody);
        message = parsed.errors?.[0]?.detail || parsed.errors?.[0]?.title || errorBody;
      }
    } catch {
      /* ignore parse errors */
    }
    return { success: false, message: String(message) };
  }

  const contextToken = loginResponse.headers.get("sw-context-token");
  if (!contextToken) {
    return { success: false, message: "Login ohne sw-context-token — Anmeldung unvollständig" };
  }

  const profileResponse = await fetch(`${this.baseUrl}/store-api/account/customer`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "sw-access-key": accessKey,
      "sw-context-token": contextToken,
    },
    body: JSON.stringify({}),
  });

  if (!profileResponse.ok) {
    return { success: true, message: "Login erfolgreich (Profilabruf nicht verfügbar)" };
  }

  try {
    const profile = await profileResponse.json();
    const loggedEmail = profile?.email || profile?.data?.email;
    return {
      success: true,
      message: loggedEmail ? `Login erfolgreich als ${loggedEmail}` : "Login erfolgreich",
    };
  } catch {
    return { success: true, message: "Login erfolgreich" };
  }
}
