// Shopware: Kundenspezifische Preise, Rabatte, Herstellpreise, Waehrungen, Individualpreis-Index.
import { ShopwareClient } from "../shopware";
import type { ShopwareCustomerPrice, ProductCrmSellingContext, EnrichedShopwareCustomerPrice, ProductAdvancedPricingDetails } from "./types";
import { toShopwareUuid, dedupeCustomerSpecificPrices, herstellpreisLookupKeyCache, HERSTELLPREIS_LOOKUP_TTL_MS, herstellpreisLookupInflight, parseProductAdvancedPrices } from "./mapping";
import { extractDiscountPercentFromCustomFields, parseDiscountPercentValue, productIdLookupKeys, parseShopwarePriceCollectionNet, computeDiscountPercentFromPurchaseBase } from "../../products/pricingUtils";
import { getHerstellpreisLookupKey } from "../../products/productIdentifiers";

/**
 * Kundenpreise mit updatedAt >= since (falls Feld existiert), sonst Vollseite.
 * Probiert bekannte B2Bsellers-Entitaetsnamen.
 */
/**
 * Kennzahlen der individuellen Preise je Kunde — in einem einzigen Request für den
 * gesamten Shop (terms-Aggregation über customerId mit stats über priceNet).
 *
 * Ersetzt den Voll-Snapshot als Grundlage des Sync: bei >12 Mio. Preiszeilen ist ein
 * zeilenweiser Abgleich unbezahlbar, diese Aggregation läuft in rund 30 Sekunden.
 * Anzahl + Summe bilden den Fingerabdruck je Kunde (updatedAt ist auf der Entität NULL).
 */
export async function fetchCustomerPriceStats(this: ShopwareClient): Promise<{
  entity: string | null;
  stats: Array<{
    customerId: string;
    priceCount: number;
    priceSum: number;
    priceMin: number | null;
    priceMax: number | null;
    priceAvg: number | null;
  }>;
}> {
  for (const entity of this.getCustomerPriceEntityCandidates()) {
    let response: Response;
    try {
      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          aggregations: [
            {
              name: "perCustomer",
              type: "terms",
              field: "customerId",
              // Großzügig über der Kundenzahl: die Aggregation kennt kein Paging,
              // ein zu kleines Limit würde stillschweigend Kunden abschneiden.
              limit: 50000,
              aggregation: { name: "stats", type: "stats", field: "priceNet" },
            },
          ],
        }),
      });
    } catch (error: any) {
      console.error(`[B2B] fetchCustomerPriceStats error (${entity}):`, error?.message || error);
      continue;
    }

    if (!response.ok) continue;

    const data = (await response.json()) as any;
    const buckets = data?.aggregations?.perCustomer?.buckets;
    if (!Array.isArray(buckets)) continue;

    const num = (v: unknown): number | null => {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    };

    return {
      entity,
      stats: buckets
        .filter((b: any) => typeof b?.key === "string" && b.key)
        .map((b: any) => ({
          customerId: b.key as string,
          priceCount: Number(b.count) || 0,
          priceSum: num(b?.stats?.sum) ?? 0,
          priceMin: num(b?.stats?.min),
          priceMax: num(b?.stats?.max),
          priceAvg: num(b?.stats?.avg),
        })),
    };
  }

  return { entity: null, stats: [] };
}

