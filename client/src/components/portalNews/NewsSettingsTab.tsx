import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { PORTAL_NEWS_CATEGORIES, type PortalNewsSettings } from "@shared/portalNews";

const QUERY_KEY = ["/api/b2b/news-settings"];

export default function NewsSettingsTab({ canManage }: { canManage: boolean }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useQuery<{ settings: PortalNewsSettings }>({ queryKey: QUERY_KEY });
  const [form, setForm] = useState<PortalNewsSettings | null>(null);
  // Absender als Text (eine Adresse je Zeile), damit Tippen und Zeilenumbrüche nicht verloren gehen
  const [sendersText, setSendersText] = useState("");

  useEffect(() => {
    if (query.data?.settings) {
      setForm(query.data.settings);
      setSendersText(query.data.settings.intakeSenders.join("\n"));
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: async (settings: PortalNewsSettings) => {
      const res = await apiRequest("PUT", "/api/b2b/news-settings", settings);
      return (await res.json()) as { settings: PortalNewsSettings; pageError: string | null };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(QUERY_KEY, { settings: data.settings });
      void queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/b2b/news/page") });
      if (data.pageError) toast({ title: t("portalNews.settings.savedPageFailed"), description: data.pageError, variant: "destructive" });
      else toast({ title: t("portalNews.settings.saved") });
    },
    onError: (err: Error) => toast({ title: t("portalNews.settings.saveFailed"), description: err.message, variant: "destructive" }),
  });

  if (!form) {
    return (
      <Card className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("common.loading")}
      </Card>
    );
  }

  const set = <K extends keyof PortalNewsSettings>(key: K, value: PortalNewsSettings[K]) => setForm((f) => (f ? { ...f, [key]: value } : f));
  const disabled = !canManage || save.isPending;
  const toggle = (key: "enabled" | "autoPublish" | "fromIntake") => (
    <div className="flex items-start gap-3">
      <Switch id={`news-setting-${key}`} checked={form[key]} disabled={disabled} onCheckedChange={(v) => set(key, v)} className="mt-0.5" />
      <div>
        <Label htmlFor={`news-setting-${key}`}>{t(`portalNews.settings.${key}`)}</Label>
        <p className="text-xs text-muted-foreground">{t(`portalNews.settings.${key}Hint`)}</p>
      </div>
    </div>
  );

  return (
    <Card className="p-4 space-y-5">
      <div className="space-y-3">
        {toggle("enabled")}
        {toggle("autoPublish")}
        {toggle("fromIntake")}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div>
          <Label htmlFor="news-setting-mailbox">{t("portalNews.settings.mailbox")}</Label>
          <Input id="news-setting-mailbox" className="mt-1" value={form.mailbox} disabled={disabled} placeholder="name@meta-online.com" onChange={(e) => set("mailbox", e.target.value.trim())} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalNews.settings.mailboxHint")}</p>
        </div>
        <div>
          <Label htmlFor="news-setting-folder">{t("portalNews.settings.sourceFolderName")}</Label>
          <Input id="news-setting-folder" className="mt-1" value={form.sourceFolderName} disabled={disabled} onChange={(e) => set("sourceFolderName", e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalNews.settings.sourceFolderNameHint")}</p>
        </div>
        <div>
          <Label htmlFor="news-setting-since">{t("portalNews.settings.processSince")}</Label>
          <Input id="news-setting-since" type="date" className="mt-1" value={form.processSince} disabled={disabled} onChange={(e) => set("processSince", e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalNews.settings.processSinceHint")}</p>
        </div>
        <div>
          <Label htmlFor="news-setting-max">{t("portalNews.settings.maxPerRun")}</Label>
          <Input
            id="news-setting-max"
            type="number"
            min={1}
            max={20}
            className="mt-1"
            value={form.maxPerRun}
            disabled={disabled}
            onChange={(e) => set("maxPerRun", Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="news-setting-senders">{t("portalNews.settings.intakeSenders")}</Label>
          <Textarea
            id="news-setting-senders"
            className="mt-1"
            rows={2}
            value={sendersText}
            disabled={disabled || !form.fromIntake}
            onChange={(e) => {
              setSendersText(e.target.value);
              set("intakeSenders", [...new Set(e.target.value.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))]);
            }}
          />
          <p className="text-xs text-muted-foreground mt-1">{t("portalNews.settings.intakeSendersHint")}</p>
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="news-setting-title">{t("portalNews.settings.pageTitle")}</Label>
          <Input id="news-setting-title" className="mt-1" value={form.pageTitle} disabled={disabled} maxLength={120} onChange={(e) => set("pageTitle", e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="news-setting-intro">{t("portalNews.settings.pageIntro")}</Label>
          <Textarea id="news-setting-intro" className="mt-1" rows={2} value={form.pageIntro} disabled={disabled} maxLength={600} onChange={(e) => set("pageIntro", e.target.value)} />
          <p className="text-xs text-muted-foreground mt-1">{t("portalNews.settings.pageIntroHint")}</p>
        </div>
      </div>

      <div className="rounded border bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
        <p>{t("portalNews.settings.outlookRuleHint", { folder: form.sourceFolderName })}</p>
        <p>{t("portalNews.settings.n8nHint")}</p>
        <p>{t("portalNews.settings.categoriesHint", { categories: Object.values(PORTAL_NEWS_CATEGORIES).join(" · ") })}</p>
      </div>

      {canManage ? (
        <div className="flex justify-end">
          <Button onClick={() => save.mutate(form)} disabled={save.isPending || !form.pageTitle.trim() || !form.sourceFolderName.trim()} data-testid="button-news-settings-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
            {t("common.save")}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}
