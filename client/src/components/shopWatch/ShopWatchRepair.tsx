import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import { Loader2, Save, Undo2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopWatchCheckResult, ShopWatchRepairOverview, ShopWatchRepairRecord } from "@shared/shopWatch";

/**
 * Shop-Wächter, Reparatur per Knopf (Shop-Puls Stufe 3, S3-2): Soll-Stand je Prüfpunkt, „Reparieren“ mit
 * Rückfrage (höchstens einmal je Deploy), letzte Reparatur mit „Zurücknehmen“, Soll-Stand von Hand sichern.
 * Keine Selbst-Reparatur (Entscheidung 19.10.2026). Server: server/routes/shopWatchRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-content/watch"];

export function ShopWatchRepairCell({ result, repair, running }: { result: ShopWatchCheckResult; repair: ShopWatchRepairOverview | undefined; running: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [confirm, setConfirm] = useState<"repair" | "revert" | null>(null);
  const done = (title: string) => {
    setConfirm(null);
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    toast({ title });
  };
  const fail = (error: Error) => {
    setConfirm(null);
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    toast({ title: t("shopWatch.repairs.failed"), description: error.message, variant: "destructive" });
  };
  const repairMutation = useMutation({
    mutationFn: async () => (await (await apiRequest("POST", `/api/shop-content/watch/checks/${encodeURIComponent(result.id)}/repair`)).json()) as { repair: ShopWatchRepairRecord },
    onSuccess: ({ repair: r }) => done(r.checkStatusAfter === "ok" ? t("shopWatch.repairs.doneOk") : t("shopWatch.repairs.doneCheck", { status: t(`shopWatch.status.${r.checkStatusAfter ?? "error"}`) })),
    onError: fail,
  });
  const revertMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/shop-content/watch/repairs/${encodeURIComponent(id)}/revert`),
    onSuccess: () => done(t("shopWatch.repairs.reverted")),
    onError: fail,
  });
  const captureMutation = useMutation({
    mutationFn: async () => apiRequest("POST", `/api/shop-content/watch/checks/${encodeURIComponent(result.id)}/target`),
    onSuccess: () => done(t("shopWatch.repairs.targetSaved")),
    onError: fail,
  });
  if (!repair) return null;
  const busy = running || repairMutation.isPending || revertMutation.isPending || captureMutation.isPending;
  const last = repair.lastRepair;
  const canRepair = result.status !== "ok" && !!repair.targetTakenAt;

  return (
    <div className="mt-2 space-y-1 text-xs" data-testid={`shop-watch-repair-${result.id}`}>
      <div className="text-muted-foreground">
        {repair.targetTakenAt ? t("shopWatch.repairs.target", { at: fmt.dateTime(repair.targetTakenAt), n: repair.targetEntities }) : t("shopWatch.repairs.noTarget")}
      </div>
      {last ? (
        <div className={last.status === "failed" ? "text-destructive" : "text-muted-foreground"}>
          {last.revertedAt
            ? t("shopWatch.repairs.lastReverted", { at: fmt.dateTime(last.revertedAt), name: last.revertedBy ?? "–" })
            : last.status === "failed"
              ? t("shopWatch.repairs.lastFailed", { at: fmt.dateTime(last.repairedAt), error: last.error ?? "" })
              : t("shopWatch.repairs.last", { at: fmt.dateTime(last.repairedAt), name: last.repairedBy ?? "–", status: t(`shopWatch.status.${last.checkStatusAfter ?? "error"}`) })}
        </div>
      ) : null}
      {repair.blocked && result.status !== "ok" ? <div className="text-amber-700 dark:text-amber-300">{t("shopWatch.repairs.blocked")}</div> : null}
      {confirm ? (
        <div className="flex flex-wrap items-center gap-2 rounded-md border border-amber-400 p-2" role="group" aria-labelledby={`shop-watch-confirm-${result.id}`}>
          <span id={`shop-watch-confirm-${result.id}`} className="font-medium">
            {confirm === "repair" ? t("shopWatch.repairs.confirmRepair") : t("shopWatch.repairs.confirmRevert")}
          </span>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => (confirm === "repair" ? repairMutation.mutate() : last && revertMutation.mutate(last.id))}
            data-testid={`button-shop-watch-confirm-${result.id}`}
          >
            {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
            {confirm === "repair" ? t("shopWatch.repairs.repair") : t("shopWatch.repairs.revert")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setConfirm(null)}>
            {t("shopWatch.repairs.cancel")}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1">
          {canRepair ? (
            <Button size="sm" variant="outline" disabled={busy || repair.blocked} onClick={() => setConfirm("repair")} data-testid={`button-shop-watch-repair-${result.id}`}>
              <Wrench className="h-4 w-4 mr-1" aria-hidden="true" />
              {t("shopWatch.repairs.repair")}
            </Button>
          ) : null}
          {last && last.status === "ok" && !last.revertedAt ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm("revert")} data-testid={`button-shop-watch-revert-${result.id}`}>
              <Undo2 className="h-4 w-4 mr-1" aria-hidden="true" />
              {t("shopWatch.repairs.revert")}
            </Button>
          ) : null}
          {result.status === "ok" ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => captureMutation.mutate()} data-testid={`button-shop-watch-target-${result.id}`}>
              {captureMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" aria-hidden="true" />}
              {t("shopWatch.repairs.saveTarget")}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
