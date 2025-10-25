import { Package, Download, BarChart3, Settings, Users, Shield } from "lucide-react";
import { Link, useLocation } from "wouter";
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

  const menuItems = [
    {
      title: "Orders",
      url: "/",
      icon: Package,
      roles: ["employee", "admin"],
    },
    {
      title: "Export & Reports",
      url: "/export",
      icon: Download,
      roles: ["employee", "admin"],
    },
    {
      title: "Analytics",
      url: "/analytics",
      icon: BarChart3,
      roles: ["admin"],
    },
    {
      title: "Users",
      url: "/users",
      icon: Users,
      roles: ["admin"],
    },
    {
      title: "Roles",
      url: "/roles",
      icon: Shield,
      roles: ["admin"],
    },
    {
      title: "Settings",
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
              {filteredItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={location === item.url}>
                    <Link href={item.url} data-testid={`link-${item.title.toLowerCase().replace(/\s+/g, '-')}`}>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
