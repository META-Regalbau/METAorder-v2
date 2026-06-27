import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SalesChannelSelector } from "@/components/SalesChannelSelector";
import { format, subDays } from "date-fns";
import { de } from "date-fns/locale";
import { useTranslation } from "react-i18next";
import type { SalesChannel, AiInsight, OfferLearningInsight } from "@shared/schema";
import {
  TrendingUp,
  Package,
  DollarSign,
  Users,
  ShoppingCart,
  CreditCard,
  BarChart3,
  Download,
  Calendar as CalendarIcon,
  PackageCheck,
  PackageX,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import * as XLSX from "xlsx";

type DateRangePreset = "7" | "30" | "90" | "custom";

const COLORS = ["#0088FE", "#00C49F", "#FFBB28", "#FF8042", "#8884D8", "#82CA9D"];

interface AnalyticsPageProps {
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

export default function AnalyticsPage({ userRole, userSalesChannelIds }: AnalyticsPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [dateRange, setDateRange] = useState<DateRangePreset>("30");
  const [customDateFrom, setCustomDateFrom] = useState<Date>();
  const [customDateTo, setCustomDateTo] = useState<Date>();
  const [selectedChannelIds, setSelectedChannelIds] = useState<string[]>([]);
  const [productSortBy, setProductSortBy] = useState<"quantity" | "revenue">("quantity");

  // Fetch sales channels
  const { data: salesChannels = [] } = useQuery<SalesChannel[]>({
    queryKey: ['/api/sales-channels'],
    retry: false,
  });

  // Initialize selected channels based on user permissions
  useEffect(() => {
    if (salesChannels.length > 0 && selectedChannelIds.length === 0) {
      if (userRole === "admin" || !userSalesChannelIds) {
        // Admin sees all channels by default
        setSelectedChannelIds(salesChannels.map(c => c.id));
      } else {
        // Non-admin users see only their assigned channels
        setSelectedChannelIds(userSalesChannelIds);
      }
    }
  }, [salesChannels, userRole, userSalesChannelIds, selectedChannelIds.length]);

  // Calculate date range based on preset
  const { dateFrom, dateTo } = useMemo(() => {
    if (dateRange === "custom") {
      return {
        dateFrom: customDateFrom ? format(customDateFrom, "yyyy-MM-dd") : undefined,
        dateTo: customDateTo ? format(customDateTo, "yyyy-MM-dd") : undefined,
      };
    }

    const days = parseInt(dateRange);
    const today = new Date();
    const from = subDays(today, days);

    return {
      dateFrom: format(from, "yyyy-MM-dd"),
      dateTo: format(today, "yyyy-MM-dd"),
    };
  }, [dateRange, customDateFrom, customDateTo]);

  // Fetch analytics data
  const { data: summary, isLoading: summaryLoading } = useQuery<{
    totalOrders: number;
    totalRevenue: number;
    totalNetRevenue: number;
    averageOrderValue: number;
    averageNetOrderValue: number;
    uniqueCustomers: number;
    dateFrom?: string;
    dateTo?: string;
  }>({
    queryKey: ["/api/analytics/summary", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      const response = await fetch(`/api/analytics/summary?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch summary");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: aiInsightsData } = useQuery<{ insights: AiInsight[] }>({
    queryKey: ["/api/ai/insights"],
    queryFn: async () => {
      const response = await fetch("/api/ai/insights", { credentials: "include" });
      if (!response.ok) return { insights: [] };
      return response.json();
    },
  });

  const aiInsights = aiInsightsData?.insights || [];

  const { data: offerInsightsData } = useQuery<{ insights: OfferLearningInsight[] }>({
    queryKey: ["/api/ai/offers/insights"],
    queryFn: async () => {
      const response = await fetch("/api/ai/offers/insights", { credentials: "include" });
      if (!response.ok) return { insights: [] };
      return response.json();
    },
  });

  const offerInsights = offerInsightsData?.insights || [];
  const offerStatusInsight = offerInsights.find((insight) => insight.insightType === "offer_status_distribution");
  const offerConversionInsight = offerInsights.find((insight) => insight.insightType === "offer_conversion");
  const offerAvgInsight = offerInsights.find((insight) => insight.insightType === "offer_avg_values");
  const offerTopCustomersInsight = offerInsights.find((insight) => insight.insightType === "top_customers");

  const offerKpiTotals = useMemo(() => {
    const conv = offerConversionInsight?.data as Record<string, unknown> | undefined;
    const statusCounts = offerStatusInsight?.data?.statusCounts as Record<string, number> | undefined;
    const derivedTotal =
      statusCounts && Object.keys(statusCounts).length > 0
        ? Object.values(statusCounts).reduce((s, n) => s + (typeof n === "number" ? n : 0), 0)
        : undefined;
    const totalOffers = typeof conv?.totalOffers === "number" ? conv.totalOffers : derivedTotal;
    const approved =
      typeof conv?.approved === "number"
        ? conv.approved
        : typeof statusCounts?.approved === "number"
          ? statusCounts.approved
          : undefined;
    const acceptedOfAllRate =
      typeof conv?.acceptedOfAllRate === "number"
        ? conv.acceptedOfAllRate
        : totalOffers !== undefined && approved !== undefined && totalOffers > 0
          ? approved / totalOffers
          : undefined;
    return { totalOffers, approved, acceptedOfAllRate };
  }, [offerConversionInsight, offerStatusInsight]);

  const { data: orderStatus } = useQuery<Record<string, number>>({
    queryKey: ["/api/analytics/order-status", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      const response = await fetch(`/api/analytics/order-status?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch order status");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: paymentStatus } = useQuery<Record<string, number>>({
    queryKey: ["/api/analytics/payment-status", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      const response = await fetch(`/api/analytics/payment-status?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch payment status");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: productOverview } = useQuery<{
    total: number;
    active: number;
    inactive: number;
  }>({
    queryKey: ["/api/analytics/product-overview"],
    queryFn: async () => {
      const response = await fetch("/api/analytics/product-overview", {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch product overview");
      return response.json();
    },
  });

  const { data: productActivityTrend } = useQuery<{ trend: Array<{ month: string; active: number; inactive: number }> }>({
    queryKey: ["/api/analytics/product-activity-trend"],
    queryFn: async () => {
      const response = await fetch("/api/analytics/product-activity-trend", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch product activity trend");
      return response.json();
    },
  });

  const { data: productDataQuality } = useQuery<{
    totalProducts: number;
    averageScore: number;
    criteriaCount: number;
    distribution: Array<{ label: string; count: number }>;
  }>({
    queryKey: ["/api/analytics/product-data-quality", selectedChannelIds],
    queryFn: async () => {
      const response = await fetch("/api/analytics/product-data-quality", {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch product data quality");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: categorySales } = useQuery<Array<{ name: string; revenue: number; netRevenue: number; quantity: number }>>({
    queryKey: ["/api/analytics/category-sales", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      const response = await fetch(`/api/analytics/category-sales?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch category sales");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: productPerformance } = useQuery<{
    topProducts: Array<{
      name: string;
      totalQuantity: number;
      totalRevenue: number;
      totalNetRevenue: number;
      orderCount: number;
    }>;
    bottomProducts: Array<{
      name: string;
      totalQuantity: number;
      totalRevenue: number;
      totalNetRevenue: number;
      orderCount: number;
    }>;
  }>({
    queryKey: ["/api/analytics/product-performance", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      params.append("minQuantity", "1");
      const response = await fetch(`/api/analytics/product-performance?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch product performance");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: salesTrend } = useQuery<Array<{
    date: string;
    revenue: number;
    netRevenue: number;
    orderCount: number;
  }>>({
    queryKey: ["/api/analytics/sales-trend", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(','));
      const response = await fetch(`/api/analytics/sales-trend?${params}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error("Failed to fetch sales trend");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: shippingTimes } = useQuery<{
    ordersWithShippingCount: number;
    averageDays: number;
    medianDays: number;
    averageHours: number;
    medianHours: number;
    distribution: Array<{ label: string; count: number }>;
  }>({
    queryKey: ["/api/analytics/shipping-times", dateFrom, dateTo, selectedChannelIds],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      if (selectedChannelIds.length > 0) params.append("salesChannelIds", selectedChannelIds.join(","));
      const response = await fetch(`/api/analytics/shipping-times?${params}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error("Failed to fetch shipping times");
      return response.json();
    },
    enabled: selectedChannelIds.length > 0,
  });

  const { data: ga4Kpis } = useQuery<{
    propertyId?: string;
    dailyUsers?: number;
    weeklyUsers?: number;
    monthlyUsers?: number;
    rangeUsers?: number;
    rangeSessions?: number;
  }>({
    queryKey: ["/api/analytics/google/ga4", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      const response = await fetch(`/api/analytics/google/ga4?${params}`, {
        credentials: "include",
      });
      if (!response.ok) return {};
      return response.json();
    },
  });

  const { data: adsKpis } = useQuery<{
    totalCost?: number;
    totalConversions?: number;
    conversionRate?: number;
    costPerConversion?: number;
    campaigns?: Array<{
      campaignId: string;
      campaignName: string;
      cost: number;
      conversions: number;
      clicks: number;
      impressions: number;
    }>;
  }>({
    queryKey: ["/api/analytics/google/ads", dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      const response = await fetch(`/api/analytics/google/ads?${params}`, {
        credentials: "include",
      });
      if (!response.ok) return {};
      return response.json();
    },
  });

  // Transform data for charts
  const orderStatusData = useMemo(() => {
    if (!orderStatus) return [];
    return Object.entries(orderStatus).map(([name, value]) => ({
      name: t(`status.${name}`),
      value,
    }));
  }, [orderStatus, t]);

  const paymentStatusData = useMemo(() => {
    if (!paymentStatus) return [];
    return Object.entries(paymentStatus).map(([name, value]) => ({
      name: t(`paymentStatus.${name}`),
      value,
    }));
  }, [paymentStatus, t]);

  const categorySalesData = useMemo(() => {
    if (!categorySales) return [];
    return categorySales.slice(0, 10).map((cat) => ({
      name: cat.name.length > 20 ? cat.name.substring(0, 20) + "..." : cat.name,
      revenue: cat.revenue,
      netRevenue: cat.netRevenue,
    }));
  }, [categorySales]);

  const productActivityData = useMemo(() => {
    if (!productActivityTrend?.trend) return [];
    return productActivityTrend.trend.map((item) => {
      const date = new Date(`${item.month}-01T00:00:00`);
      return {
        month: Number.isNaN(date.getTime())
          ? item.month
          : format(date, "MMM yyyy", { locale: de }),
        active: item.active,
        inactive: item.inactive,
      };
    });
  }, [productActivityTrend]);

  const dataQualityDistribution = useMemo(() => {
    return productDataQuality?.distribution || [];
  }, [productDataQuality]);

  // Export analytics data
  const handleExport = (format: "csv" | "excel" | "json") => {
    try {
      const data = {
        summary,
        orderStatus,
        paymentStatus,
        productOverview,
        productActivityTrend,
        categorySales,
        productPerformance,
        salesTrend,
      };

      if (format === "json") {
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `analytics-${dateFrom}-${dateTo}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        const wb = XLSX.utils.book_new();
        let sheetCount = 0;

        // Summary sheet
        if (summary) {
          const summarySheet = XLSX.utils.json_to_sheet([summary]);
          XLSX.utils.book_append_sheet(wb, summarySheet, "Summary");
          sheetCount++;
        }

        // Category Sales sheet
        if (categorySales && categorySales.length > 0) {
          const categorySheet = XLSX.utils.json_to_sheet(categorySales);
          XLSX.utils.book_append_sheet(wb, categorySheet, "Category Sales");
          sheetCount++;
        }

        // Top Products sheet
        if (productPerformance?.topProducts && productPerformance.topProducts.length > 0) {
          const topProductsSheet = XLSX.utils.json_to_sheet(productPerformance.topProducts);
          XLSX.utils.book_append_sheet(wb, topProductsSheet, "Top Products");
          sheetCount++;
        }

        // Sales Trend sheet
        if (salesTrend && salesTrend.length > 0) {
          const trendSheet = XLSX.utils.json_to_sheet(salesTrend);
          XLSX.utils.book_append_sheet(wb, trendSheet, "Sales Trend");
          sheetCount++;
        }

        if (sheetCount === 0) {
          throw new Error("No data available to export");
        }

        if (format === "excel") {
          XLSX.writeFile(wb, `analytics-${dateFrom}-${dateTo}.xlsx`);
        } else {
          XLSX.writeFile(wb, `analytics-${dateFrom}-${dateTo}.csv`);
        }
      }

      toast({
        title: t("analytics.exportSuccess"),
        description: t("analytics.exportDescription", { format: format.toUpperCase() }),
      });
    } catch (error) {
      console.error("Export error:", error);
      toast({
        title: t("analytics.exportFailed"),
        description: t("analytics.exportError"),
        variant: "destructive",
      });
    }
  };

  if (summaryLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-lg">{t('common.loading')}</div>
      </div>
    );
  }

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold mb-1" data-testid="text-page-title">
          {t('analytics.title')}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t('analytics.subtitle')}
        </p>
      </div>

      {/* Sales Channel Filter */}
      <div className="mb-6">
        <SalesChannelSelector
          selectedChannelIds={selectedChannelIds}
          onSelectionChange={setSelectedChannelIds}
          userAllowedChannelIds={userSalesChannelIds}
          isAdmin={userRole === "admin"}
        />
      </div>

      {/* Date Range Filter and Export */}
      <div className="flex flex-wrap gap-4 mb-6">
        <Select value={dateRange} onValueChange={(value) => setDateRange(value as DateRangePreset)}>
          <SelectTrigger className="w-48" data-testid="select-date-range">
            <SelectValue placeholder={t('analytics.dateRange')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7" data-testid="select-item-7-days">{t('analytics.last7Days')}</SelectItem>
            <SelectItem value="30" data-testid="select-item-30-days">{t('analytics.last30Days')}</SelectItem>
            <SelectItem value="90" data-testid="select-item-90-days">{t('analytics.last90Days')}</SelectItem>
            <SelectItem value="custom" data-testid="select-item-custom">{t('analytics.custom')}</SelectItem>
          </SelectContent>
        </Select>

        {dateRange === "custom" && (
          <>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-48" data-testid="button-date-from">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDateFrom ? format(customDateFrom, "PPP", { locale: de }) : t('analytics.dateFrom')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={customDateFrom} onSelect={setCustomDateFrom} locale={de} />
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="w-48" data-testid="button-date-to">
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDateTo ? format(customDateTo, "PPP", { locale: de }) : t('analytics.dateTo')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0">
                <Calendar mode="single" selected={customDateTo} onSelect={setCustomDateTo} locale={de} />
              </PopoverContent>
            </Popover>
          </>
        )}

        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => handleExport("excel")} data-testid="button-export-excel">
            <Download className="mr-2 h-4 w-4" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport("csv")} data-testid="button-export-csv">
            <Download className="mr-2 h-4 w-4" />
            CSV
          </Button>
          <Button variant="outline" onClick={() => handleExport("json")} data-testid="button-export-json">
            <Download className="mr-2 h-4 w-4" />
            JSON
          </Button>
        </div>
      </div>

      <div className="mb-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('analytics.sectionOverview')}
        </h2>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.totalRevenue')}</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-revenue">
              {summary?.totalNetRevenue?.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </div>
            <p className="text-xs text-muted-foreground">
              Brutto: {summary?.totalRevenue?.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.totalOrders')}</CardTitle>
            <ShoppingCart className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-orders">
              {summary?.totalOrders?.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-muted-foreground">{t('analytics.inSelectedPeriod')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.averageOrderValue')}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-average-order-value">
              {summary?.averageNetOrderValue?.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </div>
            <p className="text-xs text-muted-foreground">
              Brutto: {summary?.averageOrderValue?.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t('analytics.uniqueCustomers')}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-unique-customers">
              {summary?.uniqueCustomers?.toLocaleString("de-DE")}
            </div>
            <p className="text-xs text-muted-foreground">{t('analytics.uniqueCustomersDetail')}</p>
          </CardContent>
        </Card>
      </div>

      {(ga4Kpis?.propertyId || adsKpis?.totalCost !== undefined || (adsKpis?.campaigns?.length ?? 0) > 0) && (
        <div className="mb-3">
          <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {t('analytics.sectionMarketing')}
          </h2>
        </div>
      )}

      {(ga4Kpis?.propertyId || adsKpis?.totalCost) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          {ga4Kpis?.propertyId && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("analytics.ga4Users")}</CardTitle>
                <Users className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">
                  {ga4Kpis.monthlyUsers?.toLocaleString("de-DE") || 0}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t("analytics.ga4Monthly")}
                </p>
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <div>{t("analytics.ga4Daily")}: {ga4Kpis.dailyUsers?.toLocaleString("de-DE") || 0}</div>
                  <div>{t("analytics.ga4Weekly")}: {ga4Kpis.weeklyUsers?.toLocaleString("de-DE") || 0}</div>
                </div>
              </CardContent>
            </Card>
          )}

          {adsKpis?.totalCost !== undefined && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">{t("analytics.adsPerformance")}</CardTitle>
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="text-2xl font-bold">
                  {adsKpis.totalCost?.toLocaleString("de-DE", { style: "currency", currency: "EUR" }) || "€0"}
                </div>
                <p className="text-xs text-muted-foreground">{t("analytics.adsSpend")}</p>
                <div className="grid grid-cols-2 gap-2 text-sm text-muted-foreground">
                  <div>
                    {t("analytics.adsConversionRate")}: {((adsKpis.conversionRate || 0) * 100).toFixed(1)}%
                  </div>
                  <div>
                    {t("analytics.adsCpa")}: {(adsKpis.costPerConversion || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {adsKpis?.campaigns && adsKpis.campaigns.length > 0 && (
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-sm font-medium">{t("analytics.adsCampaigns")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-muted-foreground">
              {adsKpis.campaigns
                .slice()
                .sort((a, b) => b.cost - a.cost)
                .slice(0, 5)
                .map((campaign) => (
                  <div key={campaign.campaignId} className="flex items-center justify-between">
                    <span>{campaign.campaignName}</span>
                    <span>
                      {campaign.cost.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                    </span>
                  </div>
                ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mb-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('analytics.sectionInsights')}
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('analytics.offerInsightsTitle', 'Angebots-Insights')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {offerInsights.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('analytics.offerInsightsEmpty')}</p>
            )}
            {offerConversionInsight?.data && (
              <div className="border rounded-lg p-4">
                <h3 className="font-medium">{offerConversionInsight.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{offerConversionInsight.description}</p>
                {offerKpiTotals.totalOffers !== undefined && (
                  <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("analytics.offerTotalInPeriod", "Angebote (Zeitraum)")}
                      </div>
                      <div className="text-lg font-semibold tabular-nums">{offerKpiTotals.totalOffers}</div>
                    </div>
                    <div className="rounded-md bg-muted/50 px-3 py-2">
                      <div className="text-xs uppercase tracking-wide text-muted-foreground">
                        {t("analytics.offerAcceptedCount", "Angenommen / freigegeben")}
                      </div>
                      <div className="text-lg font-semibold tabular-nums">
                        {offerKpiTotals.approved !== undefined ? offerKpiTotals.approved : "—"}
                      </div>
                    </div>
                  </div>
                )}
                {typeof offerKpiTotals.acceptedOfAllRate === "number" &&
                  offerKpiTotals.totalOffers !== undefined &&
                  offerKpiTotals.totalOffers > 0 && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {t("analytics.offerAcceptedShareAll", "{{pct}}% aller Angebote im Zeitraum", {
                        pct: (offerKpiTotals.acceptedOfAllRate * 100).toFixed(1),
                      })}
                    </p>
                  )}
                <div className="mt-3 text-sm text-muted-foreground">
                  {(offerConversionInsight.data.conversionRate * 100).toFixed(1)}%{" "}
                  {t("analytics.offerConversionRate", "freigegeben")}{" "}
                  <span className="text-muted-foreground/80">
                    ({t("analytics.offerConversionHint", "bezogen auf eingereichte, versandte, abgelehnte und freigegebene Angebote")})
                  </span>
                </div>
              </div>
            )}
            {offerStatusInsight?.data?.statusCounts && (
              <div className="border rounded-lg p-4">
                <h3 className="font-medium">{offerStatusInsight.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{offerStatusInsight.description}</p>
                <div className="mt-3 text-sm text-muted-foreground">
                  {Object.entries(offerStatusInsight.data.statusCounts as Record<string, number>).map(([status, count]) => (
                    <div key={status}>{status}: {count}</div>
                  ))}
                </div>
              </div>
            )}
            {offerAvgInsight?.data?.avgByStatus && (
              <div className="border rounded-lg p-4">
                <h3 className="font-medium">{offerAvgInsight.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{offerAvgInsight.description}</p>
                <div className="mt-3 text-sm text-muted-foreground">
                  {Object.entries(offerAvgInsight.data.avgByStatus).map(([status, avg]) => (
                    <div key={status}>
                      {status}: {Number(avg).toLocaleString("de-DE", { style: "currency", currency: "EUR" })}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {offerTopCustomersInsight?.data?.topCustomers && (
              <div className="border rounded-lg p-4">
                <h3 className="font-medium">{offerTopCustomersInsight.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{offerTopCustomersInsight.description}</p>
                <div className="mt-3 text-sm text-muted-foreground">
                  {offerTopCustomersInsight.data.topCustomers.map((entry: any, index: number) => (
                    <div key={`${entry.customer}-${index}`}>
                      {entry.customer}: {entry.count}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('analytics.aiInsightsTitle', 'AI-Insights')}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {aiInsights.length === 0 && (
              <p className="text-sm text-muted-foreground">{t('analytics.aiInsightsEmpty')}</p>
            )}
            {aiInsights.map((insight) => (
              <div key={insight.id} className="border rounded-lg p-4" data-testid={`ai-insight-${insight.id}`}>
                <h3 className="font-medium">{insight.title}</h3>
                {insight.description && (
                  <p className="text-sm text-muted-foreground mt-1">{insight.description}</p>
                )}
                {insight.data?.pairs && Array.isArray(insight.data.pairs) && (
                  <div className="mt-3 text-sm text-muted-foreground">
                    {insight.data.pairs.slice(0, 5).map((pair: any, index: number) => (
                      <div key={`${pair.source}-${pair.target}-${index}`}>
                        {pair.source} → {pair.target} · {(pair.support * 100).toFixed(1)}% · {pair.lift.toFixed(2)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('analytics.dataQualityTitle')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-center gap-8 mb-4">
              <div>
                <div className="text-sm text-muted-foreground">
                  {t('analytics.dataQualityAverage')}
                </div>
                <div className="text-3xl font-bold" data-testid="text-data-quality-average">
                  {productDataQuality?.averageScore ?? 0}%
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">
                  {t('analytics.totalProducts')}
                </div>
                <div className="text-3xl font-bold" data-testid="text-data-quality-total">
                  {productDataQuality?.totalProducts?.toLocaleString("de-DE") || 0}
                </div>
              </div>
            </div>
            <div className="text-sm text-muted-foreground mb-2">
              {t('analytics.dataQualityDistribution')}
            </div>
            <div data-testid="chart-data-quality">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={dataQualityDistribution}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" />
                  <YAxis allowDecimals={false} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" name={t('analytics.count')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('analytics.sectionProducts')}
        </h2>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t('analytics.productOverview')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 gap-4">
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <PackageCheck className="h-5 w-5 text-green-600" />
                  <span className="text-sm font-medium">{t('analytics.activeProducts')}</span>
                </div>
                <div className="text-3xl font-bold text-green-600" data-testid="text-active-products">
                  {productOverview?.active?.toLocaleString("de-DE")}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <PackageX className="h-5 w-5 text-red-600" />
                  <span className="text-sm font-medium">{t('analytics.inactiveProducts')}</span>
                </div>
                <div className="text-3xl font-bold text-red-600" data-testid="text-inactive-products">
                  {productOverview?.inactive?.toLocaleString("de-DE")}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Package className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">{t('analytics.totalProducts')}</span>
                </div>
                <div className="text-3xl font-bold" data-testid="text-total-products">
                  {productOverview?.total?.toLocaleString("de-DE")}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('analytics.productActivityTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="chart-product-activity">
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={productActivityData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="month" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="active" stackId="a" fill="#22c55e" name={t('analytics.activeProducts')} />
                  <Bar dataKey="inactive" stackId="a" fill="#ef4444" name={t('analytics.inactiveProducts')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('analytics.productPerformance')}
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('analytics.sortBy')}:</span>
          <Button
            variant={productSortBy === "quantity" ? "default" : "outline"}
            size="sm"
            onClick={() => setProductSortBy("quantity")}
            data-testid="button-sort-quantity"
          >
            {t('analytics.sortByQuantity')}
          </Button>
          <Button
            variant={productSortBy === "revenue" ? "default" : "outline"}
            size="sm"
            onClick={() => setProductSortBy("revenue")}
            data-testid="button-sort-revenue"
          >
            {t('analytics.sortByRevenue')}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-green-600">
              <TrendingUp className="h-5 w-5" />
              {t('analytics.topProducts')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {productPerformance?.topProducts
                ?.slice()
                .sort((a, b) => productSortBy === "quantity" 
                  ? b.totalQuantity - a.totalQuantity 
                  : b.totalRevenue - a.totalRevenue)
                .slice(0, 10)
                .map((product, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded hover-elevate" data-testid={`card-top-product-${index}`}>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {product.totalQuantity} {t('analytics.pieces')} • {product.orderCount} {t('analytics.orders')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{product.totalRevenue.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600">
              <Package className="h-5 w-5" />
              {t('analytics.bottomProducts')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {productPerformance?.bottomProducts
                ?.slice()
                .sort((a, b) => productSortBy === "quantity" 
                  ? a.totalQuantity - b.totalQuantity 
                  : a.totalRevenue - b.totalRevenue)
                .slice(0, 10)
                .map((product, index) => (
                <div key={index} className="flex items-center justify-between p-2 rounded hover-elevate" data-testid={`card-bottom-product-${index}`}>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{product.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {product.totalQuantity} {t('analytics.pieces')} • {product.orderCount} {t('analytics.orders')}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{product.totalRevenue.toLocaleString("de-DE", { style: "currency", currency: "EUR" })}</div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mb-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t('analytics.sectionSales')}
        </h2>
      </div>

      {/* Charts Row 1: Status Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShoppingCart className="h-5 w-5" />
              {t('analytics.orderStatusDistribution')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="chart-order-status">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={orderStatusData} cx="50%" cy="50%" labelLine={false} label={(entry) => entry.name} outerRadius={80} fill="#8884d8" dataKey="value">
                    {orderStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" />
              {t('analytics.paymentStatusDistribution')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="chart-payment-status">
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={paymentStatusData} cx="50%" cy="50%" labelLine={false} label={(entry) => entry.name} outerRadius={80} fill="#8884d8" dataKey="value">
                    {paymentStatusData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Sales Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              {t('analytics.salesTrend')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="chart-sales-trend">
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={salesTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="revenue" stroke="#8884d8" name={t('analytics.revenue')} />
                  <Line type="monotone" dataKey="orderCount" stroke="#82ca9d" name={t('analytics.orders')} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Category Sales Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5" />
              {t('analytics.categorySales')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div data-testid="chart-category-sales">
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={categorySalesData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="revenue" fill="#8884d8" name={t('analytics.revenue')} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Versandzeiten: Bestelleingang bis Versand */}
      <div className="mb-3">
        <h2 className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {t("analytics.shippingTimesTitle")}
        </h2>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              {t("analytics.shippingTimesTitle")}
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              {t("analytics.shippingTimesDescription")}
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {shippingTimes?.ordersWithShippingCount === 0 ? (
              <p className="text-sm text-muted-foreground">{t("analytics.noShippingData")}</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground">{t("analytics.averageShippingDays")}</div>
                    <div className="text-2xl font-bold" data-testid="text-average-shipping-days">
                      {shippingTimes?.averageDays != null
                        ? shippingTimes.averageDays.toFixed(1)
                        : "–"}{" "}
                      {t("analytics.days")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("analytics.medianShippingDays")}</div>
                    <div className="text-2xl font-bold" data-testid="text-median-shipping-days">
                      {shippingTimes?.medianDays != null
                        ? shippingTimes.medianDays.toFixed(1)
                        : "–"}{" "}
                      {t("analytics.days")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground">{t("analytics.ordersWithShippingData")}</div>
                    <div className="text-2xl font-bold" data-testid="text-orders-with-shipping">
                      {shippingTimes?.ordersWithShippingCount?.toLocaleString("de-DE") ?? "0"}
                    </div>
                  </div>
                </div>
                {shippingTimes?.distribution && shippingTimes.distribution.some((d) => d.count > 0) && (
                  <div>
                    <div className="text-sm text-muted-foreground mb-2">{t("analytics.shippingTimesDistribution")}</div>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={shippingTimes.distribution}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="label" />
                        <YAxis allowDecimals={false} />
                        <Tooltip />
                        <Bar dataKey="count" fill="#3b82f6" name={t("analytics.count")} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

    </div>
  );
}
