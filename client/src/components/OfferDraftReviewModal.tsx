import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useCrossSellProductLabels } from "@/hooks/useCrossSellProductLabels";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { DraftWebVerificationPanel } from "@/components/DraftWebVerificationPanel";
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Package,
  User,
  MapPin,
  FileText,
  ShoppingCart,
  FileDown,
  TrendingDown,
  Sparkles,
  Calendar,
  Trash2,
  ChevronDown,
  ChevronUp,
  Plus,
} from "lucide-react";
import type { OfferDraftWithCrossSelling } from "@shared/schema";
import DiscountTrafficLight from "@/components/cpq/DiscountTrafficLight";
import {
  applyAlternativeSelectionsToMatchingResults,
  buildAlternativeSelectionFromDraftItems,
  confirmAlternativeSelection,
  isOfferLineReadyForCreate,
  normalizeProductId,
  recomputeOfferOverallConfidence,
  type AlternativeSelectionInput,
} from "@/lib/offerDraftLineItems";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { CustomerClarificationEmailModal } from "@/components/CustomerClarificationEmailModal";
import { DraftDebugJsonPanel } from "@/components/DraftDebugJsonPanel";
import {
  IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
  isLowOverallMatchingConfidence,
} from "@/lib/commercialDraftConfidence";
import {
  DocumentExtractionRecipientMetaAlert,
  DocumentExtractionWarningsAlert,
  LineItemBuyerSkuLabel,
  LineItemConfidenceWarningBadges,
  pickDocumentExtraction,
} from "@/components/DocumentExtractionAlerts";

interface BundleSummary {
  id: string;
  name: string;
  mockProductNumber: string;
  items: Array<{
    productNumber: string;
    productName?: string | null;
    quantity: number;
  }>;
}

