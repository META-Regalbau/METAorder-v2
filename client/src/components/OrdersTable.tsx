import { Eye, Package, Ticket, AlertTriangle, FileCheck2, FileClock, FileMinus, Send, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import StatusBadge from "./StatusBadge";
import PaymentStatusBadge from "./PaymentStatusBadge";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";
import SortableTableHead from "@/components/SortableTableHead";

interface OrdersTableProps {
  orders: Order[];
  onViewOrder: (order: Order) => void;
  isLoading?: boolean;
  ticketCounts?: Record<string, number>;
  duplicateOrderIds?: Set<string>;
  selectedOrderIds?: string[];
  onToggleOrder?: (orderId: string) => void;
  onToggleAll?: () => void;
  sortKey?: OrdersSortKey;
  sortDirection?: SortDirection;
  onSortChange?: (key: OrdersSortKey) => void;
  onSendInvoice?: (order: Order) => void;
  sendingInvoiceOrderId?: string | null;
}

type SortDirection = "asc" | "desc";
type OrdersSortKey =
  | "orderNumber"
  | "customerName"
  | "orderDate"
  | "status"
  | "totalAmount"
  | "trackingNumber";

export default function OrdersTable({ 
  orders, 
  onViewOrder, 
  isLoading, 
  ticketCounts = {},
  duplicateOrderIds,
  selectedOrderIds = [],
  onToggleOrder,
  onToggleAll,
  sortKey,
  sortDirection,
  onSortChange,
  onSendInvoice,
  sendingInvoiceOrderId,
}: OrdersTableProps) {
  const { t, i18n } = useTranslation();
  
  const showCheckboxes = !!onToggleOrder;
  const allSelected = showCheckboxes && orders.length > 0 && orders.every(o => selectedOrderIds.includes(o.id));
  const someSelected = showCheckboxes && selectedOrderIds.length > 0 && !allSelected;
  
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
            {showCheckboxes && (
              <TableHead className="w-12">
                <Checkbox
                  checked={allSelected || someSelected}
                  onCheckedChange={onToggleAll}
                  aria-label="Select all orders"
                  data-testid="checkbox-select-all"
                />
              </TableHead>
            )}
            <SortableTableHead
              label={t('orders.orderNumber')}
              sortKey="orderNumber"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
            />
            <SortableTableHead
              label={t('orders.customer')}
              sortKey="customerName"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
            />
            <SortableTableHead
              label={t('orders.date')}
              sortKey="orderDate"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
            />
            <SortableTableHead
              label={t('orders.status')}
              sortKey="status"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
            />
            <SortableTableHead
              label={t('orders.total')}
              sortKey="totalAmount"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
              align="right"
              className="text-right"
            />
            <SortableTableHead
              label={t('orders.tracking')}
              sortKey="trackingNumber"
              activeKey={sortKey}
              direction={sortDirection}
              onSort={onSortChange}
            />
            <TableHead className="font-medium">{t('orders.invoice')}</TableHead>
            <TableHead className="font-medium text-right">{t('orders.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {orders.map((order) => (
            <TableRow key={order.id} className="hover-elevate" data-testid={`row-order-${order.id}`}>
              {showCheckboxes && (
                <TableCell>
                  <Checkbox
                    checked={selectedOrderIds.includes(order.id)}
                    onCheckedChange={() => onToggleOrder(order.id)}
                    aria-label={`Select order ${order.orderNumber}`}
                    data-testid={`checkbox-order-${order.id}`}
                  />
                </TableCell>
              )}
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
                <div className="flex gap-1 flex-wrap">
                  <StatusBadge status={order.status} />
                  <PaymentStatusBadge status={order.paymentStatus} orderId={order.id} />
                  {duplicateOrderIds?.has(order.id) && (
                    <Badge variant="destructive" className="gap-1" data-testid={`badge-duplicate-${order.id}`}>
                      <AlertTriangle className="h-3 w-3" />
                      {t('orders.duplicate')}
                    </Badge>
                  )}
                  {ticketCounts[order.id] > 0 && (
                    <Badge variant="outline" className="gap-1" data-testid={`badge-tickets-${order.id}`}>
                      <Ticket className="h-3 w-3" />
                      {ticketCounts[order.id]}
                    </Badge>
                  )}
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
              <TableCell>
                <div className="flex items-center gap-2">
                  <InvoiceStatusBadge order={order} t={t} />
                  {onSendInvoice && order.hasInvoiceDocument && !order.invoiceSent ? (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 px-2"
                      disabled={sendingInvoiceOrderId === order.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendInvoice(order);
                      }}
                      data-testid={`button-send-invoice-${order.id}`}
                    >
                      {sendingInvoiceOrderId === order.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Send className="h-3 w-3" />
                      )}
                      {t("orders.sendInvoice")}
                    </Button>
                  ) : null}
                </div>
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

function InvoiceStatusBadge({
  order,
  t,
}: {
  order: Order;
  t: (key: string, opts?: any) => string;
}) {
  if (!order.hasInvoiceDocument) {
    return (
      <Badge
        variant="outline"
        className="gap-1 text-muted-foreground"
        data-testid={`badge-invoice-none-${order.id}`}
      >
        <FileMinus className="h-3 w-3" />
        {t("orders.invoiceNone")}
      </Badge>
    );
  }

  const count = order.invoiceDocumentCount ?? 1;
  const suffix = count > 1 ? ` (${count})` : "";

  if (order.invoiceSent) {
    return (
      <Badge
        className="gap-1 border-transparent bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
        data-testid={`badge-invoice-sent-${order.id}`}
      >
        <FileCheck2 className="h-3 w-3" />
        {t("orders.invoiceSent")}
        {suffix}
      </Badge>
    );
  }

  return (
    <Badge
      className="gap-1 border-transparent bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
      data-testid={`badge-invoice-unsent-${order.id}`}
    >
      <FileClock className="h-3 w-3" />
      {t("orders.invoiceNotSent")}
      {suffix}
    </Badge>
  );
}
