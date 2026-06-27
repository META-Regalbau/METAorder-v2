import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileUp } from "lucide-react";
import { CommercialUnifiedDraftUploadDialog } from "@/components/CommercialUnifiedDraftUploadDialog";
import { OfferDraftReviewModal } from "@/components/OfferDraftReviewModal";
import { OrderDraftReviewModal } from "@/components/OrderDraftReviewModal";
import { queryClient } from "@/lib/queryClient";
import { fetchOfferDraftForReview, fetchOrderDraftForReview } from "@/lib/refreshReviewDraft";
import type { CommercialUnifiedUploadResult } from "@/lib/commercialUnifiedDraftUpload";

type OfferReviewDraft = ComponentProps<typeof OfferDraftReviewModal>["draft"];
type OrderReviewDraft = ComponentProps<typeof OrderDraftReviewModal>["draft"];

export default function CommercialDraftQuickUploadWidget() {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reviewOffer, setReviewOffer] = useState<OfferReviewDraft | null>(null);
  const [reviewOrder, setReviewOrder] = useState<OrderReviewDraft | null>(null);

  const handleUnifiedSuccess = (r: CommercialUnifiedUploadResult) => {
    void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/imported-inquiries"] });
    setDialogOpen(false);
    if (r.draftKind === "offer") {
      setReviewOffer(r.draft as OfferReviewDraft);
    } else {
      setReviewOrder(r.draft as OrderReviewDraft);
    }
  };

  return (
    <>
      <Card data-testid="card-commercial-quick-upload">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <FileUp className="h-5 w-5 text-muted-foreground" />
            {t("dashboard.commercialUpload.widgetTitle")}
          </CardTitle>
          <CardDescription>{t("dashboard.commercialUpload.widgetDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="secondary" onClick={() => setDialogOpen(true)} data-testid="button-open-commercial-upload">
            {t("dashboard.commercialUpload.openUpload")}
          </Button>
        </CardContent>
      </Card>

      <CommercialUnifiedDraftUploadDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        i18nPrefix="dashboard.commercialUpload"
        showContextFields
        onSuccess={handleUnifiedSuccess}
        dataTestId="dialog-dashboard-commercial-upload"
      />

      {reviewOffer && (
        <OfferDraftReviewModal
          draft={reviewOffer}
          open={!!reviewOffer}
          onOpenChange={(open) => !open && setReviewOffer(null)}
          onUpdate={() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
            void fetchOfferDraftForReview(reviewOffer.id).then(setReviewOffer).catch(() => {});
          }}
        />
      )}

      {reviewOrder && (
        <OrderDraftReviewModal
          draft={reviewOrder}
          open={!!reviewOrder}
          onOpenChange={(open) => !open && setReviewOrder(null)}
          onUpdate={() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
            void fetchOrderDraftForReview(reviewOrder.id).then(setReviewOrder).catch(() => {});
          }}
        />
      )}
    </>
  );
}
