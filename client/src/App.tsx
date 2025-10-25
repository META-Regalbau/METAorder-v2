import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import TopBar from "@/components/TopBar";
import OrdersPage from "@/pages/OrdersPage";
import ExportPage from "@/pages/ExportPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import UsersPage from "@/pages/UsersPage";
import RolesPage from "@/pages/RolesPage";
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/not-found";
import "./i18n/config";

function Router({ 
  userRole, 
  userSalesChannelIds 
}: { 
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}) {
  return (
    <Switch>
      <Route path="/" component={() => <OrdersPage userRole={userRole} userSalesChannelIds={userSalesChannelIds} />} />
      <Route path="/export" component={ExportPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/roles" component={RolesPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // TODO: Replace with actual user role and sales channels from authentication
  
  // Simulate different user types for testing:
  // ADMIN: Can see all sales channels
  const userRole: "employee" | "admin" = "admin";
  const username = "Admin User";
  const userSalesChannelIds: string[] | null = null; // null = all channels for admin
  
  // AUSTRIA EMPLOYEE: Can only see Austria sales channel
  // const userRole: "employee" | "admin" = "employee";
  // const username = "Austria User";
  // const userSalesChannelIds: string[] = ["AUSTRIA_SALES_CHANNEL_ID"];
  
  // POLAND EMPLOYEE: Can only see Poland sales channel
  // const userRole: "employee" | "admin" = "employee";
  // const username = "Poland User";
  // const userSalesChannelIds: string[] = ["POLAND_SALES_CHANNEL_ID"];
  
  // GERMANY EMPLOYEE: Can only see Germany sales channel
  // const userRole: "employee" | "admin" = "employee";
  // const username = "Germany User";
  // const userSalesChannelIds: string[] = ["GERMANY_SALES_CHANNEL_ID"];

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <SidebarProvider style={style as React.CSSProperties}>
          <div className="flex h-screen w-full">
            <AppSidebar userRole={userRole} />
            <div className="flex flex-col flex-1 overflow-hidden">
              <TopBar userRole={userRole} username={username} />
              <main className="flex-1 overflow-auto p-6 bg-background">
                <Router userRole={userRole} userSalesChannelIds={userSalesChannelIds} />
              </main>
            </div>
          </div>
        </SidebarProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
