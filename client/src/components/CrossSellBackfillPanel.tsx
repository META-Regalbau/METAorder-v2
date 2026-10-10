// Erstbefuellung des Cross-Sellings ueber den ganzen Katalog (Start/Stopp, Fortschritt).
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type BackfillState = {
  status: "idle" | "running" | "done" | "stopped";
  startedAt?: string;
  finishedAt?: string;
  llmUsed: number;
  runs: number;
  autoApplied: number;
  dryRunFlagged: number;
  queued: number;
  remainingUnchecked?: number;
  lastRunAt?: string;
  lastError?: string | null;
};
type BackfillResponse = { state: BackfillState; budget: number; mode: string };

const KEY = ["/api/cross-selling/backfill"];

export default function CrossSellBackfillPanel() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const { data } = useQuery<BackfillResponse>({
    queryKey: KEY,
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/backfill")).json(),
    refetchInterval: (q) => ((q.state.data as BackfillResponse | undefined)?.state.status === "running" ? 30_000 : false),
  });
  const state = data?.state;
  const running = state?.status === "running";

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/cross-selling/backfill/start", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: t("crossSellBackfill.started"), description: t("crossSellBackfill.startedHint") });
    },
    onError: (e: Error) => toast({ title: t("crossSellBackfill.error"), description: e.message, variant: "destructive" }),
  });
  const stop = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/cross-selling/backfill/stop", {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEY });
      toast({ title: t("crossSellBackfill.stopped") });
    },
    onError: (e: Error) => toast({ title: t("crossSellBackfill.error"), description: e.message, variant: "destructive" }),
  });

  const budget = data?.budget ?? 0;
  const used = state?.llmUsed ?? 0;

  return (
    <div className="space-y-3 rounded-md border p-4" data-testid="card-cross-sell-backfill">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{t("crossSellBackfill.title")}</h3>
          <p className="text-xs text-muted-foreground">{t("crossSellBackfill.hint")}</p>
        </div>
        <div className="flex gap-2">
          {running ? (
            <Button size="sm" variant="outline" onClick={() => stop.mutate()} disabled={stop.isPending}>
              {t("crossSellBackfill.stop")}
            </Button>
          ) : (
            <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending}>
              {state?.status === "done" || state?.status === "stopped" ? t("crossSellBackfill.restart") : t("crossSellBackfill.start")}
            </Button>
          )}
        </div>
      </div>
      {data?.mode === "off" && <p className="text-xs text-amber-700 dark:text-amber-400">{t("crossSellBackfill.modeOff")}</p>}
      {state && state.status !== "idle" && (
        <div className="space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={running ? "default" : "secondary"}>{t(`crossSellBackfill.status.${state.status}`)}</Badge>
            {state.startedAt && <span className="text-muted-foreground">{t("crossSellBackfill.since", { date: fmt.dateTime(state.startedAt) })}</span>}
            {state.lastRunAt && <span className="text-muted-foreground">{t("crossSellBackfill.lastRun", { date: fmt.dateTime(state.lastRunAt) })}</span>}
          </div>
          {budget > 0 && (
            <div className="space-y-1">
              <Progress value={Math.min(100, (used / budget) * 100)} aria-label={t("crossSellBackfill.budgetLabel")} />
              <div className="text-muted-foreground">{t("crossSellBackfill.budget", { used, budget })}</div>
            </div>
          )}
          <div>
            {t("crossSellBackfill.counts", {
              runs: state.runs,
              applied: state.autoApplied,
              dryRun: state.dryRunFlagged,
              queued: state.queued,
              remaining: state.remainingUnchecked ?? "—",
            })}
          </div>
          {state.lastError === "llm_not_configured" && <p className="text-destructive">{t("crossSellBackfill.llmMissing")}</p>}
        </div>
      )}
    </div>
  );
}
