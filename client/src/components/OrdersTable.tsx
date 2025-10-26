import { Eye, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatusBadge from "./StatusBadge";
import PaymentStatusBadge from "./PaymentStatusBadge";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";

interface OrdersTableProps {
  orders: Order[];
  onViewOrder: (order: Order) => void;
  isLoading?: boolean;
}

export default function OrdersTable({ orders, onViewOrder, isLoading }: OrdersTableProps) {
  const { t, i18n } = useTranslation();
  
  if (isLoading) {
    return (
      <div className="border rounded-lg">
        <div className="p-8 text-center text-muted-foreground">
          <div className="animate-pulse">{t('common.loading')}</div>
        </div>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="border rounded-lg">
        <div className="p-12 text-center">
          <Package className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
          <p className="text-muted-foreground">{t('orders.noOrders')}</p>
          <p className="text-sm text-muted-foreground mt-1">{t('orders.adjustFilters')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="border rounded-lg overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow className="bg-muted/50">
            <TableHead className="font-medium">{t('orders.orderNumber')}</TableHead>
            <TableHead className="font-medium">{t('orders.customer')}</TableHead>
            <TableHead className="font-medium">{t('orders.date')}</TableHead>
            <TableHead className="font-medium">{t('orders.status')}</TableHead>
            <TableHead className="font-medium text-right">{t('orders.total')}</TableHead>
            <TableHead className="font-medium">{t('orders.tracking')}</TableHead>
            <TableHead className="font-medium text-right">{t('orders.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id} className="hover-elevate" data-testid={`row-order-${order.id}`}>
              <TableCell className="font-mono font-medium" data-testid={`text-order-number-${order.id}`}>
                {order.orderNumber}
              </TableCell>
              <TableCell>
                <div>
                  <div className="font-medium">{order.customerName}</div>
                  <div className="text-sm text-muted-foreground">{order.customerEmail}</div>
                </div>
              </TableCell>
              <TableCell className="text-sm">
                {new Date(order.orderDate).toLocaleDateString(i18n.language, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
              </TableCell>
              <TableCell>
                <div className="flex gap-1">
                  <StatusBadge status={order.status} />
                  <PaymentStatusBadge status={order.paymentStatus} orderId={order.id} />
                </div>
              </TableCell>
              <TableCell className="text-right">
                <div>
                  <p className="font-medium">€{(order.totalAmount || 0).toFixed(2)}</p>
                  <p className="text-sm text-muted-foreground">€{(order.netTotalAmount || 0).toFixed(2)} <span className="text-xs">{t('orderDetail.net')}</span></p>
                </div>
              </TableCell>
              <TableCell>
                {order.shippingInfo?.trackingNumber ? (
                  <span className="text-sm font-mono" data-testid={`text-tracking-${order.id}`}>
                    {order.shippingInfo.trackingNumber}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
              <TableCell className="text-right">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onViewOrder(order)}
                  data-testid={`button-view-order-${order.id}`}
                >
                  <Eye className="h-4 w-4 mr-1" />
                  {t('orders.view')}
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
