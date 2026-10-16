import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PORTAL_REGISTRATION_CATEGORIES, type PortalRegistrationSettings } from "@shared/portalRegistrations";

const QUERY_KEY = ["/api/b2b/registration-settings"];

export default function RegistrationSettingsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useQuery<{ settings: PortalRegistrationSettings }>({ queryKey: QUERY_KEY });
  const [form, setForm] = useState<PortalRegistrationSettings | null>(null);

  useEffect(() => {
    if (query.data?.settings) setForm(query.data.settings);
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (settings: PortalRegistrationSettings) => {
      const res = await apiRequest("PUT", "/api/b2b/registration-settings", settings);
      return (await res.json()) as { settings: PortalRegistrationSettings };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, data);
      toast({ title: t("portalRegistrations.settings.saved") });
    },
    onError: (err: Error) => toast({ title: t("portalRegistrations.settings.saveFailed"), description: err.message, variant: "destructive" }),
  });

  if (!form) {
    return (
      <Card className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("common.loading")}
      </Card>
    );
  }

  const set = <K extends keyof PortalRegistrationSettings>(key: K, value: PortalRegistrationSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const disabled = !canManage || save.isPending;
  const toggle = (key: "enabled" | "autoExecute" | "notifySalesRep" | "ccForwarder") => (
    <div className="flex items-start gap-3">
      <Switch id={`reg-setting-${key}`} checked={form[key]} disabled={disabled} onCheckedChange={(v) => set(key, v)} className="mt-0.5" />
      <div>
        <Label htmlFor={`reg-setting-${key}`}>{t(`portalRegistrations.settings.${key}`)}</Label>
        <p className="text-xs text-muted-foreground">{t(`portalRegistrations.settings.${key}Hint`)}</p>
      </div>
    </div>
  );

  return (
    <Card className="p-4 space-y-5">
      <div className="space-y-3">
        {toggle("enabled")}
        {toggle("autoExecute")}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="reg-setting-mailbox">{t("portalRegistrations.settings.mailbox")}</Label>
          <Input id="reg-setting-mailbox" className="mt-1" value={form.mailbox} disabled={disabled} placeholder="registrierung@meta-online.com" onChange={(e) => set("mailbox", e.target.value.trim())} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalRegistrations.settings.mailboxHint")}</p>
        </div>
        <div>
          <Label htmlFor="reg-setting-master-data">{t("portalRegistrations.settings.masterDataEmail")}</Label>
          <Input id="reg-setting-master-data" className="mt-1" value={form.masterDataEmail} disabled={disabled} onChange={(e) => set("masterDataEmail", e.target.value.trim())} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalRegistrations.settings.masterDataEmailHint")}</p>
        </div>
        <div>
          <Label htmlFor="reg-setting-folder">{t("portalRegistrations.settings.processedFolderName")}</Label>
          <Input id="reg-setting-folder" className="mt-1" value={form.processedFolderName} disabled={disabled} onChange={(e) => set("processedFolderName", e.target.value)} />
        </div>
        <div>
          <Label htmlFor="reg-setting-since">{t("portalRegistrations.settings.processSince")}</Label>
          <Input id="reg-setting-since" type="date" className="mt-1" value={form.processSince} disabled={disabled} onChange={(e) => set("processSince", e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalRegistrations.settings.processSinceHint")}</p>
        </div>
        <div>
          <Label htmlFor="reg-setting-max">{t("portalRegistrations.settings.maxPerRun")}</Label>
          <Input
            id="reg-setting-max"
            type="number"
            min={1}
            max={50}
            className="mt-1"
            value={form.maxPerRun}
            disabled={disabled}
            onChange={(e) => set("maxPerRun", Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
          />
        </div>
        <div>
          <Label htmlFor="reg-setting-recheck">{t("portalRegistrations.settings.recheckHours")}</Label>
          <Input
            id="reg-setting-recheck"
            type="number"
            min={0}
            max={168}
            className="mt-1"
            value={form.recheckHours}
            disabled={disabled}
            onChange={(e) => set("recheckHours", Math.max(0, Math.min(168, Number(e.target.value) || 0)))}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("portalRegistrations.settings.recheckHoursHint")}</p>
        </div>
        <div>
          <Label htmlFor="reg-setting-customer-update">{t("portalRegistrations.settings.customerUpdate")}</Label>
          <Select value={form.customerUpdate} onValueChange={(v) => set("customerUpdate", v as PortalRegistrationSettings["customerUpdate"])} disabled={disabled}>
            <SelectTrigger id="reg-setting-customer-update" className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="fill_empty">{t("portalRegistrations.settings.customerUpdateFillEmpty")}</SelectItem>
              <SelectItem value="none">{t("portalRegistrations.settings.customerUpdateNone")}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">{t("portalRegistrations.settings.customerUpdateHint")}</p>
        </div>
        <div>
          <Label htmlFor="reg-setting-storefront">{t("portalRegistrations.settings.storefrontUrl")}</Label>
          <Input id="reg-setting-storefront" className="mt-1" value={form.storefrontUrl} disabled={disabled} placeholder="https://portal.meta-online.com" onChange={(e) => set("storefrontUrl", e.target.value.trim())} />
        </div>
      </div>

      <div className="space-y-3">
        {toggle("notifySalesRep")}
        {toggle("ccForwarder")}
      </div>

      <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
        <p className="font-medium">{t("portalRegistrations.settings.n8nTitle")}</p>
        <p>{t("portalRegistrations.settings.n8nHint")}</p>
        <p className="text-xs text-muted-foreground">
          {t("portalRegistrations.settings.categories", { list: Object.values(PORTAL_REGISTRATION_CATEGORIES).join(" · ") })}
        </p>
      </div>

      {canManage ? (
        <div>
          <Button onClick={() => save.mutate(form)} disabled={save.isPending} data-testid="button-registration-settings-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
            {t("portalRegistrations.settings.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
