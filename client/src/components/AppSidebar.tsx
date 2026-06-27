import { LayoutDashboard, Package, Download, BarChart3, Settings, Users, Shield, Sparkles, AlertTriangle, Ticket, GitBranch, Truck, FileText, Zap, FileUp, Receipt, Briefcase, Boxes, FileSearch, Scale } from "lucide-react";
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
  SidebarSeparator,
} from "@/components/ui/sidebar";

interface AppSidebarProps {
  userRole: "employee" | "admin";
  permissions: Role['permissions'];
}

export default function AppSidebar({ userRole, permissions }: AppSidebarProps) {
  const [location] = useLocation();
  const { t } = useTranslation();

  const menuGroups = [
    {
      items: [
        {
          titleKey: "nav.dashboard",
          url: "/",
          icon: LayoutDashboard,
          permission: null, // Dashboard is always accessible to authenticated users
        },
      ],
    },
    {
      items: [
        {
          titleKey: "nav.orders",
          url: "/orders",
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
          titleKey: "nav.dunningPreview",
          url: "/dunning",
          icon: FileText,
          permission: "viewDocuments" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.shipping",
          url: "/shipping",
          icon: Truck,
          permission: "viewShipping" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.offers",
          url: "/offers",
          icon: Receipt,
          permission: "viewOffers" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.orderDrafts",
          url: "/order-drafts",
          icon: FileUp,
          permission: "manageOrderDrafts" as keyof Role['permissions'],
        },
      ],
    },
    {
      items: [
        {
          titleKey: "nav.products",
          url: "/products",
          icon: Package,
          permission: "viewOrders" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.obxSearch",
          url: "/obx-search",
          icon: FileSearch,
          permission: "viewOrders" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.productOverview",
          url: "/product-overview",
          icon: Boxes,
          permission: "viewOrders" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.priceCheck",
          url: "/price-check",
          icon: Scale,
          permission: "viewOrders" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.bundles",
          url: "/bundles",
          icon: Package,
          permission: "manageProducts" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.rules",
          url: "/cross-selling-rules",
          icon: Sparkles,
          permission: "manageCrossSellingRules" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.configurator",
          url: "/configurator",
          icon: Boxes,
          permission: "viewCPQ" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.cpqAdmin",
          url: "/cpq-admin",
          icon: Boxes,
          permission: "viewCPQ" as keyof Role['permissions'],
        },
        {
          titleKey: "CPQ Review Queue",
          url: "/cpq-review-queue",
          icon: Boxes,
          permission: "viewCPQ" as keyof Role['permissions'],
        },
      ],
    },
    {
      items: [
        {
          titleKey: "nav.tickets",
          url: "/tickets",
          icon: Ticket,
          permission: "viewTickets" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.crm",
          url: "/crm",
          icon: Briefcase,
          permission: "viewCrm" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.ticketRules",
          url: "/ticket-rules",
          icon: GitBranch,
          permission: "manageTickets" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.templates",
          url: "/templates",
          icon: FileText,
          permission: "manageTickets" as keyof Role['permissions'],
        },
      ],
    },
    {
      items: [
        {
          titleKey: "nav.automationRules",
          url: "/automation-rules",
          icon: Zap,
          permission: "manageAutomations" as keyof Role['permissions'],
        },
      ],
    },
    {
      items: [
        {
          titleKey: "nav.analytics",
          url: "/analytics",
          icon: BarChart3,
          permission: "viewAnalytics" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.accounting",
          url: "/accounting",
          icon: FileText,
          permission: "viewAccounting" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.shopFakturenImport",
          url: "/shop-fakturen-import",
          icon: Receipt,
          permission: "manageDocuments" as keyof Role['permissions'],
        },
        {
          titleKey: "nav.export",
          url: "/export",
          icon: Download,
          permission: "exportData" as keyof Role['permissions'],
        },
      ],
    },
    {
      items: [
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
          titleKey: "nav.settings",
          url: "/settings",
          icon: Settings,
          permission: "manageSettings" as keyof Role['permissions'],
        },
      ],
    },
  ];

  return (
    <Sidebar>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>{t('nav.appTitle')}</SidebarGroupLabel>
          <SidebarGroupContent>
            {menuGroups.map((group, groupIndex) => {
              const filteredItems = group.items.filter((item) =>
                item.permission === null ||
                userRole === "admin" ||
                permissions?.[item.permission]
              );

              if (filteredItems.length === 0) return null;

              return (
                <div key={groupIndex}>
                  {groupIndex > 0 && <SidebarSeparator className="my-2" />}
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
                </div>
              );
            })}
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}
