import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Scale, Search, Download, RefreshCw, AlertCircle, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

interface PriceCheckProduct {
  id: string;
  productNumber: string;
  name: string;
  active: boolean | null;
  manufacturerNumber?: string;
  priceNet: number;
  purchasePriceNet: number | null;
}

interface OverviewResponse {
  products: PriceCheckProduct[];
  total: number;
}

type Verdict = "green" | "red" | "none";

const PAGE_SIZE = 50;
const ALL = "__all__";
const DEFAULT_THRESHOLD = 7;

const currencyFormatter = new Intl.NumberFormat("de-DE", {
  style: "currency",
  currency: "EUR",
});

const percentFormatter = new Intl.NumberFormat("de-DE", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

interface PriceRow extends PriceCheckProduct {
  diffAbs: number | null;
  diffPct: number | null;
  verdict: Verdict;
}

export default function PriceCheckPage() {
  const { t } = useTranslation();

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<OverviewResponse>({
    queryKey: ["/api/products/overview"],
  });

  const [search, setSearch] = useState("");
  const [verdictFilter, setVerdictFilter] = useState<string>(ALL);
  const [thresholdInput, setThresholdInput] = useState(String(DEFAULT_THRESHOLD));
  const [page, setPage] = useState(1);

  const threshold = useMemo(() => {
    const n = Number(thresholdInput.replace(",", "."));
    return Number.isFinite(n) ? n : DEFAULT_THRESHOLD;
  }, [thresholdInput]);

  const rows = useMemo<PriceRow[]>(() => {
    const products = data?.products ?? [];
    return products.map((p) => {
      const ek = p.purchasePriceNet;
      if (ek == null || ek <= 0) {
        return { ...p, diffAbs: null, diffPct: null, verdict: "none" as Verdict };
      }
      const diffAbs = p.priceNet - ek;
      const diffPct = (diffAbs / ek) * 100;
      const verdict: Verdict = diffPct >= threshold ? "green" : "red";
      return { ...p, diffAbs, diffPct, verdict };
    });
  }, [data, threshold]);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (term) {
        const haystack = `${r.productNumber} ${r.name} ${r.manufacturerNumber ?? ""}`.toLowerCase();
        if (!haystack.includes(term)) return false;
      }
      if (verdictFilter !== ALL && r.verdict !== verdictFilter) return false;
      return true;
    });
  }, [rows, search, verdictFilter]);

  const stats = useMemo(() => {
    let withEk = 0;
    let green = 0;
    let red = 0;
    let none = 0;
    for (const r of rows) {
      if (r.verdict === "none") none += 1;
      else {
        withEk += 1;
        if (r.verdict === "green") green += 1;
        else red += 1;
      }
    }
    return { total: rows.length, withEk, green, red, none };
  }, [rows]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const pageRows = useMemo(
    () => filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [filtered, currentPage],
  );

  const resetFilters = () => {
    setSearch("");
    setVerdictFilter(ALL);
    setThresholdInput(String(DEFAULT_THRESHOLD));
    setPage(1);
  };

  const exportCsv = () => {
    if (filtered.length === 0) return;
    const header = [
      t("priceCheck.table.productNumber"),
      t("priceCheck.table.name"),
      t("priceCheck.table.priceNet"),
      t("priceCheck.table.purchaseNet"),
      t("priceCheck.table.diffAbs"),
      t("priceCheck.table.diffPct"),
      t("priceCheck.table.verdict"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const r of filtered) {
      lines.push(
        [
          r.productNumber,
          r.name,
          r.priceNet,
          r.purchasePriceNet ?? "",
          r.diffAbs ?? "",
          r.diffPct != null ? r.diffPct.toFixed(2) : "",
          t(`priceCheck.verdict.${r.verdict}`),
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
    link.download = "preispruefung.csv";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Scale className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("priceCheck.title")}</h1>
            <p className="text-muted-foreground">{t("priceCheck.description")}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching} data-testid="pricecheck-refresh">
            <RefreshCw className={`h-4 w-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            {t("priceCheck.refresh")}
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={filtered.length === 0} data-testid="pricecheck-export">
            <Download className="h-4 w-4 mr-2" />
            {t("priceCheck.exportCsv")}
          </Button>
        </div>
      </div>

      {isError ? (
        <Card>
          <CardContent className="pt-6">
            <p className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              {error instanceof Error ? error.message : t("priceCheck.errorTitle")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("priceCheck.stats.total")}</p>
            <p className="text-2xl font-semibold">{stats.total}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("priceCheck.stats.withEk")}</p>
            <p className="text-2xl font-semibold">{stats.withEk}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("priceCheck.stats.green")}</p>
            <p className="text-2xl font-semibold text-green-600">{stats.green}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("priceCheck.stats.red")}</p>
            <p className="text-2xl font-semibold text-destructive">{stats.red}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">{t("priceCheck.stats.none")}</p>
            <p className="text-2xl font-semibold text-muted-foreground">{stats.none}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t("priceCheck.filtersTitle")}</CardTitle>
          <CardDescription>{t("priceCheck.thresholdHint", { threshold })}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t("priceCheck.filters.searchPlaceholder")}
                className="pl-8"
                data-testid="pricecheck-search"
              />
            </div>

            <Select
              value={verdictFilter}
              onValueChange={(v) => {
                setVerdictFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger data-testid="pricecheck-verdict">
                <SelectValue placeholder={t("priceCheck.filters.verdict")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("priceCheck.filters.allVerdicts")}</SelectItem>
                <SelectItem value="green">{t("priceCheck.verdict.green")}</SelectItem>
                <SelectItem value="red">{t("priceCheck.verdict.red")}</SelectItem>
                <SelectItem value="none">{t("priceCheck.verdict.none")}</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="pricecheck-threshold" className="text-xs text-muted-foreground">
                  {t("priceCheck.filters.threshold")}
                </Label>
                <Input
                  id="pricecheck-threshold"
                  type="number"
                  inputMode="decimal"
                  value={thresholdInput}
                  onChange={(e) => {
                    setThresholdInput(e.target.value);
                    setPage(1);
                  }}
                  data-testid="pricecheck-threshold"
                />
              </div>
              <Button variant="ghost" size="sm" onClick={resetFilters} data-testid="pricecheck-reset">
                <X className="h-4 w-4 mr-2" />
                {t("priceCheck.filters.reset")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>
            {t("priceCheck.pagination.showing", { count: filtered.length, total: stats.total })}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground py-8 text-center">{t("priceCheck.loading")}</p>
          ) : pageRows.length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">{t("priceCheck.noResults")}</p>
          ) : (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">{t("priceCheck.table.productNumber")}</TableHead>
                    <TableHead className="min-w-[220px]">{t("priceCheck.table.name")}</TableHead>
                    <TableHead className="text-right">{t("priceCheck.table.priceNet")}</TableHead>
                    <TableHead className="text-right">{t("priceCheck.table.purchaseNet")}</TableHead>
                    <TableHead className="text-right">{t("priceCheck.table.diffAbs")}</TableHead>
                    <TableHead className="text-right">{t("priceCheck.table.diffPct")}</TableHead>
                    <TableHead className="w-[120px]">{t("priceCheck.table.verdict")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pageRows.map((r) => (
                    <PriceRowView key={r.id} row={r} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {pageCount > 1 ? (
            <div className="flex items-center justify-between pt-4">
              <span className="text-sm text-muted-foreground">
                {t("priceCheck.pagination.pageInfo", { page: currentPage, pages: pageCount })}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={currentPage <= 1}
                >
                  {t("priceCheck.pagination.prev")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  disabled={currentPage >= pageCount}
                >
                  {t("priceCheck.pagination.next")}
                </Button>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}

function PriceRowView({ row }: { row: PriceRow }) {
  const { t } = useTranslation();
  const dotClass =
    row.verdict === "green"
      ? "bg-green-600"
      : row.verdict === "red"
        ? "bg-destructive"
        : "bg-muted-foreground/40";

  return (
    <TableRow>
      <TableCell className="font-mono text-sm">{row.productNumber}</TableCell>
      <TableCell>
        <div className="font-medium">{row.name}</div>
        {row.manufacturerNumber ? (
          <div className="text-xs text-muted-foreground">{row.manufacturerNumber}</div>
        ) : null}
      </TableCell>
      <TableCell className="text-right font-mono">{currencyFormatter.format(row.priceNet)}</TableCell>
      <TableCell className="text-right font-mono">
        {row.purchasePriceNet != null ? currencyFormatter.format(row.purchasePriceNet) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono">
        {row.diffAbs != null ? currencyFormatter.format(row.diffAbs) : "—"}
      </TableCell>
      <TableCell className="text-right font-mono">
        {row.diffPct != null ? percentFormatter.format(row.diffPct / 100) : "—"}
      </TableCell>
      <TableCell>
        <span className="inline-flex items-center gap-2">
          <span className={`inline-block h-3 w-3 rounded-full ${dotClass}`} />
          {row.verdict === "none" ? (
            <Badge variant="outline" className="text-muted-foreground">
              {t("priceCheck.verdict.none")}
            </Badge>
          ) : (
            <span className="text-sm">{t(`priceCheck.verdict.${row.verdict}`)}</span>
          )}
        </span>
      </TableCell>
    </TableRow>
  );
}