export async function fetchCustomerPricesChangedSince(
  this: ShopwareClient,
  since: string | Date | null,
  limit: number = 250,
  page: number = 1,
): Promise<{
  available: boolean;
  entity: string | null;
  prices: ShopwareCustomerPrice[];
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

  const criteriaBase = {
    limit,
    page,
    "total-count-mode": 1,
    // id als zweites Sortierkriterium: updatedAt ist auf der Preis-Entität für viele Zeilen
    // identisch (Massenimport), die Reihenfolge innerhalb einer Sekunde also beliebig.
    // Ohne stabilen Tiebreaker liefern aufeinanderfolgende Seiten überlappende Zeilen.
    sort: [
      { field: "updatedAt", order: "ASC" },
      { field: "id", order: "ASC" },
    ],
    associations: { product: {}, currency: {} },
  };

  for (const entity of this.getCustomerPriceEntityCandidates()) {
    let response: Response;
    try {
      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({ ...criteriaBase, filter }),
      });
    } catch (error: any) {
      console.error(`[B2B] fetchCustomerPricesChangedSince error (${entity}):`, error?.message || error);
      continue;
    }

    if (response.status === 404) continue;

    // Manche Installationen haben kein updatedAt auf der Preis-Entitaet.
    if (!response.ok && sinceIso) {
      try {
        response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
          method: "POST",
          body: JSON.stringify({
            ...criteriaBase,
            filter: [],
            sort: [{ field: "productNumber", order: "ASC" }],
          }),
        });
      } catch {
        continue;
      }
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[B2B] fetchCustomerPricesChangedSince ${response.status} (${entity}): ${errText}`);
      continue;
    }

    const data = await response.json();
    const list: any[] = Array.isArray(data.data) ? data.data : [];
    const includedById = new Map<string, any>();
    for (const item of data.included || []) {
      if (item?.id) includedById.set(`${item.type}-${item.id}`, item);
    }

    const num = (v: any): number | null =>
      v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

    const prices: ShopwareCustomerPrice[] = list.map((raw) => {
      const attrs = raw.attributes || raw;
      let productName: string | null = null;
      const nested = raw.product?.attributes || raw.product;
      if (nested?.translated?.name) productName = String(nested.translated.name);
      else if (nested?.name) productName = String(nested.name);
      else if (raw.relationships?.product?.data?.id) {
        const inc = includedById.get(`product-${raw.relationships.product.data.id}`);
        const ia = inc?.attributes || inc;
        if (ia?.translated?.name) productName = String(ia.translated.name);
        else if (ia?.name) productName = String(ia.name);
      }

      let currencyIsoCode: string | null = null;
      if (attrs?.currencyIsoCode) currencyIsoCode = String(attrs.currencyIsoCode);
      else {
        const cNested = raw.currency?.attributes || raw.currency;
        if (cNested?.isoCode) currencyIsoCode = String(cNested.isoCode);
        else if (raw.relationships?.currency?.data?.id) {
          const inc = includedById.get(`currency-${raw.relationships.currency.data.id}`);
          if (inc?.attributes?.isoCode) currencyIsoCode = String(inc.attributes.isoCode);
        }
      }

      return {
        id: raw.id,
        productId: attrs.productId ? String(attrs.productId) : null,
        productNumber: attrs.productNumber ? String(attrs.productNumber) : null,
        productName,
        customerId: attrs.customerId ? String(attrs.customerId) : null,
        customerNumber: attrs.customerNumber ? String(attrs.customerNumber) : null,
        from: num(attrs.from ?? attrs.quantityFrom ?? attrs.quantityStart),
        to: num(attrs.to ?? attrs.quantityTo ?? attrs.quantityEnd),
        priceNet: num(attrs.priceNet),
        pseudoPriceNet: num(attrs.pseudoPriceNet),
        currencyIsoCode,
        validFrom: attrs.validFrom ? String(attrs.validFrom) : null,
        validUntil: attrs.validUntil ? String(attrs.validUntil) : null,
      } satisfies ShopwareCustomerPrice;
    });

    const total =
      typeof data.total === "number"
        ? data.total
        : typeof data.meta?.total === "number"
          ? data.meta.total
          : prices.length;

    return { available: true, entity, prices, total };
  }

  return { available: false, entity: null, prices: [], total: 0 };
}

/**
 * Liest kundenindividuelle Preise aus dem "B2Bsellers Suite"-Plugin.
 * Probiert die bekannten Entitätsnamen (neu: `b2bsellers-customer-price`,
 * alt: `b2b-customer-price`) und kann per Env `B2B_SELLERS_CUSTOMER_PRICE_ENTITY`
 * überschrieben werden. Filtert nach customerId (UUID) oder – falls nicht
 * vorhanden – customerNumber.
 */
export async function fetchCustomerSpecificPrices(this: ShopwareClient, opts: {
  customerId?: string | null;
  customerNumber?: string | null;
  limit?: number;
  page?: number;
  /** ISO-Code (z. B. EUR). Filtert serverseitig; null = alle Währungen. */
  currencyIsoCode?: string | null;
  /** Produktnamen laden (für Währungsliste nicht nötig). */
  includeProductNames?: boolean;
}): Promise<{ available: boolean; total: number; prices: ShopwareCustomerPrice[]; entity: string | null }> {
  const limit = opts.limit ?? 100;
  const page = opts.page ?? 1;
  const includeProductNames = opts.includeProductNames !== false;
  const currencyIsoCode = opts.currencyIsoCode?.trim().toUpperCase() || null;

  const filter: any[] = [];
  if (opts.customerId) {
    filter.push({ type: "equals", field: "customerId", value: toShopwareUuid(opts.customerId) });
  } else if (opts.customerNumber) {
    filter.push({ type: "equals", field: "customerNumber", value: opts.customerNumber });
  } else {
    return { available: false, total: 0, prices: [], entity: null };
  }

  if (currencyIsoCode) {
    const currencyFilter = await this.buildCustomerPriceCurrencyFilter(currencyIsoCode);
    if (currencyFilter) filter.push(currencyFilter);
  }

  const criteria = {
    limit,
    page,
    "total-count-mode": 1,
    filter,
    sort: [{ field: "productNumber", order: "ASC" }],
    associations: includeProductNames ? { product: {}, currency: {} } : { currency: {} },
  };

  const envEntity = process.env.B2B_SELLERS_CUSTOMER_PRICE_ENTITY;
  const candidates = Array.from(
    new Set(
      [
        envEntity,
        "b2bsellers-customer-price",
        "b2b-customer-price",
        "b2bsellers_customer_price",
        "b2b_customer_price",
      ].filter(Boolean) as string[],
    ),
  );

  for (const entity of candidates) {
    let response: Response;
    try {
      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify(criteria),
      });
    } catch (error: any) {
      console.error(`[B2B] fetchCustomerSpecificPrices request error (${entity}):`, error?.message || error);
      continue;
    }

    // Entität existiert nicht in dieser Installation -> nächsten Kandidaten testen.
    if (response.status === 404) continue;

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[B2B] fetchCustomerSpecificPrices ${response.status} (${entity}): ${errText}`);
      continue;
    }

    const data = await response.json();
    const list: any[] = Array.isArray(data.data) ? data.data : [];
    const includedById = new Map<string, any>();
    for (const item of data.included || []) {
      if (item?.id) includedById.set(`${item.type}-${item.id}`, item);
    }

    const resolveProductName = (raw: any, attrs: any): string | null => {
      if (!includeProductNames) return null;
      const nested = raw.product?.attributes || raw.product;
      if (nested?.translated?.name) return String(nested.translated.name);
      if (nested?.name) return String(nested.name);
      const rel = raw.relationships?.product?.data;
      if (rel?.id) {
        const inc = includedById.get(`product-${rel.id}`);
        const incAttrs = inc?.attributes || inc;
        if (incAttrs?.translated?.name) return String(incAttrs.translated.name);
        if (incAttrs?.name) return String(incAttrs.name);
      }
      return null;
    };

    const num = (v: any): number | null =>
      v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v);

    // Löst den Währungs-ISO-Code auf. B2Bsellers speichert i. d. R. eine
    // `currencyId` (UUID) statt eines direkten ISO-Codes – daher über die
    // `currency`-Association bzw. das `included`-Array nach `isoCode` suchen.
    const resolveCurrencyIso = (raw: any, attrs: any): string | null => {
      if (attrs?.currencyIsoCode) return String(attrs.currencyIsoCode);
      const nested = raw.currency?.attributes || raw.currency;
      if (nested?.isoCode) return String(nested.isoCode);
      const rel = raw.relationships?.currency?.data;
      if (rel?.id) {
        const inc = includedById.get(`currency-${rel.id}`);
        const incAttrs = inc?.attributes || inc;
        if (incAttrs?.isoCode) return String(incAttrs.isoCode);
      }
      return null;
    };

    const prices: ShopwareCustomerPrice[] = list.map((raw) => {
      const attrs = raw.attributes || raw;
      return {
        id: raw.id,
        productId: attrs.productId ? String(attrs.productId) : null,
        productNumber: attrs.productNumber ? String(attrs.productNumber) : null,
        productName: resolveProductName(raw, attrs),
        customerId: attrs.customerId ? String(attrs.customerId) : null,
        customerNumber: attrs.customerNumber ? String(attrs.customerNumber) : null,
        from: num(attrs.from ?? attrs.quantityFrom ?? attrs.quantityStart),
        to: num(attrs.to ?? attrs.quantityTo ?? attrs.quantityEnd),
        priceNet: num(attrs.priceNet),
        pseudoPriceNet: num(attrs.pseudoPriceNet),
        currencyIsoCode: resolveCurrencyIso(raw, attrs),
        validFrom: attrs.validFrom ? String(attrs.validFrom) : null,
        validUntil: attrs.validUntil ? String(attrs.validUntil) : null,
      } satisfies ShopwareCustomerPrice;
    });

    const filteredPrices = currencyIsoCode
      ? this.filterPricesByCurrency(prices, currencyIsoCode)
      : prices;

    const total = currencyIsoCode
      ? filteredPrices.length
      : typeof data.total === "number"
        ? data.total
        : filteredPrices.length;
    return { available: total > 0, total, prices: filteredPrices, entity };
  }

  // Keine passende Entität gefunden (Plugin evtl. nicht installiert).
  return { available: false, total: 0, prices: [], entity: null };
}

