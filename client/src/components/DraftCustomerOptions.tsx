/**
 * Kundenauswahl im Entwurfs-Review: Trefferzeile mit Firma, Ansprechpartner, Kundennummer,
 * Ort und Verkaufskanal — B2B-Kunden haben oft mehrere Accounts (Niederlassungen), die sich
 * nur darin unterscheiden. Dazu die Vorschlagsliste aus dem Firmenabgleich der Pipeline.
 */

import { useQuery } from "@tanstack/react-query";

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

const REASON_LABEL: Record<NonNullable<DraftShopwareCustomer["reason"]>, string> = {
  customer_number: "Kundennummer",
  company_exact_zip: "Firma + PLZ",
  company_exact: "Firma",
  company_partial: "Firma ähnlich",
};

export function DraftCustomerOptionLabel({ customer }: { customer: DraftShopwareCustomer }) {
  const person = [customer.firstName, customer.lastName].filter(Boolean).join(" ");
  const place = [customer.zipCode, customer.city].filter(Boolean).join(" ");
  const meta = [
    customer.customerNumber && `Kd.-Nr. ${customer.customerNumber}`,
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
  if (!candidates || candidates.length === 0) return null;
  return (
    <div className="space-y-1" data-testid={`${testIdPrefix}-candidates`}>
      <p className="text-sm">
        Kein Kunde mit dieser E-Mail-Adresse gefunden. Zur Firma passen {candidates.length} bestehende
        Shopware-Accounts — bitte den richtigen wählen:
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
                  {REASON_LABEL[c.reason]}
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
export function useCustomerCreateEnabled(): boolean {
  const { data } = useQuery<{ customerCreateEnabled: boolean }>({
    queryKey: ["/api/commercial-drafts/capabilities"],
    staleTime: 5 * 60 * 1000,
  });
  return data?.customerCreateEnabled === true;
}
