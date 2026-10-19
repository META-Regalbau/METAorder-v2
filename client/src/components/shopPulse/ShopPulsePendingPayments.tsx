import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import type { ShopPulseSignal } from "@shared/shopPulse";

/**
 * Shop-Puls Stufe 3 (S3-3): hängende Online-Zahlungen (Meldung paymentsPending) als Liste unter der Meldung,
 * je Bestellung ein Link zur Bestellliste. Bei Mondu steht in der Bestellung „Mondu-Zahlung erneut senden“ (#184).
 */
type PendingOrder = { number: string; method: string | null; total: number; at: string; status: string | null; mondu: boolean };

export function ShopPulsePendingPayments({ signal }: { signal: ShopPulseSignal }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const orders = (Array.isArray(signal.evidence.orders) ? signal.evidence.orders : []) as PendingOrder[];
  if (!orders.length) return null;
  return (
    <div className="mt-2 max-w-2xl rounded-md border p-2 text-sm" data-testid={`shop-pulse-pending-${signal.id}`}>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{t("shopPulse.payments.pendingTitle")}</div>
      <ul className="space-y-1">
        {orders.slice(0, 20).map((o) => (
          <li key={o.number} className="flex flex-wrap gap-x-2">
            <Link href={`/orders?search=${encodeURIComponent(o.number)}`} className="font-mono underline">
              {o.number}
            </Link>
            <span>{o.method ?? "–"}</span>
            <span>{fmt.currency(o.total)}</span>
            <span className="text-muted-foreground">{t("shopPulse.payments.since", { at: fmt.dateTime(o.at) })}</span>
            {o.mondu ? <span className="text-xs text-amber-700 dark:text-amber-300">{t("shopPulse.payments.monduHint")}</span> : null}
          </li>
        ))}
      </ul>
      {orders.length > 20 ? <div className="mt-1 text-xs text-muted-foreground">{t("shopPulse.payments.more", { count: orders.length - 20 })}</div> : null}
    </div>
  );
}
