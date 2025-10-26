import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider, useQuery } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider } from "@/components/ui/sidebar";
import AppSidebar from "@/components/AppSidebar";
import TopBar from "@/components/TopBar";
import OrdersPage from "@/pages/OrdersPage";
import ProductsPage from "@/pages/ProductsPage";
import CrossSellingRulesPage from "@/pages/CrossSellingRulesPage";
import ExportPage from "@/pages/ExportPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import UsersPage from "@/pages/UsersPage";
import RolesPage from "@/pages/RolesPage";
import SettingsPage from "@/pages/SettingsPage";
import LoginPage from "@/pages/LoginPage";
import NotFound from "@/pages/not-found";
import type { User } from "@shared/schema";
import "./i18n/config";
import { useState } from "react";

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
      <Route path="/products" component={ProductsPage} />
      <Route path="/cross-selling-rules" component={CrossSellingRulesPage} />
      <Route path="/export" component={ExportPage} />
      <Route path="/analytics" component={AnalyticsPage} />
      <Route path="/users" component={UsersPage} />
      <Route path="/roles" component={RolesPage} />
      <Route path="/settings" component={SettingsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthenticatedApp() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  
  // Check if user is authenticated
  const { data, isLoading, refetch } = useQuery<{ user: User }>({
    queryKey: ["/api/auth/me"],
    retry: false,
  });

  // Handle login success
  const handleLoginSuccess = (user: User) => {
    setCurrentUser(user);
    refetch();
  };

  // Show login page if not authenticated
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">Loading...</div>
      </div>
    );
  }

  const user = currentUser || data?.user;

  if (!user) {
    return <LoginPage onLoginSuccess={handleLoginSuccess} />;
  }

  const style = {
    "--sidebar-width": "16rem",
    "--sidebar-width-icon": "3rem",
  };

  return (
    <TooltipProvider>
      <SidebarProvider style={style as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar userRole={user.role as "employee" | "admin"} />
          <div className="flex flex-col flex-1 overflow-hidden">
            <TopBar 
              userRole={user.role as "employee" | "admin"} 
              username={user.username}
              onLogout={() => setCurrentUser(null)}
            />
            <main className="flex-1 overflow-auto p-6 bg-background">
              <Router 
                userRole={user.role as "employee" | "admin"} 
                userSalesChannelIds={user.salesChannelIds} 
              />
            </main>
          </div>
        </div>
      </SidebarProvider>
      <Toaster />
    </TooltipProvider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthenticatedApp />
    </QueryClientProvider>
  );
}

export default App;
