import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import OfferLandingView, { type OfferLandingData } from "@/components/offers/OfferLandingView";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";

/**
 * Interne Vorschau der Kunden-Landingpage (mit Session, gleiche Darstellung wie /angebot/:token).
 */
export default function OfferPreviewPage() {
  const { t } = useTranslation();
  const [, params] = useRoute("/offers/:offerId/preview");
  const offerId = params?.offerId || "";

  const { data, isLoading, error } = useQuery<OfferLandingData>({
    queryKey: [`/api/offers/${offerId}`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!offerId,
    retry: false,
  });

  if (!offerId) {
    return <p className="p-6 text-muted-foreground">{t("offerPreview.noOfferSelected")}</p>;
  }

  if (isLoading) {
    return <p className="p-6 text-muted-foreground">{t("offerPreview.loading")}</p>;
  }

  if (error || !data) {
    return (
      <div className="p-6 space-y-4">
        <p className="text-destructive">{(error as Error)?.message || t("offerPreview.loadError")}</p>
        <Button variant="outline" asChild>
          <Link href="/offers">{t("offerPreview.backToOffers")}</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-semibold">{t("offerPreview.title")}</h1>
        <Button variant="outline" size="sm" asChild>
          <Link href="/offers">{t("common.back")}</Link>
        </Button>
      </div>
      <div className="rounded-xl border bg-card shadow-sm">
        <OfferLandingView offer={data} internalOfferIdForPdf={offerId} showCustomerActions={false} />
      </div>
    </div>
  );
}