interface OfferDraftReviewModalProps {
  draft: OfferDraftWithCrossSelling;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function OfferDraftReviewModal({
  draft,
  open,
  onOpenChange,
  onUpdate,
}: OfferDraftReviewModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editedData, setEditedData] = useState(draft.extractedData);
  const [selectedProducts, setSelectedProducts] = useState<Record<number, string>>({}); // index -> productId
  const [confirmedLines, setConfirmedLines] = useState<Record<number, boolean>>({});
  const [showAlternatives, setShowAlternatives] = useState<Record<number, boolean>>({});
  const [selectedBundleId, setSelectedBundleId] = useState<string>("");
  const [bundleQuantity, setBundleQuantity] = useState(1);
  const [approvalJustification, setApprovalJustification] = useState("");
  const [customerSearchTerm, setCustomerSearchTerm] = useState("");
  const [debouncedCustomerSearch, setDebouncedCustomerSearch] = useState("");
  /** false: Zeilen mit productScreen „unclear“ erscheinen unter Klärungsbedarf statt in der Haupttabelle */
  const [showUnclearInMainTable, setShowUnclearInMainTable] = useState(false);
  const [clarificationEmailOpen, setClarificationEmailOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedCustomerSearch(customerSearchTerm), 300);
    return () => clearTimeout(t);
  }, [customerSearchTerm]);

  useEffect(() => {
    setEditedData(draft.extractedData);
    const initial = buildAlternativeSelectionFromDraftItems(
      draft.matchingResults?.items as import("@/lib/offerDraftLineItems").OfferDraftMatchItem[] | undefined
    );
    setSelectedProducts(initial.selectedProducts);
    setConfirmedLines(initial.confirmedLines ?? {});
    setShowAlternatives({});
    setApprovalJustification("");
  }, [draft.id, draft.extractedData, draft.matchingResults]);

  const alternativeSelectionInput = useMemo<AlternativeSelectionInput>(
    () => ({ selectedProducts, confirmedLines }),
    [selectedProducts, confirmedLines]
  );

  const mergedMatchingResults = useMemo(
    () => applyAlternativeSelectionsToMatchingResults(draft.matchingResults, alternativeSelectionInput),
    [draft.matchingResults, alternativeSelectionInput]
  );

  const itemsForPartition = mergedMatchingResults?.items ?? [];
  const { mainIndices, clarificationIndices } = useMemo(() => {
    const main: number[] = [];
    const clar: number[] = [];
    itemsForPartition.forEach((item, index) => {
      const lik = item.productScreen?.likelihood;
      const skip = Boolean((item as { catalogMatchSkipped?: boolean }).catalogMatchSkipped);
      if (skip || lik === "unlikely_product") {
        clar.push(index);
        return;
      }
      if (!showUnclearInMainTable && lik === "unclear") {
        clar.push(index);
        return;
      }
      main.push(index);
    });
    return { mainIndices: main, clarificationIndices: clar };
  }, [itemsForPartition, showUnclearInMainTable]);

  const persistAlternativeSelectionMutation = useMutation({
    mutationFn: async (input: AlternativeSelectionInput) => {
      const matchingResults = applyAlternativeSelectionsToMatchingResults(draft.matchingResults, input);
      if (!matchingResults) return;
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, {
        extractedData: editedData,
        matchingResults,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
    },
    onError: (e: Error) => {
      toast({
        title: t("common.error", "Fehler"),
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const applyAlternativeSelection = (lineIndex: number, productId: string) => {
    if (draft.status === "created") return;
    const next = confirmAlternativeSelection(lineIndex, productId, alternativeSelectionInput);
    setSelectedProducts(next.selectedProducts);
    setConfirmedLines(next.confirmedLines ?? {});
    persistAlternativeSelectionMutation.mutate(next);
  };

  const createOfferMutation = useMutation({
    mutationFn: async () => {
      if (!mergedMatchingResults) {
        throw new Error(t("offerDrafts.review.createOfferError"));
      }
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, {
        extractedData: editedData,
        matchingResults: mergedMatchingResults,
      });
      // Angebot erstellen
      const response = await apiRequest("POST", `/api/offer-drafts/${draft.id}/create-offer`);
      const offer = await response.json();
      const offerId = offer?.id;
      if (!offerId) return offer;

      // Bei Rabatt mit Freigabepflicht: request-approval aufrufen
      const needsApproval = discountLevel &&
        (discountLevel.approvalType === "department_lead" || discountLevel.approvalType === "management");
      if (needsApproval && discountLevel && pricingRecs) {
        const listPrice = pricingRecs.totalCatalogValue;
        const discountedPrice = pricingRecs.totalSuggestedValue;
        const discPct = listPrice > 0 ? ((listPrice - discountedPrice) / listPrice) * 100 : 0;
        await apiRequest("POST", `/api/cpq/offers/${offerId}/request-approval`, {
          justification: approvalJustification.trim() || null,
          listPrice,
          discountedPrice,
          discountPercent: discPct,
          discountLevelId: discountLevel.levelId,
        });
      }
      return offer;
    },
    onSuccess: () => {
      const needsApproval = discountLevel &&
        (discountLevel.approvalType === "department_lead" || discountLevel.approvalType === "management");
      toast({
        title: t("offerDrafts.review.offerCreated"),
        description: needsApproval
          ? "Angebot erstellt. Freigabe wurde angefordert – warten Sie auf die Genehmigung."
          : t("offerDrafts.review.offerCreatedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      onUpdate();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDrafts.review.createOfferError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/offer-drafts/${draft.id}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("offerDrafts.review.deleted"),
        description: t("offerDrafts.review.deletedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDrafts.review.deleteError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addProductMutation = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const response = await apiRequest("POST", `/api/offer-drafts/${draft.id}/add-product`, {
        productId,
        quantity,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("offerDrafts.crossSelling.productAdded"),
        description: t("offerDrafts.crossSelling.productAddedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDrafts.crossSelling.addProductError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: bundlesData } = useQuery<{ bundles: BundleSummary[] }>({
    queryKey: ["/api/bundles", "offer-drafts"],
    queryFn: async () => {
      const response = await fetch("/api/bundles");
      if (!response.ok) {
        throw new Error("Failed to fetch bundles");
      }
      return response.json();
    },
  });

  const bundles = bundlesData?.bundles ?? [];

  const cartItemsForCpq = (mergedMatchingResults?.items ?? [])
    .map((item) => {
      if (item.productScreen?.likelihood === "unlikely_product") return null;
      const productId = item.matchedProduct?.id;
      if (!productId) return null;
      if (item.bundle) return null;
      return {
        product_id: productId,
        product_number: item.matchedProduct?.productNumber ?? undefined,
        quantity: item.quantity ?? 1,
      };
    })
    .filter((x): x is { product_id: string; product_number: string | undefined; quantity: number } => !!x);

  const cpqCrossSellQueryKey = useMemo(
    () =>
      cartItemsForCpq
        .map((c) => `${c.product_id}:${c.quantity}`)
        .sort()
        .join("|"),
    [cartItemsForCpq]
  );

  const { data: cpqCrossSelling } = useQuery<{
    required: Array<{ product_id: string; reason: string }>;
    recommended: Array<{ product_id: string; reason: string }>;
    optional: Array<{ product_id: string; category?: string }>;
  }>({
    queryKey: ["/api/cpq/cross-selling", cpqCrossSellQueryKey],
    queryFn: async () => {
      const res = await fetch("/api/cpq/cross-selling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cart_items: cartItemsForCpq }),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to fetch CPQ cross-selling");
      return res.json();
    },
    enabled: open && cartItemsForCpq.length > 0,
  });

  const cpqSuggestedProductIds = useMemo(() => {
    if (!cpqCrossSelling) return new Set<string>();
    return new Set([
      ...cpqCrossSelling.required.map((r) => r.product_id),
      ...cpqCrossSelling.recommended.map((r) => r.product_id),
      ...cpqCrossSelling.optional.map((r) => r.product_id),
    ]);
  }, [cpqCrossSelling]);

  const shopwareCrossSellingSuggestions = useMemo(() => {
    const raw = draft.crossSellingSuggestions;
    if (!raw?.length) return [];
    return raw
      .map((group) => ({
        ...group,
        suggestions: group.suggestions.filter((s) => !cpqSuggestedProductIds.has(s.id)),
      }))
      .filter((g) => g.suggestions.length > 0);
  }, [draft.crossSellingSuggestions, cpqSuggestedProductIds]);

  const draftCrossSellProductNumbers = useMemo(() => {
    const s = new Set<string>();
    for (const g of draft.crossSellingSuggestions ?? []) {
      if (g.forProduct?.productNumber) s.add(g.forProduct.productNumber);
      for (const p of g.suggestions ?? []) {
        if (p.productNumber) s.add(p.productNumber);
      }
    }
    return Array.from(s).slice(0, 400);
  }, [draft.crossSellingSuggestions]);

  const { productName: crossSellLabelName } = useCrossSellProductLabels(
    draftCrossSellProductNumbers,
    open && draftCrossSellProductNumbers.length > 0,
  );

  const addBundleMutation = useMutation({
    mutationFn: async ({ bundleId, quantity }: { bundleId: string; quantity: number }) => {
      const response = await apiRequest("POST", `/api/offer-drafts/${draft.id}/add-bundle`, {
        bundleId,
        quantity,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("offerDrafts.crossSelling.productAdded"),
        description: t("offerDrafts.crossSelling.productAddedDescription"),
      });
      setSelectedBundleId("");
      setBundleQuantity(1);
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDrafts.crossSelling.addProductError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  type ShopwareCustomer = { id: string; email?: string; firstName?: string; lastName?: string; company?: string };
  const { data: customerSearchData } = useQuery<{ customers: ShopwareCustomer[] }>({
    queryKey: ["/api/offer-drafts/customer-search", debouncedCustomerSearch],
    queryFn: async () => {
      const res = await fetch(
        `/api/offer-drafts/customer-search?q=${encodeURIComponent(debouncedCustomerSearch)}&limit=20`,
        { credentials: "include" }
      );
      if (!res.ok) throw new Error("Kundensuche fehlgeschlagen");
      return res.json();
    },
    enabled: open && debouncedCustomerSearch.length >= 2,
  });
  const customerSearchResults = customerSearchData?.customers ?? [];

  const assignCustomerMutation = useMutation({
    mutationFn: async (customer: ShopwareCustomer) => {
      const payload: { shopwareCustomerId: string; extractedData?: any } = { shopwareCustomerId: customer.id };
      const nextData = {
        ...(draft.extractedData || {}),
        customer: {
          firstName: customer.firstName,
          lastName: customer.lastName,
          email: customer.email,
          company: customer.company,
        },
      };
      payload.extractedData = nextData;
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      setCustomerSearchTerm("");
      setDebouncedCustomerSearch("");
      toast({ title: t("offerDrafts.review.customerAssigned", "Kunde zugeordnet") });
    },
    onError: (e: Error) => toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const removeLineItemMutation = useMutation({
    mutationFn: async (index: number) => {
      const items = [...(draft.matchingResults?.items ?? [])];
      const lineItems = [...((editedData || draft.extractedData)?.lineItems ?? [])];
      if (index < 0 || index >= items.length) return;
      items.splice(index, 1);
      if (lineItems.length > index) lineItems.splice(index, 1);
      const overallConfidence = recomputeOfferOverallConfidence(items);
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, {
        extractedData: { ...(editedData || draft.extractedData || {}), lineItems },
        matchingResults: {
          ...draft.matchingResults,
          items,
          overallConfidence,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      toast({ title: t("offerDrafts.review.lineRemoved", "Position entfernt") });
    },
    onError: (e: Error) =>
      toast({
        title: t("common.error", "Fehler"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const saveExtractedDataMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, { extractedData: editedData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      toast({ title: "Gespeichert", description: "Adress- und Kundendaten wurden übernommen." });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const markLineAsLikelyProductMutation = useMutation({
    mutationFn: async (index: number) => {
      const applied = applyAlternativeSelectionsToMatchingResults(draft.matchingResults, alternativeSelectionInput);
      const items = [...(applied?.items ?? [])];
      if (index < 0 || index >= items.length) return;
      (items as any[])[index] = {
        ...items[index],
        productScreen: {
          likelihood: "likely_product",
          reasons: ["Manuell: als Produktposition eingestuft"],
        },
      };
      const overallConfidence = recomputeOfferOverallConfidence(
        items as Array<{ confidence: number; productScreen?: { likelihood: string } }>
      );
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, {
        extractedData: editedData,
        matchingResults: {
          ...(applied as Record<string, unknown>),
          items,
          overallConfidence,
        },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      toast({ title: "Position aktualisiert", description: "Als Produkt eingestuft." });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const clearCustomerMutation = useMutation({
    mutationFn: async () => {
      const nextData = { ...(draft.extractedData || {}) };
      if (nextData.customer) delete nextData.customer;
      await apiRequest("PATCH", `/api/offer-drafts/${draft.id}`, { shopwareCustomerId: null, extractedData: nextData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      toast({ title: t("offerDrafts.review.customerCleared", "Kunde entfernt") });
    },
    onError: (e: Error) => toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const createShopwareCustomerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/offer-drafts/${draft.id}/create-shopware-customer`, {
        extractedData: editedData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText);
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offer-drafts"] });
      onUpdate();
      toast({ title: t("offerDrafts.review.createShopwareCustomerSuccess") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const emailForShopwareCustomer =
    editedData?.customer?.email?.trim() ||
    (editedData?.billingAddress as { email?: string } | undefined)?.email?.trim() ||
    "";
  const canCreateShopwareCustomerFromDraft =
    !draft.shopwareCustomerId &&
    !!editedData?.billingAddress &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailForShopwareCustomer) &&
    !!editedData.billingAddress.street?.trim() &&
    !!editedData.billingAddress.zipCode?.trim() &&
    !!editedData.billingAddress.city?.trim() &&
    !!editedData.billingAddress.country?.trim();

  const getConfidenceBadge = (confidence: number) => {
    if (confidence >= 90) {
      return (
        <Badge variant="default" className="bg-green-600" data-testid={`badge-confidence-${confidence}`}>
          <CheckCircle className="w-3 h-3 mr-1" />
          {confidence}%
        </Badge>
      );
    } else if (confidence >= 60) {
      return (
        <Badge variant="default" className="bg-yellow-600" data-testid={`badge-confidence-${confidence}`}>
          <AlertCircle className="w-3 h-3 mr-1" />
          {confidence}%
        </Badge>
      );
    } else {
      return (
        <Badge variant="destructive" data-testid={`badge-confidence-${confidence}`}>
          <XCircle className="w-3 h-3 mr-1" />
          {confidence}%
        </Badge>
      );
    }
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("de-DE", {
      style: "currency",
      currency: "EUR",
    }).format(value);
  };

  const pricingRecs = draft.matchingResults?.pricingRecommendations;

  const discountPercent = pricingRecs && pricingRecs.totalCatalogValue > 0
    ? ((pricingRecs.totalCatalogValue - pricingRecs.totalSuggestedValue) / pricingRecs.totalCatalogValue) * 100
    : 0;

  const { data: discountLevel } = useQuery<{
    levelId: string;
    approvalType: string;
    justificationRequired?: boolean;
  } | null>({
    queryKey: ["/api/cpq/discount-levels/evaluate", discountPercent],
    queryFn: async () => {
      const params = new URLSearchParams({
        discount: discountPercent.toFixed(2),
        list_price: String(pricingRecs?.totalCatalogValue ?? 0),
        discounted_price: String(pricingRecs?.totalSuggestedValue ?? 0),
      });
      const res = await fetch(`/api/cpq/discount-levels/evaluate?${params}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data;
    },
    enabled: open && !!pricingRecs && pricingRecs.totalCatalogValue > 0,
  });

  const requiresApproval =
    discountLevel &&
    (discountLevel.approvalType === "department_lead" || discountLevel.approvalType === "management");
  const isBlocked = discountLevel?.approvalType === "blocked";
  const needsJustification = requiresApproval && (discountLevel?.justificationRequired ?? true);

  const canCreateOffer =
    draft.status !== "created" &&
    !isBlocked &&
    !!draft.shopwareCustomerId &&
    !!mergedMatchingResults?.items?.length &&
    mergedMatchingResults.items.every((item, index) =>
      isOfferLineReadyForCreate(item, index, alternativeSelectionInput)
    ) &&
    (!needsJustification || !!approvalJustification.trim());

  const ext = draft.extractedData;
  const intentConfOffer = ext?.commercialIntentConfidence;
  const showCommercialHintOffer =
    typeof intentConfOffer === "number" &&
    (intentConfOffer < 0.6 ||
      ext?.commercialIntent === "unclear" ||
      Boolean(ext?.commercialIntentVsUploadMismatch));
  const showRerouteHintOffer = Boolean(ext?.commercialIntentRoutedAsOfferDueToPermission);
  const custMatchOffer = ext?.customer?.customerMatchConfidence;
  const showCustomerMatchHintOffer = typeof custMatchOffer === "number" && custMatchOffer < 72;
  const effectiveOfferMatching =
    mergedMatchingResults ?? (draft.matchingResults ? { ...draft.matchingResults } : null);
  const showLowMatchingHintOffer = isLowOverallMatchingConfidence(effectiveOfferMatching);
  const lowOfferMatchingScore = effectiveOfferMatching?.overallConfidence;
  const documentExtractionOffer = pickDocumentExtraction(
    (editedData ?? draft.extractedData) as Record<string, unknown> | null
  );
  const docExtractionItemsOffer = documentExtractionOffer?.line_items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-review-offer">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle data-testid="text-review-title">{t("offerDrafts.review.title")}</DialogTitle>
              <DialogDescription data-testid="text-review-filename">
                {draft.originalFileName}
              </DialogDescription>
            </div>
            {draft.matchingResults && (
              <div data-testid="badge-overall-confidence">
                {getConfidenceBadge(
                  mergedMatchingResults?.overallConfidence ?? draft.matchingResults.overallConfidence
                )}
              </div>
            )}
          </div>
        </DialogHeader>

        <DocumentExtractionRecipientMetaAlert extraction={documentExtractionOffer} />
        <DocumentExtractionWarningsAlert extraction={documentExtractionOffer} />

        {showLowMatchingHintOffer && (
          <Alert
            variant="destructive"
            className="border-destructive/60"
            data-testid="alert-low-overall-matching-offer"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-sm">
              {t("drafts.importLowMatching.modalTitle", {
                defaultValue: "Produktzuordnung unter {{threshold}} %",
                threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
              })}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {t("drafts.importLowMatching.modalBodyOffer", {
                defaultValue:
                  "Gesamt-Genauigkeit: {{score}} %. Bitte Positionen, Alternativen und Preise prüfen, bevor du das Angebot erstellst.",
                score: typeof lowOfferMatchingScore === "number" ? lowOfferMatchingScore : "—",
              })}
            </AlertDescription>
          </Alert>
        )}

        {(showCommercialHintOffer || showRerouteHintOffer || showCustomerMatchHintOffer) && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-sm">
              {t("drafts.commercialReview.title", "Hinweis zur KI-Einordnung")}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2 text-muted-foreground">
              {showCustomerMatchHintOffer && (
                <p>
                  {t("drafts.commercialReview.customerMatch", {
                    defaultValue: "Kundenzuordnung mit nur {{score}} % geschätzter Sicherheit — bitte prüfen.",
                    score: custMatchOffer,
                  })}
                </p>
              )}
              {(showCommercialHintOffer || showRerouteHintOffer) && (
                <p>
                  {showRerouteHintOffer
                    ? t(
                        "drafts.commercialReview.intentReroutedOffer",
                        "Die KI sah eher eine Bestellung; aus Berechtigungsgründen wurde der Angebots-Entwurf genutzt — bitte prüfen."
                      )
                    : t(
                        "drafts.commercialReview.intentUncertain",
                        "Dokumenten-Intent unsicher — Inhalt bitte gegenprüfen."
                      )}
                  {typeof intentConfOffer === "number" && (
                    <span className="block mt-1">
                      {t("drafts.commercialReview.intentScore", {
                        defaultValue: "Intent-Konfidenz: {{p}} %",
                        p: Math.round(intentConfOffer * 100),
                      })}
                    </span>
                  )}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          <Card data-testid="card-assign-customer">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="w-4 h-4" />
                {t("offerDrafts.review.assignCustomer", "Kunde zuordnen")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {draft.shopwareCustomerId ? (
                <div className="flex items-center justify-between gap-4">
                  <div className="text-sm text-muted-foreground">
                    {editedData?.customer ? (
                      <span>
                        {[editedData.customer.firstName, editedData.customer.lastName].filter(Boolean).join(" ") || editedData.customer.email || "—"}
                        {editedData.customer.email && (
                          <span className="ml-1 text-muted-foreground">({editedData.customer.email})</span>
                        )}
                      </span>
                    ) : (
                      t("offerDrafts.review.customerExists")
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={clearCustomerMutation.isPending}
                    onClick={() => clearCustomerMutation.mutate()}
                    data-testid="button-clear-customer"
                  >
                    {t("offerDrafts.review.changeCustomer", "Kunde ändern")}
                  </Button>
                </div>
              ) : (
                <div className="space-y-2">
                  <Input
                    placeholder={t("offerDrafts.review.searchCustomerPlaceholder", "Kunde suchen (E-Mail, Name, min. 2 Zeichen)…")}
                    value={customerSearchTerm}
                    onChange={(e) => setCustomerSearchTerm(e.target.value)}
                    className="max-w-md"
                    data-testid="input-customer-search"
                  />
                  {customerSearchResults.length > 0 && (
                    <ul className="border rounded-md divide-y max-h-48 overflow-y-auto max-w-md">
                      {customerSearchResults.map((c) => (
                        <li key={c.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                            onClick={() => assignCustomerMutation.mutate(c)}
                            disabled={assignCustomerMutation.isPending}
                            data-testid={`customer-option-${c.id}`}
                          >
                            {[c.firstName, c.lastName].filter(Boolean).join(" ") || "—"}
                            {c.email && <span className="text-muted-foreground ml-1">({c.email})</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {debouncedCustomerSearch.length >= 2 && customerSearchResults.length === 0 && !assignCustomerMutation.isPending && (
                    <p className="text-sm text-muted-foreground">{t("offerDrafts.review.noCustomersFound", "Keine Kunden gefunden.")}</p>
                  )}
                  {!draft.shopwareCustomerId && editedData?.billingAddress && !!emailForShopwareCustomer && (
                    <div className="pt-3 mt-3 border-t space-y-2 max-w-md">
                      <p className="text-xs text-muted-foreground">{t("offerDrafts.review.createShopwareCustomerHint")}</p>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={createShopwareCustomerMutation.isPending || !canCreateShopwareCustomerFromDraft}
                        onClick={() => {
                          if (!canCreateShopwareCustomerFromDraft) {
                            toast({
                              title: t("common.error", "Fehler"),
                              description: t("offerDrafts.review.createShopwareCustomerMissingData"),
                              variant: "destructive",
                            });
                            return;
                          }
                          createShopwareCustomerMutation.mutate();
                        }}
                        data-testid="button-create-shopware-customer-offer"
                      >
                        {createShopwareCustomerMutation.isPending
                          ? t("offerDrafts.review.creating")
                          : t("offerDrafts.review.createShopwareCustomer")}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {editedData?.customer && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {t("offerDrafts.review.customerInfo")}
                  </div>
                  {draft.shopwareCustomerId && (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-customer-exists">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {t("offerDrafts.review.customerExists")}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.firstName")}</Label>
                  <Input
                    value={editedData.customer.firstName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, firstName: e.target.value },
                      })
                    }
                    placeholder={t("offerDrafts.review.firstName")}
                    data-testid="input-customer-firstname"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.lastName")}</Label>
                  <Input
                    value={editedData.customer.lastName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, lastName: e.target.value },
                      })
                    }
                    placeholder={t("offerDrafts.review.lastName")}
                    data-testid="input-customer-lastname"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.email")}</Label>
                  <Input
                    type="email"
                    value={editedData.customer.email || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, email: e.target.value },
                      })
                    }
                    placeholder="kunde@beispiel.de"
                    data-testid="input-customer-email"
                    className={
                      editedData.customer.email && 
                      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editedData.customer.email)
                        ? "border-destructive"
                        : ""
                    }
                  />
                  {editedData.customer.email && 
                   !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editedData.customer.email) && (
                    <p className="text-xs text-destructive mt-1">
                      {t("offerDrafts.review.invalidEmail")}
                    </p>
                  )}
                  {(editedData.customer.emailResolution?.candidatesTried?.length ?? 0) > 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("offerDrafts.review.emailResolutionHint")}
                    </p>
                  )}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.phone")}</Label>
                  <Input
                    type="tel"
                    value={editedData.customer.phone || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, phone: e.target.value },
                      })
                    }
                    placeholder="+49 123 456789"
                    data-testid="input-customer-phone"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.company")}</Label>
                  <Input
                    value={editedData.customer.company || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, company: e.target.value },
                      })
                    }
                    placeholder={t("offerDrafts.review.company")}
                    data-testid="input-customer-company"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {editedData?.billingAddress && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="w-4 h-4" />
                  {t("offerDrafts.review.billingAddress")}
                </CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saveExtractedDataMutation.isPending}
                  onClick={() => saveExtractedDataMutation.mutate()}
                  data-testid="button-save-billing-offer"
                >
                  {saveExtractedDataMutation.isPending ? t("offerDrafts.review.creating") : "Adresse speichern"}
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.company")}</Label>
                  <Input
                    value={(editedData.billingAddress as { company?: string }).company || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, company: e.target.value },
                      })
                    }
                    data-testid="input-billing-company"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.street")}</Label>
                  <Input
                    value={editedData.billingAddress.street || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, street: e.target.value },
                      })
                    }
                    data-testid="text-billing-street"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.zipCode")}</Label>
                  <Input
                    value={editedData.billingAddress.zipCode || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, zipCode: e.target.value },
                      })
                    }
                    data-testid="text-billing-zipcode"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.city")}</Label>
                  <Input
                    value={editedData.billingAddress.city || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, city: e.target.value },
                      })
                    }
                    data-testid="text-billing-city"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.country")}</Label>
                  <Input
                    value={editedData.billingAddress.country || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, country: e.target.value },
                      })
                    }
                    data-testid="text-billing-country"
                  />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.phone")}</Label>
                  <Input
                    type="tel"
                    value={(editedData.billingAddress as { phone?: string }).phone || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress, phone: e.target.value },
                      })
                    }
                    placeholder="+49 …"
                    data-testid="input-billing-phone"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {(editedData?.webDomainVerification ?? draft.extractedData?.webDomainVerification) && (
            <DraftWebVerificationPanel
              data={
                (editedData?.webDomainVerification ??
                  draft.extractedData?.webDomainVerification)!}
              i18nPrefix="offerDrafts.review"
            />
          )}

          {editedData?.validUntil && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Calendar className="w-4 h-4" />
                  {t("offerDrafts.review.validUntil")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="font-medium" data-testid="text-valid-until">
                  {editedData.validUntil}
                </p>
              </CardContent>
            </Card>
          )}

          {pricingRecs && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {t("offerDrafts.review.smartPricing")}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.catalogValue")}</Label>
                    <p className="text-lg font-semibold" data-testid="text-catalog-value">
                      {formatCurrency(pricingRecs.totalCatalogValue)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.suggestedValue")}</Label>
                    <p className="text-lg font-semibold text-primary" data-testid="text-suggested-value">
                      {formatCurrency(pricingRecs.totalSuggestedValue)}
                    </p>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">{t("offerDrafts.review.totalDiscount")}</Label>
                    <p className="text-lg font-semibold flex items-center gap-1" data-testid="text-total-discount">
                      <TrendingDown className="w-4 h-4 text-green-600" />
                      {pricingRecs.totalDiscountPercentage.toFixed(1)}%
                    </p>
                  </div>
                </div>
                {pricingRecs.reasoning && (
                  <div className="pt-3 border-t">
                    <Label className="text-xs text-muted-foreground mb-2 block">
                      {t("offerDrafts.review.aiReasoning")}
                    </Label>
                    <p className="text-sm" data-testid="text-ai-reasoning">
                      {pricingRecs.reasoning}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {pricingRecs && pricingRecs.totalCatalogValue > 0 && (
            <DiscountTrafficLight
              listPrice={pricingRecs.totalCatalogValue}
              discountedPrice={pricingRecs.totalSuggestedValue}
            />
          )}

          {requiresApproval && (
            <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600" />
                  Freigabe erforderlich
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Dieser Rabatt erfordert eine Freigabe. Bitte geben Sie eine Begründung ein.
                </p>
              </CardHeader>
              <CardContent>
                <Label htmlFor="approval-justification">Begründung (Pflichtfeld)</Label>
                <Textarea
                  id="approval-justification"
                  value={approvalJustification}
                  onChange={(e) => setApprovalJustification(e.target.value)}
                  placeholder="z.B. Strategischer Kunde, Sonderkonditionen vereinbart..."
                  rows={3}
                  className="mt-2"
                />
              </CardContent>
            </Card>
          )}

          {isBlocked && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-destructive">
                  <XCircle className="w-4 h-4" />
                  Rabatt nicht zulässig
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Dieser Rabatt überschreitet die maximal zulässige Grenze. Bitte reduzieren Sie den Rabatt.
                </p>
              </CardHeader>
            </Card>
          )}

          {cpqCrossSelling && (cpqCrossSelling.required.length > 0 || cpqCrossSelling.recommended.length > 0 || cpqCrossSelling.optional.length > 0) && (
            <Card className="border-primary/20 bg-primary/5">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="w-4 h-4 text-primary" />
                  {t("offerDrafts.cpqCrossSelling.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  {t("offerDrafts.cpqCrossSelling.subtitle")}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {cpqCrossSelling.required.length > 0 && (
                  <div>
                    <Label className="text-xs font-semibold text-amber-600">
                      {t("offerDrafts.cpqCrossSelling.requiredLabel")}
                    </Label>
                    <ul className="mt-2 space-y-2">
                      {cpqCrossSelling.required.map((r) => (
                        <li key={r.product_id} className="flex items-center justify-between gap-2 p-2 rounded bg-amber-50 dark:bg-amber-950/30">
                          <span className="text-sm">{r.reason}</span>
                          <Button size="sm" onClick={() => addProductMutation.mutate({ productId: r.product_id, quantity: 1 })} disabled={draft.status === "created" || addProductMutation.isPending}>
                            <Plus className="w-4 h-4 mr-1" />
                            {t("offerDrafts.cpqCrossSelling.add")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cpqCrossSelling.recommended.length > 0 && (
                  <div>
                    <Label className="text-xs font-semibold">{t("offerDrafts.cpqCrossSelling.recommendedLabel")}</Label>
                    <ul className="mt-2 space-y-2">
                      {cpqCrossSelling.recommended.map((r) => (
                        <li key={r.product_id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/50">
                          <span className="text-sm">{r.reason}</span>
                          <Button size="sm" variant="outline" onClick={() => addProductMutation.mutate({ productId: r.product_id, quantity: 1 })} disabled={draft.status === "created" || addProductMutation.isPending}>
                            <Plus className="w-4 h-4 mr-1" />
                            {t("offerDrafts.cpqCrossSelling.add")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {cpqCrossSelling.optional.length > 0 && (
                  <div>
                    <Label className="text-xs font-semibold text-muted-foreground">
                      {t("offerDrafts.cpqCrossSelling.optionalLabel")}
                    </Label>
                    <ul className="mt-2 space-y-2">
                      {cpqCrossSelling.optional.map((r) => (
                        <li key={r.product_id} className="flex items-center justify-between gap-2 p-2 rounded bg-muted/30">
                          <span className="text-sm text-muted-foreground">
                            {r.category || t("offerDrafts.cpqCrossSelling.optionalFallback")}
                          </span>
                          <Button size="sm" variant="ghost" onClick={() => addProductMutation.mutate({ productId: r.product_id, quantity: 1 })} disabled={draft.status === "created" || addProductMutation.isPending}>
                            <Plus className="w-4 h-4 mr-1" />
                            {t("offerDrafts.cpqCrossSelling.add")}
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Package className="w-4 h-4" />
                {t("bundles.title")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {bundles.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("bundles.empty")}</p>
              ) : (
                <div className="flex flex-col md:flex-row gap-3 items-start md:items-end">
                  <div className="w-full md:flex-1 space-y-2">
                    <Label>{t("bundles.listTitle")}</Label>
                    <Select value={selectedBundleId} onValueChange={setSelectedBundleId}>
                      <SelectTrigger>
                        <SelectValue placeholder={t("bundles.create")} />
                      </SelectTrigger>
                      <SelectContent>
                        {bundles.map((bundle) => (
                          <SelectItem key={bundle.id} value={bundle.id}>
                            {bundle.name} ({bundle.mockProductNumber})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="w-full md:w-32 space-y-2">
                    <Label>{t("offerDrafts.review.quantity")}</Label>
                    <Input
                      type="number"
                      min={1}
                      value={bundleQuantity}
                      onChange={(event) => {
                        const nextValue = Number(event.target.value);
                        setBundleQuantity(Number.isFinite(nextValue) && nextValue > 0 ? nextValue : 1);
                      }}
                    />
                  </div>
                  <Button
                    onClick={() => addBundleMutation.mutate({ bundleId: selectedBundleId, quantity: bundleQuantity })}
                    disabled={!selectedBundleId || addBundleMutation.isPending || draft.status === "created"}
                  >
                    <Plus className="w-4 h-4 mr-1" />
                    {t("offerDrafts.crossSelling.addToDraft")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShoppingCart className="w-4 h-4" />
                  {t("offerDrafts.review.products")}
                </CardTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="show-unclear-offer"
                      checked={showUnclearInMainTable}
                      onCheckedChange={setShowUnclearInMainTable}
                      data-testid="switch-show-unclear-offer"
                    />
                    <Label htmlFor="show-unclear-offer" className="text-sm font-normal cursor-pointer">
                      Unklare Treffer in Haupttabelle
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setClarificationEmailOpen(true)}
                    data-testid="button-clarification-email-offer"
                  >
                    Rückfrage an Kunde
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <Alert variant="default" className="border-muted bg-muted/30">
                <AlertTitle className="text-sm">{t("offerDrafts.review.productScreenTitle", "Positions-Prüfung")}</AlertTitle>
                <AlertDescription className="text-xs text-muted-foreground">
                  {t("offerDrafts.review.productScreenHint")}
                </AlertDescription>
              </Alert>
              {mergedMatchingResults?.items && mergedMatchingResults.items.length > 0 ? (
                <>
                  {mainIndices.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-4 text-center" data-testid="text-main-products-empty">
                      Keine Zeilen in der Haupttabelle — siehe „Klärungsbedarf“ unten oder aktivieren Sie „Unklare Treffer in Haupttabelle“.
                    </p>
                  ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead data-testid="table-head-product">{t("offerDrafts.review.productName")}</TableHead>
                      <TableHead className="w-[120px]">{t("offerDrafts.review.productLikelihood", "Einordnung")}</TableHead>
                      <TableHead data-testid="table-head-quantity">{t("offerDrafts.review.quantity")}</TableHead>
                      <TableHead data-testid="table-head-catalog-price">{t("offerDrafts.review.catalogPrice")}</TableHead>
                      <TableHead data-testid="table-head-suggested-price">{t("offerDrafts.review.suggestedPrice")}</TableHead>
                      <TableHead data-testid="table-head-discount">{t("offerDrafts.review.discount")}</TableHead>
                      <TableHead data-testid="table-head-confidence">{t("offerDrafts.review.confidence")}</TableHead>
                      <TableHead className="w-[52px] text-right">{t("offerDrafts.review.actions", "Aktion")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mainIndices.map((index) => {
                      const item = mergedMatchingResults!.items![index] as Record<string, any>;
                      const hasAlternatives = item.alternativeMatches && item.alternativeMatches.length > 0;
                      const currentProductId = selectedProducts[index] || item.matchedProduct?.id;
                      
                      // Find the currently selected alternative (if any)
                      const selectedAlternative = currentProductId && item.alternativeMatches
                        ? item.alternativeMatches.find((alt: { id: string }) => alt.id === currentProductId)
                        : null;
                      
                      // Use either the selected alternative or the matched product for display
                      const isBundle = Boolean(item.bundle);
                      const displayName = isBundle
                        ? item.bundle?.name
                        : selectedAlternative?.name || item.matchedProduct?.name || item.extractedProductName;
                      const displayProductNumber = isBundle
                        ? item.bundle?.mockProductNumber
                        : selectedAlternative?.productNumber || item.matchedProduct?.productNumber;
                      
                      const likelihood = item.productScreen?.likelihood;
                      return (
                        <TableRow
                          key={index}
                          data-testid={`row-product-${index}`}
                          className={likelihood === "unclear" ? "bg-muted/20" : undefined}
                        >
                          <TableCell>
                            <div className="space-y-2">
                              {(item as any).systemMatch ? (
                                <>
                                  <p className="text-xs text-muted-foreground italic" data-testid={`text-system-request-${index}`}>
                                    {item.extractedProductName}
                                  </p>
                                  <div className="space-y-1 mt-2">
                                    <div className="flex items-center gap-2">
                                      <Badge variant="secondary" className="text-xs">
                                        Grundregal
                                      </Badge>
                                      <p className="font-medium text-sm" data-testid={`text-base-product-${index}`}>
                                        {(item as any).systemMatch.baseProduct?.name}
                                      </p>
                                    </div>
                                    {(item as any).systemMatch.extensionProduct && (
                                      <div className="flex items-center gap-2">
                                        <Badge variant="secondary" className="text-xs">
                                          + {(item as any).systemMatch.extensionQuantity}x Anbauregal
                                        </Badge>
                                        <p className="font-medium text-sm" data-testid={`text-ext-product-${index}`}>
                                          {(item as any).systemMatch.extensionProduct.name}
                                        </p>
                                      </div>
                                    )}
                                    {(item as any).systemMatch.totalWidth && (
                                      <p className="text-xs text-muted-foreground">
                                        = {(item as any).systemMatch.totalWidth}mm Gesamtbreite
                                      </p>
                                    )}
                                  </div>
                                </>
                              ) : (
                                <div className="space-y-2">
                                  <div>
                                    <p className="font-medium" data-testid={`text-product-name-${index}`}>
                                      {displayName}
                                    </p>
                                    {displayProductNumber && (
                                      <p className="text-xs text-muted-foreground font-mono" data-testid={`text-product-number-${index}`}>
                                        {displayProductNumber}
                                        {displayName && displayName !== displayProductNumber && <span className="font-normal"> – {displayName}</span>}
                                      </p>
                                    )}
                                    {isBundle && item.bundle?.components && (
                                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                        {item.bundle.components.map((component: Record<string, any>, componentIndex: number) => (
                                          <div key={`${component.productNumber}-${componentIndex}`}>
                                            {(component.productName || component.productNumber) + ` x${component.quantity}`}
                                          </div>
                                        ))}
                                      </div>
                                    )}
                                    {item.status !== "matched" && !currentProductId && (
                                      <Badge variant="outline" className="text-xs mt-1" data-testid={`badge-status-${index}`}>
                                        {item.status === "uncertain" ? t("offerDrafts.review.uncertain") : t("offerDrafts.review.notFound")}
                                      </Badge>
                                    )}
                                    {"catalogProductInactive" in item && (item as { catalogProductInactive?: boolean }).catalogProductInactive ? (
                                      <Badge
                                        variant="outline"
                                        className="text-xs mt-1 border-amber-600/60 text-amber-800 dark:text-amber-200"
                                        title={t("offerDrafts.review.catalogProductInactiveHint")}
                                        data-testid={`badge-inactive-catalog-${index}`}
                                      >
                                        {t("offerDrafts.review.catalogProductInactive")}
                                      </Badge>
                                    ) : null}
                                    {item.learningHint?.type === "blocked_line" && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs mt-1 border-amber-600/60 text-amber-800 dark:text-amber-200"
                                        data-testid={`badge-learning-blocked-${index}`}
                                      >
                                        KI-Lernen: Als Nicht-Produkt markiert
                                      </Badge>
                                    )}
                                    {item.learningHint?.type === "preferred_identifier" && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs mt-1 border-blue-600/60 text-blue-800 dark:text-blue-200"
                                        data-testid={`badge-learning-preferred-${index}`}
                                      >
                                        KI-Lernen: Referenz bevorzugt
                                      </Badge>
                                    )}
                                    <LineItemBuyerSkuLabel
                                      buyerSku={docExtractionItemsOffer[index]?.buyer_sku ?? null}
                                      supplierSku={
                                        docExtractionItemsOffer[index]?.supplier_sku ??
                                        item.extractedProductNumber ??
                                        null
                                      }
                                    />
                                    <LineItemConfidenceWarningBadges
                                      warnings={docExtractionItemsOffer[index]?.confidence_warnings}
                                    />
                                  </div>
                                  
                                  {!isBundle && hasAlternatives && (
                                    <div className="space-y-2">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-6 px-2 text-xs"
                                        onClick={() => setShowAlternatives(prev => ({
                                          ...prev,
                                          [index]: !prev[index]
                                        }))}
                                        data-testid={`button-show-alternatives-${index}`}
                                      >
                                        {showAlternatives[index] ? <ChevronUp className="w-3 h-3 mr-1" /> : <ChevronDown className="w-3 h-3 mr-1" />}
                                        {item.alternativeMatches!.length} {item.alternativeMatches!.length === 1 ? 'Alternative' : 'Alternativen'}
                                      </Button>
                                      
                                      {showAlternatives[index] && (
                                        <div className="pl-3 border-l-2 border-muted space-y-2" data-testid={`alternatives-list-${index}`}>
                                          {item.alternativeMatches!.map((alt: Record<string, any>, altIndex: number) => {
                                            const isSelected =
                                              normalizeProductId(selectedProducts[index]) === normalizeProductId(alt.id);
                                            return (
                                              <div
                                                key={alt.id}
                                                className={`p-2 rounded-md cursor-pointer hover-elevate ${
                                                  isSelected ? 'bg-primary/10 border border-primary' : 'bg-muted/50'
                                                }`}
                                                onClick={() => applyAlternativeSelection(index, alt.id)}
                                                data-testid={`alternative-${index}-${altIndex}`}
                                              >
                                                <div className="flex items-start justify-between gap-2">
                                                  <div className="flex-1 min-w-0">
                                                    <p className="text-sm font-medium" data-testid={`alt-name-${index}-${altIndex}`}>
                                                      {alt.name}
                                                    </p>
                                                    {alt.productNumber && (
                                                      <p className="text-xs text-muted-foreground font-mono" data-testid={`alt-number-${index}-${altIndex}`}>
                                                        {alt.productNumber}
                                                        {alt.name && <span className="font-normal"> – {alt.name}</span>}
                                                      </p>
                                                    )}
                                                    {alt.reasoning && (
                                                      <p className="text-xs text-muted-foreground mt-1 italic" data-testid={`alt-reasoning-${index}-${altIndex}`}>
                                                        {alt.reasoning}
                                                      </p>
                                                    )}
                                                  </div>
                                                  <div data-testid={`alt-confidence-${index}-${altIndex}`}>
                                                    {getConfidenceBadge(alt.confidence || 0)}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          </TableCell>
                          <TableCell className="align-top">
                            {likelihood === "likely_product" ? (
                              <Badge variant="default" className="bg-emerald-600 text-xs whitespace-normal text-left h-auto py-1">
                                {t("offerDrafts.review.likelyProduct", "Wahrscheinlich Produkt")}
                              </Badge>
                            ) : likelihood === "unlikely_product" ? (
                              <Badge variant="destructive" className="text-xs whitespace-normal text-left h-auto py-1">
                                {t("offerDrafts.review.unlikelyProduct", "Vermutlich kein Produkt")}
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="text-xs whitespace-normal text-left h-auto py-1 bg-amber-100 text-amber-950 dark:bg-amber-950/30 dark:text-amber-100">
                                {t("offerDrafts.review.unclearProduct", "Unklar")}
                              </Badge>
                            )}
                            {item.productScreen?.reasons?.[0] && (
                              <p className="text-[10px] text-muted-foreground mt-1.5 leading-snug max-w-[140px]">
                                {item.productScreen.reasons[0]}
                              </p>
                            )}
                          </TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <Input
                              type="number"
                              value={item.quantity}
                              className="w-20"
                              min="1"
                              readOnly
                              data-testid={`input-quantity-${index}`}
                            />
                            {item.originalQuantity && item.convertedQuantity && (
                              <div className="space-y-1">
                                <Badge variant="secondary" className="text-xs whitespace-nowrap" data-testid={`badge-conversion-${index}`}>
                                  = {item.originalQuantity} Holme
                                </Badge>
                                {item.conversionNote && (
                                  <p className="text-xs text-muted-foreground italic" data-testid={`text-conversion-note-${index}`}>
                                    {item.conversionNote}
                                  </p>
                                )}
                              </div>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium" data-testid={`text-catalog-price-${index}`}>
                            {item.matchedProduct?.catalogPrice
                              ? formatCurrency(item.matchedProduct.catalogPrice)
                              : "-"}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="font-medium text-primary" data-testid={`text-suggested-price-${index}`}>
                            {item.matchedProduct?.suggestedPrice
                              ? formatCurrency(item.matchedProduct.suggestedPrice)
                              : "-"}
                          </p>
                        </TableCell>
                        <TableCell>
                          {item.matchedProduct?.suggestedDiscount ? (
                            <Badge variant="secondary" className="bg-green-100 text-green-800" data-testid={`badge-discount-${index}`}>
                              <TrendingDown className="w-3 h-3 mr-1" />
                              {item.matchedProduct.suggestedDiscount.toFixed(1)}%
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground" data-testid={`text-no-discount-${index}`}>-</span>
                          )}
                        </TableCell>
                        <TableCell>{getConfidenceBadge(item.confidence ?? 0)}</TableCell>
                        <TableCell className="text-right align-middle">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                            disabled={draft.status === "created" || removeLineItemMutation.isPending}
                            title={t("offerDrafts.review.removeLine", "Zeile aus dem Entwurf entfernen")}
                            onClick={() => removeLineItemMutation.mutate(index)}
                            data-testid={`button-remove-line-${index}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                  </TableBody>
                </Table>
                  )}

              {clarificationIndices.length > 0 && (
                <Card className="border-amber-500/40 bg-amber-500/5">
                  <CardHeader>
                    <CardTitle className="text-base">Klärungsbedarf – nicht eindeutig zugeordnet</CardTitle>
                    <p className="text-xs text-muted-foreground">
                      Diese Zeilen sind keine sicheren Katalogtreffer. Als Produkt bestätigen oder entfernen.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {clarificationIndices.map((index) => {
                      const item = mergedMatchingResults!.items![index] as Record<string, any>;
                      const reason =
                        item.productScreen?.reasons?.[0] ||
                        ((item as { catalogMatchSkipped?: boolean }).catalogMatchSkipped
                          ? "Kein Katalogabgleich"
                          : "");
                      return (
                        <div
                          key={`clar-${index}`}
                          className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                          data-testid={`row-clarification-${index}`}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="font-medium text-sm">{item.extractedProductName}</p>
                            {item.extractedProductNumber && (
                              <p className="text-xs text-muted-foreground font-mono">{item.extractedProductNumber}</p>
                            )}
                            <LineItemBuyerSkuLabel
                              buyerSku={docExtractionItemsOffer[index]?.buyer_sku ?? null}
                              supplierSku={
                                docExtractionItemsOffer[index]?.supplier_sku ??
                                item.extractedProductNumber ??
                                null
                              }
                            />
                            {reason && <p className="text-xs text-muted-foreground mt-1">{reason}</p>}
                            <LineItemConfidenceWarningBadges
                              warnings={docExtractionItemsOffer[index]?.confidence_warnings}
                            />
                            {!item.bundle && item.alternativeMatches && item.alternativeMatches.length > 0 ? (
                              <div className="mt-3 space-y-2" data-testid={`clarification-alternatives-${index}`}>
                                <p className="text-xs font-medium">Alternative auswählen (bestätigt = 100 %):</p>
                                {item.alternativeMatches.map((alt: Record<string, unknown>, altIndex: number) => {
                                  const altId = String(alt.id);
                                  const isSelected =
                                    normalizeProductId(selectedProducts[index]) === normalizeProductId(altId);
                                  return (
                                    <div
                                      key={altId}
                                      className={`p-2 rounded-md cursor-pointer hover-elevate text-sm ${
                                        isSelected ? "bg-primary/10 border border-primary" : "bg-muted/50"
                                      }`}
                                      onClick={() => applyAlternativeSelection(index, altId)}
                                      data-testid={`clarification-alternative-${index}-${altIndex}`}
                                    >
                                      <span className="font-medium">{String(alt.name)}</span>
                                      {alt.productNumber ? (
                                        <span className="text-xs text-muted-foreground font-mono ml-2">
                                          {String(alt.productNumber)}
                                        </span>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                            {!item.bundle &&
                            item.matchedProduct?.id &&
                            (item.confidence ?? 0) < 100 &&
                            !(item.alternativeMatches?.length) ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2"
                                disabled={draft.status === "created"}
                                onClick={() => applyAlternativeSelection(index, item.matchedProduct!.id!)}
                                data-testid={`button-confirm-match-${index}`}
                              >
                                Zuordnung bestätigen (100 %)
                              </Button>
                            ) : null}
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={draft.status === "created" || markLineAsLikelyProductMutation.isPending}
                              onClick={() => markLineAsLikelyProductMutation.mutate(index)}
                              data-testid={`button-mark-product-${index}`}
                            >
                              Doch als Produkt
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              disabled={draft.status === "created" || removeLineItemMutation.isPending}
                              onClick={() => removeLineItemMutation.mutate(index)}
                              data-testid={`button-remove-clar-${index}`}
                            >
                              Verwerfen
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </CardContent>
                </Card>
              )}
                </>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4" data-testid="text-no-products">
                  {t("offerDrafts.review.noProducts")}
                </p>
              )}
            </CardContent>
          </Card>

          <CustomerClarificationEmailModal
            kind="offer"
            draftId={draft.id}
            open={clarificationEmailOpen}
            onOpenChange={setClarificationEmailOpen}
          />

          {shopwareCrossSellingSuggestions.length > 0 && (
            <Card data-testid="card-cross-selling">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base" data-testid="title-cross-selling">
                  <Sparkles className="w-4 h-4" />
                  {t("offerDrafts.crossSelling.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-2" data-testid="text-cross-selling-description">
                  {t("offerDrafts.crossSelling.description")}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {shopwareCrossSellingSuggestions.map((suggestion, groupIndex) => (
                  <div key={`${suggestion.forProduct.id}-${groupIndex}`} className="space-y-2" data-testid={`group-suggestions-${groupIndex}`}>
                    <div className="text-sm font-medium space-y-0.5" data-testid={`text-suggestions-for-${groupIndex}`}>
                      <div>
                        {t("offerDrafts.crossSelling.suggestionsFor")}: {suggestion.forProduct.name}
                      </div>
                      <div className="text-xs text-muted-foreground font-normal font-mono">
                        {suggestion.forProduct.productNumber}
                        {crossSellLabelName(suggestion.forProduct.productNumber) &&
                          crossSellLabelName(suggestion.forProduct.productNumber) !== suggestion.forProduct.name && (
                            <span className="text-muted-foreground">
                              {" "}
                              · {crossSellLabelName(suggestion.forProduct.productNumber)}
                            </span>
                          )}
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {suggestion.suggestions.map((product, sugIdx) => (
                        <Card key={product.id} className="hover-elevate overflow-hidden" data-testid={`card-suggestion-${groupIndex}-${product.id}`}>
                          <CardContent className="p-3 space-y-2">
                            {product.imageUrl && (
                              <div className="w-full h-32 bg-muted rounded-md overflow-hidden">
                                <img 
                                  src={product.imageUrl} 
                                  alt={product.name}
                                  className="w-full h-full object-cover"
                                  data-testid={`img-suggestion-${groupIndex}-${product.id}`}
                                />
                              </div>
                            )}
                            <div>
                              <div className="flex items-start gap-2 flex-wrap">
                                <div className="font-medium text-sm line-clamp-2 flex-1 min-w-0" title={product.name} data-testid={`text-product-name-${groupIndex}-${product.id}`}>
                                  {product.name}
                                </div>
                                {sugIdx === 0 && (
                                  <Badge
                                    variant="default"
                                    className="text-[10px] shrink-0"
                                    title={
                                      product.crossSellReason
                                        ? `${t("crossSelling.recommendedBecause", "Empfohlen, weil")}: ${product.crossSellReason}`
                                        : undefined
                                    }
                                  >
                                    {t("crossSelling.recommendedBadge", "Empfohlen")}
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1" data-testid={`text-product-number-${groupIndex}-${product.id}`}>
                                {product.productNumber}
                                {crossSellLabelName(product.productNumber) &&
                                  crossSellLabelName(product.productNumber) !== product.name && (
                                    <span className="block text-muted-foreground/90 mt-0.5">
                                      {crossSellLabelName(product.productNumber)}
                                    </span>
                                  )}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium" data-testid={`text-price-${groupIndex}-${product.id}`}>
                                €{product.price.toFixed(2)}
                              </div>
                              {product.stock > 0 ? (
                                <Badge variant="default" className="bg-green-600 text-xs" data-testid={`badge-in-stock-${groupIndex}-${product.id}`}>
                                  {t("common.inStock")}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs" data-testid={`badge-out-of-stock-${groupIndex}-${product.id}`}>
                                  {t("common.outOfStock")}
                                </Badge>
                              )}
                            </div>
                            <Button
                              size="sm"
                              className="w-full"
                              onClick={() => addProductMutation.mutate({ productId: product.id, quantity: 1 })}
                              disabled={addProductMutation.isPending || draft.status === "created"}
                              data-testid={`button-add-suggestion-${groupIndex}-${product.id}`}
                            >
                              <Plus className="w-4 h-4 mr-1" />
                              {t("offerDrafts.crossSelling.addToDraft")}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {groupIndex < shopwareCrossSellingSuggestions.length - 1 && (
                      <Separator className="my-4" />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {editedData?.offerNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-4 h-4" />
                  {t("offerDrafts.review.notes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea
                  value={editedData.offerNotes}
                  readOnly
                  className="min-h-[100px]"
                  data-testid="textarea-notes"
                />
              </CardContent>
            </Card>
          )}

          <DraftDebugJsonPanel
            meta={{
              id: draft.id,
              kind: "offer",
              originalFileName: draft.originalFileName,
              status: draft.status,
              createdAt: draft.createdAt != null ? String(draft.createdAt) : null,
              updatedAt: draft.updatedAt != null ? String(draft.updatedAt) : null,
              originalFilePath: draft.originalFilePath,
              shopwareCustomerId: draft.shopwareCustomerId,
              shopwareOfferId: draft.shopwareOfferId,
            }}
            extractedData={editedData ?? draft.extractedData}
            matchingResults={draft.matchingResults}
            extraSections={
              draft.crossSellingSuggestions?.length
                ? { crossSellingSuggestions: draft.crossSellingSuggestions }
                : undefined
            }
          />
        </div>

        <Separator className="my-4" />

        <DialogFooter className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={async () => {
                try {
                  const res = await fetch(`/api/offer-drafts/${draft.id}/pdf?download=true`, { credentials: "include" });
                  if (!res.ok) throw new Error("PDF konnte nicht geladen werden");
                  const blob = await res.blob();
                  const url = window.URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `Angebotsentwurf-${draft.originalFileName || draft.id}.pdf`;
                  document.body.appendChild(a);
                  a.click();
                  window.URL.revokeObjectURL(url);
                  document.body.removeChild(a);
                  toast({ title: "PDF heruntergeladen", description: "Der Angebotsentwurf wurde als PDF gespeichert." });
                } catch (e) {
                  toast({ title: "Fehler", description: e instanceof Error ? e.message : "PDF konnte nicht geladen werden", variant: "destructive" });
                }
              }}
              disabled={createOfferMutation.isPending || deleteMutation.isPending}
              data-testid="button-download-pdf"
            >
              <FileDown className="w-4 h-4 mr-2" />
              PDF herunterladen
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending || createOfferMutation.isPending}
              data-testid="button-delete"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              {t("common.delete")}
            </Button>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createOfferMutation.isPending || deleteMutation.isPending}
              data-testid="button-close"
            >
              {t("common.close")}
            </Button>
            <Button
              onClick={() => createOfferMutation.mutate()}
              disabled={!canCreateOffer || createOfferMutation.isPending || deleteMutation.isPending}
              title={isBlocked ? "Dieser Rabatt überschreitet die maximal zulässige Grenze. Bitte reduzieren Sie den Rabatt." : undefined}
              data-testid="button-create-offer"
            >
              {createOfferMutation.isPending ? t("offerDrafts.review.creating") : t("offerDrafts.review.createOffer")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
