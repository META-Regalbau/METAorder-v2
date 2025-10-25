import { useState } from "react";
import { Download, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import OrderFilters from "@/components/OrderFilters";
import OrdersTable from "@/components/OrdersTable";
import OrderDetailModal from "@/components/OrderDetailModal";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import type { Order, OrderStatus } from "@shared/schema";
import { useTranslation } from "react-i18next";

interface OrdersPageProps {
  userRole: "employee" | "admin";
}

export default function OrdersPage({ userRole }: OrdersPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [currentPage, setCurrentPage] = useState(1);

  // Fetch orders from Shopware API
  const { data: orders = [], isLoading, error, refetch } = useQuery<Order[]>({
    queryKey: ['/api/orders'],
    retry: false,
  });

  // Show error if Shopware is not configured
  if (error) {
    const errorMessage = (error as any)?.message || t('errors.loadFailed');
    if (errorMessage.includes('not configured')) {
      return (
        <div className="max-w-4xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold mb-1">{t('orders.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('errors.notConfiguredDescription')}
            </p>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground mb-4">
              {t('errors.notConfigured')}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {t('errors.notConfiguredDescription')}
            </p>
            <Button onClick={() => window.location.href = '/settings'} data-testid="button-go-to-settings">
              {t('errors.goToSettings')}
            </Button>
          </div>
        </div>
      );
    }
  }

  // Filter and sort orders (newest first)
  const filteredOrders = orders
    .filter((order) => {
      const matchesSearch =
        searchValue === "" ||
        order.orderNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
        order.customerName.toLowerCase().includes(searchValue.toLowerCase()) ||
        order.customerEmail.toLowerCase().includes(searchValue.toLowerCase());

      const matchesStatus = statusFilter === "all" || order.status === statusFilter;

      const matchesDateFrom = dateFrom === "" || new Date(order.orderDate) >= new Date(dateFrom);
      const matchesDateTo = dateTo === "" || new Date(order.orderDate) <= new Date(dateTo);

      return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
    })
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  // Pagination
  const itemsPerPageNum = parseInt(itemsPerPage);
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPageNum);
  const startIndex = (currentPage - 1) * itemsPerPageNum;
  const endIndex = startIndex + itemsPerPageNum;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const resetPage = () => setCurrentPage(1);

  const activeFiltersCount = [
    statusFilter !== "all",
    dateFrom !== "",
    dateTo !== "",
  ].filter(Boolean).length;

  const handleViewOrder = (order: Order) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleRefresh = async () => {
    console.log("Refreshing orders...");
    try {
      await refetch();
      toast({
        title: t('orders.refreshed'),
        description: t('orders.refreshSuccess'),
      });
    } catch (error) {
      toast({
        title: t('orders.refreshFailed'),
        description: t('orders.refreshError'),
        variant: "destructive",
      });
    }
  };

  const handleExport = () => {
    console.log("Exporting orders...");
    toast({
      title: t('orders.exportStarted'),
      description: t('orders.exportDescription'),
    });
    // TODO: Implement export functionality
  };

  const handleUpdateShipping = (orderId: string, data: any) => {
    console.log("Update shipping for order:", orderId, data);
    toast({
      title: t('orderDetail.shippingUpdated'),
      description: t('orderDetail.shippingSuccess'),
    });
    // TODO: Implement API call to update shipping
  };

  const handleUpdateDocuments = (orderId: string, data: any) => {
    console.log("Update documents for order:", orderId, data);
    toast({
      title: t('orderDetail.documentsUpdated'),
      description: t('orderDetail.documentsSuccess'),
    });
    // TODO: Implement API call to update documents
  };

  return (
    <div className="flex gap-6">
      {/* Filters Sidebar */}
      <aside className="w-64 flex-shrink-0">
        <div className="sticky top-6">
          <div className="mb-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                type="search"
                placeholder={t('orders.searchPlaceholder')}
                className="pl-9"
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                data-testid="input-search-orders"
              />
            </div>
          </div>
          
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
              setSearchValue("");
              resetPage();
            }}
            activeFiltersCount={activeFiltersCount}
          />
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1">{t('orders.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {isLoading ? t('common.loading') : t('orders.showing', { count: filteredOrders.length, total: orders.length })}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={handleRefresh} disabled={isLoading} data-testid="button-refresh-orders">
              <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
              {t('common.refresh')}
            </Button>
            <Button onClick={handleExport} data-testid="button-export-orders">
              <Download className="h-4 w-4 mr-1" />
              {t('common.export')}
            </Button>
          </div>
        </div>

        <OrdersTable
          orders={paginatedOrders}
          onViewOrder={handleViewOrder}
          isLoading={isLoading}
        />

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('common.show')}</span>
            <Select value={itemsPerPage} onValueChange={(value) => {
              setItemsPerPage(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-20" data-testid="select-items-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">{t('common.itemsPerPage')}</span>
          </div>
          
          {totalPages > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {t('common.page')} {currentPage} {t('common.of')} {totalPages}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(1)}
                  disabled={currentPage === 1}
                  data-testid="button-first-page"
                >
                  {t('common.first')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage - 1)}
                  disabled={currentPage === 1}
                  data-testid="button-prev-page"
                >
                  {t('common.previous')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  data-testid="button-next-page"
                >
                  {t('common.next')}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setCurrentPage(totalPages)}
                  disabled={currentPage === totalPages}
                  data-testid="button-last-page"
                >
                  {t('common.last')}
                </Button>
              </div>
            </div>
          )}
        </div>

        <OrderDetailModal
          order={selectedOrder}
          isOpen={isModalOpen}
          onClose={() => setIsModalOpen(false)}
          userRole={userRole}
          onUpdateShipping={handleUpdateShipping}
          onUpdateDocuments={handleUpdateDocuments}
        />
      </main>
    </div>
  );
}
