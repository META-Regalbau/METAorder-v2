import { useTranslation } from "react-i18next";
import { AlertTriangle, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

/**
 * Herkunft eines Positionstreffers im Prüffenster: KI-Vorschlag (mit Begründung) oder für diesen
 * Kunden gelernte Artikelnummer (server/commercial/draftLineAiMatch.ts), oder Warnung, wenn die
 * Artikelnummer nicht zur Bezeichnung passt (server/commercial/draftNumberMatchCheck.ts).
 */
export function DraftLineMatchSource({
  item,
  index,
}: {
  item: { matchStrategy?: string; aiMatch?: { confidence: number; reason: string }; numberCheck?: { kind: "conflict" | "realigned"; note: string } };
  index: number;
}) {
  const { t } = useTranslation();
  if (item.numberCheck) {
    return (
      <div className="mt-1 space-y-0.5" data-testid={`number-check-${index}`}>
        <Badge variant="outline" className="text-xs border-amber-600/60 text-amber-800 dark:text-amber-200">
          <AlertTriangle className="mr-1 h-3 w-3" aria-hidden="true" />
          {t(item.numberCheck.kind === "realigned" ? "draftReview.numberRealigned" : "draftReview.numberConflict")}
        </Badge>
        <p className="text-xs text-muted-foreground">{item.numberCheck.note}</p>
      </div>
    );
  }
  if (item.matchStrategy === "ai" && item.aiMatch) {
    return (
      <div className="mt-1 space-y-0.5" data-testid={`ai-match-${index}`}>
        <Badge variant="outline" className="text-xs border-violet-600/60 text-violet-800 dark:text-violet-200">
          <Sparkles className="mr-1 h-3 w-3" aria-hidden="true" />
          {t("draftReview.aiSuggestion", { confidence: item.aiMatch.confidence })}
        </Badge>
        {item.aiMatch.reason ? (
          <p className="text-xs text-muted-foreground">{t("draftReview.aiReason", { reason: item.aiMatch.reason })}</p>
        ) : null}
      </div>
    );
  }
  if (item.matchStrategy === "learned_customer") {
    return (
      <Badge
        variant="outline"
        className="text-xs mt-1 border-blue-600/60 text-blue-800 dark:text-blue-200"
        data-testid={`badge-learned-customer-${index}`}
      >
        {t("draftReview.learnedCustomer")}
      </Badge>
    );
  }
  return null;
}
