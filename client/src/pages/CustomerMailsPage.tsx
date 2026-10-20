import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Mail, RefreshCw } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CustomerMailsOverviewTab } from "@/components/customerMails/CustomerMailsOverviewTab";
import { CustomerMailsContactsTab } from "@/components/customerMails/CustomerMailsContactsTab";
import { CustomerMailsSettingsTab } from "@/components/customerMails/CustomerMailsSettingsTab";
import { CUSTOMER_MAILS_QUERY_KEY } from "@/components/customerMails/customerMailsQuery";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CustomerMailOverview } from "@shared/customerMails";

/**
 * Kundenmails über Brevo (nur Administratoren), Baustein B1 „Fundament“: Not-Aus, Kontaktabgleich, Rechtsgrundlage
 * je Kontakt (Einwilligung, Bestandskunde ab Stichtag, Widerspruch), Testaussendung über eine Brevo-Vorlage und
 * die Einstellungen (Brevo-Schlüssel, Absender je Verkaufskanal, Kontaktbremse, Webhook).
 * Reiter über ?tab=overview|contacts|settings. Server: server/routes/customerMailRoutes.ts.
 */

const TABS = ["overview", "contacts", "settings"] as const;
type Tab = (typeof TABS)[number];

export default function CustomerMailsPage() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const search = useSearch();
  const [, navigate] = useLocation();
  const tabParam = new URLSearchParams(search).get("tab");
  const [tab, setTab] = useState<Tab>((TABS as readonly string[]).includes(tabParam ?? "") ? (tabParam as Tab) : "overview");
  const changeTab = (next: string) => {
    setTab(next as Tab);
    navigate(next === "overview" ? "/admin/kundenmails" : `/admin/kundenmails?tab=${next}`, { replace: true });
  };

  const query = useQuery<CustomerMailOverview>({ queryKey: CUSTOMER_MAILS_QUERY_KEY });
  const data = query.data;
  const forbidden = (query.error as { status?: number } | null)?.status === 403;

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => (await apiRequest("PUT", "/api/customer-mails/settings", { enabled })).json() as Promise<CustomerMailOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(CUSTOMER_MAILS_QUERY_KEY, next);
      toast({ title: next.settings.enabled ? t("customerMails.switchedOn") : t("customerMails.switchedOff") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const sync = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/customer-mails/sync")).json() as Promise<CustomerMailOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(CUSTOMER_MAILS_QUERY_KEY, next);
      queryClient.invalidateQueries({ queryKey: ["/api/customer-mails/contacts"] });
      toast({ title: t("customerMails.syncDone") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.syncFailed"), description: error.message, variant: "destructive" }),
  });

  if (forbidden) {
    return <p className="p-6 text-sm text-muted-foreground">{t("customerMails.adminOnly")}</p>;
  }
  if (!data) {
    return (
      <div className="p-6 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        {t("customerMails.loading")}
      </div>
    );
  }

  const stats = data.state.lastSyncStats;
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Mail className="h-6 w-6 text-muted-foreground" aria-hidden="true" />
            {t("customerMails.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("customerMails.hint")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch
              id="customer-mails-enabled"
              checked={data.settings.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(enabled) => toggle.mutate(enabled)}
              data-testid="switch-customer-mails-enabled"
            />
            <Label htmlFor="customer-mails-enabled">{t("customerMails.enabled")}</Label>
          </div>
          <Button variant="outline" disabled={sync.isPending || !data.hasKey} onClick={() => sync.mutate()} data-testid="button-customer-mails-sync">
            {sync.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-2" aria-hidden="true" />}
            {t("customerMails.syncNow")}
          </Button>
        </div>
      </div>

      {!data.hasKey ? (
        <Card className="p-4 text-sm" role="note" data-testid="text-customer-mails-no-key">
          {t("customerMails.noKey")}{" "}
          <Button variant="ghost" size="sm" className="h-auto px-1 py-0 underline" onClick={() => changeTab("settings")}>
            {t("customerMails.toSettings")}
          </Button>
        </Card>
      ) : null}

      <p className="text-xs text-muted-foreground" data-testid="text-customer-mails-sync">
        {data.state.lastSyncAt ? t("customerMails.lastSync", { at: fmt.dateTime(data.state.lastSyncAt) }) : t("customerMails.neverSynced")}
        {stats ? ` · ${t("customerMails.syncStats", { mirror: stats.mirror, newsletter: stats.newsletter, blocked: stats.brevoBlocked, upserted: stats.upserted })}` : ""}
        {stats && typeof stats.blockReasonsOpen === "number"
          ? ` · ${t("customerMails.syncBlockReasons", { checked: stats.blockReasonsChecked ?? 0, open: stats.blockReasonsOpen, unsubscribed: stats.brevoUnsubscribes ?? 0 })}`
          : ""}
      </p>
      {data.state.lastSyncError ? (
        <p className="text-sm text-destructive" role="alert" data-testid="text-customer-mails-sync-error">
          {t("customerMails.syncError", { error: data.state.lastSyncError })}
        </p>
      ) : null}

      <Tabs value={tab} onValueChange={changeTab}>
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-customer-mails-overview">
            {t("customerMails.tabs.overview")}
          </TabsTrigger>
          <TabsTrigger value="contacts" data-testid="tab-customer-mails-contacts">
            {t("customerMails.tabs.contacts")}
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-customer-mails-settings">
            {t("customerMails.tabs.settings")}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          <CustomerMailsOverviewTab data={data} />
        </TabsContent>
        <TabsContent value="contacts" className="mt-4">
          <CustomerMailsContactsTab />
        </TabsContent>
        <TabsContent value="settings" className="mt-4">
          <CustomerMailsSettingsTab data={data} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
