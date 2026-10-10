// Protokoll aller Cross-Selling-Aenderungen im Shop, mit Rueckgaengig je Eintrag und je Lauf.
import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Undo2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrossSellChangeLogEntry, CrossSellRun } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { useCrossSellProductLabels } from "@/hooks/useCrossSellProductLabels";
import CrossSellMonthlyReports from "@/components/CrossSellMonthlyReports";

const UNDOABLE = new Set(["add", "remove"]);

export default function CrossSellChangeLog() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();

  const { data } = useQuery<{ entries: CrossSellChangeLogEntry[] }>({
    queryKey: ["/api/cross-selling/change-log"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/change-log?limit=300")).json(),
  });
  const { data: runsData } = useQuery<{ runs: CrossSellRun[] }>({
    queryKey: ["/api/cross-selling/runs", "candidates"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/runs?kind=candidates&limit=10")).json(),
  });
  const entries = data?.entries ?? [];
  const runs = runsData?.runs ?? [];
  const numbers = useMemo(
    () =>
      Array.from(
        new Set(entries.flatMap((e) => [e.sourceProductNumber, e.targetProductNumber]).filter((n): n is string => !!n)),
      ).slice(0, 400),
    [entries],
  );
  const { productName } = useCrossSellProductLabels(numbers, numbers.length > 0);

  const onDone = (result: { undone?: number[]; skipped?: Array<{ reason: string }> }) => {
    queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/change-log"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/pairs"] });
    toast({
      title: t("crossSellLog.undoDone", { count: result?.undone?.length ?? 0 }),
      description: (result?.skipped?.length ?? 0) > 0 ? t("crossSellLog.undoSkipped", { count: result!.skipped!.length }) : undefined,
    });
  };
  const onError = (error: Error) => toast({ title: t("crossSellLog.undoError"), description: error.message, variant: "destructive" });

  const undoEntry = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/cross-selling/change-log/${id}/undo`, {})).json(),
    onSuccess: onDone,
    onError,
  });
  const undoRun = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/cross-selling/runs/${id}/undo`, {})).json(),
    onSuccess: onDone,
    onError,
  });

  const label = (pn: string | null) => (pn ? `${pn} ${productName(pn) ?? ""}`.trim() : "—");

  return (
    <div className="space-y-6">
      <CrossSellMonthlyReports />
      <Card className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">{t("crossSellLog.runsTitle")}</h2>
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("crossSellLog.runsEmpty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crossSellLog.startedAt")}</TableHead>
                <TableHead>{t("crossSellAutomation.mode")}</TableHead>
                <TableHead>{t("crossSellLog.result")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.map((r) => {
                const s = (r.stats ?? {}) as Record<string, any>;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{fmt.dateTime(String(r.startedAt))}</TableCell>
                    <TableCell className="text-sm">{s.mode ? t(`crossSellAutomation.modes.${s.mode}`) : "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.status === "failed"
                        ? t("crossSellLog.runFailed", { error: r.error ?? "" })
                        : r.status === "running"
                          ? t("crossSellLog.runRunning")
                          : t("crossSellLog.runSummary", {
                              queued: s.queued ?? 0,
                              eligible: s.autoEligible ?? 0,
                              applied: s.autoApplied ?? 0,
                              dryRun: s.dryRunFlagged ?? 0,
                              llm: s.llmChecked ?? 0,
                            })}
                    </TableCell>
                    <TableCell className="text-right">
                      {(s.autoApplied ?? 0) > 0 && (
                        <Button size="sm" variant="outline" onClick={() => undoRun.mutate(r.id)} disabled={undoRun.isPending}>
                          <Undo2 className="h-4 w-4 mr-1" />
                          {t("crossSellLog.undoRun")}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">{t("crossSellLog.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("crossSellLog.hint")}</p>
        {entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("crossSellLog.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("crossSellLog.when")}</TableHead>
                <TableHead>{t("crossSellLog.action")}</TableHead>
                <TableHead>{t("crossSellReview.pair")}</TableHead>
                <TableHead>{t("crossSellLog.group")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs whitespace-nowrap">{fmt.dateTime(String(e.createdAt))}</TableCell>
                  <TableCell className="text-xs space-x-1">
                    <Badge variant={e.action === "remove" ? "destructive" : "secondary"}>{t(`crossSellLog.actions.${e.action}`, { defaultValue: e.action })}</Badge>
                    <Badge variant="outline">{t(`crossSellLog.modes.${e.mode}`, { defaultValue: e.mode })}</Badge>
                    {e.undoneById && <Badge variant="outline">{t("crossSellLog.undone")}</Badge>}
                  </TableCell>
                  <TableCell className="text-xs max-w-[420px]">
                    <div>{label(e.sourceProductNumber)}</div>
                    {e.targetProductNumber && <div className="text-muted-foreground">→ {label(e.targetProductNumber)}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{e.groupName ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {UNDOABLE.has(e.action) && e.mode !== "dry_run" && e.mode !== "undo" && e.success && !e.undoneById && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => undoEntry.mutate(e.id)}
                        disabled={undoEntry.isPending}
                        aria-label={t("crossSellLog.undo")}
                      >
                        <Undo2 className="h-4 w-4 mr-1" />
                        {t("crossSellLog.undo")}
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
