import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";

export type HerstellMarginVerdict = "green" | "red" | "none";

type HerstellMarginIndicatorProps = {
  marginPercent: number | null;
  verdict: HerstellMarginVerdict;
};

export default function HerstellMarginIndicator({
  marginPercent,
  verdict,
}: HerstellMarginIndicatorProps) {
  const { t } = useTranslation();

  const dotClass =
    verdict === "green"
      ? "bg-green-600"
      : verdict === "red"
        ? "bg-destructive"
        : "bg-muted-foreground/40";

  if (verdict === "none") {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} />
        <Badge variant="outline" className="text-muted-foreground font-normal">
          {t("priceCheck.verdict.none")}
        </Badge>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2 justify-end">
      <span className={`inline-block h-3 w-3 rounded-full shrink-0 ${dotClass}`} />
      <span className="font-mono text-sm tabular-nums">
        {marginPercent != null ? `${marginPercent.toLocaleString("de-DE")} %` : "—"}
      </span>
    </span>
  );
}
