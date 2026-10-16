/**
 * Portal-Registrierungen: Zugriff auf Shopware/B2Bsellers (lesen, Mitarbeiter anlegen, Kunde
 * nachziehen, Passwort-Mail). Hinter einer schmalen Schnittstelle, damit Ablauf und Plan ohne Shop
 * testbar sind.
 */
import crypto from "crypto";
import type { ShopwareClient } from "../shopware/shopware";
import type { B2BSellersAdminClient } from "./b2bSellersAdmin";
import { employeeConfiguratorCustomFields } from "@shared/b2bEntityMapping";
import type { PortalCustomerSnapshot, PortalRegistrationSalutation } from "@shared/portalRegistrations";
import type { ScoredHit } from "./portalRegistrationMatch";
import { companySearchToken, emailDomain } from "./portalRegistrationMatch";
import { isFreemailDomain } from "../commercial/freemailDomains";
import { normalizeCustomerNumber, normalizeVatId } from "./portalRegistrationExtraction";

const PORTAL_CHANNEL_NAME_RE = /portal/i;

export type PortalEmployeeInfo = {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  /** Kunden, mit denen der Mitarbeiter verknüpft ist */
  customerIds: string[];
  expertMode: boolean;
  adminMode: boolean;
  boundSalesChannelId: string | null;
};

export type PortalRegistrationShopApi = {
  /** Kandidaten zur Anmeldung (breit gesucht, Bewertung macht decidePortalMatch) */
  findCandidates(query: {
    customerNumber: string | null;
    email: string | null;
    vatId: string | null;
    company: string | null;
    zipCode: string | null;
  }): Promise<ScoredHit[]>;
  getCustomer(id: string): Promise<PortalCustomerSnapshot | null>;
  findCustomersByNumber(customerNumber: string): Promise<PortalCustomerSnapshot[]>;
  findEmployee(email: string): Promise<PortalEmployeeInfo | null>;
  createEmployee(input: {
    email: string;
    firstName: string;
    lastName: string;
    salutation: PortalRegistrationSalutation;
    phone: string | null;
    expertMode: boolean | null;
    adminMode: boolean | null;
  }): Promise<string>;
  updateEmployee(
    id: string,
    patch: { firstName?: string; lastName?: string; phone?: string | null; expertMode?: boolean | null; adminMode?: boolean | null },
  ): Promise<void>;
  /** Verknüpfung als Admin + aktiv; nur aufrufen, wenn der Mitarbeiter an keinem anderen Kunden hängt */
  ensureAdminLink(employeeId: string, customerId: string): Promise<{ created: boolean }>;
  updateCustomer(
    customer: PortalCustomerSnapshot,
    changes: { active?: boolean; platformAccess?: boolean; vatId?: string; phone?: string },
  ): Promise<void>;
  requestPasswordReset(params: { salesChannelId: string; email: string; storefrontUrl: string }): Promise<void>;
};

type ChannelInfo = { name: string; isPortal: boolean };

const CUSTOMER_INCLUDES = {
  customer: [
    "id",
    "customerNumber",
    "company",
    "email",
    "active",
    "salesChannelId",
    "vatIds",
    "customFields",
    "defaultBillingAddressId",
    "defaultBillingAddress",
  ],
  customer_address: ["id", "street", "zipcode", "city", "phoneNumber", "country", "company"],
  country: ["iso"],
};

const CUSTOMER_ASSOCIATIONS = { defaultBillingAddress: { associations: { country: {} } } };

function coerceBool(v: unknown): boolean | null {
  if (v === true || v === 1 || v === "1" || v === "true") return true;
  if (v === false || v === 0 || v === "0" || v === "false") return false;
  return null;
}

export function mapCustomerSnapshot(raw: any, channels: Map<string, ChannelInfo>): PortalCustomerSnapshot {
  const a = raw?.attributes ?? raw ?? {};
  const addr = a.defaultBillingAddress?.attributes ?? a.defaultBillingAddress ?? null;
  const cf = (a.customFields && typeof a.customFields === "object" ? a.customFields : {}) as Record<string, unknown>;
  const channelId = a.salesChannelId ? String(a.salesChannelId) : null;
  const channel = channelId ? channels.get(channelId.replace(/-/g, "").toLowerCase()) : undefined;
  const country = addr?.country?.attributes ?? addr?.country ?? null;
  const str = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : String(v).trim());
  return {
    id: String(raw?.id ?? a.id),
    customerNumber: str(a.customerNumber),
    company: str(a.company) ?? str(addr?.company),
    email: str(a.email)?.toLowerCase() ?? null,
    active: a.active !== false,
    salesChannelId: channelId,
    salesChannelName: channel?.name ?? null,
    isPortal: channel?.isPortal ?? false,
    vatIds: Array.isArray(a.vatIds) ? a.vatIds.map(String).filter(Boolean) : [],
    address: {
      id: str(addr?.id ?? a.defaultBillingAddressId),
      street: str(addr?.street),
      zipCode: str(addr?.zipcode ?? addr?.zipCode),
      city: str(addr?.city),
      countryIso: str(country?.iso),
      phone: str(addr?.phoneNumber),
    },
    platformAccess: coerceBool(cf.b2b_platform_access),
    salesRepresentative: coerceBool(cf.b2b_sales_representative) === true,
  };
}

