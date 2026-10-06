import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Workflow, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";

/**
 * n8n-Verbindung (Einstellungen -> Integration): Adresse und API-Key der n8n-Instanz. Der Key wird
 * verschluesselt gespeichert und nie zurueckgegeben. Mit der Verbindung zeigt die Seite, welche
 * Workflows Mails lesen, ob sie an METAorder hochladen und wie die letzten Ausfuehrungen liefen
 * (server/integration/n8nConnection.ts).
 */

type ConnectionResponse = { configured: boolean; baseUrl: string; hasApiKey: boolean };

type MailSource = "m365" | "gmail" | "imap";

type WorkflowSummary = {
  id: string;
  name: string;
  active: boolean;
  updatedAt: string | null;
  mailSources: MailSource[];
  metaorderUploads: string[];
  uploadsElsewhere: boolean;
  nodes: Array<{ name: string; type: string; disabled: boolean }>;
  executions: {
    total: number;
    success: number;
    error: number;
    running: number;
    lastStartedAt: string | null;
    lastStatus: string | null;
    lastErrorAt: string | null;
  } | null;
};

const CONNECTION_KEY = ["/api/settings/n8n-connection"] as const;
const WORKFLOWS_KEY = ["/api/settings/n8n-connection/workflows"] as const;

const shortType = (type: string) => type.replace(/^n8n-nodes-base\./, "");