/**
 * Lädt alle kundenindividuellen Preise (paginiert) und dedupliziert logische Duplikate.
 * B2Bsellers liefert oft mehrere Zeilen pro Produkt/Staffel (z. B. pro Sales Channel).
 */
export async function fetchAllCustomerSpecificPrices(this: ShopwareClient, opts: {
  customerId?: string | null;
  customerNumber?: string | null;
  currencyIsoCode?: string | null;
  includeProductNames?: boolean;
}): Promise<{ available: boolean; total: number; prices: ShopwareCustomerPrice[]; entity: string | null }> {
  const merged: ShopwareCustomerPrice[] = [];
  let page = 1;
  const limit = 250;
  // Safety-Cap: 250 × 400 = bis zu 100.000 Preiszeilen pro Kunde.
  const maxPages = 400;
  let entity: string | null = null;

  while (page <= maxPages) {
    const result = await this.fetchCustomerSpecificPrices({
      ...opts,
      limit,
      page,
    });
    if (!result.entity) {
      if (page === 1) return result;
      break;
    }
    entity = result.entity;
    merged.push(...result.prices);
    if (result.prices.length < limit) break;
    page++;
  }

  const prices = dedupeCustomerSpecificPrices(merged);
  prices.sort((a, b) =>
    (a.productNumber ?? "").localeCompare(b.productNumber ?? "", undefined, { numeric: true }),
  );

  return {
    available: prices.length > 0,
    total: prices.length,
    prices,
    entity,
  };
}

/**
 * Standard-Rabatt (B2Bsellers Discount-Rate-Addon) auf Kundenebene.
 * Prüft Customfields und bekannte Discount-Rate-Entitäten.
 */
