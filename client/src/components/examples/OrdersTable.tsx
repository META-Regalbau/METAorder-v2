import OrdersTable from '../OrdersTable';
import type { Order } from '@shared/schema';

const mockOrders: Order[] = [
  {
    id: '1',
    orderNumber: 'ORD-2024-001',
    customerName: 'John Doe',
    customerEmail: 'john@example.com',
    orderDate: '2024-01-15T10:30:00Z',
    totalAmount: 299.99,
    netTotalAmount: 252.09,
    status: 'in_progress',
    paymentStatus: 'open',
    salesChannelId: 'sc-1',
    shippingInfo: {
      carrier: 'DHL',
      trackingNumber: 'DHL123456789',
      shippedDate: '2024-01-16'
    },
    items: []
  },
  {
    id: '2',
    orderNumber: 'ORD-2024-002',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    orderDate: '2024-01-14T14:20:00Z',
    totalAmount: 149.50,
    netTotalAmount: 125.63,
    status: 'open',
    paymentStatus: 'open',
    salesChannelId: 'sc-1',
    items: []
  },
  {
    id: '3',
    orderNumber: 'ORD-2024-003',
    customerName: 'Bob Johnson',
    customerEmail: 'bob@example.com',
    orderDate: '2024-01-13T09:15:00Z',
    totalAmount: 499.99,
    netTotalAmount: 420.16,
    status: 'completed',
    paymentStatus: 'paid',
    salesChannelId: 'sc-1',
    shippingInfo: {
      carrier: 'UPS',
      trackingNumber: 'UPS987654321',
      shippedDate: '2024-01-14'
    },
    items: []
  }
];

export default function OrdersTableExample() {
  return (
    <div className="p-4">
      <OrdersTable 
        orders={mockOrders} 
        onViewOrder={(order) => console.log('View order:', order)}
      />
    </div>
  );
}
