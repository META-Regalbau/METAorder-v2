import { useTranslation } from "react-i18next";
import { Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * Freigabe einer Entwurfsposition von Hand: „Passt so“ übernimmt den angezeigten Artikel als
 * bestätigt (100 %), auch wenn die Zuordnung unklar oder nur ein Vorschlag war.
 */
export function DraftLineConfirm({
  index,
  confirmed,
  canConfirm,
  disabled,
  onConfirm,
}: {
  index: number;
  confirmed: boolean;
  canConfirm: boolean;
  disabled?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  if (confirmed) {
    return (
      <Badge
        variant="outline"
        className="text-xs whitespace-nowrap border-emerald-600/60 text-emerald-800 dark:text-emerald-200"
        data-testid={`badge-line-confirmed-${index}`}
      >
        <Check className="mr-1 h-3 w-3" aria-hidden="true" />
        {t("draftReview.lineConfirmed")}
      </Badge>
    );
  }
  if (!canConfirm) return null;
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="h-7 px-2 text-xs whitespace-nowrap"
      disabled={disabled}
      onClick={onConfirm}
      title={t("draftReview.confirmLineHint")}
      data-testid={`button-confirm-line-${index}`}
    >
      <Check className="mr-1 h-3 w-3" aria-hidden="true" />
      {t("draftReview.confirmLine")}
    </Button>
  );
}
