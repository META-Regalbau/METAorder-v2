import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Ticket, ShoppingBag, Clock, AlertTriangle } from "lucide-react";
import type { Role } from "@shared/schema";

interface KPIData {
  tickets: {
    total: number;
    open: number;
    highPriority: number;
  };
  orders: {
    today: number;
    open: number;
    delayed: number;
  } | null;
}

interface KPIWidgetProps {
  userPermissions: Role["permissions"];
}

export default function KPIWidget({ userPermissions }: KPIWidgetProps) {
  const { t } = useTranslation();

  const { data: kpis, isLoading } = useQuery<KPIData>({
    queryKey: ["/api/dashboard/kpis"],
    retry: false,
  });

  if (isLoading) {
    return (
      <>
        {[1, 2, 3, 4].map((i) => (
          <Card key={i}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{t("common.loading")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">-</div>
            </CardContent>
          </Card>
        ))}
      </>
    );
  }

  return (
    <>
      {userPermissions.viewTickets && (
        <Card data-testid="kpi-open-tickets">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.kpi.openTickets")}</CardTitle>
            <Ticket className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="value-open-tickets">
              {kpis?.tickets.open || 0}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.kpi.totalTickets", { count: kpis?.tickets.total || 0 })}
            </p>
          </CardContent>
        </Card>
      )}

      {userPermissions.viewTickets && (
        <Card data-testid="kpi-high-priority-tickets">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.kpi.highPriorityTickets")}</CardTitle>
            <AlertTriangle className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-destructive" data-testid="value-high-priority-tickets">
              {kpis?.tickets.highPriority || 0}
            </div>
            <p className="text-xs text-muted-foreground">{t("dashboard.kpi.requiresAttention")}</p>
          </CardContent>
        </Card>
      )}

      {userPermissions.viewOrders && kpis?.orders && (
        <Card data-testid="kpi-orders-today">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.kpi.ordersToday")}</CardTitle>
            <ShoppingBag className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="value-orders-today">
              {kpis.orders.today}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("dashboard.kpi.openOrders", { count: kpis.orders.open })}
            </p>
          </CardContent>
        </Card>
      )}

      {userPermissions.viewDelayedOrders && kpis?.orders && (
        <Card data-testid="kpi-delayed-orders">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t("dashboard.kpi.delayedOrders")}</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="value-delayed-orders">
              {kpis.orders.delayed}
            </div>
            <p className="text-xs text-muted-foreground">{t("dashboard.kpi.needsAttention")}</p>
          </CardContent>
        </Card>
      )}
    </>
  );
}
