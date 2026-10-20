import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { CustomerMailBrevoInfo, CustomerMailOverview, CustomerMailRunDetail } from "@shared/customerMails";
import { CUSTOMER_MAILS_BREVO_QUERY_KEY, CUSTOMER_MAILS_QUERY_KEY } from "./customerMailsQuery";

/**
 * Karte „Stammkunden-Brief“ (B2): Startvorlage in Brevo anlegen, Vorschau mit echten Briefen von Beispielkunden an
 * die Testadressen, Entwurf für Kunden (nur wenn der Kundenversand in den Einstellungen freigeschaltet ist).
 * Angelegte Läufe erscheinen in der Liste „Aussendungen“ und werden dort gesendet.
 */

const DEFAULT_SUBJECT_KEY = "customerMails.letter.defaultSubject";

export function CustomerMailsRegularLetterCard({ data, onRun }: { data: CustomerMailOverview; onRun: (run: CustomerMailRunDetail) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const brevo = useQuery<CustomerMailBrevoInfo>({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY, enabled: data.hasKey });
  const shopSender = data.settings.channels.find((c) => c.enabled && c.kind === "shop" && c.senderId)?.senderId ?? null;
  const [templateId, setTemplateId] = useState("");
  const [senderId, setSenderId] = useState(shopSender ? String(shopSender) : "");
  const [subject, setSubject] = useState(() => t(DEFAULT_SUBJECT_KEY));
  const customersAllowed = data.settings.liveTypes.includes("regularLetter");

  const createTemplate = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/customer-mails/templates/regular-letter", { senderId: Number(senderId) })).json() as Promise<{ templateId: number }>,
    onSuccess: async ({ templateId: id }) => {
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY });
      setTemplateId(String(id));
      toast({ title: t("customerMails.letter.templateCreated", { id }) });
    },
    onError: (error: Error) => toast({ title: t("customerMails.letter.templateFailed"), description: error.message, variant: "destructive" }),
  });
  const create = useMutation({
    mutationFn: async (mode: "preview" | "customers") =>
      (await apiRequest("POST", "/api/customer-mails/runs/regular-letter", { templateId: Number(templateId), senderId: Number(senderId), subject: subject.trim(), mode })).json() as Promise<CustomerMailRunDetail>,
    onSuccess: (run) => {
      onRun(run);
      toast({
        title: run.previewOf ? t("customerMails.letter.previewCreated", { count: run.plannedCount }) : t("customerMails.letter.draftCreated", { count: run.plannedCount }),
        description: run.build ? t("customerMails.letter.buildStats", run.build) : undefined,
      });
    },
    onError: (error: Error) => toast({ title: t("customerMails.letter.createFailed"), description: error.message, variant: "destructive" }),
  });

  const ready = !!templateId && !!senderId && !!subject.trim();
  return (
    <Card className="p-4 space-y-3" data-testid="customer-mails-regular-letter">
      <div className="space-y-1">
        <h2 className="font-semibold">{t("customerMails.letter.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("customerMails.letter.hint")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-0 flex-1 basis-56">
          <Label htmlFor="customer-mails-letter-template">{t("customerMails.test.template")}</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="customer-mails-letter-template" data-testid="select-customer-mails-letter-template">
              <SelectValue placeholder={t("customerMails.test.templatePlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(brevo.data?.templates ?? []).map((tpl) => (
                <SelectItem key={tpl.id} value={String(tpl.id)}>
                  {tpl.name} (#{tpl.id})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={createTemplate.isPending || !senderId}
          onClick={() => createTemplate.mutate()}
          title={senderId ? undefined : t("customerMails.letter.senderFirst")}
          data-testid="button-customer-mails-letter-template"
        >
          {createTemplate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.createTemplate")}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-0 flex-1 basis-56">
          <Label htmlFor="customer-mails-letter-sender">{t("customerMails.test.sender")}</Label>
          <Select value={senderId} onValueChange={setSenderId}>
            <SelectTrigger id="customer-mails-letter-sender">
              <SelectValue placeholder={t("customerMails.test.senderPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {(brevo.data?.senders ?? [])
                .filter((s) => s.active)
                .map((s) => (
                  <SelectItem key={s.id} value={String(s.id)}>
                    {s.name} &lt;{s.email}&gt;
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 min-w-0 flex-1 basis-72">
          <Label htmlFor="customer-mails-letter-subject">{t("customerMails.test.subject")}</Label>
          <Input id="customer-mails-letter-subject" value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || create.isPending || data.settings.testRecipients.length === 0} onClick={() => create.mutate("preview")} data-testid="button-customer-mails-letter-preview">
          {create.isPending && create.variables === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.preview")}
        </Button>
        <Button
          variant="outline"
          disabled={!ready || create.isPending || !customersAllowed}
          onClick={() => create.mutate("customers")}
          title={customersAllowed ? undefined : t("customerMails.letter.customersOff")}
          data-testid="button-customer-mails-letter-customers"
        >
          {create.isPending && create.variables === "customers" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.customers")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{customersAllowed ? t("customerMails.letter.customersOnHint") : t("customerMails.letter.customersOff")}</p>
    </Card>
  );
}
