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
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  CheckCircle,
  AlertCircle,
  XCircle,
  Package,
  User,
  MapPin,
  FileText,
  ShoppingCart,
  Sparkles,
  Plus,
  ChevronDown,
  ChevronUp,
  Trash2,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { DraftWebVerificationPanel } from "@/components/DraftWebVerificationPanel";
import { CustomerClarificationEmailModal } from "@/components/CustomerClarificationEmailModal";
import { DraftDebugJsonPanel } from "@/components/DraftDebugJsonPanel";
import {
  applyAlternativeSelectionsToMatchingResults,
  buildAlternativeSelectionFromDraftItems,
  confirmAlternativeSelection,
  isOfferLineReadyForCreate,
  normalizeProductId,
  recomputeOfferOverallConfidence,
  type AlternativeSelectionInput,
} from "@/lib/offerDraftLineItems";
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
  type DocumentExtractionLite,
} from "@/components/DocumentExtractionAlerts";

interface CrossSellingSuggestion {
  forProduct: {
    id: string;
    name: string;
    productNumber: string;
  };
  suggestions: Array<{
    id: string;
    productNumber: string;
    name: string;
    price: number;
    netPrice: number;
    imageUrl?: string;
    stock: number;
    available: boolean;
  }>;
}

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

interface OrderDraft {
  id: string;
  createdAt: string;
  updatedAt: string;
  status: "pending" | "approved" | "review_required" | "rejected" | "created";
  createdByUserId: string | null;
  originalFileName: string;
  originalFilePath: string | null;
  extractedData: {
    customer?: {
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      company?: string;
      customerMatchConfidence?: number;
      emailResolution?: {
        candidatesTried?: string[];
        chosenEmail?: string;
        method?: "heuristic" | "llm" | "extracted_only";
      };
    };
    billingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      phone?: string;
    };
    shippingAddress?: {
      firstName?: string;
      lastName?: string;
      street?: string;
      zipCode?: string;
      city?: string;
      country?: string;
      company?: string;
      phone?: string;
    };
    lineItems?: Array<{
      extractedProductName: string;
      extractedPositionNumber?: string;
      extractedProductNumber?: string;
      quantity: number;
      extractedPrice?: number;
    }>;
    orderNotes?: string;
    commercialIntent?: "quote_request" | "purchase_order" | "unclear";
    commercialIntentConfidence?: number;
    commercialIntentRationale?: string;
    commercialIntentRoutedAsOfferDueToPermission?: boolean;
    commercialIntentVsUploadMismatch?: boolean;
    webDomainVerification?: {
      domain: string;
      urlsTried: string[];
      ok: boolean;
      checks: {
        zipMatch: boolean;
        cityMatch: boolean;
        companyMatch: boolean;
        streetPartialMatch: boolean;
      };
      excerpt?: string;
      error?: string;
      fetchedAt: string;
      skippedReason?: "freemail" | "no_domain" | "no_email_context";
    };
    /** Snake-case Original aus dem META-aware Extractor; UI nutzt davon recipient_is_meta + warnings. */
    documentExtraction?: DocumentExtractionLite;
  } | null;
  matchingResults: {
    items: Array<{
      extractedProductName: string;
      extractedPositionNumber?: string;
      extractedProductNumber?: string;
      quantity: number;
      matchedProduct?: {
        id: string;
        productNumber: string;
        name: string;
        price: number;
        confidence: number;
      };
      bundle?: {
        id: string;
        name: string;
        mockProductNumber: string;
        components: Array<{
          productNumber: string;
          productName?: string | null;
          quantity: number;
        }>;
      };
      alternativeMatches?: Array<{
        id: string;
        productNumber: string;
        name: string;
        price: number;
        confidence: number;
      }>;
      learningHint?: {
        type: "blocked_line" | "preferred_identifier";
        identifier?: string;
      };
      confidence: number;
      status: "matched" | "uncertain" | "not_found";
      productScreen?: { likelihood?: string; reasons?: string[] };
      catalogMatchSkipped?: boolean;
    }>;
    overallConfidence: number;
  } | null;
  shopwareCustomerId: string | null;
  shopwareOrderId: string | null;
  crossSellingSuggestions?: CrossSellingSuggestion[];
}

interface OrderDraftReviewModalProps {
  draft: OrderDraft;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: () => void;
}

