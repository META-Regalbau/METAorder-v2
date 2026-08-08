import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Percent, Download, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Tier = {
  label: string | null;
  discountPercent: number;
  thresholdAmount: number | null;
  allowStacking: boolean;
};

type Row = {
  customerId: string;
  customerNumber: string | null;
  email: string | null;
  company: string | null;
  groupName: string | null;
  standardDiscountPercent: number | null;
  individualPriceCount: number;
  priceListDiscountPercent: number | null;
  articleDiscountPercent: number | null;
  tiers: Tier[];
  maxTierPercent: number | null;
  maxTotalDiscountPercent: number | null;
};

type Response = {
  summary: {
    customersTotal: number;
    matched: number;
    withIndividualPrices: number;
    withStandardDiscount: number;
    withTiers: number;
    medianDiscount: number | null;
    maxDiscount: number | null;
    syncedAt: string | null;
  };
  rows: Row[];
};

const pct = (v: number | null | undefined) =>
  v == null ? "—" : `${v.toLocaleString("de-DE", { maximumFractionDigits: 1 })} %`;
const eur = (v: number | null | undefined) =>
  v == null ? "—" : v.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

export default function DiscountOverviewPage() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [only, setOnly] = useState("with-discount");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery<Response>({
    queryKey: ["/api/crm/discount-overview", only, search],
    queryFn: async () => {
      const params = new URLSearchParams({ only, limit: "500" });
      if (search.trim()) params.set("search", search.trim());
      const res = await fetch(`/api/crm/discount-overview?${params}`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const rows = data?.rows ?? [];
  const summary = data?.summary;

  /** Verteilung über 5-%-Stufen — zeigt, wo die Masse der Kunden liegt. */
  const buckets = useMemo(() => {
    const map = new Map<number, number>();
    for (const r of rows) {
      if (r.maxTotalDiscountPercent == null) continue;
      const b = Math.round(r.maxTotalDiscountPercent / 5) * 5;
      map.set(b, (map.get(b) ?? 0) + 1);
    }
    const list = [...map.entries()].sort((a, b) => a[0] - b[0]);
    const max = Math.max(1, ...list.map(([, n]) => n));
    return list.map(([stufe, n]) => ({ stufe, n, anteil: n / max }));
  }, [rows]);

  const exportCsv = () => {
    const head = [
      "kundennummer", "firma", "email", "kundengruppe",
      "prozentrabatt", "individuelle_preise", "preislisten_rabatt",
      "artikel_rabatt", "max_zusatzrabatt", "max_gesamt", "staffeln",
    ].join(";");
    const body = rows.map((r) =>
      [
        r.customerNumber ?? "", (r.company ?? "").replace(/;/g, ","), r.email ?? "", r.groupName ?? "",
        r.standardDiscountPercent ?? "", r.individualPriceCount, r.priceListDiscountPercent?.toFixed(1) ?? "",
        r.articleDiscountPercent?.toFixed(1) ?? "", r.maxTierPercent ?? "",
        r.maxTotalDiscountPercent?.toFixed(1) ?? "",
        r.tiers.map((x) => `${x.discountPercent}%${x.thresholdAmount ? ` ab ${x.thresholdAmount}` : ""}`).join(" | "),
      ].join(";"),
    );
    const blob = new Blob([[head, ...body].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rabattuebersicht.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Percent className="h-7 w-7 text-primary" />
          <div>
            <h1 className="text-2xl font-semibold">{t("discounts.title")}</h1>
            <p className="text-muted-foreground">{t("discounts.description")}</p>
          </div>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={rows.length === 0}>
          <Download className="h-4 w-4 mr-2" />
          {t("discounts.exportCsv")}
        </Button>
      </div>

      {summary ? (
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {[
            { label: t("discounts.kpi.customers"), value: summary.matched.toLocaleString("de-DE") },
            { label: t("discounts.kpi.individual"), value: summary.withIndividualPrices.toLocaleString("de-DE") },
            { label: t("discounts.kpi.standard"), value: summary.withStandardDiscount.toLocaleString("de-DE") },
            { label: t("discounts.kpi.tiers"), value: summary.withTiers.toLocaleString("de-DE") },
            { label: t("discounts.kpi.median"), value: pct(summary.medianDiscount) },
            { label: t("discounts.kpi.max"), value: pct(summary.maxDiscount) },
          ].map((k) => (
            <div key={k.label} className="rounded-md border bg-muted/30 px-3 py-2">
              <p className="text-xs text-muted-foreground">{k.label}</p>
              <p className="text-lg font-semibold tabular-nums">{k.value}</p>
            </div>
          ))}
        </div>
      ) : null}

      {buckets.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("discounts.distribution")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {buckets.map((b) => (
              <div key={b.stufe} className="flex items-center gap-3 text-sm">
                <span className="w-14 text-right tabular-nums text-muted-foreground">{b.stufe} %</span>
                <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
                  <div className="h-full bg-primary/70" style={{ width: `${b.anteil * 100}%` }} />
                </div>
                <span className="w-16 tabular-nums">{b.n.toLocaleString("de-DE")}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("discounts.searchPlaceholder")}
              className="max-w-xs"
              data-testid="discount-search"
            />
            <Select value={only} onValueChange={setOnly}>
              <SelectTrigger className="w-[230px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="with-discount">{t("discounts.filter.withDiscount")}</SelectItem>
                <SelectItem value="individual">{t("discounts.filter.individual")}</SelectItem>
                <SelectItem value="tiers">{t("discounts.filter.tiers")}</SelectItem>
                <SelectItem value="all">{t("discounts.filter.all")}</SelectItem>
              </SelectContent>
            </Select>
            {summary ? (
              <span className="text-sm text-muted-foreground">
                {t("discounts.shown", { shown: rows.length, total: summary.matched })}
              </span>
            ) : null}
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">{t("common.loading")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t("discounts.col.customer")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.standard")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.individualCount")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.priceList")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.article")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.tier")}</TableHead>
                  <TableHead className="text-right">{t("discounts.col.total")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const offen = expanded.has(r.customerId);
                  return (
                    <>
                      <TableRow
                        key={r.customerId}
                        className={r.tiers.length > 0 ? "cursor-pointer hover-elevate" : ""}
                        onClick={() => r.tiers.length > 0 && toggle(r.customerId)}
                      >
                        <TableCell>
                          {r.tiers.length > 0 ? (
                            offen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{r.company || r.email || "—"}</div>
                          <div className="text-xs text-muted-foreground font-mono">
                            {r.customerNumber || "—"}
                            {r.groupName ? ` · ${r.groupName}` : ""}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(r.standardDiscountPercent)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.individualPriceCount > 0 ? r.individualPriceCount.toLocaleString("de-DE") : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{pct(r.priceListDiscountPercent)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {pct(r.articleDiscountPercent)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {r.maxTierPercent ? (
                            <Badge variant="warning">bis {pct(r.maxTierPercent)}</Badge>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="text-right tabular-nums font-semibold">
                          {pct(r.maxTotalDiscountPercent)}
                        </TableCell>
                      </TableRow>
                      {offen
                        ? r.tiers.map((tier, idx) => (
                            <TableRow key={`${r.customerId}-t${idx}`} className="bg-muted/30">
                              <TableCell />
                              <TableCell colSpan={5} className="text-sm">
                                {tier.label || t("discounts.tierFallback")}
                                {tier.allowStacking ? (
                                  <Badge variant="outline" className="ml-2 text-xs">
                                    {t("discounts.stackable")}
                                  </Badge>
                                ) : null}
                              </TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">
                                {t("discounts.fromAmount", { amount: eur(tier.thresholdAmount) })}
                              </TableCell>
                              <TableCell className="text-right tabular-nums">
                                {pct(tier.discountPercent)}
                              </TableCell>
                            </TableRow>
                          ))
                        : null}
                    </>
                  );
                })}
                {rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-muted-foreground text-center py-8">
                      {t("discounts.empty")}
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          )}
          {summary?.syncedAt ? (
            <p className="text-xs text-muted-foreground mt-4">
              {t("discounts.syncedAt", { date: new Date(summary.syncedAt).toLocaleString("de-DE") })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
