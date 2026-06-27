import { useState, type ComponentProps } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { Eye, FileText, Inbox, ShoppingCart, Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { Role } from "@shared/schema";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    const variant =
      item.status === "review_required" || item.status === "pending"
        ? "secondary"
        : item.status === "created"
          ? "default"
          : item.status === "rejected"
            ? "destructive"
            : "outline";

    return (
      <Badge variant={variant} className="text-xs shrink-0">
        {t(`${ns}.${statusTranslationKey(item.status)}`)}
      </Badge>
    );
  };

  const getKindBadge = (kind: ImportedInquirySummary["kind"]) => {
    if (kind === "order") {
      return (
        <Badge variant="outline" className="text-xs gap-1 shrink-0">
          <ShoppingCart className="h-3 w-3" />
          {t("dashboard.importedInquiries.kindOrder")}
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-xs gap-1 shrink-0">
        <Sparkles className="h-3 w-3" />
        {t("dashboard.importedInquiries.kindOffer")}
      </Badge>
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
      <Card data-testid="widget-imported-inquiries">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-center gap-2">
              <Inbox className="h-5 w-5 text-muted-foreground" />
              <div>
                <CardTitle>{t("dashboard.importedInquiries.title")}</CardTitle>
                <CardDescription>{t("dashboard.importedInquiries.description")}</CardDescription>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {canOffers ? (
                <Link href="/offers">
                  <Button variant="ghost" size="sm" data-testid="button-view-offer-drafts">
                    {t("dashboard.importedInquiries.viewOffers")}
                  </Button>
                </Link>
              ) : null}
              {canOrders ? (
                <Link href="/order-drafts">
                  <Button variant="ghost" size="sm" data-testid="button-view-order-drafts">
                    {t("dashboard.importedInquiries.viewOrders")}
                  </Button>
                </Link>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stats && stats.total > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <span>{t("dashboard.importedInquiries.statsTotal", { count: stats.total })}</span>
              {stats.reviewRequired > 0 ? (
                <Badge variant="secondary" className="text-xs">
                  {t("dashboard.importedInquiries.statsReview", { count: stats.reviewRequired })}
                </Badge>
              ) : null}
              {stats.pending > 0 ? (
                <Badge variant="outline" className="text-xs">
                  {t("dashboard.importedInquiries.statsPending", { count: stats.pending })}
                </Badge>
              ) : null}
            </div>
          ) : null}

          {isLoading ? (
            <div className="text-sm text-muted-foreground">{t("common.loading")}</div>
          ) : items.length === 0 ? (
            <div className="text-sm text-muted-foreground space-y-2">
              <FileText className="h-8 w-8 text-muted-foreground/60" />
              <p>{t("dashboard.importedInquiries.empty")}</p>
            </div>
          ) : (
            <div className="space-y-3">
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
                    className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                    data-testid={`inquiry-item-${item.id}`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {getKindBadge(item.kind)}
                        {getStatusBadge(item)}
                        {item.commercialIntent ? (
                          <Badge variant="outline" className="text-xs font-normal">
                            {t(`commercialUpload.intent.${item.commercialIntent}`)}
                          </Badge>
                        ) : null}
                      </div>
                      <div className="truncate text-sm font-medium">{item.originalFileName}</div>
                      <div className="truncate text-xs text-muted-foreground">{customerLabel}</div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
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
                          <span
                            className={
                              lowConfidence ? "text-destructive font-medium" : undefined
                            }
                          >
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
                    <Button
                      variant="secondary"
                      size="sm"
                      className="shrink-0"
                      disabled={openingId === item.id}
                      onClick={() => void openReview(item)}
                      data-testid={`button-review-inquiry-${item.id}`}
                    >
                      <Eye className="mr-2 h-4 w-4" />
                      {t("dashboard.importedInquiries.review")}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

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
