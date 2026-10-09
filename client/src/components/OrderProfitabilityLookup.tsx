import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { AlertCircle, ArrowRight, Calculator, Download, Search, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import HerstellMarginIndicator from "@/components/HerstellMarginIndicator";
import type { Order } from "@shared/schema";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiErrorFromBody } from "@/lib/apiError";

type LookupResponse = {
  orderNumber: string;
  orders: Order[];
  profitabilityMinMarginPercent?: number;
};

function escapeCsv(value: unknown): string {
  const s = String(value ?? "");
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

function SingleOrderResult({ order, crmThreshold }: { order: Order; crmThreshold: number }) {
  const fmt = useLocaleFormat();
  const { t } = useTranslation();
  const p = order.profitability;
  const revenueWithHk =
    p?.herstellkostenTotal != null && p.db1Total != null ? p.herstellkostenTotal + p.db1Total : null;

  const exportCsv = () => {
    const header = [
      t("orderProfitabilityAnalysis.lookup.table.productNumber"),
      t("orderProfitabilityAnalysis.lookup.table.name"),
      t("orderProfitabilityAnalysis.lookup.table.quantity"),
      t("orderProfitabilityAnalysis.lookup.table.netPrice"),
      t("orderProfitabilityAnalysis.lookup.table.netTotal"),
      t("orderProfitabilityAnalysis.lookup.table.hkUnit"),
      t("orderProfitabilityAnalysis.lookup.table.hkTotal"),
      t("orderProfitabilityAnalysis.lookup.table.db1"),
      t("orderProfitabilityAnalysis.lookup.table.marginOnCost"),
      t("orderProfitabilityAnalysis.lookup.table.marginOnRevenue"),
    ];
    const lines = [header.map(escapeCsv).join(",")];
    for (const item of order.items) {
      lines.push(
        [
          item.productNumber ?? "",
          item.name,
          item.quantity,
          item.netPrice,
          item.netTotal,
          item.herstellpreisNet ?? "",
          item.herstellkostenTotal ?? "",
          item.db1Abs ?? "",
          item.marginPercent ?? "",
          item.marginOnRevenuePercent ?? "",
        ]
          .map(escapeCsv)
          .join(","),
      );
    }
    const csv = "﻿" + lines.join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `db-berechnung-${order.orderNumber}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-lg font-semibold font-mono">{order.orderNumber}</p>
          <p className="text-sm text-muted-foreground">
            {[
              order.customerName,
              fmt.date(order.orderDate),
              t(`status.${order.status}`),
              order.salesChannelName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={order.items.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {t("orderProfitabilityAnalysis.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/orders?search=${encodeURIComponent(order.orderNumber)}`}>
              {t("orderProfitabilityAnalysis.lookup.openOrder")}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.netTotal")}
          value={fmt.currency(order.netTotalAmount)}
          hint={t("orderProfitabilityAnalysis.lookup.kpi.netTotalHint")}
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.revenueWithHk")}
          value={revenueWithHk != null ? fmt.currency(revenueWithHk) : "—"}
          hint={
            p
              ? t("orderProfitabilityAnalysis.lookup.kpi.coverageHint", {
                  withData: p.linesWithHerstellpreis,
                  total: p.productLineCount,
                })
              : undefined
          }
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.herstellkosten")}
          value={p?.herstellkostenTotal != null ? fmt.currency(p.herstellkostenTotal) : "—"}
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.db1")}
          value={p?.db1Total != null ? fmt.currency(p.db1Total) : "—"}
        />
        <div>
          <p className="text-sm text-muted-foreground">
            {t("orderProfitabilityAnalysis.lookup.kpi.margin", { threshold: crmThreshold })}
          </p>
          <div className="mt-1">
            {p ? (
              <HerstellMarginIndicator
                marginPercent={p.marginPercent}
                marginOnRevenuePercent={p.marginOnRevenuePercent}
                verdict={p.crmVerdict}
              />
            ) : (
              "—"
            )}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto" tabIndex={0}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("orderProfitabilityAnalysis.lookup.table.productNumber")}</TableHead>
              <TableHead>{t("orderProfitabilityAnalysis.lookup.table.name")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.quantity")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.netPrice")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.netTotal")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.hkUnit")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.hkTotal")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.db1")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.marginOnCost")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono">{item.productNumber ?? "—"}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-right tabular-nums">{fmt.number(item.quantity)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{fmt.currency(item.netPrice)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">{fmt.currency(item.netTotal)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {item.herstellpreisNet != null ? fmt.currency(item.herstellpreisNet) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {item.herstellkostenTotal != null ? fmt.currency(item.herstellkostenTotal) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${
                    item.db1Abs != null && item.db1Abs < 0 ? "text-destructive" : ""
                  }`}
                >
                  {item.db1Abs != null ? fmt.currency(item.db1Abs) : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <HerstellMarginIndicator
                    marginPercent={item.marginPercent ?? null}
                    marginOnRevenuePercent={item.marginOnRevenuePercent ?? null}
                    verdict={item.crmVerdict ?? "none"}
                  />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {p?.db1Total != null ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={4}>{t("orderProfitabilityAnalysis.lookup.table.sumWithHk")}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">
                  {revenueWithHk != null ? fmt.currency(revenueWithHk) : "—"}
                </TableCell>
                <TableCell />
                <TableCell className="text-right font-mono tabular-nums">
                  {p.herstellkostenTotal != null ? fmt.currency(p.herstellkostenTotal) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums ${p.db1Total < 0 ? "text-destructive" : ""}`}
                >
                  {fmt.currency(p.db1Total)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </div>

      {p && p.linesWithHerstellpreis < p.productLineCount ? (
        <p className="text-xs text-muted-foreground">
          {t("orderProfitabilityAnalysis.lookup.missingHkHint", {
            count: p.productLineCount - p.linesWithHerstellpreis,
          })}
        </p>
      ) : null}
    </div>
  );
}

/** DB-Berechnung fuer genau eine Bestellnummer (Bestell-DB-Analyse, auch per ?orderNumber=...). */
export default function OrderProfitabilityLookup() {
  const { t } = useTranslation();
  const searchString = useSearch();
  const [input, setInput] = useState("");
  const [orderNumber, setOrderNumber] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(searchString).get("orderNumber")?.trim();
    if (fromUrl) {
      setInput(fromUrl);
      setOrderNumber(fromUrl);
    }
  }, [searchString]);

  const { data, isFetching, isError, error } = useQuery<LookupResponse>({
    queryKey: ["/api/orders/profitability-by-number", orderNumber],
    enabled: orderNumber !== "",
    queryFn: async () => {
      const res = await fetch(
        `/api/orders/profitability-by-number?orderNumber=${encodeURIComponent(orderNumber)}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw apiErrorFromBody(res.status, body);
      }
      return res.json();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setOrderNumber(input.trim());
  };

  const reset = () => {
    setInput("");
    setOrderNumber("");
  };

  const crmThreshold = data?.profitabilityMinMarginPercent ?? 20;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Calculator className="h-4 w-4" />
          {t("orderProfitabilityAnalysis.lookup.title")}
        </CardTitle>
        <CardDescription>{t("orderProfitabilityAnalysis.lookup.description")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="db-lookup-order-number">{t("orderProfitabilityAnalysis.lookup.label")}</Label>
            <Input
              id="db-lookup-order-number"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("orderProfitabilityAnalysis.lookup.placeholder")}
              className="w-56 font-mono"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={input.trim() === "" || isFetching}>
            <Search className="h-4 w-4 mr-2" />
            {t("orderProfitabilityAnalysis.lookup.submit")}
          </Button>
          {orderNumber ? (
            <Button type="button" variant="ghost" onClick={reset}>
              <X className="h-4 w-4 mr-2" />
              {t("orderProfitabilityAnalysis.lookup.reset")}
            </Button>
          ) : null}
        </form>

        {orderNumber === "" ? null : isFetching && !data ? (
          <p className="text-muted-foreground">{t("orderProfitabilityAnalysis.lookup.loading")}</p>
        ) : isError ? (
          <p className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            {error instanceof Error ? error.message : t("orderProfitabilityAnalysis.errorTitle")}
          </p>
        ) : data && data.orders.length === 0 ? (
          <p className="text-muted-foreground">
            {t("orderProfitabilityAnalysis.lookup.notFound", { orderNumber: data.orderNumber })}
          </p>
        ) : data ? (
          <div className="space-y-4">
            {data.orders.length > 1 ? (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                {t("orderProfitabilityAnalysis.lookup.multipleHits", { count: data.orders.length })}
              </p>
            ) : null}
            {data.orders.map((order) => (
              <SingleOrderResult key={order.id} order={order} crmThreshold={crmThreshold} />
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
