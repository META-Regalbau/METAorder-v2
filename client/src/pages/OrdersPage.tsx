import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { RefreshCw, Search, ChevronDown, ChevronUp, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import OrderFilters, { type InvoiceFilter, type OrderNumberFilter } from "@/components/OrderFilters";
import OrdersTable from "@/components/OrdersTable";
import OrderDetailModal from "@/components/OrderDetailModal";
import BulkActionsBar from "@/components/BulkActionsBar";
import BulkTrackingDialog from "@/components/BulkTrackingDialog";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { getApiErrorToastContent } from "@/lib/orderApiErrors";
import type { Order, OrderStatus, SalesChannel, User, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";

interface OrdersPageProps {
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

type SortDirection = "asc" | "desc";
type OrderSortKey =
  | "orderNumber"
  | "customerName"
  | "orderDate"
  | "status"
  | "totalAmount"
  | "trackingNumber";

export default function OrdersPage({ userRole, userSalesChannelIds }: OrdersPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location] = useLocation();
  const [searchValue, setSearchValue] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [invoiceFilter, setInvoiceFilter] = useState<InvoiceFilter>("all");
  const [orderNumberFilter, setOrderNumberFilter] = useState<OrderNumberFilter>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState("25");
  const [currentPage, setCurrentPage] = useState(1);
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkTrackingDialogOpen, setIsBulkTrackingDialogOpen] = useState(false);
  const [sortKey, setSortKey] = useState<OrderSortKey>("orderDate");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const searchParam = params.get("search");
    if (searchParam !== null) {
      setSearchValue(searchParam);
      setCurrentPage(1);
    }
  }, [location]);

  // Fetch sales channels to initialize selection
  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
    retry: false,
  });

  // Initialize selected channels based on user permissions
  useEffect(() => {
    if (salesChannels.length > 0 && selectedChannelIds.length === 0) {
      if (userRole === "admin" || !userSalesChannelIds) {
        // Admin sees all channels by default
        setSelectedChannelIds(salesChannels.map(c => c.id));
      } else {
        // Non-admin users see only their assigned channels
        setSelectedChannelIds(userSalesChannelIds);
      }
    }
  }, [salesChannels, userRole, userSalesChannelIds, selectedChannelIds.length]);

  // Fetch orders from Shopware API with sales channel filtering
  const salesChannelQuery = selectedChannelIds.length > 0 ? `?salesChannelIds=${selectedChannelIds.join(',')}` : '';
  const { data: orders = [], isLoading, error, refetch } = useQuery<Order[]>({
    queryKey: ['/api/orders', selectedChannelIds],
    queryFn: async () => {
      const response = await fetch(`/api/orders${salesChannelQuery}`);
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    retry: false,
    enabled: selectedChannelIds.length > 0,
  });

  // Fetch ticket counts for orders
  const { data: ticketCounts = {} } = useQuery<Record<string, number>>({
    queryKey: ['/api/orders/ticket-counts'],
    queryFn: async () => {
      const response = await fetch('/api/orders/ticket-counts', { credentials: 'include' });
      if (response.status === 401) {
        return {};
      }
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    retry: false,
  });

  // Fetch current user to get permissions
  const { data: currentUser } = useQuery<{ user: User & { permissions: Role['permissions'] } }>({
    queryKey: ['/api/auth/me'],
  });

  // Show error if Shopware is not configured
  if (error) {
    const errorMessage = (error as any)?.message || t('errors.loadFailed');
    if (errorMessage.includes('not configured')) {
      return (
        <div className="w-full">
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

  // Filter orders
  const normalizedSearch = searchValue.trim().toLowerCase();
  const filteredOrders = orders
    .filter((order) => {
      const matchesSearch =
        normalizedSearch === "" ||
        order.orderNumber.toLowerCase().includes(normalizedSearch) ||
        order.customerName.toLowerCase().includes(normalizedSearch) ||
        order.customerEmail.toLowerCase().includes(normalizedSearch) ||
        order.invoiceNumber?.toLowerCase().includes(normalizedSearch) ||
        order.erpNumber?.toLowerCase().includes(normalizedSearch);

      const matchesStatus = statusFilter === "all" || order.status === statusFilter;

      const matchesInvoice =
        invoiceFilter === "all" ||
        (invoiceFilter === "with" && !!order.hasInvoiceDocument) ||
        (invoiceFilter === "without" && !order.hasInvoiceDocument) ||
        (invoiceFilter === "unsent" && !!order.hasInvoiceDocument && !order.invoiceSent);

      const matchesDateFrom = dateFrom === "" || new Date(order.orderDate) >= new Date(dateFrom);
      const matchesDateTo = dateTo === "" || new Date(order.orderDate) <= new Date(dateTo);

      const matchesOrderNumber =
        orderNumberFilter === "all" || order.orderNumber.toUpperCase().startsWith("MO");

      return matchesSearch && matchesStatus && matchesInvoice && matchesDateFrom && matchesDateTo && matchesOrderNumber;
    });

  const sortedOrders = [...filteredOrders].sort((a, b) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    switch (sortKey) {
      case "orderNumber":
        return a.orderNumber.localeCompare(b.orderNumber) * direction;
      case "customerName":
        return a.customerName.localeCompare(b.customerName) * direction;
      case "orderDate":
        return (new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime()) * direction;
      case "status":
        return a.status.localeCompare(b.status) * direction;
      case "totalAmount":
        return ((a.totalAmount || 0) - (b.totalAmount || 0)) * direction;
      case "trackingNumber": {
        const aTracking = a.shippingInfo?.trackingNumber || "";
        const bTracking = b.shippingInfo?.trackingNumber || "";
        return aTracking.localeCompare(bTracking) * direction;
      }
      default:
        return 0;
    }
  });

  // Pagination
  const itemsPerPageNum = parseInt(itemsPerPage);
  const totalPages = Math.ceil(sortedOrders.length / itemsPerPageNum);
  const startIndex = (currentPage - 1) * itemsPerPageNum;
  const endIndex = startIndex + itemsPerPageNum;
  const paginatedOrders = sortedOrders.slice(startIndex, endIndex);

  const duplicateOrderIds = useMemo(() => {
    const windowMs = 7 * 24 * 60 * 60 * 1000;
    const groups = new Map<string, Order[]>();
    orders.forEach((order) => {
      const key = `${order.orderNumber}|${order.customerEmail}`.toLowerCase();
      const list = groups.get(key) || [];
      list.push(order);
      groups.set(key, list);
    });
    const duplicates = new Set<string>();
    groups.forEach((group) => {
      if (group.length < 2) return;
      const sorted = [...group].sort((a, b) => new Date(a.orderDate).getTime() - new Date(b.orderDate).getTime());
      for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
          const diff = Math.abs(new Date(sorted[j].orderDate).getTime() - new Date(sorted[i].orderDate).getTime());
          if (diff <= windowMs) {
            duplicates.add(sorted[i].id);
            duplicates.add(sorted[j].id);
          } else {
            break;
          }
        }
      }
    });
    return duplicates;
  }, [orders]);

  // Reset to page 1 when filters change
  const resetPage = () => setCurrentPage(1);

  const activeFiltersCount = [
    statusFilter !== "all",
    invoiceFilter !== "all",
    orderNumberFilter !== "all",
    dateFrom !== "",
    dateTo !== "",
  ].filter(Boolean).length;

  const handleChannelSelectionChange = (channelIds: string[]) => {
    setSelectedChannelIds(channelIds);
    resetPage();
  };

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

  const handleSortChange = (key: OrderSortKey) => {
    setSortKey((current) => {
      if (current === key) {
        setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
        return current;
      }
      setSortDirection("asc");
      return key;
    });
    setCurrentPage(1);
  };

  // Mutation to update shipping information and set status to shipped in Shopware
  const updateShippingMutation = useMutation({
    mutationFn: async ({ orderId, shippingData }: { orderId: string; shippingData: any }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}/shipping`, shippingData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      toast({
        title: t('orderDetail.shippingUpdated'),
        description: t('orderDetail.shippingSuccessWithStatus'),
      });
    },
    onError: (error: Error) => {
      const { title, description } = getApiErrorToastContent(error, t);
      toast({
        title,
        description,
        variant: "destructive",
      });
    },
  });

  const handleUpdateShipping = (orderId: string, data: any) => {
    updateShippingMutation.mutate({ orderId, shippingData: data });
  };

  // Mutation to update document numbers in Shopware
  const updateDocumentsMutation = useMutation({
    mutationFn: async ({ orderId, documentData }: { orderId: string; documentData: any }) => {
      const response = await apiRequest("PATCH", `/api/orders/${orderId}/documents`, documentData);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      toast({
        title: t('orderDetail.documentsUpdated'),
        description: t('orderDetail.documentsSuccess'),
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

  const handleUpdateDocuments = (orderId: string, data: any) => {
    updateDocumentsMutation.mutate({ orderId, documentData: data });
  };

  // Rechnung ueber die Shopware-Funktion verschicken (Dokument per Mail + sent=true)
  const [sendingInvoiceOrderId, setSendingInvoiceOrderId] = useState<string | null>(null);
  // Bestellung, fuer die der Versand-Bestaetigungsdialog offen ist.
  const [pendingSendInvoiceOrder, setPendingSendInvoiceOrder] = useState<Order | null>(null);
  const sendInvoiceMutation = useMutation({
    mutationFn: async ({ orderId, orderNumber }: { orderId: string; orderNumber?: string }) => {
      const response = await apiRequest("POST", `/api/orders/${orderId}/send-invoice`, { orderNumber });
      return response.json();
    },
    onMutate: ({ orderId }) => setSendingInvoiceOrderId(orderId),
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      if (data?.status === 'already_sent') {
        toast({
          title: t('orders.invoiceAlreadySentTitle'),
          description: data?.mondu
            ? t('orders.invoiceAlreadySentMonduDesc')
            : t('orders.invoiceAlreadySentDesc'),
        });
      } else {
        toast({
          title: t('orders.invoiceSentTitle'),
          description: data?.mondu
            ? t('orders.invoiceSentMonduDesc', { number: data?.invoiceNumber ?? '' })
            : t('orders.invoiceSentDesc', { number: data?.invoiceNumber ?? '' }),
        });
      }
    },
    onError: (error: Error) => {
      toast({
        title: t('orders.invoiceSendFailedTitle'),
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => setSendingInvoiceOrderId(null),
  });

  // Klick auf "Verschicken" oeffnet zuerst den Bestaetigungsdialog (kein
  // versehentlicher Mailversand an Kunden).
  const handleSendInvoice = (order: Order) => {
    setPendingSendInvoiceOrder(order);
  };

  const confirmSendInvoice = () => {
    if (!pendingSendInvoiceOrder) return;
    sendInvoiceMutation.mutate({
      orderId: pendingSendInvoiceOrder.id,
      orderNumber: pendingSendInvoiceOrder.orderNumber,
    });
    setPendingSendInvoiceOrder(null);
  };

  const handleToggleOrder = (orderId: string) => {
    setSelectedOrderIds(prev => 
      prev.includes(orderId) 
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const handleToggleAll = () => {
    if (selectedOrderIds.length === paginatedOrders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(paginatedOrders.map(order => order.id));
    }
  };

  const handleCancelSelection = () => {
    setSelectedOrderIds([]);
  };

  const handleBulkUpdateSuccess = () => {
    setSelectedOrderIds([]);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold mb-1">{t('orders.title')}</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading ? t('common.loading') : t('orders.showing', { count: filteredOrders.length, total: orders.length })}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <SalesChannelSelector
            selectedChannelIds={selectedChannelIds}
            onSelectionChange={handleChannelSelectionChange}
            userAllowedChannelIds={userSalesChannelIds}
            isAdmin={userRole === "admin"}
          />
          <Button variant="outline" onClick={handleRefresh} disabled={isLoading} data-testid="button-refresh-orders">
            <RefreshCw className={`h-4 w-4 mr-1 ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{t('common.refresh')}</span>
          </Button>
        </div>
      </div>

      {/* Filters Section */}
      <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
        <div className="space-y-4">
          {/* Search Bar - Always Visible */}
          <div className="flex gap-2">
            <div className="relative flex-1">
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
            <CollapsibleTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="button-toggle-filters">
                <Filter className="h-4 w-4" />
                <span className="hidden sm:inline">{t('common.filters')}</span>
                {activeFiltersCount > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded-full">
                    {activeFiltersCount}
                  </span>
                )}
                {filtersOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </Button>
            </CollapsibleTrigger>
          </div>

          {/* Collapsible Filter Panel */}
          <CollapsibleContent>
            <OrderFilters
              statusFilter={statusFilter}
              onStatusFilterChange={(value) => {
                setStatusFilter(value as OrderStatus | "all");
                resetPage();
              }}
              invoiceFilter={invoiceFilter}
              onInvoiceFilterChange={(value) => {
                setInvoiceFilter(value);
                resetPage();
              }}
              orderNumberFilter={orderNumberFilter}
              onOrderNumberFilterChange={(value) => {
                setOrderNumberFilter(value);
                resetPage();
              }}
              dateFrom={dateFrom}
              dateTo={dateTo}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              onClearFilters={() => {
                setStatusFilter("all");
                setInvoiceFilter("all");
                setOrderNumberFilter("all");
                setDateFrom("");
                setDateTo("");
                setSearchValue("");
                resetPage();
              }}
              activeFiltersCount={activeFiltersCount}
            />
          </CollapsibleContent>
        </div>
      </Collapsible>

      {/* Orders Table */}
      <div>
        <OrdersTable
          orders={paginatedOrders}
          onViewOrder={handleViewOrder}
          isLoading={isLoading}
          ticketCounts={ticketCounts}
          duplicateOrderIds={duplicateOrderIds}
          selectedOrderIds={selectedOrderIds}
          onToggleOrder={handleToggleOrder}
          onToggleAll={handleToggleAll}
          sortKey={sortKey}
          sortDirection={sortDirection}
          onSortChange={handleSortChange}
          onSendInvoice={handleSendInvoice}
          sendingInvoiceOrderId={sendingInvoiceOrderId}
        />
      </div>

      {/* Pagination */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
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
          <div className="flex flex-col sm:flex-row items-center gap-2">
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
                <span className="hidden sm:inline">{t('common.first')}</span>
                <span className="sm:hidden">«</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage - 1)}
                disabled={currentPage === 1}
                data-testid="button-prev-page"
              >
                <span className="hidden sm:inline">{t('common.previous')}</span>
                <span className="sm:hidden">‹</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(currentPage + 1)}
                disabled={currentPage === totalPages}
                data-testid="button-next-page"
              >
                <span className="hidden sm:inline">{t('common.next')}</span>
                <span className="sm:hidden">›</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                data-testid="button-last-page"
              >
                <span className="hidden sm:inline">{t('common.last')}</span>
                <span className="sm:hidden">»</span>
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
        userPermissions={currentUser?.user?.permissions}
        canManageCrm={currentUser?.user?.permissions?.manageCrm || false}
        canApproveCrm={currentUser?.user?.permissions?.approveCrm || false}
        hasDuplicate={selectedOrder ? duplicateOrderIds.has(selectedOrder.id) : false}
        onUpdateShipping={handleUpdateShipping}
        onUpdateDocuments={handleUpdateDocuments}
      />

      <BulkActionsBar
        selectedCount={selectedOrderIds.length}
        onUpdateTracking={() => setIsBulkTrackingDialogOpen(true)}
        onCancel={handleCancelSelection}
      />

      <BulkTrackingDialog
        isOpen={isBulkTrackingDialogOpen}
        onClose={() => setIsBulkTrackingDialogOpen(false)}
        selectedOrders={orders.filter(order => selectedOrderIds.includes(order.id))}
        onSuccess={handleBulkUpdateSuccess}
      />

      <AlertDialog
        open={!!pendingSendInvoiceOrder}
        onOpenChange={(open) => {
          if (!open) setPendingSendInvoiceOrder(null);
        }}
      >
        <AlertDialogContent data-testid="dialog-send-invoice">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('orders.sendInvoiceConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('orders.sendInvoiceConfirmDesc', {
                orderNumber: pendingSendInvoiceOrder?.orderNumber ?? '',
                customer: pendingSendInvoiceOrder?.customerName ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-send-invoice">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmSendInvoice}
              data-testid="button-confirm-send-invoice"
            >
              {t('orders.sendInvoice')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
