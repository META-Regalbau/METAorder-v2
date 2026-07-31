import { useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";
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
      <div className="mcard" data-testid="card-commercial-quick-upload">
        <div className="mcard-head">
          <div>
            <h3 className="mcard-title flex items-center gap-2">
              <FileUp className="h-5 w-5" />
              {t("dashboard.commercialUpload.widgetTitle")}
            </h3>
            <p className="mcard-desc">{t("dashboard.commercialUpload.widgetDescription")}</p>
          </div>
        </div>
        <div className="mcard-body">
          <button
            type="button"
            className="mbtn primary"
            onClick={() => setDialogOpen(true)}
            data-testid="button-open-commercial-upload"
          >
            {t("dashboard.commercialUpload.openUpload")}
          </button>
        </div>
      </div>

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
