import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Package, TruckIcon } from "lucide-react";
import { Link } from "wouter";

interface ShippingReadyData {
  total: number;
  orders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    orderDate: string;
    totalAmount: number;
    paymentStatus: string;
    shippingMethod?: string;
  }>;
}

export default function ShippingReadyWidget() {
  const { t } = useTranslation();

  const { data, isLoading } = useQuery<ShippingReadyData>({
    queryKey: ["/api/dashboard/shipping-ready"],
    retry: false,
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

  return (
    <Card data-testid="widget-shipping-ready">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TruckIcon className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.shippingReady")}</CardTitle>
          </div>
          <Link href="/shipping">
            <Button variant="ghost" size="sm" data-testid="button-view-shipping">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.shippingReadyDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : data && data.total > 0 ? (
          <div className="space-y-4">
            <div className="p-3 border rounded-md">
              <div className="flex items-center gap-2">
                <Package className="h-5 w-5 text-primary" />
                <div className="text-2xl font-bold">{data.total}</div>
              </div>
              <div className="text-xs text-muted-foreground">{t("dashboard.readyForShipping")}</div>
            </div>
            {data.orders.length > 0 && (
              <div className="space-y-2">
                {data.orders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-2 border rounded-md"
                    data-testid={`shipping-ready-${order.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{order.orderNumber}</div>
                      <div className="text-xs text-muted-foreground truncate">{order.customerName}</div>
                      {order.shippingMethod && (
                        <div className="text-xs text-muted-foreground">{order.shippingMethod}</div>
                      )}
                    </div>
                    <div className="text-sm font-medium">{formatCurrency(order.totalAmount)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t("dashboard.noShippingReady")}</div>
        )}
      </CardContent>
    </Card>
  );
}
