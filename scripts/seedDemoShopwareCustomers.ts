/**
 * Legt Demo-Kunden in Shopware an (passend zu demo-mails/*.eml).
 *
 * Usage:
 *   TENANT_ID=c49bfa7e-06a8-452a-9d47-c490629aca4a npx tsx scripts/seedDemoShopwareCustomers.ts
 *   TENANT_ID=... npx tsx scripts/seedDemoShopwareCustomers.ts --dry-run
 */

import { randomUUID } from "crypto";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";

const DEV_TENANT_ID = "c49bfa7e-06a8-452a-9d47-c490629aca4a";

export type DemoShopwareCustomer = {
  /** Feste UUID (32 hex) für idempotente Upserts */
  id?: string;
  customerNumber: string;
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  phone?: string;
  billingAddress: {
    street: string;
    zipCode: string;
    city: string;
    country: string;
    company?: string;
  };
};

/** Entspricht den drei Demo-Mails unter demo-mails/ */
export const DEMO_SHOPWARE_CUSTOMERS: DemoShopwareCustomer[] = [
  {
    id: "a1b2c3d4e5f6478990a1b2c3d4e5f601",
    customerNumber: "DEMO-MAIL-01",
    email: "einkauf@mustermann-logistik.at",
    firstName: "Anna",
    lastName: "Berger",
    company: "Mustermann Logistik GmbH",
    phone: "+43 7752 123456-20",
    billingAddress: {
      company: "Mustermann Logistik GmbH",
      street: "Industriestrasse 14",
      zipCode: "4910",
      city: "Ried im Innkreis",
      country: "AT",
    },
  },
  {
    id: "a1b2c3d4e5f6478990a1b2c3d4e5f602",
    customerNumber: "DEMO-MAIL-02",
    email: "t.keller@technik-neumayer.at",
    firstName: "Thomas",
    lastName: "Keller",
    company: "Technik Service Neumayer KG",
    phone: "+43 6132 987654",
    billingAddress: {
      company: "Technik Service Neumayer KG",
      street: "Werkstrasse 8",
      zipCode: "4820",
      city: "Bad Ischl",
      country: "AT",
    },
  },
  {
    id: "a1b2c3d4e5f6478990a1b2c3d4e5f603",
    customerNumber: "DEMO-MAIL-03",
    email: "s.wolf@wolf-partner.at",
    firstName: "Sandra",
    lastName: "Wolf",
    company: "Wolf & Partner Handels GmbH",
    phone: "+43 732 555123",
    billingAddress: {
      company: "Wolf & Partner Handels GmbH",
      street: "Linzer Strasse 42",
      zipCode: "4020",
      city: "Linz",
      country: "AT",
    },
  },
];

type ApiClient = ShopwareClient & {
  makeAuthenticatedRequest: (url: string, init?: RequestInit) => Promise<Response>;
  baseUrl: string;
};

type CustomerDefaults = {
  countryId: string;
  salutationId: string;
  groupId: string;
  paymentMethodId: string;
  salesChannelId: string;
};

