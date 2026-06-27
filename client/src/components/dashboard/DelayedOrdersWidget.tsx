import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle } from "lucide-react";
import { Link } from "wouter";

interface DelayedOrdersSummary {
  total: number;
  critical: number;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    customerName: string;
    orderDate: string;
    totalAmount: number;
    status: string;
    daysDelayed: number;
  }>;
}

export default function DelayedOrdersWidget() {
  const { t } = useTranslation();

  const { data: summary, isLoading } = useQuery<DelayedOrdersSummary>({
    queryKey: ["/api/dashboard/delayed-orders-summary"],
    retry: false,
  });

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

  return (
    <Card data-testid="widget-delayed-orders">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <CardTitle>{t("dashboard.delayedOrders")}</CardTitle>
          </div>
          <Link href="/delayed">
            <Button variant="ghost" size="sm" data-testid="button-view-delayed-orders">
              {t("common.viewAll")}
            </Button>
          </Link>
        </div>
        <CardDescription>{t("dashboard.delayedOrdersDescription")}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
        ) : summary && summary.total > 0 ? (
          <div className="space-y-4">
            <div className="flex gap-4">
              <div className="flex-1 p-3 border rounded-md">
                <div className="text-2xl font-bold">{summary.total}</div>
                <div className="text-xs text-muted-foreground">{t("dashboard.totalDelayed")}</div>
              </div>
              <div className="flex-1 p-3 border rounded-md">
                <div className="flex items-center gap-2">
                  <div className="text-2xl font-bold text-destructive">{summary.critical}</div>
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                </div>
                <div className="text-xs text-muted-foreground">{t("dashboard.critical")}</div>
              </div>
            </div>
            {summary.recentOrders.length > 0 && (
              <div className="space-y-2">
                {summary.recentOrders.map((order) => (
                  <div
                    key={order.id}
                    className="flex items-center justify-between p-2 border rounded-md"
                    data-testid={`delayed-order-${order.id}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{order.orderNumber}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {order.customerName}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="destructive" className="text-xs">
                        {order.daysDelayed}d
                      </Badge>
                      <div className="text-sm font-medium">{formatCurrency(order.totalAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">{t("dashboard.noDelayedOrders")}</div>
        )}
      </CardContent>
    </Card>
  );
}
