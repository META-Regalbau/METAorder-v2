import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, Loader2, Search, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopPulseGscOverview, ShopPulseMetaSuggestionResult } from "@shared/shopPulse";
import type { ShopPulseWeeklyGsc } from "@shared/shopPulseWeekly";

/**
 * Shop-Puls, Search Console (Stufe 2, S2-5): Einstellungen (Schalter, Property, Dienstkonto-JSON – wird nie
 * angezeigt, nur ersetzt oder gelöscht), KI-Vorschlag für Meta-Title/-Description an der Meldung „viele
 * Impressionen, wenig Klicks“ (nur zur Freigabe, nichts wird geschrieben) und die Karte im Wochenbericht.
 * Server: server/routes/shopPulseGscRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/search-console"];

export function ShopPulseGscSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useQuery<ShopPulseGscOverview>({ queryKey: QUERY_KEY });
  const [property, setProperty] = useState("");
  const [json, setJson] = useState("");
  const data = query.data;
  useEffect(() => {
    if (data) setProperty(data.property);
  }, [data?.property]);

  const save = useMutation({
    mutationFn: async (body: { enabled?: boolean; property?: string; serviceAccountJson?: string }) =>
      (await apiRequest("PUT", "/api/shop-pulse/search-console/settings", body)).json() as Promise<ShopPulseGscOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setJson("");
      toast({ title: t("shopPulse.gsc.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.gsc.saveFailed"), description: error.message, variant: "destructive" }),
  });

  if (!data) return null;
  return (
    <Card className="p-4 space-y-3" data-testid="shop-pulse-gsc-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-semibold flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("shopPulse.gsc.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("shopPulse.gsc.hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="shop-pulse-gsc-enabled" checked={data.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate({ enabled })} data-testid="switch-shop-pulse-gsc" />
          <Label htmlFor="shop-pulse-gsc-enabled">{t("shopPulse.gsc.enable")}</Label>
        </div>
      </div>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ property: property.trim(), ...(json.trim() ? { serviceAccountJson: json.trim() } : {}) });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="shop-pulse-gsc-property">{t("shopPulse.gsc.property")}</Label>
          <Input id="shop-pulse-gsc-property" value={property} placeholder="sc-domain:meta-online.com" aria-describedby="shop-pulse-gsc-property-hint" onChange={(e) => setProperty(e.target.value)} data-testid="input-shop-pulse-gsc-property" />
          <p id="shop-pulse-gsc-property-hint" className="text-xs text-muted-foreground">
            {t("shopPulse.gsc.propertyHint")}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="shop-pulse-gsc-json">{t("shopPulse.gsc.serviceAccount")}</Label>
          <Textarea
            id="shop-pulse-gsc-json"
            value={json}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={data.hasServiceAccount ? t("shopPulse.gsc.serviceAccountSet", { email: data.serviceAccountEmail ?? "–" }) : t("shopPulse.gsc.serviceAccountNone")}
            onChange={(e) => setJson(e.target.value)}
            data-testid="input-shop-pulse-gsc-json"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Button type="submit" disabled={save.isPending} data-testid="button-shop-pulse-gsc-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t("shopPulse.gsc.save")}
          </Button>
          {data.hasServiceAccount ? (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ serviceAccountJson: "" })}>
              {t("shopPulse.gsc.removeServiceAccount")}
            </Button>
          ) : null}
          <span className="text-sm" role="status" data-testid="text-shop-pulse-gsc-status">
            {data.problem ? t(`shopPulse.gscSetup.problems.${data.problem}`) : t("shopPulse.gsc.ready")}
          </span>
        </div>
      </form>
    </Card>
  );
}

/** Knopf „Meta-Vorschlag“ an einer Meldung gscLowCtr; zeigt den Vorschlag zum Kopieren */
export function ShopPulseMetaSuggestion({ signalId }: { signalId: string }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [result, setResult] = useState<ShopPulseMetaSuggestionResult | null>(null);
  const run = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/search-console/meta-suggestion", { signalId })).json() as Promise<ShopPulseMetaSuggestionResult>,
    onSuccess: setResult,
    onError: (error: Error) => toast({ title: t("shopPulse.gsc.suggestFailed"), description: error.message, variant: "destructive" }),
  });
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("shopPulse.cart.copied") });
    } catch {
      toast({ title: t("shopPulse.cart.copyFailed"), variant: "destructive" });
    }
  };
  return (
    <div className="mt-2 space-y-2">
      <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()} data-testid={`button-shop-pulse-meta-suggestion-${signalId}`}>
        {run.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" aria-hidden="true" />}
        {t("shopPulse.gsc.suggest")}
      </Button>
      {result ? (
        <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-2" role="status" data-testid={`shop-pulse-meta-suggestion-${signalId}`}>
          <p className="text-xs text-muted-foreground">{t("shopPulse.gsc.current", { title: result.current.title || "–", description: result.current.description || "–" })}</p>
          {result.suggestion ? (
            <>
              {(["metaTitle", "metaDescription"] as const).map((field) => (
                <div key={field} className="flex flex-wrap items-start gap-2">
                  <span className="font-medium">{t(`shopPulse.gsc.fields.${field}`)}:</span>
                  <span lang="de" className="flex-1 min-w-0 break-words">
                    {result.suggestion![field]}
                  </span>
                  <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => copy(result.suggestion![field])} aria-label={t("shopPulse.cart.copy")}>
                    <Copy className="h-3 w-3" aria-hidden="true" />
                  </Button>
                </div>
              ))}
            </>
          ) : (
            <p className="text-amber-700 dark:text-amber-300">{t("shopPulse.gsc.rejected", { reason: result.rejected ?? "–" })}</p>
          )}
          {result.queries.length ? <p className="text-xs text-muted-foreground">{t("shopPulse.gsc.queries", { queries: result.queries.join(", ") })}</p> : null}
          <p className="text-xs text-muted-foreground">{t("shopPulse.gsc.suggestHint")}</p>
        </div>
      ) : null}
    </div>
  );
}

