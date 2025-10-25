import { useState } from 'react';
import OrderDetailModal from '../OrderDetailModal';
import { Button } from '@/components/ui/button';
import type { Order } from '@shared/schema';

const mockOrder: Order = {
  id: '1',
  orderNumber: 'ORD-2024-001',
  customerName: 'John Doe',
  customerEmail: 'john@example.com',
  orderDate: '2024-01-15T10:30:00Z',
  totalAmount: 299.99,
  status: 'in_progress',
  shippingInfo: {
    carrier: 'DHL',
    trackingNumber: 'DHL123456789',
    shippedDate: '2024-01-16'
  },
  invoiceNumber: 'INV-2024-001',
  deliveryNoteNumber: 'DN-2024-001',
  erpNumber: 'ERP-12345',
  items: [
    { id: '1', name: 'Product A', quantity: 2, price: 99.99, total: 199.98 },
    { id: '2', name: 'Product B', quantity: 1, price: 100.01, total: 100.01 }
  ]
};

export default function OrderDetailModalExample() {
  const [isOpen, setIsOpen] = useState(false);
  
  return (
    <div className="p-4">
      <Button onClick={() => setIsOpen(true)}>Open Order Detail</Button>
      <OrderDetailModal
        order={mockOrder}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        userRole="admin"
        onUpdateShipping={(id, data) => console.log('Update shipping:', id, data)}
        onUpdateDocuments={(id, data) => console.log('Update documents:', id, data)}
      />
    </div>
  );
}
