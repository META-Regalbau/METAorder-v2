import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
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
import { CUSTOMER_MAIL_BASES, type CustomerMailBasis, type CustomerMailContact } from "@shared/customerMails";
import { CUSTOMER_MAILS_QUERY_KEY } from "./customerMailsQuery";

/**
 * Reiter „Kontakte“: Suche nach Adresse, Firma oder Kundennummer, Filter je Rechtsgrundlage (höchstens 200
 * Zeilen), dazu Einwilligung erfassen (Außendienst/CRM, mit Vermerk) und Widerspruch erfassen (dauerhaft).
 */

export function BasisBadge({ basis }: { basis: CustomerMailBasis }) {
  const { t } = useTranslation();
  const label = t(`customerMails.basis.${basis}`);
  if (basis === "consent") return <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200">{label}</Badge>;
  if (basis === "existingCustomer") return <Badge className="bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200">{label}</Badge>;
  if (basis === "objected") return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}

type ContactList = { total: number; contacts: CustomerMailContact[] };

export function CustomerMailsContactsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const [q, setQ] = useState("");
  const [basis, setBasis] = useState<string>("all");
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (basis !== "all") params.set("basis", basis);
  const url = `/api/customer-mails/contacts${params.toString() ? `?${params}` : ""}`;
  const list = useQuery<ContactList>({ queryKey: ["/api/customer-mails/contacts", url], queryFn: async () => (await apiRequest("GET", url)).json() });

  const [consentEmail, setConsentEmail] = useState("");
  const [consentNote, setConsentNote] = useState("");
  const [consentDate, setConsentDate] = useState("");
  const [consentSource, setConsentSource] = useState<"crm" | "manual">("crm");
  const [objectionEmail, setObjectionEmail] = useState("");
  const [objectionNote, setObjectionNote] = useState("");

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/customer-mails/contacts"] });
    queryClient.invalidateQueries({ queryKey: CUSTOMER_MAILS_QUERY_KEY });
  };
  const consent = useMutation({
    mutationFn: async () =>
      (
        await apiRequest("POST", "/api/customer-mails/contacts/consent", {
          email: consentEmail.trim(),
          source: consentSource,
          note: consentNote.trim(),
          ...(consentDate ? { at: consentDate } : {}),
        })
      ).json() as Promise<CustomerMailContact>,
    onSuccess: (c) => {
      refresh();
      setConsentEmail("");
      setConsentNote("");
      setConsentDate("");
      toast({ title: c.basis === "objected" ? t("customerMails.contacts.consentButObjected") : t("customerMails.contacts.consentSaved") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.contacts.consentFailed"), description: error.message, variant: "destructive" }),
  });
  const objection = useMutation({
    mutationFn: async () =>
      (await apiRequest("POST", "/api/customer-mails/contacts/objection", { email: objectionEmail.trim(), ...(objectionNote.trim() ? { note: objectionNote.trim() } : {}) })).json() as Promise<CustomerMailContact>,
    onSuccess: () => {
      refresh();
      setObjectionEmail("");
      setObjectionNote("");
      toast({ title: t("customerMails.contacts.objectionSaved") });
    },
    onError: (error: Error) => toast({ title: t("customerMails.contacts.objectionFailed"), description: error.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1 min-w-0 flex-1 basis-64">
            <Label htmlFor="customer-mails-contacts-search">{t("customerMails.contacts.search")}</Label>
            <Input id="customer-mails-contacts-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("customerMails.contacts.searchPlaceholder")} data-testid="input-customer-mails-contacts-search" />
          </div>
          <div className="space-y-1 min-w-0 basis-48">
            <Label htmlFor="customer-mails-contacts-basis">{t("customerMails.contacts.filter")}</Label>
            <Select value={basis} onValueChange={setBasis}>
              <SelectTrigger id="customer-mails-contacts-basis" data-testid="select-customer-mails-contacts-basis">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("customerMails.contacts.all")}</SelectItem>
                {CUSTOMER_MAIL_BASES.map((b) => (
                  <SelectItem key={b} value={b}>
                    {t(`customerMails.basis.${b}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        {list.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t("customerMails.loading")}
          </div>
        ) : list.data && list.data.contacts.length ? (
          <>
            <p className="text-xs text-muted-foreground">{t("customerMails.contacts.shown", { shown: list.data.contacts.length, total: list.data.total })}</p>
            <div className="overflow-x-auto">
              <Table data-testid="table-customer-mails-contacts">
                <TableHeader>
                  <TableRow>
                    <TableHead>{t("customerMails.contacts.columns.email")}</TableHead>
                    <TableHead>{t("customerMails.contacts.columns.customer")}</TableHead>
                    <TableHead className="text-right">{t("customerMails.contacts.columns.orders")}</TableHead>
                    <TableHead>{t("customerMails.contacts.columns.lastOrder")}</TableHead>
                    <TableHead>{t("customerMails.contacts.columns.basis")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.data.contacts.map((c) => (
                    <TableRow key={c.email}>
                      <TableCell className="text-sm break-all">{c.email}</TableCell>
                      <TableCell className="text-sm">
                        {c.company || c.contactName || "–"}
                        <div className="text-xs text-muted-foreground">
                          {[c.customerNumber, c.channelKind ? t(`customerMails.channelKinds.${c.channelKind}`) : null].filter(Boolean).join(" · ")}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">{c.orderCount}</TableCell>
                      <TableCell className="text-sm whitespace-nowrap">{c.lastOrderAt ? fmt.date(c.lastOrderAt) : "–"}</TableCell>
                      <TableCell className="text-sm">
                        <BasisBadge basis={c.basis} />
                        <div className="text-xs text-muted-foreground mt-1">
                          {c.objectionAt
                            ? t("customerMails.contacts.objectionFrom", { source: t(`customerMails.objectionSources.${c.objectionSource ?? "manual"}`), date: fmt.date(c.objectionAt) })
                            : c.consentAt
                              ? t("customerMails.contacts.consentFrom", { source: t(`customerMails.consentSources.${c.consentSource ?? "manual"}`), date: fmt.date(c.consentAt) })
                              : null}
                          {c.bouncedAt ? ` · ${t("customerMails.contacts.bounced")}` : ""}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">{t("customerMails.contacts.none")}</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4 space-y-3">
          <div className="space-y-1">
            <h2 className="font-semibold">{t("customerMails.contacts.consentTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("customerMails.contacts.consentHint")}</p>
          </div>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (consentEmail.trim() && consentNote.trim().length >= 3) consent.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="customer-mails-consent-email">{t("customerMails.contacts.email")}</Label>
              <Input id="customer-mails-consent-email" type="email" value={consentEmail} onChange={(e) => setConsentEmail(e.target.value)} data-testid="input-customer-mails-consent-email" />
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="space-y-1 flex-1 basis-40">
                <Label htmlFor="customer-mails-consent-source">{t("customerMails.contacts.source")}</Label>
                <Select value={consentSource} onValueChange={(v) => setConsentSource(v as "crm" | "manual")}>
                  <SelectTrigger id="customer-mails-consent-source">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="crm">{t("customerMails.consentSources.crm")}</SelectItem>
                    <SelectItem value="manual">{t("customerMails.consentSources.manual")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1 flex-1 basis-40">
                <Label htmlFor="customer-mails-consent-date">{t("customerMails.contacts.date")}</Label>
                <Input id="customer-mails-consent-date" type="date" value={consentDate} onChange={(e) => setConsentDate(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-mails-consent-note">{t("customerMails.contacts.note")}</Label>
              <Input id="customer-mails-consent-note" value={consentNote} maxLength={500} placeholder={t("customerMails.contacts.notePlaceholder")} onChange={(e) => setConsentNote(e.target.value)} data-testid="input-customer-mails-consent-note" />
            </div>
            <Button type="submit" disabled={consent.isPending || !consentEmail.trim() || consentNote.trim().length < 3} data-testid="button-customer-mails-consent-save">
              {consent.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("customerMails.contacts.consentSave")}
            </Button>
          </form>
        </Card>

        <Card className="p-4 space-y-3">
          <div className="space-y-1">
            <h2 className="font-semibold">{t("customerMails.contacts.objectionTitle")}</h2>
            <p className="text-xs text-muted-foreground">{t("customerMails.contacts.objectionHint")}</p>
          </div>
          <form
            className="space-y-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (objectionEmail.trim()) objection.mutate();
            }}
          >
            <div className="space-y-1">
              <Label htmlFor="customer-mails-objection-email">{t("customerMails.contacts.email")}</Label>
              <Input id="customer-mails-objection-email" type="email" value={objectionEmail} onChange={(e) => setObjectionEmail(e.target.value)} data-testid="input-customer-mails-objection-email" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="customer-mails-objection-note">{t("customerMails.contacts.note")}</Label>
              <Input id="customer-mails-objection-note" value={objectionNote} maxLength={500} onChange={(e) => setObjectionNote(e.target.value)} />
            </div>
            <Button type="submit" variant="destructive" disabled={objection.isPending || !objectionEmail.trim()} data-testid="button-customer-mails-objection-save">
              {objection.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("customerMails.contacts.objectionSave")}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
