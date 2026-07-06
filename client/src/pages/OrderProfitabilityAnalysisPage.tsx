import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  BarChart3,
  RefreshCw,
  AlertCircle,
  Download,
  ArrowRight,
  Package,
} from "lucide-react";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import HerstellMarginIndicator from "@/components/HerstellMarginIndicator";
import type { Order, OrderStatus } from "@shared/schema";

type AnalysisResponse = {
  orders: Order[];
  summary: {
    totalOrders: number;
    ordersWithHerstellpreis: number;
    coveragePercent: number;
    crmGreen: number;
    crmRed: number;
    crmNone: number;
    lossCount: number;
    belowCrmThresholdCount: number;
    totalDb1: number | null;
    avgDb1: number | null;
    avgMarginPercent: number | null;
    medianMarginPercent: number | null;
    totalNetRevenueWithHk: number | null;
    totalHerstellkosten: number | null;
  };
  worstOrders: Order[];
  bestOrders: Order[];
  total: number;
  profitabilityMinMarginPercent?: number;
};

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const percentFormatter = new Intl.NumberFormat("de-DE", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const PIE_COLORS = {
  green: "#16a34a",
  red: "#dc2626",
  none: "#94a3b8",
};

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}


function CompactOrderRow({ order }: { order: Order }) {
  const p = order.profitability;
  return (
    <TableRow>
      <TableCell className="font-mono">{order.orderNumber}</TableCell>
      <TableCell>{order.customerName}</TableCell>
      <TableCell className="text-right font-mono tabular-nums">
        {p?.db1Total != null ? currencyFormatter.format(p.db1Total) : "—"}
      </TableCell>
      <TableCell className="text-right">
        {p ? (
          <HerstellMarginIndicator
            marginPercent={p.marginPercent}
            marginOnRevenuePercent={p.marginOnRevenuePercent}
            verdict={p.crmVerdict}
          />
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

export default function OrderProfitabilityAnalysisPage() {
  const { t } = useTranslation();
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (statusFilter !== "all") params.set("status", statusFilter);
    return params.toString();
  }, [dateFrom, dateTo, statusFilter]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<AnalysisResponse>({
    queryKey: ["/api/orders/profitability-analysis", queryString],
    queryFn: async () => {
      const url = queryString
        ? `/api/orders/profitability-analysis?${queryString}`
        : "/api/orders/profitability-analysis";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || res.statusText);
      }
      return res.json();
    },
  });

  const crmThreshold = data?.profitabilityMinMarginPercent ?? 20;
  const summary = data?.summary;

  const crmPieData = useMemo(
    () =>
      summary
        ? [
            {
              name: t("orderProfitabilityAnalysis.verdict.green"),
              value: summary.crmGreen,
              key: "green",
            },
            {
              name: t("orderProfitabilityAnalysis.verdict.red"),
              value: summary.crmRed,
              key: "red",
            },
            {
              name: t("orderProfitabilityAnalysis.verdict.none"),
              value: summary.crmNone,
              key: "none",
            },
          ]
        : [],
    [summary, t],
  );

  const exportCsv = () => {
    if (!data?.orders.length) return;
    const header = [
      t("orderProfitabilityAnalysis.table.orderNumber"),
      t("orderProfitabilityAnalysis.table.customer"),
      t("orderProfitabilityAnalysis.table.date"),
      t("orderProfitabilityAnalysis.table.netTotal"),
      t("orderProfitabilityAnalysis.table.db1"),
      t("orderProfitabilityAnalysis.table.marginOnCost"),
      t("orderProfitabilityAnalysis.table.coverage"),
      t("orderProfitabilityAnalysis.table.crmVerdict"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const order of data.orders) {
      const p = order.profitability;
      lines.push(
        [
          order.orderNumber,
          order.customerName,
          order.orderDate,
          order.netTotalAmount,
          p?.db1Total ?? "",
          p?.marginPercent ?? "",
          p?.coveragePercent ?? "",
          p ? t(`orderProfitabilityAnalysis.verdict.${p.crmVerdict}`) : "",
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    const csv = "\ufeff" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "bestell-db-analyse.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const crmGreenShare =
    summary && summary.ordersWithHerstellpreis > 0
      ? Math.round((summary.crmGreen / summary.ordersWithHerstellpreis) * 1000) / 10
      : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("orderProfitabilityAnalysis.title")}</h1>
            <p className="text-muted-foreground max-w-2xl">
              {t("orderProfitabilityAnalysis.description")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("orderProfitabilityAnalysis.refresh")}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!data?.orders.length}>
            <Download className="h-4 w-4 mr-2" />
            {t("orderProfitabilityAnalysis.exportCsv")}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/orders">
              <Package className="h-4 w-4 mr-2" />
              {t("orderProfitabilityAnalysis.openOrders")}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("orderProfitabilityAnalysis.filters.title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-4 items-end">
          <div className="space-y-1">
            <Label htmlFor="date-from">{t("orderProfitabilityAnalysis.filters.dateFrom")}</Label>
            <Input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="date-to">{t("orderProfitabilityAnalysis.filters.dateTo")}</Label>
            <Input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
            />
          </div>
          <div className="space-y-1 min-w-[180px]">
            <Label>{t("orderProfitabilityAnalysis.filters.status")}</Label>
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as OrderStatus | "all")}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
                <SelectItem value="open">{t("status.open")}</SelectItem>
                <SelectItem value="in_progress">{t("status.in_progress")}</SelectItem>
                <SelectItem value="completed">{t("status.completed")}</SelectItem>
                <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {error instanceof Error ? error.message : t("orderProfitabilityAnalysis.errorTitle")}
            </p>
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="pt-6 text-muted-foreground">
            {t("orderProfitabilityAnalysis.loading")}
          </CardContent>
        </Card>
      ) : summary ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("orderProfitabilityAnalysis.executiveSummary")}</CardTitle>
              <CardDescription>
                {t("orderProfitabilityAnalysis.executiveSummaryHint", { crmThreshold })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("orderProfitabilityAnalysis.kpi.totalOrders")}</p>
                <p className="text-2xl font-semibold tabular-nums">{summary.totalOrders}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("orderProfitabilityAnalysis.kpi.hkCoverage", {
                    percent: summary.coveragePercent,
                    withData: summary.ordersWithHerstellpreis,
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("orderProfitabilityAnalysis.kpi.crmGreenShare")}</p>
                <p className="text-2xl font-semibold tabular-nums">{crmGreenShare} %</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("orderProfitabilityAnalysis.kpi.crmGreenShareHint", {
                    green: summary.crmGreen,
                    withData: summary.ordersWithHerstellpreis,
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("orderProfitabilityAnalysis.kpi.totalDb1")}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.totalDb1 != null ? currencyFormatter.format(summary.totalDb1) : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.avgDb1 != null
                    ? t("orderProfitabilityAnalysis.kpi.avgDb1Hint", {
                        amount: currencyFormatter.format(summary.avgDb1),
                      })
                    : t("orderProfitabilityAnalysis.kpi.noMarginData")}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("orderProfitabilityAnalysis.kpi.avgMarginOnCost")}</p>
                <p className="text-2xl font-semibold tabular-nums">
                  {summary.avgMarginPercent != null
                    ? `${percentFormatter.format(summary.avgMarginPercent)} %`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.medianMarginPercent != null
                    ? t("orderProfitabilityAnalysis.kpi.medianOnCostHint", {
                        median: percentFormatter.format(summary.medianMarginPercent),
                      })
                    : t("orderProfitabilityAnalysis.kpi.noMarginData")}
                </p>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("orderProfitabilityAnalysis.charts.crmDistribution")}</CardTitle>
                <CardDescription>
                  {t("orderProfitabilityAnalysis.charts.crmDistributionHint", { crmThreshold })}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                {crmPieData.some((d) => d.value > 0) ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={crmPieData}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={90}
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {crmPieData.map((entry) => (
                          <Cell
                            key={entry.key}
                            fill={PIE_COLORS[entry.key as keyof typeof PIE_COLORS]}
                          />
                        ))}
                      </Pie>
                      <Tooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <p className="text-muted-foreground text-center py-12">
                    {t("orderProfitabilityAnalysis.noData")}
                  </p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("orderProfitabilityAnalysis.stats.title")}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between">
                  <span>{t("orderProfitabilityAnalysis.stats.crmGreen", { threshold: crmThreshold })}</span>
                  <span className="font-mono">{summary.crmGreen}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("orderProfitabilityAnalysis.stats.crmRed", { threshold: crmThreshold })}</span>
                  <span className="font-mono">{summary.crmRed}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("orderProfitabilityAnalysis.stats.noHerstellpreis")}</span>
                  <span className="font-mono">{summary.crmNone}</span>
                </div>
                <div className="flex justify-between">
                  <span>{t("orderProfitabilityAnalysis.stats.loss")}</span>
                  <span className="font-mono">{summary.lossCount}</span>
                </div>
                {summary.totalHerstellkosten != null ? (
                  <div className="flex justify-between border-t pt-3">
                    <span>{t("orderProfitabilityAnalysis.stats.totalHerstellkosten")}</span>
                    <span className="font-mono">
                      {currencyFormatter.format(summary.totalHerstellkosten)}
                    </span>
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("orderProfitabilityAnalysis.worstTitle")}</CardTitle>
                <CardDescription>{t("orderProfitabilityAnalysis.worstHint")}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("orderProfitabilityAnalysis.table.orderNumber")}</TableHead>
                      <TableHead>{t("orderProfitabilityAnalysis.table.customer")}</TableHead>
                      <TableHead className="text-right">{t("orderProfitabilityAnalysis.table.db1")}</TableHead>
                      <TableHead className="text-right">{t("orderProfitabilityAnalysis.table.marginOnCost")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.worstOrders ?? []).map((order) => (
                      <CompactOrderRow key={order.id} order={order} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("orderProfitabilityAnalysis.bestTitle")}</CardTitle>
                <CardDescription>{t("orderProfitabilityAnalysis.bestHint")}</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("orderProfitabilityAnalysis.table.orderNumber")}</TableHead>
                      <TableHead>{t("orderProfitabilityAnalysis.table.customer")}</TableHead>
                      <TableHead className="text-right">{t("orderProfitabilityAnalysis.table.db1")}</TableHead>
                      <TableHead className="text-right">{t("orderProfitabilityAnalysis.table.marginOnCost")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(data?.bestOrders ?? []).map((order) => (
                      <CompactOrderRow key={order.id} order={order} />
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </>
      ) : null}
    </div>
  );
}
