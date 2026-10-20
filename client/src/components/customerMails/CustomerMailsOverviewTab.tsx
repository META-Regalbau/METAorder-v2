import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CustomerMailBrevoInfo, CustomerMailOverview, CustomerMailRun, CustomerMailRunDetail } from "@shared/customerMails";
import { CUSTOMER_MAILS_BREVO_QUERY_KEY, CUSTOMER_MAILS_QUERY_KEY } from "./customerMailsQuery";

/**
 * Reiter „Übersicht“: Kontakte je Rechtsgrundlage, Testaussendung (Vorlage + Absender + Betreff an die
 * Testadressen) und die Liste der Aussendungen mit Empfängern, Senden (mit Rückfrage) und Verwerfen.
 */

const COUNT_KEYS = ["consent", "existingCustomer", "none", "objected", "bounced", "total"] as const;

function RunStatusBadge({ status }: { status: CustomerMailRun["status"] }) {
  const { t } = useTranslation();
  const label = t(`customerMails.runStatus.${status}`);
  if (status === "sent") return <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">{label}</Badge>;
  if (status === "failed") return <Badge variant="destructive">{label}</Badge>;
  if (status === "draft") return <Badge variant="outline">{label}</Badge>;
  return <Badge variant="secondary">{label}</Badge>;
}

