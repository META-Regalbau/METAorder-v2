// Einstellungen der Cross-Selling-Teilautomatik (Modus, Gruppenname, Grenzen, Schwellen, KI-Budget).
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { pollCrossSellJob } from "@/lib/crossSellJobs";
import CrossSellBackfillPanel from "@/components/CrossSellBackfillPanel";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type Mode = "off" | "review" | "auto_dry_run" | "auto";
type Settings = {
  mode: Mode;
  managedGroupName: string;
  maxAutoApplyPerRun: number;
  maxAutoApplyPerSource: number;
  maxTargetsPerManagedGroup: number;
  maxNewQueueItemsPerRun: number;
  queueMinScore: number;
  minPairOrders: number;
  minDistinctCustomers: number;
  minConfidenceLB: number;
  minLiftLB: number;
  minLlmConfidence: number;
  llmMaxCallsPerRun: number;
  llmMaxCallsPerMonth: number;
  llmRecheckDays: number;
  monthlyReviewEnabled: boolean;
  reportEmail: string;
  reviewDayOfMonth: number;
  reviewHourLocal: number;
  [key: string]: unknown;
};

const MODES: Mode[] = ["off", "review", "auto_dry_run", "auto"];
const NUMBER_FIELDS: Array<{ key: keyof Settings; step: number; group: "limits" | "gates" | "llm" | "backfill" }> = [
  { key: "maxAutoApplyPerRun", step: 1, group: "limits" },
  { key: "maxAutoApplyPerSource", step: 1, group: "limits" },
  { key: "maxTargetsPerManagedGroup", step: 1, group: "limits" },
  { key: "maxNewQueueItemsPerRun", step: 1, group: "limits" },
  { key: "queueMinScore", step: 0.05, group: "limits" },
  { key: "minPairOrders", step: 1, group: "gates" },
  { key: "minDistinctCustomers", step: 1, group: "gates" },
  { key: "minConfidenceLB", step: 0.01, group: "gates" },
  { key: "minLiftLB", step: 0.1, group: "gates" },
  { key: "minLlmConfidence", step: 0.05, group: "gates" },
  { key: "llmMaxCallsPerRun", step: 1, group: "llm" },
  { key: "llmMaxCallsPerMonth", step: 10, group: "llm" },
  { key: "llmRecheckDays", step: 1, group: "llm" },
  { key: "patternMinSources", step: 1, group: "backfill" },
  { key: "patternMinLlmConfidence", step: 0.05, group: "backfill" },
  { key: "backfillLlmBudget", step: 100, group: "backfill" },
  { key: "backfillLlmPerRun", step: 10, group: "backfill" },
  { key: "backfillMaxAutoPerRun", step: 10, group: "backfill" },
  { key: "backfillMaxAutoPerSource", step: 1, group: "backfill" },
  { key: "backfillMaxQueuePerRun", step: 10, group: "backfill" },
];

