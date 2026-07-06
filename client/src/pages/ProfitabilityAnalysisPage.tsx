import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  AlertCircle,
  Download,
  BarChart3,
  Scale,
  ArrowRight,
} from "lucide-react";
import {
  BarChart,
  Bar,
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
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  buildProfitabilityAnalysis,
  DEFAULT_CRM_THRESHOLD,
  DEFAULT_PRICE_CHECK_THRESHOLD,
  sortByMargin,
  type ProfitabilityProductInput,
} from "@/lib/profitabilityAnalysis";

interface OverviewResponse {
  products: ProfitabilityProductInput[];
  total: number;
  profitabilityMinMarginPercent?: number;
}

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

const BUCKET_COLORS = ["#dc2626", "#f97316", "#eab308", "#22c55e", "#15803d"];

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function VerdictBadge({
  verdict,
  label,
}: {
  verdict: "green" | "red" | "none";
  label: string;
}) {
  const variant =
    verdict === "green" ? "default" : verdict === "red" ? "destructive" : "outline";
  const className =
    verdict === "green"
      ? "bg-green-600 hover:bg-green-600/90 border-transparent"
      : verdict === "none"
        ? "text-muted-foreground font-normal"
        : undefined;

  return (
    <Badge variant={variant} className={className}>
      {label}
    </Badge>
  );
}

function PriceCell({
  product,
  showDiscount,
}: {
  product: { listPriceNet: number; effectivePriceNet: number };
  showDiscount: boolean;
}) {
  if (!showDiscount) {
    return <>{currencyFormatter.format(product.listPriceNet)}</>;
  }
  return (
    <div className="text-right">
      <div>{currencyFormatter.format(product.effectivePriceNet)}</div>
      <div className="text-xs text-muted-foreground line-through">
        {currencyFormatter.format(product.listPriceNet)}
      </div>
    </div>
  );
}

