import { randomUUID } from "crypto";
import type { OrderAddress, ShopwareSettings } from "@shared/schema";
import { ShopwareClient } from "./shopware";
import {
  toShopwareUuid,
  searchFirst,
  readAttr,
  fetchSalutationId,
  fetchCountryId,
  mergeAddress,
  buildOfferAddressPayload,
  fetchCustomerEmail,
  fetchProductPricing,
  buildCalculatedItemPrice,
  buildQuantityPriceDefinition,
  fetchSalesChannelOfferDefaults,
  round2,
  DEFAULT_CASH_ROUNDING,
} from "./b2bOfferCreateContext";

const ORDER_NUMBER_RANGE_TYPE = process.env.SHOPWARE_ORDER_NUMBER_RANGE_TYPE || "order";

/**
 * Reserviert eine Bestellnummer aus dem Shopware Number-Range "order" (Standard-
 * Technical-Name für die Kern-Entität `order`). Fällt bei Fehlern (z. B. falscher
 * Technical-Name in einer abweichend konfigurierten Shopware-Instanz) auf eine
 * generierte Nummer zurück, damit die Erstellung nicht blockiert.
 */
async function reserveOrderNumber(client: ShopwareClient, salesChannelId: string): Promise<string> {
  try {
    return await client.reserveNumberRange(ORDER_NUMBER_RANGE_TYPE, salesChannelId);
  } catch {
    try {
      return await client.reserveNumberRange(ORDER_NUMBER_RANGE_TYPE);
    } catch (error) {
      console.warn(
        "[ShopwareOrder] Number-Range-Reservierung fehlgeschlagen, nutze Fallback-Nummer:",
        error instanceof Error ? error.message : error
      );
      return `ORD-${Date.now()}`;
    }
  }
}

/**
 * Löst die Anfangs-Status-ID einer Shopware State-Machine auf (z. B. "order.state"
 * → Status "open"). Ohne diese IDs lässt sich in Shopware keine Bestellung/Position/
 * Transaktion anlegen — die Kern-Entitäten sind zwingend an eine State-Machine
 * gebunden. Fällt auf den ersten gefundenen Status zurück, falls "open" fehlt
 * (z. B. bei individuell umbenannten State-Machines).
 */
async function resolveStateMachineStateId(
  client: ShopwareClient,
  stateMachineTechnicalName: string,
  preferredTechnicalName = "open"
): Promise<string> {
  const rows = await client.searchEntity("state-machine-state", {
    limit: 50,
    filter: [{ type: "equals", field: "stateMachine.technicalName", value: stateMachineTechnicalName }],
  });
  const list: any[] = rows?.data ?? [];
  const preferred = list.find((r) => readAttr(r, "technicalName") === preferredTechnicalName);
  const id = preferred?.id ?? list[0]?.id;
  if (!id) {
    throw new Error(
      `Kein Status für State-Machine "${stateMachineTechnicalName}" in Shopware gefunden.`
    );
  }
  return String(id);
}