export function CustomerMailsOverviewTab({ data }: { data: CustomerMailOverview }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const brevo = useQuery<CustomerMailBrevoInfo>({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY, enabled: data.hasKey });
  const shopSender = data.settings.channels.find((c) => c.enabled && c.kind === "shop" && c.senderId)?.senderId ?? null;
  const [templateId, setTemplateId] = useState<string>("");
  const [senderId, setSenderId] = useState<string>(shopSender ? String(shopSender) : "");
  const [subject, setSubject] = useState("");
  const [openRunId, setOpenRunId] = useState<string | null>(null);
  const [confirmSendId, setConfirmSendId] = useState<string | null>(null);

  const detail = useQuery<CustomerMailRunDetail>({ queryKey: ["/api/customer-mails/runs", openRunId ?? ""], enabled: !!openRunId });

  const afterRun = (run: CustomerMailRunDetail) => {
    queryClient.setQueryData(["/api/customer-mails/runs", run.id], run);
    queryClient.invalidateQueries({ queryKey: CUSTOMER_MAILS_QUERY_KEY });
    setOpenRunId(run.id);
  };

  const createTest = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/customer-mails/runs/test", { templateId: Number(templateId), senderId: Number(senderId), subject: subject.trim() })).json() as Promise<CustomerMailRunDetail>,
    onSuccess: (run) => {
      afterRun(run);
      toast({ title: t("customerMails.test.created", { count: run.plannedCount }) });
    },
    onError: (error: Error) => toast({ title: t("customerMails.test.createFailed"), description: error.message, variant: "destructive" }),
  });
  const send = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/customer-mails/runs/${id}/send`)).json() as Promise<CustomerMailRunDetail>,
    onSuccess: (run) => {
      afterRun(run);
      setConfirmSendId(null);
      if (run.status === "sent") toast({ title: t("customerMails.runs.sent", { count: run.sentCount }) });
      else toast({ title: t("customerMails.runs.sendFailed"), description: run.error ?? undefined, variant: "destructive" });
    },
    onError: (error: Error) => {
      setConfirmSendId(null);
      toast({ title: t("customerMails.runs.sendFailed"), description: error.message, variant: "destructive" });
    },
  });
  const cancel = useMutation({
    mutationFn: async (id: string) => (await apiRequest("POST", `/api/customer-mails/runs/${id}/cancel`)).json() as Promise<CustomerMailRunDetail>,
    onSuccess: (run) => {
      afterRun(run);
      toast({ title: t("customerMails.runs.cancelled") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.runs.cancelFailed"), description: error.message, variant: "destructive" }),
  });

  const templates = brevo.data?.templates ?? [];
  const senders = (brevo.data?.senders ?? []).filter((s) => s.active);
  const canCreate = !!templateId && !!senderId && !!subject.trim() && data.settings.testRecipients.length > 0;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">{t("customerMails.counts.title")}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {COUNT_KEYS.map((key) => (
            <div key={key} className="rounded-md border p-3" data-testid={`count-customer-mails-${key}`}>
              <div className="text-xs text-muted-foreground">{t(`customerMails.counts.${key}`)}</div>
              <div className="text-xl font-semibold tabular-nums">{fmt.integer(data.counts[key])}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {data.settings.existingCustomerSince
            ? t("customerMails.counts.cutoffSet", { date: fmt.date(data.settings.existingCustomerSince) })
            : t("customerMails.counts.cutoffMissing")}
          {data.counts.newsletterUnconfirmed ? ` ${t("customerMails.counts.unconfirmed", { count: data.counts.newsletterUnconfirmed })}` : ""}
        </p>
      </Card>

      <Card className="p-4 space-y-3">
        <div className="space-y-1">
          <h2 className="font-semibold">{t("customerMails.test.title")}</h2>
          <p className="text-xs text-muted-foreground">
            {data.settings.testRecipients.length
              ? t("customerMails.test.hint", { recipients: data.settings.testRecipients.join(", ") })
              : t("customerMails.test.noRecipients")}
          </p>
        </div>
        {brevo.data?.error ? <p className="text-sm text-destructive">{t("customerMails.brevoError", { error: brevo.data.error })}</p> : null}
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) createTest.mutate();
          }}
        >
          <div className="space-y-1 min-w-0 flex-1 basis-56">
            <Label htmlFor="customer-mails-test-template">{t("customerMails.test.template")}</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger id="customer-mails-test-template" data-testid="select-customer-mails-test-template">
                <SelectValue placeholder={t("customerMails.test.templatePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {templates.map((tpl) => (
                  <SelectItem key={tpl.id} value={String(tpl.id)}>
                    {tpl.name} (#{tpl.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0 flex-1 basis-56">
            <Label htmlFor="customer-mails-test-sender">{t("customerMails.test.sender")}</Label>
            <Select value={senderId} onValueChange={setSenderId}>
              <SelectTrigger id="customer-mails-test-sender" data-testid="select-customer-mails-test-sender">
                <SelectValue placeholder={t("customerMails.test.senderPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {senders.map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} &lt;{s.email}&gt;
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 min-w-0 flex-1 basis-64">
            <Label htmlFor="customer-mails-test-subject">{t("customerMails.test.subject")}</Label>
            <Input id="customer-mails-test-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} data-testid="input-customer-mails-test-subject" />
          </div>
          <Button type="submit" disabled={!canCreate || createTest.isPending} data-testid="button-customer-mails-test-create">
            {createTest.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t("customerMails.test.create")}
          </Button>
        </form>
      </Card>

      <Card className="p-4 space-y-3">
        <h2 className="font-semibold">{t("customerMails.runs.title")}</h2>
        {data.runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("customerMails.runs.none")}</p>
        ) : (
          <div className="overflow-x-auto">
            <Table data-testid="table-customer-mails-runs">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("customerMails.runs.columns.created")}</TableHead>
                  <TableHead>{t("customerMails.runs.columns.type")}</TableHead>
                  <TableHead>{t("customerMails.runs.columns.subject")}</TableHead>
                  <TableHead>{t("customerMails.runs.columns.status")}</TableHead>
                  <TableHead className="text-right">{t("customerMails.runs.columns.recipients")}</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.runs.map((run) => (
                  <TableRow key={run.id} data-testid={`row-customer-mails-run-${run.id}`}>
                    <TableCell className="text-sm whitespace-nowrap">
                      {fmt.dateTime(run.createdAt)}
                      {run.createdBy ? <div className="text-xs text-muted-foreground">{run.createdBy}</div> : null}
                    </TableCell>
                    <TableCell className="text-sm">{t(`customerMails.types.${run.mailType}`)}</TableCell>
                    <TableCell className="text-sm">
                      {run.subject}
                      {run.error ? <div className="text-xs text-destructive break-all">{run.error}</div> : null}
                      {run.brevoCampaignId ? <div className="text-xs text-muted-foreground">{t("customerMails.runs.campaign", { id: run.brevoCampaignId })}</div> : null}
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                      {run.sentAt ? <div className="text-xs text-muted-foreground mt-1">{fmt.dateTime(run.sentAt)}</div> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums whitespace-nowrap">
                      {t("customerMails.runs.counts", { planned: run.status === "sent" ? run.sentCount : run.plannedCount, skipped: run.skippedCount })}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setOpenRunId(openRunId === run.id ? null : run.id)} data-testid={`button-customer-mails-run-open-${run.id}`}>
                          {openRunId === run.id ? t("customerMails.runs.hide") : t("customerMails.runs.show")}
                        </Button>
                        {run.status === "draft" || run.status === "failed" ? (
                          confirmSendId === run.id ? (
                            <>
                              <Button size="sm" disabled={send.isPending || !data.settings.enabled} onClick={() => send.mutate(run.id)} data-testid={`button-customer-mails-run-confirm-${run.id}`}>
                                {send.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" aria-hidden="true" />}
                                {t("customerMails.runs.confirmSend", { count: run.plannedCount })}
                              </Button>
                              <Button size="sm" variant="ghost" onClick={() => setConfirmSendId(null)}>
                                {t("customerMails.runs.keep")}
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!data.settings.enabled}
                                title={data.settings.enabled ? undefined : t("customerMails.runs.switchedOff")}
                                onClick={() => setConfirmSendId(run.id)}
                                data-testid={`button-customer-mails-run-send-${run.id}`}
                              >
                                {t("customerMails.runs.send")}
                              </Button>
                              <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(run.id)} data-testid={`button-customer-mails-run-cancel-${run.id}`}>
                                {t("customerMails.runs.cancel")}
                              </Button>
                            </>
                          )
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {!data.settings.enabled && data.runs.some((r) => r.status === "draft") ? <p className="text-xs text-muted-foreground">{t("customerMails.runs.switchedOff")}</p> : null}
        {openRunId && detail.data ? (
          <div className="overflow-x-auto border-t pt-3" data-testid="customer-mails-run-detail">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("customerMails.recipients.email")}</TableHead>
                  <TableHead>{t("customerMails.recipients.customer")}</TableHead>
                  <TableHead>{t("customerMails.recipients.basis")}</TableHead>
                  <TableHead>{t("customerMails.recipients.status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {detail.data.recipients.map((r) => (
                  <TableRow key={r.email}>
                    <TableCell className="text-sm break-all">{r.email}</TableCell>
                    <TableCell className="text-sm">{r.customerNumber ?? "–"}</TableCell>
                    <TableCell className="text-sm">{t(`customerMails.basis.${r.basis}`)}</TableCell>
                    <TableCell className="text-sm">
                      {t(`customerMails.recipientStatus.${r.status}`)}
                      {r.skipReason ? <span className="text-xs text-muted-foreground"> · {t(`customerMails.skipReasons.${r.skipReason}`)}</span> : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
