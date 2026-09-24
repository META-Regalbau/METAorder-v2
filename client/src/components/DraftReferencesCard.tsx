/**
 * „Referenzen & Lieferhinweise": belegspezifische Pflichtangaben aus der Extraktion —
 * Kundenreferenz („Nummer beim Kunden"), Kommission, Ansprechpartner am Lieferort,
 * Lieferschein-/Anlieferhinweise, AB- und Rechnungsadresse. Eigene Felder, damit sie
 * bei der Bestellanlage in den Kundenkommentar und später auf Lieferschein/AB gelangen.
 */

import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

export type DraftDocumentReferencesLite = {
  customerReference?: string;
  commission?: string;
  supplierOfferNumber?: string;
  deliveryContactName?: string;
  deliveryContactPhone?: string;
  deliveryContactEmail?: string;
  deliveryNoteInstructions?: string;
  orderConfirmationEmail?: string;
  invoiceEmail?: string;
};

export function DraftReferencesCard({ references }: { references: DraftDocumentReferencesLite | null | undefined }) {
  const { t } = useTranslation();
  if (!references) return null;
  const rows: Array<{ key: string; label: string; value: string; important?: boolean }> = [];
  const push = (key: keyof DraftDocumentReferencesLite, label: string, important = false) => {
    const v = references[key]?.trim();
    if (v) rows.push({ key, label, value: v, important });
  };
  push("customerReference", t("orderDrafts.review.references.customerReference", "Kundenreferenz / Nummer beim Kunden"), true);
  push("commission", t("orderDrafts.review.references.commission", "Kommission"), true);
  push("supplierOfferNumber", t("orderDrafts.review.references.supplierOfferNumber", "Bezug auf META-Angebot"), true);
  const contact = [references.deliveryContactName, references.deliveryContactPhone, references.deliveryContactEmail]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  if (contact) rows.push({ key: "deliveryContact", label: t("orderDrafts.review.references.deliveryContact", "Ansprechpartner am Lieferort"), value: contact });
  push("deliveryNoteInstructions", t("orderDrafts.review.references.deliveryNoteInstructions", "Lieferschein / Anlieferung"), true);
  push("orderConfirmationEmail", t("orderDrafts.review.references.orderConfirmationEmail", "Auftragsbestätigung an"));
  push("invoiceEmail", t("orderDrafts.review.references.invoiceEmail", "Rechnung an"));
  if (rows.length === 0) return null;

  return (
    <Card data-testid="card-draft-references">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="w-4 h-4" />
          {t("orderDrafts.review.references.title", "Referenzen & Lieferhinweise")}
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {t(
            "orderDrafts.review.references.hint",
            "Werden bei der Bestellanlage in den Kundenkommentar übernommen und gehören auf Lieferschein und Auftragsbestätigung."
          )}
        </p>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 md:grid-cols-2">
          {rows.map((row) => (
            <div key={row.key} data-testid={`draft-reference-${row.key}`}>
              <dt className="text-xs text-muted-foreground">{row.label}</dt>
              <dd className={`text-sm ${row.important ? "font-medium" : ""}`}>{row.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  );
}
