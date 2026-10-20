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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { CUSTOMER_MAIL_BUILD_TYPES, type CustomerMailBrevoInfo, type CustomerMailChannel, type CustomerMailOverview } from "@shared/customerMails";
import { CUSTOMER_MAILS_BREVO_QUERY_KEY, CUSTOMER_MAILS_QUERY_KEY } from "./customerMailsQuery";

/**
 * Reiter „Einstellungen“: Brevo-Schlüssel (verschlüsselt, nur „hinterlegt“ sichtbar), Brevo-Konto als
 * Verbindungstest, Stichtag der Bestandskunden-Regel, Kontaktbremse, Antwortadresse, Testadressen,
 * Verkaufskanäle mit Absender und der Brevo-Webhook für Abmeldungen und Bounces.
 */

const NO_SENDER = "none";

function mergeChannels(data: CustomerMailOverview): CustomerMailChannel[] {
  const out = [...data.settings.channels];
  for (const k of data.knownChannels) {
    if (!out.some((c) => c.salesChannelId === k.salesChannelId)) out.push({ salesChannelId: k.salesChannelId, name: k.name, kind: k.kind, language: "de", enabled: false, senderId: null });
  }
  return out;
}

export function CustomerMailsSettingsTab({ data }: { data: CustomerMailOverview }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const brevo = useQuery<CustomerMailBrevoInfo>({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY, enabled: data.hasKey });
  const [apiKey, setApiKey] = useState("");
  const [since, setSince] = useState(data.settings.existingCustomerSince ?? "");
  const [perWeek, setPerWeek] = useState(String(data.settings.maxPerWeek));
  const [perMonth, setPerMonth] = useState(String(data.settings.maxPerMonth));
  const [replyTo, setReplyTo] = useState(data.settings.replyTo);
  const [tests, setTests] = useState(data.settings.testRecipients.join("\n"));
  const [channels, setChannels] = useState<CustomerMailChannel[]>(() => mergeChannels(data));
  useEffect(() => setChannels(mergeChannels(data)), [data]);

  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PUT", "/api/customer-mails/settings", body)).json() as Promise<CustomerMailOverview>,
    onSuccess: (next, body) => {
      queryClient.setQueryData(CUSTOMER_MAILS_QUERY_KEY, next);
      if ("apiKey" in body) {
        setApiKey("");
        queryClient.invalidateQueries({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY });
      }
      toast({ title: t("customerMails.settings.saved") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const webhook = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/customer-mails/webhook")).json() as Promise<CustomerMailOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(CUSTOMER_MAILS_QUERY_KEY, next);
      toast({ title: t("customerMails.settings.webhookDone") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.settings.webhookFailed"), description: error.message, variant: "destructive" }),
  });

  const senders = brevo.data?.senders ?? [];
  const setChannel = (id: string, patch: Partial<CustomerMailChannel>) => setChannels((list) => list.map((c) => (c.salesChannelId === id ? { ...c, ...patch } : c)));
  const rulesDirty =
    since !== (data.settings.existingCustomerSince ?? "") ||
    perWeek !== String(data.settings.maxPerWeek) ||
    perMonth !== String(data.settings.maxPerMonth) ||
    replyTo.trim().toLowerCase() !== data.settings.replyTo ||
    tests
      .split(/[\s,;]+/)
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean)
      .join(",") !== data.settings.testRecipients.join(",");
  const testList = tests
    .split(/[\s,;]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">{t("customerMails.settings.brevoTitle")}</h2>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (apiKey.trim()) save.mutate({ apiKey: apiKey.trim() });
          }}
        >
          <div className="space-y-1 min-w-0 flex-1 basis-72">
            <Label htmlFor="customer-mails-key">{t("customerMails.settings.keyLabel")}</Label>
            <Input
              id="customer-mails-key"
              type="password"
              autoComplete="off"
              value={apiKey}
              placeholder={data.hasKey ? t("customerMails.settings.keySet") : t("customerMails.settings.keyPlaceholder")}
              onChange={(e) => setApiKey(e.target.value)}
              data-testid="input-customer-mails-key"
            />
          </div>
          <Button type="submit" disabled={save.isPending || !apiKey.trim()} data-testid="button-customer-mails-key-save">
            {t("customerMails.settings.keySave")}
          </Button>
          {data.hasKey ? (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ apiKey: "" })} data-testid="button-customer-mails-key-remove">
              {t("customerMails.settings.keyRemove")}
            </Button>
          ) : null}
        </form>
        <p className="text-xs text-muted-foreground">{t("customerMails.settings.keyHelp")}</p>
        {data.hasKey ? (
          brevo.isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              {t("customerMails.settings.checking")}
            </div>
          ) : brevo.data?.account ? (
            <p className="text-sm" data-testid="text-customer-mails-account">
              {t("customerMails.settings.account", {
                company: brevo.data.account.companyName || brevo.data.account.email,
                senders: senders.length,
                templates: brevo.data.templates.length,
              })}
              {brevo.data.account.plans.length ? <span className="text-muted-foreground"> · {brevo.data.account.plans.join(", ")}</span> : null}
            </p>
          ) : brevo.data?.error ? (
            <p className="text-sm text-destructive">{t("customerMails.brevoError", { error: brevo.data.error })}</p>
          ) : null
        ) : null}
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">{t("customerMails.settings.rulesTitle")}</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({
              existingCustomerSince: since || null,
              maxPerWeek: Math.max(0, Math.min(7, Number(perWeek) || 0)),
              maxPerMonth: Math.max(0, Math.min(31, Number(perMonth) || 0)),
              replyTo: replyTo.trim().toLowerCase(),
              testRecipients: testList,
            });
          }}
        >
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1 basis-48">
              <Label htmlFor="customer-mails-since">{t("customerMails.settings.since")}</Label>
              <Input id="customer-mails-since" type="date" value={since} onChange={(e) => setSince(e.target.value)} data-testid="input-customer-mails-since" />
            </div>
            <div className="space-y-1 basis-32">
              <Label htmlFor="customer-mails-week">{t("customerMails.settings.perWeek")}</Label>
              <Input id="customer-mails-week" type="number" min={0} max={7} value={perWeek} onChange={(e) => setPerWeek(e.target.value)} />
            </div>
            <div className="space-y-1 basis-32">
              <Label htmlFor="customer-mails-month">{t("customerMails.settings.perMonth")}</Label>
              <Input id="customer-mails-month" type="number" min={0} max={31} value={perMonth} onChange={(e) => setPerMonth(e.target.value)} />
            </div>
            <div className="space-y-1 flex-1 basis-64 min-w-0">
              <Label htmlFor="customer-mails-reply">{t("customerMails.settings.replyTo")}</Label>
              <Input id="customer-mails-reply" type="email" value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="shop@meta-online.com" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">{t("customerMails.settings.sinceHelp")}</p>
          <div className="space-y-1">
            <Label htmlFor="customer-mails-tests">{t("customerMails.settings.testRecipients")}</Label>
            <Textarea id="customer-mails-tests" rows={3} value={tests} onChange={(e) => setTests(e.target.value)} data-testid="input-customer-mails-tests" />
            <p className="text-xs text-muted-foreground">{t("customerMails.settings.testRecipientsHelp")}</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending} data-testid="button-customer-mails-rules-save">
              {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("customerMails.settings.save")}
            </Button>
            {rulesDirty ? (
              <span className="text-sm text-amber-700 dark:text-amber-300" role="status" data-testid="text-customer-mails-rules-dirty">
                {t("customerMails.settings.unsaved")}
              </span>
            ) : null}
          </div>
        </form>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("customerMails.settings.channelsTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("customerMails.settings.channelsHint")}</p>
        </div>
        {channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customerMails.settings.noChannels")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="table-customer-mails-channels">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("customerMails.settings.channelColumns.channel")}</TableHead>
                  <TableHead>{t("customerMails.settings.channelColumns.kind")}</TableHead>
                  <TableHead>{t("customerMails.settings.channelColumns.sender")}</TableHead>
                  <TableHead>{t("customerMails.settings.channelColumns.enabled")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {channels.map((c) => (
                  <TableRow key={c.salesChannelId}>
                    <TableCell className="text-sm">{c.name}</TableCell>
                    <TableCell>
                      <Select value={c.kind} onValueChange={(kind) => setChannel(c.salesChannelId, { kind: kind as CustomerMailChannel["kind"] })}>
                        <SelectTrigger className="w-36" aria-label={t("customerMails.settings.channelColumns.kind")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="shop">{t("customerMails.channelKinds.shop")}</SelectItem>
                          <SelectItem value="portal">{t("customerMails.channelKinds.portal")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Select value={c.senderId ? String(c.senderId) : NO_SENDER} onValueChange={(v) => setChannel(c.salesChannelId, { senderId: v === NO_SENDER ? null : Number(v) })}>
                        <SelectTrigger className="w-64 max-w-full" aria-label={t("customerMails.settings.channelColumns.sender")}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_SENDER}>{c.kind === "portal" ? t("customerMails.settings.senderRep") : t("customerMails.settings.senderNone")}</SelectItem>
                          {senders.map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}>
                              {s.name} &lt;{s.email}&gt;
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      <Switch checked={c.enabled} onCheckedChange={(enabled) => setChannel(c.salesChannelId, { enabled })} aria-label={t("customerMails.settings.channelColumns.enabled")} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        <Button disabled={save.isPending || channels.length === 0} onClick={() => save.mutate({ channels })} data-testid="button-customer-mails-channels-save">
          {t("customerMails.settings.saveChannels")}
        </Button>
      </Card>

      <Card className="p-4 space-y-3" data-testid="customer-mails-live-types">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("customerMails.settings.liveTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("customerMails.settings.liveHint")}</p>
        </div>
        {CUSTOMER_MAIL_BUILD_TYPES.map((type) => {
          const on = data.settings.liveTypes.includes(type);
          return (
            <div key={type} className="flex items-center gap-2">
              <Switch
                id={`customer-mails-live-${type}`}
                checked={on}
                disabled={save.isPending}
                onCheckedChange={(checked) =>
                  save.mutate({ liveTypes: checked ? Array.from(new Set([...data.settings.liveTypes, type])) : data.settings.liveTypes.filter((x) => x !== type) })
                }
                data-testid={`switch-customer-mails-live-${type}`}
              />
              <Label htmlFor={`customer-mails-live-${type}`}>{t("customerMails.settings.liveLabel", { type: t(`customerMails.types.${type}`) })}</Label>
            </div>
          );
        })}
      </Card>

      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("customerMails.settings.webhookTitle")}</h2>
          <p className="text-xs text-muted-foreground">{t("customerMails.settings.webhookHint")}</p>
        </div>
        <p className="text-sm" data-testid="text-customer-mails-webhook">
          {data.hasWebhook ? t("customerMails.settings.webhookActive", { id: data.state.webhookId }) : t("customerMails.settings.webhookMissing")}
        </p>
        {data.webhookUrl ? <p className="text-xs text-muted-foreground break-all">{data.webhookUrl}</p> : null}
        <Button variant="outline" disabled={webhook.isPending || !data.hasKey} onClick={() => webhook.mutate()} data-testid="button-customer-mails-webhook">
          {webhook.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {data.hasWebhook ? t("customerMails.settings.webhookRenew") : t("customerMails.settings.webhookSetup")}
        </Button>
      </Card>
    </div>
  );
}