/** Karte „Search Console“ im Wochenbericht */
export function ShopPulseWeeklyGscCard({ gsc }: { gsc: ShopPulseWeeklyGsc }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  return (
    <Card className="p-4 space-y-3" data-testid="shop-pulse-weekly-gsc">
      <h4 className="font-medium">{t("shopPulse.weeklyPage.gscTitle")}</h4>
      {!gsc.configured ? (
        <p className="text-sm text-amber-700 dark:text-amber-300">{t("shopPulse.weeklyPage.gscNone", { problem: t(`shopPulse.gscSetup.problems.${gsc.problem}`) })}</p>
      ) : (
        <>
          {gsc.clicks != null ? (
            <p className="text-sm">
              {t("shopPulse.weeklyPage.gscLine", {
                from: fmt.date(`${gsc.from}T12:00:00`),
                to: fmt.date(`${gsc.to}T12:00:00`),
                clicks: fmt.integer(gsc.clicks),
                previous: gsc.previousClicks != null ? fmt.integer(gsc.previousClicks) : "–",
                impressions: fmt.integer(gsc.impressions ?? 0),
              })}
            </p>
          ) : (
            <p className="text-sm text-amber-700 dark:text-amber-300">{t("shopPulse.weeklyPage.gscNotRead")}</p>
          )}
          {gsc.nearPageOne.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("shopPulse.weeklyPage.gscNear")}</p>
              <ul className="text-sm space-y-0.5">
                {gsc.nearPageOne.map((q) => (
                  <li key={q.query}>
                    „{q.query}“ <span className="text-muted-foreground">{t("shopPulse.weeklyPage.gscNearItem", { position: fmt.decimal(q.position, 1), impressions: fmt.integer(q.impressions) })}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {gsc.cannibalization.length ? (
            <div className="space-y-1">
              <p className="text-sm font-medium">{t("shopPulse.weeklyPage.gscCannibal")}</p>
              <ul className="text-sm space-y-0.5">
                {gsc.cannibalization.map((q) => (
                  <li key={q.query}>
                    „{q.query}“: <span className="text-muted-foreground break-all">{q.pages.join(" / ")}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {gsc.notIndexed ? <p className="text-sm">{t("shopPulse.weeklyPage.gscNotIndexed", { count: gsc.notIndexed })}</p> : null}
        </>
      )}
      <p className="text-xs text-muted-foreground">{t("shopPulse.weeklyPage.gscHint")}</p>
    </Card>
  );
}
