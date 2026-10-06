import { Fragment, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Copy, Loader2, RefreshCw, ScrollText, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest } from "@/lib/queryClient";
import { LOG_AREAS, type LogArea, type LogLevelName } from "@shared/logAreas";

/**
 * Systemprotokoll fuer Administratoren: Log-Eintraege des Servers (app_logs) nach Zeitraum, Stufe,
 * Bereich, Text, Benutzer und Anfrage filtern; Warnungen/Fehler je Bereich als Einstieg; Details mit
 * allen Feldern und Stacktrace. Aktiver Mandant plus Systemmeldungen (ohne Mandant).
 * Server: server/routes/logRoutes.ts.
 */

type LogEntry = {
  id: number;
  time: string;
  level: number;
  levelName: LogLevelName;
  area: LogArea;
  component: string | null;
  msg: string;
  tenantId: string | null;
  userId: string | null;
  userName: string | null;
  requestId: string | null;
  data: Record<string, any> | null;
};
type LogPage = { entries: LogEntry[]; nextBefore: number | null; from: string; retentionDays: number };
type StatsResponse = { since: string; areas: Array<{ area: LogArea; warn: number; error: number }>; totals: { warn: number; error: number } };

const PERIODS = ["1", "24", "168", "336"] as const;
const LEVELS = ["info", "warn", "error"] as const;
const ALL = "all";
const LIVE_MS = 10_000;

const levelVariant = (level: LogLevelName): "destructive" | "secondary" | "outline" =>
  level === "error" || level === "fatal" ? "destructive" : level === "warn" ? "secondary" : "outline";
const levelClass = (level: LogLevelName) =>
  level === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200" : "";

