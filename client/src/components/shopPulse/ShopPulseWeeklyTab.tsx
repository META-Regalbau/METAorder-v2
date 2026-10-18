import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CalendarRange, Copy, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatShopPulseParams, type ShopPulseSignal } from "@shared/shopPulse";
import { changePercent, type ShopPulseWeekFigures, type ShopPulseWeeklyOverview, type ShopPulseWeeklyReport } from "@shared/shopPulseWeekly";

/**
 * Shop-Puls, Reiter „Wochenberichte“ (Stufe 2, S2-1): Archiv aller Wochenberichte. Je Bericht die Woche in
 * Zahlen gegen Vorwoche und Vorjahr, KI-Zusammenfassung (deutsch, wie in Teams), Top 5 Hebel nach €, Erledigt
 * letzte Woche aus dem Maßnahmen-Protokoll und offen je Zuständigem (Liste zum Weiterleiten, deutsch).
 * „Jetzt erstellen“ baut den Bericht der abgeschlossenen Woche ohne Senden. Server: shopPulseWeeklyRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/weekly-reports"];

export function ShopPulseWeeklyTab({ initialWeek }: { initialWeek: string | null }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [week, setWeek] = useState<string | null>(initialWeek);

  const query = useQuery<ShopPulseWeeklyOverview>({ queryKey: QUERY_KEY });
  const buildMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/weekly-reports/build")).json() as Promise<ShopPulseWeeklyOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setWeek(next.reports[0]?.weekStart ?? null);
      toast({ title: t("shopPulse.weeklyPage.built") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.weeklyPage.buildFailed"), description: error.message, variant: "destructive" }),
  });

  const reports = query.data?.reports ?? [];
  const report = reports.find((r) => r.weekStart === week) ?? reports[0];
  const day = (d: string) => fmt.date(`${d}T12:00:00`);
  const params = (s: Pick<ShopPulseSignal, "code" | "params">) =>
    formatShopPulseParams(s.code, s.params, { money: (v) => fmt.currencyWhole(v), date: (d) => day(d), number: (v) => fmt.integer(v), percent: (v) => fmt.percentValue(v, 1) });
  const title = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`shopPulse.codes.${s.code}.title`, params(s));
  const message = (s: Pick<ShopPulseSignal, "code" | "params">) => t(`shopPulse.codes.${s.code}.message`, params(s));
  const weekLabel = (r: ShopPulseWeeklyReport) => t("shopPulse.weeklyPage.weekLabel", { week: r.isoWeek, from: day(r.weekStart), to: day(r.weekEnd) });
  const change = (cur: number, prev: number | null | undefined) => {
    const v = changePercent(cur, prev);
    return v == null ? "–" : `${v > 0 ? "+" : ""}${fmt.integer(v)} %`;
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("shopPulse.weeklyPage.copied") });
    } catch {
      toast({ title: t("shopPulse.weeklyPage.copyFailed"), variant: "destructive" });
    }
  };

  const figuresRow = (label: string, f: ShopPulseWeekFigures | null, cur: ShopPulseWeekFigures, testId: string) => (
    <TableRow data-testid={testId}>
      <TableCell className="font-medium whitespace-nowrap">
        {label}
        {f ? <div className="text-xs text-muted-foreground font-normal">{`${day(f.from)} – ${day(f.to)}`}</div> : null}
      </TableCell>
      {f ? (
        <>
          <TableCell className="text-right">
            {fmt.integer(f.orders)}
            {f !== cur ? <div className="text-xs text-muted-foreground">{change(cur.orders, f.orders)}</div> : null}
          </TableCell>
          <TableCell className="text-right">
            {fmt.currencyWhole(f.revenue)}
            {f !== cur ? <div className="text-xs text-muted-foreground">{change(cur.revenue, f.revenue)}</div> : null}
          </TableCell>
          <TableCell className="text-right">{fmt.currencyWhole(f.aov)}</TableCell>
          <TableCell className="text-right">
            {f.db1 != null ? fmt.currencyWhole(f.db1) : "–"}
            {f.db1 != null && f.db1CoveragePercent != null ? <div className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.dbCoverage", { value: fmt.percentValue(f.db1CoveragePercent, 1) })}</div> : null}
          </TableCell>
        </>
      ) : (
        <TableCell colSpan={4} className="text-sm text-muted-foreground">
          {t("shopPulse.weeklyPage.noYear")}
        </TableCell>
      )}
    </TableRow>
  );

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-3xl">
            <h2 className="font-semibold flex items-center gap-2">
              <CalendarRange className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("shopPulse.weeklyPage.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("shopPulse.weeklyPage.hint")}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => buildMutation.mutate()} disabled={buildMutation.isPending} data-testid="button-shop-pulse-weekly-build">
            {buildMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />}
            {t("shopPulse.weeklyPage.build")}
          </Button>
        </div>
        {reports.length ? (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="shop-pulse-weekly-select" className="text-sm">
              {t("shopPulse.weeklyPage.archive", { count: reports.length })}
            </Label>
            <Select value={report?.weekStart} onValueChange={setWeek}>
              <SelectTrigger id="shop-pulse-weekly-select" className="w-80" data-testid="select-shop-pulse-weekly">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {reports.map((r) => (
                  <SelectItem key={r.weekStart} value={r.weekStart}>
                    {weekLabel(r)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : null}
      </Card>

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("shopPulse.loading")}
        </div>
      ) : query.isError ? (
        <Card className="p-4 text-sm text-destructive">{t("shopPulse.weeklyPage.loadError")}</Card>
      ) : !report ? (
        <Card className="p-4 text-sm text-muted-foreground" data-testid="shop-pulse-weekly-empty">
          {t("shopPulse.weeklyPage.empty")}
        </Card>
      ) : (
        <div className="space-y-4" data-testid="shop-pulse-weekly-report">
          <Card className="p-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-semibold">{weekLabel(report)}</h3>
              {report.sentAt ? (
                <Badge variant="outline">{t("shopPulse.weeklyPage.sent", { at: fmt.dateTime(report.sentAt) })}</Badge>
              ) : (
                <Badge variant="outline" className="bg-muted">
                  {t("shopPulse.weeklyPage.notSent")}
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.createdAt", { at: fmt.dateTime(report.createdAt) })}</span>
            </div>

            <h4 className="font-medium">{t("shopPulse.weeklyPage.numbersTitle")}</h4>
            {report.data.numbers ? (
              <>
                <div className="overflow-x-auto">
                  <Table data-testid="shop-pulse-weekly-numbers">
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t("shopPulse.weeklyPage.columns.period")}</TableHead>
                        <TableHead className="text-right">{t("shopPulse.weeklyPage.columns.orders")}</TableHead>
                        <TableHead className="text-right">{t("shopPulse.weeklyPage.columns.revenue")}</TableHead>
                        <TableHead className="text-right">{t("shopPulse.weeklyPage.columns.aov")}</TableHead>
                        <TableHead className="text-right">{t("shopPulse.weeklyPage.columns.db")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {figuresRow(t("shopPulse.weeklyPage.rows.current"), report.data.numbers.current, report.data.numbers.current, "row-shop-pulse-weekly-current")}
                      {figuresRow(t("shopPulse.weeklyPage.rows.previous"), report.data.numbers.previous, report.data.numbers.current, "row-shop-pulse-weekly-previous")}
                      {figuresRow(t("shopPulse.weeklyPage.rows.yearAgo"), report.data.numbers.yearAgo, report.data.numbers.current, "row-shop-pulse-weekly-year")}
                    </TableBody>
                  </Table>
                </div>
                <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.numbersHint")}</p>
                <p className="text-sm" data-testid="text-shop-pulse-weekly-ga4">
                  {report.data.numbers.ga4
                    ? t("shopPulse.weeklyPage.ga4", {
                        sessions: fmt.integer(report.data.numbers.ga4.current.sessions),
                        users: fmt.integer(report.data.numbers.ga4.current.users),
                        purchases: fmt.integer(report.data.numbers.ga4.current.purchases),
                        conversion: report.data.numbers.ga4.current.conversionPercent != null ? fmt.percentValue(report.data.numbers.ga4.current.conversionPercent, 2) : "–",
                        prevSessions: fmt.integer(report.data.numbers.ga4.previous.sessions),
                        prevConversion: report.data.numbers.ga4.previous.conversionPercent != null ? fmt.percentValue(report.data.numbers.ga4.previous.conversionPercent, 2) : "–",
                      })
                    : t("shopPulse.weeklyPage.ga4None")}
                </p>
              </>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-300">{t("shopPulse.weeklyPage.numbersNone")}</p>
            )}

            {report.ai?.text ? (
              <div className="rounded-md border bg-muted/40 p-3 text-sm" lang="de" data-testid="text-shop-pulse-weekly-ai">
                <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  {t("shopPulse.signals.aiText", { at: fmt.dateTime(report.ai.at) })}
                </div>
                <p className="whitespace-pre-line break-words">{report.ai.text}</p>
              </div>
            ) : report.ai?.rejected ? (
              <p className="text-xs text-muted-foreground">{t("shopPulse.signals.aiRejected", { at: fmt.dateTime(report.ai.at), reason: t(`shopPulse.signals.aiRejections.${report.ai.rejected}`) })}</p>
            ) : null}
          </Card>

          <Card className="p-4 space-y-3" data-testid="shop-pulse-weekly-levers">
            <h4 className="font-medium">{t("shopPulse.weeklyPage.leversTitle")}</h4>
            {report.data.levers.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shopPulse.weeklyPage.leversNone")}</p>
            ) : (
              <ol className="space-y-3">
                {report.data.levers.map((l, i) => (
                  <li key={l.signalId} className="rounded-md border p-3" data-testid={`shop-pulse-lever-${i}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{i + 1}.</span>
                      {l.severity === "critical" ? <XCircle className="h-4 w-4 text-destructive" aria-label={t("shopPulse.severity.critical")} /> : <AlertTriangle className="h-4 w-4 text-amber-600" aria-label={t("shopPulse.severity.warning")} />}
                      <span className="font-medium">{title(l)}</span>
                      <Badge variant="outline">
                        {l.perWeek != null && l.basis ? t("shopPulse.weeklyPage.leverAmount", { amount: fmt.currencyWhole(l.perWeek), basis: t(`shopPulse.lossBasis.${l.basis}`) }) : t("shopPulse.weeklyPage.leverNoAmount")}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground break-words">{message(l)}</p>
                    <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                      <dt className="text-muted-foreground">{t("shopPulse.weeklyPage.since")}</dt>
                      <dd>{fmt.dateTime(l.firstSeenAt)}</dd>
                      <dt className="text-muted-foreground">{t("shopPulse.weeklyPage.owner")}</dt>
                      <dd>{t(`shopPulse.weekly.owners.${l.owner}`)}</dd>
                      <dt className="text-muted-foreground">{t("shopPulse.weeklyPage.nextStep")}</dt>
                      <dd>{t(`shopPulse.weekly.nextSteps.${l.step}`)}</dd>
                    </dl>
                  </li>
                ))}
              </ol>
            )}
            {report.data.leversPerWeek > 0 ? <p className="text-sm">{t("shopPulse.weeklyPage.leversSum", { amount: fmt.currencyWhole(report.data.leversPerWeek), count: report.data.openCount })}</p> : null}
            <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.leversHint")}</p>
          </Card>

          <Card className="p-4 space-y-2" data-testid="shop-pulse-weekly-done">
            <h4 className="font-medium">{t("shopPulse.weeklyPage.doneTitle", { count: report.data.done.length })}</h4>
            {report.data.done.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shopPulse.weeklyPage.doneNone")}</p>
            ) : (
              <ul className="space-y-1 text-sm">
                {report.data.done.map((a) => (
                  <li key={a.id} className="flex flex-wrap gap-x-2">
                    <span className="text-muted-foreground whitespace-nowrap">{fmt.dateTime(a.occurredAt)}</span>
                    <span lang="de">{a.title}</span>
                    <span className="text-muted-foreground">
                      ({t(`shopPulse.actions.kinds.${a.kind}`)}
                      {a.actor ? ` · ${a.actor}` : ""})
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.doneHint")}</p>
          </Card>

          <Card className="p-4 space-y-3" data-testid="shop-pulse-weekly-owners">
            <h4 className="font-medium">{t("shopPulse.weeklyPage.ownersTitle")}</h4>
            {report.data.openByOwner.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("shopPulse.weeklyPage.leversNone")}</p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {report.data.openByOwner.map((o) => (
                  <div key={o.owner} className="rounded-md border p-3 space-y-2" data-testid={`shop-pulse-owner-${o.owner}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{t("shopPulse.weeklyPage.ownerHeading", { owner: t(`shopPulse.weekly.owners.${o.owner}`), count: o.items.length })}</span>
                      <Button size="sm" variant="outline" onClick={() => copy(o.text)} data-testid={`button-shop-pulse-owner-copy-${o.owner}`}>
                        <Copy className="h-4 w-4 mr-1" aria-hidden="true" />
                        {t("shopPulse.weeklyPage.copy")}
                      </Button>
                    </div>
                    <ul className="list-disc pl-5 text-sm space-y-1">
                      {o.items.map((item) => (
                        <li key={item.signalId}>
                          {title(item)}
                          <span className="text-muted-foreground"> · {t(`shopPulse.weekly.nextSteps.${item.step}`)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.copyHint")}</p>
          </Card>
        </div>
      )}
    </div>
  );
}
