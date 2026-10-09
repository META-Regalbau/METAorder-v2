// Cross-Selling-Gedaechtnis im Staging-Reiter: Shop-Zuordnungen einlesen und abgelehnte Paare verwalten.
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { CrossSellPairState, CrossSellRun } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { pollCrossSellJob } from "@/lib/crossSellJobs";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type ImportStats = {
  productListGroups: number;
  productStreamGroups: number;
  assignments: number;
  pairsLive: number;
  pairsNew: number;
  pairsRemovedExternally: number;
  unknownProducts: number;
  byOrigin?: Record<string, number>;
};

export default function CrossSellMemoryPanel({ productName }: { productName: (pn: string) => string | null | undefined }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [rejectedOpen, setRejectedOpen] = useState(false);
  const [importProgress, setImportProgress] = useState<number | null>(null);

  const { data: runsData } = useQuery<{ runs: CrossSellRun[] }>({
    queryKey: ["/api/cross-selling/runs", "import"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/runs?kind=import&limit=1")).json(),
  });
  const lastImport = runsData?.runs?.[0];
  const lastStats = lastImport?.stats as ImportStats | undefined;

  const { data: rejectedData } = useQuery<{ pairs: CrossSellPairState[] }>({
    queryKey: ["/api/cross-selling/pairs", "rejected"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/pairs?status=rejected&limit=500")).json(),
  });
  const rejected = rejectedData?.pairs ?? [];

  const importMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/cross-selling/import", {});
      return pollCrossSellJob("import", (processed) => setImportProgress(processed));
    },
    onSuccess: (result: { stats?: ImportStats }) => {
      setImportProgress(null);
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/pairs"] });
      toast({
        title: t("crossSellMemory.importDone"),
        description: t("crossSellMemory.importSummary", {
          pairs: result?.stats?.pairsLive ?? 0,
          fresh: result?.stats?.pairsNew ?? 0,
          removed: result?.stats?.pairsRemovedExternally ?? 0,
        }),
      });
    },
    onError: (error: Error) => {
      setImportProgress(null);
      toast({ title: t("crossSellMemory.importError"), description: error.message, variant: "destructive" });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/cross-selling/pairs/${id}/reset`, {})).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/pairs"] });
      toast({ title: t("crossSellMemory.resetDone") });
    },
    onError: (error: Error) => {
      toast({ title: t("crossSellMemory.resetError"), description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card className="p-4 border-dashed space-y-3" data-testid="card-cross-sell-memory">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold">{t("crossSellMemory.title")}</h3>
          <p className="text-sm text-muted-foreground">{t("crossSellMemory.hint")}</p>
          {lastImport && (
            <p className="text-xs text-muted-foreground mt-1">
              {lastImport.status === "completed" && lastStats
                ? t("crossSellMemory.lastImport", {
                    date: fmt.dateTime(String(lastImport.finishedAt ?? lastImport.startedAt)),
                    pairs: lastStats.pairsLive,
                    groups: lastStats.productListGroups,
                    streams: lastStats.productStreamGroups,
                  })
                : t("crossSellMemory.lastImportFailed", { date: fmt.dateTime(String(lastImport.startedAt)) })}
            </p>
          )}
        </div>
        <Button variant="outline" onClick={() => importMutation.mutate()} disabled={importMutation.isPending}>
          {importMutation.isPending
            ? t("crossSellMemory.importRunning", { count: importProgress ?? 0 })
            : t("crossSellMemory.importButton")}
        </Button>
      </div>

      <Collapsible open={rejectedOpen} onOpenChange={setRejectedOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="px-0">
            {rejectedOpen ? <ChevronDown className="h-4 w-4 mr-1" /> : <ChevronRight className="h-4 w-4 mr-1" />}
            {t("crossSellMemory.rejectedTitle", { count: rejected.length })}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {rejected.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("crossSellMemory.rejectedEmpty")}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("rules.aiSource")}</TableHead>
                  <TableHead>{t("rules.aiTarget")}</TableHead>
                  <TableHead>{t("crossSellMemory.reason")}</TableHead>
                  <TableHead>{t("crossSellMemory.decidedAt")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rejected.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{p.sourceProductNumber}</span>
                      <div className="text-muted-foreground text-xs">{productName(p.sourceProductNumber) || ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      <span className="font-mono text-xs">{p.targetProductNumber}</span>
                      <div className="text-muted-foreground text-xs">{productName(p.targetProductNumber) || ""}</div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {p.decisionReasonCode ? t(`crossSellMemory.reasons.${p.decisionReasonCode}`, { defaultValue: p.decisionReasonCode }) : "—"}
                      {p.decisionNote && <div className="text-xs text-muted-foreground">{p.decisionNote}</div>}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {p.decidedAt ? fmt.dateTime(String(p.decidedAt)) : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => resetMutation.mutate(p.id)}
                        disabled={resetMutation.isPending}
                        aria-label={t("crossSellMemory.reset")}
                      >
                        <RotateCcw className="h-4 w-4 mr-1" />
                        {t("crossSellMemory.reset")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
