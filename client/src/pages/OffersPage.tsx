import { useState, useEffect, useRef, useMemo } from "react";
import { RefreshCw, Search, Download, Sparkles, FileText, Eye, Trash2, CheckCircle, AlertCircle, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useMutation } from "@tanstack/react-query";
import type { Offer, OfferStatus, OfferDraft, SalesChannel, User, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
  isLowOverallMatchingConfidence,
} from "@/lib/commercialDraftConfidence";
import { pickDocumentExtraction } from "@/components/DocumentExtractionAlerts";
import { useLocation } from "wouter";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { fetchOfferDraftForReview } from "@/lib/refreshReviewDraft";
import OfferDetailModal from "@/components/OfferDetailModal";
import { OfferDraftUploadDialog } from "@/components/OfferDraftUploadDialog";
import { OfferDraftReviewModal } from "@/components/OfferDraftReviewModal";
import PaginationControls from "@/components/PaginationControls";
import TableSkeleton from "@/components/TableSkeleton";

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
        <div className="w-full">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold mb-1">{t('offers.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('offers.description')}
            </p>
          </div>
          <div className="bg-muted/50 border border-border rounded-lg p-8 text-center">
            <p className="text-muted-foreground mb-4">
              {t('errors.notConfigured')}
            </p>
            <p className="text-sm text-muted-foreground mb-4">
              {t('errors.notConfiguredDescription')}
            </p>
            <Button onClick={() => window.location.href = '/settings'} data-testid="button-go-to-settings">
              {t('errors.goToSettings')}
            </Button>
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
        colorClass: 'bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40',
        label: t('offers.status.draft')
      },
      submitted: {
        colorClass: 'bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40',
        label: t('offers.status.submitted')
      },
      sent: { 
        colorClass: 'bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40',
        label: t('offers.status.sent')
      },
      approved: { 
        colorClass: 'bg-success/20 text-success border-success/40 dark:bg-success/20 dark:text-success-foreground dark:border-success/40',
        label: t('offers.status.approved')
      },
      rejected: { 
        colorClass: 'bg-destructive/20 text-destructive border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground dark:border-destructive/40',
        label: t('offers.status.rejected')
      },
      expired: { 
        colorClass: 'bg-destructive/20 text-destructive border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground dark:border-destructive/40',
        label: t('offers.status.expired')
      },
      offered: {
        colorClass: 'bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40',
        label: t('offers.status.sent')
      },
      accepted: {
        colorClass: 'bg-success/20 text-success border-success/40 dark:bg-success/20 dark:text-success-foreground dark:border-success/40',
        label: t('offers.status.accepted')
      },
      declined: {
        colorClass: 'bg-destructive/20 text-destructive border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground dark:border-destructive/40',
        label: t('offers.status.rejected')
      },
    };

    const config = statusConfig[status];
    const mappedLabel = statusMapping?.[status as keyof OfferStatusMapping]?.label;
    const label = statusLabel || mappedLabel || config.label;
    return (
      <Badge variant="outline" className={config.colorClass}>
        {label}
      </Badge>
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
          <Badge variant="outline" className="bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40" data-testid={`badge-draft-status-${status}`}>
            <AlertCircle className="w-3 h-3 mr-1" />
            {t("offerDrafts.status.reviewRequired")}
          </Badge>
        );
      case "pending":
        return (
          <Badge variant="outline" className="bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40" data-testid={`badge-draft-status-${status}`}>
            {t("offerDrafts.status.pending")}
          </Badge>
        );
      case "approved":
        return (
          <Badge variant="outline" className="bg-success/20 text-success border-success/40 dark:bg-success/20 dark:text-success-foreground dark:border-success/40" data-testid={`badge-draft-status-${status}`}>
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("offerDrafts.status.approved")}
          </Badge>
        );
      case "rejected":
        return (
          <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground dark:border-destructive/40" data-testid={`badge-draft-status-${status}`}>
            <XCircle className="w-3 h-3 mr-1" />
            {t("offerDrafts.status.rejected")}
          </Badge>
        );
      case "created":
        return (
          <Badge variant="outline" className="bg-success/20 text-success border-success/40 dark:bg-success/20 dark:text-success-foreground dark:border-success/40" data-testid={`badge-draft-status-${status}`}>
            <CheckCircle className="w-3 h-3 mr-1" />
            {t("offerDrafts.status.created")}
          </Badge>
        );
    }
  };

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 90) {
      return (
        <Badge variant="outline" className="bg-success/20 text-success border-success/40 dark:bg-success/20 dark:text-success-foreground dark:border-success/40" data-testid="badge-confidence-high">
          {confidence}%
        </Badge>
      );
    } else if (confidence >= 60) {
      return (
        <Badge variant="outline" className="bg-warning/20 text-warning border-warning/40 dark:bg-warning/20 dark:text-warning-foreground dark:border-warning/40" data-testid="badge-confidence-medium">
          {confidence}%
        </Badge>
      );
    } else {
      return (
        <Badge variant="outline" className="bg-destructive/20 text-destructive border-destructive/40 dark:bg-destructive/20 dark:text-destructive-foreground dark:border-destructive/40" data-testid="badge-confidence-low">
          {confidence}%
        </Badge>
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
    <div className="w-full h-full p-4 md:p-6 overflow-auto">
      <div className="w-full">
        {/* Header */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-1" data-testid="heading-offers-page">{t('offers.title')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('offers.description')}
            </p>
          </div>
          <Button onClick={() => setUploadDialogOpen(true)} data-testid="button-create-intelligent-offer">
            <Sparkles className="w-4 h-4 mr-2" />
            {t("offerDrafts.intelligentOfferCreation")}
          </Button>
        </div>

        {/* Offer Drafts Section */}
        {pendingDrafts.length > 0 && (
          <Card className="mb-6">
            <div className="p-4 border-b">
              <h2 className="text-lg font-semibold flex items-center gap-2" data-testid="heading-offer-drafts">
                <Sparkles className="w-5 h-5 text-primary" />
                {t("offerDrafts.pendingDrafts")}
              </h2>
              <p className="text-sm text-muted-foreground mt-1" data-testid="text-drafts-description">
                {t("offerDrafts.pendingDraftsDescription")}
              </p>
            </div>
            {recipientIsMetaPendingDrafts.length > 0 && (
              <div className="px-4 pb-2">
                <Alert
                  variant="destructive"
                  className="border-destructive/60"
                  data-testid="alert-recipient-is-meta-offer-drafts"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Empfänger ist META — vermutlich Lieferanten-AB</AlertTitle>
                  <AlertDescription className="text-sm space-y-2">
                    <p>
                      {recipientIsMetaPendingDrafts.length} Beleg(e) richten sich an einen META-Standort.
                      Bitte prüfen, ob diese überhaupt als Kunden-Anfrage verarbeitet werden sollen.
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {recipientIsMetaPendingDrafts.map((d) => (
                        <li key={`meta-${d.id}`}>
                          <span className="font-medium">{d.originalFileName}</span>
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {lowConfidencePendingDrafts.length > 0 && (
              <div className="px-4 pb-2">
                <Alert
                  variant="destructive"
                  className="border-destructive/60"
                  data-testid="alert-low-matching-offer-drafts"
                >
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>
                    {t("drafts.importLowMatching.listTitle", "Import mit niedriger Zuordnungsgenauigkeit")}
                  </AlertTitle>
                  <AlertDescription className="text-sm space-y-2">
                    <p>
                      {t("drafts.importLowMatching.listBody", {
                        defaultValue:
                          "{{count}} Entwurf/Entwürfe unter {{threshold}} % Gesamt-Genauigkeit — bitte im Review prüfen.",
                        count: lowConfidencePendingDrafts.length,
                        threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
                      })}
                    </p>
                    <ul className="list-disc pl-4 space-y-0.5">
                      {lowConfidencePendingDrafts.map((d) => (
                        <li key={d.id}>
                          <span className="font-medium">{d.originalFileName}</span>
                          {d.matchingResults != null && (
                            <span className="text-muted-foreground">
                              {" "}
                              ({d.matchingResults.overallConfidence}%)
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  </AlertDescription>
                </Alert>
              </div>
            )}
            {draftsLoading ? (
              <TableSkeleton columns={7} rows={3} />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead data-testid="table-head-draft-document">{t("offerDrafts.table.document")}</TableHead>
                    <TableHead data-testid="table-head-draft-status">{t("offerDrafts.table.status")}</TableHead>
                    <TableHead data-testid="table-head-draft-products">{t("offerDrafts.table.products")}</TableHead>
                    <TableHead data-testid="table-head-draft-matching-confidence">
                      {t("offerDrafts.table.matchingConfidence", "Genauigkeit")}
                    </TableHead>
                    <TableHead data-testid="table-head-draft-total">{t("offerDrafts.table.totalValue")}</TableHead>
                    <TableHead data-testid="table-head-draft-created">{t("offerDrafts.table.created")}</TableHead>
                    <TableHead className="text-right" data-testid="table-head-draft-actions">
                      {t("offerDrafts.table.actions")}
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingDrafts.map((draft) => (
                    <TableRow
                      key={draft.id}
                      data-testid={`row-draft-${draft.id}`}
                      className={
                        isLowOverallMatchingConfidence(draft.matchingResults)
                          ? "bg-destructive/5 border-l-4 border-l-destructive/70"
                          : undefined
                      }
                    >
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <FileText className="w-4 h-4 text-muted-foreground" />
                          <span className="font-medium" data-testid={`text-draft-filename-${draft.id}`}>
                            {draft.originalFileName}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{getDraftStatusBadge(draft.status)}</TableCell>
                      <TableCell data-testid={`text-draft-product-count-${draft.id}`}>
                        {draft.matchingResults?.items.length || 0}
                      </TableCell>
                      <TableCell data-testid={`text-draft-confidence-${draft.id}`}>
                        {draft.matchingResults ? (
                          getConfidenceBadge(draft.matchingResults.overallConfidence)
                        ) : (
                          <Badge variant="secondary" data-testid={`badge-draft-no-matching-${draft.id}`}>
                            {t("orderDrafts.noMatching", "—")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell data-testid={`text-draft-total-${draft.id}`}>
                        €{calculateDraftTotal(draft).toFixed(2)}
                      </TableCell>
                      <TableCell data-testid={`text-draft-created-${draft.id}`}>
                        {format(new Date(draft.createdAt), "dd.MM.yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setSelectedDraft(draft)}
                            data-testid={`button-review-draft-${draft.id}`}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            {t("offerDrafts.table.review")}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => deleteDraftMutation.mutate(draft.id)}
                            disabled={deleteDraftMutation.isPending}
                            data-testid={`button-delete-draft-${draft.id}`}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-col gap-4 md:flex-row md:items-center flex-1">
            <div className="relative flex-1 md:max-w-sm">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
              <Input
                placeholder={t('offers.filter.searchPlaceholder')}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="pl-9"
                data-testid="input-search-offers"
              />
            </div>

            <Input
              placeholder={t('offers.filter.customerPlaceholder')}
              value={customerFilter}
              onChange={(e) => setCustomerFilter(e.target.value)}
              className="md:max-w-xs"
              data-testid="input-customer-filter"
            />

            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="md:max-w-[160px]"
              data-testid="input-date-from"
            />

            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="md:max-w-[160px]"
              data-testid="input-date-to"
            />

            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as OfferStatus | "all")}>
              <SelectTrigger className="w-full md:w-48" data-testid="select-status-filter">
                <SelectValue placeholder={t('offers.filter.status')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('offers.filter.allStatuses')}</SelectItem>
                <SelectItem value="draft">{getFilterLabel("draft")}</SelectItem>
                <SelectItem value="submitted">{getFilterLabel("submitted")}</SelectItem>
                <SelectItem value="sent">{getFilterLabel("sent")}</SelectItem>
                <SelectItem value="approved">{getFilterLabel("approved")}</SelectItem>
                <SelectItem value="rejected">{getFilterLabel("rejected")}</SelectItem>
                <SelectItem value="expired">{t('offers.status.expired')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button
            variant="outline"
            size="default"
            onClick={() => refetch()}
            disabled={isLoading}
            data-testid="button-refresh-offers"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
            {t('common.refresh', 'Aktualisieren')}
          </Button>
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-hidden">
          {isLoading ? (
            <TableSkeleton columns={7} rows={parseInt(itemsPerPage) || 25} />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px]">
                <thead className="border-b border-border bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.number')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.customer')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.status')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.amount')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.createdDate')}
                    </th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.expirationDate')}
                    </th>
                    <th className="px-4 py-3 text-center text-sm font-medium text-muted-foreground whitespace-nowrap">
                      {t('offers.table.actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {paginatedOffers.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">
                      {t('offers.noOffers')}
                    </td>
                  </tr>
                ) : (
                  paginatedOffers.map((offer) => (
                    <tr
                      key={offer.id}
                      className="border-b border-border last:border-0 hover-elevate cursor-pointer"
                      data-testid={`row-offer-${offer.id}`}
                      onClick={() => handleRowClick(offer.id)}
                    >
                      <td className="px-4 py-3 text-sm font-medium whitespace-nowrap" data-testid="text-offer-number">
                        {offer.offerNumber}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap" data-testid="text-offer-customer">
                        {offer.customerName || offer.customerEmail || '-'}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {getStatusBadge(offer.status, offer.statusLabel)}
                      </td>
                      <td className="px-4 py-3 text-sm whitespace-nowrap" data-testid="text-total-price">
                        €{offer.totalPrice?.toFixed(2) || '0.00'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {offer.createdAt && !isNaN(new Date(offer.createdAt).getTime())
                          ? format(new Date(offer.createdAt), 'dd.MM.yyyy HH:mm')
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                        {offer.offerExpiration && !isNaN(new Date(offer.offerExpiration).getTime())
                          ? format(new Date(offer.offerExpiration), 'dd.MM.yyyy')
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownloadPDF(offer.id, offer.offerNumber);
                            }}
                            data-testid="button-download-pdf"
                          >
                            <Download className="h-4 w-4 mr-1" />
                            <span className="hidden sm:inline">{t('offers.downloadPDF')}</span>
                            <span className="sm:hidden">PDF</span>
                          </Button>
                          {canManageOffers && (
                            <>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  approveOfferMutation.mutate(offer.id);
                                }}
                                disabled={approveOfferMutation.isPending || ["approved", "rejected", "expired"].includes(offer.status)}
                                data-testid="button-approve-offer"
                              >
                                <CheckCircle className="h-4 w-4 mr-1" />
                                <span className="hidden sm:inline">{t('offers.actions.approve')}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  rejectOfferMutation.mutate({ offerId: offer.id });
                                }}
                                disabled={rejectOfferMutation.isPending || ["rejected", "expired"].includes(offer.status)}
                                data-testid="button-reject-offer"
                              >
                                <XCircle className="h-4 w-4 mr-1" />
                                <span className="hidden sm:inline">{t('offers.actions.reject')}</span>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditClick(offer.id);
                                }}
                                data-testid="button-edit-offer"
                              >
                                <FileText className="h-4 w-4 mr-1" />
                                <span className="hidden sm:inline">{t('common.edit')}</span>
                              </Button>
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
        </div>

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
