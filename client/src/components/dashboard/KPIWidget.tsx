import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
          <div className="mstat" key={i}>
            <div className="mstat-head">
              <span className="mstat-label-top">{t("common.loading")}</span>
            </div>
            <div className="mstat-value">-</div>
          </div>
        ))}
      </>
    );
  }

  return (
    <>
      {userPermissions.viewTickets && (
        <div className="mstat" data-testid="kpi-open-tickets">
          <div className="mstat-head">
            <span className="mstat-label-top">{t("dashboard.kpi.openTickets")}</span>
            <Ticket className="h-4 w-4" />
          </div>
          <div className="mstat-value" data-testid="value-open-tickets">
            {kpis?.tickets.open || 0}
          </div>
          <p className="mstat-sub">
            {t("dashboard.kpi.totalTickets", { count: kpis?.tickets.total || 0 })}
          </p>
        </div>
      )}

      {userPermissions.viewTickets && (
        <div className="mstat" data-testid="kpi-high-priority-tickets">
          <div className="mstat-head">
            <span className="mstat-label-top">{t("dashboard.kpi.highPriorityTickets")}</span>
            <AlertTriangle className="h-4 w-4" style={{ color: "var(--meta-red)" }} />
          </div>
          <div className="mstat-value danger" data-testid="value-high-priority-tickets">
            {kpis?.tickets.highPriority || 0}
          </div>
          <p className="mstat-sub">{t("dashboard.kpi.requiresAttention")}</p>
        </div>
      )}

      {userPermissions.viewOrders && kpis?.orders && (
        <div className="mstat" data-testid="kpi-orders-today">
          <div className="mstat-head">
            <span className="mstat-label-top">{t("dashboard.kpi.ordersToday")}</span>
            <ShoppingBag className="h-4 w-4" />
          </div>
          <div className="mstat-value" data-testid="value-orders-today">
            {kpis.orders.today}
          </div>
          <p className="mstat-sub">
            {t("dashboard.kpi.openOrders", { count: kpis.orders.open })}
          </p>
        </div>
      )}

      {userPermissions.viewDelayedOrders && kpis?.orders && (
        <div className="mstat" data-testid="kpi-delayed-orders">
          <div className="mstat-head">
            <span className="mstat-label-top">{t("dashboard.kpi.delayedOrders")}</span>
            <Clock className="h-4 w-4" />
          </div>
          <div className="mstat-value" data-testid="value-delayed-orders">
            {kpis.orders.delayed}
          </div>
          <p className="mstat-sub">{t("dashboard.kpi.needsAttention")}</p>
        </div>
      )}
    </>
  );
}
