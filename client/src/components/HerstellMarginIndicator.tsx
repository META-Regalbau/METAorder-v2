import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

import { useLocaleFormat } from "@/hooks/useLocaleFormat";
export type HerstellMarginVerdict = "green" | "yellow" | "red" | "none";

type HerstellMarginIndicatorProps = {
  /** Marge auf Herstellkosten (Kostenbasis). */
  marginPercent: number | null;
  verdict: HerstellMarginVerdict;
  /** Wenn gesetzt: Umsatzmarge prominent, marginPercent klein darunter. */
  marginOnRevenuePercent?: number | null;
  /** "markup": Aufschlag auf Herstellkosten groß (Grundlage der Ampel), Umsatzmarge klein darunter. */
  emphasis?: "revenue" | "markup";
};

export function herstellMarginDotClass(verdict: HerstellMarginVerdict): string {
  switch (verdict) {
    case "green":
      return "bg-green-600";
    case "yellow":
      return "bg-warning";
    case "red":
      return "bg-destructive";
    default:
      return "bg-muted-foreground/40";
  }
}

/**
 * DB-Ampel. Ohne Recht „DB-Werte sehen“ liefert der Server keine Prozente; dann steht neben dem
 * Punkt nur die Bewertung als Text (nicht allein über die Farbe).
 */
export default function HerstellMarginIndicator({
  marginPercent,
  marginOnRevenuePercent,
  verdict,
  emphasis = "revenue",
}: HerstellMarginIndicatorProps) {
  const fmt = useLocaleFormat();
  const { t } = useTranslation();

  const dotClass = herstellMarginDotClass(verdict);

  const markupFirst = emphasis === "markup";
  const primaryPercent = markupFirst
    ? (marginPercent ?? marginOnRevenuePercent)
    : (marginOnRevenuePercent ?? marginPercent);
  const showSecondary = marginOnRevenuePercent != null && marginPercent != null;

  if (verdict === "none") {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
        <Badge variant="outline" className="text-muted-foreground font-normal">
          {t("crm.customer.individualPrices.herstellMarginNone")}
        </Badge>
      </span>
    );
  }

  if (primaryPercent == null) {
    return (
      <span
        className="inline-flex items-center gap-2 justify-end"
        data-testid={`margin-traffic-light-${verdict}`}
      >
        <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} aria-hidden="true" />
        <span className="text-sm whitespace-nowrap">{t(`marginTrafficLight.${verdict}`)}</span>
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col items-end gap-0.5">
      <span className="inline-flex items-center gap-2 justify-end">
        <span
          className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`}
          role="img"
          aria-label={t(`marginTrafficLight.${verdict}`)}
        />
        <span className="font-mono text-sm tabular-nums font-medium">
          {fmt.percentValue(primaryPercent)}
        </span>
      </span>
      {showSecondary ? (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {markupFirst
            ? `${t("profitabilityAnalysis.table.marginOnRevenueShort")} ${fmt.percentValue(marginOnRevenuePercent)}`
            : `${t("profitabilityAnalysis.table.marginOnCostShort")} ${fmt.percentValue(marginPercent)}`}
        </span>
      ) : null}
    </span>
  );
}
