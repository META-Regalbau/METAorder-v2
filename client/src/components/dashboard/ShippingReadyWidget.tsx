import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
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
    <div className="mcard" data-testid="widget-shipping-ready">
      <div className="mcard-head">
        <div className="mcard-head-left">
          <TruckIcon className="h-5 w-5" />
          <div>
            <h3 className="mcard-title">{t("dashboard.shippingReady")}</h3>
            <p className="mcard-desc">{t("dashboard.shippingReadyDescription")}</p>
          </div>
        </div>
        <Link href="/shipping" className="mbtn ghost sm" data-testid="button-view-shipping">
          {t("common.viewAll")}
        </Link>
      </div>
      <div className="mcard-body">
        {isLoading ? (
          <div className="mloading">{t("common.loading")}</div>
        ) : data && data.total > 0 ? (
          <div className="space-y-4">
            <div className="mstat-box">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <Package className="h-5 w-5" style={{ color: "var(--meta-red)" }} />
                <div className="v">{data.total}</div>
              </div>
              <div className="l">{t("dashboard.readyForShipping")}</div>
            </div>
            {data.orders.length > 0 && (
              <div className="mlist">
                {data.orders.map((order) => (
                  <div className="mrow" key={order.id} data-testid={`shipping-ready-${order.id}`}>
                    <div className="mrow-main">
                      <div className="mrow-title">{order.orderNumber}</div>
                      <div className="mrow-meta">{order.customerName}</div>
                      {order.shippingMethod && (
                        <div className="mrow-meta">{order.shippingMethod}</div>
                      )}
                    </div>
                    <div className="mrow-side">
                      <div className="amt">{formatCurrency(order.totalAmount)}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="mempty">{t("dashboard.noShippingReady")}</div>
        )}
      </div>
    </div>
  );
}
