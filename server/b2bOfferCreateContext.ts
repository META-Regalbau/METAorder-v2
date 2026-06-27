import { randomUUID } from "crypto";
import type { OrderAddress, ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "./shopware";
import type { OfferStatusMapping } from "./b2bSellersClient";
import { getOfferStatusMapping } from "./b2bSellersClient";

export type B2BOfferCustomerContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phoneNumber?: string;
  billingAddress?: Partial<OrderAddress>;
};

const OFFER_NUMBER_RANGE_TYPE =
  process.env.B2B_SELLERS_OFFER_NUMBER_RANGE_TYPE || "b2bsellers_offer";

function toShopwareUuid(uuid: string): string {
  return uuid.replace(/-/g, "").toLowerCase();
}

/**
 * Reserviert eine Angebotsnummer aus dem Shopware Number-Range `b2bsellers_offer`.
 * Fällt bei Fehlern auf eine generierte Nummer zurück, damit die Erstellung nicht blockiert.
 */
async function reserveOfferNumber(
  client: ShopwareClient,
  salesChannelId: string
): Promise<string> {
  try {
    return await client.reserveNumberRange(OFFER_NUMBER_RANGE_TYPE, salesChannelId);
  } catch {
    try {
      return await client.reserveNumberRange(OFFER_NUMBER_RANGE_TYPE);
    } catch (error) {
      console.warn(
        "[B2BOffer] Number-Range-Reservierung fehlgeschlagen, nutze Fallback-Nummer:",
        error instanceof Error ? error.message : error
      );
      return `OF-${Date.now()}`;
    }
  }
}

function readAttr(row: any, key: string): unknown {
  if (!row) return undefined;
  if (row[key] !== undefined) return row[key];
  return row.attributes?.[key];
}

async function searchFirst(
  client: ShopwareClient,
  entity: string,
  body: Record<string, unknown>
): Promise<any | null> {
  const data = await client.searchEntity(entity, body);
  return data?.data?.[0] ?? null;
}

async function fetchSalutationId(client: ShopwareClient): Promise<string> {
  const row = await searchFirst(client, "salutation", { limit: 1 });
  const id = readAttr(row, "id");
  if (!id || typeof id !== "string") {
    throw new Error("Shopware-Anrede (salutation) nicht gefunden");
  }
  return id;
}

async function fetchCountryId(client: ShopwareClient, countryHint?: string): Promise<string> {
  const raw = (countryHint || "DE").trim();

  if (/^[a-z]{2}$/i.test(raw)) {
    const byIso = await searchFirst(client, "country", {
      limit: 1,
      filter: [{ type: "equals", field: "iso", value: raw.toUpperCase() }],
    });
    if (byIso?.id) return String(byIso.id);
  } else if (raw.length > 1) {
    const byName = await searchFirst(client, "country", {
      limit: 1,
      filter: [{ type: "contains", field: "name", value: raw }],
    });
    if (byName?.id) return String(byName.id);
  }

  const fallback = await searchFirst(client, "country", {
    limit: 1,
    filter: [{ type: "equals", field: "iso", value: "DE" }],
  });
  const id = fallback?.id;
  if (!id) throw new Error("Kein Shopware-Land gefunden");
  return String(id);
}

export async function resolveOpenOfferStatusId(
  client: ShopwareClient,
  mapping: OfferStatusMapping = getOfferStatusMapping()
): Promise<string> {
  const data = await client.searchEntity("b2bsellers-offer-status", {
    limit: 100,
    sort: [{ field: "createdAt", order: "ASC" }],
  });
  const rows: any[] = data?.data ?? [];

  const pick = (predicate: (row: any) => boolean): string | null => {
    const row = rows.find(predicate);
    return row?.id ? String(row.id) : null;
  };

  const fromLive =
    pick((r) => readAttr(r, "open") === true) ??
    pick((r) => String(readAttr(r, "label") || "").toLowerCase() === "open") ??
    pick((r) => {
      const label = String(readAttr(r, "label") || "").toLowerCase();
      return label === String(mapping.sent.label || "").toLowerCase();
    });

  if (fromLive) return fromLive;

  const mappedId = mapping.sent.id || mapping.submitted.id || mapping.draft.id;
  if (mappedId && rows.some((r) => String(r.id) === mappedId)) {
    return mappedId;
  }

  if (rows[0]?.id) return String(rows[0].id);

  throw new Error(
    "Kein B2B-Angebotsstatus in Shopware gefunden (b2bsellers-offer-status). Bitte B2B-Plugin prüfen."
  );
}