export async function fetchCustomerB2BStandardDiscount(this: ShopwareClient, customerId: string): Promise<number | null> {
  const id = toShopwareUuid(customerId);

  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1,
        filter: [{ type: "equals", field: "id", value: id }],
        includes: { customer: ["id", "customFields"] },
      }),
    });
    if (response.ok) {
      const data = await response.json();
      const attrs = data.data?.[0]?.attributes ?? data.data?.[0];
      const fromCustomFields = extractDiscountPercentFromCustomFields(attrs?.customFields);
      if (fromCustomFields != null) return fromCustomFields;
    }
  } catch (error: any) {
    console.warn("[B2B] fetchCustomerB2BStandardDiscount customer:", error?.message || error);
  }

  const entityCandidates = [
    "b2bsellers-customer-discount-rate",
    "b2b-customer-discount-rate",
    "b2bsellers-discount-rate",
    "b2b-discount-rate",
    "b2bsellers_customer_discount_rate",
  ];
  const fieldCandidates = ["discount", "discountRate", "discountPercent", "percentage", "rate"];

  for (const entity of entityCandidates) {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          filter: [{ type: "equals", field: "customerId", value: id }],
        }),
      });
      if (response.status === 404 || !response.ok) continue;
      const data = await response.json();
      const raw = data.data?.[0];
      if (!raw) continue;
      const attrs = raw.attributes ?? raw;
      for (const field of fieldCandidates) {
        const parsed = parseDiscountPercentValue(attrs[field]);
        if (parsed != null) return parsed;
      }
    } catch {
      continue;
    }
  }

  return null;
}

/** Listenpreis netto (Shopware purchasePrices) und Verkaufspreis für Produkt-IDs. */
export async function fetchProductListAndCatalogNetPrices(
  this: ShopwareClient,
  productIds: string[],
): Promise<Map<string, { listPriceNet: number | null; catalogPriceNet: number | null }>> {
  const result = new Map<string, { listPriceNet: number | null; catalogPriceNet: number | null }>();
  if (productIds.length === 0) return result;

  const setPricing = (productId: string, pricing: { listPriceNet: number | null; catalogPriceNet: number | null }) => {
    for (const key of productIdLookupKeys(productId)) {
      result.set(key, pricing);
    }
  };

  const uniqueIds = [...new Set(productIds.map((pid) => toShopwareUuid(pid)))];
  const CHUNK = 25;
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        body: JSON.stringify({
          limit: chunk.length,
          ids: chunk,
          includes: { product: ["id", "price", "purchasePrices"], tax: ["taxRate"] },
          associations: { tax: {} },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      for (const sp of data.data || []) {
        const attrs = sp.attributes ?? sp;
        let taxRate = 19;
        if (sp.tax?.taxRate != null) taxRate = sp.tax.taxRate;
        else if (attrs?.tax?.taxRate != null) taxRate = attrs.tax.taxRate;

        const priceRaw = sp.price ?? attrs?.price;
        const purchaseRaw = sp.purchasePrices ?? attrs?.purchasePrices;

        setPricing(String(sp.id), {
          catalogPriceNet: parseShopwarePriceCollectionNet(priceRaw, taxRate),
          listPriceNet: parseShopwarePriceCollectionNet(purchaseRaw, taxRate),
        });
      }
    } catch (error: any) {
      console.warn("[Shopware] fetchProductListAndCatalogNetPrices:", error?.message || error);
    }
  }

  return result;
}

/** IFS-Schlüssel (wdu_ifs_productnumber) für Herstellpreis-Lookup je Produkt-ID. */
export async function fetchProductHerstellpreisLookupKeys(this: ShopwareClient, productIds: string[]): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (productIds.length === 0) return result;

  const setKey = (productId: string, lookupKey: string) => {
    for (const key of productIdLookupKeys(productId)) {
      result.set(key, lookupKey);
    }
  };

  const uniqueIds = [...new Set(productIds.map((pid) => toShopwareUuid(pid)))];

  // Memo pro Shopware-Instanz (Modul-Scope, s. herstellpreisLookupKeyCache): productId→
  // LookupKey ändert sich nur bei Produkt-Stammdatenpflege. Ohne Memo feuert JEDER Aufruf
  // der Bestellliste/DB-Analyse sequenzielle /search/product-Roundtrips (25er-Chunks) —
  // bei der DB-Zusammenfassung über alle Bestellungen waren das >20s pro Request.
  // '' = Produkt ohne LookupKey (negativ gecacht, sonst würde jede leere Antwort neu geholt).
  const now = Date.now();
  let bucket = herstellpreisLookupKeyCache.get(this.baseUrl);
  if (!bucket || now - bucket.fetchedAt > HERSTELLPREIS_LOOKUP_TTL_MS) {
    bucket = { fetchedAt: now, byId: new Map<string, string>() };
    herstellpreisLookupKeyCache.set(this.baseUrl, bucket);
  }

  // Single-Flight: Läuft für diese Shopware-Instanz bereits ein Fill (z. B. Bestellliste
  // und DB-Zusammenfassung feuern beim Seitenaufruf gleichzeitig auf leeren Memo), erst
  // darauf warten statt dieselben Chunks doppelt zu holen — sonst verdoppeln konkurrierende
  // Kaltstart-Requests die Roundtrips und verlangsamen sich gegenseitig (real gemessen: 40s).
  let inflight = herstellpreisLookupInflight.get(this.baseUrl);
  while (inflight && uniqueIds.some((id) => !bucket!.byId.has(id))) {
    try {
      await inflight;
    } catch {
      /* Fehler des fremden Fills ignorieren — fehlende IDs holt der eigene Fill unten nach */
    }
    const next = herstellpreisLookupInflight.get(this.baseUrl);
    if (next === inflight) break; // derselbe (abgeschlossene) Fill → nicht endlos warten
    inflight = next;
  }

  const missingIds = uniqueIds.filter((id) => !bucket!.byId.has(id));

  if (missingIds.length > 0) {
    const fill = this.fillHerstellpreisLookupKeys(bucket, missingIds);
    herstellpreisLookupInflight.set(this.baseUrl, fill);
    try {
      await fill;
    } finally {
      if (herstellpreisLookupInflight.get(this.baseUrl) === fill) {
        herstellpreisLookupInflight.delete(this.baseUrl);
      }
    }
  }

  for (const id of uniqueIds) {
    const lookupKey = bucket.byId.get(id);
    if (lookupKey) setKey(id, lookupKey);
  }

  return result;
}

