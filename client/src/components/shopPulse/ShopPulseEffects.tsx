import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  SHOP_PULSE_EFFECT_METRICS,
  SHOP_PULSE_EFFECT_RULES,
  type ShopPulseActionEffect,
  type ShopPulseEffectMetric,
  type ShopPulseEffectVerdict,
  type ShopPulseEffectWindow,
  type ShopPulseEffectsOverview,
  type ShopPulseWeeklyEffect,
} from "@shared/shopPulseEffects";

/**
 * Shop-Puls, Wirkung messen (Stufe 2, S2-6): Einstufung je Maßnahme im Maßnahmen-Protokoll (Abzeichen und
 * aufklappbare Einzelheiten), Kopf mit Regeln und „Neu berechnen“, Karte „Gesicherte Wirkung“ im
 * Wochenbericht. Regeln in shared/shopPulseEffects.ts, Server: server/shopPulse/effects*.ts.
 */

export const EFFECTS_QUERY_KEY = ["/api/shop-pulse/effects"];

export function useShopPulseEffects() {
  return useQuery<ShopPulseEffectsOverview>({ queryKey: EFFECTS_QUERY_KEY });
}

const VERDICT_CLASS: Record<ShopPulseEffectVerdict, string> = {
  sure: "border-emerald-600 text-emerald-800 dark:text-emerald-300",
  unsure: "border-amber-600 text-amber-800 dark:text-amber-300",
  notMeasurable: "text-muted-foreground",
  pending: "text-muted-foreground",
};

function useSigned() {
  const fmt = useLocaleFormat();
  return {
    money: (v: number) => `${v > 0 ? "+" : ""}${fmt.currencyWhole(v)}`,
    percent: (v: number | null) => (v == null ? "–" : `${v > 0 ? "+" : ""}${fmt.percentValue(v, 1)}`),
    number: (v: number) => `${v > 0 ? "+" : ""}${fmt.decimal(v, 1)}`,
  };
}

/** Haupt-Wirkung des Zeitraums der Einstufung, z. B. „+1.800 € Deckungsbeitrag (+12 %)“ */
function headlineMetric(effect: ShopPulseActionEffect): { w: ShopPulseEffectWindow; m: ShopPulseEffectMetric } | null {
  const w = effect.windows.find((x) => x.days === effect.headlineDays);
  const m = w?.metrics[w.main];
  return w && m ? { w, m } : null;
}

export function ShopPulseEffectBadge({ effect }: { effect: ShopPulseActionEffect | undefined }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const signed = useSigned();
  if (!effect) return <span className="text-xs text-muted-foreground">{t("shopPulse.effects.notComputed")}</span>;
  const head = headlineMetric(effect);
  const pendingUntil = effect.windows[0]?.post.to;
  return (
    <div className="space-y-1" data-testid={`shop-pulse-effect-${effect.actionId}`}>
      <Badge variant="outline" className={VERDICT_CLASS[effect.verdict]}>
        {t(`shopPulse.effects.verdicts.${effect.verdict}`)}
      </Badge>
      {head && effect.verdict !== "notMeasurable" ? (
        <div className="text-xs">
          {t("shopPulse.effects.headline", {
            amount: signed.money(head.m.effect),
            metric: t(`shopPulse.effects.metrics.${head.w.main}`),
            percent: signed.percent(head.m.effectPercent),
            days: head.w.days,
          })}
        </div>
      ) : null}
      {effect.verdict === "pending" && pendingUntil ? <div className="text-xs text-muted-foreground">{t("shopPulse.effects.pendingUntil", { date: fmt.date(pendingUntil) })}</div> : null}
    </div>
  );
}

function MetricRow({ id, m }: { id: string; m: ShopPulseEffectMetric | null }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const signed = useSigned();
  if (!m) return null;
  const value = (v: number) => (id === "orders" ? fmt.integer(v) : fmt.currencyWhole(v));
  return (
    <TableRow>
      <TableCell>{t(`shopPulse.effects.metrics.${id}`)}</TableCell>
      <TableCell className="text-right">{value(m.pre)}</TableCell>
      <TableCell className="text-right">{value(m.post)}</TableCell>
      <TableCell className="text-right">{value(m.expected)}</TableCell>
      <TableCell className="text-right whitespace-nowrap">
        {id === "orders" ? signed.number(m.effect) : signed.money(m.effect)} ({signed.percent(m.effectPercent)})
      </TableCell>
      <TableCell className="text-right">{m.z == null ? "–" : fmt.decimal(m.z, 1)}</TableCell>
      <TableCell className="text-right">{m.detectablePercent == null ? "–" : `± ${fmt.percentValue(m.detectablePercent, 0)}`}</TableCell>
    </TableRow>
  );
}

