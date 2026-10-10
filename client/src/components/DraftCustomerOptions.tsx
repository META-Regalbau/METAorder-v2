/**
 * Kundenauswahl im Entwurfs-Review: Trefferzeile mit Firma, Ansprechpartner, Kundennummer,
 * Ort und Verkaufskanal — B2B-Kunden haben oft mehrere Accounts (Niederlassungen), die sich
 * nur darin unterscheiden. Dazu die Vorschlagsliste aus dem Firmenabgleich der Pipeline.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

export type DraftShopwareCustomer = {
  id: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  customerNumber?: string;
  zipCode?: string;
  city?: string;
  salesChannelName?: string;
  reason?: "customer_number" | "company_exact_zip" | "company_exact" | "company_partial";
};

function reasonLabel(reason: NonNullable<DraftShopwareCustomer["reason"]>, t: TFunction): string {
  switch (reason) {
    case "customer_number":
      return t("draftCustomerOptions.reason.customerNumber");
    case "company_exact_zip":
      return t("draftCustomerOptions.reason.companyExactZip");
    case "company_exact":
      return t("draftCustomerOptions.reason.companyExact");
    case "company_partial":
      return t("draftCustomerOptions.reason.companyPartial");
    default:
      return reason;
  }
}

export function DraftCustomerOptionLabel({ customer }: { customer: DraftShopwareCustomer }) {
  const { t } = useTranslation();
  const person = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const place = [customer.zipCode, customer.city].filter(Boolean).join(" ");
  const meta = [
    customer.customerNumber && t("draftCustomerOptions.customerNumberShort", { number: customer.customerNumber }),
    place,
    customer.salesChannelName,
  ].filter(Boolean);
  return (
    <span className="block">
      <span className="font-medium">{customer.company || person || "—"}</span>
      {customer.company && person && <span className="ml-1">· {person}</span>}
      {customer.email && <span className="text-muted-foreground ml-1">({customer.email})</span>}
      {meta.length > 0 && <span className="block text-xs text-muted-foreground">{meta.join(" · ")}</span>}
    </span>
  );
}

/** Vorschläge aus dem Firmenabgleich (mehrere passende Accounts → Bearbeiter wählt). */
export function DraftCustomerCandidates({
  candidates,
  onAssign,
  disabled,
  testIdPrefix,
}: {
  candidates: DraftShopwareCustomer[] | null | undefined;
  onAssign: (customer: DraftShopwareCustomer) => void;
  disabled?: boolean;
  testIdPrefix: string;
}) {
  const { t } = useTranslation();
  if (!candidates || candidates.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={`${testIdPrefix}-candidates`}>
      <p className="text-sm">
        {t("draftCustomerOptions.candidatesIntro", { count: candidates.length })}
      </p>
      <ul className="border rounded-md divide-y max-h-64 overflow-y-auto max-w-2xl">
        {candidates.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="flex w-full items-start justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
              onClick={() => onAssign(c)}
              disabled={disabled}
              data-testid={`${testIdPrefix}-candidate-${c.id}`}
            >
              <DraftCustomerOptionLabel customer={c} />
              {c.reason && (
                <span className="shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {reasonLabel(c.reason, t)}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** true, wenn die manuelle Kundenanlage serverseitig freigeschaltet ist (Default: aus). */
type CommercialDraftCapabilities = {
  customerCreateEnabled: boolean;
  intentReviewMinConfidence?: number;
  customerMatchReviewMinConfidence?: number;
};

function useCommercialDraftCapabilities() {
  return useQuery<CommercialDraftCapabilities>({
    queryKey: ["/api/commercial-drafts/capabilities"],
    staleTime: 5 * 60 * 1000,
  }).data;
}

export function useCustomerCreateEnabled(): boolean {
  return useCommercialDraftCapabilities()?.customerCreateEnabled === true;
}

/** Hinweis-Schwellen im Prüffenster aus den Commercial-Agent-Einstellungen (Standard 0,6 / 72). */
export function useDraftReviewThresholds(): { intentMin: number; customerMatchMin: number } {
  const caps = useCommercialDraftCapabilities();
  return {
    intentMin: caps?.intentReviewMinConfidence ?? 0.6,
    customerMatchMin: caps?.customerMatchReviewMinConfidence ?? 72,
  };
}