/** Fehlende LookupKeys in 25er-Chunks holen — parallel mit begrenzter Nebenläufigkeit
 *  (5 gleichzeitige Requests): Der Kalt-Aufbau über alle Bestellprodukte bestand aus
 *  20+ sequenziellen Roundtrips à ~1s; parallelisiert schrumpft er auf wenige Sekunden. */
export async function fillHerstellpreisLookupKeys(
  this: ShopwareClient,
  bucket: { byId: Map<string, string> },
  missingIds: string[],
): Promise<void> {
  const CHUNK = 25;
  const CONCURRENCY = 5;
  const chunks: string[][] = [];
  for (let i = 0; i < missingIds.length; i += CHUNK) {
    chunks.push(missingIds.slice(i, i + CHUNK));
  }

  const fetchChunk = async (chunk: string[]): Promise<void> => {
    const returnedIds = new Set<string>();
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        body: JSON.stringify({
          limit: chunk.length,
          ids: chunk,
          includes: { product: ["id", "productNumber", "customFields"] },
        }),
      });
      if (!response.ok) return;
      const data = await response.json();
      for (const sp of data.data || []) {
        const attrs = sp.attributes ?? sp;
        const customFields = (sp.customFields ?? attrs?.customFields) as
          | Record<string, unknown>
          | undefined;
        const productNumber = String(sp.productNumber ?? attrs?.productNumber ?? "");
        const lookupKey = getHerstellpreisLookupKey(
          customFields,
          productNumber.trim() || undefined,
        );
        const spId = toShopwareUuid(String(sp.id));
        returnedIds.add(spId);
        bucket.byId.set(spId, lookupKey ?? "");
      }
      // Angefragt, aber nicht zurückgekommen (z. B. gelöschtes Produkt) → negativ cachen.
      for (const id of chunk) {
        if (!returnedIds.has(id) && !bucket.byId.has(id)) bucket.byId.set(id, "");
      }
    } catch (error: any) {
      console.warn("[Shopware] fetchProductHerstellpreisLookupKeys:", error?.message || error);
    }
  };

  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, async () => {
    while (cursor < chunks.length) {
      const chunk = chunks[cursor++];
      await fetchChunk(chunk);
    }
  });
  await Promise.all(workers);
}

/**
 * Verkaufspreis-Kontext für CRM-Marge: Katalogpreis + erweiterte Staffelpreise je Produkt-ID.
 */
export async function fetchProductCrmSellingContext(this: ShopwareClient, productIds: string[]): Promise<Map<string, ProductCrmSellingContext>> {
  const result = new Map<string, ProductCrmSellingContext>();
  if (productIds.length === 0) return result;

  const setContext = (productId: string, context: ProductCrmSellingContext) => {
    for (const key of productIdLookupKeys(productId)) {
      result.set(key, context);
    }
  };

  const uniqueIds = [...new Set(productIds.map((pid) => toShopwareUuid(pid)))];
  const CHUNK = 25;
  for (let i = 0; i < uniqueIds.length; i += CHUNK) {
    const chunk = uniqueIds.slice(i, i + CHUNK);
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: "POST",
        body: JSON.stringify({
          limit: chunk.length,
          ids: chunk,
          includes: {
            product: ["id", "price", "prices"],
            product_price: ["quantityStart", "quantityEnd", "price", "ruleId", "versionId", "updatedAt", "createdAt", "rule"],
            rule: ["id", "name"],
            tax: ["taxRate"],
          },
          associations: {
            tax: {},
            prices: { associations: { rule: {} } },
          },
        }),
      });
      if (!response.ok) continue;
      const data = await response.json();
      const includedMap = new Map<string, any>();
      if (Array.isArray(data.included)) {
        data.included.forEach((item: any) => includedMap.set(`${item.type}-${item.id}`, item));
      }
      for (const sp of data.data || []) {
        const attrs = sp.attributes ?? sp;
        let taxRate = 19;
        if (sp.tax?.taxRate != null) taxRate = sp.tax.taxRate;
        else if (attrs?.tax?.taxRate != null) taxRate = attrs.tax.taxRate;

        const priceRaw = sp.price ?? attrs?.price;
        setContext(String(sp.id), {
          catalogPriceNet: parseShopwarePriceCollectionNet(priceRaw, taxRate),
          advancedPrices: parseProductAdvancedPrices(sp, includedMap),
        });
      }
    } catch (error: any) {
      console.warn("[Shopware] fetchProductCrmSellingContext:", error?.message || error);
    }
  }

  return result;
}

