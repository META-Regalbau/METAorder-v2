import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckCircle2, CreditCard, Loader2, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiErrorInfo } from "@/lib/apiError";

/**
 * Mondu-Anbindung (Einstellungen -> Integration): API-Schlüssel und Testumgebung (Sandbox). Braucht METAorder
 * für MonduSell (Anlage, Statusabgleich, Rechnungsübergabe). Der Schlüssel wird verschlüsselt gespeichert und
 * nie zurückgegeben; der Test liest eine Bestellung bei Mondu.
 */

type MonduSettingsResponse = { configured: boolean; sandboxMode?: boolean; hasApiKey?: boolean };

const SETTINGS_KEY = ["/api/settings/mondu"] as const;

export default function MonduConnectionSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data } = useQuery<MonduSettingsResponse>({ queryKey: SETTINGS_KEY });
  const [apiKey, setApiKey] = useState("");
  const [sandboxMode, setSandboxMode] = useState(true);
  const [testState, setTestState] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (data?.configured) setSandboxMode(!!data.sandboxMode);
  }, [data?.configured, data?.sandboxMode]);

  const errorText = (e: Error) => {
    const detail = apiErrorInfo(e)?.detail;
    return detail ? `${e.message}: ${detail}` : e.message;
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/mondu", { apiKey: apiKey.trim() || undefined, sandboxMode });
      return res.json();
    },
    onSuccess: () => {
      setApiKey("");
      queryClient.invalidateQueries({ queryKey: SETTINGS_KEY });
      toast({ title: t("settings.integration.mondu.saved") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: errorText(e), variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/settings/mondu/test", { apiKey: apiKey.trim() || undefined, sandboxMode });
    },
    onMutate: () => setTestState(null),
    onSuccess: () => setTestState({ ok: true, text: t("settings.integration.mondu.testOk") }),
    onError: (e: Error) => setTestState({ ok: false, text: errorText(e) }),
  });

  const canSubmit = apiKey.trim().length > 0 || !!data?.hasApiKey;

  return (
    <Card className="p-6" data-testid="card-mondu-connection">
      <div className="flex items-center gap-2 mb-2">
        <CreditCard className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{t("settings.integration.mondu.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{t("settings.integration.mondu.description")}</p>
      <p className="text-xs mb-4 flex items-center gap-1" data-testid="text-mondu-connection-state">
        {data?.hasApiKey ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {data.sandboxMode ? t("settings.integration.mondu.connectedSandbox") : t("settings.integration.mondu.connectedLive")}
          </>
        ) : (
          <span className="text-muted-foreground">{t("settings.integration.mondu.notConnected")}</span>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-3">
        <div>
          <Label className="text-xs" htmlFor="mondu-api-key">{t("settings.integration.mondu.keyLabel")}</Label>
          <Input
            id="mondu-api-key"
            className="mt-1"
            type="password"
            autoComplete="new-password"
            placeholder={data?.hasApiKey ? t("settings.integration.mondu.keyPlaceholderStored") : t("settings.integration.mondu.keyPlaceholderNew")}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="input-mondu-api-key"
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <Switch id="mondu-sandbox" checked={sandboxMode} onCheckedChange={setSandboxMode} data-testid="switch-mondu-sandbox" />
          <Label htmlFor="mondu-sandbox" className="text-sm">{t("settings.integration.mondu.sandbox")}</Label>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.integration.mondu.keyHint")}</p>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canSubmit || saveMutation.isPending} data-testid="button-mondu-save">
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("common.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={!canSubmit || testMutation.isPending}
          data-testid="button-mondu-test"
        >
          {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("settings.integration.mondu.test")}
        </Button>
      </div>
      {testState ? (
        <p
          className={`mt-3 flex items-start gap-2 text-sm ${testState.ok ? "text-emerald-700 dark:text-emerald-400" : "text-destructive"}`}
          role={testState.ok ? undefined : "alert"}
          data-testid="text-mondu-test-result"
        >
          {testState.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" /> : <XCircle className="h-4 w-4 shrink-0 mt-0.5" />}
          {testState.text}
        </p>
      ) : null}
    </Card>
  );
}
