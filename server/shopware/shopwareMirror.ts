/**
 * Persistenter Shopware-Spiegel + Delta-Sync.
 *
 * Pro Mandant: Fingerprint-Short-Circuit, dann nur updatedAt >= cursor nachladen.
 * B2B-Firmen und Kundenpreise: Snapshot-Replace bei Fingerprint-Aenderung.
 */
import type { IStorage } from "../storage";
import type { ShopwareClient, ShopwareProductOverview, ShopwareCustomerPrice } from "./shopware";
import { B2BSellersAdminClient, type B2BCompanyListItem } from "../b2b/b2bSellersAdmin";
import { productCacheRegistry } from "../products/productCache";
import type { Product, Order } from "@shared/schema";
import { detectOrderChanges, emitOrderChanges } from "./orderChangeEvents";
import { logger } from "../lib/logger";
import { isShopwareAuthPaused } from "./shopwareTokenCache";

const PRODUCT_BATCH = 500;
/**
 * Version des Produkt-Spiegel-Payloads. Wird beim Fingerprint mitgespeichert;
 * aendert sich die Version (neue Payload-Felder, z. B. salesChannelVisibilities),
 * laeuft einmalig ein Voll-Resync statt eines Cursor-Deltas.
 */
const PRODUCT_PAYLOAD_VERSION = "v2";
/**
 * Version des Bestell-Spiegel-Payloads, Mechanik wie bei den Produkten.
 * v2: Versandangaben (shippingInfo: Sendungsnummer, Versanddatum) aus den Lieferungen.
 * v3: auch Bestellungen mit mehrfach vergebener Bestellnummer - beim Neuladen fuer v2 blieben
 *     diese Kopien auf altem Stand (Live: 36 Zeilen).
 * v4: Sendungsnummern als Liste mit Links zur Sendungsverfolgung (Tracking-URL der Versandart),
 *     Versanddienstleister ersatzweise aus der Versandart.
 */
const ORDER_PAYLOAD_VERSION = "v4";
const CUSTOMER_BATCH = 250;
const PRICE_BATCH = 250;
/** Sicherheitsnetz: 250 × 400 = bis zu 100.000 Preiszeilen im Voll-Snapshot. */
const PRICE_MAX_PAGES = 400;

type MirrorEntity = "products" | "orders" | "customers" | "b2b_companies" | "customer_prices";

/**
 * Log je Mandant und Bereich: component/tenantId/entity als Felder (Texte bleiben wie bisher,
 * damit Suchen nach "[ShopwareMirror] orders: upserted=" weiter funktionieren).
 */
function mirrorLog(tenantId: string | null, entity?: MirrorEntity) {
  return logger.child({ component: "shopware-mirror", ...(tenantId ? { tenantId } : {}), ...(entity ? { entity } : {}) });
}

/** Fehlermeldung fuer den Text - wie bisher bei console.error("...:", err) */
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Je Mandant: Ende der zuletzt geloggten Anmelde-Pause (eine Zeile je Pause statt alle 3 Minuten) */
const loggedAuthPause = new Map<string, number>();

/** Fehler eines Abgleichs loggen; pausierte Anmeldung (abgelehnte Zugangsdaten) nur einmal je Pause */
export function logSyncFailure(tenantId: string | null, error: unknown, message: string): void {
  if (isShopwareAuthPaused(error)) {
    const key = tenantId ?? "";
    if (loggedAuthPause.get(key) === error.until) return;
    loggedAuthPause.set(key, error.until);
    mirrorLog(tenantId).warn(
      { reason: error.reason, pausedUntil: new Date(error.until).toISOString() },
      `[ShopwareMirror] Abgleich pausiert (tenant=${tenantId}): ${error.message}`,
    );
    return;
  }
  mirrorLog(tenantId).error({ err: error }, message);
}

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

