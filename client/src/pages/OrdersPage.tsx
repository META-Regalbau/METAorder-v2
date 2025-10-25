import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import TopBar from "@/components/TopBar";
import OrderFilters from "@/components/OrderFilters";
import OrdersTable from "@/components/OrdersTable";
import OrderDetailModal from "@/components/OrderDetailModal";
import type { Order, OrderStatus } from "@shared/schema";

// TODO: Remove mock data - this is for prototype only
const mockOrders: Order[] = [
  {
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
    items: [
      { id: '1', name: 'Wireless Mouse', quantity: 2, price: 49.99, total: 99.98 },
      { id: '2', name: 'USB-C Cable', quantity: 4, price: 12.50, total: 50.00 },
      { id: '3', name: 'Monitor Stand', quantity: 1, price: 150.01, total: 150.01 }
    ]
  },
  {
    id: '2',
    orderNumber: 'ORD-2024-002',
    customerName: 'Jane Smith',
    customerEmail: 'jane@example.com',
    orderDate: '2024-01-14T14:20:00Z',
    totalAmount: 149.50,
    status: 'open',
    items: [
      { id: '4', name: 'Keyboard', quantity: 1, price: 89.50, total: 89.50 },
      { id: '5', name: 'Mouse Pad', quantity: 2, price: 30.00, total: 60.00 }
    ]
  },
  {
    id: '3',
    orderNumber: 'ORD-2024-003',
    customerName: 'Bob Johnson',
    customerEmail: 'bob@example.com',
    orderDate: '2024-01-13T09:15:00Z',
    totalAmount: 499.99,
    status: 'completed',
    shippingInfo: {
      carrier: 'UPS',
      trackingNumber: 'UPS987654321',
      shippedDate: '2024-01-14'
    },
    deliveryNoteNumber: 'DN-2024-003',
    erpNumber: 'ERP-54321',
    items: [
      { id: '6', name: 'Laptop Stand', quantity: 1, price: 199.99, total: 199.99 },
      { id: '7', name: 'Webcam HD', quantity: 1, price: 150.00, total: 150.00 },
      { id: '8', name: 'Headset', quantity: 1, price: 150.00, total: 150.00 }
    ]
  },
  {
    id: '4',
    orderNumber: 'ORD-2024-004',
    customerName: 'Alice Williams',
    customerEmail: 'alice@example.com',
    orderDate: '2024-01-12T16:45:00Z',
    totalAmount: 89.99,
    status: 'open',
    items: [
      { id: '9', name: 'Phone Case', quantity: 1, price: 29.99, total: 29.99 },
      { id: '10', name: 'Screen Protector', quantity: 3, price: 20.00, total: 60.00 }
    ]
  },
  {
    id: '5',
    orderNumber: 'ORD-2024-005',
    customerName: 'Charlie Brown',
    customerEmail: 'charlie@example.com',
    orderDate: '2024-01-11T11:30:00Z',
    totalAmount: 1299.99,
    status: 'cancelled',
    items: [
      { id: '11', name: 'Gaming Monitor 27"', quantity: 1, price: 799.99, total: 799.99 },
      { id: '12', name: 'HDMI Cable', quantity: 2, price: 25.00, total: 50.00 },
      { id: '13', name: 'Desk Lamp', quantity: 1, price: 450.00, total: 450.00 }
    ]
  }
];

export default function OrdersPage() {
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [isLoading, setIsLoading] = useState(false);

  // TODO: Remove mock user role - will be fetched from auth
  const userRole: "employee" | "admin" = "admin";
  const username = "Admin User";

  // Filter orders based on search and filters
  const filteredOrders = mockOrders.filter((order) => {
    const matchesSearch =
      searchValue === "" ||
      order.orderNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchValue.toLowerCase()) ||
      order.customerEmail.toLowerCase().includes(searchValue.toLowerCase());

    const matchesStatus = statusFilter === "all" || order.status === statusFilter;

    const matchesDateFrom = dateFrom === "" || new Date(order.orderDate) >= new Date(dateFrom);
    const matchesDateTo = dateTo === "" || new Date(order.orderDate) <= new Date(dateTo);

    return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
  });

  const activeFiltersCount = [
    statusFilter !== "all",
    dateFrom !== "",
    dateTo !== "",
  ].filter(Boolean).length;

  const handleViewOrder = (order: Order) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleRefresh = () => {
    console.log("Refreshing orders...");
    setIsLoading(true);
    // TODO: Replace with actual API call
    setTimeout(() => setIsLoading(false), 1000);
  };

  const handleExport = () => {
    console.log("Exporting orders...");
    // TODO: Implement export functionality
  };

  const handleUpdateShipping = (orderId: string, data: any) => {
    console.log("Update shipping for order:", orderId, data);
    // TODO: Implement API call to update shipping
  };

  const handleUpdateDocuments = (orderId: string, data: any) => {
    console.log("Update documents for order:", orderId, data);
    // TODO: Implement API call to update documents
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      <TopBar
        userRole={userRole}
        username={username}
        onSearchChange={setSearchValue}
        searchValue={searchValue}
      />

      <div className="flex-1 overflow-auto">
        <div className="max-w-screen-2xl mx-auto p-6">
          <div className="flex gap-6">
            {/* Filters Sidebar */}
            <aside className="w-64 flex-shrink-0">
              <OrderFilters
                statusFilter={statusFilter}
                onStatusFilterChange={(value) => setStatusFilter(value as OrderStatus | "all")}
                dateFrom={dateFrom}
                dateTo={dateTo}
                onDateFromChange={setDateFrom}
                onDateToChange={setDateTo}
                onClearFilters={() => {
                  setStatusFilter("all");
                  setDateFrom("");
                  setDateTo("");
                }}
                activeFiltersCount={activeFiltersCount}
              />
            </aside>

            {/* Main Content */}
            <main className="flex-1 min-w-0">
              <div className="mb-6 flex items-center justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-semibold mb-1">Orders</h1>
                  <p className="text-sm text-muted-foreground">
                    Showing {filteredOrders.length} of {mockOrders.length} orders
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={handleRefresh} data-testid="button-refresh-orders">
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Refresh
                  </Button>
                  <Button onClick={handleExport} data-testid="button-export-orders">
                    <Download className="h-4 w-4 mr-1" />
                    Export
                  </Button>
                </div>
              </div>

              <OrdersTable
                orders={filteredOrders}
                onViewOrder={handleViewOrder}
                isLoading={isLoading}
              />

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Items per page:</span>
                  <Select value={itemsPerPage} onValueChange={setItemsPerPage}>
                    <SelectTrigger className="w-20" data-testid="select-items-per-page">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25">25</SelectItem>
                      <SelectItem value="50">50</SelectItem>
                      <SelectItem value="100">100</SelectItem>
                      <SelectItem value="200">200</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <p className="text-sm text-muted-foreground">
                  Last updated: {new Date().toLocaleTimeString()}
                </p>
              </div>
            </main>
          </div>
        </div>
      </div>

      <OrderDetailModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        userRole={userRole}
        onUpdateShipping={handleUpdateShipping}
        onUpdateDocuments={handleUpdateDocuments}
      />
    </div>
  );
}
