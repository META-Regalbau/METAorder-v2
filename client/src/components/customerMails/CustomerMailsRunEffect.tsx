import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type { CustomerMailRunEffect } from "@shared/customerMails";

/**
 * Wirkung einer verschickten Aussendung (B6): Brevo-Zahlen, Klicks und Bestellungen der Empfänger in den Tagen nach
 * dem Versand, bei vorhandener Kontrollgruppe im Vergleich (Anteil Besteller je Gruppe).
 */
export function CustomerMailsRunEffect({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const q = useQuery<CustomerMailRunEffect>({ queryKey: ["/api/customer-mails/runs", runId, "effect"] });
  const e = q.data;
  if (!e) return null;
  const rate = (customers: number, size: number) => (size ? fmt.percent(customers / size) : "–");
  return (
    <div className="border-t pt-3 space-y-1 text-sm" data-testid="customer-mails-run-effect">
      <div className="font-medium">{t("customerMails.effect.title", { days: e.windowDays })}</div>
      {e.brevo ? (
        <div>
          {t("customerMails.effect.brevo", {
            delivered: fmt.integer(e.brevo.delivered),
            views: fmt.integer(e.brevo.uniqueViews),
            clicks: fmt.integer(e.brevo.uniqueClicks),
            unsubscribed: fmt.integer(e.brevo.unsubscriptions),
            bounces: fmt.integer(e.brevo.hardBounces),
          })}
        </div>
      ) : e.brevoError ? (
        <div className="text-destructive">{t("customerMails.brevoError", { error: e.brevoError })}</div>
      ) : (
        <div className="text-muted-foreground">{t("customerMails.effect.noBrevo")}</div>
      )}
      <div>
        {t("customerMails.effect.orders", {
          sent: fmt.integer(e.sent),
          customers: fmt.integer(e.orders.customers),
          rate: rate(e.orders.customers, e.sent),
          orders: fmt.integer(e.orders.orders),
          net: fmt.currency(e.orders.net),
        })}
      </div>
      {e.control ? (
        <div>
          {t("customerMails.effect.control", {
            size: fmt.integer(e.control.size),
            customers: fmt.integer(e.control.customers),
            rate: rate(e.control.customers, e.control.size),
            net: fmt.currency(e.control.net),
          })}
        </div>
      ) : null}
    </div>
  );
}
