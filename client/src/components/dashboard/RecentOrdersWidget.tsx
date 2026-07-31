import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
        return "b-default";
      case "in_progress":
        return "b-default";
      case "completed":
      case "cancelled":
        return "b-outline";
      default:
        return "b-outline";
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(amount);

  return (
    <div className="mcard" data-testid="widget-recent-orders">
      <div className="mcard-head">
        <div className="mcard-head-left">
          <ShoppingCart className="h-5 w-5" />
          <div>
            <h3 className="mcard-title">{t("dashboard.recentOrders")}</h3>
            <p className="mcard-desc">{t("dashboard.recentOrdersDescription")}</p>
          </div>
        </div>
        <Link href="/orders" className="mbtn ghost sm" data-testid="button-view-all-orders">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : orders.length === 0 ? (
          <div className="mempty">{t("dashboard.noOrders")}</div>
        ) : (
          <div className="mlist">
            {orders.slice(0, 5).map((order) => (
              <div className="mrow" key={order.id} data-testid={`order-item-${order.id}`}>
                <div className="mrow-main">
                  <div className="mrow-title">
                    {order.orderNumber}
                    <span className={`mbadge ${getStatusColor(order.status)}`}>
                      {t(`orderStatus.${order.status}`)}
                    </span>
                  </div>
                  <div className="mrow-meta">
                    <span>{order.customerName}</span>
                    <span>{format(new Date(order.orderDate), "dd.MM.yyyy HH:mm")}</span>
                  </div>
                </div>
                <div className="mrow-side">
                  <div className="amt">{formatCurrency(order.totalAmount)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
