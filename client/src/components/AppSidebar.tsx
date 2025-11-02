import { Package, Download, BarChart3, Settings, Users, Shield, Sparkles, AlertTriangle, Ticket } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import type { Role } from "@shared/schema";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

interface AppSidebarProps {
  userRole: "employee" | "admin";
  permissions: Role['permissions'];
}

export default function AppSidebar({ userRole, permissions }: AppSidebarProps) {
  const [location] = useLocation();
  const { t } = useTranslation();

  const menuItems = [
    {
      titleKey: "nav.orders",
      url: "/",
      icon: Package,
      permission: "viewOrders" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.delayedOrders",
      url: "/delayed",
      icon: AlertTriangle,
      permission: "viewDelayedOrders" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.products",
      url: "/products",
      icon: Package,
      permission: "viewOrders" as keyof Role['permissions'], // Products visible to anyone who can view orders
    },
    {
      titleKey: "tickets.title",
      url: "/tickets",
      icon: Ticket,
      permission: "viewTickets" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.export",
      url: "/export",
      icon: Download,
      permission: "exportData" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.analytics",
      url: "/analytics",
      icon: BarChart3,
      permission: "viewAnalytics" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.users",
      url: "/users",
      icon: Users,
      permission: "manageUsers" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.roles",
      url: "/roles",
      icon: Shield,
      permission: "manageRoles" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.rules",
      url: "/cross-selling-rules",
      icon: Sparkles,
      permission: "manageCrossSellingRules" as keyof Role['permissions'],
    },
    {
      titleKey: "nav.settings",
      url: "/settings",
      icon: Settings,
      permission: "manageSettings" as keyof Role['permissions'],
    },
  ];

  const filteredItems = menuItems.filter((item) =>
    permissions[item.permission]
  );

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.appTitle')}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {filteredItems.map((item) => {
                const title = item.titleKey.startsWith('nav.') ? t(item.titleKey) : item.titleKey;
                const testId = item.titleKey.replace(/\./g, '-').toLowerCase();
                return (
                  <SidebarMenuItem key={item.titleKey}>
                    <SidebarMenuButton asChild isActive={location === item.url}>
                      <Link href={item.url} data-testid={`link-${testId}`}>
                        <item.icon className="h-4 w-4" />
                        <span>{title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
