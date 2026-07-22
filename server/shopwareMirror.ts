/**
 * Persistenter Shopware-Spiegel + Delta-Sync.
 *
 * Pro Mandant: Fingerprint-Short-Circuit, dann nur updatedAt >= cursor nachladen.
 * B2B-Firmen und Kundenpreise: Snapshot-Replace bei Fingerprint-Aenderung.
 */
import type { IStorage } from "./storage";
import type { ShopwareClient, ShopwareProductOverview, ShopwareCustomerPrice } from "./shopware";
import { B2BSellersAdminClient, type B2BCompanyListItem } from "./b2bSellersAdmin";
import { productCacheRegistry } from "./productCache";
import type { Product } from "@shared/schema";

const PRODUCT_BATCH = 500;
const CUSTOMER_BATCH = 250;
const PRICE_BATCH = 250;

function parseSwDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function overviewToProduct(p: ShopwareProductOverview): Product {
  return {
    id: p.id,
    productNumber: p.productNumber,
    name: p.name,
    price: p.priceGross,
    netPrice: p.priceNet,
    currency: p.currency || "EUR",
    taxRate: p.taxRate,
    stock: p.stock ?? 0,
    available: (p.stock ?? 0) > 0,
    active: p.active ?? undefined,
    childCount: p.childCount ?? undefined,
    parentId: p.parentId,
    manufacturerName: p.manufacturerName,
    manufacturerNumber: p.manufacturerNumber,
    categoryNames: p.categories,
    ean: p.ean,
    customFields: p.customFields as Record<string, any> | undefined,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function mirrorPayloadToOverview(payload: unknown): ShopwareProductOverview | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as ShopwareProductOverview;
  if (!p.id || !p.productNumber) return null;
  return p;
}

export function mirrorRowsToProducts(
  rows: Array<{ payload: unknown; active?: boolean | null }>,
): Product[] {
  const out: Product[] = [];
  for (const row of rows) {
    const overview = mirrorPayloadToOverview(row.payload);
    if (!overview) continue;
    if (row.active === false) continue;
    out.push(overviewToProduct(overview));
  }
  return out;
}

async function syncProductsDelta(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  await storage.upsertShopwareSyncState("products", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("products", tenantId);
    const fingerprint = await client.fetchActiveProductCatalogFingerprint();

    if (
      !opts?.force &&
      fingerprint &&
      state?.lastFingerprint === fingerprint &&
      (await storage.countShopwareProductMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "products",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: fingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    // Cursor: bei Fingerprint-Match-Fail trotzdem Delta ab last cursor (inkl. gleiche updatedAt)
    const cursor = state?.cursorUpdatedAt ?? null;
    let page = 1;
    let upserted = 0;
    let maxUpdated: Date | null = cursor;
    let sourceTotal: number | null = null;

    while (true) {
      const { products, total } = await client.fetchProductsChangedSince(cursor, PRODUCT_BATCH, page, {
        includeInactive: true,
      });
      sourceTotal = total;
      if (products.length === 0) break;

      await storage.upsertShopwareProductMirrors(
        products.map((p) => ({
          shopwareId: p.id,
          productNumber: p.productNumber,
          manufacturerNumber: p.manufacturerNumber ?? null,
          ean: p.ean ?? null,
          name: p.name ?? null,
          active: p.active,
          swUpdatedAt: parseSwDate(p.updatedAt),
          payload: p as unknown as Record<string, unknown>,
        })),
        tenantId,
      );
      upserted += products.length;

      for (const p of products) {
        const d = parseSwDate(p.updatedAt);
        if (d && (!maxUpdated || d > maxUpdated)) maxUpdated = d;
      }

      if (products.length < PRODUCT_BATCH) break;
      page += 1;
    }

    // Deletion reconcile when totals diverge or schedule elapsed
    const reconcileMinutes = Number(process.env.SHOPWARE_SYNC_RECONCILE_MINUTES || 60);
    const reconcileMs = reconcileMinutes * 60 * 1000;
    const lastReconcile = state?.lastReconcileAt
      ? new Date(state.lastReconcileAt).getTime()
      : 0;
    const mirrorCount = await storage.countShopwareProductMirrors(tenantId);
    const needsReconcile =
      (sourceTotal != null && sourceTotal !== mirrorCount) ||
      !lastReconcile ||
      Date.now() - lastReconcile >= reconcileMs;

    if (needsReconcile) {
      const { ids } = await client.fetchAllProductIds({ includeInactive: true });
      const deleted = await storage.deleteShopwareProductMirrorsNotIn(ids, tenantId);
      if (deleted > 0) {
        console.log(`[ShopwareMirror] products: reconciled ${deleted} deletions (tenant=${tenantId})`);
      }
      await storage.upsertShopwareSyncState(
        "products",
        { lastReconcileAt: new Date(), lastTotal: ids.length },
        tenantId,
      );
    }

    // Refresh in-memory product cache from mirror (active only)
    const { rows } = await storage.getShopwareProductMirrors({ activeOnly: true }, tenantId);
    const cache = productCacheRegistry.for(tenantId);
    cache.hydrateFromMirror(mirrorRowsToProducts(rows), fingerprint);

    await storage.upsertShopwareSyncState(
      "products",
      {
        status: "idle",
        cursorUpdatedAt: maxUpdated,
        lastFingerprint: fingerprint,
        lastDeltaAt: new Date(),
        lastTotal: await storage.countShopwareProductMirrors(tenantId),
        error: null,
      },
      tenantId,
    );

    console.log(
      `[ShopwareMirror] products: upserted=${upserted} skipped=false tenant=${tenantId ?? "default"}`,
    );
    return { upserted, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "products",
      { status: "error", error: error?.message || String(error) },
      tenantId,
    );
    throw error;
  }
}

async function syncCustomersDelta(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  await storage.upsertShopwareSyncState("customers", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("customers", tenantId);
    const fpRaw = await client.fetchEntitySearchFingerprint("customer", { sortField: "updatedAt" });
    const { stableFingerprint } = await import("./contentHashCache");
    const fingerprint = fpRaw
      ? stableFingerprint({
          scope: "customers",
          total: fpRaw.total,
          latestUpdatedAt: fpRaw.latestUpdatedAt,
          latestId: fpRaw.latestId,
        })
      : null;

    if (
      !opts?.force &&
      fingerprint &&
      state?.lastFingerprint === fingerprint &&
      (await storage.countShopwareCustomerMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "customers",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: fingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    const cursor = state?.cursorUpdatedAt ?? null;
    let page = 1;
    let upserted = 0;
    let maxUpdated: Date | null = cursor;
    let sourceTotal: number | null = null;

    while (true) {
      const { customers, total } = await client.fetchCustomersChangedSince(
        cursor,
        CUSTOMER_BATCH,
        page,
      );
      sourceTotal = total;
      if (customers.length === 0) break;

      await storage.upsertShopwareCustomerMirrors(
        customers.map((c) => ({
          shopwareId: c.id,
          customerNumber: c.customerNumber,
          email: c.email,
          company: c.company,
          groupId: c.groupId,
          groupName: c.groupName,
          salesChannelId: c.salesChannelId,
          swUpdatedAt: parseSwDate(c.updatedAt),
          payload: c as unknown as Record<string, unknown>,
        })),
        tenantId,
      );
      upserted += customers.length;

      for (const c of customers) {
        const d = parseSwDate(c.updatedAt);
        if (d && (!maxUpdated || d > maxUpdated)) maxUpdated = d;
      }

      if (customers.length < CUSTOMER_BATCH) break;
      page += 1;
    }

    const reconcileMinutes = Number(process.env.SHOPWARE_SYNC_RECONCILE_MINUTES || 60);
    const reconcileMs = reconcileMinutes * 60 * 1000;
    const lastReconcile = state?.lastReconcileAt
      ? new Date(state.lastReconcileAt).getTime()
      : 0;
    const mirrorCount = await storage.countShopwareCustomerMirrors(tenantId);
    const needsReconcile =
      (sourceTotal != null && sourceTotal !== mirrorCount) ||
      !lastReconcile ||
      Date.now() - lastReconcile >= reconcileMs;

    if (needsReconcile) {
      const { ids } = await client.fetchAllCustomerIds();
      const deleted = await storage.deleteShopwareCustomerMirrorsNotIn(ids, tenantId);
      if (deleted > 0) {
        console.log(`[ShopwareMirror] customers: reconciled ${deleted} deletions (tenant=${tenantId})`);
      }
      await storage.upsertShopwareSyncState(
        "customers",
        { lastReconcileAt: new Date(), lastTotal: ids.length },
        tenantId,
      );
    }

    await storage.upsertShopwareSyncState(
      "customers",
      {
        status: "idle",
        cursorUpdatedAt: maxUpdated,
        lastFingerprint: fingerprint,
        lastDeltaAt: new Date(),
        lastTotal: await storage.countShopwareCustomerMirrors(tenantId),
        error: null,
      },
      tenantId,
    );

    console.log(
      `[ShopwareMirror] customers: upserted=${upserted} skipped=false tenant=${tenantId ?? "default"}`,
    );
    return { upserted, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "customers",
      { status: "error", error: error?.message || String(error) },
      tenantId,
    );
    throw error;
  }
}

async function syncB2bCompaniesSnapshot(
  storage: IStorage,
  settings: import("@shared/schema").ShopwareSettings,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  await storage.upsertShopwareSyncState("b2b_companies", { status: "running", error: null }, tenantId);
  try {
    const admin = new B2BSellersAdminClient(settings);
    const state = await storage.getShopwareSyncState("b2b_companies", tenantId);
    const fingerprint = await admin.fetchCompaniesSnapshotFingerprint();

    if (
      !opts?.force &&
      fingerprint &&
      state?.lastFingerprint === fingerprint &&
      (await storage.countShopwareB2bCompanyMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "b2b_companies",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: fingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    const companies: B2BCompanyListItem[] = await admin.loadCompaniesSnapshot();
    await storage.replaceShopwareB2bCompanyMirrors(
      companies.map((c) => ({
        companyId: c.id,
        customerId: c.customerId,
        company: c.company,
        email: c.email,
        customerNumber: c.customerNumber,
        active: c.active,
        salesChannelId: c.salesChannelId,
        swUpdatedAt: parseSwDate(c.createdAt),
        payload: c as unknown as Record<string, unknown>,
      })),
      tenantId,
    );

    await storage.upsertShopwareSyncState(
      "b2b_companies",
      {
        status: "idle",
        lastFingerprint: fingerprint,
        lastDeltaAt: new Date(),
        lastReconcileAt: new Date(),
        lastTotal: companies.length,
        error: null,
      },
      tenantId,
    );

    console.log(
      `[ShopwareMirror] b2b_companies: upserted=${companies.length} tenant=${tenantId ?? "default"}`,
    );
    return { upserted: companies.length, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "b2b_companies",
      { status: "error", error: error?.message || String(error) },
      tenantId,
    );
    // B2B plugin optional — don't fail whole sync hard for missing plugin
    console.warn(`[ShopwareMirror] b2b_companies sync failed:`, error?.message || error);
    return { upserted: 0, skipped: false };
  }
}

async function syncCustomerPrices(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  await storage.upsertShopwareSyncState("customer_prices", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("customer_prices", tenantId);
    const fingerprint = await client.fetchIndividualPriceCustomerFingerprint();

    if (
      !opts?.force &&
      fingerprint &&
      state?.lastFingerprint === fingerprint &&
      (await storage.countShopwareCustomerPriceMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "customer_prices",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: fingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    // Voll-Snapshot paginiert (updatedAt-Filter ist auf Plugin-Entitaeten unzuverlaessig)
    const allPrices: ShopwareCustomerPrice[] = [];
    let page = 1;
    let entity: string | null = null;
    while (true) {
      const result = await client.fetchCustomerPricesChangedSince(null, PRICE_BATCH, page);
      if (!result.available) break;
      entity = result.entity;
      allPrices.push(...result.prices);
      if (result.prices.length < PRICE_BATCH) break;
      // If total known and we've fetched all, stop
      if (result.total > 0 && allPrices.length >= result.total) break;
      page += 1;
      // Safety cap: 250 × 4000 = bis zu 1.000.000 Preiszeilen im Voll-Snapshot.
      if (page > 4000) break;
    }

    await storage.replaceShopwareCustomerPriceMirrors(
      allPrices.map((p) => ({
        priceId: p.id,
        customerId: p.customerId,
        productId: p.productId,
        productNumber: p.productNumber,
        customerNumber: p.customerNumber,
        swUpdatedAt: null,
        payload: p as unknown as Record<string, unknown>,
      })),
      tenantId,
    );

    await storage.upsertShopwareSyncState(
      "customer_prices",
      {
        status: "idle",
        lastFingerprint: fingerprint,
        lastDeltaAt: new Date(),
        lastReconcileAt: new Date(),
        lastTotal: allPrices.length,
        error: null,
      },
      tenantId,
    );

    console.log(
      `[ShopwareMirror] customer_prices: upserted=${allPrices.length} entity=${entity} tenant=${tenantId ?? "default"}`,
    );
    return { upserted: allPrices.length, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "customer_prices",
      { status: "error", error: error?.message || String(error) },
      tenantId,
    );
    console.warn(`[ShopwareMirror] customer_prices sync failed:`, error?.message || error);
    return { upserted: 0, skipped: false };
  }
}

const syncInFlight = new Map<string, Promise<void>>();

/** Sync fuer einen Mandanten (Produkte, Kunden, B2B, Preise). */
export async function syncShopwareMirrorForTenant(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: {
    force?: boolean;
    entities?: Array<"products" | "customers" | "b2b_companies" | "customer_prices">;
    settings?: import("@shared/schema").ShopwareSettings;
  },
): Promise<void> {
  const key = tenantId ?? "__global__";
  const existing = syncInFlight.get(key);
  if (existing) {
    await existing;
    return;
  }

  const run = (async () => {
    const entities = opts?.entities ?? ["products", "customers", "b2b_companies", "customer_prices"];
    if (entities.includes("products")) {
      await syncProductsDelta(storage, client, tenantId, opts);
    }
    if (entities.includes("customers")) {
      await syncCustomersDelta(storage, client, tenantId, opts);
    }
    if (entities.includes("b2b_companies")) {
      const settings = opts?.settings ?? (await storage.getShopwareSettings(tenantId));
      if (settings) {
        await syncB2bCompaniesSnapshot(storage, settings, tenantId, opts);
      }
    }
    if (entities.includes("customer_prices")) {
      await syncCustomerPrices(storage, client, tenantId, opts);
    }
  })();

  syncInFlight.set(key, run);
  try {
    await run;
  } finally {
    syncInFlight.delete(key);
  }
}

/** Hintergrund-Job: alle Mandanten mit Shopware-Settings syncen. */
export async function runShopwareMirrorSync(storage: IStorage): Promise<void> {
  if (process.env.SHOPWARE_SYNC_ENABLED === "false") {
    return;
  }

  const { ShopwareClient } = await import("./shopware");
  const tenants = await storage.getAllTenants();
  const tenantIds: Array<string | null> = tenants.length > 0 ? tenants.map((t) => t.id) : [null];

  for (const tenantId of tenantIds) {
    try {
      const settings = await storage.getShopwareSettings(tenantId);
      if (!settings) continue;
      const client = new ShopwareClient(settings);
      await syncShopwareMirrorForTenant(storage, client, tenantId, { settings });
    } catch (error) {
      console.error(`[ShopwareMirror] Sync failed for tenant ${tenantId}:`, error);
    }
  }
}

/** Fire-and-forget Sync anstossen (z. B. Cold-Start-Fallback). */
export function triggerShopwareMirrorSync(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  entities?: Array<"products" | "customers" | "b2b_companies" | "customer_prices">,
): void {
  void syncShopwareMirrorForTenant(storage, client, tenantId, { entities }).catch((error) => {
    console.error(`[ShopwareMirror] Background trigger failed (tenant=${tenantId}):`, error);
  });
}
