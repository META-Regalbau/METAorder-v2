import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ArrowRight, ChevronDown, ChevronRight, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { OfferProfitabilityLine, OfferProfitabilityResult } from "@shared/offerProfitability";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { downloadCsv } from "@/lib/csvDownload";
import { MISSING_HK_ROW_CLASS } from "@/lib/profitabilityStyles";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground mt-1">{hint}</p> : null}
    </div>
  );
}

function LineRow({ line }: { line: OfferProfitabilityLine }) {
  const fmt = useLocaleFormat();
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const muted = !line.countsForDb;
  const missingHk = line.countsForDb && line.herstellkostenTotal == null;

  return (
    <Fragment>
      <TableRow className={muted ? "text-muted-foreground" : missingHk ? MISSING_HK_ROW_CLASS : undefined}>
        <TableCell>
          <div className="flex items-start gap-1">
            {line.parts?.length ? (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-6 w-6 shrink-0"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label={t("offerProfitability.toggleParts", { label: line.label })}
              >
                {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </Button>
            ) : null}
            <div>
              <div>{line.label}</div>
              {line.productNumber ? (
                <div className="text-xs font-mono text-muted-foreground">{line.productNumber}</div>
              ) : null}
              <div className="flex flex-wrap gap-1 mt-1">
                {line.isConfiguration ? (
                  <Badge variant="outline" className="font-normal whitespace-normal">
                    {t("offerProfitability.configuration", {
                      withData: line.partsWithHerstellpreis ?? 0,
                      total: line.parts?.length ?? 0,
                    })}
                  </Badge>
                ) : null}
                {line.optional ? (
                  <Badge variant="outline" className="font-normal whitespace-normal">{t("offerProfitability.optional")}</Badge>
                ) : null}
                {line.type === "discount" || line.type === "promotion" ? (
                  <Badge variant="outline" className="font-normal whitespace-normal">{t("offerProfitability.discount")}</Badge>
                ) : null}
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell className="text-right tabular-nums whitespace-nowrap">{fmt.number(line.quantity)}</TableCell>
        <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
          <div>{fmt.currency(line.totalNet)}</div>
          {line.unitPriceNet != null ? (
            <div className="text-xs text-muted-foreground">
              {t("orderProfitabilityAnalysis.lookup.table.perUnit", { amount: fmt.currency(line.unitPriceNet) })}
            </div>
          ) : null}
        </TableCell>
        <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
          {line.herstellkostenTotal != null && line.herstellpreisNet != null ? (
            <>
              <div>{fmt.currency(line.herstellkostenTotal)}</div>
              <div className="text-xs text-muted-foreground">
                {t("orderProfitabilityAnalysis.lookup.table.perUnit", { amount: fmt.currency(line.herstellpreisNet) })}
              </div>
            </>
          ) : missingHk ? (
            t("offerProfitability.partMissingHk")
          ) : (
            "—"
          )}
        </TableCell>
        <TableCell
          className={`text-right font-mono tabular-nums whitespace-nowrap ${
            line.db1Abs != null && line.db1Abs < 0 ? "text-destructive" : ""
          }`}
        >
          {line.db1Abs != null ? (
            <>
              <div>{fmt.currency(line.db1Abs)}</div>
              <div className="mt-1 font-sans">
                <HerstellMarginIndicator
                  marginPercent={line.marginPercent}
                  marginOnRevenuePercent={line.marginOnRevenuePercent}
                  verdict={line.crmVerdict}
                />
              </div>
            </>
          ) : (
            "—"
          )}
        </TableCell>
      </TableRow>
      {open && line.parts
        ? line.parts.map((part, idx) => (
            <TableRow
              key={`${line.id}-part-${idx}`}
              className={`text-xs ${part.herstellpreisNet == null ? MISSING_HK_ROW_CLASS : "bg-muted/30"}`}
            >
              <TableCell className="pl-10">
                <div>{part.label}</div>
                {part.productNumber ? (
                  <div className="font-mono text-muted-foreground">{part.productNumber}</div>
                ) : null}
              </TableCell>
              <TableCell className="text-right tabular-nums whitespace-nowrap">{fmt.number(part.quantity)}</TableCell>
              <TableCell />
              <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                {part.herstellkostenTotal != null && part.herstellpreisNet != null ? (
                  <>
                    <div>{fmt.currency(part.herstellkostenTotal)}</div>
                    <div className="text-muted-foreground">
                      {t("orderProfitabilityAnalysis.lookup.table.perUnit", {
                        amount: fmt.currency(part.herstellpreisNet),
                      })}
                    </div>
                  </>
                ) : (
                  t("offerProfitability.partMissingHk")
                )}
              </TableCell>
              <TableCell />
            </TableRow>
          ))
        : null}
    </Fragment>
  );
}

export default function OfferProfitabilityResultView({
  offer,
  crmThreshold,
}: {
  offer: OfferProfitabilityResult;
  crmThreshold: number;
}) {
  const fmt = useLocaleFormat();
  const { t } = useTranslation();
  const p = offer.profitability;
  const missingHk = p.productLineCount - p.linesWithHerstellpreis;

  const exportCsv = () => {
    const header = [
      t("orderProfitabilityAnalysis.lookup.table.productNumber"),
      t("orderProfitabilityAnalysis.lookup.table.name"),
      t("offerProfitability.csv.type"),
      t("orderProfitabilityAnalysis.lookup.table.quantity"),
      t("orderProfitabilityAnalysis.lookup.table.netPrice"),
      t("orderProfitabilityAnalysis.lookup.table.netTotal"),
      t("orderProfitabilityAnalysis.lookup.table.hkUnit"),
      t("orderProfitabilityAnalysis.lookup.table.hkTotal"),
      t("orderProfitabilityAnalysis.lookup.table.db1"),
      t("orderProfitabilityAnalysis.lookup.table.marginOnCost"),
      t("orderProfitabilityAnalysis.lookup.table.marginOnRevenue"),
    ];
    const rows: unknown[][] = [];
    for (const line of offer.lines) {
      rows.push([
        line.productNumber ?? "",
        line.label,
        line.optional ? `${line.type} (${t("offerProfitability.optional")})` : line.type,
        line.quantity,
        line.unitPriceNet ?? "",
        line.totalNet,
        line.herstellpreisNet ?? "",
        line.herstellkostenTotal ?? "",
        line.db1Abs ?? "",
        line.marginPercent ?? "",
        line.marginOnRevenuePercent ?? "",
      ]);
      for (const part of line.parts ?? []) {
        rows.push([
          part.productNumber ?? "",
          `  ${part.label}`,
          t("offerProfitability.csv.part"),
          part.quantity,
          "",
          "",
          part.herstellpreisNet ?? "",
          part.herstellkostenTotal ?? "",
          "",
          "",
          "",
        ]);
      }
    }
    downloadCsv(`db-berechnung-angebot-${offer.offerNumber}.csv`, header, rows);
  };

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-lg font-semibold">
            {t("offerProfitability.heading", { offerNumber: offer.offerNumber })}
          </p>
          <p className="text-sm text-muted-foreground">
            {[
              offer.customerName,
              offer.createdAt ? fmt.date(offer.createdAt) : null,
              offer.statusLabel ?? t(`offers.status.${offer.status}`, { defaultValue: offer.status }),
              offer.salesChannelName,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          {offer.taxStatus === "gross" ? (
            <p className="text-xs text-muted-foreground mt-1">{t("offerProfitability.grossHint")}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={offer.lines.length === 0}>
            <Download className="h-4 w-4 mr-2" />
            {t("orderProfitabilityAnalysis.exportCsv")}
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/offers?search=${encodeURIComponent(offer.offerNumber)}`}>
              {t("offerProfitability.openOffer")}
              <ArrowRight className="h-4 w-4 ml-2" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Kpi
          label={t("offerProfitability.kpi.netTotal")}
          value={fmt.currency(offer.netTotal)}
          hint={t("offerProfitability.kpi.netTotalHint")}
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.revenueWithHk")}
          value={p.revenueWithHk != null ? fmt.currency(p.revenueWithHk) : "—"}
          hint={t("orderProfitabilityAnalysis.lookup.kpi.coverageHint", {
            withData: p.linesWithHerstellpreis,
            total: p.productLineCount,
          })}
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.herstellkosten")}
          value={p.herstellkostenTotal != null ? fmt.currency(p.herstellkostenTotal) : "—"}
        />
        <Kpi
          label={t("orderProfitabilityAnalysis.lookup.kpi.db1")}
          value={p.db1Total != null ? fmt.currency(p.db1Total) : "—"}
          hint={
            p.discountShareWithHk && p.db1BeforeDiscount != null
              ? t("offerProfitability.kpi.db1DiscountHint", {
                  before: fmt.currency(p.db1BeforeDiscount),
                  discount: fmt.currency(p.discountShareWithHk),
                })
              : undefined
          }
        />
        <div>
          <p className="text-sm text-muted-foreground">
            {t("orderProfitabilityAnalysis.lookup.kpi.margin", { threshold: crmThreshold })}
          </p>
          <div className="mt-1">
            <HerstellMarginIndicator
              marginPercent={p.marginPercent}
              marginOnRevenuePercent={p.marginOnRevenuePercent}
              verdict={p.crmVerdict}
            />
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
            {offer.lines.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
          </TableBody>
          {p.db1BeforeDiscount != null && p.herstellkostenTotal != null ? (
            <TableFooter>
              <TableRow>
                <TableCell colSpan={2}>{t("orderProfitabilityAnalysis.lookup.table.sumWithHk")}</TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  {fmt.currency(p.herstellkostenTotal + p.db1BeforeDiscount)}
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                  {fmt.currency(p.herstellkostenTotal)}
                </TableCell>
                <TableCell
                  className={`text-right font-mono tabular-nums whitespace-nowrap ${
                    p.db1BeforeDiscount < 0 ? "text-destructive" : ""
                  }`}
                >
                  {fmt.currency(p.db1BeforeDiscount)}
                </TableCell>
              </TableRow>
              {p.discountShareWithHk ? (
                <TableRow>
                  <TableCell colSpan={2}>{t("offerProfitability.table.discountShare")}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                    {fmt.currency(p.discountShareWithHk)}
                  </TableCell>
                  <TableCell />
                  <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                    {fmt.currency(p.discountShareWithHk)}
                  </TableCell>
                </TableRow>
              ) : null}
              {p.discountShareWithHk && p.db1Total != null ? (
                <TableRow>
                  <TableCell colSpan={2}>{t("offerProfitability.table.afterDiscount")}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                    {p.revenueWithHk != null ? fmt.currency(p.revenueWithHk) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono tabular-nums whitespace-nowrap">
                    {fmt.currency(p.herstellkostenTotal)}
                  </TableCell>
                  <TableCell
                    className={`text-right font-mono tabular-nums whitespace-nowrap ${
                      p.db1Total < 0 ? "text-destructive" : ""
                    }`}
                  >
                    {fmt.currency(p.db1Total)}
                  </TableCell>
                </TableRow>
              ) : null}
            </TableFooter>
          ) : null}
        </Table>
      </div>

      {missingHk > 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("offerProfitability.missingHkHint", { count: missingHk })}
        </p>
      ) : null}
      {p.discountTotal !== 0 ? (
        <p className="text-xs text-muted-foreground">
          {t("offerProfitability.discountHint", { amount: fmt.currency(p.discountTotal) })}
        </p>
      ) : null}
    </div>
  );
}