async function fetchCurrencyFactor(client: ShopwareClient, currencyId: string): Promise<number> {
  const row = await searchFirst(client, "currency", {
    limit: 1,
    filter: [{ type: "equals", field: "id", value: currencyId }],
  });
  const factor = Number(readAttr(row, "factor"));
  return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

export type OrderCustomerContext = {
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  phoneNumber?: string;
  billingAddress?: Partial<OrderAddress>;
  shippingAddress?: Partial<OrderAddress>;
};

export type OrderLineItemInput = {
  productId: string;
  quantity: number;
  productNumber?: string;
};

/**
 * Baut die vollständige Shopware-Schreib-Payload für die Kern-Entität `order`
 * (Admin API `POST /api/order`) — inklusive Kunde, Adressen, Positionen mit
 * Preis/Steuer-Berechnung, Lieferung und Zahlung samt der dafür zwingend
 * erforderlichen State-Machine-Status. Anders als das B2B-Sellers-Suite-Angebot
 * (eine Plugin-Entität mit lockererem Schema) verlangt die Shopware-Kern-Bestellung
 * zwingend orderCustomer + addresses[] + deliveries[] + transactions[] mit
 * jeweils gültigen State-IDs, sonst schlägt die Erstellung fehl oder erzeugt eine
 * im Adminbereich nicht bearbeitbare Bestellung.
 */
export async function buildOrderCreateAttributes(
  settings: ShopwareSettings,
  params: {
    shopwareCustomerId: string;
    salesChannelId: string;
    lineItems: OrderLineItemInput[];
    customerContext?: OrderCustomerContext;
    customerComment?: string;
  }
): Promise<Record<string, unknown>> {
  const client = new ShopwareClient(settings);

  const [
    channelDefaults,
    salutationId,
    customerSnap,
    orderNumber,
    orderStateId,
    deliveryStateId,
    transactionStateId,
  ] = await Promise.all([
    fetchSalesChannelOfferDefaults(client, params.salesChannelId),
    fetchSalutationId(client),
    client.fetchCustomerBillingForPdf(params.shopwareCustomerId),
    reserveOrderNumber(client, params.salesChannelId),
    resolveStateMachineStateId(client, "order.state"),
    resolveStateMachineStateId(client, "order_delivery.state"),
    resolveStateMachineStateId(client, "order_transaction.state"),
  ]);

  const ctx = params.customerContext ?? {};
  const billingMerged = mergeAddress(ctx.billingAddress, customerSnap?.billingAddress);
  const shippingMerged = mergeAddress(ctx.shippingAddress, billingMerged);
  const email = (ctx.email || "").trim() || (await fetchCustomerEmail(client, params.shopwareCustomerId));

  const [billingCountryId, shippingCountryId, currencyFactor] = await Promise.all([
    fetchCountryId(client, billingMerged.country),
    fetchCountryId(client, shippingMerged.country),
    fetchCurrencyFactor(client, channelDefaults.currencyId),
  ]);

  const orderCustomer: Record<string, unknown> = {
    customerId: toShopwareUuid(params.shopwareCustomerId),
    email: email || undefined,
    firstName: (ctx.firstName || billingMerged.firstName || "").trim() || undefined,
    lastName: (ctx.lastName || billingMerged.lastName || "").trim() || undefined,
    company: (ctx.company || billingMerged.company || "").trim() || undefined,
    salutationId,
  };
  if (customerSnap?.customerNumber) {
    orderCustomer.customerNumber = customerSnap.customerNumber;
  }

  const billingAddress = buildOfferAddressPayload(billingMerged, salutationId, billingCountryId);
  const shippingAddress = buildOfferAddressPayload(shippingMerged, salutationId, shippingCountryId);

  const productIds = params.lineItems.map((item) => toShopwareUuid(item.productId));
  const pricing = await fetchProductPricing(client, productIds, channelDefaults.currencyId);

  let positionNet = 0;
  const taxByRate = new Map<number, number>();

  const lineItemsPayload = params.lineItems.map((item, index) => {
    const productId = toShopwareUuid(item.productId);
    const price = pricing.get(productId);
    const net = price?.net ?? 0;
    const taxRate = price?.taxRate ?? 0;
    const quantity = item.quantity;

    const calc = buildCalculatedItemPrice(net, quantity, taxRate);
    positionNet = round2(positionNet + calc.totalPrice);
    const taxAmount = calc.calculatedTaxes[0].tax;
    taxByRate.set(taxRate, round2((taxByRate.get(taxRate) ?? 0) + taxAmount));

    return {
      identifier: productId,
      productId,
      referencedId: productId,
      type: "product",
      label: price?.name || item.productNumber || undefined,
      quantity,
      position: index + 1,
      payload: item.productNumber ? { productNumber: item.productNumber } : undefined,
      price: calc,
      priceDefinition: buildQuantityPriceDefinition(net, quantity, taxRate),
    };
  });

  const calculatedTaxes = Array.from(taxByRate.entries()).map(([taxRate, tax]) => ({
    tax,
    taxRate,
    price: positionNet,
  }));
  const taxRules = Array.from(taxByRate.keys()).map((taxRate) => ({ taxRate, percentage: 100 }));
  const totalTax = Array.from(taxByRate.values()).reduce((sum, t) => round2(sum + t), 0);
  const dominantTaxRate = taxRules[0]?.taxRate ?? 0;

  const orderPrice = {
    netPrice: positionNet,
    totalPrice: round2(positionNet + totalTax),
    positionPrice: positionNet,
    rawTotal: positionNet,
    calculatedTaxes: calculatedTaxes.length > 0 ? calculatedTaxes : [{ tax: 0, taxRate: 0, price: positionNet }],
    taxRules: taxRules.length > 0 ? taxRules : [{ taxRate: 0, percentage: 100 }],
    taxStatus: "net",
  };

  const zeroShippingCosts = {
    unitPrice: 0,
    totalPrice: 0,
    quantity: 1,
    calculatedTaxes: [{ tax: 0, taxRate: dominantTaxRate, price: 0 }],
    taxRules: [{ taxRate: dominantTaxRate, percentage: 100 }],
  };

  const now = new Date().toISOString();
  const orderId = randomUUID().replace(/-/g, "");

  const attributes: Record<string, unknown> = {
    id: orderId,
    orderNumber,
    billingAddressId: billingAddress.id,
    currencyId: channelDefaults.currencyId,
    currencyFactor,
    salesChannelId: toShopwareUuid(params.salesChannelId),
    stateId: orderStateId,
    orderDateTime: now,
    orderCustomer,
    addresses: [billingAddress, shippingAddress],
    price: orderPrice,
    itemRounding: DEFAULT_CASH_ROUNDING,
    totalRounding: DEFAULT_CASH_ROUNDING,
    shippingCosts: zeroShippingCosts,
    lineItems: lineItemsPayload,
    deliveries: [
      {
        stateId: deliveryStateId,
        shippingMethodId: channelDefaults.shippingMethodId,
        shippingOrderAddress: shippingAddress,
        shippingDateEarliest: now,
        shippingDateLatest: now,
        shippingCosts: zeroShippingCosts,
      },
    ],
    transactions: [
      {
        paymentMethodId: channelDefaults.paymentMethodId,
        amount: {
          unitPrice: orderPrice.totalPrice,
          totalPrice: orderPrice.totalPrice,
          quantity: 1,
          calculatedTaxes: orderPrice.calculatedTaxes,
          taxRules: orderPrice.taxRules,
        },
        stateId: transactionStateId,
      },
    ],
  };

  if (params.customerComment && params.customerComment.trim()) {
    attributes.customerComment = params.customerComment.trim();
  }

  return attributes;
}
