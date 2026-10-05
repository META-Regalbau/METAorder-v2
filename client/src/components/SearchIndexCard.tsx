import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { useToast } from "@/hooks/use-toast";

type SourceResult = { total: number; updated: number; unchanged: number; removed: number; error?: string };
export type SearchIndexStatus = {
  running: boolean;
  counts: Record<string, number>;
  total: number;
  lastRun: { finishedAt: string; durationMs: number; result: Record<string, SourceResult> } | null;
};

export const SEARCH_INDEX_STATUS_URL = "/api/semantic/index/status";

/** Quellen in fester Reihenfolge; Schluessel = sourceType im Index */
const SOURCES = [
  { type: "product", source: "products" },
  { type: "offer", source: "offers" },
  { type: "offer_draft", source: "offer_drafts" },
  { type: "order_draft", source: "order_drafts" },
  { type: "ticket", source: "tickets" },
  { type: "ticket_template", source: "ticket_templates" },
] as const;

/**
 * Suchindex fuer FAQ-Antworten und semantische Suche: Stand je Quelle, letzter Lauf, neu aufbauen.
 * Der Index wird auch automatisch aktualisiert (kurz nach dem Start, dann alle paar Stunden).
 */
export function SearchIndexCard() {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const { toast } = useToast();
  const status = useQuery<SearchIndexStatus>({
    queryKey: [SEARCH_INDEX_STATUS_URL],
    // waehrend eines Laufs alle 3 s nachsehen
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const start = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/semantic/index", {}),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [SEARCH_INDEX_STATUS_URL] }),
    onError: (error: Error) => toast({ title: t("searchIndex.startFailed"), description: error.message, variant: "destructive" }),
  });
  const data = status.data;
  const running = Boolean(data?.running) || start.isPending;
  const labels: Record<string, string> = {
    product: t("searchIndex.sources.product"),
    offer: t("searchIndex.sources.offer"),
    offer_draft: t("searchIndex.sources.offerDraft"),
    order_draft: t("searchIndex.sources.orderDraft"),
    ticket: t("searchIndex.sources.ticket"),
    ticket_template: t("searchIndex.sources.ticketTemplate"),
  };

  return (
    <Card className="p-6" data-testid="card-search-index">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide">{t("searchIndex.title")}</h2>
          <p className="text-xs text-muted-foreground mt-1">{t("searchIndex.description")}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => start.mutate()}
          disabled={running}
          data-testid="button-search-index-run"
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          {running ? t("searchIndex.running") : t("searchIndex.run")}
        </Button>
      </div>
      {data && (
        <div className="mt-4 space-y-2 text-sm">
          <ul className="grid gap-1 sm:grid-cols-2" data-testid="list-search-index-sources">
            {SOURCES.map(({ type, source }) => {
              const error = data.lastRun?.result?.[source]?.error;
              return (
                <li key={type} className="flex justify-between gap-2 border-b py-1">
                  <span>{labels[type]}</span>
                  <span className={error ? "text-destructive" : "tabular-nums"} title={error}>
                    {error ? t("searchIndex.sourceError") : fmt.integer(data.counts[type] ?? 0)}
                  </span>
                </li>
              );
            })}
          </ul>
          <p className="text-xs text-muted-foreground" data-testid="text-search-index-last-run">
            {data.lastRun
              ? t("searchIndex.lastRun", {
                  date: fmt.dateTime(data.lastRun.finishedAt),
                  seconds: fmt.decimal(data.lastRun.durationMs / 1000, 1),
                })
              : t("searchIndex.neverRun")}
          </p>
        </div>
      )}
    </Card>
  );
}