export default function N8nConnectionSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();

  const { data: connection } = useQuery<ConnectionResponse>({ queryKey: CONNECTION_KEY });
  const configured = Boolean(connection?.configured);

  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (connection) setBaseUrl(connection.baseUrl);
  }, [connection?.baseUrl]);

  const workflowsQuery = useQuery<{ workflows: WorkflowSummary[]; ownOrigin: string | null }>({
    queryKey: WORKFLOWS_KEY,
    enabled: configured,
    retry: false,
    staleTime: 60_000,
  });

  const onError = (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/n8n-connection", { baseUrl, apiKey });
      return res.json() as Promise<ConnectionResponse>;
    },
    onSuccess: (saved) => {
      setApiKey("");
      queryClient.setQueryData(CONNECTION_KEY, saved);
      queryClient.invalidateQueries({ queryKey: WORKFLOWS_KEY });
      toast({ title: t("settings.integration.n8n.saved") });
    },
    onError,
  });

  const testMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/settings/n8n-connection/test", { baseUrl, apiKey });
    },
    onSuccess: () => toast({ title: t("settings.integration.n8n.testOk") }),
    onError,
  });

  const removeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", "/api/settings/n8n-connection");
      return res.json() as Promise<ConnectionResponse>;
    },
    onSuccess: (cleared) => {
      setApiKey("");
      setBaseUrl("");
      setConfirmRemove(false);
      queryClient.setQueryData(CONNECTION_KEY, cleared);
      queryClient.removeQueries({ queryKey: WORKFLOWS_KEY });
      toast({ title: t("settings.integration.n8n.removed") });
    },
    onError,
  });

  const canSubmit = baseUrl.trim().length > 0 && (apiKey.trim().length > 0 || Boolean(connection?.hasApiKey));
  const workflows = workflowsQuery.data?.workflows ?? [];
  const mailWorkflows = workflows.filter((wf) => wf.mailSources.length > 0 || wf.metaorderUploads.length > 0);
  const otherCount = workflows.length - mailWorkflows.length;
  const n8nBase = connection?.baseUrl ?? "";

  const statusLabel = (status: string | null) =>
    status ? t(`settings.integration.n8n.status.${status}`, { defaultValue: status }) : "";

  return (
    <Card className="p-6" data-testid="card-n8n-connection">
      <div className="flex items-center gap-2 mb-2">
        <Workflow className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{t("settings.integration.n8n.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-2">{t("settings.integration.n8n.description")}</p>
      <p className="text-xs mb-4 flex items-center gap-1" data-testid="text-n8n-connection-state">
        {configured ? (
          <>
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {t("settings.integration.n8n.connectedTo", { url: connection?.baseUrl })}
          </>
        ) : (
          <span className="text-muted-foreground">{t("settings.integration.n8n.notConnected")}</span>
        )}
      </p>

      <div className="grid gap-3 md:grid-cols-2 mb-3">
        <div>
          <Label className="text-xs" htmlFor="n8n-base-url">{t("settings.integration.n8n.urlLabel")}</Label>
          <Input
            id="n8n-base-url"
            className="mt-1"
            inputMode="url"
            placeholder={t("settings.integration.n8n.urlPlaceholder")}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            data-testid="input-n8n-base-url"
          />
        </div>
        <div>
          <Label className="text-xs" htmlFor="n8n-api-key">{t("settings.integration.n8n.keyLabel")}</Label>
          <Input
            id="n8n-api-key"
            className="mt-1"
            type="password"
            autoComplete="new-password"
            placeholder={
              connection?.hasApiKey
                ? t("settings.integration.n8n.keyPlaceholderStored")
                : t("settings.integration.n8n.keyPlaceholderNew")
            }
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            data-testid="input-n8n-api-key"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.integration.n8n.keyHint")}</p>

      <div className="flex flex-wrap gap-2 mb-2">
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={!canSubmit || saveMutation.isPending} data-testid="button-n8n-save">
          {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("common.save")}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => testMutation.mutate()}
          disabled={!canSubmit || testMutation.isPending}
          data-testid="button-n8n-test"
        >
          {testMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {t("settings.integration.n8n.test")}
        </Button>
        {configured ? (
          <Button type="button" variant="ghost" className="text-destructive" onClick={() => setConfirmRemove(true)} data-testid="button-n8n-remove">
            {t("settings.integration.n8n.remove")}
          </Button>
        ) : null}
      </div>

      {configured ? (
        <div className="mt-6 border-t pt-4" data-testid="n8n-workflows">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h3 className="text-sm font-medium">{t("settings.integration.n8n.workflowsTitle")}</h3>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => workflowsQuery.refetch()}
              disabled={workflowsQuery.isFetching}
              data-testid="button-n8n-refresh"
            >
              <RefreshCw className={`mr-2 h-3.5 w-3.5 ${workflowsQuery.isFetching ? "animate-spin" : ""}`} />
              {t("settings.integration.n8n.refresh")}
            </Button>
          </div>

          {workflowsQuery.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("common.loading")}
            </div>
          ) : workflowsQuery.error ? (
            <p className="flex items-start gap-2 text-sm text-destructive" role="alert" data-testid="text-n8n-workflows-error">
              <XCircle className="h-4 w-4 shrink-0" />
              {(workflowsQuery.error as Error).message}
            </p>
          ) : mailWorkflows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-n8n-no-mail-workflows">
              {t("settings.integration.n8n.noMailWorkflows", { count: workflows.length })}
            </p>
          ) : (
            <div className="space-y-2">
              {mailWorkflows.map((wf) => {
                const warnings = [
                  wf.mailSources.length > 0 && wf.metaorderUploads.length === 0
                    ? t("settings.integration.n8n.mailWithoutUpload")
                    : null,
                  wf.uploadsElsewhere
                    ? t("settings.integration.n8n.uploadsElsewhere", { target: wf.metaorderUploads.join(", ") })
                    : null,
                  !wf.active ? t("settings.integration.n8n.inactiveHint") : null,
                ].filter((w): w is string => Boolean(w));
                return (
                  <div key={wf.id} className="rounded-lg border p-3 text-sm" data-testid={`n8n-workflow-${wf.id}`}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{wf.name}</span>
                      <Badge variant={wf.active ? "default" : "secondary"}>
                        {wf.active ? t("settings.integration.n8n.active") : t("settings.integration.n8n.inactive")}
                      </Badge>
                      {wf.mailSources.map((source) => (
                        <Badge key={source} variant="outline">
                          {t(`settings.integration.n8n.sources.${source}`)}
                        </Badge>
                      ))}
                      {n8nBase ? (
                        <a
                          className="ml-auto inline-flex items-center gap-1 text-xs underline"
                          href={`${n8nBase}/workflow/${encodeURIComponent(wf.id)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {t("settings.integration.n8n.openInN8n")}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : null}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground" data-testid={`n8n-workflow-upload-${wf.id}`}>
                      {wf.metaorderUploads.length > 0
                        ? t("settings.integration.n8n.uploadsTo", { target: wf.metaorderUploads.join(", ") })
                        : t("settings.integration.n8n.uploadsNo")}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground" data-testid={`n8n-workflow-runs-${wf.id}`}>
                      {wf.executions && wf.executions.total > 0
                        ? [
                            t("settings.integration.n8n.runsSummary", {
                              count: wf.executions.total,
                              success: wf.executions.success,
                              error: wf.executions.error,
                            }),
                            wf.executions.lastStartedAt
                              ? t("settings.integration.n8n.lastRun", {
                                  date: fmt.dateTime(wf.executions.lastStartedAt),
                                  status: statusLabel(wf.executions.lastStatus),
                                })
                              : null,
                            wf.executions.lastErrorAt
                              ? t("settings.integration.n8n.lastError", { date: fmt.dateTime(wf.executions.lastErrorAt) })
                              : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : t("settings.integration.n8n.runsNone")}
                    </div>
                    {warnings.map((warning) => (
                      <p key={warning} className="mt-1 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {warning}
                      </p>
                    ))}
                    <details className="mt-2 text-xs">
                      <summary className="cursor-pointer text-muted-foreground">
                        {t("settings.integration.n8n.steps", { count: wf.nodes.length })}
                      </summary>
                      <ol className="mt-1 list-decimal pl-5 space-y-0.5">
                        {wf.nodes.map((node) => (
                          <li key={node.name} className={node.disabled ? "line-through text-muted-foreground" : ""}>
                            {node.name} <span className="text-muted-foreground">({shortType(node.type)})</span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  </div>
                );
              })}
            </div>
          )}
          {!workflowsQuery.isLoading && !workflowsQuery.error && otherCount > 0 && mailWorkflows.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">{t("settings.integration.n8n.otherWorkflows", { count: otherCount })}</p>
          ) : null}
        </div>
      ) : null}

      <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.integration.n8n.removeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.integration.n8n.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => removeMutation.mutate()} data-testid="button-n8n-remove-confirm">
              {t("settings.integration.n8n.remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