export async function fetchSalesChannelOfferDefaults(
  client: ShopwareClient,
  salesChannelId: string
): Promise<{ currencyId: string; shippingMethodId: string; paymentMethodId: string }> {
  const channel = await searchFirst(client, "sales-channel", {
    limit: 1,
    filter: [{ type: "equals", field: "id", value: toShopwareUuid(salesChannelId) }],
    associations: {
      currency: {},
      shippingMethods: {},
      paymentMethods: {},
    },
  });

  if (!channel) {
    throw new Error(`Verkaufskanal ${salesChannelId} nicht in Shopware gefunden`);
  }

  let currencyId = String(readAttr(channel, "currencyId") || "");
  if (!currencyId) {
    const nestedCurrency = channel.currency ?? channel.attributes?.currency;
    currencyId = String(nestedCurrency?.id || readAttr(nestedCurrency, "id") || "");
  }
  if (!currencyId) {
    const fallbackCurrency = await searchFirst(client, "currency", { limit: 1 });
    currencyId = String(fallbackCurrency?.id || "");
  }

  const shippingMethods = channel.shippingMethods ?? channel.attributes?.shippingMethods ?? [];
  let shippingMethodId = Array.isArray(shippingMethods) && shippingMethods[0]?.id
    ? String(shippingMethods[0].id)
    : "";
  if (!shippingMethodId) {
    const fallbackShipping = await searchFirst(client, "shipping-method", {
      limit: 1,
      filter: [{ type: "equals", field: "active", value: true }],
    });
    shippingMethodId = String(fallbackShipping?.id || "");
  }

  const paymentMethods = channel.paymentMethods ?? channel.attributes?.paymentMethods ?? [];
  let paymentMethodId = Array.isArray(paymentMethods) && paymentMethods[0]?.id
    ? String(paymentMethods[0].id)
    : "";
  if (!paymentMethodId) {
    const fallbackPayment = await searchFirst(client, "payment-method", {
      limit: 1,
      filter: [{ type: "equals", field: "active", value: true }],
    });
    paymentMethodId = String(fallbackPayment?.id || "");
  }

  if (!currencyId || !shippingMethodId || !paymentMethodId) {
    throw new Error(
      "Verkaufskanal-Kontext unvollständig (currencyId, shippingMethodId oder paymentMethodId fehlt). Bitte Shopware-Kanal prüfen."
    );
  }

  return { currencyId, shippingMethodId, paymentMethodId };
}

function mergeAddress(
  primary?: Partial<OrderAddress>,
  fallback?: Partial<OrderAddress>
): Partial<OrderAddress> {
  return {
    firstName: (primary?.firstName || fallback?.firstName || "").trim(),
    lastName: (primary?.lastName || fallback?.lastName || "").trim(),
    company: (primary?.company || fallback?.company || "").trim() || undefined,
    street: (primary?.street || fallback?.street || "").trim(),
    zipCode: (primary?.zipCode || fallback?.zipCode || "").trim(),
    city: (primary?.city || fallback?.city || "").trim(),
    country: (primary?.country || fallback?.country || "DE").trim(),
    phoneNumber: (primary?.phoneNumber || fallback?.phoneNumber || "").trim() || undefined,
  };
}

function buildOfferAddressPayload(
  address: Partial<OrderAddress>,
  salutationId: string,
  countryId: string
): Record<string, unknown> {
  const firstName = address.firstName || address.company || "N/A";
  const lastName = address.lastName || "Customer";
  const payload: Record<string, unknown> = {
    id: randomUUID().replace(/-/g, ""),
    salutationId,
    firstName,
    lastName,
    street: address.street || "—",
    zipcode: address.zipCode || "00000",
    city: address.city || "—",
    countryId,
  };
  if (address.company) payload.company = address.company;
  if (address.phoneNumber) payload.phoneNumber = address.phoneNumber;
  return payload;
}