/** Zufälliges Startpasswort: niemand kennt es, der Händler setzt seins über die Passwort-Mail */
export function randomEmployeePassword(): string {
  return `${crypto.randomBytes(18).toString("base64url")}Aa1!`;
}

export function createPortalRegistrationShopApi(shop: ShopwareClient, b2b: B2BSellersAdminClient): PortalRegistrationShopApi {
  let channelsPromise: Promise<Map<string, ChannelInfo>> | null = null;
  const channels = () => {
    channelsPromise ??= shop.fetchSalesChannels().then(
      (list) =>
        new Map(
          list.map((c) => [String(c.id).replace(/-/g, "").toLowerCase(), { name: c.name, isPortal: PORTAL_CHANNEL_NAME_RE.test(c.name ?? "") }]),
        ),
    );
    return channelsPromise;
  };

  let salutationIds: Promise<Record<string, string>> | null = null;
  const salutations = () => {
    salutationIds ??= (async () => {
      const res = await shop.makeAuthenticatedRequest(`${shop.baseUrl}/api/search/salutation`, {
        method: "POST",
        body: JSON.stringify({ limit: 20, includes: { salutation: ["id", "salutationKey"] } }),
      });
      if (!res.ok) return {};
      const json = await res.json();
      const out: Record<string, string> = {};
      for (const row of json.data ?? []) {
        const s = row.attributes ?? row;
        if (s.salutationKey) out[String(s.salutationKey)] = String(row.id ?? s.id);
      }
      return out;
    })();
    return salutationIds;
  };

  async function searchCustomers(criteria: Record<string, unknown>): Promise<PortalCustomerSnapshot[]> {
    const res = await shop.makeAuthenticatedRequest(`${shop.baseUrl}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({ limit: 25, includes: CUSTOMER_INCLUDES, associations: CUSTOMER_ASSOCIATIONS, ...criteria }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Kundensuche fehlgeschlagen: ${res.status} ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const map = await channels();
    return (json.data ?? []).map((row: unknown) => mapCustomerSnapshot(row, map));
  }

  async function getCustomer(id: string): Promise<PortalCustomerSnapshot | null> {
    const rows = await searchCustomers({ limit: 1, ids: [id.replace(/-/g, "").toLowerCase()] });
    return rows[0] ?? null;
  }

  async function findEmployee(email: string): Promise<PortalEmployeeInfo | null> {
    const list = await b2b.findEmployeesByEmail(email.trim().toLowerCase());
    const e = list[0];
    if (!e) return null;
    const customerIds = await b2b.findCustomerIdsForEmployee(e.id);
    const perms = (e as { configuratorPermissions?: { adminMode?: boolean; expertMode?: boolean } }).configuratorPermissions;
    return {
      id: e.id,
      email: String(e.email ?? email).toLowerCase(),
      firstName: (e as { firstName?: string | null }).firstName ?? null,
      lastName: (e as { lastName?: string | null }).lastName ?? null,
      customerIds,
      expertMode: perms?.expertMode === true,
      adminMode: perms?.adminMode === true,
      boundSalesChannelId: (e as { boundSalesChannelId?: string | null }).boundSalesChannelId ?? null,
    };
  }

  return {
    async findCandidates(q) {
      const hits: ScoredHit[] = [];
      const exact: unknown[] = [];
      const number = normalizeCustomerNumber(q.customerNumber);
      if (number) exact.push({ type: "equals", field: "customerNumber", value: number });
      const email = q.email?.trim().toLowerCase() || null;
      if (email) exact.push({ type: "equals", field: "email", value: email });
      const vat = normalizeVatId(q.vatId);
      if (vat) exact.push({ type: "contains", field: "vatIds", value: vat });
      if (exact.length) {
        for (const c of await searchCustomers({ filter: [{ type: "multi", operator: "or", queries: exact }] })) hits.push({ customer: c });
      }
      const token = companySearchToken(q.company);
      if (token) {
        for (const c of await searchCustomers({ filter: [{ type: "contains", field: "company", value: token }] })) hits.push({ customer: c });
      }
      if (q.zipCode?.trim()) {
        for (const c of await searchCustomers({
          filter: [{ type: "equals", field: "defaultBillingAddress.zipcode", value: q.zipCode.trim() }],
        })) {
          hits.push({ customer: c });
        }
      }
      const domain = emailDomain(email);
      if (domain && !isFreemailDomain(domain)) {
        for (const c of await searchCustomers({ limit: 10, filter: [{ type: "suffix", field: "email", value: `@${domain}` }] })) {
          hits.push({ customer: c });
        }
      }
      if (email) {
        const employee = await findEmployee(email);
        for (const customerId of employee?.customerIds ?? []) {
          const c = await getCustomer(customerId);
          if (c) hits.push({ customer: c, viaEmployeeEmail: true });
        }
      }
      return hits;
    },

    getCustomer,

    async findCustomersByNumber(customerNumber) {
      const number = normalizeCustomerNumber(customerNumber);
      if (!number) return [];
      return searchCustomers({ filter: [{ type: "equals", field: "customerNumber", value: number }] });
    },

    findEmployee,

    async createEmployee(input) {
      const [languageId, salutationMap, defaultSalutationId] = await Promise.all([
        shop.getDefaultLanguageId(),
        salutations(),
        shop.getDefaultSalutationId(),
      ]);
      if (!languageId) throw new Error("Standard-Sprache in Shopware nicht gefunden");
      const salutationId =
        (input.salutation && salutationMap[input.salutation]) || salutationMap.not_specified || defaultSalutationId;
      const payload: Record<string, unknown> = {
        email: input.email.trim().toLowerCase(),
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        languageId,
        salutationId,
        password: randomEmployeePassword(),
        phoneNumber: input.phone?.trim() || null,
      };
      const cf = employeeConfiguratorCustomFields({
        expertMode: input.expertMode === true ? true : undefined,
        adminMode: input.adminMode === true ? true : undefined,
      });
      if (Object.keys(cf).length) payload.customFields = cf;
      // Ohne Flow: die Willkommens-Mail von B2Bsellers ginge mit einem Passwort raus, das niemand kennt
      const created = await b2b.createEntity("employee", payload, { skipTriggerFlow: true });
      return created.id;
    },

    async updateEmployee(id, patch) {
      const payload: Record<string, unknown> = {};
      if (patch.firstName) payload.firstName = patch.firstName.trim();
      if (patch.lastName) payload.lastName = patch.lastName.trim();
      if (patch.phone) payload.phoneNumber = patch.phone.trim();
      const cf = employeeConfiguratorCustomFields({
        expertMode: patch.expertMode === true ? true : undefined,
        adminMode: patch.adminMode === true ? true : undefined,
      });
      if (Object.keys(cf).length) payload.customFields = cf;
      if (Object.keys(payload).length === 0) return;
      await b2b.patchEntity("employee", id, payload, { skipTriggerFlow: true });
    },

    async ensureAdminLink(employeeId, customerId) {
      const r = await b2b.ensureEmployeeCustomerLink(employeeId, customerId, { admin: true, active: true, skipTriggerFlow: true });
      return { created: r.created };
    },

    async updateCustomer(customer, changes) {
      const patch: Record<string, unknown> = {};
      if (changes.active !== undefined) patch.active = changes.active;
      if (changes.platformAccess !== undefined) patch.customFields = { b2b_platform_access: changes.platformAccess };
      if (changes.vatId) patch.vatIds = [...new Set([...customer.vatIds, changes.vatId])];
      if (Object.keys(patch).length) {
        const res = await shop.makeAuthenticatedRequest(`${shop.baseUrl}/api/customer/${customer.id}`, {
          method: "PATCH",
          headers: { "sw-skip-trigger-flow": "1" },
          body: JSON.stringify(patch),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Kunde ${customer.customerNumber ?? customer.id} nicht aktualisiert: ${res.status} ${text.slice(0, 200)}`);
        }
      }
      if (changes.phone && customer.address.id) {
        const res = await shop.makeAuthenticatedRequest(`${shop.baseUrl}/api/customer-address/${customer.address.id}`, {
          method: "PATCH",
          headers: { "sw-skip-trigger-flow": "1" },
          body: JSON.stringify({ phoneNumber: changes.phone }),
        });
        if (!res.ok) {
          const text = await res.text().catch(() => "");
          throw new Error(`Telefon am Kunden ${customer.customerNumber ?? customer.id} nicht gesetzt: ${res.status} ${text.slice(0, 200)}`);
        }
      }
    },

    async requestPasswordReset(params) {
      await b2b.requestEmployeePasswordRecovery(params);
    },
  };
}
