/**
 * Einstellungen → Integration: SFTP-Server für die DMS-Übergabe (Lobster → d.3).
 *
 * Mehrere Server je Mandant. Beilagen der KI-Auftragsanlage (Kundenlieferschein u. a.)
 * werden nach der Bestellanlage automatisch hochgeladen; hier werden Zugangsdaten,
 * Zielpfad, Dateinamen-Schema und Belegarten gepflegt. Secrets werden nie zurückgeliefert
 * (nur hasPassword / hasPrivateKey).
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { apiRequest, queryClient, readJsonBody } from "@/lib/queryClient";
import { Loader2, Plus, Pencil, Trash2, PlugZap, RefreshCw, Server } from "lucide-react";

type DocumentKind = "delivery_note" | "order_confirmation" | "invoice" | "other";
const DOCUMENT_KINDS: DocumentKind[] = ["delivery_note", "order_confirmation", "invoice", "other"];
const DEFAULT_TEMPLATE = "{orderNumber}_{documentKind}_{originalName}";

type SftpServerApi = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authMethod: "password" | "key";
  hostKeyFingerprint: string | null;
  remotePath: string;
  filenameTemplate: string;
  documentKinds: DocumentKind[];
  writeMetadataSidecar: boolean;
  autoUploadOnOrderCreate: boolean;
  enabled: boolean;
  maxAttempts: number;
  initialBackoffMs: number;
  backoffFactor: number;
  timeoutMs: number;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
  createdAt: string;
  updatedAt: string;
};

type SftpUploadLog = {
  id: string;
  requestId: string;
  serverName: string;
  trigger: string;
  draftId: string | null;
  fileName: string | null;
  remotePath: string | null;
  status: "pending" | "success" | "failed" | "skipped";
  errorMessage: string | null;
  attempt: number;
  durationMs: number | null;
  executedAt: string;
  payload: { orderNumber?: string | null; buyerDocumentNumber?: string | null } | null;
};

type FormState = {
  name: string;
  host: string;
  port: string;
  username: string;
  authMethod: "password" | "key";
  password: string;
  privateKey: string;
  passphrase: string;
  hostKeyFingerprint: string;
  remotePath: string;
  filenameTemplate: string;
  documentKinds: DocumentKind[];
  writeMetadataSidecar: boolean;
  autoUploadOnOrderCreate: boolean;
  enabled: boolean;
  maxAttempts: string;
  initialBackoffMs: string;
  backoffFactor: string;
  timeoutMs: string;
};

const SERVERS_KEY = ["/api/settings/sftp-servers"] as const;
const LOGS_KEY = ["/api/settings/sftp-servers/logs"] as const;

function emptyForm(): FormState {
  return {
    name: "",
    host: "",
    port: "22",
    username: "",
    authMethod: "password",
    password: "",
    privateKey: "",
    passphrase: "",
    hostKeyFingerprint: "",
    remotePath: "/",
    filenameTemplate: DEFAULT_TEMPLATE,
    documentKinds: ["delivery_note"],
    writeMetadataSidecar: true,
    autoUploadOnOrderCreate: true,
    enabled: true,
    maxAttempts: "3",
    initialBackoffMs: "2000",
    backoffFactor: "2",
    timeoutMs: "20000",
  };
}

function formFromServer(s: SftpServerApi): FormState {
  return {
    name: s.name,
    host: s.host,
    port: String(s.port),
    username: s.username,
    authMethod: s.authMethod,
    password: "",
    privateKey: "",
    passphrase: "",
    hostKeyFingerprint: s.hostKeyFingerprint ?? "",
    remotePath: s.remotePath,
    filenameTemplate: s.filenameTemplate,
    documentKinds: s.documentKinds?.length ? s.documentKinds : ["delivery_note"],
    writeMetadataSidecar: s.writeMetadataSidecar,
    autoUploadOnOrderCreate: s.autoUploadOnOrderCreate,
    enabled: s.enabled,
    maxAttempts: String(s.maxAttempts),
    initialBackoffMs: String(s.initialBackoffMs),
    backoffFactor: String(s.backoffFactor),
    timeoutMs: String(s.timeoutMs),
  };
}

/** Body für POST/PATCH — leere Secrets werden beim Bearbeiten weggelassen (= unverändert). */
function formToBody(f: FormState, editing: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: f.name.trim(),
    host: f.host.trim(),
    port: Number(f.port) || 22,
    username: f.username.trim(),
    authMethod: f.authMethod,
    hostKeyFingerprint: f.hostKeyFingerprint.trim() || null,
    remotePath: f.remotePath.trim() || "/",
    filenameTemplate: f.filenameTemplate.trim() || DEFAULT_TEMPLATE,
    documentKinds: f.documentKinds,
    writeMetadataSidecar: f.writeMetadataSidecar,
    autoUploadOnOrderCreate: f.autoUploadOnOrderCreate,
    enabled: f.enabled,
    maxAttempts: Number(f.maxAttempts) || 3,
    initialBackoffMs: Number(f.initialBackoffMs) || 2000,
    backoffFactor: Number(f.backoffFactor) || 2,
    timeoutMs: Number(f.timeoutMs) || 20000,
  };
  if (!editing || f.password.trim()) body.password = f.password;
  if (!editing || f.privateKey.trim()) body.privateKey = f.privateKey;
  if (!editing || f.passphrase.trim()) body.passphrase = f.passphrase;
  return body;
}

