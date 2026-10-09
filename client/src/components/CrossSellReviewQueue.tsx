// Pruefliste der Cross-Selling-Teilautomatik: Vorschlaege mit Begruendung freigeben oder ablehnen.
import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Check, Ban } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrossSellPairState } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { pollCrossSellJob } from "@/lib/crossSellJobs";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import RejectCrossSellPairDialog, { REJECT_REASON_CODES, type RejectReasonCode } from "@/components/RejectCrossSellPairDialog";

type QueueItem = CrossSellPairState & { sourceName: string | null; targetName: string | null };
type QueueResponse = { total: number; items: QueueItem[] };
type PairStatsView = {
  pairOrders?: number;
  distinctCustomers?: number;
  liftLB?: number;
  confLB?: number;
  gateFailures?: string[];
};

const QUEUE_KEY = ["/api/cross-selling/review-queue"];

export default function CrossSellReviewQueue() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkReason, setBulkReason] = useState<RejectReasonCode>("alternative");
  const [rejectPair, setRejectPair] = useState<QueueItem | null>(null);
  const [runProgress, setRunProgress] = useState(false);

  const { data, isLoading } = useQuery<QueueResponse>({
    queryKey: QUEUE_KEY,
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/review-queue?limit=200")).json(),
  });
  const items = data?.items ?? [];
  const allSelected = items.length > 0 && items.every((i) => selected.has(i.id));

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: QUEUE_KEY });
    queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/change-log"] });
    queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/pairs"] });
  };

  const decideMutation = useMutation({
    mutationFn: async (args: { ids: string[]; decision: "approve" | "reject"; reasonCode?: RejectReasonCode }) =>
      (await apiRequest("POST", "/api/cross-selling/review-queue/decide", args)).json(),
    onSuccess: (result: any, args) => {
      setSelected(new Set());
      refresh();
      if (args.decision === "reject") {
        toast({ title: t("crossSellReview.rejectedCount", { count: result?.rejected ?? 0 }) });
        return;
      }
      const failed = (result?.failed?.length ?? 0) + (result?.groupFull?.length ?? 0);
      toast({
        title: t("crossSellReview.approvedTitle"),
        description: t("crossSellReview.approvedSummary", {
          approved: result?.approved?.length ?? 0,
          already: result?.alreadyInShop?.length ?? 0,
          full: result?.groupFull?.length ?? 0,
          failed: result?.failed?.length ?? 0,
        }),
        variant: failed > 0 ? "destructive" : undefined,
      });
    },
    onError: (error: Error) => {
      toast({ title: t("crossSellReview.decideError"), description: error.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      setRunProgress(true);
      await apiRequest("POST", "/api/cross-selling/candidates/run", {});
      return pollCrossSellJob("candidates");
    },
    onSuccess: (result: any) => {
      setRunProgress(false);
      refresh();
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/runs"] });
      const s = result?.stats;
      toast({
        title: t("crossSellReview.runDone"),
        description: result?.skipped
          ? t(`crossSellReview.skipped.${result.skipped}`, { defaultValue: result.skipped })
          : t("crossSellReview.runSummary", {
              queued: s?.queued ?? 0,
              eligible: s?.autoEligible ?? 0,
              applied: s?.autoApplied ?? 0,
              llm: s?.llmChecked ?? 0,
            }),
      });
    },
    onError: (error: Error) => {
      setRunProgress(false);
      toast({ title: t("crossSellReview.runError"), description: error.message, variant: "destructive" });
    },
  });

  const toggle = (id: string, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <Card className="p-6 space-y-4" data-testid="card-cross-sell-review">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("crossSellReview.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("crossSellReview.hint")}</p>
        </div>
        <Button variant="outline" onClick={() => runMutation.mutate()} disabled={runMutation.isPending}>
          {runProgress ? t("crossSellReview.runRunning") : t("crossSellReview.runButton")}
        </Button>
      </div>

      {selectedIds.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border p-2">
          <span className="text-sm">{t("crossSellReview.selected", { count: selectedIds.length })}</span>
          <Button size="sm" onClick={() => decideMutation.mutate({ ids: selectedIds, decision: "approve" })} disabled={decideMutation.isPending}>
            <Check className="h-4 w-4 mr-1" />
            {t("crossSellReview.approveSelected")}
          </Button>
          <div className="w-56">
            <Select value={bulkReason} onValueChange={(v) => setBulkReason(v as RejectReasonCode)}>
              <SelectTrigger aria-label={t("crossSellMemory.reason")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REJECT_REASON_CODES.map((code) => (
                  <SelectItem key={code} value={code}>
                    {t(`crossSellMemory.reasons.${code}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="destructive"
            onClick={() => decideMutation.mutate({ ids: selectedIds, decision: "reject", reasonCode: bulkReason })}
            disabled={decideMutation.isPending}
          >
            <Ban className="h-4 w-4 mr-1" />
            {t("crossSellReview.rejectSelected")}
          </Button>
        </div>
      )}

      {isLoading ? (
        <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("crossSellReview.empty")}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t("crossSellReview.count", { shown: items.length, total: data?.total ?? 0 })}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">
                  <Checkbox
                    checked={allSelected}
                    onCheckedChange={(v) => setSelected(v === true ? new Set(items.map((i) => i.id)) : new Set())}
                    aria-label={t("crossSellReview.selectAll")}
                  />
                </TableHead>
                <TableHead>{t("crossSellReview.pair")}</TableHead>
                <TableHead>{t("crossSellReview.evidence")}</TableHead>
                <TableHead>{t("crossSellReview.aiCheck")}</TableHead>
                <TableHead className="text-right">{t("crossSellReview.score")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const st = (item.stats ?? {}) as PairStatsView;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Checkbox
                        checked={selected.has(item.id)}
                        onCheckedChange={(v) => toggle(item.id, v === true)}
                        aria-label={t("crossSellReview.selectItem", { source: item.sourceProductNumber, target: item.targetProductNumber })}
                      />
                    </TableCell>
                    <TableCell className="text-sm min-w-[260px] max-w-[380px]">
                      <div>
                        <span className="font-mono text-xs">{item.sourceProductNumber}</span>
                        <span className="text-muted-foreground"> {item.sourceName ?? ""}</span>
                      </div>
                      <div className="text-muted-foreground">→</div>
                      <div>
                        <span className="font-mono text-xs">{item.targetProductNumber}</span>
                        <span className="text-muted-foreground"> {item.targetName ?? ""}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-xs space-y-1 min-w-[180px]">
                      {item.origin === "manual_rule" && <Badge variant="outline">{t("crossSellReview.fromRule")}</Badge>}
                      <div>
                        {t("crossSellReview.ordersFromCustomers", {
                          orders: st.pairOrders ?? 0,
                          customers: st.distinctCustomers ?? 0,
                        })}
                      </div>
                      {typeof st.liftLB === "number" && st.liftLB > 0 && (
                        <div className="text-muted-foreground">{t("crossSellReview.lift", { lift: fmt.decimal(st.liftLB, 1) })}</div>
                      )}
                      {item.autoEligible && <Badge>{t("crossSellReview.wouldAutoApply")}</Badge>}
                      {!item.autoEligible && (st.gateFailures?.length ?? 0) > 0 && (
                        <div className="text-muted-foreground">
                          {t("crossSellReview.notAutoBecause")}{" "}
                          {st.gateFailures!.map((g) => t(`crossSellReview.gates.${g}`, { defaultValue: g })).join(", ")}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-xs min-w-[220px] max-w-[320px] space-y-1">
                      {item.llmVerdict ? (
                        <>
                          <Badge variant={item.llmVerdict === "fit" ? "default" : item.llmVerdict === "no_fit" ? "destructive" : "secondary"}>
                            {t(`crossSellReview.verdict.${item.llmVerdict}`)}
                            {item.llmRelation ? ` · ${t(`crossSellReview.relation.${item.llmRelation}`, { defaultValue: item.llmRelation })}` : ""}
                          </Badge>
                          {item.llmReason && <div className="text-muted-foreground">{item.llmReason}</div>}
                        </>
                      ) : (
                        <span className="text-muted-foreground">{t("crossSellReview.notChecked")}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-sm">{fmt.percent(item.score ?? 0, 0)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1 whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => decideMutation.mutate({ ids: [item.id], decision: "approve" })}
                          disabled={decideMutation.isPending}
                          aria-label={t("crossSellReview.approve")}
                        >
                          <Check className="h-4 w-4 mr-1" />
                          {t("crossSellReview.approve")}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setRejectPair(item)}
                          title={t("crossSellMemory.rejectTitle")}
                          aria-label={t("crossSellMemory.rejectTitle")}
                        >
                          <Ban className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </>
      )}

      <RejectCrossSellPairDialog
        pair={
          rejectPair
            ? {
                sourceProductNumber: rejectPair.sourceProductNumber,
                targetProductNumber: rejectPair.targetProductNumber,
                sourceName: rejectPair.sourceName,
                targetName: rejectPair.targetName,
              }
            : null
        }
        onClose={() => {
          setRejectPair(null);
          refresh();
        }}
      />
    </Card>
  );
}