export function lookupProductPricing<T>(this: ShopwareClient, map: Map<string, T>, productId: string | null | undefined): T | null {
  if (!productId) return null;
  for (const key of productIdLookupKeys(productId)) {
    const hit = map.get(key);
    if (hit) return hit;
  }
  return null;
}

/** Ergänzt Kundenpreise um Listenpreis netto (purchasePrices) und Rabatt in Prozent. */
export async function enrichCustomerSpecificPricesWithDiscounts(
  this: ShopwareClient,
  prices: ShopwareCustomerPrice[],
): Promise<EnrichedShopwareCustomerPrice[]> {
  const productIds = [
    ...new Set(prices.filter((p) => p.productId).map((p) => String(p.productId))),
  ];
  const priceByProductId = await this.fetchProductListAndCatalogNetPrices(productIds);

  return prices.map((price) => {
    const productPricing = this.lookupProductPricing(priceByProductId, price.productId);
    const listPriceNet = productPricing?.listPriceNet ?? null;
    const catalogPriceNet = productPricing?.catalogPriceNet ?? null;

    return {
      ...price,
      listPriceNet,
      catalogPriceNet,
      discountPercent: computeDiscountPercentFromPurchaseBase(
        price.priceNet,
        catalogPriceNet,
        listPriceNet,
      ),
    };
  });
}

/** Erweiterte Produktpreise inkl. Rabatt relativ zum Einkaufspreis (Listenpreis). */
export async function fetchProductAdvancedPricing(this: ShopwareClient, productId: string): Promise<ProductAdvancedPricingDetails | null> {
  const { products } = await this.fetchProductsOverviewPage(1, 1, {
    productId,
    includeInactive: true,
  });
  const product = products[0];
  if (!product) return null;

  const listPriceNet = product.purchasePriceNet;

  const advancedPrices = product.advancedPrices.map((tier) => ({
    ...tier,
    discountPercent: computeDiscountPercentFromPurchaseBase(
      tier.net,
      product.priceNet,
      listPriceNet,
    ),
  }));

  return {
    productId: product.id,
    productNumber: product.productNumber,
    name: product.name,
    priceNet: product.priceNet,
    priceGross: product.priceGross,
    listPriceNet,
    taxRate: product.taxRate,
    currency: product.currency,
    maxDiscountPercent: extractDiscountPercentFromCustomFields(product.customFields),
    advancedPrices,
  };
}

/**
 * Liefert alle beim Kunden hinterlegten Währungs-ISO-Codes (ohne Produktnamen).
 * Wird on demand geladen, wenn der Nutzer die Währungsauswahl öffnet.
 */
export async function fetchCustomerPriceCurrencies(this: ShopwareClient, opts: {
  customerId?: string | null;
  customerNumber?: string | null;
}): Promise<{ currencies: string[] }> {
  const currencies = new Set<string>();
  let page = 1;
  const limit = 250;
  // Safety-Cap: 250 × 400 = bis zu 100.000 Preiszeilen pro Kunde.
  const maxPages = 400;

  while (page <= maxPages) {
    const result = await this.fetchCustomerSpecificPrices({
      ...opts,
      limit,
      page,
      includeProductNames: false,
    });
    if (!result.entity) break;
    for (const price of result.prices) {
      currencies.add(ShopwareClient.normalizePriceCurrencyIso(price.currencyIsoCode));
    }
    if (result.prices.length < limit) break;
    page++;
  }

  return { currencies: [...currencies].sort((a, b) => a.localeCompare(b)) };
}

