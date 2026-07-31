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
import "@/styles/metaAdmin.css";

interface DashboardPageProps {
  userPermissions: Role["permissions"];
}

export default function DashboardPage({ userPermissions }: DashboardPageProps) {
  const { t } = useTranslation();

  return (
    <div className="madmin">
      <div className="mpage-head">
        <div>
          <span className="eyebrow">METAorder</span>
          <h1 data-testid="text-dashboard-title">{t("dashboard.title")}</h1>
          <p className="desc" data-testid="text-dashboard-description">
            {t("dashboard.description")}
          </p>
        </div>
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

      <div className="mgrid-kpi" style={{ marginTop: 16 }}>
        <KPIWidget userPermissions={userPermissions} />
      </div>

      <div className="mgrid-2" style={{ marginTop: 16 }}>
        <div>
          <ProcessUpdatesWidget userPermissions={userPermissions} />
          {userPermissions.viewTickets && <MyTicketsWidget />}
          {userPermissions.viewTickets && <RecentCommentsWidget />}
          {userPermissions.viewCrm && <RecentCrmInteractionsWidget />}
          {userPermissions.viewDelayedOrders && <DelayedOrdersWidget />}
        </div>
        <div>
          {userPermissions.viewOrders && <RecentOrdersWidget />}
          {userPermissions.viewShipping && <ShippingReadyWidget />}
        </div>
      </div>
    </div>
  );
}
