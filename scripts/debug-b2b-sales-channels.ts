/**
 * Diagnose B2B company sales-channel filtering.
 * DATABASE_URL=postgresql://metaorder:metaorder@127.0.0.1:5433/metaorder \
 * ENCRYPTION_KEY=metaorder-dev-encryption-key-change-in-prod \
 * npx tsx scripts/debug-b2b-sales-channels.ts
 */
import { DbStorage } from "../server/dbStorage";
import { createB2BAdminClient } from "../server/b2bSellersAdmin";
import { ShopwareClient } from "../server/shopware";

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

async function main() {
  const storage = new DbStorage();
  const tenantId = process.env.TENANT_ID || "13e1a563-e54f-4a41-9550-69be94f312bf";
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    console.error("No Shopware settings");
    process.exit(1);
  }

  const client = await createB2BAdminClient(settings);
  const shopware = new ShopwareClient(settings);
  const entityName = client.getEntityMapping().company;

  console.log("Shopware URL:", settings.shopwareUrl);
  console.log("Company entity:", entityName);

  const all = await client.fetchCompanies({ limit: 100 });
  console.log("\n=== All companies (no filter):", all.total, "===");
  for (const c of all.companies) {
    console.log(`- ${c.company} | channelId=${c.salesChannelId ?? "null"} | name=${c.salesChannelName ?? "null"}`);
  }

  const channelsRes = await client.makeAuthenticatedRequest(
    `${settings.shopwareUrl.replace(/\/$/, "")}/api/search/sales-channel`,
    { method: "POST", body: JSON.stringify({ limit: 50 }) },
  );
  const channelsPayload = await channelsRes.json();
  const channels = (channelsPayload.data || []).map((row: any) => unwrapEntity(row));

  console.log("\n=== fetchCompanies filter per channel ===");
  for (const ch of channels) {
    const filtered = await client.fetchCompanies({ limit: 100, salesChannelIds: [ch.id] });
    console.log(`- ${ch.name}: ${filtered.total}`);
  }

  console.log("\n=== Business customers per channel (direct customer search) ===");
  for (const ch of channels) {
    const res = await client.makeAuthenticatedRequest(`${settings.shopwareUrl.replace(/\/$/, "")}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1,
        totalCountMode: 1,
        filter: [
          { type: "equals", field: "accountType", value: "business" },
          {
            type: "multi",
            operator: "or",
            queries: [
              { type: "equals", field: "salesChannelId", value: ch.id },
              { type: "equals", field: "boundSalesChannelId", value: ch.id },
            ],
          },
        ],
      }),
    });
    const payload = await res.json();
    console.log(`- ${ch.name}: ${payload.total ?? 0} business customers`);
  }

  console.log("\n=== Orders per channel (sample totals) ===");
  for (const ch of channels) {
    const orders = await shopware.fetchOrdersPaginated(1, 0, [ch.id]);
    console.log(`- ${ch.name}: ${orders.total} orders`);
  }

  console.log("\n=== Raw offer-customer sample ===");
  const rawRes = await client.makeAuthenticatedRequest(
    `${settings.shopwareUrl.replace(/\/$/, "")}/api/search/${entityName}`,
    {
      method: "POST",
      body: JSON.stringify({
        limit: 10,
        associations: { customer: { associations: { salesChannel: {} } } },
      }),
    },
  );
  const rawPayload = await rawRes.json();
  for (const row of rawPayload.data || []) {
    const u = unwrapEntity(row);
    console.log({
      company: getField(u, "company") || getField(u, "customer.company"),
      customerId: getField(u, "customerId"),
      customerSalesChannelId: getField(u, "customer.salesChannelId"),
      customerBoundSalesChannelId: getField(u, "customer.boundSalesChannelId"),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
