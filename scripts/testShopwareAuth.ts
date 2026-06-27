import pg from "pg";
import { decrypt } from "../server/encryption";

const { Client } = pg;

async function testTenant(tenantName: string) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query(
      "select t.name, s.value from settings s join tenants t on t.id = s.tenant_id where s.key = 'shopware' and t.name = $1",
      [tenantName]
    );
    if (!rows.length) {
      console.log(`${tenantName}: no settings found`);
      return;
    }

    const value = rows[0].value as {
      shopwareUrl?: string;
      apiKey?: string;
      apiSecret?: string;
    };

    const shopwareUrl = value.shopwareUrl?.trim().replace(/\/$/, "");
    if (!shopwareUrl || !value.apiKey || !value.apiSecret) {
      console.log(`${tenantName}: missing URL or credentials`);
      return;
    }

    const apiKey = decrypt(value.apiKey);
    const apiSecret = decrypt(value.apiSecret);

    const response = await fetch(`${shopwareUrl}/api/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: apiKey,
        client_secret: apiSecret,
      }),
    });

    const bodyText = await response.text();
    console.log(`${tenantName} token status: ${response.status}`);
    if (!response.ok) {
      console.log(bodyText.slice(0, 500));
    }
  } catch (error) {
    console.error(`${tenantName} token test failed:`, error);
  } finally {
    await client.end();
  }
}

const tenants = process.argv.slice(2);
if (tenants.length === 0) {
  console.log("Usage: testShopwareAuth <TenantName> [TenantName...]");
  process.exit(1);
}

for (const tenant of tenants) {
  // Run sequentially to keep output readable.
  // eslint-disable-next-line no-await-in-loop
  await testTenant(tenant);
}