export default function CrossSellAutomationSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data } = useQuery<Settings>({
    queryKey: ["/api/cross-selling/automation-settings"],
    queryFn: async () => (await apiRequest("GET", "/api/cross-selling/automation-settings")).json(),
  });
  const [draft, setDraft] = useState<Settings | null>(null);
  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async (s: Settings) => (await apiRequest("PUT", "/api/cross-selling/automation-settings", s)).json(),
    onSuccess: (saved: Settings) => {
      queryClient.setQueryData(["/api/cross-selling/automation-settings"], saved);
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/managed-group"] });
      toast({ title: t("crossSellAutomation.saved") });
    },
    onError: (error: Error) => {
      toast({ title: t("crossSellAutomation.saveError"), description: error.message, variant: "destructive" });
    },
  });

  const reviewMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/cross-selling/monthly-review/run", {});
      return pollCrossSellJob("review");
    },
    onSuccess: (result: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cross-selling/review-queue"] });
      toast({
        title: t("crossSellAutomation.reviewDone"),
        description: result?.skipped
          ? t(`crossSellReview.skipped.${result.skipped}`, { defaultValue: result.skipped })
          : t("crossSellAutomation.reviewSummary", {
              checked: result?.report?.pairsChecked ?? 0,
              proposals: result?.report?.proposals ?? 0,
            }),
      });
    },
    onError: (error: Error) => {
      toast({ title: t("crossSellAutomation.reviewError"), description: error.message, variant: "destructive" });
    },
  });

  if (!draft) return <Card className="p-6 text-sm text-muted-foreground">{t("common.loading")}</Card>;

  const set = (key: keyof Settings, value: unknown) => setDraft((d) => (d ? { ...d, [key]: value } : d));

  return (
    <Card className="p-6 space-y-6" data-testid="card-cross-sell-automation">
      <div>
        <h2 className="text-lg font-semibold">{t("crossSellAutomation.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("crossSellAutomation.hint")}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cs-mode">{t("crossSellAutomation.mode")}</Label>
          <Select value={draft.mode} onValueChange={(v) => set("mode", v as Mode)}>
            <SelectTrigger id="cs-mode" aria-label={t("crossSellAutomation.mode")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODES.map((m) => (
                <SelectItem key={m} value={m}>
                  {t(`crossSellAutomation.modes.${m}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t(`crossSellAutomation.modeHints.${draft.mode}`)}</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="cs-group-name">{t("crossSellAutomation.managedGroupName")}</Label>
          <Input
            id="cs-group-name"
            value={draft.managedGroupName}
            maxLength={80}
            onChange={(e) => set("managedGroupName", e.target.value)}
          />
          <p className="text-xs text-muted-foreground">{t("crossSellAutomation.managedGroupNameHint")}</p>
        </div>
      </div>

      {(["limits", "gates", "llm", "backfill"] as const).map((group) => (
        <div key={group} className="space-y-3">
          <h3 className="text-sm font-semibold">{t(`crossSellAutomation.groups.${group}`)}</h3>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {NUMBER_FIELDS.filter((f) => f.group === group).map((f) => (
              <div key={String(f.key)} className="space-y-1">
                <Label htmlFor={`cs-${String(f.key)}`} className="text-xs">
                  {t(`crossSellAutomation.fields.${String(f.key)}`)}
                </Label>
                <Input
                  id={`cs-${String(f.key)}`}
                  type="number"
                  step={f.step}
                  min={0}
                  value={String(draft[f.key] ?? "")}
                  onChange={(e) => set(f.key, e.target.value === "" ? 0 : Number(e.target.value))}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      <CrossSellBackfillPanel />

      <div className="space-y-3 rounded-md border p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold">{t("crossSellAutomation.monthlyTitle")}</h3>
            <p className="text-xs text-muted-foreground">{t("crossSellAutomation.monthlyHint")}</p>
          </div>
          <Button variant="outline" size="sm" onClick={() => reviewMutation.mutate()} disabled={reviewMutation.isPending}>
            {reviewMutation.isPending ? t("crossSellAutomation.reviewRunning") : t("crossSellAutomation.reviewNow")}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="cs-monthly-enabled"
            checked={draft.monthlyReviewEnabled}
            onCheckedChange={(v) => set("monthlyReviewEnabled", v)}
          />
          <Label htmlFor="cs-monthly-enabled" className="text-sm">
            {t("crossSellAutomation.monthlyEnabled")}
          </Label>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="cs-report-email" className="text-xs">{t("crossSellAutomation.reportEmail")}</Label>
            <Input
              id="cs-report-email"
              type="email"
              value={draft.reportEmail}
              maxLength={320}
              placeholder="crossselling@example.com"
              onChange={(e) => set("reportEmail", e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cs-review-day" className="text-xs">{t("crossSellAutomation.reviewDay")}</Label>
            <Input
              id="cs-review-day"
              type="number"
              min={1}
              max={28}
              value={String(draft.reviewDayOfMonth)}
              onChange={(e) => set("reviewDayOfMonth", Number(e.target.value) || 1)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="cs-review-hour" className="text-xs">{t("crossSellAutomation.reviewHour")}</Label>
            <Input
              id="cs-review-hour"
              type="number"
              min={0}
              max={23}
              value={String(draft.reviewHourLocal)}
              onChange={(e) => set("reviewHourLocal", Number(e.target.value) || 0)}
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground">{t("crossSellAutomation.monthlyRecipients")}</p>
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => data && setDraft(data)} disabled={saveMutation.isPending}>
          {t("common.cancel")}
        </Button>
        <Button onClick={() => saveMutation.mutate(draft)} disabled={saveMutation.isPending || !draft.managedGroupName.trim()}>
          {saveMutation.isPending ? t("common.loading") : t("common.save")}
        </Button>
      </div>
    </Card>
  );
}
