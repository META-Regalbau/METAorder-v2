// Shopware: Bestellungen lesen/anlegen, Status-Mapping, Rechnungsinfos, Fingerprints, Auswertungsdaten.
import type { ShopwareClient } from "../shopware";
import type { OrderStatus, PaymentStatus, Order, OrderItem } from "@shared/schema";
import { normalizeOrderDocumentType, isProformaOrVorkasse, extractShopwareOrderCustomerNumber, getLatestDelivery, readEntityTechnicalName, toShopwareUuid, deliveryShippingFacts, deliveryIdsNeedingShippedDate, deriveShippingInfo, type DeliveryShippingFacts } from "./mapping";
import { productCache } from "../../products/productCache";
import { logger } from "../../lib/logger";

const moduleLog = logger.child({ component: "shopware/client/orders" });

export function mapShopwareStatus(this: ShopwareClient, shopwareStatus: string): OrderStatus {
  const statusMap: Record<string, OrderStatus> = {
    'open': 'open',
    'in_progress': 'in_progress',
    'done': 'completed',
    'completed': 'completed',
    'cancelled': 'cancelled',
  };
  return statusMap[shopwareStatus] || 'open';
}

export function mapPaymentStatus(this: ShopwareClient, shopwarePaymentStatus: string): PaymentStatus {
  const paymentStatusMap: Record<string, PaymentStatus> = {
    'open': 'open',
    'in_progress': 'open',
    // Shopware 6: Kreditkarte / Rechnung / BNPL vor Capture
    'authorized': 'authorized',
    'paid': 'paid',
    'paid_partially': 'partially_paid',
    'partially_paid': 'partially_paid',
    'refunded': 'refunded',
    'refunded_partially': 'partially_paid',
    'partially_refunded': 'partially_paid',
    'cancelled': 'cancelled',
    'reminded': 'reminded',
    'failed': 'failed',
  };
  return paymentStatusMap[shopwarePaymentStatus] || 'open';
}

/**
 * Extract invoice creation date (Invoice created at) from order documents.
 * Supports both direct documents array and JSON:API relationships + included.
 */
export function extractInvoiceDateFromDocuments(
  this: ShopwareClient,
  shopwareOrder: any,
  includedMap?: Map<string, any>
): string | undefined {
  const getDocType = (doc: any): string | undefined => {
    if (doc.documentType?.technicalName) return doc.documentType.technicalName;
    if (doc.documentType?.attributes?.technicalName) return doc.documentType.attributes.technicalName;
    const typeId = doc.documentTypeId ?? doc.attributes?.documentTypeId ?? doc.relationships?.documentType?.data?.id;
    if (typeId && includedMap) {
      const dt = includedMap.get(`document_type-${typeId}`);
      return dt?.technicalName ?? dt?.attributes?.technicalName;
    }
    return undefined;
  };
  const getCreatedAt = (doc: any): string | undefined =>
    doc.createdAt ?? doc.attributes?.createdAt;

  // Primary: direct documents array
  const directDocs = shopwareOrder.documents || [];
  for (const doc of directDocs) {
    if (normalizeOrderDocumentType(getDocType(doc) ?? '') === 'invoice') {
      const createdAt = getCreatedAt(doc);
      if (createdAt) return createdAt;
    }
  }

  // Fallback: resolve from relationships + included (JSON:API can return array or single object)
  const docRefsRaw = shopwareOrder.relationships?.documents?.data;
  const docRefs = Array.isArray(docRefsRaw) ? docRefsRaw : docRefsRaw ? [docRefsRaw] : [];
  if (docRefs.length > 0 && includedMap) {
    for (const ref of docRefs) {
      const doc = includedMap.get(`document-${ref.id}`);
      if (!doc) continue;
      if (normalizeOrderDocumentType(getDocType(doc) ?? '') === 'invoice') {
        const createdAt = getCreatedAt(doc);
        if (createdAt) return createdAt;
      }
    }
  }

  return undefined;
}

/**
 * Ermittelt fuer die Bestelluebersicht, ob echte Rechnungsdokumente existieren
 * und ob sie verschickt wurden. Proforma-/Vorkasse-Rechnungen (Nummern VKRE/PF)
 * werden ausgeschlossen. invoiceSent ist nur true, wenn ALLE Rechnungen verschickt
 * sind (sent=true) – so faellt eine nicht verschickte (z. B. SAP-Import) sofort auf.
 */
export function extractInvoiceInfoFromDocuments(
  this: ShopwareClient,
  shopwareOrder: any,
  includedMap?: Map<string, any>
): { hasInvoice: boolean; count: number; sent: boolean } {
  const getDocType = (doc: any): string | undefined => {
    if (doc.documentType?.technicalName) return doc.documentType.technicalName;
    if (doc.documentType?.attributes?.technicalName) return doc.documentType.attributes.technicalName;
    const typeId = doc.documentTypeId ?? doc.attributes?.documentTypeId ?? doc.relationships?.documentType?.data?.id;
    if (typeId && includedMap) {
      const dt = includedMap.get(`document_type-${typeId}`);
      return dt?.technicalName ?? dt?.attributes?.technicalName;
    }
    return undefined;
  };
  const getNumber = (doc: any): string | undefined => doc.documentNumber ?? doc.attributes?.documentNumber;
  const getSent = (doc: any): boolean => Boolean(doc.sent ?? doc.attributes?.sent ?? false);

  const collected: boolean[] = []; // pro echter Rechnung: sent?
  const consider = (doc: any) => {
    if (normalizeOrderDocumentType(getDocType(doc) ?? '') !== 'invoice') return;
    const number = getNumber(doc);
    // Proforma-/Vorkasse-Rechnungen sind keine "echten" Rechnungen
    if (number && isProformaOrVorkasse(String(number))) return;
    collected.push(getSent(doc));
  };

  const directDocs = shopwareOrder.documents || [];
  for (const doc of directDocs) consider(doc);

  if (collected.length === 0) {
    const docRefsRaw = shopwareOrder.relationships?.documents?.data;
    const docRefs = Array.isArray(docRefsRaw) ? docRefsRaw : docRefsRaw ? [docRefsRaw] : [];
    if (docRefs.length > 0 && includedMap) {
      for (const ref of docRefs) {
        const doc = includedMap.get(`document-${ref.id}`);
        if (doc) consider(doc);
      }
    }
  }

  if (collected.length === 0) return { hasInvoice: false, count: 0, sent: false };
  return { hasInvoice: true, count: collected.length, sent: collected.every(Boolean) };
}

/**
 * Check if a payment is overdue (30 days after invoice creation)
 * Only for invoices with payment status 'open' or 'authorized'
 */
export function isPaymentOverdue(this: ShopwareClient, invoiceDate: string | undefined, paymentStatus: PaymentStatus): boolean {
  if (!invoiceDate) return false;
  if (paymentStatus !== 'open' && paymentStatus !== 'authorized') return false;

  const invoiceDateObj = new Date(invoiceDate);
  const now = new Date();
  const daysDiff = Math.floor((now.getTime() - invoiceDateObj.getTime()) / (1000 * 60 * 60 * 24));

  return daysDiff > 30;
}

/**
 * Fetch all orders (non-paginated, used by analytics)
 * @param salesChannelIds Optional array of sales channel IDs to filter by (server-side filtering for security)
 * @returns Array of orders (filtered if salesChannelIds provided)
 */
