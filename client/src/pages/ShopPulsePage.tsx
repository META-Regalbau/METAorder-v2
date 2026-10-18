import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, BellOff, BellRing, CheckCircle2, Download, Loader2, MessageSquare, PauseCircle, Play, Send, ShoppingCart, Sparkles, Target, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShopPulseCartTab } from "@/components/shopPulse/ShopPulseCartTab";
import { ShopPulseActionsTab } from "@/components/shopPulse/ShopPulseActionsTab";
import { ShopPulseWeeklyTab } from "@/components/shopPulse/ShopPulseWeeklyTab";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { isAllowedTeamsWebhookUrl } from "@shared/emailIntake";
import { formatShopPulseParams, needsAiNote, SHOP_PULSE_DETECTOR_IDS, type ShopPulseOverview, type ShopPulseSeverity, type ShopPulseSignal } from "@shared/shopPulse";

/**
 * Shop-Puls (nur Administratoren): Meldungen zu dem, was im Onlineshop nicht gut läuft, Einstellungen
 * (Ein/Aus, Lernwoche, Teams-Direktnachricht, KI-Texte), Prüfungen. Je Meldung der KI-Text (deutsch, wie in
 * Teams), falls einer zur jetzigen Schwere vorliegt, sonst der Vorlagentext. Links aus Teams öffnen die Seite mit
 * ?signal=<id> (Zeile hervorgehoben) und &action=mute (Rückfrage zum Ruhigstellen).
 * Server: server/routes/shopPulseRoutes.ts, Konzept Shop-Puls Stufe 1 (17.10.2026).
 *
 * Stufe 2 (S2-1): Reiter „Wochenberichte“ (Archiv, ?tab=weekly&week=<Montag> aus Teams) und
 * „Maßnahmen-Protokoll“ (?tab=actions), components/shopPulse/. Stufe 2 (S2-3): Reiter „Warenkorb-Alarm“
 * (?tab=cart).
 */

const TABS = ["signals", "weekly", "actions", "cart"] as const;
type Tab = (typeof TABS)[number];

const QUERY_KEY = ["/api/shop-pulse"];

function SeverityBadge({ severity, label }: { severity: ShopPulseSeverity; label: string }) {
  return severity === "critical" ? (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  ) : (
    <Badge variant="outline" className="gap-1 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
      <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </Badge>
  );
}

