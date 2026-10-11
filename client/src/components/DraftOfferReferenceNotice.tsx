import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileText } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";

type OfferReference = {
  offerNumber: string;
  applied: boolean;
  note: string | null;
  noteCode?: string | null;
  noteCount?: number;
  offerNet: number | null;
  documentNet: number | null;
  totalsMatch: boolean | null;
  originalLineItems?: Array<{ extractedProductName?: string; extractedProductNumber?: string; quantity?: number; extractedPrice?: number }>;
};

/** Bestellung „laut Angebot …“: Hinweis im Prüffenster (server/commercial/draftOfferReference.ts) */
export function DraftOfferReferenceNotice({ extractedData }: { extractedData: unknown }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const [showOriginal, setShowOriginal] = useState(false);
  const ref = (extractedData as { offerReference?: OfferReference } | null | undefined)?.offerReference;
  if (!ref?.offerNumber) return null;

  const totals =
    ref.offerNet != null && ref.documentNet != null
      ? t("draftReview.offerReference.totals", { document: fmt.currency(ref.documentNet), offer: fmt.currency(ref.offerNet) })
      : null;

  return (
    <Alert className="mb-3" data-testid="alert-offer-reference">
      <FileText className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>
        {ref.applied
          ? t("draftReview.offerReference.applied", { number: ref.offerNumber })
          : t("draftReview.offerReference.notApplied", { number: ref.offerNumber })}
      </AlertTitle>
      <AlertDescription className="space-y-1 text-sm">
        {ref.noteCode ? <p>{t(`draftReview.offerReference.notes.${ref.noteCode}`, { count: ref.noteCount ?? 0 })}</p> : null}
        {totals ? (
          <p className={ref.totalsMatch === false ? "text-amber-700 dark:text-amber-300 font-medium" : undefined}>
            {totals}
            {ref.totalsMatch === false ? ` – ${t("draftReview.offerReference.totalsDiffer")}` : ""}
          </p>
        ) : null}
        {ref.applied && ref.originalLineItems?.length ? (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              aria-expanded={showOriginal}
              onClick={() => setShowOriginal((v) => !v)}
              data-testid="button-offer-reference-original"
            >
              {t("draftReview.offerReference.originalLines", { count: ref.originalLineItems.length })}
            </Button>
            {showOriginal ? (
              <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">
                {ref.originalLineItems.map((line, i) => (
                  <li key={i}>
                    {line.quantity ?? "?"} × {line.extractedProductName || line.extractedProductNumber || "—"}
                    {typeof line.extractedPrice === "number" ? ` (${fmt.currency(line.extractedPrice)})` : ""}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

type BomSplitEntry = {
  originalPosition: number;
  originalLine: { extractedProductName?: string; quantity?: number; extractedPrice?: number };
  componentCount: number;
  totalNet: number | null;
  priceDistributed: boolean;
  source?: "ai" | "configurator";
};

/** Stückliste einer Bestellposition in Einzelteile zerlegt (server/commercial/draftBomSplit.ts) */
export function DraftBomSplitNotice({ extractedData }: { extractedData: unknown }) {
  const { t } = useTranslation();
  const fmt = useLocaleFormat();
  const [open, setOpen] = useState<number | null>(null);
  const data = extractedData as
    | { bomSplit?: BomSplitEntry[]; configuratorRows?: Array<{ originalPosition: number; differences: string[] }> }
    | null
    | undefined;
  const entries = data?.bomSplit;
  if (!entries?.length) return null;
  const allConfigurator = entries.every((e) => e.source === "configurator");
  const differencesOf = (position: number) => data?.configuratorRows?.find((r) => r.originalPosition === position)?.differences ?? [];
  return (
    <Alert className="mb-3" data-testid="alert-bom-split">
      <FileText className="h-4 w-4" aria-hidden="true" />
      <AlertTitle>{t(allConfigurator ? "draftReview.bomSplit.titleConfigurator" : "draftReview.bomSplit.title")}</AlertTitle>
      <AlertDescription className="space-y-2 text-sm">
        {entries.map((entry) => (
          <div key={entry.originalPosition}>
            <p>
              {t("draftReview.bomSplit.entry", { position: entry.originalPosition, count: entry.componentCount })}{" "}
              {entry.totalNet != null
                ? entry.priceDistributed
                  ? t("draftReview.bomSplit.priceDistributed", { total: fmt.currency(entry.totalNet) })
                  : t("draftReview.bomSplit.priceOpen", { total: fmt.currency(entry.totalNet) })
                : null}
            </p>
            {differencesOf(entry.originalPosition).length ? (
              <p className="text-xs text-amber-800 dark:text-amber-200" data-testid={`configurator-differences-${entry.originalPosition}`}>
                {t("draftReview.bomSplit.configuratorDifferences", { list: differencesOf(entry.originalPosition).join("; ") })}
              </p>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              aria-expanded={open === entry.originalPosition}
              onClick={() => setOpen((v) => (v === entry.originalPosition ? null : entry.originalPosition))}
              data-testid={`button-bom-original-${entry.originalPosition}`}
            >
              {t("draftReview.bomSplit.showOriginal")}
            </Button>
            {open === entry.originalPosition ? (
              <p className="text-xs text-muted-foreground whitespace-pre-wrap">
                {entry.originalLine.quantity ?? "?"} × {entry.originalLine.extractedProductName}
              </p>
            ) : null}
          </div>
        ))}
      </AlertDescription>
    </Alert>
  );
}
