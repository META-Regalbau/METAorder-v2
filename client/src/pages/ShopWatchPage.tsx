import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, BellRing, CheckCircle2, ExternalLink, Loader2, Paintbrush, Play, Rocket, ShieldCheck, Target, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  SHOP_WATCH_GROUPS,
  classifyDeployChanges,
  type ShopWatchCheckResult,
  type ShopWatchDeployChange,
  type ShopWatchFinding,
  type ShopWatchNotice,
  type ShopWatchRun,
  type ShopWatchSettings,
  type ShopWatchRepairOverview,
  type ShopWatchStatus,
} from "@shared/shopWatch";
import { ShopWatchRepairCell } from "@/components/shopWatch/ShopWatchRepair";

/**
 * Shop-Wächter (nur Administratoren): sind die Inhalte, die METAorder in den Shop geschrieben hat, noch da
 * und sichtbar (z. B. nach einem Deploy der Agentur)? Ampel je Prüfpunkt, Befunde, Reparatur-Weg.
 * Schritte 1–3 von 4 (Konzept 17.10.2026): prüfen, Zeitplan und Meldungen (Teams über n8n, Glocke), Reparatur
 * per Knopf mit Soll-Stand aus der Datenbank und Rückweg (Shop-Puls Stufe 3, S3-2). Selbst-Reparatur folgt
 * erst, wenn sich der Knopf bewährt hat (Entscheidung 19.10.2026).
 * Server: server/routes/shopWatchRoutes.ts, Prüfkatalog server/shopContent/shopWatchChecks.ts.
 */

type HistoryEntry = Pick<ShopWatchRun, "startedAt" | "trigger" | "status" | "deployChanges"> & { failed: number; warned: number };
type WatchResponse = {
  lastRun: ShopWatchRun | null;
  history: HistoryEntry[];
  baseline: { takenAt: string; counts: Record<string, number>; categories: number } | null;
  running: boolean;
  settings: ShopWatchSettings;
  schedule: {
    lastFingerprintAt: string | null;
    lastFullRunAt: string | null;
    lastNotice: ShopWatchNotice | null;
    teamsConfigured: boolean;
    teamsPending: number;
  };
  /** Reparatur per Knopf je reparierbarem Prüfpunkt */
  repairs?: Record<string, ShopWatchRepairOverview>;
};

const QUERY_KEY = ["/api/shop-content/watch"];

export function StatusIcon({ status }: { status: ShopWatchStatus }) {
  if (status === "ok") return <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />;
  if (status === "warn") return <AlertTriangle className="h-4 w-4 text-amber-600" aria-hidden="true" />;
  return <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />;
}

