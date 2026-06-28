import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";
import { Copy, Check, KeyRound, Loader2, Plus, Trash2 } from "lucide-react";

type IntegrationApiKey = {
  id: string;
  name: string;
  createdAt: string;
};

const KEYS_QUERY_KEY = ["/api/settings/integration-api-keys"] as const;

export default function N8nSettingsSection() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<{ keys: IntegrationApiKey[] }>({
    queryKey: KEYS_QUERY_KEY,
  });
  const keys = data?.keys ?? [];

  const [newKeyName, setNewKeyName] = useState("");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<IntegrationApiKey | null>(null);

  const dateFormatter = new Intl.DateTimeFormat(i18n.language || "de", {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const createMutation = useMutation({
    mutationFn: async (name: string) => {
      const res = await apiRequest("POST", "/api/settings/integration-api-keys", { name });
      return res.json() as Promise<{ id: string; apiKey: string; warning?: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
      setCreatedKey(created.apiKey);
      setCopied(false);
      setNewKeyName("");
      toast({
        title: t("settings.integration.keys.createdTitle"),
        description: t("settings.integration.keys.createdMessage"),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/settings/integration-api-keys/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
      toast({ title: t("settings.integration.keys.deletedTitle") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
    onSettled: () => setDeleteTarget(null),
  });

  const handleCopy = async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: t("settings.integration.keys.copyFailed"), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-medium uppercase tracking-wide">
            {t("settings.integration.keys.title")}
          </h2>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.integration.keys.description")}
        </p>

        {createdKey ? (
          <div className="mb-4 rounded-lg border border-amber-500 bg-amber-50 p-4 dark:bg-amber-950/30">
            <p className="text-xs font-medium text-amber-800 dark:text-amber-300 mb-2">
              {t("settings.integration.keys.newKeyWarning")}
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-background px-2 py-1 font-mono text-xs">
                {createdKey}
              </code>
              <Button type="button" size="sm" variant="outline" onClick={handleCopy}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setCreatedKey(null)}>
                {t("common.close")}
              </Button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-end gap-2 mb-4">
          <div className="flex-1 min-w-[200px]">
            <Label className="text-xs">{t("settings.integration.keys.nameLabel")}</Label>
            <Input
              className="mt-1"
              placeholder={t("settings.integration.keys.namePlaceholder")}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
          </div>
          <Button
            type="button"
            disabled={createMutation.isPending}
            onClick={() => createMutation.mutate(newKeyName.trim())}
          >
            {createMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Plus className="mr-2 h-4 w-4" />
            )}
            {t("settings.integration.keys.create")}
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("common.loading")}
          </div>
        ) : keys.length === 0 ? (
          <div className="py-4 text-sm text-muted-foreground">
            {t("settings.integration.keys.empty")}
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((key) => (
              <div
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                data-testid={`integration-key-${key.id}`}
              >
                <div>
                  <div className="text-sm font-medium">
                    {key.name || t("settings.integration.keys.unnamed")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.integration.keys.createdAt", {
                      date: dateFormatter.format(new Date(key.createdAt)),
                    })}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => setDeleteTarget(key)}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  {t("common.delete")}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <h2 className="text-sm font-medium uppercase tracking-wide mb-2">
          {t("settings.integration.usage.title")}
        </h2>
        <p className="text-xs text-muted-foreground mb-4">
          {t("settings.integration.usage.description")}
        </p>
        <div className="space-y-3 text-sm">
          <div>
            <div className="text-xs text-muted-foreground">
              {t("settings.integration.usage.headerLabel")}
            </div>
            <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-xs">
              X-METAORDER-Integration-Key: &lt;{t("settings.integration.usage.yourKey")}&gt;
            </code>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              {t("settings.integration.usage.uploadLabel")}
            </div>
            <code className="mt-1 inline-block rounded bg-muted px-2 py-1 font-mono text-xs">
              POST /api/commercial-drafts/upload
            </code>
          </div>
          <p className="text-xs text-muted-foreground">
            {t("settings.integration.usage.webhookHint")}{" "}
            <Link href="/webhooks/logs" className="text-primary underline">
              {t("settings.webhookLogsLink")}
            </Link>
          </p>
        </div>
      </Card>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.integration.keys.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("settings.integration.keys.deleteConfirm", {
                name: deleteTarget?.name || t("settings.integration.keys.unnamed"),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {deleteMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