export default function ShopPulsePage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const search = useSearch();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(search);
  const focusId = params.get("signal");
  const [confirmMuteId, setConfirmMuteId] = useState<string | null>(params.get("action") === "mute" ? focusId : null);
  const [webhook, setWebhook] = useState("");
  const tabParam = params.get("tab");
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "signals");
  const changeTab = (next: string) => {
    setTab(next as Tab);
    navigate(next === "signals" ? "/admin/shop-puls" : `/admin/shop-puls?tab=${next}`, { replace: true });
  };

  const query = useQuery<ShopPulseOverview>({ queryKey: QUERY_KEY });
  const data = query.data;

  // Aus Teams: zur Rückfrage (ruhig stellen) bzw. zur Meldung springen, einmal nach dem Laden
  const loaded = !!data;
  useEffect(() => {
    if (!focusId || !loaded) return;
    const target = confirmMuteId ? "shop-pulse-confirm-mute-card" : `shop-pulse-signal-${focusId}`;
    document.getElementById(target)?.scrollIntoView({ block: "center" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, loaded]);

  const refresh = (next?: ShopPulseOverview) => {
    if (next) queryClient.setQueryData(QUERY_KEY, next);
    else queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const settingsMutation = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PUT", "/api/shop-pulse/settings", body)).json() as Promise<ShopPulseOverview>,
    onSuccess: (next) => {
      refresh(next);
      setWebhook("");
      toast({ title: t("shopPulse.settings.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.settings.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const runMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/run")).json() as Promise<ShopPulseOverview>,
    onSuccess: (next) => {
      refresh(next);
      toast({ title: t("shopPulse.runDone") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.runFailed"), description: error.message, variant: "destructive" }),
  });
  const testMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/test-message")).json() as Promise<ShopPulseOverview>,
    onSuccess: (next) => {
      refresh(next);
      toast({ title: t("shopPulse.settings.testQueued") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.settings.testFailed"), description: error.message, variant: "destructive" }),
  });
  const [confirmBaseline, setConfirmBaseline] = useState(false);
  const baselineMutation = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/buyability/baseline")).json() as Promise<ShopPulseOverview>,
    onSuccess: (next) => {
      refresh(next);
      setConfirmBaseline(false);
      toast({ title: t("shopPulse.buyability.baselineSaved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.buyability.baselineFailed"), description: error.message, variant: "destructive" }),
  });
  const signalMutation = useMutation({
    mutationFn: async (a: { id: string; action: "resolve" } | { id: string; action: "mute"; days: number }) =>
      apiRequest("POST", `/api/shop-pulse/signals/${encodeURIComponent(a.id)}/${a.action}`, a.action === "mute" ? { days: a.days } : undefined),
    onSuccess: (_res, a) => {
      refresh();
      setConfirmMuteId(null);
      toast({ title: a.action === "resolve" ? t("shopPulse.signals.resolvedToast") : a.days > 0 ? t("shopPulse.signals.mutedToast") : t("shopPulse.signals.unmutedToast") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.signals.actionFailed"), description: error.message, variant: "destructive" }),
  });

  const signalParams = (s: ShopPulseSignal) =>
    formatShopPulseParams(s.code, s.params, { money: (v) => fmt.currencyWhole(v), date: (d) => fmt.date(`${d}T12:00:00`), number: (v) => fmt.integer(v), percent: (v) => fmt.percentValue(v, 1) });
  const title = (s: ShopPulseSignal) => t(`shopPulse.codes.${s.code}.title`, signalParams(s));
  const message = (s: ShopPulseSignal) => t(`shopPulse.codes.${s.code}.message`, signalParams(s));
  // Die Datenbank (jsonb) sortiert die Schlüssel um; angezeigt wird in Lauf-Reihenfolge
  const detectorRank = (id: string) => {
    const i = (SHOP_PULSE_DETECTOR_IDS as readonly string[]).indexOf(id);
    return i === -1 ? SHOP_PULSE_DETECTOR_IDS.length : i;
  };
  // GA4 nicht eingerichtet: Grund aus dem letzten Lauf einer GA4-Prüfung
  const ga4Problem = Object.values(data?.state.detectors ?? {}).find((d) => d.skipped === "ga4")?.ga4Problem;
  const muted = (s: ShopPulseSignal) => !!s.mutedUntil && Date.parse(s.mutedUntil) > Date.now();
  const webhookValid = webhook.trim() !== "" && isAllowedTeamsWebhookUrl(webhook.trim());
  const busy = settingsMutation.isPending;

  const closeConfirm = () => {
    setConfirmMuteId(null);
    if (params.get("action")) navigate(`/admin/shop-puls${focusId ? `?signal=${encodeURIComponent(focusId)}` : ""}`, { replace: true });
  };
  const confirmSignal = confirmMuteId ? data?.signals.find((s) => s.id === confirmMuteId) : undefined;

  /** KI-Notiz zur jetzigen Schwere (Text oder verworfener Versuch); ältere Notizen gelten nicht mehr */
  const aiNoteOf = (s: ShopPulseSignal) => (s.aiNote && !needsAiNote(s) ? s.aiNote : null);
  const lossLine = (s: ShopPulseSignal) => {
    if (s.lossPerHour) return t("shopPulse.signals.loss", { amount: fmt.currencyWhole(s.lossPerHour) });
    const e = aiNoteOf(s)?.lossEstimate;
    return e ? t("shopPulse.signals.lossEstimate", { amount: fmt.currencyWhole(e.perHour), basis: t(`shopPulse.lossBasis.${e.basis}`) }) : null;
  };

  const signalRow = (s: ShopPulseSignal) => (
    <TableRow key={s.id} id={`shop-pulse-signal-${s.id}`} className={s.id === focusId ? "bg-muted/60" : ""} data-testid={`row-shop-pulse-${s.id}`}>
      <TableCell className="align-top">
        <SeverityBadge severity={s.severity} label={t(`shopPulse.severity.${s.severity}`)} />
      </TableCell>
      <TableCell className="align-top">
        <div className="font-medium">{title(s)}</div>
        <div className="text-sm text-muted-foreground break-words max-w-2xl">{message(s)}</div>
        {aiNoteOf(s)?.text ? (
          <div className="mt-2 max-w-2xl rounded-md border bg-muted/40 p-2 text-sm" lang="de" data-testid={`text-shop-pulse-ai-${s.id}`}>
            <div className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              {t("shopPulse.signals.aiText", { at: fmt.dateTime(aiNoteOf(s)!.at) })}
            </div>
            <p className="whitespace-pre-line break-words">{aiNoteOf(s)!.text}</p>
          </div>
        ) : aiNoteOf(s)?.rejected ? (
          <div className="mt-1 text-xs text-muted-foreground" data-testid={`text-shop-pulse-ai-rejected-${s.id}`}>
            {t("shopPulse.signals.aiRejected", { at: fmt.dateTime(aiNoteOf(s)!.at), reason: t(`shopPulse.signals.aiRejections.${aiNoteOf(s)!.rejected}`) })}
          </div>
        ) : null}
        <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
          <span>{t(`shopPulse.source.${s.source}`)}</span>
          {lossLine(s) ? <span>{lossLine(s)}</span> : null}
        </div>
      </TableCell>
      <TableCell className="align-top text-sm whitespace-nowrap">
        <div>{fmt.dateTime(s.firstSeenAt)}</div>
        <div className="text-xs text-muted-foreground">{t("shopPulse.signals.lastSeen", { at: fmt.dateTime(s.lastSeenAt) })}</div>
      </TableCell>
      <TableCell className="align-top text-sm">
        <div>{t(`shopPulse.status.${s.status}`)}</div>
        {s.status === "resolved" && s.resolvedAt ? (
          <div className="text-xs text-muted-foreground">
            {s.resolvedBy
              ? t("shopPulse.signals.resolvedBy", { name: s.resolvedBy, at: fmt.dateTime(s.resolvedAt) })
              : t("shopPulse.signals.resolvedAt", { at: fmt.dateTime(s.resolvedAt) })}
          </div>
        ) : null}
        {muted(s) ? <div className="text-xs text-muted-foreground">{t("shopPulse.signals.mutedUntil", { at: fmt.dateTime(s.mutedUntil) })}</div> : null}
      </TableCell>
      <TableCell className="align-top">
        <div className="flex flex-wrap gap-2">
          {s.status === "open" ? (
            <Button size="sm" variant="outline" disabled={signalMutation.isPending} onClick={() => signalMutation.mutate({ id: s.id, action: "resolve" })} data-testid={`button-shop-pulse-resolve-${s.id}`}>
              <CheckCircle2 className="h-4 w-4 mr-1" aria-hidden="true" />
              {t("shopPulse.signals.resolve")}
            </Button>
          ) : null}
          {muted(s) ? (
            <Button size="sm" variant="ghost" disabled={signalMutation.isPending} onClick={() => signalMutation.mutate({ id: s.id, action: "mute", days: 0 })} data-testid={`button-shop-pulse-unmute-${s.id}`}>
              <BellRing className="h-4 w-4 mr-1" aria-hidden="true" />
              {t("shopPulse.signals.unmute")}
            </Button>
          ) : s.status === "open" ? (
            <>
              <Button size="sm" variant="ghost" disabled={signalMutation.isPending} onClick={() => signalMutation.mutate({ id: s.id, action: "mute", days: 1 })} data-testid={`button-shop-pulse-mute1-${s.id}`}>
                <BellOff className="h-4 w-4 mr-1" aria-hidden="true" />
                {t("shopPulse.signals.mute1")}
              </Button>
              <Button size="sm" variant="ghost" disabled={signalMutation.isPending} onClick={() => signalMutation.mutate({ id: s.id, action: "mute", days: 7 })} data-testid={`button-shop-pulse-mute7-${s.id}`}>
                <BellOff className="h-4 w-4 mr-1" aria-hidden="true" />
                {t("shopPulse.signals.mute7")}
              </Button>
            </>
          ) : null}
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <div className="w-full space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold mb-1 flex items-center gap-2">
            <Activity className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t("shopPulse.title")}
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">{t("shopPulse.subtitle")}</p>
        </div>
        <Button onClick={() => runMutation.mutate()} disabled={runMutation.isPending || data?.running} data-testid="button-shop-pulse-run">
          {runMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Play className="h-4 w-4 mr-2" />}
          {runMutation.isPending ? t("shopPulse.running") : t("shopPulse.runNow")}
        </Button>
      </div>

      {confirmSignal ? (
        <Card id="shop-pulse-confirm-mute-card" className="p-4 flex flex-wrap items-center justify-between gap-3 border-amber-400" role="alertdialog" aria-labelledby="shop-pulse-confirm-mute" data-testid="shop-pulse-confirm-mute">
          <div>
            <div id="shop-pulse-confirm-mute" className="font-medium">{t("shopPulse.signals.confirmMute")}</div>
            <div className="text-sm text-muted-foreground">{title(confirmSignal)}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={closeConfirm} data-testid="button-shop-pulse-confirm-cancel">
              {t("shopPulse.signals.cancel")}
            </Button>
            <Button
              disabled={signalMutation.isPending}
              onClick={() => signalMutation.mutate({ id: confirmSignal.id, action: "mute", days: 7 }, { onSuccess: closeConfirm })}
              data-testid="button-shop-pulse-confirm-mute"
            >
              <BellOff className="h-4 w-4 mr-2" aria-hidden="true" />
              {t("shopPulse.signals.confirmMuteButton")}
            </Button>
          </div>
        </Card>
      ) : null}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          {TABS.map((id) => (
            <TabsTrigger key={id} value={id} data-testid={`tab-shop-pulse-${id}`}>
              {t(`shopPulse.tabs.${id}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="weekly" className="mt-4">
          {tab === "weekly" ? <ShopPulseWeeklyTab initialWeek={params.get("week")} /> : null}
        </TabsContent>
        <TabsContent value="actions" className="mt-4">
          {tab === "actions" ? <ShopPulseActionsTab /> : null}
        </TabsContent>
        <TabsContent value="cart" className="mt-4">
          {tab === "cart" ? <ShopPulseCartTab /> : null}
        </TabsContent>
        <TabsContent value="signals" className="mt-4 space-y-4">
          {query.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("shopPulse.loading")}
            </div>
          ) : query.isError || !data ? (
            <Card className="p-4 text-sm text-destructive">{t("shopPulse.loadError")}</Card>
          ) : (
            <>
              <Card className="p-4 space-y-4" data-testid="shop-pulse-settings">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1 max-w-3xl">
                    <h2 className="font-semibold">{t("shopPulse.settings.title")}</h2>
                    <p className="text-xs text-muted-foreground">{t("shopPulse.settings.enableHint")}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="shop-pulse-enabled"
                      checked={data.settings.enabled}
                      disabled={busy}
                      onCheckedChange={(enabled) => settingsMutation.mutate({ enabled })}
                      data-testid="switch-shop-pulse-enabled"
                    />
                    <Label htmlFor="shop-pulse-enabled">{t("shopPulse.settings.enable")}</Label>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="text-shop-pulse-learning">
                  {data.learning && data.settings.learningUntil ? (
                    <>
                      <span>{t("shopPulse.settings.learning", { date: fmt.dateTime(data.settings.learningUntil) })}</span>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => settingsMutation.mutate({ endLearning: true })} data-testid="button-shop-pulse-end-learning">
                        {t("shopPulse.settings.learningEnd")}
                      </Button>
                    </>
                  ) : data.settings.learningUntil ? (
                    <span className="text-muted-foreground">{t("shopPulse.settings.learningOver", { date: fmt.dateTime(data.settings.learningUntil) })}</span>
                  ) : (
                    <span className="text-muted-foreground">{t("shopPulse.settings.learningPending")}</span>
                  )}
                </div>

                <div className="space-y-2 border-t pt-4">
                  <h3 className="font-medium flex items-center gap-2">
                    <MessageSquare className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {t("shopPulse.settings.teamsTitle")}
                  </h3>
                  <p className={`text-sm ${data.settings.teamsConfigured ? "" : "text-amber-700 dark:text-amber-300"}`} data-testid="text-shop-pulse-teams">
                    {data.settings.teamsConfigured ? t("shopPulse.settings.teamsOn") : t("shopPulse.settings.teamsOff")}
                    {data.teamsPending > 0 ? ` ${t("shopPulse.settings.teamsPending", { count: data.teamsPending })}` : null}
                  </p>
                  <form
                    className="flex flex-wrap items-end gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (webhookValid) settingsMutation.mutate({ teamsWebhookUrl: webhook.trim() });
                    }}
                  >
                    <div className="space-y-1 min-w-0 flex-1 basis-80">
                      <Label htmlFor="shop-pulse-webhook">{t("shopPulse.settings.webhookLabel")}</Label>
                      <Input
                        id="shop-pulse-webhook"
                        type="url"
                        value={webhook}
                        placeholder={t("shopPulse.settings.webhookPlaceholder")}
                        onChange={(e) => setWebhook(e.target.value)}
                        aria-invalid={webhook.trim() !== "" && !webhookValid}
                        aria-describedby="shop-pulse-webhook-help"
                        autoComplete="off"
                        data-testid="input-shop-pulse-webhook"
                      />
                    </div>
                    <Button type="submit" disabled={!webhookValid || busy} data-testid="button-shop-pulse-webhook-save">
                      {t("shopPulse.settings.webhookSave")}
                    </Button>
                    {data.settings.teamsConfigured ? (
                      <>
                        <Button type="button" variant="outline" disabled={testMutation.isPending} onClick={() => testMutation.mutate()} data-testid="button-shop-pulse-test">
                          {testMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" aria-hidden="true" />}
                          {t("shopPulse.settings.test")}
                        </Button>
                        <Button type="button" variant="ghost" disabled={busy} onClick={() => settingsMutation.mutate({ teamsWebhookUrl: "" })} data-testid="button-shop-pulse-webhook-remove">
                          {t("shopPulse.settings.webhookRemove")}
                        </Button>
                      </>
                    ) : null}
                  </form>
                  {webhook.trim() !== "" && !webhookValid ? <p className="text-xs text-destructive">{t("shopPulse.settings.webhookInvalid")}</p> : null}
                  <p id="shop-pulse-webhook-help" className="text-xs text-muted-foreground max-w-3xl">
                    {t("shopPulse.settings.webhookHelp")}
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <Switch
                      id="shop-pulse-watch-direct"
                      checked={data.settings.shopWatchDirect}
                      disabled={busy}
                      onCheckedChange={(shopWatchDirect) => settingsMutation.mutate({ shopWatchDirect })}
                      data-testid="switch-shop-pulse-watch-direct"
                    />
                    <Label htmlFor="shop-pulse-watch-direct">{t("shopPulse.settings.shopWatchDirect")}</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">{t("shopPulse.settings.shopWatchDirectHint")}</p>
                </div>

                <div className="space-y-2 border-t pt-4" data-testid="shop-pulse-ai">
                  <h3 className="font-medium flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    {t("shopPulse.settings.aiTitle")}
                  </h3>
                  <div className="flex items-center gap-2">
                    <Switch
                      id="shop-pulse-ai-texts"
                      checked={data.aiConfigured && data.settings.aiTexts}
                      disabled={busy || !data.aiConfigured}
                      onCheckedChange={(aiTexts) => settingsMutation.mutate({ aiTexts })}
                      aria-describedby="shop-pulse-ai-hint"
                      data-testid="switch-shop-pulse-ai-texts"
                    />
                    <Label htmlFor="shop-pulse-ai-texts">{t("shopPulse.settings.aiEnable")}</Label>
                  </div>
                  {!data.aiConfigured ? (
                    <p className="text-sm text-amber-700 dark:text-amber-300" data-testid="text-shop-pulse-ai-missing">
                      {t("shopPulse.settings.aiNoProvider")}
                    </p>
                  ) : null}
                  <p id="shop-pulse-ai-hint" className="text-xs text-muted-foreground max-w-3xl">
                    {t("shopPulse.settings.aiHint")}
                  </p>
                </div>
              </Card>

              <Card className="overflow-x-auto">
                <div className="px-4 pt-4">
                  <h2 className="font-semibold">{t("shopPulse.signals.title")}</h2>
                  <p className="text-xs text-muted-foreground">{t("shopPulse.signals.resolveHint")}</p>
                </div>
                {data.signals.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground" data-testid="shop-pulse-empty">
                    {t("shopPulse.signals.empty")}
                  </p>
                ) : (
                  <Table data-testid="shop-pulse-signals">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-28">{t("shopPulse.signals.columns.severity")}</TableHead>
                        <TableHead>{t("shopPulse.signals.columns.signal")}</TableHead>
                        <TableHead>{t("shopPulse.signals.columns.since")}</TableHead>
                        <TableHead>{t("shopPulse.signals.columns.status")}</TableHead>
                        <TableHead>{t("shopPulse.signals.columns.actions")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>{data.signals.map(signalRow)}</TableBody>
                  </Table>
                )}
              </Card>

              <Card className="p-4 space-y-2">
                <h2 className="font-semibold">{t("shopPulse.detectors.title")}</h2>
                {data.state.lastTickAt ? <p className="text-xs text-muted-foreground">{t("shopPulse.detectors.lastRun", { at: fmt.dateTime(data.state.lastTickAt) })}</p> : null}
                {data.state.detectors && Object.keys(data.state.detectors).length ? (
                  <ul className="text-sm space-y-1" data-testid="shop-pulse-detectors">
                    {Object.entries(data.state.detectors)
                      .sort(([a], [b]) => detectorRank(a) - detectorRank(b))
                      .map(([id, d]) => (
                        <li key={id} className="flex flex-wrap items-center gap-2">
                          {d.skipped ? (
                            <PauseCircle className="h-4 w-4 text-amber-600" aria-hidden="true" />
                          ) : d.ok ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" aria-hidden="true" />
                          ) : (
                            <XCircle className="h-4 w-4 text-destructive" aria-hidden="true" />
                          )}
                          <span>{t(`shopPulse.detectors.names.${id}`, { defaultValue: id })}</span>
                          <span className="text-muted-foreground">{fmt.dateTime(d.at)} ·</span>
                          <span className="text-muted-foreground">
                            {d.skipped === "ga4"
                              ? t("shopPulse.detectors.skippedGa4")
                              : d.skipped
                              ? t(d.skipped === "busy" ? "shopPulse.detectors.skippedBusy" : "shopPulse.detectors.skipped")
                              : d.ok
                                ? `${t("shopPulse.detectors.ok")} · ${t("shopPulse.detectors.findings", { count: d.findings })}`
                                : t("shopPulse.detectors.failed", { error: d.error ?? "" })}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">{t("shopPulse.detectors.none")}</p>
                )}
                {ga4Problem ? (
                  <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40" role="note" data-testid="shop-pulse-ga4-setup">
                    <p className="font-medium">{t("shopPulse.ga4Setup.title")}</p>
                    <p>{t(`shopPulse.ga4Setup.problems.${ga4Problem}`)}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("shopPulse.ga4Setup.hint")}</p>
                  </div>
                ) : null}
              </Card>

              <Card className="p-4 space-y-3" data-testid="shop-pulse-buyability">
                <h2 className="font-semibold flex items-center gap-2">
                  <ShoppingCart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  {t("shopPulse.buyability.title")}
                </h2>
                <p className="text-sm" data-testid="text-shop-pulse-baseline">
                  {data.buyabilityBaseline
                    ? t("shopPulse.buyability.baseline", {
                        at: fmt.dateTime(data.buyabilityBaseline.takenAt),
                        products: fmt.integer(data.buyabilityBaseline.products),
                        payment: data.buyabilityBaseline.paymentMethods,
                        shipping: data.buyabilityBaseline.shippingMethods,
                      })
                    : t("shopPulse.buyability.noBaseline")}
                </p>
                <p className="text-xs text-muted-foreground max-w-3xl">{t("shopPulse.buyability.baselineHint")}</p>
                {confirmBaseline ? (
                  <div className="flex flex-wrap items-center gap-2" role="group" aria-labelledby="shop-pulse-baseline-confirm">
                    <span id="shop-pulse-baseline-confirm" className="text-sm font-medium">
                      {t("shopPulse.buyability.confirm")}
                    </span>
                    <Button size="sm" disabled={baselineMutation.isPending} onClick={() => baselineMutation.mutate()} data-testid="button-shop-pulse-baseline-confirm">
                      {baselineMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Target className="h-4 w-4 mr-2" aria-hidden="true" />}
                      {t("shopPulse.buyability.takeBaseline")}
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setConfirmBaseline(false)} data-testid="button-shop-pulse-baseline-cancel">
                      {t("shopPulse.signals.cancel")}
                    </Button>
                  </div>
                ) : (
                  <Button size="sm" variant="outline" disabled={data.running} onClick={() => setConfirmBaseline(true)} data-testid="button-shop-pulse-baseline">
                    <Target className="h-4 w-4 mr-2" aria-hidden="true" />
                    {t("shopPulse.buyability.takeBaseline")}
                  </Button>
                )}

                <div className="border-t pt-3 space-y-2">
                  <h3 className="font-medium">{t("shopPulse.buyability.gapsTitle")}</h3>
                  {data.dataGaps ? (
                    <>
                      <p className="text-sm" data-testid="text-shop-pulse-gaps">
                        {t("shopPulse.buyability.gaps", {
                          at: fmt.dateTime(data.dataGaps.at),
                          noImage: fmt.integer(data.dataGaps.counts.noImage ?? 0),
                          noCategory: fmt.integer(data.dataGaps.counts.noCategory ?? 0),
                          salesUnit: fmt.integer(data.dataGaps.counts.salesUnit ?? 0),
                        })}
                      </p>
                      <Button size="sm" variant="outline" asChild>
                        <a href="/api/shop-pulse/data-gaps.csv" download data-testid="link-shop-pulse-gaps-csv">
                          <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                          {t("shopPulse.buyability.gapsDownload")}
                        </a>
                      </Button>
                    </>
                  ) : (
                    <p className="text-sm text-muted-foreground">{t("shopPulse.buyability.gapsNone")}</p>
                  )}
                  <p className="text-xs text-muted-foreground max-w-3xl">{t("shopPulse.buyability.gapsHint")}</p>
                </div>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