export default function ProfitabilityAnalysisPage() {
  const { t } = useTranslation();
  const [activeOnly, setActiveOnly] = useState(true);
  const [dealerDiscountInput, setDealerDiscountInput] = useState("0");

  const dealerDiscountPercent = useMemo(() => {
    const n = Number(dealerDiscountInput.replace(",", "."));
    if (!Number.isFinite(n) || n < 0) return 0;
    return Math.min(n, 100);
  }, [dealerDiscountInput]);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<OverviewResponse>({
    queryKey: ["/api/products/overview"],
  });

  const crmThreshold = data?.profitabilityMinMarginPercent ?? DEFAULT_CRM_THRESHOLD;

  const analysis = useMemo(
    () =>
      buildProfitabilityAnalysis(data?.products ?? [], {
        crmThreshold,
        priceCheckThreshold: DEFAULT_PRICE_CHECK_THRESHOLD,
        activeOnly,
        dealerDiscountPercent,
      }),
    [data?.products, crmThreshold, activeOnly, dealerDiscountPercent],
  );

  const worstProducts = useMemo(
    () => sortByMargin(analysis.products, "asc", 15),
    [analysis.products],
  );

  const bestProducts = useMemo(
    () => sortByMargin(analysis.products, "desc", 10),
    [analysis.products],
  );

  const crmPieData = useMemo(
    () => [
      {
        name: t("profitabilityAnalysis.verdict.green"),
        value: analysis.summary.crmGreen,
        key: "green",
      },
      {
        name: t("profitabilityAnalysis.verdict.red"),
        value: analysis.summary.crmRed,
        key: "red",
      },
      {
        name: t("profitabilityAnalysis.verdict.none"),
        value: analysis.summary.crmNone,
        key: "none",
      },
    ],
    [analysis.summary, t],
  );

  const bucketChartData = useMemo(
    () =>
      analysis.buckets.map((bucket) => ({
        name: t(bucket.labelKey),
        count: bucket.count,
      })),
    [analysis.buckets, t],
  );

  const exportCsv = () => {
    const header = [
      t("profitabilityAnalysis.table.productNumber"),
      t("profitabilityAnalysis.table.name"),
      t("profitabilityAnalysis.table.active"),
      t("profitabilityAnalysis.table.listPriceNet"),
      ...(dealerDiscountPercent > 0
        ? [
            t("profitabilityAnalysis.table.dealerDiscount"),
            t("profitabilityAnalysis.table.effectivePriceNet"),
          ]
        : []),
      t("profitabilityAnalysis.table.herstellpreis"),
      t("profitabilityAnalysis.table.marginAbs"),
      t("profitabilityAnalysis.table.marginPct"),
      t("profitabilityAnalysis.table.crmVerdict"),
      t("profitabilityAnalysis.table.priceCheckVerdict"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const p of analysis.products) {
      lines.push(
        [
          p.productNumber,
          p.name,
          p.active === false ? t("profitabilityAnalysis.table.inactive") : t("profitabilityAnalysis.table.activeYes"),
          p.listPriceNet,
          ...(dealerDiscountPercent > 0
            ? [dealerDiscountPercent, p.effectivePriceNet]
            : []),
          p.herstellpreisNet ?? "",
          p.marginAbs ?? "",
          p.marginPercent ?? "",
          t(`profitabilityAnalysis.verdict.${p.crmVerdict}`),
          t(`profitabilityAnalysis.verdict.${p.priceCheckVerdict}`),
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
    link.download = "rentabilitaets-analyse.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const { summary } = analysis;
  const crmGreenShare =
    summary.withHerstellpreis > 0
      ? Math.round((summary.crmGreen / summary.withHerstellpreis) * 1000) / 10
      : 0;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("profitabilityAnalysis.title")}</h1>
            <p className="text-muted-foreground max-w-2xl">{t("profitabilityAnalysis.description")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-2 mr-2">
            <Switch
              id="active-only"
              checked={activeOnly}
              onCheckedChange={setActiveOnly}
            />
            <Label htmlFor="active-only">{t("profitabilityAnalysis.activeOnly")}</Label>
          </div>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("profitabilityAnalysis.refresh")}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={analysis.products.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {t("profitabilityAnalysis.exportCsv")}
          </Button>
          <Button variant="outline" asChild>
            <Link href="/price-check">
              <Scale className="h-4 w-4 mr-2" />
              {t("profitabilityAnalysis.openPriceCheck")}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {error instanceof Error ? error.message : t("profitabilityAnalysis.errorTitle")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {isLoading ? (
        <Card>
          <CardContent className="pt-6 text-muted-foreground">{t("profitabilityAnalysis.loading")}</CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("profitabilityAnalysis.dealerDiscount.title")}</CardTitle>
              <CardDescription>{t("profitabilityAnalysis.dealerDiscount.description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap items-end gap-4">
              <div className="grid gap-2 w-full max-w-xs">
                <Label htmlFor="dealer-discount">{t("profitabilityAnalysis.dealerDiscount.label")}</Label>
                <Input
                  id="dealer-discount"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={dealerDiscountInput}
                  onChange={(e) => setDealerDiscountInput(e.target.value)}
                  data-testid="input-dealer-discount"
                />
                <p className="text-xs text-muted-foreground">
                  {t("profitabilityAnalysis.dealerDiscount.hint")}
                </p>
              </div>
              {dealerDiscountPercent > 0 ? (
                <div className="text-sm text-muted-foreground">
                  {t("profitabilityAnalysis.dealerDiscount.activeHint", {
                    discount: dealerDiscountPercent.toLocaleString("de-DE"),
                  })}
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <CardTitle>{t("profitabilityAnalysis.executiveSummary")}</CardTitle>
              <CardDescription>
                {dealerDiscountPercent > 0
                  ? t("profitabilityAnalysis.executiveSummaryHintWithDiscount", {
                      crmThreshold: crmThreshold.toLocaleString("de-DE"),
                      priceCheckThreshold: DEFAULT_PRICE_CHECK_THRESHOLD,
                      discount: dealerDiscountPercent.toLocaleString("de-DE"),
                    })
                  : t("profitabilityAnalysis.executiveSummaryHint", {
                      crmThreshold: crmThreshold.toLocaleString("de-DE"),
                      priceCheckThreshold: DEFAULT_PRICE_CHECK_THRESHOLD,
                    })}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <div>
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.kpi.crmGreenShare")}</p>
                <p className="text-3xl font-semibold text-green-600">
                  {percentFormatter.format(crmGreenShare / 100)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("profitabilityAnalysis.kpi.crmGreenShareHint", {
                    green: summary.crmGreen,
                    withData: summary.withHerstellpreis,
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.kpi.belowCrm")}</p>
                <p className="text-3xl font-semibold text-destructive">{summary.belowCrmThresholdCount}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {t("profitabilityAnalysis.kpi.belowCrmHint", {
                    threshold: crmThreshold.toLocaleString("de-DE"),
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.kpi.loss")}</p>
                <p className="text-3xl font-semibold text-destructive">{summary.lossCount}</p>
                <p className="text-xs text-muted-foreground mt-1">{t("profitabilityAnalysis.kpi.lossHint")}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.kpi.avgMargin")}</p>
                <p className="text-3xl font-semibold">
                  {summary.avgMarginPercent != null
                    ? `${summary.avgMarginPercent.toLocaleString("de-DE")} %`
                    : "—"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary.medianMarginPercent != null
                    ? t("profitabilityAnalysis.kpi.medianHint", {
                        median: summary.medianMarginPercent.toLocaleString("de-DE"),
                      })
                    : t("profitabilityAnalysis.kpi.noMarginData")}
                </p>
              </div>
              {dealerDiscountPercent > 0 ? (
                <div className="md:col-span-2 lg:col-span-4 border-t border-border/60 pt-4">
                  <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.kpi.flippedToRed")}</p>
                  <p className="text-2xl font-semibold text-amber-600">{summary.flippedToRedCount}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("profitabilityAnalysis.kpi.flippedToRedHint")}
                  </p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-4">
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.stats.total")}</p>
                <p className="text-2xl font-semibold">{summary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.stats.coverage")}</p>
                <p className="text-2xl font-semibold">{percentFormatter.format(summary.coveragePercent / 100)}</p>
                <p className="text-xs text-muted-foreground">{summary.withHerstellpreis} / {summary.total}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  {t("profitabilityAnalysis.stats.crmGreen", { threshold: crmThreshold })}
                </p>
                <p className="text-2xl font-semibold text-green-600">{summary.crmGreen}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">
                  {t("profitabilityAnalysis.stats.crmRed", { threshold: crmThreshold })}
                </p>
                <p className="text-2xl font-semibold text-destructive">{summary.crmRed}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.stats.priceCheckGreen")}</p>
                <p className="text-2xl font-semibold text-green-600">{summary.priceCheckGreen}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <p className="text-sm text-muted-foreground">{t("profitabilityAnalysis.stats.noHerstellpreis")}</p>
                <p className="text-2xl font-semibold text-muted-foreground">{summary.crmNone}</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t("profitabilityAnalysis.charts.crmDistribution")}</CardTitle>
                <CardDescription>
                  {t("profitabilityAnalysis.charts.crmDistributionHint", {
                    threshold: crmThreshold.toLocaleString("de-DE"),
                  })}
                </CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={crmPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      outerRadius={90}
                      label={({ name, value }) => (value > 0 ? `${name}: ${value}` : "")}
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
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t("profitabilityAnalysis.charts.marginBuckets")}</CardTitle>
                <CardDescription>{t("profitabilityAnalysis.charts.marginBucketsHint")}</CardDescription>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={bucketChartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-15} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="count" name={t("profitabilityAnalysis.charts.products")}>
                      {bucketChartData.map((_, index) => (
                        <Cell key={index} fill={BUCKET_COLORS[index % BUCKET_COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <div className="grid xl:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-destructive">
                  <TrendingDown className="h-5 w-5" />
                  {t("profitabilityAnalysis.worstTitle")}
                </CardTitle>
                <CardDescription>{t("profitabilityAnalysis.worstHint")}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("profitabilityAnalysis.table.productNumber")}</TableHead>
                      <TableHead>{t("profitabilityAnalysis.table.name")}</TableHead>
                      <TableHead className="text-right">
                        {dealerDiscountPercent > 0
                          ? t("profitabilityAnalysis.table.effectivePriceNet")
                          : t("profitabilityAnalysis.table.listPriceNet")}
                      </TableHead>
                      <TableHead className="text-right">{t("profitabilityAnalysis.table.marginPct")}</TableHead>
                      <TableHead>{t("profitabilityAnalysis.table.crmVerdict")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {worstProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          {t("profitabilityAnalysis.noData")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      worstProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.productNumber}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={p.name}>
                            {p.name}
                          </TableCell>
                          <TableCell className="text-right">
                            <PriceCell product={p} showDiscount={dealerDiscountPercent > 0} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.marginPercent != null ? `${p.marginPercent.toLocaleString("de-DE")} %` : "—"}
                            {dealerDiscountPercent > 0 &&
                            p.catalogMarginPercent != null &&
                            p.catalogCrmVerdict === "green" &&
                            p.crmVerdict === "red" ? (
                              <div className="text-xs text-amber-600 font-normal">
                                {t("profitabilityAnalysis.table.wasGreen", {
                                  margin: p.catalogMarginPercent.toLocaleString("de-DE"),
                                })}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <VerdictBadge
                              verdict={p.crmVerdict}
                              label={t(`profitabilityAnalysis.verdict.${p.crmVerdict}`)}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-green-600">
                  <TrendingUp className="h-5 w-5" />
                  {t("profitabilityAnalysis.bestTitle")}
                </CardTitle>
                <CardDescription>{t("profitabilityAnalysis.bestHint")}</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("profitabilityAnalysis.table.productNumber")}</TableHead>
                      <TableHead>{t("profitabilityAnalysis.table.name")}</TableHead>
                      <TableHead className="text-right">
                        {dealerDiscountPercent > 0
                          ? t("profitabilityAnalysis.table.effectivePriceNet")
                          : t("profitabilityAnalysis.table.listPriceNet")}
                      </TableHead>
                      <TableHead className="text-right">{t("profitabilityAnalysis.table.marginPct")}</TableHead>
                      <TableHead>{t("profitabilityAnalysis.table.crmVerdict")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bestProducts.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={5} className="text-muted-foreground">
                          {t("profitabilityAnalysis.noData")}
                        </TableCell>
                      </TableRow>
                    ) : (
                      bestProducts.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="font-mono text-xs">{p.productNumber}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={p.name}>
                            {p.name}
                          </TableCell>
                          <TableCell className="text-right">
                            <PriceCell product={p} showDiscount={dealerDiscountPercent > 0} />
                          </TableCell>
                          <TableCell className="text-right font-mono">
                            {p.marginPercent != null ? `${p.marginPercent.toLocaleString("de-DE")} %` : "—"}
                            {dealerDiscountPercent > 0 &&
                            p.catalogMarginPercent != null &&
                            p.catalogCrmVerdict === "green" &&
                            p.crmVerdict === "red" ? (
                              <div className="text-xs text-amber-600 font-normal">
                                {t("profitabilityAnalysis.table.wasGreen", {
                                  margin: p.catalogMarginPercent.toLocaleString("de-DE"),
                                })}
                              </div>
                            ) : null}
                          </TableCell>
                          <TableCell>
                            <VerdictBadge
                              verdict={p.crmVerdict}
                              label={t(`profitabilityAnalysis.verdict.${p.crmVerdict}`)}
                            />
                          </TableCell>
                        </TableRow>
                      ))
                    )}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t("profitabilityAnalysis.interpretationTitle")}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground space-y-2">
              <p>{t("profitabilityAnalysis.interpretation.catalog")}</p>
              <p>{t("profitabilityAnalysis.interpretation.crmVsPriceCheck", { threshold: crmThreshold })}</p>
              <p>{t("profitabilityAnalysis.interpretation.gaps")}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
