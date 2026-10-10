import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Calculator, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import HerstellMarginIndicator, { herstellMarginDotClass } from "@/components/HerstellMarginIndicator";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type {
  DraftProfitability,
  DraftProfitabilityBadge,
  DraftProfitabilityLine,
} from "@shared/draftProfitability";

/**
 * DB der Bestell-/Angebotsentwürfe. Der Server rechnet und lässt ohne Recht „DB-Werte sehen“
 * alle Beträge weg (detailsHidden) — dann zeigt die Oberfläche nur die Ampel.
 * Der Aufschlag auf Herstellkosten steht groß, weil die Ampel daran hängt.
 */
export function useDraftProfitability(kind: "order" | "offer", draftId: string | undefined, enabled = true) {
  return useQuery<{ profitability: DraftProfitability | null }>({
    // Präfix "/api/<kind>-drafts": jede Entwurfs-Mutation (invalidateQueries) rechnet neu
    queryKey: [`/api/${kind}-drafts`, draftId, "profitability"],
    enabled: enabled && Boolean(draftId),
    retry: false,
  });
}

export function DraftProfitabilityCard({
  profitability,
  isLoading,
  isError,
}: {
  profitability: DraftProfitability | null | undefined;
  isLoading: boolean;
  isError: boolean;
}) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const summary = profitability?.summary;
  const hidden = profitability?.detailsHidden === true;

  return (
    <Card data-testid="card-draft-profitability">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="w-4 h-4" />
          {t("draftProfitability.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {isLoading ? (
          <p className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("draftProfitability.loading")}
          </p>
        ) : isError || !profitability || !summary ? (
          <p className="text-muted-foreground">{t("draftProfitability.error")}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              {summary.crmVerdict === "none" ? (
                <HerstellMarginIndicator marginPercent={null} verdict="none" />
              ) : (
                <span className="inline-flex items-center gap-2" data-testid={`draft-db-verdict-${summary.crmVerdict}`}>
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full shrink-0 ${herstellMarginDotClass(summary.crmVerdict)}`}
                    aria-hidden="true"
                  />
                  <span className="font-medium">{t(`marginTrafficLight.${summary.crmVerdict}`)}</span>
                </span>
              )}
              {!hidden && summary.marginPercent != null ? (
                <span className="text-right">
                  <span className="block text-xs text-muted-foreground">{t("draftProfitability.markup")}</span>
                  <span className="text-2xl font-semibold font-mono tabular-nums" data-testid="text-draft-db-markup">
                    {fmt.percentValue(summary.marginPercent)}
                  </span>
                </span>
              ) : null}
            </div>
            {!hidden && summary.db1Total != null ? (
              <dl className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.db1")}</dt>
                  <dd className="font-mono tabular-nums" data-testid="text-draft-db1">{fmt.currency(summary.db1Total)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.herstellkosten")}</dt>
                  <dd className="font-mono tabular-nums">{fmt.currency(summary.herstellkostenTotal)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">{t("draftProfitability.marginOnRevenue")}</dt>
                  <dd className="font-mono tabular-nums">{fmt.percentValue(summary.marginOnRevenuePercent)}</dd>
                </div>
              </dl>
            ) : null}
            <p className="text-xs text-muted-foreground">
              {t("draftProfitability.coverage", {
                withData: summary.linesWithHerstellpreis,
                total: summary.productLineCount,
              })}
              {profitability.unpricedLineCount > 0
                ? ` · ${t("draftProfitability.unpriced", { count: profitability.unpricedLineCount })}`
                : ""}
            </p>
            <p className="text-xs text-muted-foreground">
              {t("draftProfitability.thresholds", {
                warn: fmt.number(profitability.thresholds.warnMarginPercent),
                min: fmt.number(profitability.thresholds.minMarginPercent),
              })}
            </p>
            <p className="text-xs text-muted-foreground">
              {profitability.frozen
                ? t("draftProfitability.frozen", { date: fmt.dateTime(profitability.computedAt) })
                : t("draftProfitability.computedAt", { date: fmt.dateTime(profitability.computedAt) })}
            </p>
            {hidden ? (
              <p className="text-xs text-muted-foreground">{t("draftProfitability.hiddenHint")}</p>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}

/** DB-Zelle je Entwurfsposition. */
export function DraftLineMargin({ line }: { line: DraftProfitabilityLine | undefined }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  if (!line) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <div className="flex flex-col items-end gap-0.5" data-testid={`draft-line-db-${line.index}`}>
      <HerstellMarginIndicator
        marginPercent={line.marginPercent}
        marginOnRevenuePercent={line.marginOnRevenuePercent}
        verdict={line.crmVerdict}
        emphasis="markup"
      />
      {line.db1Abs != null ? (
        <span className="text-xs text-muted-foreground font-mono tabular-nums">
          {t("draftProfitability.db1Short")} {fmt.currency(line.db1Abs)}
        </span>
      ) : null}
      <span className="text-xs text-muted-foreground">{t(`draftProfitability.priceSource.${line.priceSource}`)}</span>
    </div>
  );
}

/** Ampel in Entwurfslisten (Beträge nur, wenn der Server sie mitschickt). */
export function DraftProfitabilityBadgeCell({ badge }: { badge: DraftProfitabilityBadge | null | undefined }) {
  if (!badge) return <span className="text-sm text-muted-foreground">—</span>;
  return (
    <HerstellMarginIndicator marginPercent={badge.marginPercent} verdict={badge.crmVerdict} emphasis="markup" />
  );
}