/** Löst Shopware-Währungs-UUID aus ISO-Code (gecacht). */
export async function resolveCurrencyId(this: ShopwareClient, isoCode: string): Promise<string | null> {
  const iso = isoCode.toUpperCase();
  const cached = this.currencyIdCache.get(iso);
  if (cached) return cached;

  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/currency`, {
      method: "POST",
      body: JSON.stringify({
        limit: 1,
        filter: [{ type: "equals", field: "isoCode", value: iso }],
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    const id = data.data?.[0]?.id;
    if (typeof id === "string" && id.length > 0) {
      this.currencyIdCache.set(iso, id);
      return id;
    }
  } catch (error: any) {
    console.warn(`[Shopware] resolveCurrencyId(${iso}):`, error?.message || error);
  }
  return null;
}

/** Shopware-Filter für kundenindividuelle Preise nach Währung. */
export async function buildCustomerPriceCurrencyFilter(this: ShopwareClient, currencyIsoCode: string): Promise<any | null> {
  const iso = currencyIsoCode.toUpperCase();
  if (iso === "EUR") {
    const eurId = await this.resolveCurrencyId("EUR");
    const queries: any[] = [{ type: "equals", field: "currencyId", value: null }];
    if (eurId) queries.unshift({ type: "equals", field: "currencyId", value: eurId });
    return queries.length === 1 ? queries[0]! : { type: "multi", operator: "or", queries };
  }
  const id = await this.resolveCurrencyId(iso);
  if (!id) {
    return { type: "equals", field: "currencyIsoCode", value: iso };
  }
  return { type: "equals", field: "currencyId", value: id };
}

export function filterPricesByCurrency(
  this: ShopwareClient,
  prices: ShopwareCustomerPrice[],
  currencyIsoCode: string,
): ShopwareCustomerPrice[] {
  const want = currencyIsoCode.toUpperCase();
  return prices.filter(
    (p) => ShopwareClient.normalizePriceCurrencyIso(p.currencyIsoCode) === want,
  );
}

/** Bekannte Entitätsnamen der B2Bsellers-Customer-Price-Entität (überschreibbar per Env). */
export function getCustomerPriceEntityCandidates(this: ShopwareClient): string[] {
  const envEntity = process.env.B2B_SELLERS_CUSTOMER_PRICE_ENTITY;
  return Array.from(
    new Set(
      [
        envEntity,
        "b2bsellers-customer-price",
        "b2b-customer-price",
        "b2bsellers_customer_price",
        "b2b_customer_price",
      ].filter(Boolean) as string[],
    ),
  );
}

/**
 * Liefert die Menge aller Kunden, die im B2Bsellers-Suite-Plugin mindestens einen
 * kundenindividuellen Preis hinterlegt haben. Nutzt eine Terms-Aggregation auf
 * `customerId` (Pflichtfeld der Entität) und löst anschließend die E-Mail-Adressen
 * der Kunden auf, damit der Aufrufer gegen lokale CRM-Kunden (per E-Mail) matchen kann.
 */
export async function fetchIndividualPriceCustomerIndex(this: ShopwareClient): Promise<{
  entity: string | null;
  customerCount: number;
  emails: string[];
  customers: Array<{
    id: string;
    email: string;
    name: string;
    company: string | null;
    phone: string | null;
    salesChannelId: string | null;
  }>;
}> {
  // Sicherheitsgrenze, um bei sehr vielen Kunden nicht endlos E-Mails aufzulösen.
  const MAX_CUSTOMERS = 5000;
  const empty = {
    entity: null as string | null,
    customerCount: 0,
    emails: [] as string[],
    customers: [] as Array<{
      id: string;
      email: string;
      name: string;
      company: string | null;
      phone: string | null;
      salesChannelId: string | null;
    }>,
  };

  for (const entity of this.getCustomerPriceEntityCandidates()) {
    let response: Response;
    try {
      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          aggregations: [
            { name: "byCustomer", type: "terms", field: "customerId", limit: MAX_CUSTOMERS },
          ],
        }),
      });
    } catch (error: any) {
      console.error(`[B2B] fetchIndividualPriceCustomerIndex request error (${entity}):`, error?.message || error);
      continue;
    }

    if (response.status === 404) continue;
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[B2B] fetchIndividualPriceCustomerIndex ${response.status} (${entity}): ${errText}`);
      continue;
    }

    const data = await response.json();
    const buckets: any[] = data?.aggregations?.byCustomer?.buckets || [];
    const customerIds = buckets
      .map((b) => (b?.key != null ? String(b.key) : null))
      .filter((k): k is string => !!k);

    const customerCount = customerIds.length;
    if (customerCount === 0) {
      return { entity, customerCount: 0, emails: [], customers: [] };
    }

    // Kundendaten in Chunks auflösen (equalsAny über die Kunden-IDs).
    const emails = new Set<string>();
    const customers: Array<{
      id: string;
      email: string;
      name: string;
      company: string | null;
      phone: string | null;
      salesChannelId: string | null;
    }> = [];
    const CHUNK = 100;
    for (let i = 0; i < customerIds.length; i += CHUNK) {
      const chunk = customerIds.slice(i, i + CHUNK).map((id) => toShopwareUuid(id));
      try {
        const custResp = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/customer`, {
          method: "POST",
          body: JSON.stringify({
            limit: CHUNK,
            filter: [{ type: "equalsAny", field: "id", value: chunk }],
            includes: { customer: ["id", "email", "firstName", "lastName", "company", "salesChannelId"] },
            associations: { defaultBillingAddress: {} },
          }),
        });
        if (!custResp.ok) continue;
        const custData = await custResp.json();
        const includedMap = new Map<string, any>();
        for (const item of custData.included || []) {
          if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
        }
        for (const row of custData.data || []) {
          const attrs = row.attributes || row;
          const email = attrs?.email ? String(attrs.email).trim().toLowerCase() : "";
          if (!email) continue;
          emails.add(email);

          const billingRel = attrs.defaultBillingAddress?.data?.id ?? attrs.defaultBillingAddress?.id;
          const billingEntity = billingRel
            ? includedMap.get(`customer_address-${billingRel}`)
            : undefined;
          const billingAttrs = billingEntity?.attributes || billingEntity;
          const company =
            (billingAttrs?.company ? String(billingAttrs.company).trim() : "") ||
            (attrs?.company ? String(attrs.company).trim() : "") ||
            null;
          const firstName = String(attrs?.firstName || "").trim();
          const lastName = String(attrs?.lastName || "").trim();
          const name = [firstName, lastName].filter(Boolean).join(" ") || company || email;
          const phone = billingAttrs?.phoneNumber
            ? String(billingAttrs.phoneNumber).trim()
            : null;
          const salesChannelId = attrs?.salesChannelId ? String(attrs.salesChannelId) : null;

          customers.push({
            id: String(attrs?.id || row.id),
            email,
            name,
            company,
            phone,
            salesChannelId,
          });
        }
      } catch (error: any) {
        console.warn("[B2B] fetchIndividualPriceCustomerIndex email resolve error:", error?.message || error);
      }
    }

    return {
      entity,
      customerCount: customers.length,
      emails: Array.from(emails),
      customers,
    };
  }

  // Plugin/Entität nicht vorhanden.
  return empty;
}

/**
 * Diagnose: liefert die Rohzahlen aus der B2Bsellers-Preis-Entität direkt aus
 * Shopware – um zu prüfen, ob der angezeigte "X Kunden mit individuellen Preisen"
 * Zähler vollständig ist. Zählt distinct customerId, distinct customerNumber,
 * Zeilen ohne customerId sowie die Gesamtzahl der Preiszeilen.
 */
export async function fetchIndividualPriceDiagnostics(this: ShopwareClient): Promise<{
  entity: string | null;
  totalRows: number;
  distinctCustomerId: number;
  distinctCustomerNumber: number;
  rowsWithoutCustomerId: number;
  aggregationCapped: boolean;
}> {
  const empty = {
    entity: null as string | null,
    totalRows: 0,
    distinctCustomerId: 0,
    distinctCustomerNumber: 0,
    rowsWithoutCustomerId: 0,
    aggregationCapped: false,
  };
  // Terms-Buckets bis zu dieser Grenze zählen. Wird sie erreicht, ist die
  // echte Anzahl distinct-Werte evtl. höher (aggregationCapped = true).
  const TERMS_LIMIT = 50000;

  for (const entity of this.getCustomerPriceEntityCandidates()) {
    let response: Response;
    try {
      response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          "total-count-mode": 1,
          aggregations: [
            { name: "byCustomerId", type: "terms", field: "customerId", limit: TERMS_LIMIT },
            { name: "byCustomerNumber", type: "terms", field: "customerNumber", limit: TERMS_LIMIT },
          ],
        }),
      });
    } catch (error: any) {
      console.error(`[B2B] fetchIndividualPriceDiagnostics request error (${entity}):`, error?.message || error);
      continue;
    }

    if (response.status === 404) continue;
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      console.warn(`[B2B] fetchIndividualPriceDiagnostics ${response.status} (${entity}): ${errText}`);
      continue;
    }

    const data = await response.json();
    const totalRows = data?.total ?? data?.meta?.total ?? 0;
    const idBuckets: any[] = data?.aggregations?.byCustomerId?.buckets || [];
    const numberBuckets: any[] = data?.aggregations?.byCustomerNumber?.buckets || [];

    // Distinct customerId ohne leere/null-Keys.
    const distinctCustomerId = idBuckets.filter(
      (b) => b?.key != null && String(b.key).trim() !== "",
    ).length;
    const distinctCustomerNumber = numberBuckets.filter(
      (b) => b?.key != null && String(b.key).trim() !== "",
    ).length;

    // Preiszeilen ohne customerId separat zählen.
    let rowsWithoutCustomerId = 0;
    try {
      const nullResp = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          "total-count-mode": 1,
          filter: [{ type: "equals", field: "customerId", value: null }],
        }),
      });
      if (nullResp.ok) {
        const nullData = await nullResp.json();
        rowsWithoutCustomerId = nullData?.total ?? nullData?.meta?.total ?? 0;
      }
    } catch (error: any) {
      console.warn(`[B2B] fetchIndividualPriceDiagnostics null-count error (${entity}):`, error?.message || error);
    }

    return {
      entity,
      totalRows,
      distinctCustomerId,
      distinctCustomerNumber,
      rowsWithoutCustomerId,
      aggregationCapped:
        idBuckets.length >= TERMS_LIMIT || numberBuckets.length >= TERMS_LIMIT,
    };
  }

  return empty;
}

/**
 * Leichter Fingerprint für den Individual-Prices-Index (Aggregation, ohne E-Mail-Auflösung).
 */
export async function fetchIndividualPriceCustomerFingerprint(this: ShopwareClient): Promise<string | null> {
  const { stableFingerprint } = await import("../../lib/contentHashCache");

  for (const entity of this.getCustomerPriceEntityCandidates()) {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/${entity}`, {
        method: "POST",
        body: JSON.stringify({
          limit: 1,
          "total-count-mode": 1,
          aggregations: [{ name: "byCustomer", type: "terms", field: "customerId", limit: 5 }],
        }),
      });
      if (response.status === 404) continue;
      if (!response.ok) continue;

      const data = await response.json();
      const buckets: any[] = data?.aggregations?.byCustomer?.buckets || [];
      const fp = await this.fetchEntitySearchFingerprint(entity, { sortField: "updatedAt" });

      return stableFingerprint({
        scope: "individual_prices",
        entity,
        docTotal: data?.meta?.total ?? 0,
        distinctCustomers: buckets.length,
        latestUpdatedAt: fp?.latestUpdatedAt ?? null,
      });
    } catch {
      continue;
    }
  }
  return stableFingerprint({ scope: "individual_prices", entity: "none" });
}
