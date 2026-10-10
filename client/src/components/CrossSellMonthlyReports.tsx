// Berichte der Cross-Selling-Monatspruefung (je Lauf: Zahlen und aufklappbare Befunde).
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { CrossSellRun } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type Finding = { pairId: string; source: string; sourceName: string | null; target: string; targetName: string | null; groups: string[]; detail?: string };
type Report = {
  month: string;
  pairsChecked: number;
  proposals: number;
  counts: Record<string, number>;
  findings: Record<string, Finding[]>;
  shop?: { productListGroups: number; pairsLive: number; pairsRemovedExternally: number };
  llm?: { checked: number; calls: number; skippedBudget: number };
  notified?: { users: number; email: string };
};

const REASON_ORDER = ["target_missing", "target_inactive", "target_hidden", "llm_no_fit", "ineffective", "source_inactive", "stale", "positive"];

export default function CrossSellMonthlyReports() {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const [open, setOpen] = useState<string | null>(null);
  const { data } = useQuery<{ runs: CrossSellRun[] }>({
    queryKey: ["/api/cross-selling/runs", "monthly_review"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/runs?kind=monthly_review&limit=12")).json(),
  });
  const runs = data?.runs ?? [];

  return (
    <Card className="p-6 space-y-3" data-testid="card-cross-sell-monthly-reports">
      <h2 className="text-lg font-semibold">{t("crossSellMonthly.title")}</h2>
      {runs.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("crossSellMonthly.empty")}</p>
      ) : (
        <div className="divide-y">
          {runs.map((run) => {
            const report = run.report as unknown as Report | null;
            const expanded = open === run.id;
            return (
              <div key={run.id} className="py-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button variant="ghost" size="sm" className="px-0" onClick={() => setOpen(expanded ? null : run.id)} disabled={!report}>
                    {expanded ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
                    {fmt.dateTime(String(run.startedAt))}
                    {report?.month ? ` · ${report.month}` : ""}
                  </Button>
                  <div className="text-xs text-muted-foreground">
                    {run.status === "failed"
                      ? t("crossSellLog.runFailed", { error: run.error ?? "" })
                      : run.status === "running"
                        ? t("crossSellLog.runRunning")
                        : report
                          ? t("crossSellMonthly.summary", { checked: report.pairsChecked, proposals: report.proposals })
                          : ""}
                  </div>
                </div>
                {expanded && report && (
                  <div className="space-y-3 pl-5">
                    <div className="flex flex-wrap gap-2">
                      {REASON_ORDER.filter((r) => report.counts?.[r]).map((r) => (
                        <Badge key={r} variant={r === "positive" ? "default" : "secondary"}>
                          {t(`crossSellMonthly.reasons.${r}`)}: {report.counts[r]}
                        </Badge>
                      ))}
                    </div>
                    {report.shop && (
                      <p className="text-xs text-muted-foreground">
                        {t("crossSellMonthly.shop", {
                          pairs: report.shop.pairsLive,
                          lists: report.shop.productListGroups,
                          removed: report.shop.pairsRemovedExternally,
                        })}
                        {report.llm ? ` · ${t("crossSellMonthly.llm", { checked: report.llm.checked, open: report.llm.skippedBudget })}` : ""}
                        {report.notified ? ` · ${t("crossSellMonthly.notified", { users: report.notified.users, email: t(`crossSellMonthly.email.${report.notified.email}`, { defaultValue: report.notified.email }) })}` : ""}
                      </p>
                    )}
                    {REASON_ORDER.filter((r) => report.findings?.[r]?.length).map((r) => (
                      <div key={r} className="space-y-1">
                        <h4 className="text-sm font-medium">{t(`crossSellMonthly.reasons.${r}`)}</h4>
                        <ul className="space-y-0.5">
                          {report.findings[r].map((f) => (
                            <li key={`${r}-${f.pairId}`} className="text-xs">
                              <span className="font-mono">{f.source}</span> {f.sourceName ?? ""} →{" "}
                              <span className="font-mono">{f.target}</span> {f.targetName ?? ""}
                              {f.groups?.length ? <span className="text-muted-foreground"> · {f.groups.join(", ")}</span> : null}
                              {f.detail ? <span className="text-muted-foreground"> · {f.detail}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
