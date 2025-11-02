import type { Order, OrderStatus, PaymentStatus, OrderItem, ShopwareSettings, SalesChannel, Product, ProductPriceRule, CrossSellingGroup, CrossSellingProduct } from "@shared/schema";

export class ShopwareClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;
  private tokenExpiry: number = 0;

  constructor(settings: ShopwareSettings) {
    this.baseUrl = settings.shopwareUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = settings.apiKey;
    this.apiSecret = settings.apiSecret;
  }

  private async authenticate(): Promise<string> {
    // Check if we have a valid cached token
    if (this.accessToken && Date.now() < this.tokenExpiry) {
      return this.accessToken;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/oauth/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          grant_type: 'client_credentials',
          client_id: this.apiKey,
          client_secret: this.apiSecret,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Authentication failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      // Set expiry time (default to 10 minutes if not provided, with 1 minute buffer)
      const expiresIn = data.expires_in || 600;
      this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
      return this.accessToken as string;
    } catch (error) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      console.error('Shopware authentication error:', error);
      throw new Error('Failed to authenticate with Shopware API');
    }
  }

  private async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    let token = await this.authenticate();

    // Ensure JSON headers are preserved
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
      'Authorization': `Bearer ${token}`,
    };

    const response = await fetch(url, {
      ...options,
      headers,
    });

    // If we get a 401, token might have expired - try once more with fresh token
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      token = await this.authenticate();
      
      const retryHeaders = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      };
      
      return await fetch(url, {
        ...options,
        headers: retryHeaders,
      });
    }

    return response;
  }

  async testConnection(): Promise<boolean> {
    try {
      // Test connection by fetching a lightweight endpoint
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/_info/config`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      return response.ok;
    } catch (error) {
      console.error('Connection test failed:', error);
      return false;
    }
  }

  async fetchSalesChannels(): Promise<SalesChannel[]> {
    try {
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/sales-channel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 100,
          filter: [
            {
              type: 'equals',
              field: 'active',
              value: true,
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch sales channels: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const channels = data.data || [];

      return channels.map((channel: any) => ({
        id: channel.id,
        name: channel.name || channel.attributes?.name || 'Unknown Channel',
        active: channel.active !== undefined ? channel.active : (channel.attributes?.active || true),
      }));
    } catch (error) {
      console.error('Error fetching sales channels from Shopware:', error);
      throw error;
    }
  }

  private mapShopwareStatus(shopwareStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      'open': 'open',
      'in_progress': 'in_progress',
      'done': 'completed',
      'completed': 'completed',
      'cancelled': 'cancelled',
    };
    return statusMap[shopwareStatus] || 'open';
  }

  private mapPaymentStatus(shopwarePaymentStatus: string): PaymentStatus {
    const paymentStatusMap: Record<string, PaymentStatus> = {
      'open': 'open',
      'in_progress': 'open',
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

  async fetchOrders(): Promise<Order[]> {
    try {
      const limit = 500; // Fetch 500 orders per request for efficiency
      let page = 1;
      let allOrders: any[] = [];
      let allIncluded: any[] = [];
      let hasMore = true;

      // Fetch all orders with pagination - continue until we get no more results
      while (hasMore) {
        const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            limit: limit,
            page: page,
            sort: [
              {
                field: 'orderDate',
                order: 'DESC',
              },
            ],
            includes: {
              order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price', 'billingAddress', 'deliveries'],
              order_customer: ['firstName', 'lastName', 'email'],
              order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price'],
              state_machine_state: ['technicalName'],
              sales_channel: ['id', 'name'],
              order_transaction: ['stateMachineState'],
              order_address: ['firstName', 'lastName', 'street', 'zipcode', 'city', 'country', 'company', 'phoneNumber'],
              order_delivery: ['shippingOrderAddress', 'shippingDateEarliest', 'shippingDateLatest'],
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
                },
              },
              transactions: {
                limit: 10, // Fetch up to 10 transactions per order (usually only 1-2)
                sort: [{ field: 'createdAt', order: 'DESC' }], // Latest transaction first
                associations: {
                  stateMachineState: {},
                },
              },
            },
          }),
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
        
        console.log(`Fetched page ${page}: ${orders.length} orders (total collected: ${allOrders.length})`);
        
        // Log first order number on first page for debugging
        if (page === 1 && orders.length > 0) {
          const firstOrder = orders[0];
          console.log(`First order (newest): ${firstOrder.orderNumber || firstOrder.attributes?.orderNumber || 'N/A'}`);
        }
        
        // If we got fewer results than the limit, we're done
        if (orders.length < limit) {
          hasMore = false;
        }
        
        page++;
      }

      console.log(`Total orders fetched: ${allOrders.length}`);
      
      // Shopware returns data and optionally included sections
      const orders = allOrders;
      const included = allIncluded;
      
      // Create a map of included entities by type and id for quick lookup
      const includedMap = new Map<string, any>();
      included.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      return orders.map((shopwareOrder: any) => {
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
        
        // Get shipping address and delivery dates
        let shippingAddress = undefined;
        let deliveryDateEarliest = undefined;
        let deliveryDateLatest = undefined;
        
        if (shopwareOrder.deliveries && shopwareOrder.deliveries.length > 0) {
          const delivery = shopwareOrder.deliveries[0];
          
          // Extract delivery dates
          if (delivery.shippingDateEarliest) {
            deliveryDateEarliest = delivery.shippingDateEarliest;
          }
          if (delivery.shippingDateLatest) {
            deliveryDateLatest = delivery.shippingDateLatest;
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
          const deliveryId = shopwareOrder.relationships.deliveries.data[0].id;
          const delivery = includedMap.get(`order_delivery-${deliveryId}`);
          
          // Extract delivery dates from relationship
          if (delivery?.attributes?.shippingDateEarliest) {
            deliveryDateEarliest = delivery.attributes.shippingDateEarliest;
          }
          if (delivery?.attributes?.shippingDateLatest) {
            deliveryDateLatest = delivery.attributes.shippingDateLatest;
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
            
            return {
              id: item.id,
              name: item.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
            };
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
            
            return {
              id: lineItemRef.id,
              name: lineItem?.attributes?.label || 'Unknown Item',
              quantity,
              price: grossPrice,
              netPrice: netPrice,
              total: grossTotal,
              netTotal: netTotal,
              taxRate: taxRate,
            };
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

        // Get payment status from transactions (latest transaction)
        let paymentStatus: PaymentStatus = 'open';
        
        if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
          // Use the FIRST transaction (most recent, sorted by createdAt DESC)
          const latestTransaction = shopwareOrder.transactions[0];
          if (latestTransaction.stateMachineState?.technicalName) {
            paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
          } else {
            console.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: Transaction exists but missing stateMachineState`);
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
        } else {
          // No transactions found - log warning
          console.warn(`Order ${shopwareOrder.orderNumber || shopwareOrder.id}: No transactions found, payment status defaults to 'open'`);
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

        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
          customerName,
          customerEmail,
          customerPhone: customerPhone || undefined,
          orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
          deliveryDateEarliest,
          deliveryDateLatest,
          totalAmount: grossTotal,
          netTotalAmount: netTotal,
          status,
          paymentStatus,
          salesChannelId,
          salesChannelName,
          billingAddress,
          shippingAddress,
          items,
        };

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

        return order;
      });
    } catch (error) {
      console.error('Error fetching orders from Shopware:', error);
      throw error;
    }
  }

  // Fetch specific orders by their IDs (for ticket sales channel filtering)
  async fetchOrdersByIds(orderIds: string[]): Promise<Map<string, { id: string; salesChannelId: string }>> {
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
        console.error(`Failed to fetch orders by IDs: ${response.statusText} - ${errorText}`);
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
      console.error('Error fetching orders by IDs from Shopware:', error);
      return new Map(); // Return empty map on error to fail permissively
    }
  }

  async downloadDocumentPdf(documentId: string, deepLinkCode: string): Promise<Blob> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/pdf',
          },
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to download document: ${response.statusText} - ${errorText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Error downloading document from Shopware:', error);
      throw error;
    }
  }

  async fetchOrderDocuments(orderId: string): Promise<Array<{id: string, type: string, number: string, deepLinkCode: string}>> {
    try {
      // Get all documents for this order - remove includes to get full data
      const docsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'orderId',
                value: orderId,
              },
            ],
            associations: {
              documentType: {},
            },
          }),
        }
      );

      if (!docsResponse.ok) {
        const errorText = await docsResponse.text();
        throw new Error(`Failed to retrieve documents: ${docsResponse.statusText} - ${errorText}`);
      }

      const docsData = await docsResponse.json();
      
      // Save full response to a file for debugging
      const fs = await import('fs');
      await fs.promises.writeFile('/tmp/shopware_docs_response.json', JSON.stringify(docsData, null, 2));
      console.log('Saved full response to /tmp/shopware_docs_response.json');
      
      const documents = docsData.data || [];
      
      // Build a map of document types from the included section
      const documentTypes = new Map();
      if (docsData.included) {
        for (const item of docsData.included) {
          if (item.type === 'document_type') {
            documentTypes.set(item.id, item.attributes?.technicalName || 'unknown');
          }
        }
      }

      return documents.map((doc: any) => {
        // Extract document number and deep link code from root level (Shopware 6 API)
        const docNumber = doc.documentNumber || doc.attributes?.documentNumber || '';
        // deepLinkCode is directly on the root object in Shopware 6
        const deepLink = doc.deepLinkCode || '';
        
        // Get document type from the included data or from relationships or from document number
        let docType = 'unknown';
        const docTypeId = doc.relationships?.documentType?.data?.id;
        if (docTypeId && documentTypes.has(docTypeId)) {
          docType = documentTypes.get(docTypeId);
        } else if (docNumber) {
          // Fallback: determine type from document number prefix
          if (docNumber.startsWith('RE-')) {
            docType = 'invoice';
          } else if (docNumber.startsWith('LS-')) {
            docType = 'delivery_note';
          } else if (docNumber.startsWith('GS-')) {
            docType = 'credit_note';
          } else if (docNumber.startsWith('ST-')) {
            docType = 'cancellation';
          }
        }

        return {
          id: doc.id,
          type: docType,
          number: docNumber,
          deepLinkCode: deepLink,
        };
      });
    } catch (error) {
      console.error('Error fetching documents from Shopware:', error);
      throw error;
    }
  }

  async downloadInvoicePdf(orderId: string): Promise<Blob> {
    try {
      // Step 1: Get existing invoice documents for this order
      const docsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/document`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'orderId',
                value: orderId,
              },
              {
                type: 'equals',
                field: 'documentType.technicalName',
                value: 'invoice',
              },
            ],
            limit: 1,
            associations: {
              documentMediaFile: {},
            },
          }),
        }
      );

      if (!docsResponse.ok) {
        const errorText = await docsResponse.text();
        throw new Error(`Failed to retrieve invoice document: ${docsResponse.statusText} - ${errorText}`);
      }

      const docsData = await docsResponse.json();
      if (!docsData.data || docsData.data.length === 0) {
        throw new Error('No invoice document found for this order. Please generate the invoice in Shopware first.');
      }

      const document = docsData.data[0];
      
      const documentId = document.id;
      // The deepLinkCode is in the extensions.foreignKeys object
      const foreignKeys = document.extensions?.foreignKeys;
      const deepLinkCode = foreignKeys?.deepLinkCode;

      console.log('Document ID:', documentId);
      console.log('Deep Link Code:', deepLinkCode);
      console.log('Foreign Keys object:', JSON.stringify(foreignKeys, null, 2));

      if (!documentId || !deepLinkCode) {
        console.error('Missing document fields - documentId:', documentId, 'deepLinkCode:', deepLinkCode);
        throw new Error(`Document ID or deep link code missing - documentId: ${documentId}, deepLinkCode: ${deepLinkCode}`);
      }

      console.log(`Downloading invoice: documentId=${documentId}, deepLinkCode=${deepLinkCode}`);

      // Step 2: Download the PDF using the correct Shopware 6 endpoint
      const downloadResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}/${deepLinkCode}?download=1`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/pdf',
          },
        }
      );

      if (!downloadResponse.ok) {
        const errorText = await downloadResponse.text();
        throw new Error(`Failed to download invoice: ${downloadResponse.statusText} - ${errorText}`);
      }

      return await downloadResponse.blob();
    } catch (error) {
      console.error('Error downloading invoice from Shopware:', error);
      throw error;
    }
  }

  async fetchProducts(
    limit: number = 100, 
    page: number = 1, 
    search?: string, 
    categoryId?: string,
    showInactive: boolean = false,
    width?: number,
    height?: number,
    depth?: number,
    includeInactive: boolean = false
  ): Promise<{ products: Product[], total: number }> {
    try {
      const requestBody: any = {
        limit,
        page,
        sort: [
          {
            field: 'productNumber',
            order: 'ASC',
          },
        ],
      };

      // Build filter array
      const filters: any[] = [];

      // Filter by active status
      if (showInactive) {
        // Admin only: Show only inactive products
        filters.push({
          type: 'equals',
          field: 'active',
          value: false,
        });
      } else if (includeInactive) {
        // Admin tools: Include both active and inactive products
        filters.push({
          type: 'multi',
          operator: 'OR',
          queries: [
            {
              type: 'equals',
              field: 'active',
              value: true,
            },
            {
              type: 'equals',
              field: 'active',
              value: false,
            },
          ],
        });
      } else {
        // Default: Show only active products
        filters.push({
          type: 'equals',
          field: 'active',
          value: true,
        });
      }

      // Filter by category if provided
      if (categoryId) {
        filters.push({
          type: 'equals',
          field: 'categoryIds',
          value: categoryId,
        });
      }

      // Filter by dimensions if provided
      if (width) {
        filters.push({
          type: 'equals',
          field: 'width',
          value: width,
        });
      }

      if (height) {
        filters.push({
          type: 'equals',
          field: 'height',
          value: height,
        });
      }

      if (depth) {
        filters.push({
          type: 'equals',
          field: 'length', // Shopware uses 'length' for depth
          value: depth,
        });
      }

      // Set the filters array
      requestBody.filter = filters;

      // Add search term if provided
      if (search && search.trim()) {
        requestBody.term = search.trim();
      }

      console.log(`[fetchProducts] Requesting products - page: ${page}, limit: ${limit}, search: ${search || 'none'}, category: ${categoryId || 'all'}, showInactive: ${showInactive}, width: ${width || 'any'}, height: ${height || 'any'}, depth: ${depth || 'any'}`);
      console.log(`[fetchProducts] Request body filter:`, JSON.stringify(requestBody.filter, null, 2));

      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...requestBody,
          includes: {
            product: [
              'id', 'productNumber', 'name', 'description', 'price', 
              'stock', 'available', 'manufacturerNumber', 'ean',
              'weight', 'width', 'height', 'length', 'packagingUnit',
              'minPurchase', 'maxPurchase', 'purchaseUnit',
              'customFields', 'createdAt', 'updatedAt',
              'manufacturer', 'categories', 'cover', 'tax', 'prices'
            ],
            product_manufacturer: ['name'],
            category: ['name'],
            product_media: ['media'],
            media: ['url'],
            tax: ['taxRate'],
            product_price: ['quantityStart', 'quantityEnd', 'price']
          },
          associations: {
            manufacturer: {},
            categories: {},
            cover: {
              associations: {
                media: {}
              }
            },
            media: {
              associations: {
                media: {}
              }
            },
            tax: {},
            prices: {}
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch products: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      const shopwareProducts = data.data || [];
      const total = data.meta?.total || shopwareProducts.length;
      
      console.log(`[fetchProducts] Shopware API response - returned: ${shopwareProducts.length}, total in DB: ${total}`);
      console.log(`[fetchProducts] Meta object:`, JSON.stringify(data.meta, null, 2));

      // Build a map of included entities
      const includedMap = new Map<string, any>();
      if (data.included) {
        data.included.forEach((item: any) => {
          const key = `${item.type}-${item.id}`;
          includedMap.set(key, item);
        });
      }

      const products: Product[] = shopwareProducts.map((sp: any, index: number) => {
        // Get manufacturer name
        let manufacturerName = '';
        if (sp.manufacturer?.name) {
          manufacturerName = sp.manufacturer.name;
        } else if (sp.relationships?.manufacturer?.data?.id) {
          const manufacturer = includedMap.get(`product_manufacturer-${sp.relationships.manufacturer.data.id}`);
          manufacturerName = manufacturer?.attributes?.name || '';
        }

        // Get categories
        const categoryNames: string[] = [];
        if (sp.categories) {
          categoryNames.push(...sp.categories.map((cat: any) => cat.name || '').filter(Boolean));
        } else if (sp.relationships?.categories?.data) {
          sp.relationships.categories.data.forEach((catRef: any) => {
            const category = includedMap.get(`category-${catRef.id}`);
            if (category?.attributes?.name) {
              categoryNames.push(category.attributes.name);
            }
          });
        }

        // Get cover image
        let imageUrl = '';
        if (sp.cover?.media?.url) {
          imageUrl = sp.cover.media.url;
        } else if (sp.relationships?.cover?.data?.id) {
          const coverMedia = includedMap.get(`product_media-${sp.relationships.cover.data.id}`);
          if (coverMedia?.relationships?.media?.data?.id) {
            const media = includedMap.get(`media-${coverMedia.relationships.media.data.id}`);
            imageUrl = media?.attributes?.url || '';
          }
        }

        // Get tax rate
        let taxRate = 19; // Default
        if (sp.tax?.taxRate) {
          taxRate = sp.tax.taxRate;
        } else if (sp.relationships?.tax?.data?.id) {
          const tax = includedMap.get(`tax-${sp.relationships.tax.data.id}`);
          taxRate = tax?.attributes?.taxRate || 19;
        }

        // Get price - Shopware stores prices in a complex structure with both gross and net
        let price = 0; // Gross price
        let netPrice = 0;
        if (sp.price && Array.isArray(sp.price)) {
          // Price is an array with currency-specific prices
          const eurPrice = sp.price.find((p: any) => p.currencyId || true); // Take first price
          if (eurPrice) {
            price = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            // Fallback calculation if net price is missing
            if (!netPrice && price) {
              netPrice = price / (1 + taxRate / 100);
            }
          }
        } else if (sp.attributes?.price && Array.isArray(sp.attributes.price)) {
          const eurPrice = sp.attributes.price.find((p: any) => p.currencyId || true);
          if (eurPrice) {
            price = eurPrice.gross || 0;
            netPrice = eurPrice.net || 0;
            if (!netPrice && price) {
              netPrice = price / (1 + taxRate / 100);
            }
          }
        }

        // Get graduated prices for CPQ
        const priceRules: ProductPriceRule[] = [];
        if (sp.prices && Array.isArray(sp.prices)) {
          sp.prices.forEach((priceRule: any) => {
            const quantityStart = priceRule.quantityStart || 1;
            const priceObj = priceRule.price?.[0];
            const rulePrice = priceObj?.gross || 0;
            const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
            priceRules.push({
              quantity: quantityStart,
              price: rulePrice,
              netPrice: ruleNetPrice,
            });
          });
        } else if (sp.relationships?.prices?.data) {
          sp.relationships.prices.data.forEach((priceRef: any) => {
            const priceRule = includedMap.get(`product_price-${priceRef.id}`);
            if (priceRule) {
              const quantityStart = priceRule.attributes?.quantityStart || 1;
              const priceObj = priceRule.attributes?.price?.[0];
              const rulePrice = priceObj?.gross || 0;
              const ruleNetPrice = priceObj?.net || rulePrice / (1 + taxRate / 100);
              priceRules.push({
                quantity: quantityStart,
                price: rulePrice,
                netPrice: ruleNetPrice,
              });
            }
          });
        }

        const product: Product = {
          id: sp.id,
          productNumber: sp.productNumber || sp.attributes?.productNumber || '',
          name: sp.name || sp.attributes?.name || 'Unknown Product',
          description: sp.description || sp.attributes?.description,
          price,
          netPrice,
          currency: 'EUR',
          taxRate,
          stock: sp.stock || sp.attributes?.stock || 0,
          available: sp.available !== undefined ? sp.available : (sp.attributes?.available || false),
          manufacturerName,
          categoryNames: categoryNames.length > 0 ? categoryNames : undefined,
          imageUrl: imageUrl || undefined,
          ean: sp.ean || sp.attributes?.ean,
          weight: sp.weight || sp.attributes?.weight,
          packagingUnit: sp.packagingUnit || sp.attributes?.packagingUnit || sp.purchaseUnit || sp.attributes?.purchaseUnit,
          minOrderQuantity: sp.minPurchase || sp.attributes?.minPurchase,
          maxOrderQuantity: sp.maxPurchase || sp.attributes?.maxPurchase,
          priceRules: priceRules.length > 0 ? priceRules : undefined,
          customFields: sp.customFields || sp.attributes?.customFields,
          createdAt: sp.createdAt || sp.attributes?.createdAt,
          updatedAt: sp.updatedAt || sp.attributes?.updatedAt,
        };

        // Add dimensions if available
        if (sp.width || sp.height || sp.length) {
          product.dimensions = {
            width: sp.width || sp.attributes?.width,
            height: sp.height || sp.attributes?.height,
            length: sp.length || sp.attributes?.length,
            unit: 'cm',
          };
        }

        return product;
      });

      return { products, total };
    } catch (error) {
      console.error('Error fetching products from Shopware:', error);
      throw error;
    }
  }

  // Fetch categories that have products by extracting them from actual products
  async fetchCategories(): Promise<Array<{ id: string; name: string; parentId: string | null }>> {
    try {
      console.log('[fetchCategories] Fetching categories with products from Shopware...');
      
      // Step 1: Fetch products with their category information
      const productsResponse = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/product`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 500, // Get a large sample of products
          includes: {
            product: ['categories'],
            category: ['id', 'name', 'parentId']
          },
          associations: {
            categories: {}
          }
        }),
      });

      if (!productsResponse.ok) {
        throw new Error(`Failed to fetch products: ${productsResponse.statusText}`);
      }

      const productsData = await productsResponse.json();
      const products = productsData.data || [];

      // Step 2: Extract unique categories from products
      const categoryMap = new Map<string, { id: string; name: string; parentId: string | null }>();
      
      products.forEach((product: any) => {
        const categories = product.categories || product.attributes?.categories || [];
        categories.forEach((cat: any) => {
          if (cat.id && !categoryMap.has(cat.id)) {
            categoryMap.set(cat.id, {
              id: cat.id,
              name: cat.name || cat.attributes?.name || 'Unnamed Category',
              parentId: cat.parentId || cat.attributes?.parentId || null,
            });
          }
        });
      });

      // Convert map to array and sort by name
      const categories = Array.from(categoryMap.values()).sort((a, b) => 
        a.name.localeCompare(b.name)
      );

      console.log(`[fetchCategories] Found ${categories.length} categories with products (from ${products.length} products)`);
      return categories;
    } catch (error) {
      console.error('Error fetching categories from Shopware:', error);
      throw error;
    }
  }

  // Cross-Selling Methods
  async fetchProductCrossSelling(productId: string): Promise<CrossSellingGroup[]> {
    try {
      // Use search endpoint to get ALL cross-selling groups (both productList and productStream)
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'productId',
                value: productId,
              },
            ],
            // No type filter - load both productList AND productStream
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch cross-selling: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      
      // Debug: Log the full response to understand Shopware's structure
      console.log('Shopware Cross-Selling Response:', JSON.stringify(data, null, 2));
      
      const crossSellings = data.data || data || [];

      const result = crossSellings.map((cs: any) => ({
        id: cs.id,
        name: cs.name || cs.attributes?.name || 'Unnamed Group',
        type: cs.type || cs.attributes?.type || 'productList',
        active: cs.active !== undefined ? cs.active : (cs.attributes?.active || false),
        products: [], // Will be populated separately if needed
      }));
      
      console.log(`Found ${result.length} cross-selling groups (productList + productStream) for product ${productId}`);
      
      return result;
    } catch (error) {
      console.error('Error fetching cross-selling from Shopware:', error);
      throw error;
    }
  }

  async fetchCrossSellingProducts(productId: string, crossSellingId: string): Promise<CrossSellingProduct[]> {
    try {
      console.log(`Fetching products for cross-selling group ${crossSellingId}...`);
      
      // Step 1: Get assigned product IDs
      const assignmentsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'crossSellingId',
                value: crossSellingId,
              },
            ],
          }),
        }
      );

      if (!assignmentsResponse.ok) {
        const errorText = await assignmentsResponse.text();
        throw new Error(`Failed to fetch cross-selling assignments: ${assignmentsResponse.statusText} - ${errorText}`);
      }

      const assignmentsData = await assignmentsResponse.json();
      const assignments = assignmentsData.data || [];
      
      if (assignments.length === 0) {
        console.log(`No products assigned to cross-selling group ${crossSellingId}`);
        return [];
      }

      // Step 2: Extract product IDs
      const productIds = assignments.map((a: any) => a.productId);
      console.log(`Found ${productIds.length} assigned product IDs:`, productIds);

      // Step 3: Fetch full product details
      const productsResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equalsAny',
                field: 'id',
                value: productIds,
              },
            ],
            associations: {
              cover: {
                associations: {
                  media: {},
                },
              },
              tax: {},
            },
          }),
        }
      );

      if (!productsResponse.ok) {
        const errorText = await productsResponse.text();
        throw new Error(`Failed to fetch product details: ${productsResponse.statusText} - ${errorText}`);
      }

      const productsData = await productsResponse.json();
      const products = productsData.data || [];
      
      console.log(`Fetched ${products.length} product details`);

      // Step 4: Map to CrossSellingProduct format
      const result = products.map((p: any) => {
        const priceObj = p.price?.[0];
        const grossPrice = priceObj?.gross || 0;
        const taxRate = p.tax?.taxRate || 19;
        const netPrice = priceObj?.net || grossPrice / (1 + taxRate / 100);
        return {
          id: p.id,
          productNumber: p.productNumber || '',
          name: p.name || 'Unknown Product',
          price: grossPrice,
          netPrice: netPrice,
          taxRate: taxRate,
          imageUrl: p.cover?.media?.url || undefined,
          stock: p.stock || 0,
          available: p.available || false,
        };
      });
      
      console.log(`Found ${result.length} products in cross-selling group ${crossSellingId}`);
      
      return result;
    } catch (error) {
      console.error('Error fetching cross-selling products from Shopware:', error);
      throw error;
    }
  }

  async createProductCrossSelling(productId: string, name: string, type: 'productList' | 'productStream' = 'productList'): Promise<string> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/product-cross-selling`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            productId,
            name,
            type,
            active: true,
            position: 1,
          }),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to create cross-selling: ${response.statusText} - ${errorText}`);
      }

      // Check if response has content
      const contentLength = response.headers.get('content-length');
      let createdId: string | null = null;

      // Try to get ID from response body if there is content
      if (contentLength && parseInt(contentLength) > 0) {
        try {
          const data = await response.json();
          // Shopware returns the created ID in different formats depending on API version
          // Try data first (direct response), then data.data (wrapped response)
          createdId = data?.id || data?.data?.id;
        } catch (jsonError) {
          console.log('Response body is not valid JSON, checking headers...');
        }
      }

      // If no ID from body, try to extract from Location header
      if (!createdId) {
        const locationHeader = response.headers.get('location');
        if (locationHeader) {
          // Location header format: /api/product-cross-selling/{id}
          const matches = locationHeader.match(/\/api\/product-cross-selling\/([a-f0-9]+)/i);
          if (matches && matches[1]) {
            createdId = matches[1];
          }
        }
      }

      if (!createdId) {
        console.error('Response headers:', Object.fromEntries(response.headers.entries()));
        throw new Error('Failed to get cross-selling ID from response (checked body and Location header)');
      }

      return createdId;
    } catch (error) {
      console.error('Error creating cross-selling in Shopware:', error);
      throw error;
    }
  }

  async assignProductsToCrossSelling(crossSellingId: string, productIds: string[]): Promise<void> {
    try {
      console.log(`assignProductsToCrossSelling called with crossSellingId=${crossSellingId}, productIds=${JSON.stringify(productIds)}`);
      
      // Shopware expects assigned products to be created individually
      const assignments = productIds.map((productId, index) => ({
        crossSellingId: crossSellingId, // Shopware expects 'crossSellingId', not 'productCrossSellingId'
        productId,
        position: index + 1,
      }));

      console.log('Assignments to send to Shopware:', JSON.stringify(assignments, null, 2));

      const requestBody = {
        'write-product-cross-selling-assigned-products': {
          entity: 'product_cross_selling_assigned_products',
          action: 'upsert',
          payload: assignments,
        },
      };
      
      console.log('Full request body:', JSON.stringify(requestBody, null, 2));

      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(requestBody),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Shopware sync error response:', errorText);
        throw new Error(`Failed to assign products to cross-selling: ${response.statusText} - ${errorText}`);
      }
      
      console.log('Products assigned successfully');
    } catch (error) {
      console.error('Error assigning products to cross-selling in Shopware:', error);
      throw error;
    }
  }

  async removeProductsFromCrossSelling(crossSellingId: string, productIds: string[]): Promise<void> {
    try {
      // First, fetch existing assignments to get their IDs
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/search/product-cross-selling-assigned-products`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            filter: [
              {
                type: 'equals',
                field: 'productCrossSellingId',
                value: crossSellingId,
              },
              {
                type: 'equalsAny',
                field: 'productId',
                value: productIds,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch assignments for removal');
      }

      const data = await response.json();
      const assignmentIds = (data.data || []).map((a: any) => a.id);

      if (assignmentIds.length === 0) {
        return; // Nothing to delete
      }

      // Delete assignments
      const deleteResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/sync`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            'delete-assignments': {
              entity: 'product_cross_selling_assigned_products',
              action: 'delete',
              payload: assignmentIds.map((id: string) => ({ id })),
            },
          }),
        }
      );

      if (!deleteResponse.ok) {
        const errorText = await deleteResponse.text();
        throw new Error(`Failed to remove products from cross-selling: ${deleteResponse.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error removing products from cross-selling in Shopware:', error);
      throw error;
    }
  }

  async deleteProductCrossSelling(crossSellingId: string): Promise<void> {
    try {
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/product-cross-selling/${crossSellingId}`,
        {
          method: 'DELETE',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to delete cross-selling: ${response.statusText} - ${errorText}`);
      }
    } catch (error) {
      console.error('Error deleting cross-selling from Shopware:', error);
      throw error;
    }
  }

  async fetchAvailableFields(): Promise<{
    standardFields: Array<{ field: string; label: string; description: string }>;
    customFields: Array<{ field: string; label: string; type: string }>;
  }> {
    try {
      // Standard product fields that are commonly used in rules
      const standardFields = [
        { field: 'name', label: 'Product Name', description: 'The product name' },
        { field: 'productNumber', label: 'Product Number', description: 'The unique product number/SKU' },
        { field: 'manufacturerNumber', label: 'Manufacturer Number', description: 'Manufacturer\'s product number' },
        { field: 'ean', label: 'EAN', description: 'European Article Number / Barcode' },
        { field: 'stock', label: 'Stock', description: 'Current stock level' },
        { field: 'available', label: 'Available', description: 'Product availability status' },
        { field: 'price', label: 'Price', description: 'Product price' },
        { field: 'weight', label: 'Weight', description: 'Product weight' },
        { field: 'dimensions.width', label: 'Width', description: 'Product width dimension' },
        { field: 'dimensions.height', label: 'Height', description: 'Product height dimension' },
        { field: 'dimensions.length', label: 'Length', description: 'Product length/depth dimension' },
        { field: 'categoryNames', label: 'Categories', description: 'Product categories (array)' },
        { field: 'manufacturer.name', label: 'Manufacturer Name', description: 'Name of the manufacturer' },
      ];

      // Fetch custom fields from Shopware
      const customFields: Array<{ field: string; label: string; type: string }> = [];
      
      try {
        const response = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/search/custom-field`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              limit: 500, // Get many custom fields
              filter: [
                {
                  type: 'equals',
                  field: 'active',
                  value: true,
                },
              ],
            }),
          }
        );

        if (response.ok) {
          const data = await response.json();
          const fields = data.data || [];

          fields.forEach((cf: any) => {
            const fieldName = cf.name || cf.attributes?.name;
            const fieldLabel = cf.config?.label?.['en-GB'] || cf.config?.label?.['de-DE'] || cf.attributes?.config?.label?.['en-GB'] || cf.attributes?.config?.label?.['de-DE'] || fieldName;
            const fieldType = cf.type || cf.attributes?.type || 'text';

            if (fieldName) {
              customFields.push({
                field: `customFields.${fieldName}`,
                label: fieldLabel || fieldName,
                type: fieldType,
              });
            }
          });

          console.log(`Fetched ${customFields.length} custom fields from Shopware`);
        }
      } catch (customFieldError) {
        console.warn('Could not fetch custom fields from Shopware:', customFieldError);
        // Continue with empty custom fields array
      }

      return {
        standardFields,
        customFields,
      };
    } catch (error) {
      console.error('Error fetching available fields:', error);
      throw error;
    }
  }

  /**
   * Update order shipping information and set status to "shipped"
   * This combines setting tracking codes and transitioning the delivery state
   */
  async updateOrderShipping(
    orderId: string,
    shippingInfo: {
      carrier?: string;
      trackingNumber?: string;
      shippedDate?: string;
    }
  ): Promise<void> {
    try {
      // Step 1: Fetch order to get delivery ID
      const response = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/order/${orderId}?associations[deliveries][]`,
        {
          method: 'GET',
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch order: ${response.statusText} - ${errorText}`);
      }

      const orderData = await response.json();
      const deliveries = orderData.data?.deliveries || [];

      if (deliveries.length === 0) {
        throw new Error('Order has no deliveries');
      }

      // Get the first delivery (most orders have only one delivery)
      const deliveryId = deliveries[0].id;

      // Step 2: Update tracking codes if provided
      if (shippingInfo.trackingNumber) {
        const trackingCodes = [shippingInfo.trackingNumber];
        
        const updateResponse = await this.makeAuthenticatedRequest(
          `${this.baseUrl}/api/order-delivery/${deliveryId}`,
          {
            method: 'PATCH',
            body: JSON.stringify({
              trackingCodes: trackingCodes,
            }),
          }
        );

        if (!updateResponse.ok) {
          const errorText = await updateResponse.text();
          console.warn(`Warning: Failed to update tracking codes: ${updateResponse.statusText} - ${errorText}`);
          // Continue anyway - tracking codes are optional
        }
      }

      // Step 3: Transition delivery state to "shipped"
      const stateResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order_delivery/${deliveryId}/state/ship`,
        {
          method: 'POST',
          body: JSON.stringify({}),
        }
      );

      if (!stateResponse.ok) {
        const errorText = await stateResponse.text();
        throw new Error(`Failed to set order to shipped: ${stateResponse.statusText} - ${errorText}`);
      }

      console.log(`Order ${orderId} marked as shipped in Shopware`);
    } catch (error) {
      console.error('Error updating order shipping:', error);
      throw error;
    }
  }

  /**
   * Fetch orders for analytics with optional date and sales channel filtering
   */
  async fetchOrdersForAnalytics(dateFrom?: string, dateTo?: string, salesChannelIds?: string[]): Promise<Order[]> {
    try {
      const limit = 500;
      let page = 1;
      let allOrders: any[] = [];
      let allIncluded: any[] = [];
      let hasMore = true;

      while (hasMore) {
        // Build filter array
        const filters: any[] = [];
        
        if (dateFrom) {
          filters.push({
            type: 'range',
            field: 'orderDate',
            parameters: {
              gte: dateFrom,
            },
          });
        }
        
        if (dateTo) {
          filters.push({
            type: 'range',
            field: 'orderDate',
            parameters: {
              lte: dateTo,
            },
          });
        }

        if (salesChannelIds && salesChannelIds.length > 0) {
          filters.push({
            type: 'equalsAny',
            field: 'salesChannelId',
            value: salesChannelIds,
          });
        }

        const requestBody: any = {
          limit,
          page,
          sort: [
            {
              field: 'orderDate',
              order: 'DESC',
            },
          ],
          includes: {
            order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'amountNet', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields', 'transactions', 'price'],
            order_customer: ['firstName', 'lastName', 'email'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice', 'price', 'productId', 'product'],
            state_machine_state: ['technicalName'],
            sales_channel: ['id', 'name'],
            order_transaction: ['stateMachineState'],
            product: ['id', 'productNumber', 'name', 'categories'],
            category: ['id', 'name'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {
              associations: {
                product: {
                  associations: {
                    categories: {},
                  },
                },
              },
            },
            stateMachineState: {},
            salesChannel: {},
            transactions: {
              limit: 10,
              sort: [{ field: 'createdAt', order: 'DESC' }],
              associations: {
                stateMachineState: {},
              },
            },
          },
        };

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
          throw new Error(`Failed to fetch orders for analytics: ${response.statusText} - ${errorText}`);
        }

        const data = await response.json();
        const orders = data.data || [];
        const included = data.included || [];

        if (orders.length === 0) {
          hasMore = false;
          break;
        }

        allOrders = allOrders.concat(orders);
        allIncluded = allIncluded.concat(included);

        if (orders.length < limit) {
          hasMore = false;
        }

        page++;
      }

      console.log(`[Analytics] Fetched ${allOrders.length} orders for analysis`);

      // Create a map of included entities
      const includedMap = new Map<string, any>();
      allIncluded.forEach((item: any) => {
        const key = `${item.type}-${item.id}`;
        includedMap.set(key, item);
      });

      // Map to Order format (simplified for analytics)
      return allOrders.map((shopwareOrder: any) => {
        let customerName = 'Unknown Customer';
        let customerEmail = '';

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

        // Get order status
        let orderStatus: OrderStatus = 'open';
        if (shopwareOrder.stateMachineState?.technicalName) {
          orderStatus = this.mapShopwareStatus(shopwareOrder.stateMachineState.technicalName);
        } else if (shopwareOrder.relationships?.stateMachineState?.data?.id) {
          const stateId = shopwareOrder.relationships.stateMachineState.data.id;
          const state = includedMap.get(`state_machine_state-${stateId}`);
          if (state?.attributes?.technicalName) {
            orderStatus = this.mapShopwareStatus(state.attributes.technicalName);
          }
        }

        // Get payment status
        let paymentStatus: PaymentStatus = 'open';
        if (shopwareOrder.transactions && shopwareOrder.transactions.length > 0) {
          const latestTransaction = shopwareOrder.transactions[0];
          if (latestTransaction.stateMachineState?.technicalName) {
            paymentStatus = this.mapPaymentStatus(latestTransaction.stateMachineState.technicalName);
          }
        } else if (shopwareOrder.relationships?.transactions?.data && shopwareOrder.relationships.transactions.data.length > 0) {
          const transactionId = shopwareOrder.relationships.transactions.data[0].id;
          const transaction = includedMap.get(`order_transaction-${transactionId}`);
          if (transaction?.relationships?.stateMachineState?.data?.id) {
            const stateId = transaction.relationships.stateMachineState.data.id;
            const state = includedMap.get(`state_machine_state-${stateId}`);
            if (state?.attributes?.technicalName) {
              paymentStatus = this.mapPaymentStatus(state.attributes.technicalName);
            }
          }
        }

        // Get line items with category information
        const lineItems: OrderItem[] = [];
        if (shopwareOrder.lineItems) {
          shopwareOrder.lineItems.forEach((item: any) => {
            const unitPrice = item.price?.unitPrice || 0;
            const quantity = item.quantity || 0;
            const taxRate = item.price?.taxRules?.[0]?.taxRate || 19; // Default to 19% if not specified
            const netUnitPrice = unitPrice / (1 + taxRate / 100);
            
            const lineItem: OrderItem = {
              id: item.id,
              name: item.label || 'Unknown Product',
              quantity,
              price: unitPrice,
              netPrice: netUnitPrice,
              total: unitPrice * quantity,
              netTotal: netUnitPrice * quantity,
              taxRate,
            };

            lineItems.push(lineItem);
          });
        }

        // Get sales channel
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

        return {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || 'N/A',
          orderDate: shopwareOrder.orderDate || new Date().toISOString(),
          customerName,
          customerEmail,
          customerPhone: '',
          totalAmount: shopwareOrder.amountTotal || 0,
          netTotalAmount: shopwareOrder.amountNet || 0,
          status: orderStatus,
          paymentStatus,
          salesChannelId: shopwareOrder.salesChannelId || '',
          salesChannelName,
          items: lineItems,
        } as Order;
      });
    } catch (error) {
      console.error('Error fetching orders for analytics:', error);
      throw error;
    }
  }
}