export default function SystemLogPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const timeFormat = useMemo(
    () => new Intl.DateTimeFormat(fmt.locale, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    [fmt.locale],
  );

  const [hours, setHours] = useState<(typeof PERIODS)[number]>("24");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("info");
  const [area, setArea] = useState<LogArea | typeof ALL>(ALL);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [requestId, setRequestId] = useState<string | null>(null);
  const [user, setUser] = useState<{ id: string; name: string } | null>(null);
  const [system, setSystem] = useState(true);
  const [live, setLive] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // Suche erst nach kurzer Pause abschicken
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 400);
    return () => clearTimeout(timer);
  }, [search]);

  const params = new URLSearchParams({ hours, level, system: system ? "1" : "0" });
  if (area !== ALL) params.set("areas", area);
  if (q) params.set("q", q);
  if (requestId) params.set("requestId", requestId);
  if (user) params.set("userId", user.id);
  const paramString = params.toString();

  const logsQuery = useInfiniteQuery<LogPage>({
    queryKey: ["/api/admin/logs", paramString],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const before = pageParam ? `&before=${pageParam}` : "";
      const res = await apiRequest("GET", `/api/admin/logs?${paramString}${before}`);
      return res.json();
    },
    getNextPageParam: (last) => last.nextBefore ?? undefined,
    refetchInterval: live ? LIVE_MS : false,
    retry: false,
  });

  const statsQuery = useQuery<StatsResponse>({
    queryKey: [`/api/admin/logs/stats?hours=${hours}&system=${system ? "1" : "0"}`],
    refetchInterval: live ? LIVE_MS : false,
    retry: false,
  });

  const entries = logsQuery.data?.pages.flatMap((page) => page.entries) ?? [];
  const retentionDays = logsQuery.data?.pages[0]?.retentionDays;

  const toggle = (id: number) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const copyEntry = async (entry: LogEntry) => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(entry, null, 2));
      toast({ title: t("systemLog.copied") });
    } catch {
      toast({ title: t("common.error"), variant: "destructive" });
    }
  };

  const showRequest = (id: string) => {
    setRequestId(id);
    setLevel("info");
    setArea(ALL);
  };

  const resetFilters = () => {
    setLevel("info");
    setArea(ALL);
    setSearch("");
    setRequestId(null);
    setUser(null);
  };

  const filtersActive = level !== "info" || area !== ALL || Boolean(q) || Boolean(requestId) || Boolean(user);
  const forbidden = (logsQuery.error as { status?: number } | null)?.status === 403;

  return (
    <div className="w-full space-y-4">
      <div>
        <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
          <ScrollText className="h-6 w-6 text-muted-foreground" />
          {t("systemLog.title")}
        </h1>
        <p className="text-sm text-muted-foreground">
          {t("systemLog.subtitle", { days: retentionDays ?? 14 })}
        </p>
      </div>

      {/* Einstieg: Warnungen und Fehler je Bereich */}
      {statsQuery.data && statsQuery.data.areas.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="system-log-stats">
          {statsQuery.data.areas.map((row) => (
            <button
              key={row.area}
              type="button"
              className={`rounded-md border px-2 py-1 text-xs hover:bg-muted ${area === row.area ? "border-primary" : ""}`}
              onClick={() => {
                setArea(row.area);
                setLevel(row.error > 0 ? "error" : "warn");
              }}
              data-testid={`system-log-stat-${row.area}`}
            >
              <span className="font-medium">{t(`systemLog.areas.${row.area}`)}</span>
              {row.error > 0 ? <span className="ml-2 text-destructive">{t("systemLog.errorsCount", { count: row.error })}</span> : null}
              {row.warn > 0 ? <span className="ml-2 text-amber-700 dark:text-amber-400">{t("systemLog.warningsCount", { count: row.warn })}</span> : null}
            </button>
          ))}
        </div>
      ) : statsQuery.data ? (
        <p className="text-xs text-muted-foreground" data-testid="system-log-stats-empty">{t("systemLog.noProblems")}</p>
      ) : null}

      <Card className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[180px] flex-1">
            <Label className="text-xs" htmlFor="system-log-period">{t("systemLog.period")}</Label>
            <Select value={hours} onValueChange={(value) => setHours(value as typeof hours)}>
              <SelectTrigger id="system-log-period" className="mt-1" data-testid="select-system-log-period">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((period) => (
                  <SelectItem key={period} value={period}>{t(`systemLog.periods.${period}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px] flex-1">
            <Label className="text-xs" htmlFor="system-log-level">{t("systemLog.level")}</Label>
            <Select value={level} onValueChange={(value) => setLevel(value as typeof level)}>
              <SelectTrigger id="system-log-level" className="mt-1" data-testid="select-system-log-level">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEVELS.map((name) => (
                  <SelectItem key={name} value={name}>{t(`systemLog.levels.${name}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[220px] flex-1">
            <Label className="text-xs" htmlFor="system-log-area">{t("systemLog.area")}</Label>
            <Select value={area} onValueChange={(value) => setArea(value as LogArea | typeof ALL)}>
              <SelectTrigger id="system-log-area" className="mt-1" data-testid="select-system-log-area">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>{t("systemLog.allAreas")}</SelectItem>
                {LOG_AREAS.map((id) => (
                  <SelectItem key={id} value={id}>{t(`systemLog.areas.${id}`)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[220px] flex-[2]">
            <Label className="text-xs" htmlFor="system-log-search">{t("systemLog.search")}</Label>
            <Input
              id="system-log-search"
              className="mt-1"
              value={search}
              placeholder={t("systemLog.searchPlaceholder")}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="input-system-log-search"
            />
          </div>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                void logsQuery.refetch();
                void statsQuery.refetch();
              }}
              disabled={logsQuery.isFetching}
              data-testid="button-system-log-refresh"
            >
              <RefreshCw className={`mr-2 h-4 w-4 ${logsQuery.isFetching ? "animate-spin" : ""}`} />
              {t("systemLog.refresh")}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-4 text-sm">
          <label className="flex items-center gap-2">
            <Switch checked={live} onCheckedChange={setLive} data-testid="switch-system-log-live" />
            {t("systemLog.live")}
          </label>
          <label className="flex items-center gap-2">
            <Switch checked={system} onCheckedChange={setSystem} data-testid="switch-system-log-system" />
            {t("systemLog.includeSystem")}
          </label>
          {requestId ? (
            <Badge variant="secondary" className="gap-1" data-testid="badge-system-log-request">
              {t("systemLog.requestFilter", { id: requestId.slice(0, 8) })}
              <button type="button" aria-label={t("systemLog.clearFilter")} onClick={() => setRequestId(null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : null}
          {user ? (
            <Badge variant="secondary" className="gap-1" data-testid="badge-system-log-user">
              {t("systemLog.userFilter", { name: user.name })}
              <button type="button" aria-label={t("systemLog.clearFilter")} onClick={() => setUser(null)}>
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ) : null}
          {filtersActive ? (
            <Button type="button" variant="ghost" size="sm" onClick={resetFilters} data-testid="button-system-log-reset">
              {t("systemLog.resetFilters")}
            </Button>
          ) : null}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {logsQuery.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : logsQuery.error ? (
          <p className="p-4 text-sm text-destructive" role="alert" data-testid="text-system-log-error">
            {forbidden ? t("systemLog.adminOnly") : (logsQuery.error as Error).message}
          </p>
        ) : entries.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="text-system-log-empty">{t("systemLog.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            {/* feste Spaltenbreiten: lange Stacktraces/JSON brechen um statt die Tabelle zu verbreitern;
                auf schmalen Bildschirmen scrollt nur die Tabelle seitlich */}
            <table className="w-full min-w-[560px] table-fixed text-sm" data-testid="table-system-log">
              <colgroup>
                <col className="w-8" />
                <col className="w-32" />
                <col className="w-24" />
                <col />
              </colgroup>
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-2 py-2" />
                  <th className="px-2 py-2 whitespace-nowrap">{t("systemLog.columns.time")}</th>
                  <th className="px-2 py-2">{t("systemLog.columns.level")}</th>
                  <th className="px-2 py-2">{t("systemLog.columns.message")}</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const open = expanded.has(entry.id);
                  const stack = typeof entry.data?.err?.stack === "string" ? entry.data.err.stack : null;
                  return (
                    <Fragment key={entry.id}>
                      <tr
                        className="border-t align-top hover:bg-muted/30 cursor-pointer"
                        onClick={() => toggle(entry.id)}
                        data-testid={`row-system-log-${entry.id}`}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </td>
                        <td className="px-2 py-1.5 whitespace-nowrap font-mono text-xs">{timeFormat.format(new Date(entry.time))}</td>
                        <td className="px-2 py-1.5">
                          <Badge variant={levelVariant(entry.levelName)} className={levelClass(entry.levelName)}>
                            {t(`systemLog.levelNames.${entry.levelName}`)}
                          </Badge>
                        </td>
                        <td className="px-2 py-1.5 [overflow-wrap:anywhere]">
                          <div>
                            {entry.msg}
                            {entry.data?.err?.message && !entry.msg.includes(entry.data.err.message) ? (
                              <span className="text-destructive"> – {entry.data.err.message}</span>
                            ) : null}
                          </div>
                          {/* Bereich und Benutzer als zweite Zeile: die Meldung bekommt die Breite */}
                          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                            <span data-testid={`area-system-log-${entry.id}`}>{t(`systemLog.areas.${entry.area}`, { defaultValue: entry.area })}</span>
                            {entry.userId ? (
                              <button
                                type="button"
                                className="underline decoration-dotted"
                                aria-label={t("systemLog.userFilter", { name: entry.userName ?? entry.userId })}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setUser({ id: entry.userId!, name: entry.userName ?? entry.userId! });
                                }}
                              >
                                {entry.userName ?? entry.userId.slice(0, 8)}
                              </button>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="bg-muted/20" data-testid={`details-system-log-${entry.id}`}>
                          <td />
                          <td colSpan={3} className="px-2 pb-3 pt-1 text-xs">
                            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1">
                              <dt className="text-muted-foreground">{t("systemLog.details.module")}</dt>
                              <dd className="font-mono">{entry.component ?? "–"}</dd>
                              <dt className="text-muted-foreground">{t("systemLog.details.scope")}</dt>
                              <dd>{entry.tenantId ? t("systemLog.details.tenant") : t("systemLog.details.system")}</dd>
                              {entry.requestId ? (
                                <>
                                  <dt className="text-muted-foreground">{t("systemLog.details.request")}</dt>
                                  <dd className="flex flex-wrap items-center gap-2">
                                    <span className="font-mono [overflow-wrap:anywhere]">{entry.requestId}</span>
                                    <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => showRequest(entry.requestId!)}>
                                      {t("systemLog.details.showRequest")}
                                    </Button>
                                  </dd>
                                </>
                              ) : null}
                            </dl>
                            {stack ? (
                              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]" data-testid={`stack-system-log-${entry.id}`}>
                                {stack}
                              </pre>
                            ) : null}
                            {entry.data ? (
                              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap [overflow-wrap:anywhere]">
                                {JSON.stringify(entry.data, null, 2)}
                              </pre>
                            ) : null}
                            <Button type="button" size="sm" variant="ghost" className="mt-1 h-7 text-xs" onClick={() => copyEntry(entry)}>
                              <Copy className="mr-1 h-3 w-3" />
                              {t("systemLog.copy")}
                            </Button>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {logsQuery.hasNextPage ? (
          <div className="border-t p-3 text-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => logsQuery.fetchNextPage()}
              disabled={logsQuery.isFetchingNextPage}
              data-testid="button-system-log-more"
            >
              {logsQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("systemLog.more")}
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
