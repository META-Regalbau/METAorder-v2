import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShoppingCart } from "lucide-react";
import { Link } from "wouter";
import type { Order } from "@shared/schema";
import { format } from "date-fns";

export default function RecentOrdersWidget() {
  const { t } = useTranslation();

  const { data: orders = [], isLoading } = useQuery<Order[]>({
    queryKey: ["/api/dashboard/recent-orders"],
    retry: false,
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "open":
        return "default";
      case "in_progress":
        return "default";
      case "completed":
      case "cancelled":
        return "secondary";
      default:
        return "secondary";
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

  return (
    <Card data-testid="widget-recent-orders">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.recentOrders")}</CardTitle>
          </div>
          <Link href="/orders">
            <Button variant="ghost" size="sm" data-testid="button-view-all-orders">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.recentOrdersDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : orders.length === 0 ? (
          <div className="text-sm text-muted-foreground">{t("dashboard.noOrders")}</div>
        ) : (
          <div className="space-y-3">
            {orders.slice(0, 5).map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between p-3 border rounded-md"
                data-testid={`order-item-${order.id}`}
              >
                <div className="space-y-1 flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{order.orderNumber}</span>
                    <Badge variant={getStatusColor(order.status)} className="text-xs">
                      {t(`orderStatus.${order.status}`)}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground truncate">{order.customerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(order.orderDate), "dd.MM.yyyy HH:mm")}
                  </div>
                </div>
                <div className="text-sm font-medium">{formatCurrency(order.totalAmount)}</div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
