import { useState } from "react";
import { Truck, Forklift, Construction } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import OrderDetailModal from "@/components/OrderDetailModal";
import { useQuery } from "@tanstack/react-query";
import type { Order, Role } from "@shared/schema";
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

  const { data: orders = [], isLoading, error } = useQuery<ShippingOrder[]>({
    queryKey: ['/api/shipping'],
    retry: false,
    enabled: userPermissions?.viewShipping === true,
  });

  const handleViewDetails = (order: ShippingOrder) => {
    setSelectedOrder(order);
    setIsModalOpen(true);
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedOrder(null);
  };

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
          {t('orders.showing', { count: orders.length, total: orders.length })}
        </p>
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
      ) : orders.length === 0 ? (
        <Card className="p-8">
          <div className="text-center">
            <Truck className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground" data-testid="text-no-orders">
              {t('orders.noOrders')}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead data-testid="header-order-number">{t('orders.orderNumber')}</TableHead>
                <TableHead data-testid="header-customer">{t('orders.customer')}</TableHead>
                <TableHead data-testid="header-date">{t('orders.date')}</TableHead>
                <TableHead data-testid="header-total">{t('orders.total')}</TableHead>
                <TableHead data-testid="header-sales-channel">{t('salesChannel.filter')}</TableHead>
                <TableHead data-testid="header-equipment">{t('shipping.equipment')}</TableHead>
                <TableHead data-testid="header-actions">{t('common.actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((order) => (
                <TableRow key={order.id} data-testid={`row-order-${order.id}`}>
                  <TableCell className="font-mono font-medium" data-testid={`text-order-number-${order.id}`}>
                    {order.orderNumber}
                  </TableCell>
                  <TableCell data-testid={`text-customer-${order.id}`}>
                    {order.customerFirstName} {order.customerLastName}
                  </TableCell>
                  <TableCell data-testid={`text-date-${order.id}`}>
                    {format(new Date(order.orderDate), 'dd.MM.yyyy HH:mm')}
                  </TableCell>
                  <TableCell data-testid={`text-total-${order.id}`}>
                    €{(order.amountTotal || 0).toFixed(2)}
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
