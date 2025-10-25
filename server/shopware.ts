import type { Order, OrderStatus, OrderItem, ShopwareSettings } from "@shared/schema";

export class ShopwareClient {
  private baseUrl: string;
  private apiKey: string;
  private apiSecret: string;
  private accessToken: string | null = null;

  constructor(settings: ShopwareSettings) {
    this.baseUrl = settings.shopwareUrl.replace(/\/$/, ''); // Remove trailing slash
    this.apiKey = settings.apiKey;
    this.apiSecret = settings.apiSecret;
  }

  private async authenticate(): Promise<string> {
    if (this.accessToken) {
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
        throw new Error(`Authentication failed: ${response.statusText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      return this.accessToken;
    } catch (error) {
      console.error('Shopware authentication error:', error);
      throw new Error('Failed to authenticate with Shopware API');
    }
  }

  async testConnection(): Promise<boolean> {
    try {
      const token = await this.authenticate();
      return !!token;
    } catch (error) {
      return false;
    }
  }

  private mapShopwareStatus(shopwareStatus: string): OrderStatus {
    const statusMap: Record<string, OrderStatus> = {
      'open': 'open',
      'in_progress': 'in_progress',
      'done': 'completed',
      'cancelled': 'cancelled',
    };
    return statusMap[shopwareStatus] || 'open';
  }

  async fetchOrders(): Promise<Order[]> {
    try {
      const token = await this.authenticate();

      const response = await fetch(`${this.baseUrl}/api/search/order`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          limit: 100,
          includes: {
            order: ['id', 'orderNumber', 'orderDate', 'amountTotal', 'stateMachineState'],
            order_customer: ['firstName', 'lastName', 'email'],
            order_line_item: ['id', 'label', 'quantity', 'unitPrice', 'totalPrice'],
          },
          associations: {
            orderCustomer: {},
            lineItems: {},
            stateMachineState: {},
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch orders: ${response.statusText}`);
      }

      const data = await response.json();
      
      return data.data.map((shopwareOrder: any) => {
        const customer = shopwareOrder.orderCustomer;
        const customerName = `${customer?.firstName || ''} ${customer?.lastName || ''}`.trim();
        
        const items: OrderItem[] = (shopwareOrder.lineItems || []).map((item: any) => ({
          id: item.id,
          name: item.label,
          quantity: item.quantity,
          price: item.unitPrice,
          total: item.totalPrice,
        }));

        const order: Order = {
          id: shopwareOrder.id,
          orderNumber: shopwareOrder.orderNumber,
          customerName: customerName || 'Unknown Customer',
          customerEmail: customer?.email || '',
          orderDate: shopwareOrder.orderDate,
          totalAmount: shopwareOrder.amountTotal,
          status: this.mapShopwareStatus(shopwareOrder.stateMachineState?.technicalName || 'open'),
          items,
        };

        return order;
      });
    } catch (error) {
      console.error('Error fetching orders from Shopware:', error);
      throw error;
    }
  }

  async downloadInvoicePdf(orderId: string): Promise<Blob> {
    try {
      const token = await this.authenticate();

      const response = await fetch(`${this.baseUrl}/api/_action/order/${orderId}/document/invoice`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/pdf',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to download invoice: ${response.statusText}`);
      }

      return await response.blob();
    } catch (error) {
      console.error('Error downloading invoice from Shopware:', error);
      throw error;
    }
  }
}
