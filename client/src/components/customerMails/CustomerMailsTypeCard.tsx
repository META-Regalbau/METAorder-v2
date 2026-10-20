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
import { CUSTOMER_MAIL_BUILD_TYPES, type CustomerMailBrevoInfo, type CustomerMailBuildType, type CustomerMailOverview, type CustomerMailRunDetail } from "@shared/customerMails";
import { CUSTOMER_MAILS_BREVO_QUERY_KEY } from "./customerMailsQuery";

/**
 * Karte „Mailarten“ (B2–B5): Mailart wählen, Startvorlage in Brevo anlegen, Vorschau mit echten Inhalten von
 * Beispielkunden an die Testadressen, Entwurf für Kunden (nur wenn der Kundenversand der Mailart in den
 * Einstellungen freigeschaltet ist). Angelegte Läufe erscheinen unter „Aussendungen“ und werden dort gesendet.
 */
export function CustomerMailsTypeCard({ data, onRun }: { data: CustomerMailOverview; onRun: (run: CustomerMailRunDetail) => void }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const brevo = useQuery<CustomerMailBrevoInfo>({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY, enabled: data.hasKey });
  const shopSender = data.settings.channels.find((c) => c.enabled && c.kind === "shop" && c.senderId)?.senderId ?? null;
  const [mailType, setMailType] = useState<CustomerMailBuildType>("regularLetter");
  const [templateId, setTemplateId] = useState("");
  const [senderId, setSenderId] = useState(shopSender ? String(shopSender) : "");
  const [subjects, setSubjects] = useState<Partial<Record<CustomerMailBuildType, string>>>({});
  const subject = subjects[mailType] ?? t(`customerMails.kinds.${mailType}.subject`);
  const customersAllowed = data.settings.liveTypes.includes(mailType);

  const createTemplate = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/customer-mails/templates/regular-letter", { senderId: Number(senderId), mailType })).json() as Promise<{ templateId: number }>,
    onSuccess: async ({ templateId: id }) => {
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_MAILS_BREVO_QUERY_KEY });
      setTemplateId(String(id));
      toast({ title: t("customerMails.letter.templateCreated", { id }) });
    },
    onError: (error: Error) => toast({ title: t("customerMails.letter.templateFailed"), description: error.message, variant: "destructive" }),
  });
  const create = useMutation({
    mutationFn: async (mode: "preview" | "customers") =>
      (await apiRequest("POST", "/api/customer-mails/runs/typed", { mailType, templateId: Number(templateId), senderId: Number(senderId), subject: subject.trim(), mode })).json() as Promise<CustomerMailRunDetail>,
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
    <Card className="p-4 space-y-3" data-testid="customer-mails-types">
      <div className="space-y-1">
        <h2 className="font-semibold">{t("customerMails.kinds.title")}</h2>
        <p className="text-xs text-muted-foreground">{t("customerMails.kinds.hint")}</p>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-0 flex-1 basis-56">
          <Label htmlFor="customer-mails-kind">{t("customerMails.kinds.type")}</Label>
          <Select value={mailType} onValueChange={(v) => setMailType(v as CustomerMailBuildType)}>
            <SelectTrigger id="customer-mails-kind" data-testid="select-customer-mails-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CUSTOMER_MAIL_BUILD_TYPES.map((k) => (
                <SelectItem key={k} value={k}>
                  {t(`customerMails.types.${k}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-sm" data-testid="text-customer-mails-kind-hint">
        {t(`customerMails.kinds.${mailType}.hint`)}
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-0 flex-1 basis-56">
          <Label htmlFor="customer-mails-kind-template">{t("customerMails.test.template")}</Label>
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger id="customer-mails-kind-template" data-testid="select-customer-mails-kind-template">
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
          data-testid="button-customer-mails-kind-template"
        >
          {createTemplate.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.createTemplate")}
        </Button>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1 min-w-0 flex-1 basis-56">
          <Label htmlFor="customer-mails-kind-sender">{t("customerMails.test.sender")}</Label>
          <Select value={senderId} onValueChange={setSenderId}>
            <SelectTrigger id="customer-mails-kind-sender">
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
          <Label htmlFor="customer-mails-kind-subject">{t("customerMails.test.subject")}</Label>
          <Input id="customer-mails-kind-subject" value={subject} maxLength={200} onChange={(e) => setSubjects((s) => ({ ...s, [mailType]: e.target.value }))} />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={!ready || create.isPending || data.settings.testRecipients.length === 0} onClick={() => create.mutate("preview")} data-testid="button-customer-mails-kind-preview">
          {create.isPending && create.variables === "preview" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.preview")}
        </Button>
        <Button
          variant="outline"
          disabled={!ready || create.isPending || !customersAllowed}
          onClick={() => create.mutate("customers")}
          title={customersAllowed ? undefined : t("customerMails.kinds.customersOff")}
          data-testid="button-customer-mails-kind-customers"
        >
          {create.isPending && create.variables === "customers" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("customerMails.letter.customers")}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{customersAllowed ? t("customerMails.letter.customersOnHint") : t("customerMails.kinds.customersOff")}</p>
    </Card>
  );
}
