import { useState, useEffect, useRef, useMemo } from "react";
import { RefreshCw, Search, Download, Sparkles, FileText, Eye, Trash2, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Offer, OfferStatus, OfferDraft, SalesChannel, User, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import {
  IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
  isLowOverallMatchingConfidence,
} from "@/lib/commercialDraftConfidence";
import { pickDocumentExtraction } from "@/components/DocumentExtractionAlerts";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchOfferDraftForReview } from "@/lib/refreshReviewDraft";
import OfferDetailModal from "@/components/OfferDetailModal";
import { OfferDraftUploadDialog } from "@/components/OfferDraftUploadDialog";
import { OfferDraftReviewModal } from "@/components/OfferDraftReviewModal";
import PaginationControls from "@/components/PaginationControls";
import TableSkeleton from "@/components/TableSkeleton";
import "@/styles/metaAdmin.css";

interface OffersPageProps {
  userRole: "employee" | "admin";
  userSalesChannelIds?: string[] | null;
}

type OfferStatusMapping = Partial<Record<OfferStatus, { label: string; id?: string | null }>>;

const STORAGE_KEY = 'metaorder-offers-filters';

export default function OffersPage({ userRole, userSalesChannelIds }: OffersPageProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [location, setLocation] = useLocation();

  // Load saved filters from localStorage
  const loadSavedFilters = () => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (error) {
      console.error('Failed to load saved filters:', error);
    }
    return null;
  };

  const savedFilters = loadSavedFilters();

  const [searchValue, setSearchValue] = useState(savedFilters?.searchValue || "");
  const [statusFilter, setStatusFilter] = useState<OfferStatus | "all">(savedFilters?.statusFilter || "all");
  const [customerFilter, setCustomerFilter] = useState(savedFilters?.customerFilter || "");
  const [dateFrom, setDateFrom] = useState(savedFilters?.dateFrom || "");
  const [dateTo, setDateTo] = useState(savedFilters?.dateTo || "");
  const [itemsPerPage, setItemsPerPage] = useState(savedFilters?.itemsPerPage || "25");
  const [currentPage, setCurrentPage] = useState(savedFilters?.currentPage || 1);
  const [selectedOfferId, setSelectedOfferId] = useState<string | null>(null);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [detailMode, setDetailMode] = useState<"view" | "edit">("view");
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [selectedDraft, setSelectedDraft] = useState<OfferDraft | null>(null);

  // Track if this is the initial mount to prevent pagination reset
  const isInitialMount = useRef(true);

  // Fetch offers from backend (server-side filtering + pagination)
  const { data: offersResponse, isLoading, error, refetch } = useQuery<{ offers: Offer[]; total: number }>({
    queryKey: [
      "/api/offers",
      searchValue,
      statusFilter,
      customerFilter,
      dateFrom,
      dateTo,
      currentPage,
      itemsPerPage,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchValue) params.append("search", searchValue);
      if (statusFilter !== "all") params.append("status", statusFilter);
      if (customerFilter) params.append("customer", customerFilter);
      if (dateFrom) params.append("dateFrom", dateFrom);
      if (dateTo) params.append("dateTo", dateTo);
      params.append("page", String(currentPage));
      params.append("limit", String(itemsPerPage));

      const response = await fetch(`/api/offers?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(text || "Failed to load offers");
      }
      return response.json();
    },
    retry: false,
  });

  const offers = offersResponse?.offers || [];
  const totalItems = offersResponse?.total || 0;

  // Fetch current user to get permissions
  const { data: currentUser } = useQuery<{ user: User & { permissions: Role['permissions'] } }>({
    queryKey: ['/api/auth/me'],
  });

  const { data: statusMapping } = useQuery<OfferStatusMapping>({
    queryKey: ["/api/b2b/offer-status-mapping"],
  });

  const canManageOffers = !!(currentUser?.user?.permissions as any)?.manageOffers;
  const canApproveCPQQuotes = !!(currentUser?.user?.permissions as any)?.approveCPQQuotes;

  // Fetch offer drafts
  const { data: drafts = [], isLoading: draftsLoading, refetch: refetchDrafts } = useQuery<OfferDraft[]>({
    queryKey: ["/api/offer-drafts"],
  });

  // Filter drafts to show only pending and review_required
  const pendingDrafts = drafts.filter(
    (draft) => draft.status === "pending" || draft.status === "review_required"
  );

  const lowConfidencePendingDrafts = useMemo(
    () =>
      drafts.filter(
        (d) =>
          (d.status === "pending" || d.status === "review_required") &&
          isLowOverallMatchingConfidence(d.matchingResults)
      ),
    [drafts]
  );

  const recipientIsMetaPendingDrafts = useMemo(
    () =>
      drafts.filter((d) => {
        if (d.status !== "pending" && d.status !== "review_required") return false;
        const ext = pickDocumentExtraction(d.extractedData as Record<string, unknown> | null);
        return Boolean(ext?.document?.recipient_is_meta);
      }),
    [drafts]
  );

  // Delete draft mutation
  const deleteDraftMutation = useMutation({
    mutationFn: async (draftId: string) => {
      const response = await apiRequest("DELETE", `/api/offer-drafts/${draftId}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("offerDrafts.review.deleted"),
        description: t("offerDrafts.review.deletedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      refetchDrafts();
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDrafts.review.deleteError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const approveOfferMutation = useMutation({
    mutationFn: async (offerId: string) => {
      const response = await apiRequest("POST", `/api/offers/${offerId}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      toast({
        title: t("offers.actions.approved"),
        description: t("offers.actions.approvedDescription"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("offers.actions.approveError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const rejectOfferMutation = useMutation({
    mutationFn: async ({ offerId, reason }: { offerId: string; reason?: string }) => {
      const response = await apiRequest("POST", `/api/offers/${offerId}/reject`, { reason });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      toast({
        title: t("offers.actions.rejected"),
        description: t("offers.actions.rejectedDescription"),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("offers.actions.rejectError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Save filters to localStorage whenever they change
  useEffect(() => {
    try {
      const filtersToSave = {
        searchValue,
        statusFilter,
        customerFilter,
        dateFrom,
        dateTo,
        currentPage,
        itemsPerPage,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtersToSave));
    } catch (error) {
      console.error('Failed to save filters:', error);
    }
  }, [searchValue, statusFilter, customerFilter, dateFrom, dateTo, currentPage, itemsPerPage]);

  useEffect(() => {
    const params = new URLSearchParams(location.split("?")[1] ?? "");
    const searchParam = params.get("search");
    if (searchParam !== null) {
      setSearchValue(searchParam);
      setCurrentPage(1);
    }
  }, [location]);

  // Show error if Shopware is not configured
  if (error) {
    const errorMessage = (error as any)?.message || t('offers.errors.loadFailed');
    if (errorMessage.includes('not configured')) {
      return (
        <div className="madmin w-full">
          <div className="mpage-head">
            <div>
              <span className="eyebrow">Angebote</span>
              <h1 data-testid="heading-offers-page">{t('offers.title')}</h1>
              <p className="desc">
                {t('offers.description')}
              </p>
            </div>
          </div>
          <div className="mcard">
            <div className="mcard-body" style={{ textAlign: "center", padding: "32px 18px" }}>
              <p style={{ color: "var(--fg-3)", marginBottom: 16 }}>
                {t('errors.notConfigured')}
              </p>
              <p style={{ fontSize: 12.5, color: "var(--fg-3)", marginBottom: 16 }}>
                {t('errors.notConfiguredDescription')}
              </p>
              <button
                className="mbtn primary"
                onClick={() => window.location.href = '/settings'}
                data-testid="button-go-to-settings"
              >
                {t('errors.goToSettings')}
              </button>
            </div>
          </div>
        </div>
      );
    }
  }

  // Pagination (server-side)
  const itemsPerPageNum = parseInt(itemsPerPage, 10);
  const totalPages = Math.ceil(totalItems / itemsPerPageNum);
  const paginatedOffers = offers;

  // Reset to page 1 when filters change (but not on initial mount)
  useEffect(() => {
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    setCurrentPage(1);
  }, [searchValue, statusFilter, customerFilter, dateFrom, dateTo, itemsPerPage]);

  const handleDownloadPDF = async (offerId: string, offerNumber: string) => {
    try {
      const response = await fetch(`/api/offers/${offerId}/pdf?download=true`);
      if (!response.ok) {
        // Try to get detailed error message
        const errorData = await response.json().catch(() => null);
        if (errorData?.message) {
          throw new Error(errorData.message);
        }
        throw new Error('Failed to download PDF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Angebot-${offerNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      toast({
        title: t('common.download'),
        description: `${t('offers.downloadPDF')} - ${offerNumber}`,
      });
    } catch (error) {
      console.error('Error downloading PDF:', error);
      const errorMessage = error instanceof Error ? error.message : t('offers.errors.pdfFailed');
      toast({
        title: t('offers.errors.pdfFailed'),
        description: errorMessage,
        variant: 'destructive',
      });
    }
  };

  const getStatusBadge = (status: OfferStatus, statusLabel?: string | null) => {
    const statusConfig = {
      draft: {
        badgeClass: 'b-warning',
        label: t('offers.status.draft')
      },
      submitted: {
        badgeClass: 'b-warning',
        label: t('offers.status.submitted')
      },
      sent: {
        badgeClass: 'b-warning',
        label: t('offers.status.sent')
      },
      approved: {
        badgeClass: 'b-success',
        label: t('offers.status.approved')
      },
      rejected: {
        badgeClass: 'b-destructive',
        label: t('offers.status.rejected')
      },
      expired: {
        badgeClass: 'b-destructive',
        label: t('offers.status.expired')
      },
      offered: {
        badgeClass: 'b-warning',
        label: t('offers.status.sent')
      },
      accepted: {
        badgeClass: 'b-success',
        label: t('offers.status.accepted')
      },
      declined: {
        badgeClass: 'b-destructive',
        label: t('offers.status.rejected')
      },
    };

    const config = statusConfig[status];
    const mappedLabel = statusMapping?.[status as keyof OfferStatusMapping]?.label;
    const label = statusLabel || mappedLabel || config.label;
    return (
      <span className={`mbadge ${config.badgeClass}`}>
        {label}
      </span>
    );
  };

  const getFilterLabel = (status: OfferStatus) => {
    const mappedLabel = statusMapping?.[status]?.label;
    if (!mappedLabel) {
      return t(`offers.status.${status}`);
    }
    return `${t(`offers.status.${status}`)} (${mappedLabel})`;
  };

  const handleRowClick = (offerId: string) => {
    setDetailMode("view");
    setSelectedOfferId(offerId);
    setIsDetailModalOpen(true);
  };

  const handleEditClick = (offerId: string) => {
    setDetailMode("edit");
    setSelectedOfferId(offerId);
    setIsDetailModalOpen(true);
  };

  const handleCloseDetailModal = () => {
    setIsDetailModalOpen(false);
    setSelectedOfferId(null);
  };

  const getDraftStatusBadge = (status: OfferDraft["status"]) => {
    switch (status) {
      case "review_required":
        return (
          <span className="mbadge b-warning" data-testid={`badge-draft-status-${status}`}>
            <AlertCircle className="w-3 h-3" />
            {t("offerDrafts.status.reviewRequired")}
          </span>
        );
      case "pending":
        return (
          <span className="mbadge b-warning" data-testid={`badge-draft-status-${status}`}>
            {t("offerDrafts.status.pending")}
          </span>
        );
      case "approved":
        return (
          <span className="mbadge b-success" data-testid={`badge-draft-status-${status}`}>
            <CheckCircle className="w-3 h-3" />
            {t("offerDrafts.status.approved")}
          </span>
        );
      case "rejected":
        return (
          <span className="mbadge b-destructive" data-testid={`badge-draft-status-${status}`}>
            <XCircle className="w-3 h-3" />
            {t("offerDrafts.status.rejected")}
          </span>
        );
      case "created":
        return (
          <span className="mbadge b-success" data-testid={`badge-draft-status-${status}`}>
            <CheckCircle className="w-3 h-3" />
            {t("offerDrafts.status.created")}
          </span>
        );
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 90) {
      return (
        <span className="mbadge b-success" data-testid="badge-confidence-high">
          {confidence}%
        </span>
      );
    } else if (confidence >= 60) {
      return (
        <span className="mbadge b-warning" data-testid="badge-confidence-medium">
          {confidence}%
        </span>
      );
    } else {
      return (
        <span className="mbadge b-destructive" data-testid="badge-confidence-low">
          {confidence}%
        </span>
      );
    }
  };

  const calculateDraftTotal = (draft: OfferDraft) => {
    if (!draft.matchingResults?.items) return 0;
    return draft.matchingResults.items.reduce((total, item) => {
      const price = item.matchedProduct?.suggestedPrice || item.matchedProduct?.catalogPrice || 0;
      return total + (price * item.quantity);
    }, 0);
  };

  return (
    <div className="madmin w-full h-full p-4 md:p-6 overflow-auto">
      <div className="w-full">
        {/* Header */}
        <div className="mpage-head">
          <div>
            <span className="eyebrow">Angebote</span>
            <h1 data-testid="heading-offers-page">{t('offers.title')}</h1>
            <p className="desc">
              {t('offers.description')}
            </p>
          </div>
          <button
            className="mbtn primary"
            onClick={() => setUploadDialogOpen(true)}
            data-testid="button-create-intelligent-offer"
          >
            <Sparkles className="w-4 h-4" />
            {t("offerDrafts.intelligentOfferCreation")}
          </button>
        </div>

        {/* Offer Drafts Section */}
        {pendingDrafts.length > 0 && (
          <div className="mcard">
            <div className="mcard-head">
              <div className="mcard-head-left">
                <Sparkles className="w-5 h-5" />
                <div>
                  <p className="mcard-title" data-testid="heading-offer-drafts">
                    {t("offerDrafts.pendingDrafts")}
                  </p>
                  <p className="mcard-desc" data-testid="text-drafts-description">
                    {t("offerDrafts.pendingDraftsDescription")}
                  </p>
                </div>
              </div>
            </div>
            <div className="mcard-body">
              {recipientIsMetaPendingDrafts.length > 0 && (
                <div className="malert destructive" data-testid="alert-recipient-is-meta-offer-drafts">
                  <div className="malert-title">Empfänger ist META — vermutlich Lieferanten-AB</div>
                  <p>
                    {recipientIsMetaPendingDrafts.length} Beleg(e) richten sich an einen META-Standort.
                    Bitte prüfen, ob diese überhaupt als Kunden-Anfrage verarbeitet werden sollen.
                  </p>
                  <ul style={{ listStyle: "disc", paddingLeft: 16, marginTop: 6 }}>
                    {recipientIsMetaPendingDrafts.map((d) => (
                      <li key={`meta-${d.id}`}>
                        <span style={{ fontWeight: 700 }}>{d.originalFileName}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {lowConfidencePendingDrafts.length > 0 && (
                <div className="malert destructive" data-testid="alert-low-matching-offer-drafts">
                  <div className="malert-title">
                    {t("drafts.importLowMatching.listTitle", "Import mit niedriger Zuordnungsgenauigkeit")}
                  </div>
                  <p>
                    {t("drafts.importLowMatching.listBody", {
                      defaultValue:
                        "{{count}} Entwurf/Entwürfe unter {{threshold}} % Gesamt-Genauigkeit — bitte im Review prüfen.",
                      count: lowConfidencePendingDrafts.length,
                      threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
                    })}
                  </p>
                  <ul style={{ listStyle: "disc", paddingLeft: 16, marginTop: 6 }}>
                    {lowConfidencePendingDrafts.map((d) => (
                      <li key={d.id}>
                        <span style={{ fontWeight: 700 }}>{d.originalFileName}</span>
                        {d.matchingResults != null && (
                          <span style={{ color: "var(--fg-3)" }}>
                            {" "}
                            ({d.matchingResults.overallConfidence}%)
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {draftsLoading ? (
                <TableSkeleton columns={7} rows={3} />
              ) : (
                <div className="mtable-wrap">
                  <table className="mtable">
                    <thead>
                      <tr>
                        <th data-testid="table-head-draft-document">{t("offerDrafts.table.document")}</th>
                        <th data-testid="table-head-draft-status">{t("offerDrafts.table.status")}</th>
                        <th className="num" data-testid="table-head-draft-products">{t("offerDrafts.table.products")}</th>
                        <th data-testid="table-head-draft-matching-confidence">
                          {t("offerDrafts.table.matchingConfidence", "Genauigkeit")}
                        </th>
                        <th className="num" data-testid="table-head-draft-total">{t("offerDrafts.table.totalValue")}</th>
                        <th data-testid="table-head-draft-created">{t("offerDrafts.table.created")}</th>
                        <th className="num" data-testid="table-head-draft-actions">
                          {t("offerDrafts.table.actions")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingDrafts.map((draft) => (
                        <tr
                          key={draft.id}
                          data-testid={`row-draft-${draft.id}`}
                          className={
                            isLowOverallMatchingConfidence(draft.matchingResults)
                              ? "flagged"
                              : undefined
                          }
                        >
                          <td>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <FileText className="w-4 h-4" style={{ color: "var(--fg-3)" }} />
                              <span style={{ fontWeight: 700 }} data-testid={`text-draft-filename-${draft.id}`}>
                                {draft.originalFileName}
                              </span>
                            </div>
                          </td>
                          <td>{getDraftStatusBadge(draft.status)}</td>
                          <td className="num" data-testid={`text-draft-product-count-${draft.id}`}>
                            {draft.matchingResults?.items.length || 0}
                          </td>
                          <td data-testid={`text-draft-confidence-${draft.id}`}>
                            {draft.matchingResults ? (
                              getConfidenceBadge(draft.matchingResults.overallConfidence)
                            ) : (
                              <span className="mbadge b-default" data-testid={`badge-draft-no-matching-${draft.id}`}>
                                {t("orderDrafts.noMatching", "—")}
                              </span>
                            )}
                          </td>
                          <td className="num" data-testid={`text-draft-total-${draft.id}`}>
                            €{calculateDraftTotal(draft).toFixed(2)}
                          </td>
                          <td data-testid={`text-draft-created-${draft.id}`}>
                            {format(new Date(draft.createdAt), "dd.MM.yyyy HH:mm")}
                          </td>
                          <td className="num">
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 }}>
                              <button
                                className="mbtn sm"
                                onClick={() => setSelectedDraft(draft)}
                                data-testid={`button-review-draft-${draft.id}`}
                              >
                                <Eye className="w-4 h-4" />
                                {t("offerDrafts.table.review")}
                              </button>
                              <button
                                className="mbtn sm destructive"
                                onClick={() => deleteDraftMutation.mutate(draft.id)}
                                disabled={deleteDraftMutation.isPending}
                                data-testid={`button-delete-draft-${draft.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="mfilters">
          <div className="mfield has-icon grow" style={{ maxWidth: 320 }}>
            <Search className="h-4 w-4" />
            <input
              className="minput"
              placeholder={t('offers.filter.searchPlaceholder')}
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              data-testid="input-search-offers"
            />
          </div>

          <input
            className="minput"
            style={{ maxWidth: 240 }}
            placeholder={t('offers.filter.customerPlaceholder')}
            value={customerFilter}
            onChange={(e) => setCustomerFilter(e.target.value)}
            data-testid="input-customer-filter"
          />

          <input
            type="date"
            className="minput"
            style={{ maxWidth: 160 }}
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            data-testid="input-date-from"
          />

          <input
            type="date"
            className="minput"
            style={{ maxWidth: 160 }}
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            data-testid="input-date-to"
          />

          <select
            className="minput"
            style={{ maxWidth: 200 }}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as OfferStatus | "all")}
            data-testid="select-status-filter"
          >
            <option value="all">{t('offers.filter.allStatuses')}</option>
            <option value="draft">{getFilterLabel("draft")}</option>
            <option value="submitted">{getFilterLabel("submitted")}</option>
            <option value="sent">{getFilterLabel("sent")}</option>
            <option value="approved">{getFilterLabel("approved")}</option>
            <option value="rejected">{getFilterLabel("rejected")}</option>
            <option value="expired">{t('offers.status.expired')}</option>
          </select>

          <button
            className="mbtn"
            onClick={() => refetch()}
            disabled={isLoading}
            data-testid="button-refresh-offers"
            style={{ marginLeft: "auto" }}
          >
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh', 'Aktualisieren')}
          </button>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="mtable-wrap">
            <TableSkeleton columns={7} rows={parseInt(itemsPerPage) || 25} />
          </div>
        ) : (
          <div className="mtable-wrap">
            <table className="mtable">
              <thead>
                <tr>
                  <th>{t('offers.table.number')}</th>
                  <th>{t('offers.table.customer')}</th>
                  <th>{t('offers.table.status')}</th>
                  <th className="num">{t('offers.table.amount')}</th>
                  <th>{t('offers.table.createdDate')}</th>
                  <th>{t('offers.table.expirationDate')}</th>
                  <th className="center">{t('offers.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {paginatedOffers.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: "center", padding: "32px 14px", color: "var(--fg-3)", fontSize: 12.5 }}>
                      {t('offers.noOffers')}
                    </td>
                  </tr>
                ) : (
                  paginatedOffers.map((offer) => (
                    <tr
                      key={offer.id}
                      className="clickable"
                      data-testid={`row-offer-${offer.id}`}
                      onClick={() => handleRowClick(offer.id)}
                    >
                      <td data-testid="text-offer-number">
                        {offer.offerNumber}
                      </td>
                      <td style={{ color: "var(--fg-3)" }} data-testid="text-offer-customer">
                        {offer.customerName || offer.customerEmail || '-'}
                      </td>
                      <td>
                        {getStatusBadge(offer.status, offer.statusLabel)}
                      </td>
                      <td className="num" data-testid="text-total-price">
                        €{offer.totalPrice?.toFixed(2) || '0.00'}
                      </td>
                      <td style={{ color: "var(--fg-3)" }}>
                        {offer.createdAt && !isNaN(new Date(offer.createdAt).getTime())
                          ? format(new Date(offer.createdAt), 'dd.MM.yyyy HH:mm')
                          : '-'}
                      </td>
                      <td style={{ color: "var(--fg-3)" }}>
                        {offer.offerExpiration && !isNaN(new Date(offer.offerExpiration).getTime())
                          ? format(new Date(offer.offerExpiration), 'dd.MM.yyyy')
                          : '-'}
                      </td>
                      <td className="center">
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
                          <button
                            className="mbtn icon ghost"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPDF(offer.id, offer.offerNumber);
                            }}
                            data-testid="button-download-pdf"
                            title={t('offers.downloadPDF')}
                          >
                            <Download className="h-4 w-4" />
                          </button>
                          {canManageOffers && (
                            <>
                              <button
                                className="mbtn icon ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  approveOfferMutation.mutate(offer.id);
                                }}
                                disabled={approveOfferMutation.isPending || ["approved", "rejected", "expired"].includes(offer.status)}
                                data-testid="button-approve-offer"
                                title={t('offers.actions.approve')}
                              >
                                <CheckCircle className="h-4 w-4" />
                              </button>
                              <button
                                className="mbtn icon ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rejectOfferMutation.mutate({ offerId: offer.id });
                                }}
                                disabled={rejectOfferMutation.isPending || ["rejected", "expired"].includes(offer.status)}
                                data-testid="button-reject-offer"
                                title={t('offers.actions.reject')}
                              >
                                <XCircle className="h-4 w-4" />
                              </button>
                              <button
                                className="mbtn icon ghost"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditClick(offer.id);
                                }}
                                data-testid="button-edit-offer"
                                title={t('common.edit')}
                              >
                                <FileText className="h-4 w-4" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Offer Detail Modal */}
        <OfferDetailModal
          offerId={selectedOfferId}
          isOpen={isDetailModalOpen}
          onClose={handleCloseDetailModal}
          canManage={canManageOffers}
          canApproveCPQ={canApproveCPQQuotes}
          mode={detailMode}
        />

        {/* Upload Dialog */}
        <OfferDraftUploadDialog
          open={uploadDialogOpen}
          onOpenChange={setUploadDialogOpen}
          onUploadSuccess={(result) => {
            refetchDrafts();
            refetch();
            setUploadDialogOpen(false);
            if (result.draftKind === "offer") {
              const of = result.draft as OfferDraft;
              setSelectedDraft(of);
              if (isLowOverallMatchingConfidence(of.matchingResults)) {
                const score = of.matchingResults?.overallConfidence;
                toast({
                  variant: "destructive",
                  title: t("drafts.importLowMatching.uploadToastTitle", {
                    defaultValue: "Import: Genauigkeit unter {{threshold}} %",
                    threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
                  }),
                  description: t("drafts.importLowMatching.uploadToastBodyOffer", {
                    defaultValue:
                      "Gesamt-Genauigkeit der Produktzuordnung: {{score}} %. Bitte alle Positionen im Review prüfen.",
                    score: typeof score === "number" ? score : "—",
                  }),
                });
              }
            } else {
              void queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
              setLocation("/order-drafts");
            }
          }}
        />

        {/* Review Modal */}
        {selectedDraft && (
          <OfferDraftReviewModal
            draft={selectedDraft}
            open={!!selectedDraft}
            onOpenChange={(open: boolean) => !open && setSelectedDraft(null)}
            onUpdate={() => {
              refetchDrafts();
              refetch();
              void fetchOfferDraftForReview(selectedDraft.id)
                .then(setSelectedDraft)
                .catch(() => setSelectedDraft(null));
            }}
          />
        )}

        {/* Pagination */}
        <PaginationControls
          currentPage={currentPage}
          totalPages={totalPages}
          itemsPerPage={itemsPerPage}
          onPageChange={setCurrentPage}
          onItemsPerPageChange={(value) => {
            setItemsPerPage(value);
            setCurrentPage(1);
          }}
          totalItems={totalItems}
        />
      </div>
    </div>
  );
}
