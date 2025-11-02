import { User, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SidebarTrigger } from "@/components/ui/sidebar";
import ThemeToggle from "./ThemeToggle";
import LanguageSwitcher from "./LanguageSwitcher";
import { NotificationBell } from "./NotificationBell";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface TopBarProps {
  userRole: "employee" | "admin";
  username: string;
  onLogout: () => void;
}

export default function TopBar({ userRole, username, onLogout }: TopBarProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const logoutMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/auth/logout", {});
      
      if (!response.ok) {
        throw new Error("Logout failed");
      }
      
      return response.json();
    },
    onSuccess: () => {
      // Clear JWT token from localStorage
      localStorage.removeItem("token");
      
      // Clear auth query data to trigger immediate redirect to login
      queryClient.setQueryData(["/api/auth/me"], null);
      queryClient.clear();
      onLogout();
      toast({
        title: t("auth.logout"),
        description: t("auth.logoutSuccess"),
      });
    },
    onError: () => {
      toast({
        title: t("errors.failed"),
        description: t("auth.logoutFailed"),
        variant: "destructive",
      });
    },
  });
  
  const handleLogout = () => {
    logoutMutation.mutate();
  };
  
  return (
    <header className="h-16 border-b bg-card flex items-center justify-between px-6 gap-4 sticky top-0 z-50">
      <div className="flex items-center gap-4">
        <SidebarTrigger data-testid="button-sidebar-toggle" />
        <h1 className="text-xl font-semibold">{t('nav.appTitle')}</h1>
      </div>
      
      <div className="flex items-center gap-3">
        <LanguageSwitcher />
        <NotificationBell />
        <ThemeToggle />
        <Badge variant={userRole === "admin" ? "default" : "secondary"} data-testid="badge-user-role">
          {t(`roles.${userRole}`)}
        </Badge>
        <div className="flex items-center gap-2">
          <User className="h-4 w-4" />
          <span className="text-sm font-medium" data-testid="text-username">{username}</span>
        </div>
        <Button 
          variant="ghost" 
          size="icon"
          onClick={handleLogout}
          disabled={logoutMutation.isPending}
          data-testid="button-logout"
        >
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
