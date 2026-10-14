// Bildtexte (ALT/TITLE) der Produktbilder im Shop: Tageslauf ein/aus, Uhrzeit, Testlauf und
// Schreiben von Hand, Ergebnis des letzten Laufs mit Beispielen.
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Settings = { enabled: boolean; hourLocal: number };
type Example = {
  fileName: string;
  productNumber: string;
  alt: string;
  title: string;
  previousAlt: string | null;
  previousTitle: string | null;
};
type RunSummary = {
  trigger: "manual" | "scheduled" | "script";
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  images: number;
  changed: number;
  altChanges: number;
  titleChanges: number;
  keptManualAlt: number;
  keptManualTitle: number;
  unchanged: number;
  withoutProductName: number;
  examples: Example[];
  error?: string;
};
type Status = { settings: Settings; lastRun: RunSummary | null; running: boolean };

const ENDPOINT = "/api/settings/product-image-texts";
const HOURS = Array.from({ length: 24 }, (_, h) => h);

export default function ProductImageTextsSection({ tenantKey }: { tenantKey: string }) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const queryKey = [ENDPOINT, tenantKey];
  const { data, isLoading } = useQuery<Status>({
    queryKey,
    queryFn: async () => (await apiRequest("GET", ENDPOINT)).json(),
    // Waehrend eines Laufs alle 3 Sekunden nachsehen
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
      toast({ title: t("settings.productImageTexts.saved") });
    },
    onError: (error: Error) => {
      toast({ title: t("settings.productImageTexts.saveError"), description: error.message, variant: "destructive" });
    },
  });

  const runMutation = useMutation({
    mutationFn: async (apply: boolean) => (await apiRequest("POST", `${ENDPOINT}/run`, { apply })).json(),
    onSuccess: () => {
      queryClient.setQueryData<Status>(queryKey, (old) => (old ? { ...old, running: true } : old));
      queryClient.invalidateQueries({ queryKey: [ENDPOINT] });
    },
    onError: (error: Error) => {
      toast({ title: t("settings.productImageTexts.runError"), description: error.message, variant: "destructive" });
    },
  });

  if (isLoading || !draft) {
    return <Card className="p-6 text-sm text-muted-foreground">{t("common.loading")}</Card>;
  }

  const running = Boolean(data?.running) || runMutation.isPending;
  const lastRun = data?.lastRun ?? null;
  const formatTime = (iso: string) =>
    new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" });

  const confirmApply = () => {
    if (window.confirm(t("settings.productImageTexts.confirmApply"))) runMutation.mutate(true);
  };

  return (
    <Card className="p-6" data-testid="card-product-image-texts">
      <h2 className="text-sm font-medium uppercase tracking-wide mb-2">{t("settings.productImageTexts.title")}</h2>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.productImageTexts.description")}</p>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <Label className="text-sm font-medium" htmlFor="product-image-texts-enabled">
              {t("settings.productImageTexts.enabled")}
            </Label>
            <p className="text-xs text-muted-foreground">{t("settings.productImageTexts.enabledDesc")}</p>
          </div>
          <Switch
            id="product-image-texts-enabled"
            checked={draft.enabled}
            onCheckedChange={(value) => setDraft({ ...draft, enabled: value })}
          />
        </div>

        <div className="space-y-2 max-w-xs">
          <Label htmlFor="product-image-texts-hour">{t("settings.productImageTexts.hour")}</Label>
          <Select value={String(draft.hourLocal)} onValueChange={(v) => setDraft({ ...draft, hourLocal: Number(v) })}>
            <SelectTrigger id="product-image-texts-hour" aria-label={t("settings.productImageTexts.hour")}>
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

        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={() => runMutation.mutate(false)} disabled={running}>
            {t("settings.productImageTexts.dryRun")}
          </Button>
          <Button variant="outline" onClick={confirmApply} disabled={running}>
            {t("settings.productImageTexts.applyNow")}
          </Button>
          <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? t("common.saving") : t("common.save")}
          </Button>
        </div>

        <div className="rounded-md border p-4 text-sm space-y-2" aria-live="polite">
          {running ? (
            <p>{t("settings.productImageTexts.running")}</p>
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
                    {t(lastRun.dryRun ? "settings.productImageTexts.summaryDry" : "settings.productImageTexts.summary", {
                      images: lastRun.images,
                      changed: lastRun.changed,
                      alt: lastRun.altChanges,
                      title: lastRun.titleChanges,
                    })}
                  </p>
                  {(lastRun.keptManualAlt > 0 || lastRun.keptManualTitle > 0) && (
                    <p className="text-muted-foreground">
                      {t("settings.productImageTexts.keptManual", {
                        alt: lastRun.keptManualAlt,
                        title: lastRun.keptManualTitle,
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
                            <th scope="col" className="py-1 pr-3 font-medium">{t("settings.productImageTexts.colFile")}</th>
                            <th scope="col" className="py-1 pr-3 font-medium">ALT</th>
                            <th scope="col" className="py-1 font-medium">TITLE</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lastRun.examples.map((ex) => (
                            <tr key={ex.fileName} className="border-t align-top">
                              <td className="py-1 pr-3 break-all text-muted-foreground">{ex.fileName}</td>
                              <td className="py-1 pr-3">{ex.alt}</td>
                              <td className="py-1">{ex.title}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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
