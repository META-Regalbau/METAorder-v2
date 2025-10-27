import { useState, useEffect } from "react";
import { RefreshCw, Search, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import OrderDetailModal from "@/components/OrderDetailModal";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest, getAuthHeaders } from "@/lib/queryClient";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";

type DelayedOrder = Order & {
  daysSinceOrder: number;
};

interface DelayedOrdersPageProps {
  userRole: "employee" | "admin";
}

export default function DelayedOrdersPage({ userRole }: DelayedOrdersPageProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [searchValue, setSearchValue] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [currentPage, setCurrentPage] = useState(1);
  const [daysThreshold, setDaysThreshold] = useState("3");

  const dateLocale = i18n.language === 'de' ? de : i18n.language === 'es' ? es : enUS;

  // Update shipping mutation
  const updateShippingMutation = useMutation({
    mutationFn: async ({ orderId, shippingData }: { orderId: string; shippingData: any }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}/shipping`, shippingData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders/delayed'] });
      toast({
        title: t('orderDetail.shippingUpdated'),
        description: t('orderDetail.shippingSuccessWithStatus'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('errors.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleUpdateShipping = (orderId: string, data: any) => {
    updateShippingMutation.mutate({ orderId, shippingData: data });
  };

  const handleUpdateDocuments = (orderId: string, data: any) => {
    console.log("Update documents for order:", orderId, data);
    toast({
      title: t('orderDetail.documentsUpdated'),
      description: t('orderDetail.documentsSuccess'),
    });
  };

  // Fetch delayed orders
  const { data: orders = [], isLoading, error, refetch } = useQuery<DelayedOrder[]>({
    queryKey: ['/api/orders/delayed', daysThreshold],
    queryFn: async () => {
      const response = await fetch(`/api/orders/delayed?days=${daysThreshold}`, {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    retry: false,
  });

  // Show error if Shopware is not configured
  if (error) {
    const errorMessage = (error as any)?.message || t('errors.loadFailed');
    if (errorMessage.includes('not configured')) {
      return (
        <div className="max-w-4xl">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold mb-1">{t('delayedOrders.title')}</h1>
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

  // Filter orders
  const filteredOrders = orders.filter((order) => {
    const matchesSearch =
      searchValue === "" ||
      order.orderNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
      order.customerName.toLowerCase().includes(searchValue.toLowerCase()) ||
      order.customerEmail.toLowerCase().includes(searchValue.toLowerCase());

    return matchesSearch;
  });

  // Pagination
  const itemsPerPageNum = parseInt(itemsPerPage);
  const totalPages = Math.ceil(filteredOrders.length / itemsPerPageNum);
  const startIndex = (currentPage - 1) * itemsPerPageNum;
  const endIndex = startIndex + itemsPerPageNum;
  const paginatedOrders = filteredOrders.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  const resetPage = () => setCurrentPage(1);
  useEffect(resetPage, [searchValue, daysThreshold]);

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'completed':
        return 'default';
      case 'in_progress':
        return 'secondary';
      case 'cancelled':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  const getPaymentStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'paid':
        return 'default';
      case 'open':
        return 'secondary';
      case 'partially_paid':
        return 'secondary';
      case 'failed':
      case 'cancelled':
        return 'outline';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="max-w-7xl">
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <AlertTriangle className="h-6 w-6 text-destructive" />
          <h1 className="text-2xl font-semibold" data-testid="text-page-title">{t('delayedOrders.title')}</h1>
        </div>
        <p className="text-sm text-muted-foreground">
          {t('delayedOrders.description')}
        </p>
      </div>

      {/* Statistics Card */}
      <Card className="mb-6">
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            {t('delayedOrders.totalDelayed')}
          </CardTitle>
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold" data-testid="text-delayed-count">{filteredOrders.length}</div>
          <p className="text-xs text-muted-foreground">
            {t('delayedOrders.olderThan', { days: daysThreshold })}
          </p>
        </CardContent>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
          <Input
            placeholder={t('delayedOrders.searchPlaceholder')}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            className="pl-9"
            data-testid="input-search"
          />
        </div>

        <Select value={daysThreshold} onValueChange={setDaysThreshold}>
          <SelectTrigger className="w-[180px]" data-testid="select-days-threshold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1" data-testid="option-days-1">{t('delayedOrders.olderThan', { days: 1 })}</SelectItem>
            <SelectItem value="3" data-testid="option-days-3">{t('delayedOrders.olderThan', { days: 3 })}</SelectItem>
            <SelectItem value="7" data-testid="option-days-7">{t('delayedOrders.olderThan', { days: 7 })}</SelectItem>
            <SelectItem value="14" data-testid="option-days-14">{t('delayedOrders.olderThan', { days: 14 })}</SelectItem>
            <SelectItem value="30" data-testid="option-days-30">{t('delayedOrders.olderThan', { days: 30 })}</SelectItem>
          </SelectContent>
        </Select>

        <Button
          variant="outline"
          onClick={() => refetch()}
          disabled={isLoading}
          data-testid="button-refresh"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center">
              <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-4 text-muted-foreground" />
              <p className="text-muted-foreground">{t('common.loading')}</p>
            </div>
          ) : paginatedOrders.length === 0 ? (
            <div className="p-8 text-center">
              <p className="text-muted-foreground">{t('delayedOrders.noDelayed')}</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b">
                  <tr className="bg-muted/50">
                    <th className="text-left p-3 text-sm font-medium">{t('orders.orderNumber')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('delayedOrders.daysDelayed')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('orders.orderDate')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('orders.customer')}</th>
                    <th className="text-right p-3 text-sm font-medium">{t('orders.totalAmount')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('orders.status')}</th>
                    <th className="text-left p-3 text-sm font-medium">{t('orders.paymentStatus')}</th>
                    <th className="text-right p-3 text-sm font-medium">{t('common.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOrders.map((order, index) => (
                    <tr
                      key={order.id}
                      className="border-b last:border-0 hover-elevate cursor-pointer"
                      onClick={() => {
                        setSelectedOrder(order);
                        setIsModalOpen(true);
                      }}
                      data-testid={`row-order-${index}`}
                    >
                      <td className="p-3">
                        <span className="font-medium" data-testid={`text-order-number-${index}`}>
                          {order.orderNumber}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge variant="destructive" data-testid={`badge-days-${index}`}>
                          {order.daysSinceOrder} {t('delayedOrders.days')}
                        </Badge>
                      </td>
                      <td className="p-3 text-sm text-muted-foreground" data-testid={`text-order-date-${index}`}>
                        {format(new Date(order.orderDate), 'dd.MM.yyyy', { locale: dateLocale })}
                      </td>
                      <td className="p-3">
                        <div>
                          <div className="font-medium text-sm" data-testid={`text-customer-name-${index}`}>
                            {order.customerName}
                          </div>
                          <div className="text-xs text-muted-foreground" data-testid={`text-customer-email-${index}`}>
                            {order.customerEmail}
                          </div>
                        </div>
                      </td>
                      <td className="p-3 text-right font-medium" data-testid={`text-total-${index}`}>
                        €{order.totalAmount.toFixed(2)}
                      </td>
                      <td className="p-3">
                        <Badge variant={getStatusBadgeVariant(order.status)} data-testid={`badge-status-${index}`}>
                          {t(`orderStatus.${order.status}`)}
                        </Badge>
                      </td>
                      <td className="p-3">
                        <Badge variant={getPaymentStatusBadgeVariant(order.paymentStatus)} data-testid={`badge-payment-${index}`}>
                          {t(`paymentStatus.${order.paymentStatus}`)}
                        </Badge>
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedOrder(order);
                            setIsModalOpen(true);
                          }}
                          data-testid={`button-view-${index}`}
                        >
                          {t('common.view')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-6">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('common.rowsPerPage')}:
            </span>
            <Select value={itemsPerPage} onValueChange={(value) => {
              setItemsPerPage(value);
              setCurrentPage(1);
            }}>
              <SelectTrigger className="w-[70px]" data-testid="select-items-per-page">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10</SelectItem>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">
              {t('common.page')} {currentPage} {t('common.of')} {totalPages}
            </span>
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
          </div>
        </div>
      )}

      {/* Order Detail Modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          isOpen={isModalOpen}
          onClose={() => {
            setIsModalOpen(false);
            setSelectedOrder(null);
          }}
          userRole={userRole}
          onUpdateShipping={handleUpdateShipping}
          onUpdateDocuments={handleUpdateDocuments}
        />
      )}
    </div>
  );
}
