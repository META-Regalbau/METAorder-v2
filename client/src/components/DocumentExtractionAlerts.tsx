/**
 * UI-Hinweise zur META-aware Extraktion (DocumentExtraction-Schema):
 *  - DocumentExtractionRecipientMetaAlert: rotes Banner, wenn der Beleg eine
 *    META-Adresse als Empfänger trägt (vermutlich Lieferanten-AB / Reorder).
 *  - DocumentExtractionWarningsAlert: gelbes Banner mit allen
 *    `extraction_meta.warnings` (z. B. „total_net weicht ab").
 *  - LineItemConfidenceWarningBadges: kleine Badges pro Zeile, die je
 *    Confidence-Warnung (z. B. "description_truncated") sichtbar machen.
 *  - LineItemBuyerSkuLabel: hängt die Kunden-SKU als kleine Zeile unter
 *    die Bestellnr/SKU, falls vorhanden und vom supplier_sku verschieden.
 *
 * Eingabewerte sind bewusst defensiv typisiert (`unknown`/optional), weil
 * `extractedData` ein jsonb-Side-Pocket ist — UI darf nie crashen, wenn
 * Felder fehlen.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, AlertCircle } from "lucide-react";

export interface DocumentExtractionLite {
  document?: {
    recipient_is_meta?: boolean;
    type?: string;
    number?: string | null;
  };
  extraction_meta?: {
    overall_confidence?: "high" | "medium" | "low";
    warnings?: string[];
    calculated_total_net?: number | null;
    total_matches_calculated?: boolean | null;
  };
  line_items?: Array<{
    position?: number;
    supplier_sku?: string | null;
    buyer_sku?: string | null;
    confidence_warnings?: string[];
  }>;
}

const CONFIDENCE_WARNING_LABELS_DE: Record<string, string> = {
  description_truncated: "Beschreibung möglicherweise abgeschnitten",
  missing_unit_price: "Einzelpreis fehlt",
  missing_supplier_sku: "Artikel-Nr. fehlt",
  ambiguous_quantity: "Menge mehrdeutig",
};

function localizeConfidenceWarning(code: string): string {
  return CONFIDENCE_WARNING_LABELS_DE[code] ?? code;
}

export function DocumentExtractionRecipientMetaAlert({
  extraction,
}: {
  extraction: DocumentExtractionLite | null | undefined;
}) {
  if (!extraction?.document?.recipient_is_meta) return null;
  return (
    <Alert
      variant="destructive"
      className="border-destructive/60"
      data-testid="alert-recipient-is-meta"
    >
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="text-sm">Empfänger ist META</AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground">
        Dieses Dokument adressiert einen META-Standort als Empfänger — vermutlich
        eine Lieferanten-Auftragsbestätigung oder eine interne Bestellung.
        Bitte prüfen, ob der Beleg überhaupt als Kunden-Bestellung / -Anfrage
        verarbeitet werden soll.
      </AlertDescription>
    </Alert>
  );
}

export function DocumentExtractionWarningsAlert({
  extraction,
}: {
  extraction: DocumentExtractionLite | null | undefined;
}) {
  const warnings = extraction?.extraction_meta?.warnings ?? [];
  const totalMatches = extraction?.extraction_meta?.total_matches_calculated;
  const overall = extraction?.extraction_meta?.overall_confidence;
  if (warnings.length === 0 && totalMatches !== false && overall === "high") return null;
  return (
    <Alert className="border-amber-500/40 bg-amber-500/5" data-testid="alert-extraction-meta-warnings">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle className="text-sm">Extraktion: Warnungen</AlertTitle>
      <AlertDescription className="text-xs text-muted-foreground space-y-1">
        {overall && (
          <p>
            Gesamt-Konfidenz der Extraktion: <strong>{overall}</strong>
            {totalMatches === false && " (Summe weicht von berechneter Summe ab)"}
          </p>
        )}
        {warnings.length > 0 && (
          <ul className="list-disc pl-4 space-y-0.5">
            {warnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Pro-Position-Badges für `confidence_warnings` (z. B. „description_truncated"). */
export function LineItemConfidenceWarningBadges({
  warnings,
}: {
  warnings: string[] | undefined | null;
}) {
  if (!warnings || warnings.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1">
      {warnings.map((code) => (
        <Badge
          key={code}
          variant="outline"
          className="text-[10px] border-amber-600/60 text-amber-800 dark:text-amber-200"
          title={code}
          data-testid={`badge-confidence-warning-${code}`}
        >
          <AlertCircle className="w-2.5 h-2.5 mr-1" />
          {localizeConfidenceWarning(code)}
        </Badge>
      ))}
    </div>
  );
}

/** Kleines Label „Kunden-SKU: …", wenn buyer_sku gesetzt und ≠ supplier_sku ist. */
export function LineItemBuyerSkuLabel({
  buyerSku,
  supplierSku,
}: {
  buyerSku?: string | null;
  supplierSku?: string | null;
}) {
  const b = buyerSku?.trim();
  const s = supplierSku?.trim();
  if (!b || b === s) return null;
  return (
    <div className="text-[11px] text-muted-foreground mt-0.5" data-testid="text-buyer-sku">
      Kunden-SKU: <span className="font-mono">{b}</span>
    </div>
  );
}

/** Helper: holt das DocumentExtraction-Side-Pocket aus extractedData (jsonb). */
export function pickDocumentExtraction(
  extractedData: Record<string, unknown> | null | undefined
): DocumentExtractionLite | undefined {
  if (!extractedData || typeof extractedData !== "object") return undefined;
  const v = (extractedData as { documentExtraction?: unknown }).documentExtraction;
  if (!v || typeof v !== "object") return undefined;
  return v as DocumentExtractionLite;
}
