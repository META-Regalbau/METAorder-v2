import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Inbox, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { DEFAULT_EMAIL_INTAKE_SETTINGS, type EmailIntakeSettings } from "@shared/emailIntake";

/**
 * E-Mail-Eingang über n8n (Einstellungen -> Integration): n8n holt die Mails ab und fragt bei jedem
 * Lauf diese Einstellungen ab. METAorder erkennt Bestellung / Angebot / Sonstiges, „Sonstiges“ leitet
 * n8n an die Adresse unten weiter; Probleme werden Tickets (server/commercial/emailIntake*.ts).
 */

type IntakeResponse = {
  settings: EmailIntakeSettings;
  assignableUsers: Array<{ id: string; username: string; email: string | null }>;
  categories: Record<string, string>;
};

const KEY = ["/api/settings/email-intake"] as const;
const NO_ASSIGNEE = "__none__";

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export default function EmailIntakeSection() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { data, isLoading } = useQuery<IntakeResponse>({ queryKey: KEY });
  const [form, setForm] = useState<EmailIntakeSettings>(DEFAULT_EMAIL_INTAKE_SETTINGS);

  useEffect(() => {
    if (data?.settings) setForm(data.settings);
  }, [data?.settings]);

  const set = <K extends keyof EmailIntakeSettings>(key: K, value: EmailIntakeSettings[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", "/api/settings/email-intake", form);
      return res.json() as Promise<{ settings: EmailIntakeSettings }>;
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<IntakeResponse>(KEY, (prev) => (prev ? { ...prev, settings: saved.settings } : prev));
      toast({ title: t("settings.integration.emailIntake.saved") });
    },
    onError: (e: Error) => toast({ title: t("common.error"), description: e.message, variant: "destructive" }),
  });

  const users = data?.assignableUsers ?? [];
  const categories = Object.values(data?.categories ?? {});

  return (
    <Card className="p-6" data-testid="card-email-intake">
      <div className="flex items-center gap-2 mb-2">
        <Inbox className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-medium uppercase tracking-wide">{t("settings.integration.emailIntake.title")}</h2>
      </div>
      <p className="text-xs text-muted-foreground mb-4">{t("settings.integration.emailIntake.description")}</p>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("common.loading")}
        </div>
      ) : (
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="flex items-center justify-between gap-4 rounded-md border p-3">
            <div>
              <Label htmlFor="email-intake-enabled" className="text-sm">{t("settings.integration.emailIntake.enabled")}</Label>
              <p className="text-xs text-muted-foreground">{t("settings.integration.emailIntake.enabledHint")}</p>
            </div>
            <Switch
              id="email-intake-enabled"
              checked={form.enabled}
              onCheckedChange={(checked) =>
                setForm((prev) => ({
                  ...prev,
                  enabled: checked,
                  // Beim Einschalten ohne Startdatum: ab heute, damit der Altbestand des Postfachs liegen bleibt
                  processSince: checked && !prev.processSince ? today() : prev.processSince,
                }))
              }
              data-testid="switch-email-intake-enabled"
            />
          </div>

          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="text-xs font-medium mb-2">{t("settings.integration.emailIntake.mailboxSection")}</legend>
            <div>
              <Label className="text-xs" htmlFor="email-intake-mailbox">{t("settings.integration.emailIntake.mailbox")}</Label>
              <Input
                id="email-intake-mailbox"
                className="mt-1"
                type="email"
                placeholder={t("settings.integration.emailIntake.mailboxPlaceholder")}
                value={form.mailbox}
                onChange={(e) => set("mailbox", e.target.value)}
                data-testid="input-email-intake-mailbox"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.integration.emailIntake.mailboxHint")}</p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="email-intake-folder">{t("settings.integration.emailIntake.folder")}</Label>
              <Input
                id="email-intake-folder"
                className="mt-1"
                value={form.processedFolderName}
                onChange={(e) => set("processedFolderName", e.target.value)}
                data-testid="input-email-intake-folder"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.integration.emailIntake.folderHint")}</p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="email-intake-since">{t("settings.integration.emailIntake.processSince")}</Label>
              <Input
                id="email-intake-since"
                className="mt-1"
                type="date"
                value={form.processSince}
                onChange={(e) => set("processSince", e.target.value)}
                data-testid="input-email-intake-since"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.integration.emailIntake.processSinceHint")}</p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="email-intake-max">{t("settings.integration.emailIntake.maxPerRun")}</Label>
              <Input
                id="email-intake-max"
                className="mt-1"
                type="number"
                min={1}
                max={50}
                value={form.maxPerRun}
                onChange={(e) => set("maxPerRun", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                data-testid="input-email-intake-max"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.integration.emailIntake.maxPerRunHint")}</p>
            </div>
          </fieldset>

          <fieldset className="grid gap-3 md:grid-cols-2">
            <legend className="text-xs font-medium mb-2">{t("settings.integration.emailIntake.otherSection")}</legend>
            <div>
              <Label className="text-xs" htmlFor="email-intake-forward">{t("settings.integration.emailIntake.forwardTo")}</Label>
              <Input
                id="email-intake-forward"
                className="mt-1"
                type="email"
                placeholder="info@meta-online.com"
                value={form.forwardOtherTo}
                onChange={(e) => set("forwardOtherTo", e.target.value)}
                data-testid="input-email-intake-forward"
              />
              <p className="text-xs text-muted-foreground mt-1">
                {form.forwardOtherTo.trim()
                  ? t("settings.integration.emailIntake.forwardToHint")
                  : t("settings.integration.emailIntake.forwardToEmpty")}
              </p>
            </div>
            <div>
              <Label className="text-xs" htmlFor="email-intake-confidence">{t("settings.integration.emailIntake.otherMinConfidence")}</Label>
              <Input
                id="email-intake-confidence"
                className="mt-1"
                type="number"
                min={50}
                max={100}
                step={5}
                value={Math.round(form.otherMinConfidence * 100)}
                onChange={(e) => set("otherMinConfidence", Math.max(50, Math.min(100, Number(e.target.value) || 70)) / 100)}
                data-testid="input-email-intake-confidence"
              />
              <p className="text-xs text-muted-foreground mt-1">{t("settings.integration.emailIntake.otherMinConfidenceHint")}</p>
            </div>
          </fieldset>

          <fieldset className="space-y-3">
            <legend className="text-xs font-medium mb-2">{t("settings.integration.emailIntake.ticketSection")}</legend>
            {(
              [
                ["ticketOnFailure", "ticketOnFailure"],
                ["ticketOnShopwareError", "ticketOnShopwareError"],
                ["ticketOnMarginRed", "ticketOnMarginRed"],
              ] as const
            ).map(([key, label]) => (
              <div key={key} className="flex items-center justify-between gap-4">
                <Label htmlFor={`email-intake-${key}`} className="text-sm font-normal">
                  {t(`settings.integration.emailIntake.${label}`)}
                </Label>
                <Switch
                  id={`email-intake-${key}`}
                  checked={form[key]}
                  onCheckedChange={(checked) => set(key, checked)}
                  data-testid={`switch-email-intake-${key}`}
                />
              </div>
            ))}
            <div className="md:w-1/2">
              <Label className="text-xs" htmlFor="email-intake-assignee">{t("settings.integration.emailIntake.defaultAssignee")}</Label>
              <Select
                value={form.defaultAssigneeUserId ?? NO_ASSIGNEE}
                onValueChange={(value) => set("defaultAssigneeUserId", value === NO_ASSIGNEE ? null : value)}
              >
                <SelectTrigger id="email-intake-assignee" className="mt-1" data-testid="select-email-intake-assignee">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_ASSIGNEE}>{t("settings.integration.emailIntake.noAssignee")}</SelectItem>
                  {users.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.username}
                      {u.email ? ` (${u.email})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-xs text-muted-foreground">{t("settings.integration.emailIntake.assigneeChain")}</p>
          </fieldset>

          {categories.length > 0 ? (
            <div className="text-xs text-muted-foreground">
              <p className="mb-1">{t("settings.integration.emailIntake.categoriesHint")}</p>
              <div className="flex flex-wrap gap-1">
                {categories.map((c) => (
                  <Badge key={c} variant="outline" className="font-normal">
                    {c}
                  </Badge>
                ))}
              </div>
            </div>
          ) : null}

          <p className="text-xs text-muted-foreground">{t("settings.integration.emailIntake.workflowHint")}</p>

          <Button type="submit" disabled={save.isPending} data-testid="button-email-intake-save">
            {save.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t("common.save")}
          </Button>
        </form>
      )}
    </Card>
  );
}
