import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ClipboardList, Loader2, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  SHOP_PULSE_ACTION_KINDS,
  SHOP_PULSE_ACTION_SCOPES,
  type ShopPulseAction,
  type ShopPulseActionScopeType,
  type ShopPulseActionsOverview,
  type ShopPulseImportResult,
} from "@shared/shopPulseWeekly";

/**
 * Shop-Puls, Reiter „Maßnahmen-Protokoll“ (Stufe 2, S2-1): jede Änderung am Shop mit Zeitpunkt, Bereich und
 * wer. Automatische Einträge übernimmt der Server beim Laden; von Hand eintragen, bearbeiten, löschen;
 * Live-Protokolle (`*-Protokoll-Live-*.json`) einmalig hochladen. Texte der Einträge sind deutsch (Fakten wie
 * in den Protokollen). Server: server/routes/shopPulseWeeklyRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/actions"];

type Draft = { id: string | null; occurredAt: string; title: string; description: string; scopeType: ShopPulseActionScopeType; scopeValues: string; actor: string };

/** Zeitpunkt für <input type="datetime-local"> in Ortszeit */
function localInputValue(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const emptyDraft = (): Draft => ({ id: null, occurredAt: localInputValue(new Date().toISOString()), title: "", description: "", scopeType: "shop", scopeValues: "", actor: "" });

export function ShopPulseActionsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const fileInput = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("all");
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<ShopPulseImportResult | null>(null);

  const query = useQuery<ShopPulseActionsOverview>({ queryKey: QUERY_KEY });
  const setData = (next: ShopPulseActionsOverview) => queryClient.setQueryData(QUERY_KEY, { actions: next.actions });

  const saveMutation = useMutation({
    mutationFn: async (d: Draft) => {
      const body = {
        occurredAt: new Date(d.occurredAt).toISOString(),
        title: d.title.trim(),
        description: d.description.trim(),
        scope: { type: d.scopeType, values: d.scopeType === "shop" ? [] : d.scopeValues.split(/[\n,;]+/).map((v) => v.trim()).filter(Boolean) },
        actor: d.actor.trim() || null,
      };
      const res = d.id ? await apiRequest("PUT", `/api/shop-pulse/actions/${encodeURIComponent(d.id)}`, body) : await apiRequest("POST", "/api/shop-pulse/actions", body);
      return res.json() as Promise<ShopPulseActionsOverview>;
    },
    onSuccess: (next) => {
      setData(next);
      setDraft(null);
      toast({ title: t("shopPulse.actions.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.actions.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => (await apiRequest("DELETE", `/api/shop-pulse/actions/${encodeURIComponent(id)}`)).json() as Promise<ShopPulseActionsOverview>,
    onSuccess: (next) => {
      setData(next);
      setConfirmDelete(null);
      toast({ title: t("shopPulse.actions.deleted") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.actions.deleteFailed"), description: error.message, variant: "destructive" }),
  });
  const importMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const payload = { files: await Promise.all(files.map(async (f) => ({ name: f.name, content: await f.text() }))) };
      return (await apiRequest("POST", "/api/shop-pulse/actions/import", payload)).json() as Promise<ShopPulseImportResult & ShopPulseActionsOverview>;
    },
    onSuccess: (next) => {
      setData(next);
      setImportResult({ imported: next.imported, skipped: next.skipped });
      toast({ title: t("shopPulse.actions.importDone", { imported: next.imported, skipped: next.skipped.length }) });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.actions.importFailed"), description: error.message, variant: "destructive" }),
  });

  const actions = (query.data?.actions ?? []).filter((a) => kindFilter === "all" || a.kind === kindFilter);
  const scopeText = (a: Pick<ShopPulseAction, "scope">) => {
    const s = a.scope;
    if (s.type === "shop" || !s.values.length) return t("shopPulse.weekly.scope.shop");
    if (s.type === "products") return t("shopPulse.weekly.scope.products", { count: s.values.length });
    return t(`shopPulse.weekly.scope.${s.type}`, { values: s.values.slice(0, 4).join(", ") + (s.values.length > 4 ? " …" : "") });
  };
  const edit = (a: ShopPulseAction) =>
    setDraft({ id: a.id, occurredAt: localInputValue(a.occurredAt), title: a.title, description: a.description, scopeType: a.scope.type, scopeValues: a.scope.values.join("\n"), actor: a.actor ?? "" });
  const draftValid = !!draft && draft.title.trim() !== "" && !Number.isNaN(Date.parse(draft.occurredAt)) && (draft.scopeType === "shop" || draft.scopeValues.trim() !== "");

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3" data-testid="shop-pulse-actions-head">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-3xl">
            <h2 className="font-semibold flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("shopPulse.actions.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("shopPulse.actions.hint")}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setDraft(emptyDraft())} disabled={!!draft} data-testid="button-shop-pulse-action-add">
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              {t("shopPulse.actions.add")}
            </Button>
            <Button size="sm" variant="outline" onClick={() => fileInput.current?.click()} disabled={importMutation.isPending} data-testid="button-shop-pulse-action-import">
              {importMutation.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" aria-hidden="true" />}
              {t("shopPulse.actions.import")}
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".json,application/json"
              multiple
              className="hidden"
              aria-label={t("shopPulse.actions.import")}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) importMutation.mutate(files);
              }}
              data-testid="input-shop-pulse-action-import"
            />
          </div>
        </div>
        <p className="text-xs text-muted-foreground max-w-3xl">{t("shopPulse.actions.importHint")}</p>
        {importResult ? (
          <div className="rounded-md border bg-muted/40 p-3 text-sm" role="status" data-testid="shop-pulse-import-result">
            <p>{t("shopPulse.actions.importDone", { imported: importResult.imported, skipped: importResult.skipped.length })}</p>
            {importResult.skipped.length ? (
              <ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">
                {importResult.skipped.map((s) => (
                  <li key={s.name}>
                    {s.name}: {t(`shopPulse.actions.skip.${s.reason}`)}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </Card>

      {draft ? (
        <Card className="p-4 space-y-3" data-testid="shop-pulse-action-form">
          <h3 className="font-medium">{draft.id ? t("shopPulse.actions.editTitle") : t("shopPulse.actions.addTitle")}</h3>
          <form
            className="grid gap-3 md:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftValid) saveMutation.mutate(draft);
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-action-at">{t("shopPulse.actions.fields.occurredAt")}</Label>
              <Input id="shop-pulse-action-at" type="datetime-local" value={draft.occurredAt} onChange={(e) => setDraft({ ...draft, occurredAt: e.target.value })} required data-testid="input-shop-pulse-action-at" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-action-actor">{t("shopPulse.actions.fields.actor")}</Label>
              <Input id="shop-pulse-action-actor" value={draft.actor} maxLength={120} onChange={(e) => setDraft({ ...draft, actor: e.target.value })} data-testid="input-shop-pulse-action-actor" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="shop-pulse-action-title">{t("shopPulse.actions.fields.title")}</Label>
              <Input
                id="shop-pulse-action-title"
                value={draft.title}
                maxLength={200}
                placeholder={t("shopPulse.actions.fields.titlePlaceholder")}
                onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                required
                data-testid="input-shop-pulse-action-title"
              />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label htmlFor="shop-pulse-action-description">{t("shopPulse.actions.fields.description")}</Label>
              <Textarea id="shop-pulse-action-description" value={draft.description} maxLength={4000} rows={3} onChange={(e) => setDraft({ ...draft, description: e.target.value })} data-testid="input-shop-pulse-action-description" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="shop-pulse-action-scope">{t("shopPulse.actions.fields.scope")}</Label>
              <Select value={draft.scopeType} onValueChange={(v) => setDraft({ ...draft, scopeType: v as ShopPulseActionScopeType })}>
                <SelectTrigger id="shop-pulse-action-scope" data-testid="select-shop-pulse-action-scope">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOP_PULSE_ACTION_SCOPES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {t(`shopPulse.actions.scopeTypes.${s}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {draft.scopeType !== "shop" ? (
              <div className="space-y-1">
                <Label htmlFor="shop-pulse-action-values">{t(`shopPulse.actions.scopeValues.${draft.scopeType}`)}</Label>
                <Textarea
                  id="shop-pulse-action-values"
                  value={draft.scopeValues}
                  rows={3}
                  aria-describedby="shop-pulse-action-values-hint"
                  onChange={(e) => setDraft({ ...draft, scopeValues: e.target.value })}
                  data-testid="input-shop-pulse-action-values"
                />
                <p id="shop-pulse-action-values-hint" className="text-xs text-muted-foreground">
                  {t("shopPulse.actions.scopeValuesHint")}
                </p>
              </div>
            ) : null}
            <div className="flex gap-2 md:col-span-2">
              <Button type="submit" disabled={!draftValid || saveMutation.isPending} data-testid="button-shop-pulse-action-save">
                {saveMutation.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                {t("shopPulse.actions.save")}
              </Button>
              <Button type="button" variant="outline" onClick={() => setDraft(null)} data-testid="button-shop-pulse-action-cancel">
                {t("shopPulse.signals.cancel")}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card className="overflow-x-auto">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h3 className="font-medium">{t("shopPulse.actions.listTitle", { count: actions.length })}</h3>
          <div className="flex items-center gap-2">
            <Label htmlFor="shop-pulse-action-filter" className="text-sm">
              {t("shopPulse.actions.filter")}
            </Label>
            <Select value={kindFilter} onValueChange={setKindFilter}>
              <SelectTrigger id="shop-pulse-action-filter" className="w-56" data-testid="select-shop-pulse-action-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("shopPulse.actions.filterAll")}</SelectItem>
                {SHOP_PULSE_ACTION_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {t(`shopPulse.actions.kinds.${k}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {query.isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("shopPulse.loading")}
          </div>
        ) : query.isError ? (
          <p className="p-4 text-sm text-destructive">{t("shopPulse.actions.loadError")}</p>
        ) : actions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="shop-pulse-actions-empty">
            {t("shopPulse.actions.empty")}
          </p>
        ) : (
          <Table data-testid="shop-pulse-actions">
            <TableHeader>
              <TableRow>
                <TableHead className="w-40">{t("shopPulse.actions.columns.at")}</TableHead>
                <TableHead>{t("shopPulse.actions.columns.what")}</TableHead>
                <TableHead>{t("shopPulse.actions.columns.scope")}</TableHead>
                <TableHead>{t("shopPulse.actions.columns.who")}</TableHead>
                <TableHead>{t("shopPulse.actions.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {actions.map((a) => (
                <TableRow key={a.id} data-testid={`row-shop-pulse-action-${a.id}`}>
                  <TableCell className="align-top text-sm whitespace-nowrap">{fmt.dateTime(a.occurredAt)}</TableCell>
                  <TableCell className="align-top">
                    <Badge variant="outline" className="mb-1">
                      {t(`shopPulse.actions.kinds.${a.kind}`)}
                    </Badge>
                    <div className="font-medium break-words max-w-xl" lang="de">
                      {a.title}
                    </div>
                    {a.description ? (
                      <div className="text-xs text-muted-foreground whitespace-pre-line break-words max-w-xl line-clamp-4" lang="de">
                        {a.description}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-sm max-w-xs break-words" title={a.scope.values.slice(0, 50).join("\n") || undefined}>
                    {scopeText(a)}
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <div>{a.actor ?? "–"}</div>
                    <div className="text-xs text-muted-foreground">{t(`shopPulse.actions.sources.${a.source}`)}</div>
                  </TableCell>
                  <TableCell className="align-top">
                    {confirmDelete === a.id ? (
                      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("shopPulse.actions.confirmDelete")}>
                        <span className="text-xs">{t("shopPulse.actions.confirmDelete")}</span>
                        <Button size="sm" variant="destructive" disabled={deleteMutation.isPending} onClick={() => deleteMutation.mutate(a.id)} data-testid={`button-shop-pulse-action-delete-confirm-${a.id}`}>
                          {t("shopPulse.actions.delete")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(null)}>
                          {t("shopPulse.signals.cancel")}
                        </Button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => edit(a)} aria-label={t("shopPulse.actions.edit")} data-testid={`button-shop-pulse-action-edit-${a.id}`}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(a.id)} aria-label={t("shopPulse.actions.delete")} data-testid={`button-shop-pulse-action-delete-${a.id}`}>
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
