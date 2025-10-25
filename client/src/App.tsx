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
import SettingsPage from "@/pages/SettingsPage";
import NotFound from "@/pages/not-found";

function Router({ userRole }: { userRole: "employee" | "admin" }) {
  return (
    <Switch>
      <Route path="/" component={() => <OrdersPage userRole={userRole} />} />
      <Route path="/export" component={ExportPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  // TODO: Replace with actual user role from authentication
  const userRole: "employee" | "admin" = "admin";
  const username = "Admin User";

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
                <Router userRole={userRole} />
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