async function findExistingOfferCustomerId(
  client: ShopwareClient,
  shopwareCustomerId: string
): Promise<string | null> {
  const customerId = toShopwareUuid(shopwareCustomerId);
  for (const entity of ["b2bsellers-offer-customer", "b2b_sellers_offer_customer"]) {
    try {
      const row = await searchFirst(client, entity, {
        limit: 1,
        filter: [{ type: "equals", field: "customerId", value: customerId }],
      });
      if (row?.id) return String(row.id);
    } catch {
      /* entity name may differ between installs */
    }
  }
  return null;
}

export type OfferLineItemInput = {
  productId: string;
  quantity: number;
  productNumber?: string;
  payload?: Record<string, unknown>;
};

/**
 * Validiert die Produkt-IDs eines Angebots gegen Shopware und löst veraltete IDs
 * (z. B. aus einer anderen Umgebung) über die productNumber neu auf.
 *
 * Rückgabe: gültige Items (ggf. mit korrigierter productId) sowie eine Liste der
 * nicht auflösbaren Positionen für eine klare Fehlermeldung.
 */
export async function resolveOfferLineItemProducts(
  settings: ShopwareSettings,
  items: OfferLineItemInput[]
): Promise<{
  items: OfferLineItemInput[];
  invalid: Array<{ productId: string; productNumber?: string }>;
}> {
  if (items.length === 0) return { items, invalid: [] };

  const client = new ShopwareClient(settings);
  const ids = Array.from(new Set(items.map((i) => toShopwareUuid(i.productId))));

  const existing = new Set<string>();
  try {
    const res = await client.searchEntity("product", {
      limit: ids.length,
      filter: [{ type: "equalsAny", field: "id", value: ids }],
    });
    for (const row of res?.data ?? []) {
      const id = String(readAttr(row, "id") || row.id || "");
      if (id) existing.add(id.toLowerCase());
    }
  } catch (error) {
    // Wenn die Validierung selbst fehlschlägt, lieber unverändert weitergeben
    console.warn(
      "[B2BOffer] Produkt-Validierung fehlgeschlagen, überspringe Re-Resolve:",
      error instanceof Error ? error.message : error
    );
    return { items, invalid: [] };
  }

  const resolved: OfferLineItemInput[] = [];
  const invalid: Array<{ productId: string; productNumber?: string }> = [];

  for (const item of items) {
    const id = toShopwareUuid(item.productId);
    if (existing.has(id)) {
      resolved.push({ ...item, productId: id });
      continue;
    }

    // Veraltete/ungültige ID: über productNumber neu auflösen
    if (item.productNumber && item.productNumber.trim()) {
      const byNumber = await searchFirst(client, "product", {
        limit: 1,
        filter: [{ type: "equals", field: "productNumber", value: item.productNumber.trim() }],
      });
      const newId = byNumber ? String(readAttr(byNumber, "id") || byNumber.id || "") : "";
      if (newId) {
        resolved.push({ ...item, productId: newId.toLowerCase() });
        continue;
      }
    }

    invalid.push({ productId: item.productId, productNumber: item.productNumber });
  }

  return { items: resolved, invalid };
}

