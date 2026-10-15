// Feste Cross-Selling-Regeln aus den Artikelnamen (Grund-/Anbauregal, Zubehoer gleiches System):
// Testlauf, Schreiben, Tageslauf, letztes Ergebnis mit Beispielen, Lauf rueckgaengig.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import type { CrossSellRun } from "@shared/schema";
import { pollCrossSellJob } from "@/lib/crossSellJobs";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type Kind = "partner_shelf" | "board" | "back_wall" | "side_wall";
type Stats = {
  dryRun: boolean;
  products: number;
  sources: number;
  pairs: number;
  byKind: Record<Kind, number>;
  skippedRejected: number;
  autoApplied: number;
  dryRunFlagged: number;
  skippedInOtherGroups: number;
  skippedForCap: number;
  errors: number;
  examples: Array<{ source: string; sourceName: string; targets: Array<{ number: string; name: string; kind: Kind }> }>;
};

const RUNS_KEY = ["/api/cross-selling/runs", "name_rules"];
const SETTINGS_KEY = ["/api/cross-selling/automation-settings"];

export default function CrossSellNameRulesPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);

  const { data: runsData } = useQuery<{ runs: CrossSellRun[] }>({
    queryKey: RUNS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/runs?kind=name_rules&limit=1")).json(),
  });
  const { data: settings } = useQuery<{ nameRulesEnabled?: boolean } & Record<string, unknown>>({
    queryKey: SETTINGS_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/automation-settings")).json(),
  });
  const lastRun = runsData?.runs?.[0];
  const stats = (lastRun?.stats ?? null) as Stats | null;

  const run = useMutation({
    mutationFn: async (apply: boolean) => {
      await apiRequest("POST", "/api/cross-selling/name-rules/run", { apply });
      return pollCrossSellJob("name_rules", (processed, total) => setProgress({ processed, total }));
    },
    onSuccess: (result: { stats?: Stats; skipped?: string }) => {
      setProgress(null);
      queryClient.invalidateQueries({ queryKey: RUNS_KEY });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/change-log"] });
      const s = result?.stats;
      toast({
        title: t("crossSellNameRules.done"),
        description: s
          ? t(s.dryRun ? "crossSellNameRules.summaryDry" : "crossSellNameRules.summary", {
              sources: s.sources,
              pairs: s.pairs,
              count: s.dryRun ? s.dryRunFlagged : s.autoApplied,
            })
          : undefined,
      });
    },
    onError: (e: Error) => {
      setProgress(null);
      toast({ title: t("crossSellNameRules.error"), description: e.message, variant: "destructive" });
    },
  });

  const undo = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/cross-selling/runs/${id}/undo`, {})).json(),
    onSuccess: (result: { undone?: number[] }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/change-log"] });
      toast({ title: t("crossSellLog.undoDone", { count: result?.undone?.length ?? 0 }) });
    },
    onError: (e: Error) => toast({ title: t("crossSellLog.undoError"), description: e.message, variant: "destructive" }),
  });

  const toggle = useMutation({
    mutationFn: async (value: boolean) =>
      (await apiRequest("PUT", "/api/cross-selling/automation-settings", { nameRulesEnabled: value })).json(),
    onSuccess: (saved) => queryClient.setQueryData(SETTINGS_KEY, saved),
    onError: (e: Error) => toast({ title: t("crossSellAutomation.saveError"), description: e.message, variant: "destructive" }),
  });

  const confirmApply = () => {
    if (window.confirm(t("crossSellNameRules.confirmApply"))) run.mutate(true);
  };

  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="card-cross-sell-name-rules">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-sm font-semibold">{t("crossSellNameRules.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("crossSellNameRules.hint")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => run.mutate(false)} disabled={run.isPending}>
            {t("crossSellNameRules.dryRun")}
          </Button>
          <Button size="sm" onClick={confirmApply} disabled={run.isPending}>
            {t("crossSellNameRules.apply")}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Switch
          id="cs-name-rules-daily"
          checked={Boolean(settings?.nameRulesEnabled)}
          onCheckedChange={(v) => toggle.mutate(v)}
          disabled={toggle.isPending || !settings}
        />
        <Label htmlFor="cs-name-rules-daily" className="text-sm">
          {t("crossSellNameRules.daily")}
        </Label>
      </div>

      {run.isPending && (
        <div className="space-y-1 text-xs" aria-live="polite">
          <Progress
            value={progress && progress.total > 0 ? (progress.processed / progress.total) * 100 : 0}
            aria-label={t("crossSellNameRules.running")}
          />
          <div className="text-muted-foreground">
            {progress && progress.total > 0
              ? t("crossSellNameRules.progress", { processed: progress.processed, total: progress.total })
              : t("crossSellNameRules.running")}
          </div>
        </div>
      )}

      {lastRun && (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">
              {lastRun.status === "failed"
                ? t("crossSellLog.runFailed", { error: lastRun.error ?? "" })
                : stats?.dryRun
                  ? t("crossSellNameRules.lastDryRun")
                  : t("crossSellNameRules.lastRun")}
            </Badge>
            <span className="text-muted-foreground">{fmt.dateTime(String(lastRun.startedAt))}</span>
            {stats && !stats.dryRun && stats.autoApplied > 0 && (
              <Button size="sm" variant="outline" onClick={() => undo.mutate(lastRun.id)} disabled={undo.isPending}>
                <Undo2 className="h-4 w-4 mr-1" />
                {t("crossSellLog.undoRun")}
              </Button>
            )}
          </div>
          {stats && (
            <>
              <p>
                {t(stats.dryRun ? "crossSellNameRules.summaryDry" : "crossSellNameRules.summary", {
                  sources: stats.sources,
                  pairs: stats.pairs,
                  count: stats.dryRun ? stats.dryRunFlagged : stats.autoApplied,
                })}
              </p>
              <p className="text-muted-foreground">
                {t("crossSellNameRules.kinds", {
                  partner: stats.byKind.partner_shelf,
                  board: stats.byKind.board,
                  back: stats.byKind.back_wall,
                  side: stats.byKind.side_wall,
                })}
                {" · "}
                {t("crossSellNameRules.skipped", {
                  other: stats.skippedInOtherGroups,
                  cap: stats.skippedForCap,
                  rejected: stats.skippedRejected,
                })}
              </p>
              {stats.examples.length > 0 && (
                <details>
                  <summary className="cursor-pointer text-muted-foreground">{t("crossSellNameRules.examples")}</summary>
                  <ul className="mt-2 space-y-2">
                    {stats.examples.map((ex) => (
                      <li key={ex.source}>
                        <div className="font-medium">
                          {ex.source} {ex.sourceName}
                        </div>
                        <ul className="pl-4 list-disc">
                          {ex.targets.map((tg) => (
                            <li key={tg.number}>
                              <span className="text-muted-foreground">{t(`crossSellNameRules.kind.${tg.kind}`)}:</span> {tg.name}
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
