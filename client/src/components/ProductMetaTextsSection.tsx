// Meta-Title/-Description der Artikel im Shop (KI): Tageslauf ein/aus, Uhrzeit, Grenze je Lauf,
// Testlauf mit wenigen Artikeln und Schreiben von Hand, Ergebnis mit Beispielen und Verworfenen.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Settings = { enabled: boolean; hourLocal: number; maxPerRun: number };
type RunSummary = {
  trigger: "manual" | "scheduled" | "script";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  products: number;
  candidates: number;
  processed: number;
  written: number;
  titleChanges: number;
  descriptionChanges: number;
  rejected: number;
  remaining: number;
  keptManualTitle: number;
  keptManualDescription: number;
  unchanged: number;
  examples: Array<{ productNumber: string; name: string; metaTitle: string; metaDescription: string }>;
  rejectedExamples: Array<{ productNumber: string; name: string; reason: string }>;
  error?: string;
};
type Status = {
  settings: Settings;
  lastRun: RunSummary | null;
  running: boolean;
  progress: { done: number; total: number } | null;
};

const ENDPOINT = "/api/settings/product-meta-texts";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function ProductMetaTextsSection({ tenantKey }: { tenantKey: string }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryKey = [ENDPOINT, tenantKey];
  const { data, isLoading } = useQuery<Status>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", ENDPOINT)).json(),
    refetchInterval: (query) => (query.state.data?.running ? 3000 : false),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setDraft(data.settings);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (s: Settings) => (await apiRequest("PUT", ENDPOINT, s)).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
      toast({ title: t("settings.productMetaTexts.saved") });
    },
    onError: (error: Error) => {
      toast({ title: t("settings.productMetaTexts.saveError"), description: error.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async (apply: boolean) => (await apiRequest("POST", `${ENDPOINT}/run`, { apply })).json(),
    onSuccess: () => {
      queryClient.setQueryData<Status>(queryKey, (old) => (old ? { ...old, running: true } : old));
      queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
    },
    onError: (error: Error) => {
      toast({ title: t("settings.productMetaTexts.runError"), description: error.message, variant: "destructive" });
    },
  });

  if (isLoading || !draft) {
    return <Card className="p-6 text-sm text-muted-foreground">{t("common.loading")}</Card>;
  }

  const running = Boolean(data?.running) || runMutation.isPending;
  const progress = data?.progress;
  const lastRun = data?.lastRun ?? null;
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  const confirmApply = () => {
    if (window.confirm(t("settings.productMetaTexts.confirmApply", { max: draft.maxPerRun }))) runMutation.mutate(true);
  };

  return (
    <Card className="p-6" data-testid="card-product-meta-texts">
      <h2 className="text-sm font-medium uppercase tracking-wide mb-2">{t("settings.productMetaTexts.title")}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.productMetaTexts.description")}</p>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium" htmlFor="product-meta-texts-enabled">
              {t("settings.productMetaTexts.enabled")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("settings.productMetaTexts.enabledDesc")}</p>
          </div>
          <Switch
            id="product-meta-texts-enabled"
            checked={draft.enabled}
            onCheckedChange={(value) => setDraft({ ...draft, enabled: value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 max-w-xl">
          <div className="space-y-2">
            <Label htmlFor="product-meta-texts-hour">{t("settings.productMetaTexts.hour")}</Label>
            <Select value={String(draft.hourLocal)} onValueChange={(v) => setDraft({ ...draft, hourLocal: Number(v) })}>
              <SelectTrigger id="product-meta-texts-hour" aria-label={t("settings.productMetaTexts.hour")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HOURS.map((h) => (
                  <SelectItem key={h} value={String(h)}>
                    {t("settings.productImageTexts.hourOption", { hour: String(h).padStart(2, "0") })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="product-meta-texts-max">{t("settings.productMetaTexts.maxPerRun")}</Label>
            <Input
              id="product-meta-texts-max"
              type="number"
              min={1}
              max={10000}
              value={draft.maxPerRun}
              onChange={(e) => setDraft({ ...draft, maxPerRun: Math.max(1, Math.min(10000, Number(e.target.value) || 1)) })}
            />
          </div>
        </div>

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => runMutation.mutate(false)} disabled={running}>
            {t("settings.productMetaTexts.dryRun")}
          </Button>
          <Button variant="outline" onClick={confirmApply} disabled={running}>
            {t("settings.productMetaTexts.applyNow")}
          </Button>
          <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>

        <div className="rounded-md border p-4 text-sm space-y-2" aria-live="polite">
          {running ? (
            <p>
              {progress && progress.total > 0
                ? t("settings.productMetaTexts.runningProgress", { done: progress.done, total: progress.total })
                : t("settings.productMetaTexts.running")}
            </p>
          ) : !lastRun ? (
            <p className="text-muted-foreground">{t("settings.productImageTexts.noRun")}</p>
          ) : (
            <>
              <p className="font-medium">
                {t(lastRun.dryRun ? "settings.productImageTexts.lastDryRun" : "settings.productImageTexts.lastRun", {
                  time: formatTime(lastRun.finishedAt),
                })}{" "}
                <span className="text-muted-foreground font-normal">
                  ({t(`settings.productImageTexts.trigger.${lastRun.trigger}`)})
                </span>
              </p>
              {lastRun.error ? (
                <p className="text-destructive">{t("settings.productImageTexts.failed", { error: lastRun.error })}</p>
              ) : (
                <>
                  <p>
                    {t(lastRun.dryRun ? "settings.productMetaTexts.summaryDry" : "settings.productMetaTexts.summary", {
                      products: lastRun.products,
                      candidates: lastRun.candidates,
                      processed: lastRun.processed,
                      written: lastRun.written,
                      rejected: lastRun.rejected,
                    })}
                  </p>
                  {lastRun.remaining > 0 && (
                    <p className="text-muted-foreground">
                      {t("settings.productMetaTexts.remaining", { count: lastRun.remaining })}
                    </p>
                  )}
                  {(lastRun.keptManualTitle > 0 || lastRun.keptManualDescription > 0) && (
                    <p className="text-muted-foreground">
                      {t("settings.productMetaTexts.keptManual", {
                        title: lastRun.keptManualTitle,
                        description: lastRun.keptManualDescription,
                      })}
                    </p>
                  )}
                  {lastRun.examples.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs mt-2">
                        <caption className="text-left text-muted-foreground mb-1">
                          {t("settings.productImageTexts.examples")}
                        </caption>
                        <thead>
                          <tr className="text-left">
                            <th scope="col" className="py-1 pr-3 font-medium">{t("settings.productMetaTexts.colProduct")}</th>
                            <th scope="col" className="py-1 pr-3 font-medium">Meta-Title</th>
                            <th scope="col" className="py-1 font-medium">Meta-Description</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lastRun.examples.map((ex) => (
                            <tr key={ex.productNumber} className="border-t align-top">
                              <td className="py-1 pr-3 text-muted-foreground">
                                {ex.productNumber}
                                <br />
                                {ex.name}
                              </td>
                              <td className="py-1 pr-3">{ex.metaTitle}</td>
                              <td className="py-1">{ex.metaDescription}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  {lastRun.rejectedExamples.length > 0 && (
                    <div>
                      <p className="text-muted-foreground mt-2">{t("settings.productMetaTexts.rejectedTitle")}</p>
                      <ul className="text-xs list-disc pl-5">
                        {lastRun.rejectedExamples.map((r) => (
                          <li key={r.productNumber}>
                            {r.productNumber} {r.name} – {r.reason}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
