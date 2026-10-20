import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type { CustomerMailContactStatus } from "@shared/customerMails";

/**
 * Werbe-Status einer Adresse im CRM-Kundendetail (Kundenmails B1): Einwilligung, Bestandskunde, keine Grundlage
 * oder Widerspruch. Der Außendienst sieht so vor einem Gespräch, ob der Kunde Werbemails bekommen darf.
 */
export function CustomerMailStatusBadge({ email }: { email: string | null | undefined }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const address = (email ?? "").trim();
  const query = useQuery<CustomerMailContactStatus>({
    queryKey: ["/api/customer-mails/contact-status", address],
    queryFn: async () => {
      const res = await fetch(`/api/customer-mails/contact-status?email=${encodeURIComponent(address)}`, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    },
    enabled: !!address,
    retry: false,
  });
  const s = query.data;
  if (!s) return null;
  const detail = s.objectionAt
    ? t("customerMails.contacts.objectionFrom", { source: t(`customerMails.objectionSources.${s.objectionSource ?? "manual"}`), date: fmt.date(s.objectionAt) })
    : s.consentAt
      ? t("customerMails.contacts.consentFrom", { source: t(`customerMails.consentSources.${s.consentSource ?? "manual"}`), date: fmt.date(s.consentAt) })
      : t("customerMails.crmBadge.noBasisHint");
  const label = t("customerMails.crmBadge.label", { basis: t(`customerMails.basis.${s.basis}`) });
  const className =
    s.basis === "objected"
      ? "border-destructive text-destructive"
      : s.basis === "consent"
        ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200"
        : s.basis === "existingCustomer"
          ? "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-200"
          : "";
  return (
    <Badge variant="outline" className={`ml-2 align-middle text-xs font-normal ${className}`} title={detail} data-testid="badge-customer-mail-status">
      {label}
    </Badge>
  );
}
