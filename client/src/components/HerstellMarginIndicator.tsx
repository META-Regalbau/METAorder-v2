import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

export type HerstellMarginVerdict = "green" | "red" | "none";

type HerstellMarginIndicatorProps = {
  /** Marge auf Herstellkosten (Kostenbasis). */
  marginPercent: number | null;
  verdict: HerstellMarginVerdict;
  /** Wenn gesetzt: Umsatzmarge prominent, marginPercent klein darunter. */
  marginOnRevenuePercent?: number | null;
};

export default function HerstellMarginIndicator({
  marginPercent,
  marginOnRevenuePercent,
  verdict,
}: HerstellMarginIndicatorProps) {
  const { t } = useTranslation();

  const dotClass =
    verdict === "green"
      ? "bg-green-600"
      : verdict === "red"
        ? "bg-destructive"
        : "bg-muted-foreground/40";

  const primaryPercent = marginOnRevenuePercent ?? marginPercent;
  const showCostBelow =
    marginOnRevenuePercent != null && marginPercent != null;

  if (verdict === "none") {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} />
        <Badge variant="outline" className="text-muted-foreground font-normal">
          {t("crm.customer.individualPrices.herstellMarginNone")}
        </Badge>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-2 justify-end">
        <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} />
        <span className="font-mono text-sm tabular-nums font-medium">
          {primaryPercent != null ? `${primaryPercent.toLocaleString("de-DE")} %` : "—"}
        </span>
      </span>
      {showCostBelow ? (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {t("profitabilityAnalysis.table.marginOnCostShort")}{" "}
          {marginPercent.toLocaleString("de-DE")} %
        </span>
      ) : null}
    </span>
  );
}
