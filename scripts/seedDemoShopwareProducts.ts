/**
 * Legt Demo-Katalogartikel in Shopware an (für Präsentations-Mails).
 *
 * Usage (im App-Container oder lokal mit DATABASE_URL):
 *   TENANT_ID=c49bfa7e-06a8-452a-9d47-c490629aca4a npx tsx scripts/seedDemoShopwareProducts.ts
 *   TENANT_ID=... npx tsx scripts/seedDemoShopwareProducts.ts --dry-run
 *
 * Default-Tenant: „Dev“ (c49bfa7e-06a8-452a-9d47-c490629aca4a)
 */

import { randomUUID } from "crypto";
import { storage } from "../server/storage";
import { ShopwareClient } from "../server/shopware";
import { productCache } from "../server/productCache";

const DEV_TENANT_ID = "c49bfa7e-06a8-452a-9d47-c490629aca4a";

export type DemoCatalogProduct = {
  /** Feste UUID (32 hex) für idempotente Upserts — optional. */
  id?: string;
  productNumber: string;
  ean: string;
  name: string;
  grossPrice: number;
  stock?: number;
  width?: number;
  height?: number;
  length?: number;
};

/** GTINs aus demo-mails/ + Mail-02-Alternativen */
export const DEMO_CATALOG_PRODUCTS: DemoCatalogProduct[] = [
  {
    id: "45781bb15d6741989744f5a305ac33cd",
    productNumber: "4026212259957",
    ean: "4026212259957",
    name: "150 CLIP SET vzk GR 2000 x 1000 x 400 mit 4 Böden",
    grossPrice: 255.85,
    width: 1000,
    height: 2000,
    length: 400,
  },
  {
    id: "500980f0e34da1a9b14bc8b3b57e5130",
    productNumber: "4026212259964",
    ean: "4026212259964",
    name: "150 CLIP SET vzk AR 2000 x 1000 x 400 mit 4 Böden",
    grossPrice: 189.21,
    width: 1000,
    height: 2000,
    length: 400,
  },
  {
    id: "71731bb6903e885161989466a8d40d49",
    productNumber: "4026212264814",
    ean: "4026212264814",
    name: "Zusatzboden für CLIP Regal | MS150 III | 1000 x 400 x 40 mm | verzinkt | inkl. 4 Fachbodenträger",
    grossPrice: 32.13,
    width: 1000,
    length: 400,
    height: 40,
  },
  {
    id: "caf5a4bee12299e46329eb21ae8ddf58",
    productNumber: "4026212011036",
    ean: "4026212011036",
    name: "META CLIP | Anbauregal | 2000 x 1300 x 400 | 230 kg | mit 4 Böden | verzinkt",
    grossPrice: 282.03,
    width: 1300,
    height: 2000,
    length: 400,
  },
  {
    id: "adfcf6bf5e2b618235234ac0f84e9961",
    productNumber: "4026212102192",
    ean: "4026212102192",
    name: "META CLIP | Anbauregal | doppelseitig | 2000 x 1300 x 400 | 230 kg | mit 8 Böden | verzinkt",
    grossPrice: 459.0,
    width: 1300,
    height: 2000,
    length: 400,
  },
];

type ShopwareDefaults = {
  taxId: string;
  taxRate: number;
  currencyId: string;
  salesChannelId: string;
};

