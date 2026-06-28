import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { queryClient, getQueryFn } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import TopBar from "@/components/TopBar";
import RightSidebar from "@/components/RightSidebar";
import { RightSidebarProvider } from "@/components/RightSidebarContext";

const DashboardPage = lazy(() => import("@/pages/DashboardPage"));
const OrdersPage = lazy(() => import("@/pages/OrdersPage"));
const DelayedOrdersPage = lazy(() => import("@/pages/DelayedOrdersPage"));
const DunningPreviewPage = lazy(() => import("@/pages/DunningPreviewPage"));
const ShippingPage = lazy(() => import("@/pages/ShippingPage"));
const ProductsPage = lazy(() => import("@/pages/ProductsPage"));
const ObxSearchPage = lazy(() => import("@/pages/ObxSearchPage"));
const ProductOverviewPage = lazy(() => import("@/pages/ProductOverviewPage"));
const PriceCheckPage = lazy(() => import("@/pages/PriceCheckPage"));
const BundlesPage = lazy(() => import("@/pages/BundlesPage"));
const TicketsPage = lazy(() => import("@/pages/TicketsPage"));
const CrmPage = lazy(() => import("@/pages/CrmPage"));
const TicketRulesPage = lazy(() => import("@/pages/TicketRulesPage"));
const AutomationRulesPage = lazy(() => import("@/pages/AutomationRulesPage"));
const CrossSellingRulesPage = lazy(() => import("@/pages/CrossSellingRulesPage"));
const TemplatesPage = lazy(() => import("@/pages/TemplatesPage"));
const OrderDraftsPage = lazy(() => import("@/pages/OrderDraftsPage"));
const OffersPage = lazy(() => import("@/pages/OffersPage"));
const OfferPreviewPage = lazy(() => import("@/pages/OfferPreviewPage"));
const ExportPage = lazy(() => import("@/pages/ExportPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const SemanticSearchPage = lazy(() => import("@/pages/SemanticSearchPage"));
const CPQAdminPage = lazy(() => import("@/pages/CPQAdminPage"));
const CPQConfiguratorPage = lazy(() => import("@/pages/CPQConfiguratorPage"));
const CPQReviewQueuePage = lazy(() => import("@/pages/CPQReviewQueuePage"));
const UsersPage = lazy(() => import("@/pages/UsersPage"));
const RolesPage = lazy(() => import("@/pages/RolesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const WebhookLogsPage = lazy(() => import("@/pages/WebhookLogsPage"));
const ProfilePage = lazy(() => import("@/pages/ProfilePage"));
const AccountingPage = lazy(() => import("@/pages/AccountingPage"));
const B2BAccountsPage = lazy(() => import("@/pages/B2BAccountsPage"));
const B2BBudgetsPage = lazy(() => import("@/pages/B2BBudgetsPage"));
const B2BAssortmentsPage = lazy(() => import("@/pages/B2BAssortmentsPage"));
const B2BOrderListsPage = lazy(() => import("@/pages/B2BOrderListsPage"));
const B2BExplodedViewsPage = lazy(() => import("@/pages/B2BExplodedViewsPage"));
const ShopFakturenImportPage = lazy(() => import("@/pages/ShopFakturenImportPage"));
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import PublicOfferPage from "@/pages/PublicOfferPage";
import GlobalSkeletonOverlay from "@/components/GlobalSkeletonOverlay";
import { Skeleton } from "@/components/ui/skeleton";
import type { User, Role } from "@shared/schema";

type UserWithPermissions = User & {
  permissions: Role['permissions'];
};
import "./i18n/config";
import { useTranslation } from "react-i18next";
import { beginGlobalLoading, endGlobalLoading } from "@/lib/globalLoading";

function Router({ 
  userRole, 
  userSalesChannelIds,
  userPermissions 
}: { 
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
  userPermissions: Role['permissions'];
}) {
  return (
    <Switch>
      <Route path="/" component={() => <DashboardPage userPermissions={userPermissions} />} />
      <Route path="/orders" component={() => <OrdersPage userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/delayed" component={() => <DelayedOrdersPage userRole={userRole} />} />
      <Route path="/dunning" component={() => <DunningPreviewPage userRole={userRole} />} />
      <Route path="/shipping" component={() => <ShippingPage userRole={userRole} userPermissions={userPermissions} />} />
      <Route path="/products" component={ProductsPage} />
      <Route path="/obx-search" component={ObxSearchPage} />
      <Route path="/product-overview" component={ProductOverviewPage} />
      <Route path="/price-check" component={PriceCheckPage} />
      <Route path="/bundles" component={BundlesPage} />
      <Route path="/tickets" component={() => <TicketsPage userPermissions={userPermissions} />} />
      <Route path="/crm" component={() => <CrmPage userPermissions={userPermissions} userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/b2b/accounts" component={() => <B2BAccountsPage userPermissions={userPermissions} userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/b2b/budgets" component={() => <B2BBudgetsPage userPermissions={userPermissions} />} />
      <Route path="/b2b/assortments" component={() => <B2BAssortmentsPage userPermissions={userPermissions} />} />
      <Route path="/b2b/order-lists" component={() => <B2BOrderListsPage userPermissions={userPermissions} />} />
      <Route path="/b2b/exploded-views" component={() => <B2BExplodedViewsPage userPermissions={userPermissions} />} />
      <Route path="/ticket-rules" component={TicketRulesPage} />
      <Route path="/automation-rules" component={AutomationRulesPage} />
      <Route path="/templates" component={() => <TemplatesPage userPermissions={userPermissions} />} />
      <Route path="/cross-selling-rules" component={CrossSellingRulesPage} />
      <Route path="/order-drafts" component={OrderDraftsPage} />
      <Route path="/offers/:offerId/preview" component={OfferPreviewPage} />
      <Route path="/offers" component={() => <OffersPage userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/export" component={ExportPage} />
      <Route path="/analytics" component={() => <AnalyticsPage userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/search" component={SemanticSearchPage} />
      <Route path="/cpq-admin" component={() => <CPQAdminPage />} />
      <Route path="/configurator" component={() => <CPQConfiguratorPage />} />
      <Route path="/cpq-review-queue" component={() => <CPQReviewQueuePage />} />
      <Route path="/accounting" component={AccountingPage} />
      <Route path="/shop-fakturen-import" component={ShopFakturenImportPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/roles" component={RolesPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route path="/webhooks/logs" component={WebhookLogsPage} />
      <Route path="/profile" component={ProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function skeletonVariantForPath(pathname: string): "dashboard" | "orders" | "default" {
  if (pathname === "/") return "dashboard";
  // Nur Bestellliste: orders-Skeleton (ohne Paginierungs-Doppelung im Overlay)
  if (pathname === "/orders") return "orders";
  return "default";
}

function AuthenticatedApp() {
  const { t } = useTranslation();
  const [location] = useLocation();
  const pathname = (location.split("?")[0] || "/").replace(/\/$/, "") || "/";
  // Check if user is authenticated
  const { data, isLoading } = useQuery<{ user: UserWithPermissions }>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  // Handle login success - invalidate query to refetch user data
  const handleLoginSuccess = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
  };

  const user = data?.user;

  useEffect(() => {
    if (!user) {
      return;
    }

    let didEnd = false;
    beginGlobalLoading();

    const timeout = window.setTimeout(() => {
      if (!didEnd) {
        didEnd = true;
        endGlobalLoading();
      }
    }, 250);

    return () => {
      window.clearTimeout(timeout);
      if (!didEnd) {
        didEnd = true;
        endGlobalLoading();
      }
    };
  }, [location, user]);

  // Show login page if not authenticated
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <div className="w-64 space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <TooltipProvider>
      <RightSidebarProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-dvh min-h-0 w-full max-h-dvh">
            <a href="#main-content" className="skip-to-main">
              {t("a11y.skipToMain")}
            </a>
            <AppSidebar 
              userRole={user.role as "employee" | "admin"} 
              permissions={user.permissions}
            />
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <TopBar 
                userRole={user.role as "employee" | "admin"} 
                username={user.username}
                onLogout={() => queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] })}
              />
              <main
                id="main-content"
                className="relative flex-1 overflow-auto p-6 bg-background"
                tabIndex={-1}
              >
                <Suspense
                  fallback={
                    <div className="space-y-3" aria-busy="true">
                      <Skeleton className="h-8 w-1/2 max-w-md" />
                      <Skeleton className="h-4 w-full max-w-lg" />
                      <Skeleton className="h-4 w-5/6 max-w-lg" />
                    </div>
                  }
                >
                  <Router
                    userRole={user.role as "employee" | "admin"}
                    userSalesChannelIds={user.salesChannelIds}
                    userPermissions={user.permissions}
                  />
                </Suspense>
                <GlobalSkeletonOverlay variant={skeletonVariantForPath(pathname)} />
              </main>
            </div>
            <RightSidebar userPermissions={user.permissions} />
          </div>
        </SidebarProvider>
      </RightSidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Switch>
        <Route path="/angebot/:token" component={PublicOfferPage} />
        <Route component={AuthenticatedApp} />
      </Switch>
    </QueryClientProvider>
  );
}

export default App;
