import { Package, Download, BarChart3, Settings, Users, Shield } from "lucide-react";
import { Link, useLocation } from "wouter";
import { useTranslation } from "react-i18next";
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
}

export default function AppSidebar({ userRole }: AppSidebarProps) {
  const [location] = useLocation();
  const { t } = useTranslation();

  const menuItems = [
    {
      titleKey: "nav.orders",
      url: "/",
      icon: Package,
      roles: ["employee", "admin"],
    },
    {
      titleKey: "Export & Reports",
      url: "/export",
      icon: Download,
      roles: ["employee", "admin"],
    },
    {
      titleKey: "nav.analytics",
      url: "/analytics",
      icon: BarChart3,
      roles: ["admin"],
    },
    {
      titleKey: "nav.users",
      url: "/users",
      icon: Users,
      roles: ["admin"],
    },
    {
      titleKey: "nav.roles",
      url: "/roles",
      icon: Shield,
      roles: ["admin"],
    },
    {
      titleKey: "nav.settings",
      url: "/settings",
      icon: Settings,
      roles: ["admin"],
    },
  ];

  const filteredItems = menuItems.filter((item) =>
    item.roles.includes(userRole)
  );

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>METAorder</SidebarGroupLabel>
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