async function fetchShopwareDefaults(client: ShopwareClient): Promise<ShopwareDefaults> {
  const api = client as ShopwareClient & {
    makeAuthenticatedRequest: (url: string, init?: RequestInit) => Promise<Response>;
    baseUrl: string;
  };

  async function searchFirst<T extends Record<string, unknown>>(
    entity: string,
    body: Record<string, unknown> = { limit: 1 }
  ): Promise<T | undefined> {
    const res = await api.makeAuthenticatedRequest(`${api.baseUrl}/api/search/${entity}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`search/${entity} failed: ${res.status} ${t}`);
    }
    const data = (await res.json()) as { data?: Array<{ id: string; attributes?: Record<string, unknown> }> };
    const row = data.data?.[0];
    if (!row) return undefined;
    return { id: row.id, ...(row.attributes ?? {}) } as T;
  }

  const tax = await searchFirst<{ id: string; taxRate?: number }>("tax", {
    limit: 1,
    filter: [{ type: "equals", field: "taxRate", value: 20 }],
  });
  const taxFallback = tax ?? (await searchFirst<{ id: string; taxRate?: number }>("tax"));
  const currency =
    (await searchFirst<{ id: string }>("currency", {
      limit: 1,
      filter: [{ type: "equals", field: "isoCode", value: "EUR" }],
    })) ?? (await searchFirst<{ id: string }>("currency"));
  const salesChannel = await searchFirst<{ id: string }>("sales-channel", { limit: 1 });

  if (!taxFallback?.id || !currency?.id || !salesChannel?.id) {
    throw new Error("Shopware-Defaults (tax/currency/sales-channel) nicht gefunden");
  }

  return {
    taxId: taxFallback.id,
    taxRate: typeof taxFallback.taxRate === "number" ? taxFallback.taxRate : 20,
    currencyId: currency.id,
    salesChannelId: salesChannel.id,
  };
}

function grossToNet(gross: number, taxRate: number): number {
  return Math.round((gross / (1 + taxRate / 100)) * 100) / 100;
}

async function upsertDemoProduct(
  client: ShopwareClient,
  spec: DemoCatalogProduct,
  defaults: ShopwareDefaults,
  dryRun: boolean
): Promise<"created" | "updated" | "skipped"> {
  const existing = (
    await client.searchProductsByIdentifiersIncludeInactive([spec.productNumber, spec.ean])
  ).find((p) => p.productNumber === spec.productNumber || p.ean === spec.ean);

  if (existing && existing.active !== false) {
    console.log(`  ✓ ${spec.productNumber} bereits vorhanden (${existing.id})`);
    return "skipped";
  }

  const productId = existing?.id ?? spec.id ?? randomUUID().replace(/-/g, "");
  const net = grossToNet(spec.grossPrice, defaults.taxRate);
  const payload: Record<string, unknown> = {
    id: productId,
    name: spec.name,
    productNumber: spec.productNumber,
    ean: spec.ean,
    stock: spec.stock ?? 500,
    active: true,
    taxId: defaults.taxId,
    price: [
      {
        currencyId: defaults.currencyId,
        gross: spec.grossPrice,
        net,
        linked: true,
      },
    ],
    visibilities: [
      {
        salesChannelId: defaults.salesChannelId,
        visibility: 30,
      },
    ],
  };
  if (spec.width != null) payload.width = spec.width;
  if (spec.height != null) payload.height = spec.height;
  if (spec.length != null) payload.length = spec.length;

  if (dryRun) {
    console.log(`  [dry-run] würde upsert: ${spec.productNumber} → ${productId}`);
    return existing ? "updated" : "created";
  }

  const api = client as ShopwareClient & {
    makeAuthenticatedRequest: (url: string, init?: RequestInit) => Promise<Response>;
    baseUrl: string;
  };

  const res = await api.makeAuthenticatedRequest(`${api.baseUrl}/api/_action/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "write-demo-product": {
        entity: "product",
        action: "upsert",
        payload: [payload],
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Upsert ${spec.productNumber} failed: ${res.status} ${errText}`);
  }

  console.log(`  ✓ ${existing ? "aktualisiert" : "angelegt"}: ${spec.productNumber} (${productId})`);
  return existing ? "updated" : "created";
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const tenantId = process.env.TENANT_ID || process.argv.find((a) => !a.startsWith("-") && a.includes("-")) || DEV_TENANT_ID;

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings?.shopwareUrl || !settings.apiKey) {
    console.error(`Keine Shopware-Einstellungen für Tenant ${tenantId}`);
    process.exit(1);
  }

  console.log(`Tenant: ${tenantId}`);
  console.log(`Shop:   ${settings.shopwareUrl}`);
  console.log(`Modus:  ${dryRun ? "dry-run" : "apply"}`);
  console.log(`Artikel: ${DEMO_CATALOG_PRODUCTS.length}`);

  const client = new ShopwareClient(settings);
  const defaults = await fetchShopwareDefaults(client);
  console.log(`Defaults: tax=${defaults.taxRate}% currency=${defaults.currencyId.slice(0, 8)}… channel=${defaults.salesChannelId.slice(0, 8)}…`);

  const stats = { created: 0, updated: 0, skipped: 0 };
  for (const spec of DEMO_CATALOG_PRODUCTS) {
    const result = await upsertDemoProduct(client, spec, defaults, dryRun);
    stats[result === "skipped" ? "skipped" : result]++;
  }

  if (!dryRun) {
    try {
      await productCache.refresh(client);
      console.log(`Product-Cache aktualisiert (${productCache.getStatus().productCount} Produkte)`);
    } catch (e) {
      console.warn("Product-Cache Refresh fehlgeschlagen (App-Neustart übernimmt):", e);
    }
  }

  console.log(JSON.stringify({ ...stats, ok: true }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
