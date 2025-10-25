import type { Order, OrderStatus, OrderItem, ShopwareSettings } from "@shared/schema";

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
      const response = await this.makeAuthenticatedRequest(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 100,
          includes: {
            order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'orderCustomer', 'lineItems', 'stateMachineState'],
            order_customer: ['firstName', 'lastName', 'email'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice'],
            state_machine_state: ['technicalName'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {},
            stateMachineState: {},
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

        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber || shopwareOrder.attributes?.orderNumber || 'N/A',
          customerName,
          customerEmail,
          orderDate: shopwareOrder.orderDate || shopwareOrder.attributes?.orderDate || shopwareOrder.createdAt || new Date().toISOString(),
          totalAmount: shopwareOrder.amountTotal || shopwareOrder.attributes?.amountTotal || 0,
          status,
          items,
        };

        // Add invoice number if available
        if (shopwareOrder.invoiceNumber || shopwareOrder.attributes?.invoiceNumber) {
          order.invoiceNumber = shopwareOrder.invoiceNumber || shopwareOrder.attributes?.invoiceNumber;
        }

        return order;
      });
    } catch (error) {
      console.error('Error fetching orders from Shopware:', error);
      throw error;
    }
  }

  async downloadInvoicePdf(orderId: string): Promise<Blob> {
    try {
      // Step 1: Generate/get the invoice document
      const createResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/order/${orderId}/document/invoice`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            config: {
              documentNumber: '',
              documentComment: '',
              documentDate: new Date().toISOString(),
            },
          }),
        }
      );

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        throw new Error(`Failed to generate invoice: ${createResponse.statusText} - ${errorText}`);
      }

      // Handle both JSON response (new document) and 204 No Content (existing document)
      let documentId: string;
      
      if (createResponse.status === 204) {
        // Document already exists, we need to fetch it differently
        // Try to get existing documents for this order
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
            }),
          }
        );

        if (!docsResponse.ok) {
          throw new Error('Failed to retrieve existing invoice document');
        }

        const docsData = await docsResponse.json();
        if (!docsData.data || docsData.data.length === 0) {
          throw new Error('No invoice document found for this order');
        }

        documentId = docsData.data[0].id;
      } else {
        const createData = await createResponse.json();
        documentId = createData.data?.documentId || createData.documentId;

        if (!documentId) {
          throw new Error('No document ID returned from Shopware');
        }
      }

      // Step 2: Download the generated document
      const downloadResponse = await this.makeAuthenticatedRequest(
        `${this.baseUrl}/api/_action/document/${documentId}`,
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
