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
import { Copy, Check, KeyRound, Loader2, Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { TFunction } from "i18next";

/** Benutzer, unter dem n8n mit einem Schluessel arbeitet (server/integration/integrationKeyUsers.ts) */
type IntegrationUserInfo = {
  id: string;
  username: string;
  roleName: string | null;
  isTenantMember: boolean;
  canManageOffers: boolean;
  canManageOrderDrafts: boolean;
  ready: boolean;
};

type IntegrationApiKey = {
  id: string;
  name: string;
  createdAt: string;
  userId: string | null;
  /** tatsaechlich genutzter Benutzer: gebunden oder Ersatz-Benutzer (null = keiner -> Aufrufe scheitern) */
  effectiveUser: IntegrationUserInfo | null;
};

type KeysResponse = { keys: IntegrationApiKey[]; users: IntegrationUserInfo[]; fallbackUser: IntegrationUserInfo | null };

/** Wert der Auswahl fuer "kein fester Benutzer" (Ersatz-Benutzer) */
const FALLBACK = "__fallback__";

/** Was fehlt, damit n8n mit diesem Benutzer E-Mails verarbeiten kann (leer = bereit) */
export function integrationUserProblem(user: IntegrationUserInfo | null, t: TFunction): string | null {
  if (!user) return t("settings.integration.keys.statusNoUser");
  if (!user.isTenantMember) return t("settings.integration.keys.statusNotMember", { name: user.username });
  const missing = [
    !user.canManageOffers ? t("settings.integration.keys.rightOffers") : null,
    !user.canManageOrderDrafts ? t("settings.integration.keys.rightOrderDrafts") : null,
  ].filter(Boolean);
  return missing.length ? t("settings.integration.keys.statusMissingRights", { rights: missing.join(", ") }) : null;
}

const KEYS_QUERY_KEY = ["/api/settings/integration-api-keys"] as const;

export default function N8nSettingsSection() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const { data, isLoading } = useQuery<KeysResponse>({
    queryKey: KEYS_QUERY_KEY,
  });
  const keys = data?.keys ?? [];
  const users = data?.users ?? [];
  const fallbackUser = data?.fallbackUser ?? null;
  // Vorschlag: Ersatz-Benutzer, wenn er taugt; sonst der erste geeignete Benutzer des Mandanten
  const suggestedUser = fallbackUser?.ready ? FALLBACK : users.find((u) => u.ready)?.id ?? "";
  const [newKeyUser, setNewKeyUser] = useState<string | null>(null);
  const selectedNewUser = newKeyUser ?? suggestedUser;
  const newUserInfo = selectedNewUser === FALLBACK ? fallbackUser : users.find((u) => u.id === selectedNewUser) ?? null;

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
      const userId = selectedNewUser && selectedNewUser !== FALLBACK ? selectedNewUser : undefined;
      const res = await apiRequest("POST", "/api/settings/integration-api-keys", { name, userId });
      return res.json() as Promise<{ id: string; apiKey: string; warning?: string }>;
    },
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
      setCreatedKey(created.apiKey);
      setCopied(false);
      setNewKeyName("");
      setNewKeyUser(null);
      toast({
        title: t("settings.integration.keys.createdTitle"),
        description: t("settings.integration.keys.createdMessage"),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const assignMutation = useMutation({
    mutationFn: async ({ id, userId }: { id: string; userId: string | null }) => {
      await apiRequest("PATCH", `/api/settings/integration-api-keys/${encodeURIComponent(id)}`, { userId });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: KEYS_QUERY_KEY });
      toast({ title: t("settings.integration.keys.userUpdated") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  /** Auswahl der Benutzer (Mitglieder des Mandanten) samt Ersatz-Benutzer, falls vorhanden */
  const userOptions = (
    <>
      {fallbackUser ? (
        <SelectItem value={FALLBACK}>
          {t("settings.integration.keys.userFallbackOption", { name: fallbackUser.username })}
        </SelectItem>
      ) : null}
      {users.map((user) => (
        <SelectItem key={user.id} value={user.id}>
          {user.username}
          {user.roleName ? ` (${user.roleName})` : ""}
          {user.ready ? "" : ` – ${t("settings.integration.keys.userMissingRightsShort")}`}
        </SelectItem>
      ))}
    </>
  );

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

        <p className="text-xs text-muted-foreground mb-4" data-testid="text-integration-key-user-hint">
          {t("settings.integration.keys.userHint")}
        </p>
        {!fallbackUser && users.length === 0 ? (
          <p className="mb-4 flex items-start gap-2 text-xs text-destructive" role="alert">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {t("settings.integration.keys.noUsers")}
          </p>
        ) : null}
        {selectedNewUser && integrationUserProblem(newUserInfo, t) ? (
          <p className="mb-4 flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400" role="status">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            {integrationUserProblem(newUserInfo, t)}
          </p>
        ) : null}

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
            <Label className="text-xs" htmlFor="integration-key-name">{t("settings.integration.keys.nameLabel")}</Label>
            <Input
              id="integration-key-name"
              className="mt-1"
              placeholder={t("settings.integration.keys.namePlaceholder")}
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
            />
          </div>
          <div className="flex-1 min-w-[220px]">
            <Label className="text-xs" htmlFor="integration-key-user">{t("settings.integration.keys.userLabel")}</Label>
            <Select value={selectedNewUser} onValueChange={setNewKeyUser}>
              <SelectTrigger id="integration-key-user" className="mt-1" data-testid="select-integration-key-user">
                <SelectValue placeholder={t("settings.integration.keys.userPlaceholder")} />
              </SelectTrigger>
              <SelectContent>{userOptions}</SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            disabled={createMutation.isPending || !selectedNewUser}
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
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    {key.name || t("settings.integration.keys.unnamed")}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {t("settings.integration.keys.createdAt", {
                      date: dateFormatter.format(new Date(key.createdAt)),
                    })}
                  </div>
                  {(() => {
                    const problem = integrationUserProblem(key.effectiveUser, t);
                    return (
                      <div
                        className={`mt-1 flex items-start gap-1 text-xs ${problem ? "text-destructive" : "text-muted-foreground"}`}
                        data-testid={`integration-key-status-${key.id}`}
                      >
                        {problem ? <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />}
                        <span>
                          {key.effectiveUser
                            ? t("settings.integration.keys.runsAs", { name: key.effectiveUser.username })
                            : t("settings.integration.keys.runsAsNobody")}
                          {problem ? ` – ${problem}` : ""}
                        </span>
                      </div>
                    );
                  })()}
                </div>
                <Select
                  value={key.userId ?? FALLBACK}
                  onValueChange={(value) => assignMutation.mutate({ id: key.id, userId: value === FALLBACK ? null : value })}
                >
                  <SelectTrigger
                    className="h-8 w-56"
                    aria-label={t("settings.integration.keys.changeUser")}
                    data-testid={`select-integration-key-user-${key.id}`}
                  >
                    <SelectValue placeholder={t("settings.integration.keys.userPlaceholder")} />
                  </SelectTrigger>
                  <SelectContent>
                    {!fallbackUser && !key.userId ? (
                      <SelectItem value={FALLBACK} disabled>
                        {t("settings.integration.keys.userPlaceholder")}
                      </SelectItem>
                    ) : null}
                    {/* gebundener Benutzer, der nicht (mehr) zum Mandanten gehoert: anzeigen, aber nicht waehlbar */}
                    {key.userId && !users.some((user) => user.id === key.userId) ? (
                      <SelectItem value={key.userId} disabled>
                        {key.effectiveUser?.username ?? key.userId}
                      </SelectItem>
                    ) : null}
                    {userOptions}
                  </SelectContent>
                </Select>
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