export default function SftpServersSection() {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const { data: servers = [], isLoading } = useQuery<SftpServerApi[]>({ queryKey: SERVERS_KEY });
  const {
    data: logsData,
    isFetching: logsFetching,
    refetch: refetchLogs,
  } = useQuery<{ logs: SftpUploadLog[]; total: number }>({
    queryKey: [...LOGS_KEY, { limit: 25 }],
    queryFn: async () => readJsonBody(await apiRequest("GET", `${LOGS_KEY[0]}?limit=25`)),
  });
  const logs = logsData?.logs ?? [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [deleteTarget, setDeleteTarget] = useState<SftpServerApi | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const editing = useMemo(() => servers.find((s) => s.id === editingId) ?? null, [servers, editingId]);

  const openCreate = () => {
    setEditingId(null);
    setForm(emptyForm());
    setShowAdvanced(false);
    setDialogOpen(true);
  };
  const openEdit = (s: SftpServerApi) => {
    setEditingId(s.id);
    setForm(formFromServer(s));
    setShowAdvanced(false);
    setDialogOpen(true);
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: SERVERS_KEY });
    queryClient.invalidateQueries({ queryKey: LOGS_KEY });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = formToBody(form, Boolean(editingId));
      const res = editingId
        ? await apiRequest("PATCH", `/api/settings/sftp-servers/${encodeURIComponent(editingId)}`, body)
        : await apiRequest("POST", "/api/settings/sftp-servers", body);
      return readJsonBody<SftpServerApi>(res);
    },
    onSuccess: () => {
      invalidate();
      setDialogOpen(false);
      toast({ title: t("settings.sftp.saved"), description: t("settings.sftp.savedMessage", { name: form.name }) });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const testMutation = useMutation({
    mutationFn: async (target: { id?: string; fromForm: boolean }) => {
      const body = target.fromForm ? formToBody(form, Boolean(target.id)) : {};
      const url = target.id
        ? `/api/settings/sftp-servers/${encodeURIComponent(target.id)}/test`
        : "/api/settings/sftp-servers/test";
      const res = await apiRequest("POST", url, body);
      return readJsonBody<{ ok: boolean; message: string; entries?: number; pathExists?: boolean; durationMs?: number }>(res);
    },
    onSuccess: (data) => {
      toast({
        title: data.ok ? t("settings.sftp.testOk") : t("settings.sftp.testFailed"),
        description: data.message,
        variant: data.ok ? "default" : "destructive",
      });
      queryClient.invalidateQueries({ queryKey: LOGS_KEY });
    },
    onError: (e: Error) => toast({ title: t("settings.sftp.testFailed"), description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/settings/sftp-servers/${encodeURIComponent(id)}`);
    },
    onSuccess: () => {
      invalidate();
      toast({ title: t("settings.sftp.deleted") });
      setDeleteTarget(null);
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const toggleEnabled = useMutation({
    mutationFn: async (s: SftpServerApi) => {
      await apiRequest("PATCH", `/api/settings/sftp-servers/${encodeURIComponent(s.id)}`, { enabled: !s.enabled });
    },
    onSuccess: invalidate,
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((prev) => ({ ...prev, [key]: value }));
  const toggleKind = (kind: DocumentKind, checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      documentKinds: checked ? Array.from(new Set([...prev.documentKinds, kind])) : prev.documentKinds.filter((k) => k !== kind),
    }));

  const kindLabel = (k: DocumentKind) => t(`settings.sftp.kinds.${k}`);
  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(i18n.language);
    } catch {
      return iso;
    }
  };

  const formValid =
    form.name.trim() &&
    form.host.trim() &&
    form.username.trim() &&
    form.documentKinds.length > 0 &&
    (editingId
      ? true
      : form.authMethod === "key"
        ? form.privateKey.trim()
        : form.password.trim());

  return (
    <Card className="p-6" data-testid="sftp-servers-section">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="text-sm font-medium uppercase tracking-wide flex items-center gap-2">
            <Server className="h-4 w-4" />
            {t("settings.sftp.title")}
          </h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl">{t("settings.sftp.description")}</p>
        </div>
        <Button type="button" size="sm" onClick={openCreate} data-testid="button-sftp-add">
          <Plus className="mr-1 h-4 w-4" />
          {t("settings.sftp.add")}
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground text-sm py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : servers.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4">{t("settings.sftp.empty")}</p>
      ) : (
        <div className="space-y-3 mt-4">
          {servers.map((s) => (
            <div key={s.id} className="border rounded-lg p-4 space-y-2" data-testid={`sftp-server-${s.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="font-medium text-sm">{s.name}</span>
                  <Badge variant={s.enabled ? "default" : "secondary"} className="text-[10px]">
                    {s.enabled ? t("settings.sftp.enabled") : t("settings.sftp.disabled")}
                  </Badge>
                  {s.autoUploadOnOrderCreate && (
                    <Badge variant="outline" className="text-[10px]">
                      {t("settings.sftp.autoBadge")}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Label className="text-xs">{t("settings.sftp.enabled")}</Label>
                  <Switch checked={s.enabled} disabled={toggleEnabled.isPending} onCheckedChange={() => toggleEnabled.mutate(s)} />
                </div>
              </div>
              <div className="text-xs text-muted-foreground font-mono break-all">
                sftp://{s.username}@{s.host}:{s.port}
                {s.remotePath}
              </div>
              <div className="text-xs text-muted-foreground">
                {t("settings.sftp.kindsLabel")}: {s.documentKinds.map(kindLabel).join(", ")} ·{" "}
                {t("settings.sftp.templateLabel")}: <span className="font-mono">{s.filenameTemplate}</span>
                {s.writeMetadataSidecar ? ` · ${t("settings.sftp.sidecarShort")}` : ""}
                {s.hostKeyFingerprint ? ` · ${t("settings.sftp.hostKeyVerified")}` : ""}
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" size="sm" variant="secondary" onClick={() => openEdit(s)}>
                  <Pencil className="mr-1 h-3.5 w-3.5" />
                  {t("common.edit", "Bearbeiten")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={testMutation.isPending}
                  onClick={() => testMutation.mutate({ id: s.id, fromForm: false })}
                >
                  {testMutation.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlugZap className="mr-1 h-3.5 w-3.5" />}
                  {t("settings.sftp.test")}
                </Button>
                <Button type="button" size="sm" variant="ghost" className="text-destructive" onClick={() => setDeleteTarget(s)}>
                  <Trash2 className="mr-1 h-3.5 w-3.5" />
                  {t("common.delete")}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Upload-Protokoll */}
      <div className="mt-6 border-t pt-4">
        <div className="flex items-center justify-between gap-2 mb-2">
          <h3 className="text-xs font-medium uppercase tracking-wide">{t("settings.sftp.logs.title")}</h3>
          <Button type="button" size="sm" variant="ghost" onClick={() => refetchLogs()} disabled={logsFetching}>
            <RefreshCw className={`h-3.5 w-3.5 ${logsFetching ? "animate-spin" : ""}`} />
          </Button>
        </div>
        {logs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t("settings.sftp.logs.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="py-1 pr-3 font-medium">{t("settings.sftp.logs.time")}</th>
                  <th className="py-1 pr-3 font-medium">{t("settings.sftp.logs.server")}</th>
                  <th className="py-1 pr-3 font-medium">{t("settings.sftp.logs.file")}</th>
                  <th className="py-1 pr-3 font-medium">{t("settings.sftp.logs.order")}</th>
                  <th className="py-1 pr-3 font-medium">{t("settings.sftp.logs.status")}</th>
                  <th className="py-1 font-medium">{t("settings.sftp.logs.detail")}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="py-1 pr-3 whitespace-nowrap">{formatDate(l.executedAt)}</td>
                    <td className="py-1 pr-3">{l.serverName}</td>
                    <td className="py-1 pr-3 break-all">{l.fileName ?? "—"}</td>
                    <td className="py-1 pr-3 whitespace-nowrap">{l.payload?.orderNumber || l.payload?.buyerDocumentNumber || "—"}</td>
                    <td className="py-1 pr-3">
                      <Badge
                        variant={l.status === "success" ? "default" : l.status === "failed" ? "destructive" : "secondary"}
                        className="text-[10px]"
                      >
                        {t(`settings.sftp.logs.statuses.${l.status}`)}
                        {l.attempt > 1 ? ` (${l.attempt})` : ""}
                      </Badge>
                    </td>
                    <td className="py-1 break-all text-muted-foreground">
                      {l.status === "success" ? l.remotePath : l.errorMessage || l.remotePath || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Anlegen / Bearbeiten */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t("settings.sftp.editTitle", { name: editing.name }) : t("settings.sftp.addTitle")}</DialogTitle>
            <DialogDescription>{t("settings.sftp.dialogDescription")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("settings.sftp.fields.name")}</Label>
              <Input className="mt-1" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder={t("settings.sftp.fields.namePlaceholder")} />
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.host")}</Label>
              <Input className="mt-1 font-mono text-sm" value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="sftp.example.com" />
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.port")}</Label>
              <Input className="mt-1 font-mono text-sm" type="number" min={1} max={65535} value={form.port} onChange={(e) => set("port", e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.username")}</Label>
              <Input className="mt-1 font-mono text-sm" value={form.username} onChange={(e) => set("username", e.target.value)} autoComplete="off" />
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.authMethod")}</Label>
              <Select value={form.authMethod} onValueChange={(v) => set("authMethod", v as FormState["authMethod"])}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="password">{t("settings.sftp.fields.authPassword")}</SelectItem>
                  <SelectItem value="key">{t("settings.sftp.fields.authKey")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.authMethod === "password" ? (
              <div className="sm:col-span-2">
                <Label className="text-xs">{t("settings.sftp.fields.password")}</Label>
                <Input
                  className="mt-1 font-mono text-sm"
                  type="password"
                  autoComplete="new-password"
                  value={form.password}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder={editing?.hasPassword ? t("settings.sftp.fields.secretConfigured") : ""}
                />
              </div>
            ) : (
              <>
                <div className="sm:col-span-2">
                  <Label className="text-xs">{t("settings.sftp.fields.privateKey")}</Label>
                  <Textarea
                    className="mt-1 font-mono text-xs min-h-[120px]"
                    value={form.privateKey}
                    onChange={(e) => set("privateKey", e.target.value)}
                    placeholder={editing?.hasPrivateKey ? t("settings.sftp.fields.secretConfigured") : "-----BEGIN OPENSSH PRIVATE KEY-----"}
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label className="text-xs">{t("settings.sftp.fields.passphrase")}</Label>
                  <Input
                    className="mt-1 font-mono text-sm"
                    type="password"
                    autoComplete="new-password"
                    value={form.passphrase}
                    onChange={(e) => set("passphrase", e.target.value)}
                    placeholder={editing?.hasPassphrase ? t("settings.sftp.fields.secretConfigured") : t("settings.sftp.fields.optional")}
                  />
                </div>
              </>
            )}
            <div className="sm:col-span-2">
              <Label className="text-xs">{t("settings.sftp.fields.hostKeyFingerprint")}</Label>
              <Input
                className="mt-1 font-mono text-sm"
                value={form.hostKeyFingerprint}
                onChange={(e) => set("hostKeyFingerprint", e.target.value)}
                placeholder="SHA256:…"
              />
              <p className="text-[11px] text-muted-foreground mt-1">{t("settings.sftp.fields.hostKeyHelp")}</p>
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.remotePath")}</Label>
              <Input className="mt-1 font-mono text-sm" value={form.remotePath} onChange={(e) => set("remotePath", e.target.value)} placeholder="/in/lieferscheine" />
            </div>
            <div>
              <Label className="text-xs">{t("settings.sftp.fields.filenameTemplate")}</Label>
              <Input className="mt-1 font-mono text-sm" value={form.filenameTemplate} onChange={(e) => set("filenameTemplate", e.target.value)} placeholder={DEFAULT_TEMPLATE} />
            </div>
            <div className="sm:col-span-2 text-[11px] text-muted-foreground -mt-2">
              {t("settings.sftp.fields.templateHelp")}{" "}
              <span className="font-mono">
                {"{orderNumber} {customerNumber} {buyerDocumentNumber} {deliveryNoteNumber} {invoiceNumber} {commission} {customerReference} {documentKind} {date} {originalName} {draftId} {attachmentId}"}
              </span>
            </div>

            <div className="sm:col-span-2">
              <Label className="text-xs">{t("settings.sftp.kindsLabel")}</Label>
              <div className="mt-2 flex flex-wrap gap-4">
                {DOCUMENT_KINDS.map((k) => (
                  <label key={k} className="flex items-center gap-2 text-sm">
                    <Checkbox checked={form.documentKinds.includes(k)} onCheckedChange={(v) => toggleKind(k, v === true)} />
                    {kindLabel(k)}
                  </label>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 border rounded-md p-3">
              <div>
                <Label className="text-xs">{t("settings.sftp.fields.autoUpload")}</Label>
                <p className="text-[11px] text-muted-foreground">{t("settings.sftp.fields.autoUploadHelp")}</p>
              </div>
              <Switch checked={form.autoUploadOnOrderCreate} onCheckedChange={(v) => set("autoUploadOnOrderCreate", v)} />
            </div>
            <div className="flex items-center justify-between gap-2 border rounded-md p-3">
              <div>
                <Label className="text-xs">{t("settings.sftp.fields.sidecar")}</Label>
                <p className="text-[11px] text-muted-foreground">{t("settings.sftp.fields.sidecarHelp")}</p>
              </div>
              <Switch checked={form.writeMetadataSidecar} onCheckedChange={(v) => set("writeMetadataSidecar", v)} />
            </div>
            <div className="flex items-center justify-between gap-2 border rounded-md p-3 sm:col-span-2">
              <Label className="text-xs">{t("settings.sftp.enabled")}</Label>
              <Switch checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
            </div>

            <div className="sm:col-span-2">
              <button type="button" className="text-xs text-primary underline" onClick={() => setShowAdvanced((v) => !v)}>
                {showAdvanced ? t("settings.sftp.hideAdvanced") : t("settings.sftp.showAdvanced")}
              </button>
            </div>
            {showAdvanced && (
              <>
                <div>
                  <Label className="text-xs">{t("settings.sftp.fields.maxAttempts")}</Label>
                  <Input className="mt-1" type="number" min={1} max={5} value={form.maxAttempts} onChange={(e) => set("maxAttempts", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t("settings.sftp.fields.initialBackoffMs")}</Label>
                  <Input className="mt-1" type="number" min={500} max={60000} value={form.initialBackoffMs} onChange={(e) => set("initialBackoffMs", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t("settings.sftp.fields.backoffFactor")}</Label>
                  <Input className="mt-1" type="number" step="0.1" min={1} max={5} value={form.backoffFactor} onChange={(e) => set("backoffFactor", e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">{t("settings.sftp.fields.timeoutMs")}</Label>
                  <Input className="mt-1" type="number" min={1000} max={120000} value={form.timeoutMs} onChange={(e) => set("timeoutMs", e.target.value)} />
                </div>
              </>
            )}
          </div>

          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              disabled={testMutation.isPending || !form.host.trim() || !form.username.trim()}
              onClick={() => testMutation.mutate({ id: editingId ?? undefined, fromForm: true })}
            >
              {testMutation.isPending ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <PlugZap className="mr-1 h-4 w-4" />}
              {t("settings.sftp.test")}
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button type="button" disabled={!formValid || saveMutation.isPending} onClick={() => saveMutation.mutate()} data-testid="button-sftp-save">
                {saveMutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("settings.sftp.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("settings.sftp.deleteConfirm", { name: deleteTarget?.name ?? "" })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
            >
              {t("common.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
