import { AlertTriangle, Check, PackageX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StockStatus = "ok" | "short" | "out";

type Props = {
  status?: StockStatus | null;
  available?: number;
  need?: number;
  /** Kompakt für Tabellenzeilen */
  compact?: boolean;
  className?: string;
};

export function OrderItemStockHint({
  status,
  available = 0,
  need = 0,
  compact = false,
  className,
}: Props) {
  const { t } = useTranslation();
  if (!status) return null;

  if (status === "ok") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400",
          compact ? "text-xs" : "text-xs mt-0.5",
          className,
        )}
      >
        <Check className="h-3.5 w-3.5 shrink-0" />
        {t("erp.mobilePicking.stockOk", { available, need })}
      </span>
    );
  }
  if (status === "short") {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 text-amber-700 dark:text-amber-400",
          compact ? "text-xs" : "text-xs mt-0.5",
          className,
        )}
      >
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
        {t("erp.mobilePicking.stockShort", { available, need })}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-destructive",
        compact ? "text-xs" : "text-xs mt-0.5",
        className,
      )}
    >
      <PackageX className="h-3.5 w-3.5 shrink-0" />
      {t("erp.mobilePicking.stockOut", { need })}
    </span>
  );
}

export function OrderStockSummaryBadge({
  status,
  issueCount,
  lineCount,
  warehouseCode,
}: {
  status?: StockStatus | null;
  issueCount?: number;
  lineCount?: number;
  warehouseCode?: string;
}) {
  const { t } = useTranslation();
  if (!status || !lineCount) return null;

  if (status === "ok") {
    return (
      <Badge
        variant="secondary"
        className="gap-1 text-emerald-700 border-emerald-200 dark:text-emerald-300"
        title={warehouseCode ? `Lager: ${warehouseCode}` : undefined}
      >
        <Check className="h-3 w-3" />
        {t("erp.mobilePicking.stockAllOk")}
      </Badge>
    );
  }

  return (
    <Badge
      variant={status === "out" ? "destructive" : "outline"}
      className={
        status === "short"
          ? "gap-1 text-amber-700 border-amber-300 dark:text-amber-300"
          : "gap-1"
      }
      title={warehouseCode ? `Lager: ${warehouseCode}` : undefined}
    >
      <AlertTriangle className="h-3 w-3" />
      {t("erp.mobilePicking.stockIssues", { count: issueCount ?? 0 })}
    </Badge>
  );
}
