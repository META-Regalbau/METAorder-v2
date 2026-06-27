import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";

type WebhookConfigRow = {
  id: string;
  eventType: string;
  url: string;
  enabled: boolean;
  hasSecret: boolean;
};

export default function WebhooksSettingsSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data: configs = [], isLoading } = useQuery<WebhookConfigRow[]>({
    queryKey: ["/api/settings/webhooks"],
  });

  const [rows, setRows] = useState<Record<string, { url: string; enabled: boolean; secret: string }>>({});

  useEffect(() => {
    const next: Record<string, { url: string; enabled: boolean; secret: string }> = {};
    for (const c of configs) {
      next[c.eventType] = {
        url: c.url ?? "",
        enabled: !!c.enabled,
        secret: "",
      };
    }
    setRows(next);
  }, [configs]);

  const saveMutation = useMutation({
    mutationFn: async (eventType: string) => {
      const r = rows[eventType];
      if (!r) return;
      const body: { url: string; enabled: boolean; secret?: string } = {
        url: r.url.trim(),
        enabled: r.enabled,
      };
      if (r.secret.trim()) body.secret = r.secret.trim();
      await apiRequest(
        "PATCH",
        `/api/settings/webhooks/${encodeURIComponent(eventType)}`,
        body
      );
    },
    onSuccess: (_d, eventType) => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings/webhooks"] });
      toast({
        title: t("settings.webhookUpdated"),
        description: t("settings.webhookUpdatedMessage", { eventType }),
      });
      setRows((prev) => ({
        ...prev,
        [eventType]: { ...prev[eventType], secret: "" },
      }));
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (eventType: string) => {
      const r = rows[eventType];
      const res = await apiRequest("POST", "/api/webhooks/test", {
        eventType,
        url: r?.url?.trim() || undefined,
      });
      return res.json() as Promise<{ success?: boolean; message?: string; statusCode?: number }>;
    },
    onSuccess: (data) => {
      toast({
        title: t("settings.testWebhook"),
        description: data.success
          ? t("settings.testSuccessfulMessage", { statusCode: data.statusCode ?? "—" })
          : data.message || t("common.error"),
        variant: data.success ? "default" : "destructive",
      });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <Card className="p-6 mt-6 flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("common.loading")}
      </Card>
    );
  }

  return (
    <Card className="p-6 mt-6">
      <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
        {t("settings.webhookConfiguration")}
      </h2>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.webhookDescription")}</p>
      <p className="text-xs mb-4">
        <Link href="/webhooks/logs" className="text-primary underline">
          {t("settings.webhookLogsLink")}
        </Link>
      </p>

      <div className="space-y-6">
        {configs.map((c) => {
          const r = rows[c.eventType] ?? { url: c.url ?? "", enabled: !!c.enabled, secret: "" };
          const label = t(`settings.webhookEvent.${c.eventType.replace(/\./g, "_")}`, {
            defaultValue: c.eventType,
          });
          return (
            <div
              key={c.id}
              className="border rounded-lg p-4 space-y-3"
              data-testid={`webhook-config-${c.eventType.replace(/\./g, "-")}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-sm font-medium">{label}</span>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">{t("settings.enableWebhook")}</Label>
                  <Switch
                    checked={r.enabled}
                    onCheckedChange={(v) =>
                      setRows((prev) => ({
                        ...prev,
                        [c.eventType]: { ...r, enabled: v },
                      }))
                    }
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">{t("settings.webhookUrl")}</Label>
                <Input
                  className="mt-1 font-mono text-sm"
                  placeholder={t("settings.webhookUrlPlaceholder")}
                  value={r.url}
                  onChange={(e) =>
                    setRows((prev) => ({
                      ...prev,
                      [c.eventType]: { ...r, url: e.target.value },
                    }))
                  }
                />
              </div>
              <div>
                <Label className="text-xs">{t("settings.webhookSecret")}</Label>
                <Input
                  type="password"
                  className="mt-1 font-mono text-sm"
                  placeholder={
                    c.hasSecret
                      ? t("settings.webhookSecretConfigured")
                      : t("settings.webhookSecretPlaceholder")
                  }
                  value={r.secret}
                  onChange={(e) =>
                    setRows((prev) => ({
                      ...prev,
                      [c.eventType]: { ...r, secret: e.target.value },
                    }))
                  }
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate(c.eventType)}
                >
                  {t("common.save")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate(c.eventType)}
                >
                  {t("settings.testWebhook")}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