export function OrderDraftReviewModal({
  draft,
  open,
  onOpenChange,
  onUpdate,
}: OrderDraftReviewModalProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [editedData, setEditedData] = useState(draft.extractedData);
  const [showAlternatives, setShowAlternatives] = useState<Record<number, boolean>>({});
  const [selectedProducts, setSelectedProducts] = useState<Record<number, string>>({});
  const [confirmedLines, setConfirmedLines] = useState<Record<number, boolean>>({});
  const [selectedBundleId, setSelectedBundleId] = useState<string>("");
  const [bundleQuantity, setBundleQuantity] = useState(1);
  const [showUnclearInMainTable, setShowUnclearInMainTable] = useState(false);
  const [clarificationEmailOpen, setClarificationEmailOpen] = useState(false);
  const [useSeparateShipping, setUseSeparateShipping] = useState(false);

  // Reset editedData whenever draft.id changes to prevent stale data
  useEffect(() => {
    setEditedData(draft.extractedData);
    const s = draft.extractedData?.shippingAddress;
    setUseSeparateShipping(Boolean(s?.street?.trim() || s?.zipCode?.trim()));
    const initial = buildAlternativeSelectionFromDraftItems(
      draft.matchingResults?.items as import("@/lib/offerDraftLineItems").OfferDraftMatchItem[] | undefined
    );
    setSelectedProducts(initial.selectedProducts);
    setConfirmedLines(initial.confirmedLines ?? {});
    setShowAlternatives({});
  }, [draft.id, draft.extractedData, draft.matchingResults]);

  const alternativeSelectionInput = useMemo<AlternativeSelectionInput>(
    () => ({ selectedProducts, confirmedLines }),
    [selectedProducts, confirmedLines]
  );

  const mergedMatchingResults = useMemo(
    () => applyAlternativeSelectionsToMatchingResults(draft.matchingResults, alternativeSelectionInput),
    [draft.matchingResults, alternativeSelectionInput]
  );

  const matchItems = mergedMatchingResults?.items ?? [];
  const { mainIndices, clarificationIndices } = useMemo(() => {
    const main: number[] = [];
    const clar: number[] = [];
    matchItems.forEach((item, index) => {
      const lik = item.productScreen?.likelihood;
      const skip = Boolean(item.catalogMatchSkipped);
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
  }, [matchItems, showUnclearInMainTable]);

  const persistAlternativeSelectionMutation = useMutation({
    mutationFn: async (input: AlternativeSelectionInput) => {
      const matchingResults = applyAlternativeSelectionsToMatchingResults(draft.matchingResults, input);
      if (!matchingResults) return;
      await apiRequest("PATCH", `/api/order-drafts/${draft.id}`, {
        extractedData: editedData,
        matchingResults,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
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

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (mergedMatchingResults) {
        await apiRequest("PATCH", `/api/order-drafts/${draft.id}`, {
          extractedData: editedData,
          matchingResults: mergedMatchingResults,
        });
      }
      const response = await apiRequest("POST", `/api/order-drafts/${draft.id}/create-order`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("orderDrafts.review.orderCreated"),
        description: t("orderDrafts.review.orderCreatedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDrafts.review.createOrderError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const createShopwareCustomerMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/order-drafts/${draft.id}/create-shopware-customer`, {
        extractedData: editedData,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((json as { error?: string }).error || res.statusText);
      }
      return json;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      toast({ title: t("orderDrafts.review.createShopwareCustomerSuccess") });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const saveExtractedDataMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/order-drafts/${draft.id}`, { extractedData: editedData });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      toast({ title: "Gespeichert", description: "Kunden- und Adressdaten wurden übernommen." });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const markLineAsLikelyProductMutation = useMutation({
    mutationFn: async (index: number) => {
      const items = [...(draft.matchingResults?.items ?? [])];
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
      await apiRequest("PATCH", `/api/order-drafts/${draft.id}`, {
        extractedData: editedData,
        matchingResults: { ...draft.matchingResults, items, overallConfidence },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      toast({ title: "Position aktualisiert", description: "Als Produkt eingestuft." });
    },
    onError: (e: Error) =>
      toast({ title: t("common.error", "Fehler"), description: e.message, variant: "destructive" }),
  });

  const removeLineItemMutation = useMutation({
    mutationFn: async (index: number) => {
      const items = [...(draft.matchingResults?.items ?? [])];
      const lineItems = [...((editedData || draft.extractedData)?.lineItems ?? [])];
      if (index < 0 || index >= items.length) return;
      items.splice(index, 1);
      if (lineItems.length > index) lineItems.splice(index, 1);
      const overallConfidence = recomputeOfferOverallConfidence(
        items as Array<{ confidence: number; productScreen?: { likelihood: string } }>
      );
      await apiRequest("PATCH", `/api/order-drafts/${draft.id}`, {
        extractedData: { ...(editedData || draft.extractedData || {}), lineItems },
        matchingResults: { ...draft.matchingResults, items, overallConfidence },
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      toast({ title: "Position entfernt" });
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

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("DELETE", `/api/order-drafts/${draft.id}`);
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("orderDrafts.review.deleted"),
        description: t("orderDrafts.review.deletedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDrafts.review.deleteError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const addProductMutation = useMutation({
    mutationFn: async ({ productId, quantity }: { productId: string; quantity: number }) => {
      const response = await apiRequest("POST", `/api/order-drafts/${draft.id}/add-product`, {
        productId,
        quantity,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("orderDrafts.crossSelling.productAdded"),
        description: t("orderDrafts.crossSelling.productAddedDescription"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDrafts.crossSelling.addProductError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: bundlesData } = useQuery<{ bundles: BundleSummary[] }>({
    queryKey: ["/api/bundles", "order-drafts"],
    queryFn: async () => {
      const response = await fetch("/api/bundles");
      if (!response.ok) {
        throw new Error("Failed to fetch bundles");
      }
      return response.json();
    },
  });

  const bundles = bundlesData?.bundles ?? [];

  const addBundleMutation = useMutation({
    mutationFn: async ({ bundleId, quantity }: { bundleId: string; quantity: number }) => {
      const response = await apiRequest("POST", `/api/order-drafts/${draft.id}/add-bundle`, {
        bundleId,
        quantity,
      });
      return await response.json();
    },
    onSuccess: () => {
      toast({
        title: t("orderDrafts.crossSelling.productAdded"),
        description: t("orderDrafts.crossSelling.productAddedDescription"),
      });
      setSelectedBundleId("");
      setBundleQuantity(1);
      queryClient.invalidateQueries({ queryKey: ["/api/order-drafts"] });
      onUpdate();
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDrafts.crossSelling.addProductError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

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

  const canCreateOrder =
    draft.status !== "created" &&
    !!mergedMatchingResults?.items?.length &&
    mergedMatchingResults.items.every((item, index) =>
      isOfferLineReadyForCreate(item, index, alternativeSelectionInput)
    );

  const ed = draft.extractedData;
  const intentConf = ed?.commercialIntentConfidence;
  const showCommercialHint =
    typeof intentConf === "number" &&
    (intentConf < 0.6 || ed?.commercialIntent === "unclear" || Boolean(ed?.commercialIntentVsUploadMismatch));
  const showRerouteHint = Boolean(ed?.commercialIntentRoutedAsOfferDueToPermission);
  const custMatch = ed?.customer?.customerMatchConfidence;
  const showCustomerMatchHint = typeof custMatch === "number" && custMatch < 72;
  const showLowMatchingHint = isLowOverallMatchingConfidence(mergedMatchingResults ?? draft.matchingResults);
  const lowMatchingScore =
    mergedMatchingResults?.overallConfidence ?? draft.matchingResults?.overallConfidence;
  const documentExtraction = pickDocumentExtraction(
    (editedData ?? draft.extractedData) as Record<string, unknown> | null
  );
  const docExtractionItems = documentExtraction?.line_items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" data-testid="dialog-review">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle data-testid="text-review-title">{t("orderDrafts.review.title")}</DialogTitle>
              <DialogDescription data-testid="text-review-filename">
                {draft.originalFileName}
              </DialogDescription>
            </div>
            {mergedMatchingResults && (
              <div data-testid="badge-overall-confidence">
                {getConfidenceBadge(mergedMatchingResults.overallConfidence)}
              </div>
            )}
          </div>
        </DialogHeader>

        <DocumentExtractionRecipientMetaAlert extraction={documentExtraction} />
        <DocumentExtractionWarningsAlert extraction={documentExtraction} />

        {showLowMatchingHint && (
          <Alert
            variant="destructive"
            className="border-destructive/60"
            data-testid="alert-low-overall-matching"
          >
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-sm">
              {t("drafts.importLowMatching.modalTitle", {
                defaultValue: "Produktzuordnung unter {{threshold}} %",
                threshold: IMPORT_MATCHING_CONFIDENCE_WARNING_THRESHOLD,
              })}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground">
              {t("drafts.importLowMatching.modalBody", {
                defaultValue:
                  "Gesamt-Genauigkeit: {{score}} %. Bitte extrahierte Positionen, Alternativen und Mengen sorgfältig prüfen, bevor du die Bestellung anlegst.",
                score: typeof lowMatchingScore === "number" ? lowMatchingScore : "—",
              })}
            </AlertDescription>
          </Alert>
        )}

        {(showCommercialHint || showRerouteHint || showCustomerMatchHint) && (
          <Alert className="border-amber-500/40 bg-amber-500/5">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle className="text-sm">
              {t("drafts.commercialReview.title", "Hinweis zur KI-Einordnung")}
            </AlertTitle>
            <AlertDescription className="text-xs space-y-2 text-muted-foreground">
              {showCustomerMatchHint && (
                <p>
                  {t("drafts.commercialReview.customerMatch", {
                    defaultValue: "Kundenzuordnung mit nur {{score}} % geschätzter Sicherheit — bitte prüfen.",
                    score: custMatch,
                  })}
                </p>
              )}
              {(showCommercialHint || showRerouteHint) && (
                <p>
                  {showRerouteHint
                    ? t(
                        "drafts.commercialReview.intentReroutedNeutral",
                        "Intent und gewählte Pipeline wichen voneinander ab — bitte prüfen."
                      )
                    : t(
                        "drafts.commercialReview.intentUncertain",
                        "Dokumenten-Intent unsicher — Inhalt bitte gegenprüfen."
                      )}
                  {typeof intentConf === "number" && (
                    <span className="block mt-1">
                      {t("drafts.commercialReview.intentScore", {
                        defaultValue: "Intent-Konfidenz: {{p}} %",
                        p: Math.round(intentConf * 100),
                      })}
                    </span>
                  )}
                </p>
              )}
            </AlertDescription>
          </Alert>
        )}

        <div className="space-y-6">
          {/* Customer Information */}
          {editedData?.customer && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2 text-base">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4" />
                    {t("orderDrafts.review.customerInfo")}
                  </div>
                  {draft.shopwareCustomerId && (
                    <Badge variant="secondary" className="text-xs" data-testid="badge-customer-exists">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      {t("orderDrafts.review.customerExists")}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="customer-firstName">{t("orderDrafts.review.fields.firstName")}</Label>
                  <Input
                    id="customer-firstName"
                    value={editedData.customer.firstName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, firstName: e.target.value },
                      })
                    }
                    data-testid="input-customer-firstname"
                  />
                </div>
                <div>
                  <Label htmlFor="customer-lastName">{t("orderDrafts.review.fields.lastName")}</Label>
                  <Input
                    id="customer-lastName"
                    value={editedData.customer.lastName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, lastName: e.target.value },
                      })
                    }
                    data-testid="input-customer-lastname"
                  />
                </div>
                <div>
                  <Label htmlFor="customer-email">{t("orderDrafts.review.fields.email")}</Label>
                  <Input
                    id="customer-email"
                    value={editedData.customer.email || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, email: e.target.value },
                      })
                    }
                    data-testid="input-customer-email"
                  />
                  {(editedData.customer.emailResolution?.candidatesTried?.length ?? 0) > 1 && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {t("orderDrafts.review.emailResolutionHint")}
                    </p>
                  )}
                </div>
                <div>
                  <Label htmlFor="customer-phone">{t("orderDrafts.review.fields.phone")}</Label>
                  <Input
                    id="customer-phone"
                    value={editedData.customer.phone || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, phone: e.target.value },
                      })
                    }
                    data-testid="input-customer-phone"
                  />
                </div>
                <div className="col-span-2">
                  <Label htmlFor="customer-company">{t("orderDrafts.review.fields.company")}</Label>
                  <Input
                    id="customer-company"
                    value={editedData.customer.company || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        customer: { ...editedData.customer, company: e.target.value },
                      })
                    }
                    data-testid="input-customer-company"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Billing Address */}
          {editedData?.billingAddress && (
            <Card>
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="w-4 h-4" />
                  {t("orderDrafts.review.billingAddress")}
                </CardTitle>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={saveExtractedDataMutation.isPending}
                  onClick={() => saveExtractedDataMutation.mutate()}
                >
                  {saveExtractedDataMutation.isPending ? t("orderDrafts.review.creating") : "Adresse speichern"}
                </Button>
              </CardHeader>
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>{t("orderDrafts.review.fields.company")}</Label>
                  <Input
                    value={editedData.billingAddress.company || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, company: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t("orderDrafts.review.fields.firstName")}</Label>
                  <Input
                    value={editedData.billingAddress.firstName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, firstName: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t("orderDrafts.review.fields.lastName")}</Label>
                  <Input
                    value={editedData.billingAddress.lastName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, lastName: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>{t("orderDrafts.review.fields.street")}</Label>
                  <Input
                    value={editedData.billingAddress.street || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, street: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t("orderDrafts.review.fields.zipCode")}</Label>
                  <Input
                    value={editedData.billingAddress.zipCode || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, zipCode: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>{t("orderDrafts.review.fields.city")}</Label>
                  <Input
                    value={editedData.billingAddress.city || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, city: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>{t("orderDrafts.review.fields.country")}</Label>
                  <Input
                    value={editedData.billingAddress.country || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, country: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Telefon (Rechnungsadresse)</Label>
                  <Input
                    type="tel"
                    value={editedData.billingAddress.phone || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        billingAddress: { ...editedData.billingAddress!, phone: e.target.value },
                      })
                    }
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MapPin className="w-4 h-4" />
                  Lieferadresse
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Switch
                    id="separate-shipping"
                    checked={useSeparateShipping}
                    onCheckedChange={(on) => {
                      setUseSeparateShipping(on);
                      if (!on) {
                        setEditedData((prev) => {
                          if (!prev) return prev;
                          const { shippingAddress: _s, ...rest } = prev;
                          return rest;
                        });
                      } else {
                        setEditedData((prev) => {
                          if (!prev) return prev;
                          const base = prev.billingAddress || {};
                          return {
                            ...prev,
                            shippingAddress: { ...base, ...(prev.shippingAddress || {}) },
                          };
                        });
                      }
                    }}
                  />
                  <Label htmlFor="separate-shipping" className="text-sm font-normal cursor-pointer">
                    Abweichende Lieferadresse
                  </Label>
                </div>
              </div>
            </CardHeader>
            {useSeparateShipping && editedData && (
              <CardContent className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <Label>Firma (Lieferung)</Label>
                  <Input
                    value={editedData.shippingAddress?.company || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), company: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Vorname</Label>
                  <Input
                    value={editedData.shippingAddress?.firstName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), firstName: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Nachname</Label>
                  <Input
                    value={editedData.shippingAddress?.lastName || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), lastName: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Straße</Label>
                  <Input
                    value={editedData.shippingAddress?.street || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), street: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>PLZ</Label>
                  <Input
                    value={editedData.shippingAddress?.zipCode || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), zipCode: e.target.value },
                      })
                    }
                  />
                </div>
                <div>
                  <Label>Ort</Label>
                  <Input
                    value={editedData.shippingAddress?.city || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), city: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Land</Label>
                  <Input
                    value={editedData.shippingAddress?.country || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), country: e.target.value },
                      })
                    }
                  />
                </div>
                <div className="col-span-2">
                  <Label>Telefon (Lieferadresse)</Label>
                  <Input
                    type="tel"
                    value={editedData.shippingAddress?.phone || ""}
                    onChange={(e) =>
                      setEditedData({
                        ...editedData,
                        shippingAddress: { ...(editedData.shippingAddress || {}), phone: e.target.value },
                      })
                    }
                  />
                </div>
              </CardContent>
            )}
          </Card>

          {!draft.shopwareCustomerId && editedData?.billingAddress && !!emailForShopwareCustomer && (
            <Card data-testid="card-create-shopware-customer-order">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <User className="w-4 h-4" />
                  Shopware
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{t("orderDrafts.review.createShopwareCustomerHint")}</p>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={createShopwareCustomerMutation.isPending || !canCreateShopwareCustomerFromDraft}
                  onClick={() => {
                    if (!canCreateShopwareCustomerFromDraft) {
                      toast({
                        title: t("common.error", "Fehler"),
                        description: t("orderDrafts.review.createShopwareCustomerMissingData"),
                        variant: "destructive",
                      });
                      return;
                    }
                    createShopwareCustomerMutation.mutate();
                  }}
                  data-testid="button-create-shopware-customer-order"
                >
                  {createShopwareCustomerMutation.isPending
                    ? t("orderDrafts.review.creating")
                    : t("orderDrafts.review.createShopwareCustomer")}
                </Button>
              </CardContent>
            </Card>
          )}

          {(editedData?.webDomainVerification ?? draft.extractedData?.webDomainVerification) && (
            <DraftWebVerificationPanel
              data={
                (editedData?.webDomainVerification ??
                  draft.extractedData?.webDomainVerification)!}
              i18nPrefix="orderDrafts.review"
            />
          )}

          {/* Product Matching */}
          {mergedMatchingResults && mergedMatchingResults.items.length > 0 && (
            <>
            <Card>
              <CardHeader className="space-y-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Package className="w-4 h-4" />
                    {t("orderDrafts.review.productMatching")}
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Switch
                        id="show-unclear-order"
                        checked={showUnclearInMainTable}
                        onCheckedChange={setShowUnclearInMainTable}
                      />
                      <Label htmlFor="show-unclear-order" className="text-sm font-normal cursor-pointer">
                        Unklare Treffer in Haupttabelle
                      </Label>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={() => setClarificationEmailOpen(true)}>
                      Rückfrage an Kunde
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {mainIndices.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    Keine Zeilen in der Haupttabelle — siehe „Klärungsbedarf“ unten oder aktivieren Sie „Unklare Treffer in Haupttabelle“.
                  </p>
                ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("orderDrafts.review.table.extractedProduct")}</TableHead>
                      <TableHead>{t("orderDrafts.review.table.matchedProduct")}</TableHead>
                      <TableHead>Einordnung</TableHead>
                      <TableHead>{t("orderDrafts.review.table.quantity")}</TableHead>
                      <TableHead>{t("orderDrafts.review.table.confidence")}</TableHead>
                      <TableHead className="w-[52px] text-right">Aktion</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {mainIndices.map((index) => {
                      const item = mergedMatchingResults!.items[index];
                      const currentProductId = selectedProducts[index] || item.matchedProduct?.id;
                      const docItem = docExtractionItems[index];
                      return (
                      <TableRow key={index} data-testid={`row-product-${index}`}>
                        <TableCell>
                          <div>
                            <div className="font-medium" data-testid={`text-extracted-name-${index}`}>
                              {item.extractedProductName}
                            </div>
                            {item.extractedProductNumber && (
                              <div className="text-sm text-muted-foreground" data-testid={`text-extracted-number-${index}`}>
                                {item.extractedProductNumber}
                              </div>
                            )}
                            <LineItemBuyerSkuLabel
                              buyerSku={docItem?.buyer_sku ?? null}
                              supplierSku={docItem?.supplier_sku ?? item.extractedProductNumber ?? null}
                            />
                            {item.extractedPositionNumber && (
                              <div className="text-xs text-muted-foreground" data-testid={`text-extracted-position-${index}`}>
                                Pos. {item.extractedPositionNumber}
                              </div>
                            )}
                            <LineItemConfidenceWarningBadges warnings={docItem?.confidence_warnings} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-2">
                            {item.bundle ? (
                              <div>
                                <div className="font-medium" data-testid={`text-matched-name-${index}`}>
                                  {item.bundle.name}
                                </div>
                                <div className="text-sm text-muted-foreground" data-testid={`text-matched-number-${index}`}>
                                  {item.bundle.mockProductNumber}
                                </div>
                                <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                                  {item.bundle.components.map((component, componentIndex) => (
                                    <div key={`${component.productNumber}-${componentIndex}`}>
                                      {(component.productName || component.productNumber) + ` x${component.quantity}`}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : item.matchedProduct || (currentProductId && item.alternativeMatches?.find((a) => a.id === currentProductId)) ? (
                              <div>
                                <div className="font-medium" data-testid={`text-matched-name-${index}`}>
                                  {item.matchedProduct?.name ??
                                    item.alternativeMatches?.find((a) => a.id === currentProductId)?.name}
                                </div>
                                <div className="text-sm text-muted-foreground font-mono" data-testid={`text-matched-number-${index}`}>
                                  {item.matchedProduct?.productNumber ??
                                    item.alternativeMatches?.find((a) => a.id === currentProductId)?.productNumber}
                                  {' • '}€
                                  {(
                                    item.matchedProduct?.price ??
                                    item.alternativeMatches?.find((a) => a.id === currentProductId)?.price ??
                                    0
                                  ).toFixed(2)}
                                </div>
                                {"catalogProductInactive" in item && (item as { catalogProductInactive?: boolean }).catalogProductInactive ? (
                                  <Badge
                                    variant="outline"
                                    className="text-xs mt-1 border-amber-600/60 text-amber-800 dark:text-amber-200"
                                    title={t("orderDrafts.review.catalogProductInactiveHint")}
                                    data-testid={`badge-inactive-catalog-${index}`}
                                  >
                                    {t("orderDrafts.review.catalogProductInactive")}
                                  </Badge>
                                ) : null}
                              </div>
                            ) : (
                              <Badge variant="destructive" data-testid={`badge-not-found-${index}`}>
                                {t("orderDrafts.review.notFound")}
                              </Badge>
                            )}

                            {/* Alternatives Section */}
                            {item.alternativeMatches && item.alternativeMatches.length > 0 && (
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
                                  {item.alternativeMatches.length} {item.alternativeMatches.length === 1 ? 'Alternative' : 'Alternativen'}
                                </Button>
                                
                                {showAlternatives[index] && (
                                  <div className="pl-3 border-l-2 border-muted space-y-2" data-testid={`alternatives-list-${index}`}>
                                    {item.alternativeMatches.map((alt, altIndex) => {
                                      const isSelected =
                                        normalizeProductId(selectedProducts[index]) === normalizeProductId(alt.id);
                                      return (
                                      <div
                                        key={alt.id}
                                        className={`p-2 rounded-md cursor-pointer hover-elevate ${
                                          isSelected ? "bg-primary/10 border border-primary" : "bg-muted/50"
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
                                                {' • '}€{alt.price.toFixed(2)}
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
                            {item.learningHint?.type === "blocked_line" && (
                              <Badge
                                variant="outline"
                                className="text-xs border-amber-600/60 text-amber-800 dark:text-amber-200"
                                data-testid={`badge-learning-blocked-${index}`}
                              >
                                KI-Lernen: Als Nicht-Produkt markiert
                              </Badge>
                            )}
                            {item.learningHint?.type === "preferred_identifier" && (
                              <Badge
                                variant="outline"
                                className="text-xs border-blue-600/60 text-blue-800 dark:text-blue-200"
                                data-testid={`badge-learning-preferred-${index}`}
                              >
                                KI-Lernen: Referenz bevorzugt
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground align-top">
                          {item.productScreen?.likelihood === "likely_product"
                            ? "Wahrscheinlich Produkt"
                            : item.productScreen?.likelihood === "unlikely_product"
                              ? "Vermutlich kein Produkt"
                              : item.productScreen?.likelihood === "unclear"
                                ? "Unklar"
                                : "—"}
                        </TableCell>
                        <TableCell data-testid={`text-quantity-${index}`}>{item.quantity}</TableCell>
                        <TableCell>{getConfidenceBadge(item.confidence)}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive"
                            disabled={draft.status === "created" || removeLineItemMutation.isPending}
                            onClick={() => removeLineItemMutation.mutate(index)}
                            title="Zeile entfernen"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );})}
                  </TableBody>
                </Table>
                )}

                {clarificationIndices.length > 0 && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardHeader>
                      <CardTitle className="text-base">Klärungsbedarf – nicht eindeutig zugeordnet</CardTitle>
                      <p className="text-xs text-muted-foreground">
                        Bitte prüfen oder an den Kunden zurückfragen.
                      </p>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {clarificationIndices.map((index) => {
                        const item = mergedMatchingResults!.items[index];
                        const docItem = docExtractionItems[index];
                        const reason =
                          item.productScreen?.reasons?.[0] ||
                          (item.catalogMatchSkipped ? "Kein Katalogabgleich" : "");
                        return (
                          <div
                            key={`clar-${index}`}
                            className="flex flex-col gap-2 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="font-medium text-sm">{item.extractedProductName}</p>
                              {item.extractedProductNumber && (
                                <p className="text-xs text-muted-foreground font-mono">{item.extractedProductNumber}</p>
                              )}
                              <LineItemBuyerSkuLabel
                                buyerSku={docItem?.buyer_sku ?? null}
                                supplierSku={docItem?.supplier_sku ?? item.extractedProductNumber ?? null}
                              />
                              {item.extractedPositionNumber && (
                                <p className="text-xs text-muted-foreground">Pos. {item.extractedPositionNumber}</p>
                              )}
                              {reason && <p className="text-xs text-muted-foreground mt-1">{reason}</p>}
                              <LineItemConfidenceWarningBadges warnings={docItem?.confidence_warnings} />
                              {item.alternativeMatches && item.alternativeMatches.length > 0 ? (
                                <div className="mt-3 space-y-2" data-testid={`clarification-alternatives-${index}`}>
                                  <p className="text-xs font-medium">Alternative auswählen (bestätigt = 100 %):</p>
                                  {item.alternativeMatches.map((alt, altIndex) => {
                                    const isSelected =
                                      normalizeProductId(selectedProducts[index]) === normalizeProductId(alt.id);
                                    return (
                                      <div
                                        key={alt.id}
                                        className={`p-2 rounded-md cursor-pointer hover-elevate text-sm ${
                                          isSelected ? "bg-primary/10 border border-primary" : "bg-muted/50"
                                        }`}
                                        onClick={() => applyAlternativeSelection(index, alt.id)}
                                        data-testid={`clarification-alternative-${index}-${altIndex}`}
                                      >
                                        <span className="font-medium">{alt.name}</span>
                                        {alt.productNumber ? (
                                          <span className="text-xs text-muted-foreground font-mono ml-2">
                                            {alt.productNumber}
                                          </span>
                                        ) : null}
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                              {item.matchedProduct?.id &&
                              (item.confidence ?? 0) < 100 &&
                              !(item.alternativeMatches?.length) ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="mt-2"
                                  disabled={draft.status === "created"}
                                  onClick={() => applyAlternativeSelection(index, item.matchedProduct!.id)}
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
              </CardContent>
            </Card>
            <CustomerClarificationEmailModal
              kind="order"
              draftId={draft.id}
              open={clarificationEmailOpen}
              onOpenChange={setClarificationEmailOpen}
            />
            </>
          )}

          {/* Add Bundle */}
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
                    <Label>{t("orderDrafts.review.table.quantity")}</Label>
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
                    {t("orderDrafts.crossSelling.addToDraft")}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Cross-Selling Suggestions */}
          {draft.crossSellingSuggestions && draft.crossSellingSuggestions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Sparkles className="w-4 h-4" />
                  {t("orderDrafts.crossSelling.title")}
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-2">
                  {t("orderDrafts.crossSelling.description")}
                </p>
              </CardHeader>
              <CardContent className="space-y-4">
                {draft.crossSellingSuggestions.map((suggestion, groupIndex) => (
                  <div key={`${suggestion.forProduct.id}-${groupIndex}`} className="space-y-2">
                    <div className="text-sm font-medium">
                      {t("orderDrafts.crossSelling.suggestionsFor")}: {suggestion.forProduct.name}
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {suggestion.suggestions.map((product) => (
                        <Card key={product.id} className="hover-elevate overflow-hidden">
                          <CardContent className="p-3 space-y-2">
                            {product.imageUrl && (
                              <div className="w-full h-32 bg-muted rounded-md overflow-hidden">
                                <img 
                                  src={product.imageUrl} 
                                  alt={product.name}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <div>
                              <div className="font-medium text-sm line-clamp-2" title={product.name}>
                                {product.name}
                              </div>
                              <div className="text-xs text-muted-foreground mt-1">
                                {product.productNumber}
                              </div>
                            </div>
                            <div className="flex items-center justify-between">
                              <div className="text-sm font-medium">
                                €{product.price.toFixed(2)}
                              </div>
                              {product.stock > 0 ? (
                                <Badge variant="default" className="bg-green-600 text-xs">
                                  {t("common.inStock")}
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="text-xs">
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
                              {t("orderDrafts.crossSelling.addToDraft")}
                            </Button>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    {groupIndex < (draft.crossSellingSuggestions?.length || 0) - 1 && (
                      <Separator className="my-4" />
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}

          {/* Order Notes */}
          {editedData?.orderNotes && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <FileText className="w-4 h-4" />
                  {t("orderDrafts.review.orderNotes")}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Textarea value={editedData.orderNotes} readOnly rows={3} data-testid="textarea-order-notes" />
              </CardContent>
            </Card>
          )}

          <DraftDebugJsonPanel
            meta={{
              id: draft.id,
              kind: "order",
              originalFileName: draft.originalFileName,
              status: draft.status,
              createdAt: draft.createdAt != null ? String(draft.createdAt) : null,
              updatedAt: draft.updatedAt != null ? String(draft.updatedAt) : null,
              originalFilePath: draft.originalFilePath,
              shopwareCustomerId: draft.shopwareCustomerId,
              shopwareOrderId: draft.shopwareOrderId,
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

        <DialogFooter>
          <div className="flex items-center justify-between w-full">
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending || draft.status === "created"}
              data-testid="button-delete-draft"
            >
              {t("common.delete")}
            </Button>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => onOpenChange(false)}
                data-testid="button-close"
              >
                {t("common.close")}
              </Button>
              <Button
                onClick={() => createOrderMutation.mutate()}
                disabled={!canCreateOrder || createOrderMutation.isPending}
                data-testid="button-create-order"
              >
                {createOrderMutation.isPending ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
                    {t("orderDrafts.review.creating")}
                  </>
                ) : (
                  <>
                    <ShoppingCart className="w-4 h-4 mr-2" />
                    {t("orderDrafts.review.createOrder")}
                  </>
                )}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
