import { useState } from "react";
import { Truck, Forklift, Construction, Search, Filter, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import OrderDetailModal from "@/components/OrderDetailModal";
import BulkActionsBar from "@/components/BulkActionsBar";
import BulkTrackingDialog from "@/components/BulkTrackingDialog";
import { useQuery } from "@tanstack/react-query";
import type { Order, Role, SalesChannel } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";

interface ShippingOrder extends Order {
  requiresMitnahmestapler?: boolean;
  requiresHebebuehne?: boolean;
}

interface ShippingPageProps {
  userRole?: "employee" | "admin";
  userPermissions?: Role['permissions'];
}

export default function ShippingPage({ userRole = "employee", userPermissions }: ShippingPageProps) {
  const { t } = useTranslation();
  const [selectedOrder, setSelectedOrder] = useState<ShippingOrder | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [searchValue, setSearchValue] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("all");
  const [equipmentFilter, setEquipmentFilter] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedOrderIds, setSelectedOrderIds] = useState<string[]>([]);
  const [isBulkTrackingDialogOpen, setIsBulkTrackingDialogOpen] = useState(false);

  const { data: orders = [], isLoading, error } = useQuery<ShippingOrder[]>({
    queryKey: ['/api/shipping'],
    retry: false,
    enabled: userPermissions?.viewShipping === true,
  });

  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
    retry: false,
  });

  const handleViewDetails = (order: ShippingOrder) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedOrder(null);
  };

  const toggleOrderSelection = (orderId: string) => {
    setSelectedOrderIds(prev =>
      prev.includes(orderId)
        ? prev.filter(id => id !== orderId)
        : [...prev, orderId]
    );
  };

  const toggleAllOrders = () => {
    if (selectedOrderIds.length === filteredOrders.length) {
      setSelectedOrderIds([]);
    } else {
      setSelectedOrderIds(filteredOrders.map(order => order.id));
    }
  };

  const handleBulkTrackingSuccess = () => {
    setSelectedOrderIds([]);
  };

  // Filter orders
  const filteredOrders = orders
    .filter((order) => {
      const matchesSearch =
        searchValue === "" ||
        order.orderNumber.toLowerCase().includes(searchValue.toLowerCase()) ||
        order.customerName.toLowerCase().includes(searchValue.toLowerCase()) ||
        (order.billingAddress?.company && order.billingAddress.company.toLowerCase().includes(searchValue.toLowerCase())) ||
        (order.shippingAddress?.company && order.shippingAddress.company.toLowerCase().includes(searchValue.toLowerCase()));

      const matchesChannel =
        selectedChannelId === "all" || order.salesChannelId === selectedChannelId;

      const matchesEquipment =
        equipmentFilter === "all" ||
        (equipmentFilter === "mitnahmestapler" && order.requiresMitnahmestapler) ||
        (equipmentFilter === "hebebuehne" && order.requiresHebebuehne) ||
        (equipmentFilter === "none" && !order.requiresMitnahmestapler && !order.requiresHebebuehne);

      return matchesSearch && matchesChannel && matchesEquipment;
    })
    .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  const selectedOrders = filteredOrders.filter(order => selectedOrderIds.includes(order.id));

  const activeFiltersCount = [
    searchValue !== "",
    selectedChannelId !== "all",
    equipmentFilter !== "all",
  ].filter(Boolean).length;

  if (!userPermissions?.viewShipping) {
    return (
      <div className="w-full max-w-screen-2xl mx-auto">
        <Card className="p-8">
          <div className="text-center">
            <Truck className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h2 className="text-lg font-semibold mb-2">{t('common.accessDenied')}</h2>
            <p className="text-muted-foreground">
              {t('common.noPermission')}
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="w-full max-w-screen-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" data-testid="text-shipping-title">
          {t('shipping.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('orders.showing', { count: filteredOrders.length, total: orders.length })}
        </p>
      </div>

      {/* Search and Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder={t('orders.searchPlaceholder')}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="pl-10"
              data-testid="input-search"
            />
          </div>
          <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" data-testid="button-toggle-filters">
                <Filter className="h-4 w-4 mr-2" />
                {t('filters.title')}
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFiltersCount}
                  </Badge>
                )}
                {filtersOpen ? (
                  <ChevronUp className="h-4 w-4 ml-2" />
                ) : (
                  <ChevronDown className="h-4 w-4 ml-2" />
                )}
              </Button>
            </CollapsibleTrigger>
          </Collapsible>
        </div>

        <Collapsible open={filtersOpen} onOpenChange={setFiltersOpen}>
          <CollapsibleContent>
            <Card className="p-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('salesChannel.filter')}
                  </label>
                  <Select
                    value={selectedChannelId}
                    onValueChange={setSelectedChannelId}
                  >
                    <SelectTrigger data-testid="select-sales-channel">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
                      {salesChannels.map((channel) => (
                        <SelectItem key={channel.id} value={channel.id}>
                          {channel.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <label className="text-sm font-medium mb-2 block">
                    {t('shipping.equipment')}
                  </label>
                  <Select
                    value={equipmentFilter}
                    onValueChange={setEquipmentFilter}
                  >
                    <SelectTrigger data-testid="select-equipment">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{t('filters.allStatuses')}</SelectItem>
                      <SelectItem value="mitnahmestapler">{t('shipping.mitnahmestapler')}</SelectItem>
                      <SelectItem value="hebebuehne">{t('shipping.hebebuehne')}</SelectItem>
                      <SelectItem value="none">{t('shipping.noEquipment')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {activeFiltersCount > 0 && (
                <div className="mt-4 pt-4 border-t">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSearchValue("");
                      setSelectedChannelId("all");
                      setEquipmentFilter("all");
                    }}
                    data-testid="button-clear-filters"
                  >
                    {t('filters.clearAll')}
                  </Button>
                </div>
              )}
            </Card>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {error ? (
        <Card className="p-8">
          <div className="text-center">
            <Truck className="h-12 w-12 mx-auto mb-4 text-destructive" />
            <h2 className="text-lg font-semibold mb-2 text-destructive">{t('common.error')}</h2>
            <p className="text-muted-foreground">
              {t('common.errorLoadingData')}
            </p>
          </div>
        </Card>
      ) : isLoading ? (
        <Card className="p-8">
          <div className="text-center text-muted-foreground" data-testid="text-loading">
            {t('common.loading')}
          </div>
        </Card>
      ) : filteredOrders.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <Truck className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-no-orders">
              {orders.length === 0 ? t('orders.noOrders') : t('orders.adjustFilters')}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">
                  <Checkbox
                    checked={selectedOrderIds.length === filteredOrders.length && filteredOrders.length > 0}
                    onCheckedChange={toggleAllOrders}
                    data-testid="checkbox-select-all"
                  />
                </TableHead>
                <TableHead data-testid="header-order-number">{t('orders.orderNumber')}</TableHead>
                <TableHead data-testid="header-company">{t('orders.company')}</TableHead>
                <TableHead data-testid="header-customer">{t('orders.customer')}</TableHead>
                <TableHead data-testid="header-date">{t('orders.date')}</TableHead>
                <TableHead data-testid="header-sales-channel">{t('salesChannel.filter')}</TableHead>
                <TableHead data-testid="header-equipment">{t('shipping.equipment')}</TableHead>
                <TableHead data-testid="header-actions">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredOrders.map((order) => (
                <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                  <TableCell>
                    <Checkbox
                      checked={selectedOrderIds.includes(order.id)}
                      onCheckedChange={() => toggleOrderSelection(order.id)}
                      data-testid={`checkbox-${order.id}`}
                    />
                  </TableCell>
                  <TableCell className="font-mono font-medium" data-testid={`text-order-number-${order.id}`}>
                    {order.orderNumber}
                  </TableCell>
                  <TableCell data-testid={`text-company-${order.id}`}>
                    {order.billingAddress?.company || order.shippingAddress?.company || '-'}
                  </TableCell>
                  <TableCell data-testid={`text-customer-${order.id}`}>
                    {order.customerName}
                  </TableCell>
                  <TableCell data-testid={`text-date-${order.id}`}>
                    {format(new Date(order.orderDate), 'dd.MM.yyyy HH:mm')}
                  </TableCell>
                  <TableCell data-testid={`text-sales-channel-${order.id}`}>
                    {order.salesChannelName || '-'}
                  </TableCell>
                  <TableCell data-testid={`cell-equipment-${order.id}`}>
                    <div className="flex gap-2 flex-wrap">
                      {order.requiresMitnahmestapler && (
                        <Badge variant="secondary" className="gap-1" data-testid={`badge-mitnahmestapler-${order.id}`}>
                          <Forklift className="h-3 w-3" />
                          {t('shipping.mitnahmestapler')}
                        </Badge>
                      )}
                      {order.requiresHebebuehne && (
                        <Badge variant="secondary" className="gap-1" data-testid={`badge-hebebuehne-${order.id}`}>
                          <Construction className="h-3 w-3" />
                          {t('shipping.hebebuehne')}
                        </Badge>
                      )}
                      {!order.requiresMitnahmestapler && !order.requiresHebebuehne && (
                        <span className="text-sm text-muted-foreground" data-testid={`text-no-equipment-${order.id}`}>
                          {t('shipping.noEquipment')}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleViewDetails(order)}
                      data-testid={`button-view-details-${order.id}`}
                    >
                      {t('tickets.viewDetails')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <BulkActionsBar
        selectedCount={selectedOrderIds.length}
        onUpdateTracking={() => setIsBulkTrackingDialogOpen(true)}
        onCancel={() => setSelectedOrderIds([])}
      />

      <BulkTrackingDialog
        isOpen={isBulkTrackingDialogOpen}
        onClose={() => setIsBulkTrackingDialogOpen(false)}
        selectedOrders={selectedOrders}
        onSuccess={handleBulkTrackingSuccess}
      />

      <OrderDetailModal
        order={selectedOrder}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        userRole={userRole}
        userPermissions={userPermissions}
        onUpdateShipping={() => {}}
        onUpdateDocuments={() => {}}
      />
    </div>
  );
}