export function mirrorPayloadToOverview(
  payload: unknown,
  lastPriceChangeAt?: Date | null,
): ShopwareProductOverview | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as ShopwareProductOverview;
  if (!p.id || !p.productNumber) return null;
  if (lastPriceChangeAt !== undefined) {
    return { ...p, lastPriceChangeAt: lastPriceChangeAt ? lastPriceChangeAt.toISOString() : null };
  }
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

/** Rekonstruiert Order[] aus dem Bestell-Spiegel (payload ist bereits das fertige Order-Objekt). */
export function mirrorRowsToOrders(rows: Array<{ payload: unknown }>): Order[] {
  const out: Order[] = [];
  for (const row of rows) {
    if (!row.payload || typeof row.payload !== "object") continue;
    const order = row.payload as Order;
    if (!order.id || !order.orderNumber) continue;
    out.push(order);
  }
  return out;
}

async function syncProductsDelta(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  const log = mirrorLog(tenantId, "products");
  const startedAt = Date.now();
  await storage.upsertShopwareSyncState("products", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("products", tenantId);
    const fingerprint = await client.fetchActiveProductCatalogFingerprint();
    const versionedFingerprint = fingerprint ? `${PRODUCT_PAYLOAD_VERSION}:${fingerprint}` : null;
    // Spiegel wurde mit einer aelteren Payload-Version geschrieben -> einmalig voll neu laden
    const payloadVersionStale = !String(state?.lastFingerprint ?? "").startsWith(
      `${PRODUCT_PAYLOAD_VERSION}:`,
    );

    if (
      !opts?.force &&
      !payloadVersionStale &&
      versionedFingerprint &&
      state?.lastFingerprint === versionedFingerprint &&
      (await storage.countShopwareProductMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "products",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: versionedFingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    // Cursor: bei Fingerprint-Match-Fail trotzdem Delta ab last cursor (inkl. gleiche updatedAt)
    // force / neue Payload-Version: voller Resync (z. B. neue Payload-Felder wie options)
    const cursor = opts?.force || payloadVersionStale ? null : state?.cursorUpdatedAt ?? null;
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

      const missingDtIds = products
        .filter((p) => p.deliveryTimeId && !p.deliveryTimeName)
        .map((p) => String(p.deliveryTimeId));
      let deliveryById = new Map<
        string,
        { name: string | null; min: number | null; max: number | null; unit: string | null }
      >();
      if (missingDtIds.length > 0) {
        try {
          deliveryById = await client.resolveDeliveryTimes(missingDtIds);
        } catch (err) {
          log.warn({ err, deliveryTimeIds: missingDtIds.length }, `[ShopwareMirror] delivery time resolve failed: ${errText(err)}`);
        }
      }

      const enrichedProducts = products.map((p) => {
        if (!p.deliveryTimeId || p.deliveryTimeName) return p;
        const resolved = deliveryById.get(
          String(p.deliveryTimeId).replace(/-/g, "").toLowerCase(),
        );
        if (!resolved) return p;
        return {
          ...p,
          deliveryTimeName: resolved.name ?? p.deliveryTimeName,
          deliveryTimeMin: resolved.min ?? p.deliveryTimeMin,
          deliveryTimeMax: resolved.max ?? p.deliveryTimeMax,
          deliveryTimeUnit: resolved.unit ?? p.deliveryTimeUnit,
          hasDeliveryTime: true,
        };
      });

      // Preisänderung erkennen: alten Mirror-Preis vs. neu ankommenden Preis vergleichen,
      // bevor der Mirror überschrieben wird. Nur Produkte mit bekanntem Vorzustand zählen
      // (sonst würde der Erstsync fälschlich als "Preisänderung" geloggt).
      const prevPrices = await storage.getShopwareProductPricesByShopwareIds(
        enrichedProducts.map((p) => p.id),
        tenantId,
      );
      const priceHistoryEntries: Array<{
        shopwareId: string;
        productNumber: string;
        oldPriceGross: number | null;
        newPriceGross: number;
        oldPriceNet: number | null;
        newPriceNet: number;
        changedAt: Date;
      }> = [];
      const lastPriceChangeById = new Map<string, Date | null>();
      for (const p of enrichedProducts) {
        const prev = prevPrices.get(p.id);
        if (!prev) {
          lastPriceChangeById.set(p.id, null);
          continue;
        }
        const priceChanged =
          prev.priceGross != null &&
          prev.priceNet != null &&
          (Math.abs(prev.priceGross - p.priceGross) > 0.0001 ||
            Math.abs(prev.priceNet - p.priceNet) > 0.0001);
        if (priceChanged) {
          const changedAt = parseSwDate(p.updatedAt) ?? new Date();
          priceHistoryEntries.push({
            shopwareId: p.id,
            productNumber: p.productNumber,
            oldPriceGross: prev.priceGross,
            newPriceGross: p.priceGross,
            oldPriceNet: prev.priceNet,
            newPriceNet: p.priceNet,
            changedAt,
          });
          lastPriceChangeById.set(p.id, changedAt);
        } else {
          lastPriceChangeById.set(p.id, prev.lastPriceChangeAt);
        }
      }

      await storage.upsertShopwareProductMirrors(
        enrichedProducts.map((p) => ({
          shopwareId: p.id,
          productNumber: p.productNumber,
          manufacturerNumber: p.manufacturerNumber ?? null,
          ean: p.ean ?? null,
          name: p.name ?? null,
          active: p.active,
          swUpdatedAt: parseSwDate(p.updatedAt),
          lastPriceChangeAt: lastPriceChangeById.get(p.id) ?? null,
          payload: p as unknown as Record<string, unknown>,
        })),
        tenantId,
      );
      upserted += enrichedProducts.length;

      if (priceHistoryEntries.length > 0) {
        await storage.insertProductPriceHistory(priceHistoryEntries, tenantId);
        log.info(
          { priceChanges: priceHistoryEntries.length },
          `[ShopwareMirror] products: ${priceHistoryEntries.length} Preisänderung(en) erfasst (tenant=${tenantId ?? "default"})`,
        );
      }

      for (const p of enrichedProducts) {
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
        log.info({ deleted }, `[ShopwareMirror] products: reconciled ${deleted} deletions (tenant=${tenantId})`);
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
        lastFingerprint: versionedFingerprint,
        lastDeltaAt: new Date(),
        lastTotal: await storage.countShopwareProductMirrors(tenantId),
        error: null,
      },
      tenantId,
    );

    log.info(
      { upserted, durationMs: Date.now() - startedAt },
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

/** Gemappte Bestellungen in den Spiegel schreiben. */
async function upsertOrderMirrors(storage: IStorage, orders: Order[], tenantId: string | null): Promise<void> {
  if (orders.length === 0) return;
  await storage.upsertShopwareOrderMirrors(
    orders.map((o) => ({
      shopwareId: o.id,
      orderNumber: o.orderNumber ?? null,
      salesChannelId: o.salesChannelId ?? null,
      swUpdatedAt: parseSwDate(o.updatedAt),
      payload: o as unknown as Record<string, unknown>,
    })),
    tenantId,
  );
}

/**
 * Je Schluessel nur der erste Eintrag (Reihenfolge von fetchOrders: Bestelldatum absteigend, dann
 * id); Eintraege ohne Schluessel bleiben alle.
 */
function firstPerKey<T>(items: T[], key: (item: T) => string | null): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (k === null) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Bestell-Spiegel: Delta-Sync statt "bei jedem Laden alle Bestellungen neu holen".
 * fetchOrders() paginiert intern selbst durch alle Treffer des Delta-Filters,
 * deshalb reicht hier ein einzelner Aufruf (anders als bei Produkten/Kunden, wo
 * der Aufrufer die Seiten selbst durchlaeuft).
 *
 * Delta-Filter: updatedAt >= Cursor ODER createdAt >= Cursor. Neue Bestellungen haben
 * in Shopware updatedAt = null (wird erst beim ersten Update gesetzt) — ein reiner
 * updatedAt-Filter hat sie uebersehen, solange niemand etwas an ihnen geaendert hat.
 *
 * Abgleich (geloeschte UND im Spiegel fehlende Bestellungen): periodisch, und sofort,
 * wenn die Anzahl im Spiegel nicht zur Anzahl im Shop passt — z. B. nach Wechsel der
 * Shop-URL eines Mandanten, wo der alte Cursor sonst alle aelteren Bestellungen des
 * neuen Shops dauerhaft ausblendet.
 *
 * Mehrfach vergebene Bestellnummern: Der Spiegel haelt jede Shopware-Bestellung aktuell
 * (keepDuplicateOrderNumbers). Aenderungen werden fuer jede Bestellung erkannt, je Lauf aber nur
 * einmal je Bestellnummer gemeldet (je Art bzw. je Rechnungsnummer) - keine doppelten
 * Rechnungen/E-Mails/Tickets fuer doppelt angelegte Bestellungen, die sich gemeinsam aendern.
 */
async function syncOrdersDelta(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  const log = mirrorLog(tenantId, "orders");
  const startedAt = Date.now();
  await storage.upsertShopwareSyncState("orders", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("orders", tenantId);
    const fpDetails = await client.fetchOrdersFingerprintDetails();
    const fingerprint = fpDetails?.fingerprint ? `${ORDER_PAYLOAD_VERSION}:${fpDetails.fingerprint}` : null;
    const shopTotal = fpDetails?.total ?? null;
    // Spiegel wurde mit einer aelteren Payload-Version geschrieben -> einmalig alle Bestellungen neu
    // laden (der gespeicherte Fingerprint ohne Versions-Praefix passt dann auch nie zum aktuellen)
    const payloadVersionStale = !String(state?.lastFingerprint ?? "").startsWith(`${ORDER_PAYLOAD_VERSION}:`);

    if (
      !opts?.force &&
      fingerprint &&
      state?.lastFingerprint === fingerprint &&
      (await storage.countShopwareOrderMirrors(tenantId)) > 0
    ) {
      await storage.upsertShopwareSyncState(
        "orders",
        { status: "idle", lastDeltaAt: new Date(), lastFingerprint: fingerprint },
        tenantId,
      );
      return { upserted: 0, skipped: true };
    }

    const previousCursor = parseSwDate(state?.cursorUpdatedAt);
    const cursor = opts?.force || payloadVersionStale ? null : previousCursor;
    const orders = await client.fetchOrders(null, { updatedSince: cursor, keepDuplicateOrderNumbers: true });

    // Vor dem Upsert: neue/geaenderte Rechnungsnummern gegen den alten Stand erkennen
    // (z. B. von SAP direkt in Shopware gesetzt). Verarbeitung erst nach dem Sync.
    // Lazy import wie bei ./shopware: der Watcher haengt an shopware.ts, das ueber
    // productCache wiederum dieses Modul laedt (Import-Zyklus vermeiden).
    const watcher =
      process.env.INVOICE_NUMBER_WATCHER_ENABLED === "false" || orders.length === 0
        ? null
        : await import("../invoicing/invoiceNumberWatcher");
    // Einmaliges Neuladen wegen neuer Payload-Version: der Watcher prueft nur, was der normale
    // Delta-Lauf geliefert haette (Rechnungsnummern stehen in der Bestellung und aendern deren
    // updatedAt) - keine Einzelabfrage je Bestellung, kein Versand fuer Altbestaende.
    const watchedOrders =
      payloadVersionStale && !opts?.force && previousCursor
        ? orders.filter((o) => {
            const changedAt = parseSwDate(o.updatedAt) ?? parseSwDate(o.createdAt);
            return changedAt !== null && changedAt >= previousCursor;
          })
        : orders;
    const invoiceNumberChanges = watcher
      ? firstPerKey(await watcher.detectInvoiceNumberChanges(storage, watchedOrders, tenantId), (c) =>
          c.order.orderNumber ? `${c.order.orderNumber}|${c.order.invoiceNumber ?? ""}` : null,
        )
      : [];

    // Aenderungserkennung (Automatisierung): bisherigen Stand VOR dem Upsert lesen,
    // Ereignisse erst NACH dem Upsert melden. Erstimport (leerer Spiegel) meldet nichts.
    const initialImport = (await storage.countShopwareOrderMirrors(tenantId)) === 0;
    const previousStates =
      initialImport || orders.length === 0
        ? new Map()
        : await storage.getShopwareOrderMirrorStates(orders.map((o) => o.id), tenantId);

    await upsertOrderMirrors(storage, orders, tenantId);

    const orderChanges = firstPerKey(detectOrderChanges(orders, previousStates, { initialImport }), (c) =>
      c.order.orderNumber ? `${c.kind}|${c.order.orderNumber}` : null,
    );
    if (orderChanges.length > 0) {
      emitOrderChanges(orderChanges, tenantId);
      const byKind = (kind: string) => orderChanges.filter((c) => c.kind === kind).length;
      log.info(
        { changes: orderChanges.length, created: byKind("created"), statusChanged: byKind("statusChanged"), paymentStatusChanged: byKind("paymentStatusChanged") },
        `[ShopwareMirror] orders: ${orderChanges.length} Aenderung(en) gemeldet (tenant=${tenantId ?? "default"})`,
      );
    }

    let maxUpdated: Date | null = cursor;
    for (const o of orders) {
      // Neue Bestellungen: updatedAt = null -> createdAt zaehlt fuer den Cursor.
      const d = parseSwDate(o.updatedAt) ?? parseSwDate(o.createdAt);
      if (d && (!maxUpdated || d > maxUpdated)) maxUpdated = d;
    }
    // Lieferungs-Aenderungen (Tracking-Codes, Lieferstatus) bis zum Fingerprint-Zeitpunkt sind im
    // Abruf enthalten (Fingerprint vor dem Abruf geholt) - sonst kaemen deren Bestellungen bei jedem
    // Lauf erneut, solange keine Bestellung juenger ist als die Lieferungs-Aenderung.
    const latestDeliveryChange = parseSwDate(fpDetails?.latestDeliveryUpdatedAt);
    if (latestDeliveryChange && (!maxUpdated || latestDeliveryChange > maxUpdated)) maxUpdated = latestDeliveryChange;

    // Loesch-/Fehl-Abgleich — periodisch (wie bei Produkten/Kunden), zusaetzlich sofort,
    // wenn Spiegel- und Shop-Anzahl auseinanderlaufen (Delta-Filter greift dann nicht).
    const reconcileMinutes = Number(process.env.SHOPWARE_SYNC_RECONCILE_MINUTES || 60);
    const reconcileMs = reconcileMinutes * 60 * 1000;
    const lastReconcile = state?.lastReconcileAt ? new Date(state.lastReconcileAt).getTime() : 0;
    const mirrorCount = await storage.countShopwareOrderMirrors(tenantId);
    // Abweichung Shop vs. Spiegel: nicht bei jedem Lauf erneut abgleichen (voller ID-Abruf),
    // sondern gedrosselt - z. B. wenn zwischen Zaehlung und Abgleich Bestellungen entstehen.
    const mismatchMinutes = Number(process.env.SHOPWARE_SYNC_MISMATCH_RECONCILE_MINUTES || 10);
    const countMismatch =
      shopTotal !== null &&
      shopTotal > 0 &&
      shopTotal !== mirrorCount &&
      Date.now() - lastReconcile >= mismatchMinutes * 60 * 1000;
    const needsReconcile = !lastReconcile || Date.now() - lastReconcile >= reconcileMs || countMismatch;

    let reconciledMissing = 0;
    if (needsReconcile) {
      const { ids } = await client.fetchAllOrderIds();
      const deleted = await storage.deleteShopwareOrderMirrorsNotIn(ids, tenantId);

      const known = new Set(await storage.listShopwareOrderMirrorIds(tenantId));
      const missing = ids.filter((id) => !known.has(id));
      // Bewusst ohne Rechnungsnummern-Watcher: diese Bestellungen sind dem Spiegel
      // unbekannt, ihre Rechnungsnummern sind keine "Aenderung", die Versand ausloesen darf.
      const MISSING_CHUNK = 500;
      for (let i = 0; i < missing.length; i += MISSING_CHUNK) {
        const chunkOrders = await client.fetchOrders(null, {
          ids: missing.slice(i, i + MISSING_CHUNK),
          keepDuplicateOrderNumbers: true,
        });
        await upsertOrderMirrors(storage, chunkOrders, tenantId);
        reconciledMissing += chunkOrders.length;
      }

      if (deleted > 0 || missing.length > 0) {
        log.info(
          { deleted, missing: missing.length, fetched: reconciledMissing, shopTotal, mirrorCount },
          `[ShopwareMirror] orders: reconciled deleted=${deleted} missing=${missing.length} fetched=${reconciledMissing}` +
            ` shopTotal=${shopTotal ?? "?"} mirror=${mirrorCount} (tenant=${tenantId ?? "default"})`,
        );
      }
      await storage.upsertShopwareSyncState(
        "orders",
        { lastReconcileAt: new Date(), lastTotal: ids.length },
        tenantId,
      );
    }

    await storage.upsertShopwareSyncState(
      "orders",
      {
        status: "idle",
        cursorUpdatedAt: maxUpdated,
        lastFingerprint: fingerprint,
        lastDeltaAt: new Date(),
        lastTotal: await storage.countShopwareOrderMirrors(tenantId),
        error: null,
      },
      tenantId,
    );

    const upserted = orders.length + reconciledMissing;
    log.info(
      { upserted, delta: orders.length, missing: reconciledMissing, durationMs: Date.now() - startedAt },
      `[ShopwareMirror] orders: upserted=${upserted} (delta=${orders.length}, missing=${reconciledMissing}) skipped=false tenant=${tenantId ?? "default"}`,
    );

    if (watcher && invoiceNumberChanges.length > 0) {
      const watcherLog = logger.child({ component: "invoice-watcher", ...(tenantId ? { tenantId } : {}) });
      try {
        const stats = await watcher.processInvoiceNumberChanges(storage, client, tenantId, invoiceNumberChanges);
        watcherLog.info(
          { changes: invoiceNumberChanges.length, ...stats },
          `[InvoiceWatcher] tenant=${tenantId ?? "default"} changes=${invoiceNumberChanges.length} created=${stats.created} sent=${stats.sent} skipped=${stats.skipped} failed=${stats.failed}`,
        );
      } catch (error) {
        // Fehler hier duerfen den Spiegel-Sync nicht als fehlgeschlagen markieren.
        watcherLog.error({ err: error }, `[InvoiceWatcher] Verarbeitung fehlgeschlagen (tenant=${tenantId}): ${errText(error)}`);
      }
    }

    return { upserted, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "orders",
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
  const log = mirrorLog(tenantId, "customers");
  const startedAt = Date.now();
  await storage.upsertShopwareSyncState("customers", { status: "running", error: null }, tenantId);
  try {
    const state = await storage.getShopwareSyncState("customers", tenantId);
    const fpRaw = await client.fetchEntitySearchFingerprint("customer", { sortField: "updatedAt" });
    const { stableFingerprint } = await import("../lib/contentHashCache");
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
        log.info({ deleted }, `[ShopwareMirror] customers: reconciled ${deleted} deletions (tenant=${tenantId})`);
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

    log.info(
      { upserted, durationMs: Date.now() - startedAt },
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
  const log = mirrorLog(tenantId, "b2b_companies");
  const startedAt = Date.now();
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

    log.info(
      { upserted: companies.length, durationMs: Date.now() - startedAt },
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
    // Bewusst ohne Stacktrace: fehlt das Plugin, kommt diese Meldung bei jedem Lauf
    log.warn({ error: error?.message || String(error) }, `[ShopwareMirror] b2b_companies sync failed: ${error?.message || error}`);
    return { upserted: 0, skipped: false };
  }
}

async function syncCustomerPrices(
  storage: IStorage,
  client: ShopwareClient,
  tenantId: string | null,
  opts?: { force?: boolean },
): Promise<{ upserted: number; skipped: boolean }> {
  const log = mirrorLog(tenantId, "customer_prices");
  const startedAt = Date.now();
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

    // Voll-Snapshot paginiert (updatedAt-Filter ist auf Plugin-Entitaeten unzuverlaessig).
    //
    // Zwei Eigenheiten der B2B-Preis-Entität, die hier abgefangen werden:
    //   1. `total` meldet die Seitengröße statt der Gesamtzahl (immer 250). Ein Abbruch über
    //      `allPrices.length >= result.total` beendet den Snapshot deshalb nach der ersten
    //      Seite — genau das hat den Mirror auf 250 von 12.999 Zeilen gedeckelt.
    //   2. Die Seiten überlappen, weil viele Zeilen denselben updatedAt teilen. Deduplizieren
    //      nach Preis-ID ist Pflicht, sonst landen Duplikate im Mirror.
    //
    // Abbruch daher über: Teilseite, oder eine Seite ohne neue IDs (schützt auch vor einem
    // Plugin, das den page-Parameter ignoriert).
    const byId = new Map<string, ShopwareCustomerPrice>();
    let page = 1;
    let entity: string | null = null;
    while (page <= PRICE_MAX_PAGES) {
      const result = await client.fetchCustomerPricesChangedSince(null, PRICE_BATCH, page);
      if (!result.available) break;
      entity = result.entity;

      let fresh = 0;
      for (const p of result.prices) {
        if (!p.id || byId.has(p.id)) continue;
        byId.set(p.id, p);
        fresh += 1;
      }

      if (result.prices.length < PRICE_BATCH) break;
      if (fresh === 0) break;
      page += 1;
    }
    const allPrices = Array.from(byId.values());
    if (page > PRICE_MAX_PAGES) {
      log.warn(
        { maxPages: PRICE_MAX_PAGES, rows: allPrices.length },
        `[ShopwareMirror] customer_prices: Seitenlimit ${PRICE_MAX_PAGES} erreicht — Snapshot evtl. unvollständig (${allPrices.length} Zeilen)`,
      );
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

    log.info(
      { upserted: allPrices.length, priceEntity: entity, durationMs: Date.now() - startedAt },
      `[ShopwareMirror] customer_prices: upserted=${allPrices.length} entity=${entity} tenant=${tenantId ?? "default"}`,
    );
    return { upserted: allPrices.length, skipped: false };
  } catch (error: any) {
    await storage.upsertShopwareSyncState(
      "customer_prices",
      { status: "error", error: error?.message || String(error) },
      tenantId,
    );
    log.warn({ error: error?.message || String(error) }, `[ShopwareMirror] customer_prices sync failed: ${error?.message || error}`);
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
    entities?: Array<"products" | "customers" | "b2b_companies" | "customer_prices" | "orders">;
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
    const entities =
      opts?.entities ?? ["products", "customers", "b2b_companies", "customer_prices", "orders"];
    if (entities.includes("products")) {
      await syncProductsDelta(storage, client, tenantId, opts);
    }
    if (entities.includes("orders")) {
      await syncOrdersDelta(storage, client, tenantId, opts);
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
      logSyncFailure(tenantId, error, `[ShopwareMirror] Sync failed for tenant ${tenantId}: ${errText(error)}`);
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
    logSyncFailure(tenantId, error, `[ShopwareMirror] Background trigger failed (tenant=${tenantId}): ${errText(error)}`);
  });
}