function WindowDetails({ w }: { w: ShopPulseEffectWindow }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const signed = useSigned();
  const control = w.metrics[w.main]?.controlChangePercent;
  return (
    <div className="space-y-2" data-testid={`shop-pulse-effect-window-${w.days}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h5 className="text-sm font-medium">{t("shopPulse.effects.windowTitle", { days: w.days })}</h5>
        <Badge variant="outline" className={VERDICT_CLASS[w.verdict]}>
          {t(`shopPulse.effects.verdicts.${w.verdict}`)}
        </Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        {t("shopPulse.effects.windowRange", { preFrom: fmt.date(w.pre.from), preTo: fmt.date(w.pre.to), postFrom: fmt.date(w.post.from), postTo: fmt.date(w.post.to) })}
      </p>
      {w.metrics.revenue ? (
        <>
          <p className="text-xs">
            {t(`shopPulse.effects.controls.${w.control}`)}
            {control != null ? ` ${t("shopPulse.effects.controlChange", { percent: signed.percent(control) })}` : ""}
            {" · "}
            {t("shopPulse.effects.mainMetric", { metric: t(`shopPulse.effects.metrics.${w.main}`) })}
            {w.db1CoveragePercent != null ? ` · ${t("shopPulse.effects.coverage", { percent: fmt.percentValue(w.db1CoveragePercent, 0) })}` : ""}
          </p>
          <div className="overflow-x-auto">
            <Table className="text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("shopPulse.effects.columns.metric")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.pre")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.post")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.expected")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.effect")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.z")}</TableHead>
                  <TableHead className="text-right">{t("shopPulse.effects.columns.detectable")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {SHOP_PULSE_EFFECT_METRICS.map((id) => (
                  <MetricRow key={id} id={id} m={w.metrics[id]} />
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : null}
      {w.reasons.length ? (
        <ul className="list-disc pl-5 text-xs text-muted-foreground">
          {w.reasons.map((r) => (
            <li key={r}>{t(`shopPulse.effects.reasons.${r}`, SHOP_PULSE_EFFECT_RULES)}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ShopPulseEffectDetails({ effect }: { effect: ShopPulseActionEffect }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const signed = useSigned();
  const early = effect.early;
  return (
    <div className="space-y-4 rounded-md border bg-muted/30 p-3" data-testid={`shop-pulse-effect-details-${effect.actionId}`}>
      {effect.windows.map((w) => (
        <WindowDetails key={w.days} w={w} />
      ))}
      {effect.overlaps.length ? (
        <div className="space-y-1">
          <h5 className="text-sm font-medium">{t("shopPulse.effects.overlapsTitle", { count: effect.overlaps.length })}</h5>
          <ul className="text-xs text-muted-foreground">
            {effect.overlaps.slice(0, 8).map((o) => (
              <li key={o.id}>
                {fmt.date(o.occurredAt)} <span lang="de">{o.title}</span>
              </li>
            ))}
            {effect.overlaps.length > 8 ? <li>{t("shopPulse.effects.more", { count: effect.overlaps.length - 8 })}</li> : null}
          </ul>
        </div>
      ) : null}
      <div className="space-y-1">
        <h5 className="text-sm font-medium">{t("shopPulse.effects.earlyTitle")}</h5>
        {!early || early.state === "pending" ? (
          <p className="text-xs text-muted-foreground">{t("shopPulse.effects.earlyPending")}</p>
        ) : early.state === "notConfigured" ? (
          <p className="text-xs text-muted-foreground">{t("shopPulse.effects.earlyNotConfigured")}</p>
        ) : (
          <>
            {early.state === "error" ? <p className="text-xs text-destructive">{t("shopPulse.effects.earlyError", { error: early.error ?? "" })}</p> : null}
            {early.signals.length ? (
              <ul className="text-xs">
                {early.signals.map((s) => (
                  <li key={s.metric}>
                    {t("shopPulse.effects.earlyLine", {
                      metric: t(`shopPulse.effects.earlyMetrics.${s.metric}`),
                      days: s.days,
                      pre: fmt.decimal(s.pre, s.metric === "conversionPercent" ? 2 : 0),
                      post: fmt.decimal(s.post, s.metric === "conversionPercent" ? 2 : 0),
                      change: signed.percent(s.changePercent),
                    })}
                    {s.relativePercent != null ? ` ${t("shopPulse.effects.earlyRelative", { percent: signed.percent(s.relativePercent) })}` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="text-xs text-muted-foreground">{t("shopPulse.effects.earlyHint")}</p>
          </>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("shopPulse.effects.computedAt", { date: fmt.dateTime(effect.computedAt) })}</p>
    </div>
  );
}

/** Kopf im Maßnahmen-Protokoll: Regeln der Einstufung und „Neu berechnen“ */
export function ShopPulseEffectsHead() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useShopPulseEffects();
  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/effects/refresh")).json() as Promise<ShopPulseEffectsOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(EFFECTS_QUERY_KEY, next);
      toast({ title: t("shopPulse.effects.refreshed", { count: next.effects.length }) });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.effects.refreshFailed"), description: error.message, variant: "destructive" }),
  });
  return (
    <Card className="p-4 space-y-2" data-testid="shop-pulse-effects-head">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("shopPulse.effects.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("shopPulse.effects.hint")}</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending} data-testid="button-shop-pulse-effects-refresh">
          {refresh.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" aria-hidden="true" />}
          {t("shopPulse.effects.refresh")}
        </Button>
      </div>
      <details className="text-xs text-muted-foreground max-w-3xl">
        <summary className="cursor-pointer">{t("shopPulse.effects.rulesTitle")}</summary>
        <ul className="mt-1 list-disc pl-5 space-y-0.5">
          <li>{t("shopPulse.effects.rules.windows")}</li>
          <li>{t("shopPulse.effects.rules.control")}</li>
          <li>{t("shopPulse.effects.rules.main", SHOP_PULSE_EFFECT_RULES)}</li>
          <li>{t("shopPulse.effects.rules.sure", SHOP_PULSE_EFFECT_RULES)}</li>
          <li>{t("shopPulse.effects.rules.notMeasurable", SHOP_PULSE_EFFECT_RULES)}</li>
          <li>{t("shopPulse.effects.rules.honest")}</li>
        </ul>
      </details>
      {query.data?.computedAt ? <p className="text-xs text-muted-foreground">{t("shopPulse.effects.lastComputed", { date: fmt.dateTime(query.data.computedAt) })}</p> : null}
      {query.isError ? <p className="text-xs text-destructive">{t("shopPulse.effects.loadError")}</p> : null}
    </Card>
  );
}

/** Karte „Gesicherte Wirkung“ im Wochenbericht */
export function ShopPulseWeeklyEffectsCard({ effects }: { effects: ShopPulseWeeklyEffect[] | null }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const signed = useSigned();
  return (
    <Card className="p-4 space-y-2" data-testid="shop-pulse-weekly-effects">
      <h4 className="font-medium flex items-center gap-2">
        <TrendingUp className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        {t("shopPulse.weeklyPage.effectsTitle")}
      </h4>
      {effects == null ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t("shopPulse.weeklyPage.effectsNotComputed")}</p>
      ) : effects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("shopPulse.weeklyPage.effectsNone")}</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {effects.map((e) => (
            <li key={e.actionId} className="flex flex-wrap gap-x-2">
              <span className="text-muted-foreground whitespace-nowrap">{fmt.date(e.occurredAt)}</span>
              <span lang="de">{e.title}</span>
              <span className={e.positive ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"}>
                {t("shopPulse.effects.headline", { amount: signed.money(e.effect), metric: t(`shopPulse.effects.metrics.${e.main}`), percent: signed.percent(e.effectPercent), days: 28 })}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.effectsHint")}</p>
    </Card>
  );
}
