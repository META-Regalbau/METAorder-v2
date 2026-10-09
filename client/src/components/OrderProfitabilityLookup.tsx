import { useEffect, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation, useSearch } from "wouter";
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
import { downloadCsv } from "@/lib/csvDownload";
import { MISSING_HK_ROW_CLASS } from "@/lib/profitabilityStyles";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import OfferProfitabilityResultView from "@/components/OfferProfitabilityResult";
import type { OfferProfitabilityResult } from "@shared/offerProfitability";

type OrderLookupResponse = {
  orderNumber: string;
  orders: Order[];
  profitabilityMinMarginPercent?: number;
};

type OfferLookupResponse = {
  offerNumber: string;
  offers: OfferProfitabilityResult[];
  profitabilityMinMarginPercent?: number;
};

type LookupMode = "order" | "offer";

const MODE_PARAM: Record<LookupMode, string> = { order: "orderNumber", offer: "offerNumber" };

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw apiErrorFromBody(res.status, body);
  }
  return res.json();
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
    downloadCsv(
      `db-berechnung-${order.orderNumber}.csv`,
      header,
      order.items.map((item) => [
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
      ]),
    );
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
        <Table className="text-sm [&_td]:px-2 [&_th]:px-2">
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[150px]">{t("orderProfitabilityAnalysis.lookup.table.name")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.quantity")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.netTotal")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.hkTotal")}</TableHead>
              <TableHead className="text-right">{t("orderProfitabilityAnalysis.lookup.table.db1AndMargin")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {order.items.map((item) => (
              <TableRow
                key={item.id}
                className={
                  (item.productId || item.productNumber) && item.herstellpreisNet == null
                    ? MISSING_HK_ROW_CLASS
                    : undefined
                }
              >
                <TableCell>
                  <div>{item.name}</div>
                  {item.productNumber ? (
                    <div className="text-xs font-mono text-muted-foreground">{item.productNumber}</div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular-nums whitespace-nowrap">{fmt.number(item.quantity)}</TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  <div>{fmt.currency(item.netTotal)}</div>
                  <div className="text-xs text-muted-foreground">
                    {t("orderProfitabilityAnalysis.lookup.table.perUnit", { amount: fmt.currency(item.netPrice) })}
                  </div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  {item.herstellkostenTotal != null && item.herstellpreisNet != null ? (
                    <>
                      <div>{fmt.currency(item.herstellkostenTotal)}</div>
                      <div className="text-xs text-muted-foreground">
                        {t("orderProfitabilityAnalysis.lookup.table.perUnit", {
                          amount: fmt.currency(item.herstellpreisNet),
                        })}
                      </div>
                    </>
                  ) : (
                    (item.productId || item.productNumber) ? (
                    t("offerProfitability.partMissingHk")
                  ) : (
                    "—"
                  )
                  )}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums whitespace-nowrap ${
                    item.db1Abs != null && item.db1Abs < 0 ? "text-destructive" : ""
                  }`}
                >
                  {item.db1Abs != null ? (
                    <>
                      <div>{fmt.currency(item.db1Abs)}</div>
                      <div className="mt-1 font-sans">
                        <HerstellMarginIndicator
                          marginPercent={item.marginPercent ?? null}
                          marginOnRevenuePercent={item.marginOnRevenuePercent ?? null}
                          verdict={item.crmVerdict ?? "none"}
                        />
                      </div>
                    </>
                  ) : (
                    "—"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
          {p?.db1Total != null ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{t("orderProfitabilityAnalysis.lookup.table.sumWithHk")}</TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  {revenueWithHk != null ? fmt.currency(revenueWithHk) : "—"}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  {p.herstellkostenTotal != null ? fmt.currency(p.herstellkostenTotal) : "—"}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums whitespace-nowrap ${p.db1Total < 0 ? "text-destructive" : ""}`}
                >
                  {fmt.currency(p.db1Total)}
                </TableCell>
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

/**
 * DB-Berechnung fuer genau eine Bestellung oder ein Angebot (Bestell-DB-Analyse,
 * auch per ?orderNumber=... bzw. ?offerNumber=...).
 */
export default function OrderProfitabilityLookup() {
  const { t } = useTranslation();
  const searchString = useSearch();
  const [location, navigate] = useLocation();
  const [mode, setMode] = useState<LookupMode>("order");
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<{ mode: LookupMode; number: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(searchString);
    for (const m of ["order", "offer"] as const) {
      const fromUrl = params.get(MODE_PARAM[m])?.trim();
      if (fromUrl) {
        setMode(m);
        setInput(fromUrl);
        setSubmitted({ mode: m, number: fromUrl });
        return;
      }
    }
  }, [searchString]);

  const orderQuery = useQuery<OrderLookupResponse>({
    queryKey: ["/api/orders/profitability-by-number", submitted?.number],
    enabled: submitted?.mode === "order",
    queryFn: () =>
      fetchJson(`/api/orders/profitability-by-number?orderNumber=${encodeURIComponent(submitted!.number)}`),
  });
  const offerQuery = useQuery<OfferLookupResponse>({
    queryKey: ["/api/offers/profitability-by-number", submitted?.number],
    enabled: submitted?.mode === "offer",
    queryFn: () =>
      fetchJson(`/api/offers/profitability-by-number?offerNumber=${encodeURIComponent(submitted!.number)}`),
  });
  const active = submitted?.mode === "offer" ? offerQuery : orderQuery;

  // Nummer in der Adresse mitfuehren, damit der Link geteilt werden kann
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = input.trim();
    setSubmitted({ mode, number: value });
    navigate(`${location}?${MODE_PARAM[mode]}=${encodeURIComponent(value)}`, { replace: true });
  };

  const reset = () => {
    setInput("");
    setSubmitted(null);
    navigate(location, { replace: true });
  };

  const changeMode = (value: string) => {
    setMode(value as LookupMode);
    if (submitted) reset();
  };

  const results =
    submitted?.mode === "offer" ? (offerQuery.data?.offers.length ?? 0) : (orderQuery.data?.orders.length ?? 0);
  const crmThreshold = active.data?.profitabilityMinMarginPercent ?? 20;
  const textKey = mode === "offer" ? "orderProfitabilityAnalysis.lookup.offer" : "orderProfitabilityAnalysis.lookup";

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
        <Tabs value={mode} onValueChange={changeMode}>
          <TabsList>
            <TabsTrigger value="order">{t("orderProfitabilityAnalysis.lookup.modeOrder")}</TabsTrigger>
            <TabsTrigger value="offer">{t("orderProfitabilityAnalysis.lookup.modeOffer")}</TabsTrigger>
          </TabsList>
        </Tabs>
        <form onSubmit={submit} className="flex flex-wrap gap-2 items-end">
          <div className="space-y-1">
            <Label htmlFor="db-lookup-number">{t(`${textKey}.label`)}</Label>
            <Input
              id="db-lookup-number"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t(`${textKey}.placeholder`)}
              className="w-56 font-mono"
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={input.trim() === "" || active.isFetching}>
            <Search className="h-4 w-4 mr-2" />
            {t("orderProfitabilityAnalysis.lookup.submit")}
          </Button>
          {submitted ? (
            <Button type="button" variant="ghost" onClick={reset}>
              <X className="h-4 w-4 mr-2" />
              {t("orderProfitabilityAnalysis.lookup.reset")}
            </Button>
          ) : null}
        </form>

        {!submitted ? null : active.isFetching && !active.data ? (
          <p className="text-muted-foreground">{t(`${textKey}.loading`)}</p>
        ) : active.isError ? (
          <p className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            {active.error instanceof Error ? active.error.message : t("orderProfitabilityAnalysis.errorTitle")}
          </p>
        ) : active.data && results === 0 ? (
          <p className="text-muted-foreground">{t(`${textKey}.notFound`, { number: submitted.number })}</p>
        ) : active.data ? (
          <div className="space-y-4">
            {results > 1 ? (
              <p className="text-sm text-amber-700 dark:text-amber-500">
                {t(`${textKey}.multipleHits`, { count: results })}
              </p>
            ) : null}
            {submitted.mode === "offer"
              ? offerQuery.data?.offers.map((offer) => (
                  <OfferProfitabilityResultView key={offer.id} offer={offer} crmThreshold={crmThreshold} />
                ))
              : orderQuery.data?.orders.map((order) => (
                  <SingleOrderResult key={order.id} order={order} crmThreshold={crmThreshold} />
                ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
