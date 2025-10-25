import type { Order, OrderStatus, OrderItem, ShopwareSettings, SalesChannel } from "@shared/schema";

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

    const response = await fetch(url, {
      ...options,
      headers: {
        ...options.headers,
        'Authorization': `Bearer ${token}`,
      },
    });

    // If we get a 401, token might have expired - try once more with fresh token
    if (response.status === 401) {
      this.accessToken = null;
      this.tokenExpiry = 0;
      token = await this.authenticate();
      
      return await fetch(url, {
        ...options,
        headers: {
          ...options.headers,
          'Authorization': `Bearer ${token}`,
        },
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
              order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'orderCustomer', 'lineItems', 'stateMachineState', 'salesChannelId', 'salesChannel', 'customFields'],
              order_customer: ['firstName', 'lastName', 'email'],
              order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice'],
              state_machine_state: ['technicalName'],
              sales_channel: ['id', 'name'],
            },
            associations: {
              orderCustomer: {},
              lineItems: {},
              stateMachineState: {},
              salesChannel: {},
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

        // Get line items from relationships or direct inclusion
        let items: OrderItem[] = [];
        
        if (shopwareOrder.lineItems) {
          items = shopwareOrder.lineItems.map((item: any) => ({
            id: item.id,
            name: item.label || 'Unknown Item',
            quantity: item.quantity || 1,
            price: item.unitPrice || 0,
            total: item.totalPrice || 0,
          }));
        } else if (shopwareOrder.relationships?.lineItems?.data) {
          items = shopwareOrder.relationships.lineItems.data.map((lineItemRef: any) => {
            const lineItem = includedMap.get(`order_line_item-${lineItemRef.id}`);
            return {
              id: lineItemRef.id,
              name: lineItem?.attributes?.label || 'Unknown Item',
              quantity: lineItem?.attributes?.quantity || 1,
              price: lineItem?.attributes?.unitPrice || 0,
              total: lineItem?.attributes?.totalPrice || 0,
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
        
        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
          customerName,
          customerEmail,
          orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
          totalAmount: shopwareOrder.amountTotal || shopwareOrder.attributes?.amountTotal || 0,
          status,
          salesChannelId,
          salesChannelName,
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
        // Extract document number and deep link code from attributes (Shopware API JSON format)
        const docNumber = doc.attributes?.documentNumber || '';
        const deepLink = doc.attributes?.deepLinkCode || '';
        
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
}