export function formatShopwareWriteError(errorText: string): string {
  try {
    const parsed = JSON.parse(errorText) as { errors?: Array<{ detail?: string; source?: { pointer?: string } }> };
    if (Array.isArray(parsed.errors) && parsed.errors.length > 0) {
      const parts = parsed.errors
        .slice(0, 5)
        .map((e) => {
          const field = e.source?.pointer?.replace(/^\//, "") || "Feld";
          return `${field}: ${e.detail || "Ungültig"}`;
        });
      return parts.join("; ");
    }
  } catch {
    /* not JSON */
  }
  return errorText.length > 400 ? `${errorText.slice(0, 400)}…` : errorText;
}

/**
 * Baut die vollständige Shopware-Schreib-Payload für b2bsellers-offer (Admin API).
 */
async function fetchCustomerEmail(
  client: ShopwareClient,
  shopwareCustomerId: string
): Promise<string | undefined> {
  const row = await searchFirst(client, "customer", {
    limit: 1,
    filter: [{ type: "equals", field: "id", value: toShopwareUuid(shopwareCustomerId) }],
  });
  const email = readAttr(row, "email");
  return typeof email === "string" && email.trim() ? email.trim() : undefined;
}

type ProductPricing = { net: number; gross: number; taxRate: number; name: string };

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Holt Netto-Preis, Brutto-Preis und Steuersatz je Produkt aus Shopware.
 * Bevorzugt den Preis in der Angebotswährung, sonst den ersten Preis.
 */
async function fetchProductPricing(
  client: ShopwareClient,
  productIds: string[],
  currencyId: string
): Promise<Map<string, ProductPricing>> {
  const map = new Map<string, ProductPricing>();
  if (productIds.length === 0) return map;

  const res = await client.searchEntity("product", {
    limit: productIds.length,
    filter: [{ type: "equalsAny", field: "id", value: productIds }],
    associations: { tax: {} },
  });

  for (const row of res?.data ?? []) {
    const a = (row.attributes ?? row) as Record<string, any>;
    const id = String(row.id ?? a.id ?? "").toLowerCase();
    if (!id) continue;

    const prices: any[] = Array.isArray(a.price) ? a.price : [];
    const match = prices.find((p) => p?.currencyId === currencyId) ?? prices[0];
    const net = Number(match?.net ?? 0);
    const gross = Number(match?.gross ?? net);

    const taxObj = (a.tax?.attributes ?? a.tax ?? row.tax) as Record<string, any> | undefined;
    let taxRate = Number(taxObj?.taxRate ?? 0);
    // Falls das Produkt einen 0%-Steuersatz hat, aber Brutto≠Netto, den impliziten Satz nutzen.
    if ((!taxRate || taxRate === 0) && net > 0 && gross > net) {
      taxRate = round2(((gross - net) / net) * 100);
    }

    map.set(id, { net, gross, taxRate, name: String(a.name ?? "") });
  }

  return map;
}

function buildCalculatedItemPrice(net: number, quantity: number, taxRate: number) {
  const unitPrice = round2(net);
  const totalPrice = round2(net * quantity);
  const tax = round2((totalPrice * taxRate) / 100);
  return {
    unitPrice,
    totalPrice,
    quantity,
    calculatedTaxes: [{ tax, taxRate, price: totalPrice }],
    taxRules: [{ taxRate, percentage: 100 }],
    referencePrice: null,
    listPrice: null,
    regulationPrice: null,
  };
}

function buildQuantityPriceDefinition(net: number, quantity: number, taxRate: number) {
  return {
    type: "quantity",
    price: round2(net),
    quantity,
    taxRules: [{ taxRate, percentage: 100 }],
    isCalculated: true,
    listPrice: null,
    referencePriceDefinition: null,
    regulationPrice: null,
  };
}

export async function buildB2BOfferCreateAttributes(
  settings: ShopwareSettings,
  params: {
    shopwareCustomerId: string;
    salesChannelId: string;
    lineItems: Array<{
      productId: string;
      quantity: number;
      type?: string;
      payload?: Record<string, unknown>;
    }>;
    customerContext?: B2BOfferCustomerContext;
    statusMapping?: OfferStatusMapping;
  }
): Promise<Record<string, unknown>> {
  const client = new ShopwareClient(settings);
  const statusMapping = params.statusMapping ?? getOfferStatusMapping();

  const [statusId, channelDefaults, salutationId, customerSnap, existingOfferCustomerId, offerNumber] =
    await Promise.all([
      resolveOpenOfferStatusId(client, statusMapping),
      fetchSalesChannelOfferDefaults(client, params.salesChannelId),
      fetchSalutationId(client),
      client.fetchCustomerBillingForPdf(params.shopwareCustomerId),
      findExistingOfferCustomerId(client, params.shopwareCustomerId),
      reserveOfferNumber(client, params.salesChannelId),
    ]);

  const ctx = params.customerContext ?? {};
  const billingMerged = mergeAddress(ctx.billingAddress, customerSnap?.billingAddress);
  const email = (ctx.email || "").trim() || (await fetchCustomerEmail(client, params.shopwareCustomerId));

  const countryId = await fetchCountryId(client, billingMerged.country);

  const offerCustomer: Record<string, unknown> = {
    customerId: toShopwareUuid(params.shopwareCustomerId),
    email: email || undefined,
    firstName: (ctx.firstName || billingMerged.firstName || "").trim() || undefined,
    lastName: (ctx.lastName || billingMerged.lastName || "").trim() || undefined,
    company: (ctx.company || billingMerged.company || "").trim() || undefined,
  };
  if (customerSnap?.customerNumber) {
    offerCustomer.customerNumber = customerSnap.customerNumber;
  }

  const billingAddress = buildOfferAddressPayload(billingMerged, salutationId, countryId);
  const deliveryAddress = { ...billingAddress, id: randomUUID().replace(/-/g, "") };

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + 30);

  const pricing = await fetchProductPricing(
    client,
    params.lineItems.map((item) => toShopwareUuid(item.productId)),
    channelDefaults.currencyId
  );

  // Aggregation für die Offer-Gesamtpreise (taxStatus = "net")
  let positionNet = 0;
  const taxByRate = new Map<number, number>();

  const itemsPayload = params.lineItems.map((item) => {
    const productId = toShopwareUuid(item.productId);
    const price = pricing.get(productId);
    const net = price?.net ?? 0;
    const taxRate = price?.taxRate ?? 0;
    const quantity = item.quantity;

    const calc = buildCalculatedItemPrice(net, quantity, taxRate);
    positionNet = round2(positionNet + calc.totalPrice);
    const taxAmount = calc.calculatedTaxes[0].tax;
    taxByRate.set(taxRate, round2((taxByRate.get(taxRate) ?? 0) + taxAmount));

    const row: Record<string, unknown> = {
      productId,
      quantity,
      type: item.type || "product",
      label: price?.name || undefined,
      unitPrice: calc.unitPrice,
      totalPrice: calc.totalPrice,
      price: calc,
      priceDefinition: buildQuantityPriceDefinition(net, quantity, taxRate),
    };
    if (item.payload && Object.keys(item.payload).length > 0) {
      row.payload = item.payload;
    }
    return row;
  });

  const calculatedTaxes = Array.from(taxByRate.entries()).map(([taxRate, tax]) => ({
    tax,
    taxRate,
    price: positionNet,
  }));
  const taxRules = Array.from(taxByRate.keys()).map((taxRate) => ({ taxRate, percentage: 100 }));
  const totalTax = Array.from(taxByRate.values()).reduce((sum, t) => round2(sum + t), 0);
  const dominantTaxRate = taxRules[0]?.taxRate ?? 0;

  const offerPrice = {
    netPrice: positionNet,
    totalPrice: round2(positionNet + totalTax),
    positionPrice: positionNet,
    rawTotal: positionNet,
    calculatedTaxes:
      calculatedTaxes.length > 0 ? calculatedTaxes : [{ tax: 0, taxRate: 0, price: positionNet }],
    taxRules: taxRules.length > 0 ? taxRules : [{ taxRate: 0, percentage: 100 }],
    taxStatus: "net",
  };

  const shippingCosts = {
    unitPrice: 0,
    totalPrice: 0,
    quantity: 1,
    calculatedTaxes: [{ tax: 0, taxRate: dominantTaxRate, price: 0 }],
    taxRules: [{ taxRate: dominantTaxRate, percentage: 100 }],
    referencePrice: null,
    listPrice: null,
    regulationPrice: null,
  };

  const attributes: Record<string, unknown> = {
    id: randomUUID().replace(/-/g, ""),
    number: offerNumber,
    statusId,
    salesChannelId: toShopwareUuid(params.salesChannelId),
    currencyId: channelDefaults.currencyId,
    shippingMethodId: channelDefaults.shippingMethodId,
    paymentMethodId: channelDefaults.paymentMethodId,
    billingAddress,
    deliveryAddress,
    items: itemsPayload,
    price: offerPrice,
    shippingCosts,
    taxStatus: "net",
    documentDate: new Date().toISOString(),
    validUntil: validUntil.toISOString(),
  };

  if (existingOfferCustomerId) {
    attributes.offerCustomerId = existingOfferCustomerId;
  } else {
    attributes.offerCustomer = offerCustomer;
  }

  if (email) attributes.mailTo = email;

  return attributes;
}
