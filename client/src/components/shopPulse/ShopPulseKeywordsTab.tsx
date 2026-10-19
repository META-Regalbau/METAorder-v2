import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Search, Undo2, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopPulseKeywordsOverview, ShopPulseSearchKeyword } from "@shared/shopPulseHandoff";

/**
 * Shop-Puls, Reiter „Suchwörter“ (Stufe 3, S3-1): Suchbegriffe ohne Treffer mit den passenden Artikeln.
 * Eindeutige Zuordnungen trägt der Shop-Puls selbst ins Feld „Suchbegriffe“ am Produkt ein (Schalter,
 * Entscheidung 19.10.2026), unklare bleiben Vorschläge zum Eintragen per Knopf; jede Eintragung lässt sich
 * zurücknehmen. Aus Teams: ?tab=keywords&keyword=<id>&action=revert (Rückfrage). Server:
 * server/routes/shopPulseHandoffRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/keywords"];

export function ShopPulseKeywordsTab({ focusId, confirmRevert }: { focusId: string | null; confirmRevert: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [, navigate] = useLocation();
  const query = useQuery<ShopPulseKeywordsOverview>({ queryKey: QUERY_KEY });
  const data = query.data;
  const [term, setTerm] = useState("");
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [revertId, setRevertId] = useState<string | null>(confirmRevert ? focusId : null);

  useEffect(() => {
    if (!focusId || !data) return;
    document.getElementById(revertId ? "shop-pulse-keyword-confirm" : `shop-pulse-keyword-${focusId}`)?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, !!data]);

  const done = (next: ShopPulseKeywordsOverview, title: string) => {
    queryClient.setQueryData(QUERY_KEY, next);
    queryClient.invalidateQueries({ queryKey: ["/api/shop-pulse/actions"] });
    toast({ title });
  };
  const fail = (error: Error) => {
    // Eintragen gescheitert: der Eintrag steht danach mit Fehler in der Liste
    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    toast({ title: t("shopPulse.keywords.actionFailed"), description: error.message, variant: "destructive" });
  };

  const check = useMutation({
    mutationFn: async (value: string) => (await (await apiRequest("POST", "/api/shop-pulse/keywords", { term: value })).json()) as { keyword: ShopPulseSearchKeyword; overview: ShopPulseKeywordsOverview },
    onSuccess: ({ keyword, overview }) => {
      setTerm("");
      done(overview, t(`shopPulse.keywords.checked.${keyword.matchKind}`, { term: keyword.term }));
    },
    onError: fail,
  });
  const settings = useMutation({
    mutationFn: async (autoApply: boolean) => (await apiRequest("PUT", "/api/shop-pulse/keywords/settings", { autoApply })).json() as Promise<ShopPulseKeywordsOverview>,
    onSuccess: (next) => done(next, t("shopPulse.keywords.saved")),
    onError: fail,
  });
  const action = useMutation({
    mutationFn: async (a: { id: string; kind: "apply"; productNumbers: string[] } | { id: string; kind: "revert" | "dismiss" }) =>
      (await apiRequest("POST", `/api/shop-pulse/keywords/${encodeURIComponent(a.id)}/${a.kind}`, a.kind === "apply" ? { productNumbers: a.productNumbers } : undefined)).json() as Promise<ShopPulseKeywordsOverview>,
    onSuccess: (next, a) => {
      if (a.kind === "revert") {
        setRevertId(null);
        navigate("/admin/shop-puls?tab=keywords", { replace: true });
      }
      done(next, t(`shopPulse.keywords.${a.kind}Done`));
    },
    onError: fail,
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("shopPulse.loading")}
      </div>
    );
  }
  if (query.isError || !data) return <Card className="p-4 text-sm text-destructive">{t("shopPulse.keywords.loadError")}</Card>;

  const confirmItem = revertId ? data.items.find((k) => k.id === revertId && k.status === "applied") : undefined;
  const pickedOf = (k: ShopPulseSearchKeyword) => picked[k.id] ?? (k.candidates.length === 1 ? [k.candidates[0].productNumber] : []);
  const toggle = (k: ShopPulseSearchKeyword, pn: string, on: boolean) => {
    const cur = pickedOf(k);
    setPicked({ ...picked, [k.id]: on ? Array.from(new Set([...cur, pn])) : cur.filter((x) => x !== pn) });
  };

  return (
    <div className="space-y-4">
      {confirmItem ? (
        <Card id="shop-pulse-keyword-confirm" className="p-4 flex flex-wrap items-center justify-between gap-3 border-amber-400" role="alertdialog" aria-labelledby="shop-pulse-keyword-confirm-title" data-testid="shop-pulse-keyword-confirm">
          <div>
            <div id="shop-pulse-keyword-confirm-title" className="font-medium">
              {t("shopPulse.keywords.confirmRevert", { term: confirmItem.term })}
            </div>
            <div className="text-sm text-muted-foreground">{confirmItem.applied.map((a) => `${a.productNumber} ${a.name}`).join(", ")}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setRevertId(null)}>
              {t("shopPulse.signals.cancel")}
            </Button>
            <Button disabled={action.isPending} onClick={() => action.mutate({ id: confirmItem.id, kind: "revert" })} data-testid="button-shop-pulse-keyword-confirm-revert">
              <Undo2 className="h-4 w-4 mr-2" aria-hidden="true" />
              {t("shopPulse.keywords.revert")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Card className="p-4 space-y-3" data-testid="shop-pulse-keywords-settings">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-semibold">{t("shopPulse.keywords.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("shopPulse.keywords.hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="shop-pulse-keywords-auto" checked={data.settings.autoApply} disabled={settings.isPending} onCheckedChange={(v) => settings.mutate(v)} aria-describedby="shop-pulse-keywords-auto-hint" data-testid="switch-shop-pulse-keywords-auto" />
          <Label htmlFor="shop-pulse-keywords-auto">{t("shopPulse.keywords.autoApply")}</Label>
        </div>
        <p id="shop-pulse-keywords-auto-hint" className="text-xs text-muted-foreground max-w-3xl">
          {t("shopPulse.keywords.autoApplyHint")}
        </p>
        {data.lastRunAt ? <p className="text-xs text-muted-foreground">{t("shopPulse.keywords.lastRun", { at: fmt.dateTime(data.lastRunAt) })}</p> : null}
        <form
          className="flex flex-wrap items-end gap-2 border-t pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (term.trim().length >= 3) check.mutate(term.trim());
          }}
        >
          <div className="space-y-1 min-w-0 flex-1 basis-64">
            <Label htmlFor="shop-pulse-keyword-term">{t("shopPulse.keywords.termLabel")}</Label>
            <Input id="shop-pulse-keyword-term" value={term} maxLength={60} placeholder={t("shopPulse.keywords.termPlaceholder")} onChange={(e) => setTerm(e.target.value)} autoComplete="off" data-testid="input-shop-pulse-keyword-term" />
          </div>
          <Button type="submit" disabled={term.trim().length < 3 || check.isPending} data-testid="button-shop-pulse-keyword-check">
            {check.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Search className="h-4 w-4 mr-2" aria-hidden="true" />}
            {t("shopPulse.keywords.check")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground max-w-3xl">{t("shopPulse.keywords.checkHint")}</p>
      </Card>

      <Card className="overflow-x-auto">
        {data.items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="shop-pulse-keywords-empty">
            {t("shopPulse.keywords.empty")}
          </p>
        ) : (
          <Table data-testid="shop-pulse-keywords">
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopPulse.keywords.columns.term")}</TableHead>
                <TableHead>{t("shopPulse.keywords.columns.match")}</TableHead>
                <TableHead>{t("shopPulse.keywords.columns.products")}</TableHead>
                <TableHead>{t("shopPulse.keywords.columns.status")}</TableHead>
                <TableHead>{t("shopPulse.keywords.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((k) => (
                <TableRow key={k.id} id={`shop-pulse-keyword-${k.id}`} className={k.id === focusId ? "bg-muted/60" : ""} data-testid={`row-shop-pulse-keyword-${k.id}`}>
                  <TableCell className="align-top">
                    <div className="font-medium">„{k.term}“</div>
                    <div className="text-xs text-muted-foreground">
                      {k.source === "ga4" ? t("shopPulse.keywords.fromGa4", { count: k.searches }) : t("shopPulse.keywords.fromManual")}
                    </div>
                  </TableCell>
                  <TableCell className="align-top text-sm max-w-xs">{t(`shopPulse.keywords.match.${k.matchKind}`)}</TableCell>
                  <TableCell className="align-top text-sm">
                    {k.status === "applied" || k.status === "reverted" ? (
                      <ul className="space-y-1">
                        {k.applied.map((a) => (
                          <li key={a.productId}>
                            <span className="font-mono text-xs">{a.productNumber}</span> {a.name}
                            <div className="text-xs text-muted-foreground">
                              {t("shopPulse.keywords.beforeAfter", { before: a.before?.length ? a.before.join(", ") : t("shopPulse.keywords.emptyValue"), after: a.after.join(", ") })}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : k.candidates.length ? (
                      <fieldset className="space-y-1">
                        <legend className="sr-only">{t("shopPulse.keywords.pickLegend", { term: k.term })}</legend>
                        {k.candidates.map((c) => {
                          const id = `kw-${k.id}-${c.productNumber}`;
                          return (
                            <div key={c.productNumber} className="flex items-start gap-2">
                              <Checkbox id={id} checked={pickedOf(k).includes(c.productNumber)} disabled={k.status === "dismissed"} onCheckedChange={(v) => toggle(k, c.productNumber, v === true)} data-testid={`checkbox-shop-pulse-keyword-${k.id}-${c.productNumber}`} />
                              <Label htmlFor={id} className="font-normal leading-snug">
                                <span className="font-mono text-xs">{c.productNumber}</span> {c.name}
                                <span className="block text-xs text-muted-foreground">
                                  {t(`shopPulse.keywords.reasons.${c.reason}`)} · {t("shopPulse.keywords.revenue", { amount: fmt.currencyWhole(c.revenue) })}
                                </span>
                              </Label>
                            </div>
                          );
                        })}
                      </fieldset>
                    ) : (
                      <span className="text-muted-foreground">–</span>
                    )}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <Badge variant={k.status === "applied" ? "default" : k.status === "failed" ? "destructive" : "outline"}>{t(`shopPulse.keywords.statuses.${k.status}`)}</Badge>
                    {k.appliedAt && k.status === "applied" ? <div className="text-xs text-muted-foreground mt-1">{t("shopPulse.keywords.appliedBy", { name: k.appliedBy ?? "–", at: fmt.dateTime(k.appliedAt) })}</div> : null}
                    {k.revertedAt && k.status === "reverted" ? <div className="text-xs text-muted-foreground mt-1">{t("shopPulse.keywords.revertedBy", { name: k.revertedBy ?? "–", at: fmt.dateTime(k.revertedAt) })}</div> : null}
                    {k.error ? <div className="text-xs text-destructive mt-1 break-words max-w-xs">{k.error}</div> : null}
                  </TableCell>
                  <TableCell className="align-top">
                    <div className="flex flex-wrap gap-2">
                      {(k.status === "suggested" || k.status === "failed") && k.candidates.length ? (
                        <Button size="sm" disabled={action.isPending || !pickedOf(k).length} onClick={() => action.mutate({ id: k.id, kind: "apply", productNumbers: pickedOf(k) })} data-testid={`button-shop-pulse-keyword-apply-${k.id}`}>
                          {t("shopPulse.keywords.apply", { count: pickedOf(k).length })}
                        </Button>
                      ) : null}
                      {k.status === "applied" ? (
                        <Button size="sm" variant="outline" disabled={action.isPending} onClick={() => setRevertId(k.id)} data-testid={`button-shop-pulse-keyword-revert-${k.id}`}>
                          <Undo2 className="h-4 w-4 mr-1" aria-hidden="true" />
                          {t("shopPulse.keywords.revert")}
                        </Button>
                      ) : null}
                      {k.status === "suggested" || k.status === "failed" ? (
                        <Button size="sm" variant="ghost" disabled={action.isPending} onClick={() => action.mutate({ id: k.id, kind: "dismiss" })} data-testid={`button-shop-pulse-keyword-dismiss-${k.id}`}>
                          <X className="h-4 w-4 mr-1" aria-hidden="true" />
                          {t("shopPulse.keywords.dismiss")}
                        </Button>
                      ) : null}
                    </div>
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