async function searchFirst(
  api: ApiClient,
  entity: string,
  body: Record<string, unknown> = { limit: 1 }
): Promise<{ id: string } | undefined> {
  const res = await api.makeAuthenticatedRequest(`${api.baseUrl}/api/search/${entity}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`search/${entity} failed: ${res.status} ${t}`);
  }
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  return data.data?.[0];
}

async function fetchCustomerDefaults(client: ShopwareClient, countryIso: string): Promise<CustomerDefaults> {
  const api = client as ApiClient;

  const country =
    (await searchFirst(api, "country", {
      limit: 1,
      filter: [{ type: "equals", field: "iso", value: countryIso.toUpperCase() }],
    })) ??
    (await searchFirst(api, "country", {
      limit: 1,
      filter: [{ type: "contains", field: "name", value: "Österreich" }],
    }));

  const salutation = await searchFirst(api, "salutation");
  const group = await searchFirst(api, "customer-group");
  const payment = await searchFirst(api, "payment-method");
  const salesChannel = await searchFirst(api, "sales-channel");

  if (!country?.id || !salutation?.id || !group?.id || !payment?.id || !salesChannel?.id) {
    throw new Error("Shopware-Defaults für Kunden (country/salutation/group/payment/sales-channel) nicht gefunden");
  }

  return {
    countryId: country.id,
    salutationId: salutation.id,
    groupId: group.id,
    paymentMethodId: payment.id,
    salesChannelId: salesChannel.id,
  };
}

async function findCustomerByEmail(client: ShopwareClient, email: string): Promise<{ id: string } | null> {
  const api = client as ApiClient;
  const res = await api.makeAuthenticatedRequest(`${api.baseUrl}/api/search/customer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      limit: 1,
      filter: [{ type: "equals", field: "email", value: email.toLowerCase() }],
    }),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { data?: Array<{ id: string }> };
  const row = data.data?.[0];
  return row ? { id: row.id } : null;
}

async function upsertDemoCustomer(
  client: ShopwareClient,
  spec: DemoShopwareCustomer,
  defaults: CustomerDefaults,
  dryRun: boolean
): Promise<"created" | "updated" | "skipped"> {
  const existing = await findCustomerByEmail(client, spec.email);
  if (existing) {
    console.log(`  ✓ ${spec.email} bereits vorhanden (${existing.id})`);
    return "skipped";
  }

  const customerId = spec.id ?? randomUUID().replace(/-/g, "");
  const billingAddressId = randomUUID().replace(/-/g, "");

  const payload = {
    id: customerId,
    email: spec.email,
    firstName: spec.firstName,
    lastName: spec.lastName,
    company: spec.company,
    customerNumber: spec.customerNumber,
    salutationId: defaults.salutationId,
    groupId: defaults.groupId,
    defaultPaymentMethodId: defaults.paymentMethodId,
    salesChannelId: defaults.salesChannelId,
    defaultBillingAddressId: billingAddressId,
    defaultBillingAddress: {
      id: billingAddressId,
      customerId,
      firstName: spec.firstName,
      lastName: spec.lastName,
      company: spec.billingAddress.company ?? spec.company,
      street: spec.billingAddress.street,
      zipcode: spec.billingAddress.zipCode,
      city: spec.billingAddress.city,
      countryId: defaults.countryId,
      salutationId: defaults.salutationId,
      phoneNumber: spec.phone,
    },
  };

  if (dryRun) {
    console.log(`  [dry-run] würde anlegen: ${spec.company} <${spec.email}>`);
    return "created";
  }

  const api = client as ApiClient;
  const res = await api.makeAuthenticatedRequest(`${api.baseUrl}/api/_action/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "write-demo-customer": {
        entity: "customer",
        action: "upsert",
        payload: [payload],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Kunde ${spec.email} fehlgeschlagen: ${res.status} ${errText}`);
  }

  console.log(`  ✓ angelegt: ${spec.company} <${spec.email}> (${customerId})`);
  return "created";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const tenantId = process.env.TENANT_ID || DEV_TENANT_ID;

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings?.shopwareUrl || !settings.apiKey) {
    console.error(`Keine Shopware-Einstellungen für Tenant ${tenantId}`);
    process.exit(1);
  }

  console.log(`Tenant:   ${tenantId}`);
  console.log(`Shop:     ${settings.shopwareUrl}`);
  console.log(`Modus:    ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Kunden:   ${DEMO_SHOPWARE_CUSTOMERS.length}`);

  const client = new ShopwareClient(settings);
  const defaults = await fetchCustomerDefaults(client, "AT");
  const stats = { created: 0, updated: 0, skipped: 0 };

  for (const spec of DEMO_SHOPWARE_CUSTOMERS) {
    const result = await upsertDemoCustomer(client, spec, defaults, dryRun);
    stats[result === "skipped" ? "skipped" : result]++;
  }

  console.log(JSON.stringify({ ...stats, ok: true }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
