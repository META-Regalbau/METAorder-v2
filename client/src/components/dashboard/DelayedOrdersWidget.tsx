import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
    <div className="mcard" data-testid="widget-delayed-orders">
      <div className="mcard-head">
        <div className="mcard-head-left">
          <Clock className="h-5 w-5" />
          <div>
            <h3 className="mcard-title">{t("dashboard.delayedOrders")}</h3>
            <p className="mcard-desc">{t("dashboard.delayedOrdersDescription")}</p>
          </div>
        </div>
        <Link href="/delayed" className="mbtn ghost sm" data-testid="button-view-delayed-orders">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : summary && summary.total > 0 ? (
          <div className="space-y-4">
            <div style={{ display: "flex", gap: 12 }}>
              <div className="mstat-box" style={{ flex: 1 }}>
                <div className="v">{summary.total}</div>
                <div className="l">{t("dashboard.totalDelayed")}</div>
              </div>
              <div className="mstat-box" style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div className="v danger">{summary.critical}</div>
                  <AlertTriangle className="h-4 w-4" style={{ color: "var(--meta-red)" }} />
                </div>
                <div className="l">{t("dashboard.critical")}</div>
              </div>
            </div>
            {summary.recentOrders.length > 0 && (
              <div className="mlist">
                {summary.recentOrders.map((order) => (
                  <div className="mrow" key={order.id} data-testid={`delayed-order-${order.id}`}>
                    <div className="mrow-main">
                      <div className="mrow-title">{order.orderNumber}</div>
                      <div className="mrow-meta">{order.customerName}</div>
                    </div>
                    <div className="mrow-side">
                      <span className="mbadge b-destructive">{order.daysDelayed}d</span>
                      <div className="amt">{formatCurrency(order.totalAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mempty">{t("dashboard.noDelayedOrders")}</div>
        )}
      </div>
    </div>
  );
}
