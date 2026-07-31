import { useTranslation } from "react-i18next";
import { Ticket, Package, TrendingUp, Truck } from "lucide-react";
import { Link } from "wouter";
import type { Role } from "@shared/schema";

interface QuickActionsWidgetProps {
  userPermissions: Role["permissions"];
}

export default function QuickActionsWidget({ userPermissions }: QuickActionsWidgetProps) {
  const { t } = useTranslation();

  const actions = [
    {
      icon: Ticket,
      label: t("dashboard.actions.newTicket"),
      href: "/tickets",
      show: userPermissions.manageTickets,
      variant: "default" as const,
    },
    {
      icon: Package,
      label: t("dashboard.actions.viewOrders"),
      href: "/orders",
      show: userPermissions.viewOrders,
      variant: "outline" as const,
    },
    {
      icon: Truck,
      label: t("dashboard.actions.shipping"),
      href: "/shipping",
      show: userPermissions.viewShipping,
      variant: "outline" as const,
    },
    {
      icon: TrendingUp,
      label: t("dashboard.actions.analytics"),
      href: "/analytics",
      show: userPermissions.viewAnalytics,
      variant: "outline" as const,
    },
  ];

  const visibleActions = actions.filter((action) => action.show);

  if (visibleActions.length === 0) {
    return null;
  }

  return (
    <div className="mcard" data-testid="widget-quick-actions">
      <div className="mcard-head">
        <div>
          <h3 className="mcard-title">{t("dashboard.quickActions")}</h3>
          <p className="mcard-desc">{t("dashboard.quickActionsDescription")}</p>
        </div>
      </div>
      <div className="mcard-body">
        <div className="flex flex-wrap gap-2">
          {visibleActions.map((action) => {
            const Icon = action.icon;
            return (
              <Link
                key={action.href}
                href={action.href}
                className={action.variant === "default" ? "mbtn primary" : "mbtn"}
              >
                <Icon className="h-4 w-4" />
                {action.label}
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
