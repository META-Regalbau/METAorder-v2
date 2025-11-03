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
import type { SalesChannel } from "@shared/schema";
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

  // Export analytics data
  const handleExport = (format: "csv" | "excel" | "json") => {
    try {
      const data = {
        summary,
        orderStatus,
        paymentStatus,
        productOverview,
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
    <div className="w-full max-w-7xl mx-auto">
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

      {/* Product Overview */}
      <Card className="mb-6">
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

      {/* Sales Trend Chart */}
      <Card className="mb-6">
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
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            {t('analytics.categorySales')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div data-testid="chart-category-sales">
            <ResponsiveContainer width="100%" height={400}>
              <BarChart data={categorySalesData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" angle={-45} textAnchor="end" height={100} />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="revenue" fill="#8884d8" name={t('analytics.revenue')} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Product Performance */}
      <div className="mb-4 flex items-center gap-4">
        <span className="text-sm font-medium">{t('analytics.sortBy')}:</span>
        <div className="flex gap-2">
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

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
    </div>
  );
}