export default function ShopWatchPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const dateFormat = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
    [fmt.locale],
  );
  const date = (iso: string) => dateFormat.format(new Date(iso));

  const query = useQuery<WatchResponse>({
    queryKey: QUERY_KEY,
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
  const data = query.data;
  const run = data?.lastRun ?? null;

  const runMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/shop-content/watch/run"),
    onSuccess: () => {
      toast({ title: t("shopWatch.runStarted") });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast({ title: t("shopWatch.runFailed"), description: error.message, variant: "destructive" }),
  });
  const baselineMutation = useMutation({
    mutationFn: async () => apiRequest("POST", "/api/shop-content/watch/baseline"),
    onSuccess: () => {
      toast({ title: t("shopWatch.baselineSaved") });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast({ title: t("shopWatch.baselineFailed"), description: error.message, variant: "destructive" }),
  });

  const settingsMutation = useMutation({
    mutationFn: async (settings: ShopWatchSettings) => apiRequest("PUT", "/api/shop-content/watch/settings", settings),
    onSuccess: () => {
      toast({ title: t("shopWatch.schedule.saved") });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast({ title: t("shopWatch.schedule.saveFailed"), description: error.message, variant: "destructive" }),
  });

  const statusText = (s: ShopWatchStatus) => t(`shopWatch.status.${s}`);
  const findingText = (f: ShopWatchFinding) => t(`shopWatch.findings.${f.code}`, { ...(f.params ?? {}) });
  const changeText = (c: ShopWatchDeployChange) => t(`shopWatch.deploy.${c.field}`, { before: c.before, after: c.after });
  const orNever = (iso: string | null | undefined) => (iso ? date(iso) : t("shopWatch.schedule.never"));
  const changeKind = (changes: ShopWatchDeployChange[]) => classifyDeployChanges(changes);

  const statusBadge = (s: ShopWatchStatus) => (
    <Badge
      variant={s === "fail" || s === "error" ? "destructive" : "outline"}
      className={`gap-1 ${s === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : ""}`}
    >
      <StatusIcon status={s} />
      {statusText(s)}
    </Badge>
  );

  const resultRow = (r: ShopWatchCheckResult) => (
    <TableRow key={r.id} data-testid={`row-shop-watch-${r.id}`}>
      <TableCell className="align-top">{statusBadge(r.status)}</TableCell>
      <TableCell className="align-top">
        <div className="font-medium">{t(`shopWatch.kinds.${r.kind}`)}</div>
        <div className="text-xs text-muted-foreground">
          {r.url && run ? (
            <a href={`${run.shopUrl}${r.url}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {r.label}
              <ExternalLink className="h-3 w-3" aria-hidden="true" />
            </a>
          ) : (
            r.label
          )}
        </div>
      </TableCell>
      <TableCell className="align-top text-sm">
        {r.findings.length === 0 ? (
          <span className="text-muted-foreground">{t("shopWatch.noFindings")}</span>
        ) : (
          <ul className="space-y-1">
            {r.findings.map((f, i) => (
              <li key={i} className="flex gap-2">
                <StatusIcon status={f.severity} />
                <span className="break-words">{findingText(f)}</span>
              </li>
            ))}
          </ul>
        )}
      </TableCell>
      <TableCell className="align-top text-sm text-right whitespace-nowrap">
        {typeof r.count === "number" ? fmt.integer(r.count) : ""}
        {typeof r.count === "number" && data?.baseline?.counts[r.id] !== undefined ? (
          <div className="text-xs text-muted-foreground">{t("shopWatch.target", { n: fmt.integer(data.baseline.counts[r.id]) })}</div>
        ) : null}
      </TableCell>
      <TableCell className="align-top text-sm">
        <div>{t(`shopWatch.repair.${r.repair.mode}`)}</div>
        {r.repair.hint ? <div className="mt-1 text-xs text-muted-foreground">{r.repair.hint}</div> : null}
        {r.repair.command ? (
          <details className="mt-1">
            <summary className="cursor-pointer text-xs text-muted-foreground">{t("shopWatch.showCommand")}</summary>
            <code className="block mt-1 text-xs text-muted-foreground break-all select-all">{r.repair.command}</code>
          </details>
        ) : null}
        <ShopWatchRepairCell result={r} repair={data?.repairs?.[r.id]} running={!!data?.running} />
      </TableCell>
    </TableRow>
  );

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t("shopWatch.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("shopWatch.subtitle")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => baselineMutation.mutate()}
            disabled={!run || data?.running || baselineMutation.isPending}
            data-testid="button-shop-watch-baseline"
          >
            {baselineMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" />}
            {t("shopWatch.takeBaseline")}
          </Button>
          <Button onClick={() => runMutation.mutate()} disabled={data?.running || runMutation.isPending} data-testid="button-shop-watch-run">
            {data?.running || runMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
            {data?.running ? t("shopWatch.running") : t("shopWatch.runNow")}
          </Button>
        </div>
      </div>

      {data ? (
        <Card className="p-4 space-y-3" data-testid="shop-watch-schedule">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1 max-w-3xl">
              <h2 className="font-semibold flex items-center gap-2">
                <BellRing className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                {t("shopWatch.schedule.title")}
              </h2>
              <p className="text-xs text-muted-foreground">{t("shopWatch.schedule.description")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Switch
                id="shop-watch-enabled"
                checked={data.settings.enabled}
                disabled={settingsMutation.isPending}
                onCheckedChange={(enabled) => settingsMutation.mutate({ enabled })}
                data-testid="switch-shop-watch-enabled"
              />
              <Label htmlFor="shop-watch-enabled">{t("shopWatch.schedule.enable")}</Label>
            </div>
          </div>
          <ul className="text-sm space-y-1">
            <li className={data.schedule.teamsConfigured ? "" : "text-amber-700 dark:text-amber-300"} data-testid="text-shop-watch-teams">
              {data.schedule.teamsConfigured ? t("shopWatch.schedule.teamsOn") : t("shopWatch.schedule.teamsOff")}
              {data.schedule.teamsConfigured && data.schedule.teamsPending > 0
                ? ` ${t("shopWatch.schedule.teamsPending", { count: data.schedule.teamsPending })}`
                : null}
            </li>
            {data.settings.enabled ? (
              <li className="flex flex-wrap gap-x-6 gap-y-1 text-muted-foreground">
                <span>{t("shopWatch.schedule.lastFingerprint", { at: orNever(data.schedule.lastFingerprintAt) })}</span>
                <span>{t("shopWatch.schedule.lastFullRun", { at: orNever(data.schedule.lastFullRunAt) })}</span>
                {data.schedule.lastNotice ? (
                  <span data-testid="text-shop-watch-last-notice">
                    {t("shopWatch.schedule.lastNotice", {
                      at: date(data.schedule.lastNotice.at),
                      kind: t(`shopWatch.schedule.notice.${data.schedule.lastNotice.kind}`),
                    })}
                  </span>
                ) : null}
              </li>
            ) : null}
          </ul>
        </Card>
      ) : null}

      {query.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("shopWatch.loading")}
        </div>
      ) : query.isError ? (
        <Card className="p-4 text-sm text-destructive">{t("shopWatch.loadError")}</Card>
      ) : !run ? (
        <Card className="p-6 text-sm" data-testid="shop-watch-empty">
          {t("shopWatch.empty")}
        </Card>
      ) : (
        <>
          <Card className="p-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm" data-testid="shop-watch-summary">
            {statusBadge(run.status)}
            <span>{t("shopWatch.lastRun", { at: date(run.finishedAt), trigger: t(`shopWatch.trigger.${run.trigger}`) })}</span>
            <span className="text-muted-foreground">{run.shopUrl}</span>
            <span className="text-muted-foreground">
              {data?.baseline
                ? t("shopWatch.baselineInfo", { at: date(data.baseline.takenAt), categories: data.baseline.categories })
                : t("shopWatch.noBaseline")}
            </span>
          </Card>

          {run.deployChanges.length > 0 ? (
            <Card className="p-4 space-y-2 border-amber-400" role="status" data-testid="shop-watch-deploy">
              <h2 className="font-semibold flex items-center gap-2">
                {changeKind(run.deployChanges) === "themeRebuilt" ? (
                  <Paintbrush className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Rocket className="h-4 w-4" aria-hidden="true" />
                )}
                {changeKind(run.deployChanges) === "themeRebuilt" ? t("shopWatch.themeRebuiltBadge") : t("shopWatch.deployDetected")}
              </h2>
              {changeKind(run.deployChanges) === "themeRebuilt" ? (
                <p className="text-xs text-muted-foreground">{t("shopWatch.themeRebuiltHint")}</p>
              ) : null}
              <ul className="text-sm space-y-1">
                {run.deployChanges.map((c, i) => (
                  <li key={i} className="break-words">{changeText(c)}</li>
                ))}
              </ul>
            </Card>
          ) : null}

          {SHOP_WATCH_GROUPS.map((group) => {
            const rows = run.results.filter((r) => r.group === group);
            if (!rows.length) return null;
            return (
              <Card key={group} className="overflow-x-auto">
                <div className="px-4 pt-4">
                  <h2 className="font-semibold">{t(`shopWatch.groups.${group}.title`)}</h2>
                  <p className="text-xs text-muted-foreground">{t(`shopWatch.groups.${group}.hint`)}</p>
                </div>
                <Table data-testid={`shop-watch-table-${group}`}>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-28">{t("shopWatch.columns.status")}</TableHead>
                      <TableHead>{t("shopWatch.columns.check")}</TableHead>
                      <TableHead>{t("shopWatch.columns.findings")}</TableHead>
                      <TableHead className="text-right">{t("shopWatch.columns.count")}</TableHead>
                      <TableHead>{t("shopWatch.columns.repair")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>{rows.map(resultRow)}</TableBody>
                </Table>
              </Card>
            );
          })}

          {data && data.history.length > 1 ? (
            <Card className="p-4 space-y-2">
              <h2 className="font-semibold">{t("shopWatch.history")}</h2>
              <ul className="text-sm space-y-1" data-testid="shop-watch-history">
                {data.history.map((h) => (
                  <li key={h.startedAt} className="flex flex-wrap items-center gap-2">
                    <StatusIcon status={h.status} />
                    <span>{date(h.startedAt)}</span>
                    <span className="text-muted-foreground">{t(`shopWatch.trigger.${h.trigger}`)}</span>
                    <span className="text-muted-foreground">{t("shopWatch.historyCounts", { failed: h.failed, warned: h.warned })}</span>
                    {changeKind(h.deployChanges) === "deploy" ? <Badge variant="outline">{t("shopWatch.deployBadge")}</Badge> : null}
                    {changeKind(h.deployChanges) === "themeRebuilt" ? (
                      <Badge variant="outline" className="border-amber-400 text-amber-900 dark:text-amber-200">
                        {t("shopWatch.themeRebuiltBadge")}
                      </Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
