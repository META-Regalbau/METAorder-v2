import { useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { Eye, FileText, Inbox, ShoppingCart, Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { Role } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { fetchOfferDraftForReview, fetchOrderDraftForReview } from "@/lib/refreshReviewDraft";
import { OfferDraftReviewModal } from "@/components/OfferDraftReviewModal";
import { OrderDraftReviewModal } from "@/components/OrderDraftReviewModal";
import {
  IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
  isLowOverallMatchingConfidence,
} from "@/lib/commercialDraftConfidence";

type OfferReviewDraft = ComponentProps<typeof OfferDraftReviewModal>["draft"];
type OrderReviewDraft = ComponentProps<typeof OrderDraftReviewModal>["draft"];

export type ImportedInquirySummary = {
  id: string;
  kind: "offer" | "order";
  createdAt: string;
  status: string;
  originalFileName: string;
  company: string | null;
  contactName: string | null;
  email: string | null;
  lineItemCount: number;
  matchedLineItemCount: number;
  overallConfidence: number | null;
  commercialIntent: "quote_request" | "purchase_order" | "unclear" | null;
};

type ImportedInquiriesResponse = {
  items: ImportedInquirySummary[];
  stats: {
    total: number;
    reviewRequired: number;
    pending: number;
    created: number;
  };
};

interface ImportedCommercialInquiriesWidgetProps {
  userPermissions: Role["permissions"];
}

function statusTranslationKey(status: string): string {
  return status === "review_required" ? "reviewRequired" : status;
}

export default function ImportedCommercialInquiriesWidget({
  userPermissions,
}: ImportedCommercialInquiriesWidgetProps) {
  const { t, i18n } = useTranslation();
  const [reviewOffer, setReviewOffer] = useState<OfferReviewDraft | null>(null);
  const [reviewOrder, setReviewOrder] = useState<OrderReviewDraft | null>(null);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const canOrders = Boolean(userPermissions.manageOrderDrafts);
  const canOffers = Boolean(userPermissions.viewOffers || userPermissions.manageOffers);

  const { data, isLoading } = useQuery<ImportedInquiriesResponse>({
    queryKey: ["/api/dashboard/imported-inquiries"],
    retry: false,
  });

  const getDateLocale = () => {
    switch (i18n.language) {
      case "de":
        return de;
      case "es":
        return es;
      default:
        return enUS;
    }
  };

  const getStatusBadge = (item: ImportedInquirySummary) => {
    const ns = item.kind === "order" ? "orderDrafts.status" : "offerDrafts.status";
    const badgeClass =
      item.status === "review_required" || item.status === "pending"
        ? "b-warning"
        : item.status === "created"
          ? "b-success"
          : item.status === "rejected"
            ? "b-destructive"
            : "b-outline";

    return (
      <span className={`mbadge ${badgeClass}`}>
        {t(`${ns}.${statusTranslationKey(item.status)}`)}
      </span>
    );
  };

  const getKindBadge = (kind: ImportedInquirySummary["kind"]) => {
    if (kind === "order") {
      return (
        <span className="mbadge b-outline">
          <ShoppingCart className="h-3 w-3" />
          {t("dashboard.importedInquiries.kindOrder")}
        </span>
      );
    }
    return (
      <span className="mbadge b-outline">
        <Sparkles className="h-3 w-3" />
        {t("dashboard.importedInquiries.kindOffer")}
      </span>
    );
  };

  const openReview = async (item: ImportedInquirySummary) => {
    setOpeningId(item.id);
    try {
      if (item.kind === "order") {
        const res = await apiRequest("GET", `/api/order-drafts/${item.id}`);
        const draft = (await res.json()) as OrderReviewDraft;
        setReviewOrder(draft);
      } else {
        const res = await apiRequest("GET", `/api/offer-drafts/${item.id}`);
        const draft = (await res.json()) as OfferReviewDraft;
        setReviewOffer(draft);
      }
    } finally {
      setOpeningId(null);
    }
  };

  const items = data?.items ?? [];
  const stats = data?.stats;

  return (
    <>
      <div className="mcard" data-testid="widget-imported-inquiries">
        <div className="mcard-head">
          <div className="mcard-head-left">
            <Inbox className="h-5 w-5" />
            <div>
              <h3 className="mcard-title">{t("dashboard.importedInquiries.title")}</h3>
              <p className="mcard-desc">{t("dashboard.importedInquiries.description")}</p>
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {canOffers ? (
              <Link href="/offers" className="mbtn ghost sm" data-testid="button-view-offer-drafts">
                {t("dashboard.importedInquiries.viewOffers")}
              </Link>
            ) : null}
            {canOrders ? (
              <Link href="/order-drafts" className="mbtn ghost sm" data-testid="button-view-order-drafts">
                {t("dashboard.importedInquiries.viewOrders")}
              </Link>
            ) : null}
          </div>
        </div>
        <div className="mcard-body">
          {stats && stats.total > 0 ? (
            <div
              style={{
                marginBottom: 16,
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: 8,
                fontSize: 12,
                color: "var(--fg-3)",
              }}
            >
              <span>{t("dashboard.importedInquiries.statsTotal", { count: stats.total })}</span>
              {stats.reviewRequired > 0 ? (
                <span className="mbadge b-warning">
                  {t("dashboard.importedInquiries.statsReview", { count: stats.reviewRequired })}
                </span>
              ) : null}
              {stats.pending > 0 ? (
                <span className="mbadge b-outline">
                  {t("dashboard.importedInquiries.statsPending", { count: stats.pending })}
                </span>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="mloading">{t("common.loading")}</div>
          ) : items.length === 0 ? (
            <div className="mempty">
              <FileText className="h-4 w-4" />
              <p>{t("dashboard.importedInquiries.empty")}</p>
            </div>
          ) : (
            <div className="mlist">
              {items.map((item) => {
                const lowConfidence = isLowOverallMatchingConfidence({
                  overallConfidence: item.overallConfidence ?? undefined,
                });
                const customerLabel =
                  item.company ||
                  item.contactName ||
                  item.email ||
                  t("dashboard.importedInquiries.unknownCustomer");

                return (
                  <div
                    key={`${item.kind}-${item.id}`}
                    className="mrow"
                    data-testid={`inquiry-item-${item.id}`}
                  >
                    <div className="mrow-main">
                      <div className="mrow-badges">
                        {getKindBadge(item.kind)}
                        {getStatusBadge(item)}
                        {item.commercialIntent ? (
                          <span className="mbadge b-outline">
                            {t(`commercialUpload.intent.${item.commercialIntent}`)}
                          </span>
                        ) : null}
                      </div>
                      <div className="mrow-title truncate">{item.originalFileName}</div>
                      <div className="mrow-meta">
                        <span>{customerLabel}</span>
                        <span>
                          {format(new Date(item.createdAt), "dd.MM.yyyy HH:mm", {
                            locale: getDateLocale(),
                          })}
                        </span>
                        <span>
                          {t("dashboard.importedInquiries.lineItems", {
                            matched: item.matchedLineItemCount,
                            total: item.lineItemCount,
                          })}
                        </span>
                        {item.overallConfidence != null ? (
                          <span style={lowConfidence ? { color: "var(--meta-red)" } : undefined}>
                            {t("dashboard.importedInquiries.confidence", {
                              value: item.overallConfidence,
                            })}
                            {lowConfidence
                              ? ` · ${t("dashboard.importedInquiries.belowThreshold", {
                                  threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
                                })}`
                              : null}
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="mrow-side">
                      <button
                        className="mbtn sm"
                        disabled={openingId === item.id}
                        onClick={() => void openReview(item)}
                        data-testid={`button-review-inquiry-${item.id}`}
                      >
                        <Eye className="h-4 w-4" />
                        {t("dashboard.importedInquiries.review")}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {reviewOffer ? (
        <OfferDraftReviewModal
          draft={reviewOffer}
          open={!!reviewOffer}
          onOpenChange={(open) => !open && setReviewOffer(null)}
          onUpdate={() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/imported-inquiries"] });
            void fetchOfferDraftForReview(reviewOffer.id).then(setReviewOffer).catch(() => {});
          }}
        />
      ) : null}

      {reviewOrder ? (
        <OrderDraftReviewModal
          draft={reviewOrder}
          open={!!reviewOrder}
          onOpenChange={(open) => !open && setReviewOrder(null)}
          onUpdate={() => {
            void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
            void queryClient.invalidateQueries({ queryKey: ["/api/dashboard/imported-inquiries"] });
            void fetchOrderDraftForReview(reviewOrder.id).then(setReviewOrder).catch(() => {});
          }}
        />
      ) : null}
    </>
  );
}
