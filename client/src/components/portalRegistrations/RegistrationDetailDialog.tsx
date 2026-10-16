import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type {
  PortalCustomerChange,
  PortalRegistrationData,
  PortalRegistrationEvent,
  PortalRegistrationExtraction,
  PortalRegistrationMatch,
  PortalRegistrationPlan,
  PortalRegistrationStatus,
} from "@shared/portalRegistrations";
import { registrationStatusVariant } from "./status";

type Detail = {
  registration: {
    id: string;
    status: PortalRegistrationStatus;
    subject: string;
    fromEmail: string | null;
    fromName: string | null;
    forwardedBy: string | null;
    receivedAt: string;
    bodyText: string;
    lastError: string | null;
    employeeId: string | null;
    passwordResetAt: string | null;
    hasOriginal: boolean;
    extraction: PortalRegistrationExtraction | null;
    data: PortalRegistrationData | null;
    match: PortalRegistrationMatch | null;
    plan: PortalRegistrationPlan | null;
    events: PortalRegistrationEvent[];
  };
  mails: Array<{
    id: string;
    kind: string;
    to: string[];
    cc: string[];
    subject: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    sentAt: string | null;
  }>;
};

const TRI = ["unset", "yes", "no"] as const;
const triOf = (v: boolean | null) => (v === true ? "yes" : v === false ? "no" : "unset");
const triTo = (v: string): boolean | null => (v === "yes" ? true : v === "no" ? false : null);
const orNull = (v: string) => (v.trim() ? v.trim() : null);

function DataField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  disabled: boolean;
}) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">{label}</Label>
      <Input id={id} className="mt-1 h-8" value={value ?? ""} disabled={disabled} onChange={(e) => onChange(orNull(e.target.value))} />
    </div>
  );
}