export async function fetchOrders(
  this: ShopwareClient,
  salesChannelIds?: string[] | null,
  options?: {
    includeInvoiceInfo?: boolean;
    updatedSince?: string | Date | null;
    /** Nur diese Bestell-IDs laden (Abgleich fehlender Spiegel-Eintraege). */
    ids?: string[] | null;
    /**
     * Mehrfach vergebene Bestellnummern nicht zusammenfassen (Bestell-Spiegel: jede Shopware-
     * Bestellung aktuell halten). Sonst bleibt je Bestellnummer nur die zuerst gelieferte.
     */
    keepDuplicateOrderNumbers?: boolean;
  },
): Promise<Order[]> {
  try {
    const limit = 500; // Fetch 500 orders per request for efficiency
    let page = 1;
    let allOrders: any[] = [];
    let allIncluded: any[] = [];
    let hasMore = true;

    // Build filter array for Shopware API
    const filters: any[] = [];

    // SECURITY: Add sales channel filter if provided
    if (salesChannelIds && salesChannelIds.length > 0) {
      filters.push({
        type: 'equalsAny',
        field: 'salesChannelId',
        value: salesChannelIds,
      });
      moduleLog.info({ salesChannelIds }, "[fetchOrders] SECURITY: Filtering by sales channels:");
    }

    // Delta-Sync: nur Bestellungen, die sich seit dem letzten Sync geaendert haben
    // (Status-/Zahlungs-Aenderung an einer aelteren Bestellung) ODER seitdem neu angelegt
    // wurden ODER deren Lieferung sich geaendert hat.
    // Neue Bestellungen haben in Shopware updatedAt = null (wird erst beim ersten
    // Update gesetzt); ein reiner updatedAt-Range-Filter uebersieht sie, solange
    // niemand etwas an ihnen aendert — deshalb zusaetzlich createdAt.
    // Tracking-Codes an der Lieferung aendern updatedAt der Bestellung nicht (IDS: 682
    // Lieferungen mit Code nach der letzten Bestell-Aenderung) — deshalb deliveries.updatedAt.
    if (options?.updatedSince) {
      const sinceIso =
        options.updatedSince instanceof Date
          ? options.updatedSince.toISOString()
          : options.updatedSince;
      filters.push({
        type: 'multi',
        operator: 'OR',
        queries: [
          { type: 'range', field: 'updatedAt', parameters: { gte: sinceIso } },
          { type: 'range', field: 'createdAt', parameters: { gte: sinceIso } },
          { type: 'range', field: 'deliveries.updatedAt', parameters: { gte: sinceIso } },
        ],
      });
    }

    if (options?.ids) {
      if (options.ids.length === 0) return [];
      filters.push({ type: 'equalsAny', field: 'id', value: options.ids });
    }

    // Fetch all orders with pagination - continue until we get no more results
    while (hasMore) {
      const requestBody: any = {
        limit: limit,
        page: page,
        sort: [
          {
            field: 'orderDate',
            order: 'DESC',
          },
          // Stabiler Zweit-Sort: orderDate ist nicht eindeutig (viele teilen
          // sich ein Datum). Ohne deterministischen Tiebreaker koennen sich
          // Seitengrenzen ueberschneiden und dieselbe Bestellung mehrfach
          // liefern. id ist eindeutig und macht die Paginierung deterministisch.
          {
            field: 'id',
            order: 'ASC',
          },
        ],
        includes: {
            order: ['id', 'orderNumber', 'orderDate', 'createdAt', 'updatedAt', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries', 'documents'],
            order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'referencedId', 'type', 'payload', 'productNumber'],
            state_machine_state: ['technicalName'],
            sales_channel: ['id', 'name'],
            order_transaction: ['stateMachineState', 'paymentMethod'],
            payment_method: ['name', 'translated'],
            order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
            order_delivery: ['id', 'shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest', 'shippingMethod', 'createdAt', 'trackingCodes', 'stateMachineState'],
            // trackingUrl: Link zur Sendungsverfolgung (Platzhalter %s)
            shipping_method: ['name', 'translated', 'trackingUrl'],
            document: ['id', 'documentTypeId', 'createdAt', 'documentNumber', 'sent'],
            document_type: ['id', 'technicalName'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {},
            stateMachineState: {},
            salesChannel: {},
            billingAddress: {},
            deliveries: {
              associations: {
                shippingOrderAddress: {},
                shippingMethod: {},
                stateMachineState: {},
              },
            },
            transactions: {
              limit: 10, // Fetch up to 10 transactions per order (usually only 1-2)
              sort: [{ field: 'createdAt', order: 'DESC' }], // Latest transaction first
              associations: {
                stateMachineState: {},
                paymentMethod: {},
              },
            },
            documents: {
              associations: {
                documentType: {},
              },
            },
          },
      };
      
      // Add sales channel filter if provided
      if (filters.length > 0) {
        requestBody.filter = filters;
      }
      
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch orders: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      // Shopware returns data and optionally included sections
      const orders = data.data || [];
      const included = data.included || [];
      
      if (orders.length === 0) {
        // No more orders to fetch
        hasMore = false;
        break;
      }
      
      allOrders = allOrders.concat(orders);
      allIncluded = allIncluded.concat(included);
      
      moduleLog.info(`Fetched page ${page}: ${orders.length} orders (total collected: ${allOrders.length})`);
      
      // Log first order number on first page for debugging
      if (page === 1 && orders.length > 0) {
        const firstOrder = orders[0];
        moduleLog.info(`First order (newest): ${firstOrder.orderNumber || firstOrder.attributes?.orderNumber || 'N/A'}`);
      }
      
      // If we got fewer results than the limit, we're done
      if (orders.length < limit) {
        hasMore = false;
      }
      
      page++;
    }

    moduleLog.info(`Total orders fetched: ${allOrders.length}`);
    
    // Shopware returns data and optionally included sections
    const orders = allOrders;
    const included = allIncluded;
    
    // Create a map of included entities by type and id for quick lookup
    const includedMap = new Map<string, any>();
    included.forEach((item: any) => {
      const key = `${item.type}-${item.id}`;
      includedMap.set(key, item);
    });

    // Step 1: Collect all unique product IDs from all orders for batch price lookup
    const productIds = new Set<string>();
    let debugItemCount = 0;
    let debugProductCount = 0;
    
    orders.forEach((shopwareOrder: any) => {
      if (shopwareOrder.lineItems) {
        shopwareOrder.lineItems.forEach((item: any) => {
          debugItemCount++;
          const productId = item.productId || item.referencedId;
          const itemType = item.type;
          
          // Debug first item structure
          if (debugProductCount === 0) {
            moduleLog.info({ id: item.id, type: itemType, productId: item.productId, referencedId: item.referencedId, label: item.label, keys: Object.keys(item) }, "[Debug] First line item structure:");
          }
          
          if (productId && itemType === 'product') {
            productIds.add(productId);
            debugProductCount++;
          }
        });
      } else if (shopwareOrder.relationships?.lineItems?.data) {
        shopwareOrder.relationships.lineItems.data.forEach((lineItemRef: any) => {
          debugItemCount++;
          const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
          const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
          const itemType = lineItem?.attributes?.type || 'product';
          
          // Debug first item structure
          if (debugProductCount === 0 && lineItem) {
            moduleLog.info({ id: lineItem.id, type: itemType, productId: lineItem.attributes?.productId, referencedId: lineItem.attributes?.referencedId, label: lineItem.attributes?.label, keys: lineItem.attributes ? Object.keys(lineItem.attributes) : [] }, "[Debug] First line item structure (from relationships):");
          }
          
          if (productId && itemType === 'product') {
            productIds.add(productId);
            debugProductCount++;
          }
        });
      }
    });
    
    moduleLog.info(`[fetchOrders] Found ${debugProductCount} product items out of ${debugItemCount} total line items`);

    // Step 2: Fetch catalog prices for all products in one batch request
    moduleLog.info(`[fetchOrders] Found ${productIds.size} unique products across all orders`);
    const catalogPrices = await this.fetchProductPricesBatch(Array.from(productIds));

    // Versandangaben: Lieferungen je Bestellung, Versanddatum versendeter Lieferungen aus der
    // Status-Historie. Faellt die Historie aus, fehlt nur das Datum - die Bestellungen kommen trotzdem.
    const deliveriesOf = (shopwareOrder: any): DeliveryShippingFacts[] => {
      const raw = Array.isArray(shopwareOrder.deliveries)
        ? shopwareOrder.deliveries
        : (shopwareOrder.relationships?.deliveries?.data ?? [])
            .map((ref: { id: string }) => includedMap.get(`order_delivery-${ref.id}`))
            .filter(Boolean);
      return raw.map((d: any) => deliveryShippingFacts(d, includedMap));
    };
    const shippedDeliveryIds = orders.flatMap((o: any) =>
      deliveryIdsNeedingShippedDate(deliveriesOf(o), o.customFields || o.attributes?.customFields),
    );
    let shippedAtByDeliveryId = new Map<string, string>();
    try {
      shippedAtByDeliveryId = await this.fetchDeliveryShippedDates(shippedDeliveryIds);
    } catch (historyError) {
      moduleLog.warn({ err: historyError }, "[fetchOrders] Versanddaten aus der Status-Historie nicht geladen:");
    }

    const mappedOrders: Order[] = orders.map((shopwareOrder: any) => {
      // Get customer data from relationships or direct inclusion
      let customerName = 'Unknown Customer';
      let customerEmail = '';
      let customerPhone = '';
      
      if (shopwareOrder.orderCustomer) {
        const customer = shopwareOrder.orderCustomer;
        customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
        customerEmail = customer.email || '';
      } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
        const customerId = shopwareOrder.relationships.orderCustomer.data.id;
        const customer = includedMap.get(`order_customer-${customerId}`);
        if (customer) {
          customerName = `${customer.attributes?.firstName || ''} ${customer.attributes?.lastName || ''}`.trim() || 'Unknown Customer';
          customerEmail = customer.attributes?.email || '';
        }
      }

      const customerNumber = extractShopwareOrderCustomerNumber(shopwareOrder, includedMap);
      
      // Get billing address
      let billingAddress = undefined;
      if (shopwareOrder.billingAddress) {
        const addr = shopwareOrder.billingAddress;
        billingAddress = {
          firstName: addr.firstName || '',
          lastName: addr.lastName || '',
          street: addr.street || '',
          zipCode: addr.zipcode || '',
          city: addr.city || '',
          country: addr.country?.name || '',
          company: addr.company,
          phoneNumber: addr.phoneNumber,
        };
        // Use billing address phone as customer phone if available
        if (addr.phoneNumber) {
          customerPhone = addr.phoneNumber;
        }
      } else if (shopwareOrder.relationships?.billingAddress?.data?.id) {
        const addrId = shopwareOrder.relationships.billingAddress.data.id;
        const addr = includedMap.get(`order_address-${addrId}`);
        if (addr?.attributes) {
          billingAddress = {
            firstName: addr.attributes.firstName || '',
            lastName: addr.attributes.lastName || '',
            street: addr.attributes.street || '',
            zipCode: addr.attributes.zipcode || '',
            city: addr.attributes.city || '',
            country: addr.attributes.country?.name || '',
            company: addr.attributes.company,
            phoneNumber: addr.attributes.phoneNumber,
          };
          if (addr.attributes.phoneNumber) {
            customerPhone = addr.attributes.phoneNumber;
          }
        }
      }
      
      // Get shipping address, delivery dates, and shipping method (letzte Lieferung, da in Shopware oft mehrere)
      let shippingAddress = undefined;
      let deliveryDateEarliest = undefined;
      let deliveryDateLatest = undefined;
      let shippingMethod: string | undefined;
      
      if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
        const delivery = getLatestDelivery(shopwareOrder.deliveries);
        
        // Extract delivery dates
        if (delivery.shippingDateEarliest) {
          deliveryDateEarliest = delivery.shippingDateEarliest;
        }
        if (delivery.shippingDateLatest) {
          deliveryDateLatest = delivery.shippingDateLatest;
        }
        
        // Extract shipping method name
        if (delivery.shippingMethod) {
          shippingMethod = delivery.shippingMethod.translated?.name || delivery.shippingMethod.name;
        }
        
        if (delivery.shippingOrderAddress) {
          const addr = delivery.shippingOrderAddress;
          shippingAddress = {
            firstName: addr.firstName || '',
            lastName: addr.lastName || '',
            street: addr.street || '',
            zipCode: addr.zipcode || '',
            city: addr.city || '',
            country: addr.country?.name || '',
            company: addr.company,
            phoneNumber: addr.phoneNumber,
          };
        }
      } else if (shopwareOrder.relationships?.deliveries?.data && shopwareOrder.relationships.deliveries.data.length > 0) {
        const deliveryRefs = shopwareOrder.relationships.deliveries.data;
        const deliveryEntities = deliveryRefs
          .map((ref: { id: string }) => includedMap.get(`order_delivery-${ref.id}`))
          .filter(Boolean);
        const delivery = getLatestDelivery(deliveryEntities);
        
        if (delivery?.attributes?.shippingDateEarliest) {
          deliveryDateEarliest = delivery.attributes.shippingDateEarliest;
        }
        if (delivery?.attributes?.shippingDateLatest) {
          deliveryDateLatest = delivery.attributes.shippingDateLatest;
        }
        
        if (delivery?.relationships?.shippingMethod?.data?.id) {
          const shippingMethodId = delivery.relationships.shippingMethod.data.id;
          const shippingMethodData = includedMap.get(`shipping_method-${shippingMethodId}`);
          if (shippingMethodData?.attributes) {
            shippingMethod = shippingMethodData.attributes.translated?.name || shippingMethodData.attributes.name;
          }
        }
        
        if (delivery?.relationships?.shippingOrderAddress?.data?.id) {
          const addrId = delivery.relationships.shippingOrderAddress.data.id;
          const addr = includedMap.get(`order_address-${addrId}`);
          if (addr?.attributes) {
            shippingAddress = {
              firstName: addr.attributes.firstName || '',
              lastName: addr.attributes.lastName || '',
              street: addr.attributes.street || '',
              zipCode: addr.attributes.zipcode || '',
              city: addr.attributes.city || '',
              country: addr.attributes.country?.name || '',
              company: addr.attributes.company,
              phoneNumber: addr.attributes.phoneNumber,
            };
          }
        }
      }

      // Get line items from relationships or direct inclusion
      let items: OrderItem[] = [];
      let lineItemsWithProductIds: Array<{ item: OrderItem; productId: string }> = [];
      
      if (shopwareOrder.lineItems) {
        items = shopwareOrder.lineItems.map((item: any, idx: number) => {
          const netPrice = item.unitPrice || 0;
          const netTotal = item.totalPrice || 0;
          const quantity = item.quantity || 1;
          // Extract tax rate first
          const taxRate = item.price?.taxRules?.[0]?.taxRate || 19;
          
          // Extract gross prices from Shopware's price structure
          // Shopware line items contain NET prices in unitPrice/totalPrice
          // The gross price is calculated by adding the tax from calculatedTaxes
          let grossPrice = netPrice;
          let grossTotal = netTotal;
          
          if (item.price && typeof item.price === 'object') {
            if (item.price.calculatedTaxes && Array.isArray(item.price.calculatedTaxes) && item.price.calculatedTaxes.length > 0) {
              // Shopware provides the exact tax amount in calculatedTaxes
              // Sum all tax entries (can be multiple for mixed rates, cross-border, etc.)
              const totalTax = item.price.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
              const unitTax = quantity > 0 ? totalTax / quantity : 0;
              
              grossPrice = netPrice + unitTax;
              grossTotal = netTotal + totalTax;
            } else {
              // Fallback: calculate from tax rate
              grossPrice = netPrice * (1 + taxRate / 100);
              grossTotal = netTotal * (1 + taxRate / 100);
            }
          }
          
          // Get product ID and look up weight from cache
          const productId = item.productId || item.referencedId;
          const itemType = item.type || 'product';
          let weight: number | undefined = undefined;
          let productNumber: string | undefined = item?.productNumber;
          const itemPayload = item?.payload || item?.attributes?.payload;
          
          if (productId && itemType === 'product') {
            const cacheStatus = productCache.getStatus();
            if (!cacheStatus.isPopulated) {
              moduleLog.info(`[Weight] Product cache not populated - skipping weight lookup for product ${productId}`);
            } else {
              const cachedProduct = productCache.getProductById(productId);
              if (cachedProduct) {
                weight = cachedProduct.weight;
                productNumber = cachedProduct.productNumber;
              } else {
                moduleLog.info(`[Weight] Product ${productId} not found in cache (cache has ${cacheStatus.productCount} products)`);
              }
            }
          }
          
          if (!productNumber && itemPayload) {
            productNumber = itemPayload.productNumber || itemPayload.product_number;
          }

          const orderItem: OrderItem = {
            id: item.id,
            name: item.label || 'Unknown Item',
            quantity,
            price: grossPrice,
            netPrice: netPrice,
            total: grossTotal,
            netTotal: netTotal,
            taxRate: taxRate,
            weight,
            productId: productId && itemType === 'product' ? String(productId) : undefined,
            productNumber,
          };

          // Track product IDs for discount calculation
          if (productId && itemType === 'product') {
            lineItemsWithProductIds.push({ item: orderItem, productId });
          }

          return orderItem;
        });
      } else if (shopwareOrder.relationships?.lineItems?.data) {
        items = shopwareOrder.relationships.lineItems.data.map((lineItemRef: any) => {
          const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
          const netPrice = lineItem?.attributes?.unitPrice || 0;
          const netTotal = lineItem?.attributes?.totalPrice || 0;
          const quantity = lineItem?.attributes?.quantity || 1;
          const taxRate = lineItem?.attributes?.price?.taxRules?.[0]?.taxRate || 19;
          
          // Extract gross prices from Shopware's price structure
          // Shopware line items contain NET prices in unitPrice/totalPrice
          let grossPrice = netPrice;
          let grossTotal = netTotal;
          
          const priceObj = lineItem?.attributes?.price;
          if (priceObj && typeof priceObj === 'object') {
            if (priceObj.calculatedTaxes && Array.isArray(priceObj.calculatedTaxes) && priceObj.calculatedTaxes.length > 0) {
              // Sum all tax entries (can be multiple for mixed rates, cross-border, etc.)
              const totalTax = priceObj.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
              const unitTax = quantity > 0 ? totalTax / quantity : 0;
              
              grossPrice = netPrice + unitTax;
              grossTotal = netTotal + totalTax;
            } else {
              // Fallback: calculate from tax rate
              grossPrice = netPrice * (1 + taxRate / 100);
              grossTotal = netTotal * (1 + taxRate / 100);
            }
          }
          
          // Get product ID and look up weight from cache
          const productId = lineItem?.attributes?.productId || lineItem?.attributes?.referencedId;
          const itemType = lineItem?.attributes?.type || 'product';
          let weight: number | undefined = undefined;
          let productNumber: string | undefined = lineItem?.attributes?.productNumber;
          const itemPayload = lineItem?.attributes?.payload;
          
          if (productId && itemType === 'product') {
            const cacheStatus = productCache.getStatus();
            if (!cacheStatus.isPopulated) {
              // Log once per order for efficiency (only first item logs)
            } else {
              const cachedProduct = productCache.getProductById(productId);
              if (cachedProduct) {
                weight = cachedProduct.weight;
                productNumber = cachedProduct.productNumber;
              }
            }
          }
          
          if (!productNumber && itemPayload) {
            productNumber = itemPayload.productNumber || itemPayload.product_number;
          }

          const orderItem: OrderItem = {
            id: lineItemRef.id,
            name: lineItem?.attributes?.label || 'Unknown Item',
            quantity,
            price: grossPrice,
            netPrice: netPrice,
            total: grossTotal,
            netTotal: netTotal,
            taxRate: taxRate,
            weight,
            productId: productId && itemType === 'product' ? String(productId) : undefined,
            productNumber,
          };

          // Track product IDs for discount calculation
          if (productId && itemType === 'product') {
            lineItemsWithProductIds.push({ item: orderItem, productId });
          }

          return orderItem;
        });
      }

      // Get status from relationships or direct inclusion
      let status: OrderStatus = 'open';
      
      if (shopwareOrder.stateMachineState?.technicalName) {
        status = this.mapShopwareStatus(shopwareOrder.stateMachineState.technicalName);
      } else if (shopwareOrder.relationships?.stateMachineState?.data?.id) {
        const stateId = shopwareOrder.relationships.stateMachineState.data.id;
        const state = includedMap.get(`state_machine_state-${stateId}`);
        if (state?.attributes?.technicalName) {
          status = this.mapShopwareStatus(state.attributes.technicalName);
        }
      }

      // Get payment status and payment method from transactions (letzte Zahlart; Transaktionen sind nach createdAt DESC sortiert)
      let paymentStatus: PaymentStatus = 'open';
      let paymentMethod: string | undefined;
      
      if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
        const latestTransaction = shopwareOrder.transactions[0]; // neueste zuerst (sort: createdAt DESC)
        if (latestTransaction.stateMachineState?.technicalName) {
          paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
        } else {
          moduleLog.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: Transaction exists but missing stateMachineState`);
        }
        
        // Extract payment method name
        if (latestTransaction.paymentMethod) {
          paymentMethod = latestTransaction.paymentMethod.translated?.name || latestTransaction.paymentMethod.name;
        }
      } else if (shopwareOrder.relationships?.transactions?.data && shopwareOrder.relationships.transactions.data.length > 0) {
        // Fallback to relationships - also use FIRST (sorted DESC)
        const latestTransactionRef = shopwareOrder.relationships.transactions.data[0];
        const transaction = includedMap.get(`order_transaction-${latestTransactionRef.id}`);
        if (transaction?.relationships?.stateMachineState?.data?.id) {
          const paymentStateId = transaction.relationships.stateMachineState.data.id;
          const paymentState = includedMap.get(`state_machine_state-${paymentStateId}`);
          if (paymentState?.attributes?.technicalName) {
            paymentStatus = this.mapPaymentStatus(paymentState.attributes.technicalName);
          }
        }
        
        // Extract payment method from relationships
        if (transaction?.relationships?.paymentMethod?.data?.id) {
          const paymentMethodId = transaction.relationships.paymentMethod.data.id;
          const paymentMethodData = includedMap.get(`payment_method-${paymentMethodId}`);
          if (paymentMethodData?.attributes) {
            paymentMethod = paymentMethodData.attributes.translated?.name || paymentMethodData.attributes.name;
          }
        }
      } else {
        // No transactions found - log warning
        moduleLog.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: No transactions found, payment status defaults to 'open'`);
      }

      // Get sales channel data
      let salesChannelId = shopwareOrder.salesChannelId || shopwareOrder.attributes?.salesChannelId || '';
      let salesChannelName = '';
      
      if (shopwareOrder.salesChannel?.name) {
        salesChannelName = shopwareOrder.salesChannel.name;
      } else if (shopwareOrder.relationships?.salesChannel?.data?.id) {
        const channelId = shopwareOrder.relationships.salesChannel.data.id;
        const channel = includedMap.get(`sales_channel-${channelId}`);
        if (channel?.attributes?.name) {
          salesChannelName = channel.attributes.name;
        }
      }

      // Extract custom fields for ERP document numbers
      const customFields = shopwareOrder.customFields || shopwareOrder.attributes?.customFields || {};
      
      // Extract gross and net total amounts from Shopware
      const grossTotal = shopwareOrder.amountTotal || shopwareOrder.attributes?.amountTotal || 0;
      const netTotal = shopwareOrder.amountNet || shopwareOrder.attributes?.amountNet || shopwareOrder.price?.netPrice || grossTotal / 1.19;

      // Calculate discount by comparing catalog prices with actual paid prices
      let discount: { amount: number; percentage: number } | undefined;
      
      // Check if we can use catalog-based discount calculation
      // Requirements:
      // 1. All line items must be products with catalog prices (no custom discounts, shipping, etc.)
      // 2. All products must have valid catalog prices available
      const totalLineItems = shopwareOrder.lineItems?.length || 
        shopwareOrder.relationships?.lineItems?.data?.length || 0;
      
      const canUseCatalogPrices = 
        lineItemsWithProductIds.length > 0 &&
        lineItemsWithProductIds.length === totalLineItems && // All items are products
        lineItemsWithProductIds.every(({ productId }) => {
          const catalogPrice = catalogPrices.get(productId);
          return catalogPrice && catalogPrice.grossPrice > 0;
        });
      
      // Debug logging for discount calculation method selection
      if (!canUseCatalogPrices && lineItemsWithProductIds.length > 0) {
        const reasons = [];
        if (lineItemsWithProductIds.length !== totalLineItems) {
          reasons.push(`mixed line items (${lineItemsWithProductIds.length} products vs ${totalLineItems} total)`);
        }
        const missingPrices = lineItemsWithProductIds.filter(({ productId }) => {
          const catalogPrice = catalogPrices.get(productId);
          return !catalogPrice || catalogPrice.grossPrice <= 0;
        });
        if (missingPrices.length > 0) {
          reasons.push(`${missingPrices.length} products without catalog prices`);
        }
        if (reasons.length > 0) {
          moduleLog.info(`[Discount] Order ${shopwareOrder.orderNumber}: Using legacy discount calculation - ${reasons.join(', ')}`);
        }
      }
      
      if (canUseCatalogPrices) {
        // Method 1: Compare catalog prices with actual paid prices for each line item
        // Only use this method if ALL products have catalog prices to avoid mixed calculations
        let totalCatalogPrice = 0;
        let totalPaidPrice = 0;
        
        lineItemsWithProductIds.forEach(({ item, productId }) => {
          const catalogPrice = catalogPrices.get(productId);
          
          if (catalogPrice && catalogPrice.grossPrice > 0) {
            // Catalog price for this line item (quantity included)
            const catalogLineTotal = catalogPrice.grossPrice * item.quantity;
            totalCatalogPrice += catalogLineTotal;
            
            // Actual paid price for this line item
            totalPaidPrice += item.total;
          }
        });
        
        // Calculate discount from catalog vs paid
        if (totalCatalogPrice > totalPaidPrice && totalCatalogPrice > 0) {
          const discountAmount = totalCatalogPrice - totalPaidPrice;
          const discountPercentage = (discountAmount / totalCatalogPrice) * 100;
          
          if (discountAmount > 0.01) { // Only add discount if it's more than 1 cent
            discount = {
              amount: discountAmount,
              percentage: Math.round(discountPercentage * 100) / 100, // Round to 2 decimals
            };
          }
        }
      } else {
        // Fallback Method 2: Use Shopware's positionPrice vs totalPrice (old method)
        // Use this when catalog prices are not available for all products
        const priceObj = shopwareOrder.price || shopwareOrder.attributes?.price;
        
        if (priceObj) {
          // Shopware stores discount in positionPrice (sum of line items before discount) vs totalPrice
          const positionPrice = priceObj.positionPrice || 0;
          const totalPrice = priceObj.totalPrice || grossTotal;
          
          if (positionPrice > totalPrice && positionPrice > 0) {
            const discountAmount = positionPrice - totalPrice;
            const discountPercentage = (discountAmount / positionPrice) * 100;
            
            if (discountAmount > 0.01) { // Only add discount if it's more than 1 cent
              discount = {
                amount: discountAmount,
                percentage: Math.round(discountPercentage * 100) / 100, // Round to 2 decimals
              };
            }
          }
        }
      }

      const order: Order = {
        id: shopwareOrder.id,
        orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
        customerNumber: customerNumber || undefined,
        customerName,
        customerEmail,
        customerPhone: customerPhone || undefined,
        orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
        updatedAt: shopwareOrder.updatedAt || shopwareOrder.attributes?.updatedAt || undefined,
        createdAt: shopwareOrder.createdAt || shopwareOrder.attributes?.createdAt || undefined,
        deliveryDateEarliest,
        deliveryDateLatest,
        totalAmount: grossTotal,
        netTotalAmount: netTotal,
        status,
        paymentStatus,
        paymentMethod,
        shippingMethod,
        salesChannelId,
        salesChannelName,
        billingAddress,
        shippingAddress,
        items,
        discount,
        customFields: shopwareOrder.customFields || undefined,
      };

      const shippingInfo = deriveShippingInfo(deliveriesOf(shopwareOrder), customFields, shippedAtByDeliveryId);
      if (shippingInfo) order.shippingInfo = shippingInfo;

      // Add ERP document numbers from custom fields
      if (customFields.custom_order_numbers_order) {
        order.erpNumber = customFields.custom_order_numbers_order;
      }
      if (customFields.custom_order_numbers_deliveryNo) {
        order.deliveryNoteNumber = customFields.custom_order_numbers_deliveryNo;
      }
      if (customFields.custom_order_numbers_invoice) {
        order.invoiceNumber = customFields.custom_order_numbers_invoice;
      }
      if (customFields.custom_order_proforma_number) {
        order.proformaNumber = customFields.custom_order_proforma_number;
      }
      if (customFields.custom_order_numbers_vorkasse) {
        order.vorkasseInvoiceNumber = customFields.custom_order_numbers_vorkasse;
      }

      // Extract invoice date from documents (Invoice created at) - supports direct and relationships+included
      order.invoiceDate = this.extractInvoiceDateFromDocuments(shopwareOrder, includedMap);

      // Rechnungsstatus fuer die Bestelluebersicht (vorhanden? verschickt?)
      const invoiceInfo = this.extractInvoiceInfoFromDocuments(shopwareOrder, includedMap);
      order.hasInvoiceDocument = invoiceInfo.hasInvoice;
      order.invoiceDocumentCount = invoiceInfo.count;
      order.invoiceSent = invoiceInfo.sent;

      // Check if payment is overdue
      order.isPaymentOverdue = this.isPaymentOverdue(order.invoiceDate, order.paymentStatus);

      return order;
    });

    // Duplikate entfernen: Die paginierte Suche kann dieselbe Bestellung
    // mehrfach liefern (Seitengrenzen-Ueberlappung -> gleiche id). Zusaetzlich
    // je Bestellnummer nur die zuerst gelieferte Bestellung: Bestellnummern sind
    // in Shopware NICHT eindeutig (Live: 31 Nummern mit 36 weiteren, eigenstaendigen
    // Bestellungen, meist doppelt angelegt). Der Bestell-Spiegel braucht alle
    // (keepDuplicateOrderNumbers), die Seiten fassen dann selbst zusammen.
    const seenIds = new Set<string>();
    const seenNumbers = new Set<string>();
    const dedupedOrders: Order[] = [];
    let duplicateCount = 0;
    for (const o of mappedOrders) {
      if (o.id && seenIds.has(o.id)) {
        duplicateCount++;
        continue;
      }
      if (o.orderNumber && seenNumbers.has(o.orderNumber) && !options?.keepDuplicateOrderNumbers) {
        duplicateCount++;
        continue;
      }
      if (o.id) seenIds.add(o.id);
      if (o.orderNumber) seenNumbers.add(o.orderNumber);
      dedupedOrders.push(o);
    }
    if (duplicateCount > 0) {
      moduleLog.info(`[fetchOrders] Removed ${duplicateCount} duplicate order(s); ${dedupedOrders.length} unique remaining`);
    }

    // Die documents-Association wird in der Listen-Query nicht zuverlaessig
    // mitgeliefert. Fuer die Bestelluebersicht laden wir die echten
    // Rechnungsdokumente daher gebatcht ueber einen separaten Endpoint nach.
    if (options?.includeInvoiceInfo && dedupedOrders.length > 0) {
      try {
        const invoiceInfo = await this.fetchInvoiceInfoByOrderIds(
          dedupedOrders.map((o) => o.id),
        );
        for (const o of dedupedOrders) {
          const info = invoiceInfo.get(o.id);
          o.hasInvoiceDocument = !!info && info.count > 0;
          o.invoiceDocumentCount = info?.count ?? 0;
          o.invoiceSent = info ? info.sent : false;
        }
      } catch (infoError) {
        moduleLog.warn({ err: infoError }, "[fetchOrders] invoice info fetch failed:");
      }
    }

    return dedupedOrders;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching orders from Shopware:");
    throw error;
  }
}

