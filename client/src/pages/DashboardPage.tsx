import { useTranslation } from "react-i18next";
import type { Role } from "@shared/schema";
import MyTicketsWidget from "@/components/dashboard/MyTicketsWidget";
import RecentCommentsWidget from "@/components/dashboard/RecentCommentsWidget";
import RecentCrmInteractionsWidget from "@/components/dashboard/RecentCrmInteractionsWidget";
import RecentOrdersWidget from "@/components/dashboard/RecentOrdersWidget";
import KPIWidget from "@/components/dashboard/KPIWidget";
import DelayedOrdersWidget from "@/components/dashboard/DelayedOrdersWidget";
import ShippingReadyWidget from "@/components/dashboard/ShippingReadyWidget";
import QuickActionsWidget from "@/components/dashboard/QuickActionsWidget";
import CommercialDraftQuickUploadWidget from "@/components/dashboard/CommercialDraftQuickUploadWidget";
import ImportedCommercialInquiriesWidget from "@/components/dashboard/ImportedCommercialInquiriesWidget";
import ProcessUpdatesWidget from "@/components/dashboard/ProcessUpdatesWidget";

interface DashboardPageProps {
  userPermissions: Role["permissions"];
}

export default function DashboardPage({ userPermissions }: DashboardPageProps) {
  const { t } = useTranslation();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">
          {t("dashboard.title")}
        </h1>
        <p className="text-muted-foreground" data-testid="text-dashboard-description">
          {t("dashboard.description")}
        </p>
      </div>

      <QuickActionsWidget userPermissions={userPermissions} />

      {(userPermissions.manageOffers || userPermissions.manageOrderDrafts) && (
        <CommercialDraftQuickUploadWidget />
      )}

      {(userPermissions.manageOffers ||
        userPermissions.manageOrderDrafts ||
        userPermissions.viewOffers) && (
        <ImportedCommercialInquiriesWidget userPermissions={userPermissions} />
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <KPIWidget userPermissions={userPermissions} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <ProcessUpdatesWidget userPermissions={userPermissions} />
          {userPermissions.viewTickets && <MyTicketsWidget />}
          {userPermissions.viewTickets && <RecentCommentsWidget />}
          {userPermissions.viewCrm && <RecentCrmInteractionsWidget />}
          {userPermissions.viewDelayedOrders && <DelayedOrdersWidget />}
        </div>
        <div className="space-y-6">
          {userPermissions.viewOrders && <RecentOrdersWidget />}
          {userPermissions.viewShipping && <ShippingReadyWidget />}
        </div>
      </div>
    </div>
  );
}