export default function RegistrationDetailDialog({
  id,
  canManage,
  onClose,
  onChanged,
}: {
  id: string;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const queryKey = [`/api/b2b/registrations/${id}`];
  const detail = useQuery<Detail>({ queryKey, refetchInterval: 15_000 });
  const reg = detail.data?.registration;
  const [data, setData] = useState<PortalRegistrationData | null>(null);
  const [dirty, setDirty] = useState(false);
  const [customerNumber, setCustomerNumber] = useState("");
  const [showBody, setShowBody] = useState(false);

  useEffect(() => {
    if (reg?.data && !dirty) setData(reg.data);
  }, [reg?.data, dirty]);

  const action = useMutation({
    mutationFn: async (input: { path: string; method?: "POST" | "PUT" | "PATCH"; body?: unknown; okKey: string }) => {
      const res = await apiRequest(input.method ?? "POST", `/api/b2b/registrations/${id}/${input.path}`, input.body ?? {});
      return { detail: (await res.json()) as Detail, okKey: input.okKey };
    },
    onSuccess: ({ detail: next, okKey }) => {
      queryClient.setQueryData(queryKey, next);
      setDirty(false);
      setData(next.registration.data);
      onChanged();
      toast({ title: t(okKey) });
    },
    onError: (err: Error) => toast({ title: t("portalRegistrations.actionFailed"), description: err.message, variant: "destructive" }),
  });
  const retryMail = useMutation({
    mutationFn: async (mailId: string) => apiRequest("POST", `/api/b2b/registrations/mails/${mailId}/retry`, {}),
    onSuccess: () => {
      void detail.refetch();
      toast({ title: t("portalRegistrations.mailRequeued") });
    },
    onError: (err: Error) => toast({ title: t("portalRegistrations.actionFailed"), description: err.message, variant: "destructive" }),
  });

  const busy = action.isPending;
  const done = reg?.status === "completed";
  const editable = canManage && !done && !busy;
  const setField = <K extends keyof PortalRegistrationData>(key: K, value: PortalRegistrationData[K]) => {
    setData((d) => (d ? { ...d, [key]: value } : d));
    setDirty(true);
  };
  const setContact = <K extends keyof PortalRegistrationData["contact"]>(key: K, value: PortalRegistrationData["contact"][K]) => {
    setData((d) => (d ? { ...d, contact: { ...d.contact, [key]: value } } : d));
    setDirty(true);
  };

  const plan = reg?.plan ?? null;
  const match = reg?.match ?? null;

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-registration-detail">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {reg?.data?.company ?? reg?.subject ?? t("portalRegistrations.detailTitle")}
            {reg ? <Badge variant={registrationStatusVariant(reg.status)}>{t(`portalRegistrations.statuses.${reg.status}`)}</Badge> : null}
          </DialogTitle>
          <DialogDescription>
            {reg
              ? t("portalRegistrations.detailMeta", {
                  date: fmt.dateTime(reg.receivedAt),
                  from: reg.fromEmail ?? reg.fromName ?? "–",
                })
              : null}
            {reg?.forwardedBy ? ` · ${t("portalRegistrations.via", { name: reg.forwardedBy })}` : ""}
          </DialogDescription>
        </DialogHeader>

        {detail.isLoading || !reg ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("common.loading")}
          </div>
        ) : (
          <div className="space-y-5">
            {reg.lastError ? (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                <AlertDescription>{reg.lastError}</AlertDescription>
              </Alert>
            ) : null}

            {/* Anmeldedaten */}
            <section className="space-y-2" aria-labelledby="reg-data-heading">
              <div className="flex items-center justify-between gap-2">
                <h2 id="reg-data-heading" className="text-base font-semibold">{t("portalRegistrations.sections.data")}</h2>
                {reg.extraction ? (
                  <span className="text-xs text-muted-foreground">
                    {t(`portalRegistrations.extractionSource.${reg.extraction.source}`, { percent: fmt.percent(reg.extraction.confidence, 0) })}
                  </span>
                ) : null}
              </div>
              {data ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DataField id="reg-company" label={t("portalRegistrations.fields.company")} value={data.company} onChange={(v) => setField("company", v)} disabled={!editable} />
                  <DataField id="reg-customer-number" label={t("portalRegistrations.fields.customerNumber")} value={data.customerNumber} onChange={(v) => setField("customerNumber", v)} disabled={!editable} />
                  <DataField id="reg-vat" label={t("portalRegistrations.fields.vatId")} value={data.vatId} onChange={(v) => setField("vatId", v)} disabled={!editable} />
                  <DataField id="reg-phone" label={t("portalRegistrations.fields.phone")} value={data.phone} onChange={(v) => setField("phone", v)} disabled={!editable} />
                  <DataField id="reg-street" label={t("portalRegistrations.fields.street")} value={data.street} onChange={(v) => setField("street", v)} disabled={!editable} />
                  <DataField id="reg-zip" label={t("portalRegistrations.fields.zipCode")} value={data.zipCode} onChange={(v) => setField("zipCode", v)} disabled={!editable} />
                  <DataField id="reg-city" label={t("portalRegistrations.fields.city")} value={data.city} onChange={(v) => setField("city", v)} disabled={!editable} />
                  <DataField id="reg-country" label={t("portalRegistrations.fields.country")} value={data.country} onChange={(v) => setField("country", v)} disabled={!editable} />
                  <div>
                    <Label htmlFor="reg-salutation" className="text-xs">{t("portalRegistrations.fields.salutation")}</Label>
                    <Select value={data.contact.salutation ?? "none"} onValueChange={(v) => setContact("salutation", v === "none" ? null : (v as "mr" | "mrs"))} disabled={!editable}>
                      <SelectTrigger id="reg-salutation" className="mt-1 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">{t("portalRegistrations.salutations.none")}</SelectItem>
                        <SelectItem value="mr">{t("portalRegistrations.salutations.mr")}</SelectItem>
                        <SelectItem value="mrs">{t("portalRegistrations.salutations.mrs")}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DataField id="reg-first-name" label={t("portalRegistrations.fields.firstName")} value={data.contact.firstName} onChange={(v) => setContact("firstName", v)} disabled={!editable} />
                  <DataField id="reg-last-name" label={t("portalRegistrations.fields.lastName")} value={data.contact.lastName} onChange={(v) => setContact("lastName", v)} disabled={!editable} />
                  <DataField id="reg-email" label={t("portalRegistrations.fields.email")} value={data.contact.email} onChange={(v) => setContact("email", v?.toLowerCase() ?? null)} disabled={!editable} />
                  <DataField id="reg-contact-phone" label={t("portalRegistrations.fields.contactPhone")} value={data.contact.phone} onChange={(v) => setContact("phone", v)} disabled={!editable} />
                  {(["expertMode", "adminMode"] as const).map((key) => (
                    <div key={key}>
                      <Label htmlFor={`reg-${key}`} className="text-xs">{t(`portalRegistrations.fields.${key}`)}</Label>
                      <Select value={triOf(data[key])} onValueChange={(v) => setField(key, triTo(v))} disabled={!editable}>
                        <SelectTrigger id={`reg-${key}`} className="mt-1 h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {TRI.map((v) => (
                            <SelectItem key={v} value={v}>{t(`portalRegistrations.tri.${v}`)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ))}
                  <div className="sm:col-span-2 lg:col-span-4">
                    <Label htmlFor="reg-notes" className="text-xs">{t("portalRegistrations.fields.notes")}</Label>
                    <Textarea id="reg-notes" className="mt-1" rows={2} value={data.notes ?? ""} disabled={!editable} onChange={(e) => setField("notes", orNull(e.target.value))} />
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t("portalRegistrations.noData")}</p>
              )}
              {canManage && dirty && data ? (
                <div className="flex gap-2">
                  <Button size="sm" disabled={busy} onClick={() => action.mutate({ path: "data", method: "PUT", body: { data }, okKey: "portalRegistrations.toasts.dataSaved" })} data-testid="button-registration-save-data">
                    {t("portalRegistrations.actions.saveData")}
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setDirty(false); setData(reg.data); }}>
                    {t("portalRegistrations.actions.resetData")}
                  </Button>
                </div>
              ) : null}
            </section>

            {/* Kunde im Portal */}
            <section className="space-y-2" aria-labelledby="reg-match-heading">
              <h2 id="reg-match-heading" className="text-base font-semibold">{t("portalRegistrations.sections.customer")}</h2>
              {match ? (
                <>
                  <p className="text-sm">
                    {t(`portalRegistrations.matchDetail.${match.status}`)}
                    {match.notes.map((note) => (
                      <span key={note} className="block text-xs text-amber-800 dark:text-amber-300">{t(`portalRegistrations.matchNotes.${note}`)}</span>
                    ))}
                  </p>
                  {match.candidates.length ? (
                    <ul className="divide-y rounded-md border">
                      {match.candidates.map((c) => {
                        const chosen = plan?.customerId === c.customer.id;
                        return (
                          <li key={c.customer.id} className={`flex flex-wrap items-center justify-between gap-2 p-2 text-sm ${chosen ? "bg-muted" : ""}`}>
                            <div>
                              <div className="font-medium">
                                {c.customer.customerNumber ?? "–"} · {c.customer.company ?? "–"}
                                {!c.customer.active ? <Badge variant="outline" className="ml-2">{t("portalRegistrations.inactive")}</Badge> : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {[c.customer.address.street, [c.customer.address.zipCode, c.customer.address.city].filter(Boolean).join(" "), c.customer.salesChannelName]
                                  .filter(Boolean)
                                  .join(" · ")}
                              </div>
                              <div className="text-xs text-muted-foreground">{c.reasons.join(" · ")}</div>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs tabular-nums">{fmt.percentValue(c.score, 0)}</span>
                              {chosen ? (
                                <Badge>{t("portalRegistrations.chosen")}</Badge>
                              ) : canManage && !done ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() => action.mutate({ path: "customer", body: { customerId: c.customer.id }, okKey: "portalRegistrations.toasts.customerChosen" })}
                                  data-testid={`button-choose-customer-${c.customer.customerNumber ?? c.customer.id}`}
                                >
                                  {t("portalRegistrations.actions.chooseCustomer")}
                                </Button>
                              ) : null}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}
                  {match.shopAccounts.length ? (
                    <p className="text-xs text-muted-foreground">
                      {t("portalRegistrations.shopAccounts", {
                        list: match.shopAccounts.map((s) => `${s.customerNumber ?? "–"} ${s.company ?? ""}`.trim()).join(", "),
                      })}
                    </p>
                  ) : null}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">{t("portalRegistrations.notChecked")}</p>
              )}
              {canManage && !done ? (
                <div className="flex flex-wrap items-end gap-2">
                  <div>
                    <Label htmlFor="reg-pick-number" className="text-xs">{t("portalRegistrations.pickByNumber")}</Label>
                    <Input id="reg-pick-number" className="mt-1 h-8 w-48" value={customerNumber} onChange={(e) => setCustomerNumber(e.target.value)} />
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy || !customerNumber.trim()}
                    onClick={() => action.mutate({ path: "customer", body: { customerNumber: customerNumber.trim() }, okKey: "portalRegistrations.toasts.customerChosen" })}
                    data-testid="button-registration-pick-number"
                  >
                    {t("portalRegistrations.actions.assign")}
                  </Button>
                </div>
              ) : null}
            </section>

            {/* Plan */}
            {plan ? (
              <section className="space-y-2" aria-labelledby="reg-plan-heading">
                <h2 id="reg-plan-heading" className="text-base font-semibold">{done ? t("portalRegistrations.sections.planDone") : t("portalRegistrations.sections.plan")}</h2>
                <ul className="list-disc pl-5 text-sm space-y-1">
                  <li>
                    {t(`portalRegistrations.plan.employee_${plan.employee.action}`, {
                      name: `${plan.employee.firstName} ${plan.employee.lastName}`.trim(),
                      email: plan.employee.email,
                    })}
                  </li>
                  <li>{t(`portalRegistrations.plan.link_${plan.link.action}`, { customer: `${plan.customerNumber ?? ""} ${plan.company ?? ""}`.trim() })}</li>
                  {plan.employee.expertMode ? <li>{t("portalRegistrations.plan.expertMode")}</li> : null}
                  {plan.employee.adminMode ? <li>{t("portalRegistrations.plan.adminMode")}</li> : null}
                </ul>
                {plan.customerChanges.length ? (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">{t("portalRegistrations.plan.customerChanges")}</p>
                    {plan.customerChanges.map((c: PortalCustomerChange) => (
                      <div key={c.field} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          id={`reg-change-${c.field}`}
                          checked={c.apply}
                          disabled={!editable}
                          onCheckedChange={(v) => action.mutate({ path: "plan", method: "PATCH", body: { changes: { [c.field]: v === true } }, okKey: "portalRegistrations.toasts.planSaved" })}
                        />
                        <Label htmlFor={`reg-change-${c.field}`} className="font-normal">
                          {t(`portalRegistrations.changes.${c.field}`, { from: c.from ?? "–", to: c.to })}
                        </Label>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="flex items-center gap-2 text-sm">
                  <Checkbox
                    id="reg-send-reset"
                    checked={plan.sendPasswordReset}
                    disabled={!editable}
                    onCheckedChange={(v) => action.mutate({ path: "plan", method: "PATCH", body: { sendPasswordReset: v === true }, okKey: "portalRegistrations.toasts.planSaved" })}
                  />
                  <Label htmlFor="reg-send-reset" className="font-normal">{t("portalRegistrations.plan.sendPasswordReset", { email: plan.employee.email })}</Label>
                </div>
                {plan.blockers.length ? (
                  <Alert>
                    <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                    <AlertDescription>
                      {plan.blockers.map((b) => (
                        <span key={b} className="block">{t(`portalRegistrations.blockers.${b}`)}</span>
                      ))}
                    </AlertDescription>
                  </Alert>
                ) : null}
              </section>
            ) : null}

            {/* Aktionen */}
            {canManage ? (
              <div className="flex flex-wrap gap-2 border-t pt-4">
                {plan && !done ? (
                  <Button
                    disabled={busy || plan.blockers.length > 0 || dirty}
                    onClick={() => action.mutate({ path: "execute", okKey: "portalRegistrations.toasts.executed" })}
                    data-testid="button-registration-execute"
                  >
                    {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" /> : null}
                    {t("portalRegistrations.actions.execute")}
                  </Button>
                ) : null}
                {!done ? (
                  <>
                    <Button variant="outline" disabled={busy} onClick={() => action.mutate({ path: "recheck", okKey: "portalRegistrations.toasts.rechecked" })} data-testid="button-registration-recheck">
                      {t("portalRegistrations.actions.recheck")}
                    </Button>
                    <Button
                      variant="outline"
                      disabled={busy}
                      onClick={() => action.mutate({ path: "recheck", body: { reextract: true }, okKey: "portalRegistrations.toasts.rechecked" })}
                      data-testid="button-registration-reextract"
                    >
                      {t("portalRegistrations.actions.reextract")}
                    </Button>
                    {reg.status !== "waiting_master_data" ? (
                      <Button
                        variant="outline"
                        disabled={busy || !reg.data}
                        onClick={() => action.mutate({ path: "master-data", okKey: "portalRegistrations.toasts.masterData" })}
                        data-testid="button-registration-master-data"
                      >
                        {t("portalRegistrations.actions.masterData")}
                      </Button>
                    ) : null}
                  </>
                ) : null}
                {reg.employeeId && plan ? (
                  <Button variant="outline" disabled={busy} onClick={() => action.mutate({ path: "password-reset", okKey: "portalRegistrations.toasts.passwordReset" })} data-testid="button-registration-password-reset">
                    {t("portalRegistrations.actions.passwordReset")}
                  </Button>
                ) : null}
                {!done && reg.status !== "discarded" ? (
                  <Button variant="ghost" disabled={busy} onClick={() => action.mutate({ path: "discard", okKey: "portalRegistrations.toasts.discarded" })} data-testid="button-registration-discard">
                    {t("portalRegistrations.actions.discard")}
                  </Button>
                ) : null}
                {reg.hasOriginal ? (
                  <Button variant="ghost" asChild>
                    <a href={`/api/b2b/registrations/${reg.id}/original`} download>
                      <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                      {t("portalRegistrations.actions.downloadOriginal")}
                    </a>
                  </Button>
                ) : null}
              </div>
            ) : null}

            {/* Mails */}
            {detail.data!.mails.length ? (
              <section className="space-y-2" aria-labelledby="reg-mails-heading">
                <h2 id="reg-mails-heading" className="text-base font-semibold">{t("portalRegistrations.sections.mails")}</h2>
                <ul className="divide-y rounded-md border text-sm">
                  {detail.data!.mails.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 p-2">
                      <div>
                        <div className="font-medium">{t(`portalRegistrations.mailKinds.${m.kind}`)}: {m.to.join(", ")}{m.cc.length ? ` (${t("portalRegistrations.cc")} ${m.cc.join(", ")})` : ""}</div>
                        <div className="text-xs text-muted-foreground">{m.subject}</div>
                        {m.lastError ? <div className="text-xs text-destructive">{m.lastError}</div> : null}
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant={m.status === "sent" ? "default" : m.status === "failed" ? "destructive" : "outline"}>
                          {t(`portalRegistrations.mailStatuses.${m.status}`)}
                        </Badge>
                        {m.sentAt ? <span className="text-xs text-muted-foreground">{fmt.dateTime(m.sentAt)}</span> : null}
                        {m.status === "failed" && canManage ? (
                          <Button size="sm" variant="outline" disabled={retryMail.isPending} onClick={() => retryMail.mutate(m.id)}>
                            {t("portalRegistrations.actions.retryMail")}
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {/* Verlauf */}
            <section className="space-y-2" aria-labelledby="reg-history-heading">
              <h2 id="reg-history-heading" className="text-base font-semibold">{t("portalRegistrations.sections.history")}</h2>
              <ol className="space-y-1 text-sm">
                {[...reg.events].reverse().map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex gap-3">
                    <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{fmt.dateTime(e.at)}</span>
                    <span>
                      {e.message}
                      {e.userName ? <span className="text-xs text-muted-foreground"> · {e.userName}</span> : null}
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {/* Originaltext */}
            <section className="space-y-2">
              <Button variant="ghost" size="sm" onClick={() => setShowBody((v) => !v)} aria-expanded={showBody}>
                {showBody ? t("portalRegistrations.hideMail") : t("portalRegistrations.showMail")}
              </Button>
              {showBody ? <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{reg.bodyText}</pre> : null}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