/**
 * Laedt fuer eine Menge von Bestell-IDs gebatcht die echten Rechnungsdokumente
 * (technicalName 'invoice', ohne Proforma/Vorkasse) und ob alle verschickt
 * wurden. Wird fuer die Bestelluebersicht genutzt, da die documents-Association
 * in der Listen-Query nicht zuverlaessig mitgeladen wird.
 */
export async function fetchInvoiceInfoByOrderIds(
  this: ShopwareClient,
  orderIds: string[],
): Promise<Map<string, { count: number; sent: boolean }>> {
  const result = new Map<string, { count: number; sent: boolean }>();
  const ids = Array.from(new Set((orderIds || []).filter(Boolean)));
  if (ids.length === 0) return result;

  // Alle Dokumenttypen einmalig laden (wenige Eintraege) -> id -> technicalName
  const typeNames = new Map<string, string>();
  try {
    const typesResp = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/search/document-type`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          limit: 100,
          includes: { document_type: ['id', 'technicalName'] },
        }),
      },
    );
    if (typesResp.ok) {
      const typesData = await typesResp.json();
      for (const item of typesData.data || []) {
        typeNames.set(item.id, readEntityTechnicalName(item));
      }
    }
  } catch (e) {
    moduleLog.warn({ err: e }, "[fetchInvoiceInfoByOrderIds] document-type fetch failed:");
  }

  const CHUNK = 200;
  const PAGE_LIMIT = 500;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK);
    let page = 1;
    let hasMore = true;
    while (hasMore) {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            limit: PAGE_LIMIT,
            page,
            filter: [{ type: 'equalsAny', field: 'orderId', value: chunk }],
            includes: {
              document: ['id', 'orderId', 'documentTypeId', 'documentNumber', 'sent'],
            },
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(
          `Failed to fetch invoice info: ${response.statusText} - ${errorText}`,
        );
      }

      const data = await response.json();
      const documents = data.data || [];

      for (const doc of documents) {
        const orderId =
          doc.orderId ??
          doc.attributes?.orderId ??
          doc.relationships?.order?.data?.id;
        if (!orderId) continue;

        const typeId =
          doc.documentTypeId ??
          doc.attributes?.documentTypeId ??
          doc.relationships?.documentType?.data?.id;
        const technicalName = typeId ? typeNames.get(typeId) : undefined;
        if (normalizeOrderDocumentType(technicalName ?? '') !== 'invoice') continue;

        const number = doc.documentNumber ?? doc.attributes?.documentNumber;
        if (number && isProformaOrVorkasse(String(number))) continue;

        const sent = Boolean(doc.sent ?? doc.attributes?.sent ?? false);
        const prev = result.get(orderId) ?? { count: 0, sent: true };
        result.set(orderId, { count: prev.count + 1, sent: prev.sent && sent });
      }

      hasMore = documents.length === PAGE_LIMIT;
      page++;
    }
  }

  return result;
}

export async function fetchLatestOrderMeta(this: ShopwareClient): Promise<{ id: string; orderNumber: string; updatedAt?: string; orderDate?: string } | null> {
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: 1,
        page: 1,
        sort: [{ field: 'orderDate', order: 'DESC' }],
        includes: {
          order: ['id', 'orderNumber', 'orderDate', 'updatedAt'],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch latest order meta: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    const latest = data?.data?.[0];
    if (!latest) {
      return null;
    }

    return {
      id: latest.id,
      orderNumber: latest.orderNumber || latest.attributes?.orderNumber,
      orderDate: latest.orderDate || latest.attributes?.orderDate,
      updatedAt: latest.updatedAt || latest.attributes?.updatedAt,
    };
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching latest order meta from Shopware:");
    return null;
  }
}

/**
 * Fingerprint für Bestellungen (Count + jüngste Änderung + jüngste Anlage + jüngste Lieferungs-
 * Änderung) inkl. Shop-Gesamtzahl.
 * Neue Bestellungen haben updatedAt = null und landen bei Sortierung nach updatedAt DESC
 * am Ende — deshalb zusaetzlich die juengste Anlage (createdAt DESC) einbeziehen.
 * Tracking-Codes und Lieferstatus aendern updatedAt der Bestellung nicht — deshalb zusaetzlich die
 * juengste Aenderung einer Lieferung (latestDeliveryUpdatedAt, auch fuer den Delta-Cursor).
 */
export async function fetchOrdersFingerprintDetails(
  this: ShopwareClient,
): Promise<{ fingerprint: string; total: number; latestDeliveryUpdatedAt?: string | null } | null> {
  const fp = await this.fetchEntitySearchFingerprint("order", { sortField: "updatedAt" });
  if (!fp) return null;
  const created = await this.fetchEntitySearchFingerprint("order", { sortField: "createdAt" });
  const delivery = await this.fetchEntitySearchFingerprint("order-delivery", { sortField: "updatedAt" });

  const { stableFingerprint } = await import("../../lib/contentHashCache");
  const fingerprint = stableFingerprint({
    scope: "orders",
    total: fp.total,
    latestUpdatedAt: fp.latestUpdatedAt,
    latestId: fp.latestId,
    latestCreatedId: created?.latestId ?? null,
    latestDeliveryUpdatedAt: delivery?.latestUpdatedAt ?? null,
    latestDeliveryId: delivery?.latestId ?? null,
  });
  return { fingerprint, total: fp.total, latestDeliveryUpdatedAt: delivery?.latestUpdatedAt ?? null };
}

/** Fingerprint für Bestellungen (siehe fetchOrdersFingerprintDetails). */
export async function fetchOrdersFingerprint(this: ShopwareClient): Promise<string | null> {
  const details = await this.fetchOrdersFingerprintDetails();
  return details?.fingerprint ?? null;
}

// Fetch specific orders by their IDs (for ticket sales channel filtering)
export async function fetchOrdersByIds(this: ShopwareClient, orderIds: string[]): Promise<Map<string, { id: string; salesChannelId: string }>> {
  try {
    if (orderIds.length === 0) {
      return new Map();
    }

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        limit: orderIds.length,
        filter: [
          {
            type: 'equalsAny',
            field: 'id',
            value: orderIds.join('|'), // Shopware requires pipe-delimited string
          },
        ],
        includes: {
          order: ['id', 'salesChannelId'],
        },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      moduleLog.error(`Failed to fetch orders by IDs: ${response.statusText} - ${errorText}`);
      return new Map(); // Return empty map on error to fail permissively
    }

    const data = await response.json();
    const orders = data.data || [];
    
    const orderMap = new Map<string, { id: string; salesChannelId: string }>();
    orders.forEach((order: any) => {
      if (order.id && order.salesChannelId) {
        orderMap.set(order.id, {
          id: order.id,
          salesChannelId: order.salesChannelId,
        });
      }
    });

    return orderMap;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching orders by IDs from Shopware:");
    return new Map(); // Return empty map on error to fail permissively
  }
}

/**
 * Fetch customer order history by email (lightweight version for display)
 * Returns compact order summaries: id, orderNumber, orderDate, totalAmount, status
 * @param customerEmail Customer email to search for
 * @param excludeOrderId Optional order ID to exclude (current order)
 * @param limit Maximum number of orders to return (default: 10)
 * @param salesChannelIds Optional array of sales channel IDs to filter by
 */
export async function fetchCustomerOrderHistory(
  this: ShopwareClient,
  customerEmail: string,
  excludeOrderId?: string,
  limit: number = 10,
  salesChannelIds?: string[] | null
): Promise<Array<{
  id: string;
  orderNumber: string;
  orderDate: string;
  totalAmount: number;
  status: string;
}>> {
  try {
    // SECURITY: Explicitly handle undefined - treat as an error condition
    // undefined should not occur if called correctly, but if it does, return empty results
    if (salesChannelIds === undefined) {
      moduleLog.error("[fetchCustomerOrderHistory] SECURITY: Received undefined salesChannelIds, returning empty results");
      return [];
    }

    // SECURITY: Empty array means no access - this should be caught at route level but double-check here
    if (salesChannelIds !== null && salesChannelIds.length === 0) {
      moduleLog.info("[fetchCustomerOrderHistory] SECURITY: Empty salesChannelIds array, returning empty results");
      return [];
    }

    if (!customerEmail) {
      return [];
    }

    // Build filter array
    const filters: any[] = [
      {
        type: 'equals',
        field: 'orderCustomer.email',
        value: customerEmail,
      },
    ];

    // Exclude current order if provided
    if (excludeOrderId) {
      filters.push({
        type: 'not',
        queries: [
          {
            type: 'equals',
            field: 'id',
            value: excludeOrderId,
          },
        ],
      });
    }

    // Add sales channel filter if provided
    if (salesChannelIds && salesChannelIds.length > 0) {
      filters.push({
        type: 'equalsAny',
        field: 'salesChannelId',
        value: salesChannelIds,
      });
    }

    const requestBody = {
      limit: limit,
      page: 1,
      sort: [
        {
          field: 'orderDate',
          order: 'DESC',
        },
      ],
      filter: filters,
      includes: {
        order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'stateMachineState'],
        state_machine_state: ['technicalName'],
      },
      associations: {
        stateMachineState: {},
      },
    };

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      moduleLog.error(`Failed to fetch customer order history: ${response.statusText} - ${errorText}`);
      return [];
    }

    const data = await response.json();
    const orders = data.data || [];

    moduleLog.info(`[fetchCustomerOrderHistory] Found ${orders.length} orders for customer ${customerEmail}`);

    return orders.map((order: any) => {
      const status = this.mapShopwareStatus(order.stateMachineState?.technicalName || 'open');
      return {
        id: order.id,
        orderNumber: order.orderNumber || 'N/A',
        orderDate: order.orderDate || new Date().toISOString(),
        totalAmount: order.amountTotal || 0,
        status,
      };
    });
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching customer order history from Shopware:");
    return [];
  }
}

/**
 * Fetch a single order by ID with optional sales channel access enforcement
 * Uses the same filtering logic as fetchOrders for consistency
 * @param orderId The order ID to fetch
 * @param salesChannelIds Optional array of allowed sales channel IDs (null = all access)
 * @returns The order or null if not found/access denied
 */
export async function fetchOrderById(this: ShopwareClient, orderId: string, salesChannelIds?: string[] | null): Promise<Order | null> {
  try {
    // SECURITY: Explicitly handle undefined - treat as an error condition
    // undefined should not occur if called correctly, but if it does, deny access
    if (salesChannelIds === undefined) {
      moduleLog.error("[fetchOrderById] SECURITY: Received undefined salesChannelIds, denying access");
      return null;
    }

    // Build filter array
    const filters: any[] = [
      {
        type: 'equals',
        field: 'id',
        value: orderId,
      },
    ];

    // Add sales channel filter if provided (for access control)
    // null = full access (admin), [] = no access (should be caught at route level), [...ids] = specific channels
    if (salesChannelIds !== null && salesChannelIds.length > 0) {
      filters.push({
        type: 'equalsAny',
        field: 'salesChannelId',
        value: salesChannelIds,
      });
      moduleLog.info({ salesChannelIds }, "[fetchOrderById] SECURITY: Filtering by sales channels:");
    } else if (salesChannelIds !== null && salesChannelIds.length === 0) {
      // Empty array means no access - this should be caught at route level but double-check here
      moduleLog.error("[fetchOrderById] SECURITY: Empty salesChannelIds array, denying access");
      return null;
    }

    const requestBody: any = {
      limit: 1,
      filter: filters,
      includes: {
        order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries', 'documents'],
        order_customer: ['firstName', 'lastName', 'email', 'customerNumber'],
        order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'referencedId', 'type', 'payload', 'productNumber'],
        state_machine_state: ['technicalName'],
        sales_channel: ['id', 'name'],
        order_transaction: ['stateMachineState', 'paymentMethod'],
        payment_method: ['name', 'translated'],
        order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
        order_delivery: ['shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest', 'shippingMethod'],
        shipping_method: ['name', 'translated'],
        document: ['id', 'documentTypeId', 'createdAt', 'documentNumber', 'sent'],
        document_type: ['id', 'technicalName'],
      },
      associations: {
        orderCustomer: {},
        lineItems: {},
        stateMachineState: {},
        salesChannel: {},
        billingAddress: {},
        deliveries: {
          associations: {
            shippingOrderAddress: {},
            shippingMethod: {},
          },
        },
        transactions: {
          limit: 10,
          sort: [{ field: 'createdAt', order: 'DESC' }],
          associations: {
            stateMachineState: {},
            paymentMethod: {},
          },
        },
        documents: {
          associations: {
            documentType: {},
          },
        },
      },
    };

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      moduleLog.error(`Failed to fetch order by ID: ${response.statusText} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const orders = data.data || [];
    const included = data.included || [];

    if (orders.length === 0) {
      moduleLog.info(`[fetchOrderById] Order ${orderId} not found or access denied`);
      return null;
    }

    const shopwareOrder = orders[0];
    const includedMap = new Map<string, any>();
    included.forEach((item: any) => {
      includedMap.set(`${item.type}-${item.id}`, item);
    });

    // Transform the Shopware order to our Order type (aligned with fetchOrders)
    // Get customer data
    let customerName = 'Unknown Customer';
    let customerEmail = '';
    let customerPhone = '';
    
    if (shopwareOrder.orderCustomer) {
      const customer = shopwareOrder.orderCustomer;
      customerName = `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown Customer';
      customerEmail = customer.email || '';
    } else if (shopwareOrder.relationships?.orderCustomer?.data?.id) {
      const customerId = shopwareOrder.relationships.orderCustomer.data.id;
      const customer = includedMap.get(`order_customer-${customerId}`);
      if (customer?.attributes) {
        customerName =
          `${customer.attributes.firstName || ''} ${customer.attributes.lastName || ''}`.trim() || 'Unknown Customer';
        customerEmail = customer.attributes.email || '';
      }
    }

    const customerNumber = extractShopwareOrderCustomerNumber(shopwareOrder, includedMap);

    // Get billing address
    let billingAddress = undefined;
    if (shopwareOrder.billingAddress) {
      const addr = shopwareOrder.billingAddress;
      billingAddress = {
        firstName: addr.firstName || '',
        lastName: addr.lastName || '',
        street: addr.street || '',
        zipCode: addr.zipcode || '',
        city: addr.city || '',
        country: addr.country?.name || '',
        company: addr.company,
        phoneNumber: addr.phoneNumber,
      };
      if (addr.phoneNumber) {
        customerPhone = addr.phoneNumber;
      }
    } else if (shopwareOrder.relationships?.billingAddress?.data?.id) {
      const addrId = shopwareOrder.relationships.billingAddress.data.id;
      const addr = includedMap.get(`order_address-${addrId}`);
      if (addr?.attributes) {
        billingAddress = {
          firstName: addr.attributes.firstName || '',
          lastName: addr.attributes.lastName || '',
          street: addr.attributes.street || '',
          zipCode: addr.attributes.zipcode || '',
          city: addr.attributes.city || '',
          country: addr.attributes.country?.name || '',
          company: addr.attributes.company,
          phoneNumber: addr.attributes.phoneNumber,
        };
        if (addr.attributes.phoneNumber) {
          customerPhone = addr.attributes.phoneNumber;
        }
      }
    }
    
    // Get shipping address and delivery info (letzte Lieferung, da in Shopware oft mehrere)
    let shippingAddress = undefined;
    let deliveryDateEarliest: string | undefined;
    let deliveryDateLatest: string | undefined;
    let shippingMethod: string | undefined;
    
    if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
      const delivery = getLatestDelivery(shopwareOrder.deliveries);
      if (delivery.shippingDateEarliest) deliveryDateEarliest = delivery.shippingDateEarliest;
      if (delivery.shippingDateLatest) deliveryDateLatest = delivery.shippingDateLatest;
      if (delivery.shippingMethod?.translated?.name || delivery.shippingMethod?.name) {
        shippingMethod = delivery.shippingMethod.translated?.name || delivery.shippingMethod.name;
      }
      if (delivery.shippingOrderAddress) {
        const addr = delivery.shippingOrderAddress;
        shippingAddress = {
          firstName: addr.firstName || '',
          lastName: addr.lastName || '',
          street: addr.street || '',
          zipCode: addr.zipcode || '',
          city: addr.city || '',
          country: addr.country?.name || '',
          company: addr.company,
          phoneNumber: addr.phoneNumber,
        };
      }
    }
    
    // Map line items (aligned with fetchOrders: price, netPrice, total, netTotal, taxRate)
    const mapLineItem = (item: any): OrderItem => {
      const attrs = item.attributes || item;
      const netPrice = attrs.unitPrice || 0;
      const netTotal = attrs.totalPrice || 0;
      const quantity = attrs.quantity || 1;
      const taxRate = attrs.price?.taxRules?.[0]?.taxRate || 19;
      let grossPrice = netPrice;
      let grossTotal = netTotal;
      const priceObj = attrs.price;
      if (priceObj && typeof priceObj === 'object') {
        if (priceObj.calculatedTaxes && Array.isArray(priceObj.calculatedTaxes) && priceObj.calculatedTaxes.length > 0) {
          const totalTax = priceObj.calculatedTaxes.reduce((sum: number, taxEntry: any) => sum + (taxEntry.tax || 0), 0);
          const unitTax = quantity > 0 ? totalTax / quantity : 0;
          grossPrice = netPrice + unitTax;
          grossTotal = netTotal + totalTax;
        } else {
          grossPrice = netPrice * (1 + taxRate / 100);
          grossTotal = netTotal * (1 + taxRate / 100);
        }
      }
      return {
        id: item.id || attrs.id,
        name: attrs.label || 'Unknown Product',
        quantity,
        price: grossPrice,
        netPrice,
        total: grossTotal,
        netTotal,
        taxRate,
        productId:
          (attrs.productId || attrs.referencedId) && (attrs.type || 'product') === 'product'
            ? String(attrs.productId || attrs.referencedId)
            : undefined,
        productNumber: attrs.productNumber || attrs.payload?.productNumber,
      };
    };
    let lineItemsRaw: any[] = shopwareOrder.lineItems || [];
    if (lineItemsRaw.length === 0 && shopwareOrder.relationships?.lineItems?.data) {
      const refs = Array.isArray(shopwareOrder.relationships.lineItems.data)
        ? shopwareOrder.relationships.lineItems.data
        : [shopwareOrder.relationships.lineItems.data];
      lineItemsRaw = refs.map((ref: any) =>
        includedMap.get(`order_line_item-${ref.id}`) || ref
      ).filter(Boolean);
    }
    const items: OrderItem[] = lineItemsRaw.map(mapLineItem);
    
    // Get payment method and status
    let paymentMethod: string | undefined;
    let paymentStatus = 'open';
    if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
      const transaction = shopwareOrder.transactions[0];
      if (transaction.paymentMethod?.translated?.name || transaction.paymentMethod?.name) {
        paymentMethod = transaction.paymentMethod.translated?.name || transaction.paymentMethod.name;
      }
      if (transaction.stateMachineState?.technicalName) {
        paymentStatus = this.mapPaymentStatus(transaction.stateMachineState.technicalName);
      }
    }
    
    // Get sales channel
    let salesChannelName = 'Unknown Channel';
    if (shopwareOrder.salesChannel?.name) {
      salesChannelName = shopwareOrder.salesChannel.name;
    }
    
    // Map order status
    const status = this.mapShopwareStatus(shopwareOrder.stateMachineState?.technicalName || 'open');

    // Extract ERP document numbers (custom_order_numbers_* first, fallback to meta_erp_* / jtl_*)
    const customFields = shopwareOrder.customFields || {};
    const erpOrderNumber = customFields.custom_order_numbers_order
      || customFields.meta_erp_order_number
      || customFields.jtl_order_number;
    const erpDeliveryNoteNumber = customFields.custom_order_numbers_deliveryNo
      || customFields.meta_erp_delivery_note_number;
    const erpInvoiceNumber = customFields.custom_order_numbers_invoice
      || customFields.meta_erp_invoice_number
      || customFields.jtl_invoice_number;
    const proformaNumber = customFields.custom_order_proforma_number;
    const vorkasseInvoiceNumber = customFields.custom_order_numbers_vorkasse;

    // Extract invoice date from documents (Invoice created at)
    const invoiceDate = this.extractInvoiceDateFromDocuments(shopwareOrder, includedMap);
    let invoiceInfo = this.extractInvoiceInfoFromDocuments(shopwareOrder, includedMap);
    // documents-Association liefert in Einzelabfragen oft unvollstaendig — wie in fetchOrders nachladen.
    if (!invoiceInfo.hasInvoice) {
      try {
        const batch = await this.fetchInvoiceInfoByOrderIds([shopwareOrder.id]);
        const info = batch.get(shopwareOrder.id);
        if (info && info.count > 0) {
          invoiceInfo = { hasInvoice: true, count: info.count, sent: info.sent };
        }
      } catch (fallbackErr) {
        moduleLog.warn({ err: fallbackErr }, `[fetchOrderById] invoice info fallback failed for ${shopwareOrder.id}:`);
      }
    }

    const order: Order = {
      id: shopwareOrder.id,
      orderNumber: shopwareOrder.orderNumber || 'N/A',
      customerNumber: customerNumber || undefined,
      orderDate: shopwareOrder.orderDate || new Date().toISOString(),
      customerName,
      customerEmail,
      customerPhone,
      status: status as any,
      paymentStatus: paymentStatus as any,
      paymentMethod,
      shippingMethod,
      totalAmount: shopwareOrder.amountTotal || 0,
      netTotalAmount: shopwareOrder.amountNet || 0,
      items,
      salesChannelId: shopwareOrder.salesChannelId,
      salesChannelName,
      billingAddress,
      shippingAddress,
      deliveryDateEarliest,
      deliveryDateLatest,
      erpNumber: erpOrderNumber,
      deliveryNoteNumber: erpDeliveryNoteNumber,
      invoiceNumber: erpInvoiceNumber,
      proformaNumber,
      vorkasseInvoiceNumber,
      invoiceDate,
      hasInvoiceDocument: invoiceInfo.hasInvoice,
      invoiceDocumentCount: invoiceInfo.count,
      invoiceSent: invoiceInfo.sent,
      isPaymentOverdue: this.isPaymentOverdue(invoiceDate, paymentStatus as PaymentStatus),
      customFields: shopwareOrder.customFields || undefined,
      customerComment: shopwareOrder.customerComment || undefined,
    };
    
    return order;
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching order by ID from Shopware:");
    return null;
  }
}

export async function fetchOrderByNumber(this: ShopwareClient, orderNumber: string, salesChannelIds?: string[] | null): Promise<{ id: string; orderNumber: string } | null> {
  try {
    // SECURITY: Explicitly handle undefined - treat as an error condition
    if (salesChannelIds === undefined) {
      moduleLog.error("[fetchOrderByNumber] SECURITY: Received undefined salesChannelIds, denying access");
      return null;
    }

    const normalizedOrderNumber = orderNumber?.trim();
    if (!normalizedOrderNumber) {
      return null;
    }

    const filters: any[] = [
      {
        type: 'equals',
        field: 'orderNumber',
        value: normalizedOrderNumber,
      },
    ];

    // Add sales channel filter if provided (for access control)
    // null = full access (admin), [] = no access, [...ids] = specific channels
    if (salesChannelIds !== null && salesChannelIds.length > 0) {
      filters.push({
        type: 'equalsAny',
        field: 'salesChannelId',
        value: salesChannelIds,
      });
      moduleLog.info({ salesChannelIds }, "[fetchOrderByNumber] SECURITY: Filtering by sales channels:");
    } else if (salesChannelIds !== null && salesChannelIds.length === 0) {
      moduleLog.error("[fetchOrderByNumber] SECURITY: Empty salesChannelIds array, denying access");
      return null;
    }

    const requestBody: any = {
      limit: 1,
      filter: filters,
      includes: {
        order: ['id', 'orderNumber'],
      },
    };

    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      moduleLog.error(`Failed to fetch order by order number: ${response.statusText} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const order = data.data?.[0];
    if (!order?.id) {
      return null;
    }

    return {
      id: order.id,
      orderNumber: order.orderNumber || order.attributes?.orderNumber || normalizedOrderNumber,
    };
  } catch (error) {
    moduleLog.error({ err: error }, "Error fetching order by order number from Shopware:");
    return null;
  }
}

/** Alle Bestell-IDs (fuer Loesch-Abgleich des Mirrors, siehe fetchAllProductIds). */
export async function fetchAllOrderIds(this: ShopwareClient): Promise<{ ids: string[]; total: number }> {
  const ids: string[] = [];
  const BATCH = 500;
  let page = 1;
  let total = 0;

  while (true) {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        limit: BATCH,
        page,
        "total-count-mode": 1,
        includes: { order: ["id"] },
      }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch order ids: ${response.statusText} - ${errorText}`);
    }
    const data = await response.json();
    total = Number(data?.meta?.total ?? data?.total ?? total);
    const list = data.data || [];
    for (const row of list) {
      if (row?.id) ids.push(String(row.id));
    }
    if (list.length < BATCH) break;
    page += 1;
  }
  return { ids, total: total || ids.length };
}

/**
 * Liefert alle order_customer-Snapshots eines Kontos (per customerId) inkl.
 * Order-Nummer und Verkaufskanal. Für das Umhängen beim Kunden-Merge.
 */
export async function findOrderCustomersByCustomerId(this: ShopwareClient, customerId: string): Promise<Array<{
  orderCustomerId: string;
  orderId: string | null;
  orderNumber: string | null;
  salesChannelId: string | null;
  email: string | null;
}>> {
  const id = toShopwareUuid((customerId || '').trim());
  if (!id) return [];
  try {
    const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order-customer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        limit: 500,
        filter: [{ type: 'equals', field: 'customerId', value: id }],
        associations: { order: {} },
      }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    const list = data.data || [];
    const includedMap = new Map<string, any>();
    for (const item of data.included || []) {
      if (item?.type && item?.id) includedMap.set(`${item.type}-${item.id}`, item);
    }
    return list.map((row: any) => {
      const a = row.attributes || row;
      const relId = row.relationships?.order?.data?.id;
      let order = row.order;
      if (!order && relId) order = includedMap.get(`order-${relId}`);
      const oa = order?.attributes || order || {};
      return {
        orderCustomerId: row.id,
        orderId: relId || order?.id || null,
        orderNumber: oa.orderNumber ?? null,
        salesChannelId: oa.salesChannelId ?? null,
        email: a.email ?? null,
      };
    });
  } catch (error: any) {
    moduleLog.error({ err: error }, "[Shopware] findOrderCustomersByCustomerId error:");
    return [];
  }
}

/**
 * Hängt einen order_customer-Snapshot auf einen anderen Kunden um.
 * Wirft bei Fehler (für saubere Fehlerbehandlung im Merge).
 */
export async function reassignOrderCustomer(
  this: ShopwareClient,
  orderCustomerId: string,
  target: { customerId: string; customerNumber?: string | null; email?: string | null; firstName?: string | null; lastName?: string | null },
): Promise<boolean> {
  const ocId = (orderCustomerId || '').trim();
  if (!ocId) throw new Error('orderCustomerId is required');
  const payload: Record<string, any> = { customerId: toShopwareUuid(target.customerId) };
  if (target.customerNumber) payload.customerNumber = target.customerNumber;
  if (target.email) payload.email = target.email;
  if (target.firstName) payload.firstName = target.firstName;
  if (target.lastName) payload.lastName = target.lastName;

  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/order-customer/${ocId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const err = await response.text().catch(() => '');
    throw new Error(`reassignOrderCustomer ${ocId} failed: ${response.status} ${err}`);
  }
  return true;
}

/**
 * Legt eine echte Shopware-Kern-Bestellung an (Admin API `POST /api/order`).
 * `attributes` muss eine vollständige, bereits aufgelöste Payload sein (Kunde,
 * Adressen, Positionen mit Preis/Steuer, Lieferung, Zahlung, State-IDs — siehe
 * `buildOrderCreateAttributes` in server/shopware/shopwareOrderCreateContext.ts). Diese
 * Methode selbst löst keine IDs auf, sie schreibt nur und behandelt Shopwares
 * 204-No-Content-Antwort (ID kommt dann nur aus der eigenen Payload oder dem
 * Location-Header, nicht aus einem JSON-Body).
 */
export async function createOrder(this: ShopwareClient, attributes: Record<string, unknown>): Promise<{ id: string }> {
  const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(attributes),
  });

  if (!response.ok) {
    const errorText = await response.text();
    const { formatShopwareWriteError } = await import("../../b2b/b2bOfferCreateContext");
    throw new Error(`Bestellung konnte nicht in Shopware angelegt werden: ${formatShopwareWriteError(errorText)}`);
  }

  const locationHeader = response.headers.get("location") || response.headers.get("Location");
  const locationId = locationHeader?.split("/").filter(Boolean).pop();
  const rawBody = await response.text();
  let result: any = {};
  if (rawBody.trim()) {
    try {
      result = JSON.parse(rawBody);
    } catch {
      /* Shopware liefert bei Erfolg oft 204 ohne JSON-Body */
    }
  }
  const created = result.data || result;
  const id = created?.id || (typeof attributes.id === "string" ? attributes.id : undefined) || locationId;
  if (!id) {
    throw new Error("Bestellung wurde angelegt, aber keine ID zurückgegeben");
  }
  return { id: String(id) };
}

export async function markOrderPaid(this: ShopwareClient, orderId: string): Promise<void> {
  try {
    const response = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/order/${orderId}?associations[transactions][]=stateMachineState`,
      { method: "GET" }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch order for payment update: ${response.statusText} - ${errorText}`);
    }

    const orderData = await response.json();
    const transactions =
      orderData.data?.transactions ||
      orderData.data?.relationships?.transactions?.data ||
      [];

    const firstTransaction = Array.isArray(transactions) ? transactions[0] : null;
    const transactionId =
      firstTransaction?.id ||
      firstTransaction?.data?.id ||
      null;

    if (!transactionId) {
      throw new Error("Order has no transaction to update");
    }

    const stateResponse = await this.makeAuthenticatedRequest(
      `${this.baseUrl}/api/_action/order_transaction/${transactionId}/state/paid`,
      { method: "POST", body: JSON.stringify({}) }
    );

    if (!stateResponse.ok) {
      const errorText = await stateResponse.text();
      throw new Error(`Failed to mark order paid: ${stateResponse.statusText} - ${errorText}`);
    }
  } catch (error) {
    moduleLog.error({ err: error }, "Error marking order as paid:");
    throw error;
  }
}

export async function getOrderVersionId(this: ShopwareClient, orderId: string): Promise<string | null> {
  const res = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filter: [{ type: "equals", field: "id", value: orderId }],
      limit: 1,
    }),
  });
  if (!res.ok) return null;
  const data = await res.json();
  const order = data?.data?.[0];
  if (!order) return null;
  return order.versionId ?? order.attributes?.versionId ?? null;
}
