import { X, FileDown, Loader2, ExternalLink, ChevronDown, ChevronRight, Package, Layers, FileSpreadsheet, FileCode2 } from "lucide-react";
import { useState, useEffect, Fragment, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { format } from "date-fns";
import { de, enUS, es } from "date-fns/locale";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { OfferStatus } from "@shared/schema";
import CpqApprovalPanel from "@/components/cpq/CpqApprovalPanel";
import OfferConfigPdfOptionsDialog from "@/components/OfferConfigPdfOptionsDialog";
import {
  buildCfgPdfSearchParams,
  loadOfferConfigPdfOptionsFromStorage,
  type OfferConfigPdfDialogState,
} from "@/lib/offerConfigPdfOptions";
import { Link } from "wouter";

interface OfferDetailModalProps {
  offerId: string | null;
  isOpen: boolean;
  onClose: () => void;
  canManage?: boolean;
  canApproveCPQ?: boolean;
  mode?: "view" | "edit";
}

interface OfferLineItemChild {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productNumber: string | null;
  coverImageUrl?: string | null;
}

interface OfferLineItem {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  productNumber: string | null;
  configurationName?: string | null;
  configurationDescription?: string | null;
  coverImageUrl?: string | null;
  children?: OfferLineItemChild[];
}

interface OfferDetail {
  id: string;
  offerNumber: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  totalAmount: number;
  netAmount: number;
  status: string;
  statusId?: string | null;
  statusLabel?: string | null;
  createdAt: string | null;
  expirationDate: string | null;
  salesChannelId: string | null;
  salesChannelName: string | null;
  lineItems: OfferLineItem[];
}

type OfferStatusMapping = Partial<Record<OfferStatus, { label: string; id?: string | null }>>;

export default function OfferDetailModal({
  offerId,
  isOpen,
  onClose,
  canManage = false,
  canApproveCPQ = false,
  mode = "view",
}: OfferDetailModalProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<boolean>(false);
  const [configPdfLoading, setConfigPdfLoading] = useState(false);
  const [configPdfOptionsOpen, setConfigPdfOptionsOpen] = useState(false);
  const [configPdfQuery, setConfigPdfQuery] = useState<string>(() =>
    buildCfgPdfSearchParams(loadOfferConfigPdfOptionsFromStorage()),
  );
  const [erpExportLoading, setErpExportLoading] = useState<null | "csv" | "xml">(null);
  const [activeTab, setActiveTab] = useState<string>("overview");
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());
  const [lastPublicShareUrl, setLastPublicShareUrl] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(mode === "edit");
  const [editValues, setEditValues] = useState({
    status: "",
    customerName: "",
    customerEmail: "",
    offerNumber: "",
    expirationDate: "",
  });

  const { data: offer, isLoading, error } = useQuery<OfferDetail>({
    queryKey: [`/api/offers/${offerId}`],
    enabled: isOpen && !!offerId,
  });

  type ShareLinkMeta = {
    active: boolean;
    linkId?: string;
    expiresAt?: string;
    createdAt?: string;
    lastAccessAt?: string | null;
  };

  const { data: shareLinkMeta } = useQuery<ShareLinkMeta>({
    queryKey: [`/api/offers/${offerId}/share-link`],
    enabled: isOpen && !!offerId,
  });

  useEffect(() => {
    setLastPublicShareUrl(null);
  }, [offerId]);

  const { data: statusMapping } = useQuery<OfferStatusMapping>({
    queryKey: ["/api/b2b/offer-status-mapping"],
  });

  const hasConfigPdf = useMemo(
    () =>
      offer?.lineItems?.some(
        (li) =>
          !!li.configurationName ||
          !!li.configurationDescription ||
          (li.children && li.children.length > 0),
      ) ?? false,
    [offer?.lineItems],
  );

  const pdfLoadGenRef = useRef(0);

  useEffect(() => {
    if (offer) {
      setEditValues({
        status: offer.status || "draft",
        customerName: offer.customerName || "",
        customerEmail: offer.customerEmail || "",
        offerNumber: offer.offerNumber || "",
        expirationDate: offer.expirationDate ? offer.expirationDate.slice(0, 10) : "",
      });
      if (mode === "edit") {
        setIsEditing(true);
      }
    }
  }, [offer, mode]);

  // Beim Verlassen des PDF-Tabs Blob freigeben, damit beim erneuten Öffnen neu geladen wird
  useEffect(() => {
    if (activeTab === "pdf" || !isOpen) return;
    setPdfError(false);
    setPdfUrl((prev) => {
      if (prev) window.URL.revokeObjectURL(prev);
      return null;
    });
  }, [activeTab, isOpen]);

  // PDF-Vorschau: zuerst Konfigurations-PDF (METAorder), sonst Shopware-PDF (falls Kunde)
  useEffect(() => {
    if (activeTab !== "pdf" || !offerId || !offer) return;

    const gen = ++pdfLoadGenRef.current;
    let cancelled = false;

    const tryFetchPdf = async (path: string): Promise<Blob | null> => {
      const response = await fetch(path, { credentials: "include" });
      if (!response.ok) return null;
      const ct = response.headers.get("content-type") || "";
      if (!ct.includes("application/pdf")) return null;
      return response.blob();
    };

    const run = async () => {
      setPdfError(false);
      setPdfUrl((prev) => {
        if (prev) window.URL.revokeObjectURL(prev);
        return null;
      });

      try {
        if (hasConfigPdf) {
          const blob = await tryFetchPdf(
            `/api/offers/${offerId}/config-pdf?${configPdfQuery}`,
          );
          if (cancelled || pdfLoadGenRef.current !== gen) return;
          if (blob) {
            setPdfUrl(window.URL.createObjectURL(blob));
            return;
          }
        }

        if (!offer.customerId) {
          if (!cancelled && pdfLoadGenRef.current === gen) setPdfError(true);
          return;
        }

        const blob = await tryFetchPdf(`/api/offers/${offerId}/pdf`);
        if (cancelled || pdfLoadGenRef.current !== gen) return;
        if (blob) {
          setPdfUrl(window.URL.createObjectURL(blob));
        } else {
          setPdfError(true);
        }
      } catch {
        if (!cancelled && pdfLoadGenRef.current === gen) setPdfError(true);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [activeTab, offerId, offer, hasConfigPdf, offer?.customerId, configPdfQuery]);

  const getDateLocale = () => {
    switch (i18n.language) {
      case 'de': return de;
      case 'es': return es;
      default: return enUS;
    }
  };

  const formatDate = (dateString: string | null | undefined) => {
    if (!dateString) return t('offerDetail.pdfNotAvailable');
    
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) {
        return t('offerDetail.pdfNotAvailable');
      }
      return format(date, "PPP", { locale: getDateLocale() });
    } catch (e) {
      return t('offerDetail.pdfNotAvailable');
    }
  };

  const formatCurrency = (amount: number | null | undefined) => {
    if (amount === null || amount === undefined) return '€0.00';
    
    try {
      return new Intl.NumberFormat(i18n.language, {
        style: 'currency',
        currency: 'EUR',
      }).format(amount);
    } catch (e) {
      return `€${amount.toFixed(2)}`;
    }
  };

  const updateOfferMutation = useMutation({
    mutationFn: async () => {
      if (!offerId) return null;
      const payload: Record<string, any> = {
        status: editValues.status,
        customerName: editValues.customerName || undefined,
        customerEmail: editValues.customerEmail || undefined,
        offerNumber: editValues.offerNumber || undefined,
        expirationDate: editValues.expirationDate || null,
      };
      const response = await apiRequest("PATCH", `/api/offers/${offerId}`, payload);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
      toast({
        title: t("offers.actions.updated"),
        description: t("offers.actions.updatedDescription"),
      });
      setIsEditing(false);
    },
    onError: (error: Error) => {
      toast({
        title: t("offers.actions.updateError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const approveOfferMutation = useMutation({
    mutationFn: async () => {
      if (!offerId) return null;
      const response = await apiRequest("POST", `/api/offers/${offerId}/approve`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
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
    mutationFn: async () => {
      if (!offerId) return null;
      const response = await apiRequest("POST", `/api/offers/${offerId}/reject`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
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

  const createShareLinkMutation = useMutation({
    mutationFn: async () => {
      if (!offerId) throw new Error("missing offer");
      const response = await apiRequest("POST", `/api/offers/${offerId}/share-link`, { expiresInDays: 30 });
      return response.json() as Promise<{ publicUrl: string; token: string; expiresAt: string }>;
    },
    onSuccess: (data) => {
      setLastPublicShareUrl(data.publicUrl);
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}/share-link`] });
      toast({ title: t("offerDetail.publicLinkCreated") });
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDetail.publicLinkError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const revokeShareLinkMutation = useMutation({
    mutationFn: async () => {
      if (!offerId) throw new Error("missing offer");
      await apiRequest("DELETE", `/api/offers/${offerId}/share-link`);
    },
    onSuccess: () => {
      setLastPublicShareUrl(null);
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}/share-link`] });
      toast({ title: t("offerDetail.publicLinkRevoked") });
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDetail.publicLinkError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string, statusLabel?: string | null) => {
    const statusKey = status.toLowerCase();
    const statusVariantMap: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
      draft: "secondary",
      submitted: "outline",
      sent: "outline",
      approved: "default",
      rejected: "destructive",
      expired: "secondary",
      offered: "outline",
      accepted: "default",
      declined: "destructive",
    };

    const mappedLabel = statusMapping?.[statusKey as keyof OfferStatusMapping]?.label;
    const label = statusLabel || mappedLabel || t(`offers.status.${statusKey}`, status);
    return (
      <Badge variant={statusVariantMap[statusKey] || "outline"} data-testid={`badge-offer-status-${statusKey}`}>
        {label}
      </Badge>
    );
  };

  const getFilterLabel = (status: keyof OfferStatusMapping) => {
    const mappedLabel = statusMapping?.[status]?.label;
    if (!mappedLabel) {
      return t(`offers.status.${status}`);
    }
    return `${t(`offers.status.${status}`)} (${mappedLabel})`;
  };

  const handleDownloadPDF = async () => {
    if (!offerId) return;

    try {
      const response = await fetch(`/api/offers/${offerId}/pdf?download=true`, {
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(
          errorData?.message || errorData?.error || "Failed to download PDF",
        );
      }

      const blob = await response.blob();
      const ct = response.headers.get("content-type") || "";
      const isPdf =
        ct.includes("application/pdf") ||
        (blob.type && blob.type.includes("pdf"));
      if (!isPdf) {
        let msg = t("offers.errors.pdfNotPdf", "Antwort ist kein PDF");
        try {
          const parsed = JSON.parse(await blob.text());
          if (parsed?.error || parsed?.message) {
            msg = String(parsed.error || parsed.message);
          }
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `offer-${offer?.offerNumber || offerId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: t('offers.downloadPDF'),
        description: t('offers.downloadPDF'),
      });
    } catch (error) {
      console.error("PDF download failed:", error);
      const errorMessage = error instanceof Error ? error.message : t('offers.errors.pdfFailed');
      toast({
        title: t('offers.errors.pdfFailed'),
        description: errorMessage,
        variant: "destructive",
      });
    }
  };

  const downloadConfigPdfWithQueryString = async (queryString: string) => {
    if (!offerId) return;
    setConfigPdfLoading(true);
    try {
      const params = new URLSearchParams(queryString);
      params.set("download", "true");
      const response = await fetch(`/api/offers/${offerId}/config-pdf?${params.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || t("offerDetail.configPdfError"));
      }
      const blob = await response.blob();
      const ct = response.headers.get("content-type") || "";
      const isPdf =
        ct.includes("application/pdf") ||
        (blob.type && blob.type.includes("pdf"));
      if (!isPdf) {
        let msg = t("offerDetail.configPdfError");
        try {
          const parsed = JSON.parse(await blob.text());
          if (parsed?.error || parsed?.message) {
            msg = String(parsed.error || parsed.message);
          }
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `angebot-konfiguration-${offer?.offerNumber || offerId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: t("offerDetail.downloadConfigPdf"),
        description: t("offerDetail.downloadConfigPdfSuccess"),
      });
    } catch (error) {
      console.error("Config PDF download failed:", error);
      toast({
        title: t("offerDetail.configPdfError"),
        description: error instanceof Error ? error.message : t("offers.errors.pdfFailed"),
        variant: "destructive",
      });
    } finally {
      setConfigPdfLoading(false);
    }
  };

  const handleConfigPdfOptionsConfirm = (opts: OfferConfigPdfDialogState) => {
    const qs = buildCfgPdfSearchParams(opts);
    setConfigPdfQuery(qs);
    void downloadConfigPdfWithQueryString(qs);
  };

  const handleDownloadErpExport = async (format: "csv" | "xml") => {
    if (!offerId) return;
    setErpExportLoading(format);
    try {
      const response = await fetch(`/api/offers/${offerId}/export.${format}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => null);
        throw new Error(errorData?.error || t("offerDetail.erpExportError"));
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `angebot-erp-${offer?.offerNumber || offerId}.${format}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      toast({
        title: t("offerDetail.erpExportSuccessTitle"),
        description:
          format === "csv"
            ? t("offerDetail.erpExportSuccessCsv")
            : t("offerDetail.erpExportSuccessXml"),
      });
    } catch (error) {
      console.error("ERP export failed:", error);
      toast({
        title: t("offerDetail.erpExportError"),
        description: error instanceof Error ? error.message : t("offers.errors.pdfFailed"),
        variant: "destructive",
      });
    } finally {
      setErpExportLoading(null);
    }
  };

  const handleClose = () => {
    // Clean up PDF URL
    if (pdfUrl) {
      window.URL.revokeObjectURL(pdfUrl);
    }
    setPdfUrl(null);
    setPdfError(false);
    setActiveTab("overview");
    setIsEditing(false);
    onClose();
  };

  if (!offer && isLoading) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('common.loading', 'Lädt...')}</DialogTitle>
            <DialogDescription className="sr-only">{t('offers.description')}</DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-center p-8">
            <Loader2 className="h-8 w-8 animate-spin" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!offer || error) {
    return (
      <Dialog open={isOpen} onOpenChange={handleClose}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t('offers.errors.loadFailed')}</DialogTitle>
            <DialogDescription className="sr-only">{t('offers.errors.loadFailed')}</DialogDescription>
          </DialogHeader>
          <Alert variant="destructive">
            <AlertDescription>
              {error instanceof Error ? error.message : t('offers.errors.loadFailed')}
            </AlertDescription>
          </Alert>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-offer-detail">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-2xl font-semibold">
                {t('offerDetail.title', { offerNumber: offer.offerNumber })}
              </DialogTitle>
              <DialogDescription className="sr-only">{t('offerDetail.offerInfo')}</DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                variant="outline"
                size="sm"
                onClick={handleDownloadPDF}
                data-testid="button-download-pdf"
              >
                <FileDown className="h-4 w-4 mr-2" />
                {t('offers.downloadPDF')}
              </Button>
              {hasConfigPdf && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfigPdfOptionsOpen(true)}
                  disabled={configPdfLoading}
                  data-testid="button-download-config-pdf"
                >
                  {configPdfLoading ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Layers className="h-4 w-4 mr-2" />
                  )}
                  {t("offerDetail.downloadConfigPdf")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadErpExport("csv")}
                disabled={erpExportLoading !== null}
                data-testid="button-download-offer-erp-csv"
                title={t("offerDetail.erpExportCsvHint")}
              >
                {erpExportLoading === "csv" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4 mr-2" />
                )}
                {t("offerDetail.downloadErpCsv")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownloadErpExport("xml")}
                disabled={erpExportLoading !== null}
                data-testid="button-download-offer-erp-xml"
                title={t("offerDetail.erpExportXmlHint")}
              >
                {erpExportLoading === "xml" ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <FileCode2 className="h-4 w-4 mr-2" />
                )}
                {t("offerDetail.downloadErpXml")}
              </Button>
              {canManage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => approveOfferMutation.mutate()}
                    disabled={approveOfferMutation.isPending || ["approved", "rejected", "expired"].includes(offer.status)}
                    data-testid="button-approve-offer"
                  >
                    {t('offers.actions.approve')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => rejectOfferMutation.mutate()}
                    disabled={rejectOfferMutation.isPending || ["rejected", "expired"].includes(offer.status)}
                    data-testid="button-reject-offer"
                  >
                    {t('offers.actions.reject')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setIsEditing((prev) => !prev)}
                    data-testid="button-toggle-edit"
                  >
                    {isEditing ? t('common.cancel') : t('common.edit')}
                  </Button>
                  {isEditing && (
                    <Button
                      size="sm"
                      onClick={() => updateOfferMutation.mutate()}
                      disabled={updateOfferMutation.isPending}
                      data-testid="button-save-offer"
                    >
                      {t('common.save')}
                    </Button>
                  )}
                </>
              )}
              {getStatusBadge(offer.status)}
            </div>
          </div>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="overview" data-testid="tab-overview">
              {t('offerDetail.overview')}
            </TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items">
              {t('offerDetail.items')}
            </TabsTrigger>
            <TabsTrigger value="pdf" data-testid="tab-pdf">
              {t('offerDetail.pdfPreview')}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-4">
            {offerId && (
              <CpqApprovalPanel
                offerId={offerId}
                canApprove={canApproveCPQ}
              />
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('offerDetail.customerInfo')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.name')}
                    </div>
                    {isEditing ? (
                      <Input
                        value={editValues.customerName}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, customerName: event.target.value }))
                        }
                        data-testid="input-customer-name"
                      />
                    ) : (
                      <div className="text-base" data-testid="text-customer-name">
                        {offer.customerName || '-'}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.email')}
                    </div>
                    {isEditing ? (
                      <Input
                        value={editValues.customerEmail}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, customerEmail: event.target.value }))
                        }
                        data-testid="input-customer-email"
                      />
                    ) : (
                      <div className="text-base" data-testid="text-customer-email">
                        {offer.customerEmail || '-'}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.phone')}
                    </div>
                    <div className="text-base" data-testid="text-customer-phone">
                      {offer.customerPhone || '-'}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('offerDetail.offerInfo')}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.offerNumber')}
                    </div>
                    {isEditing ? (
                      <Input
                        value={editValues.offerNumber}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, offerNumber: event.target.value }))
                        }
                        data-testid="input-offer-number"
                      />
                    ) : (
                      <div className="text-base font-mono" data-testid="text-offer-number">
                        {offer.offerNumber}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.offerDate')}
                    </div>
                    <div className="text-base" data-testid="text-offer-date">
                      {formatDate(offer.createdAt)}
                    </div>
                  </div>
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.expirationDate')}
                    </div>
                    {isEditing ? (
                      <Input
                        type="date"
                        value={editValues.expirationDate}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, expirationDate: event.target.value }))
                        }
                        data-testid="input-expiration-date"
                      />
                    ) : (
                      <div className="text-base" data-testid="text-expiration-date">
                        {formatDate(offer.expirationDate)}
                      </div>
                    )}
                  </div>
                  {isEditing && (
                    <>
                      <Separator />
                      <div>
                        <div className="text-sm font-medium text-muted-foreground">
                          {t('offerDetail.status')}
                        </div>
                        <Select
                          value={editValues.status}
                          onValueChange={(value) => setEditValues((prev) => ({ ...prev, status: value }))}
                        >
                          <SelectTrigger data-testid="select-offer-status">
                            <SelectValue placeholder={t('offers.filter.status')} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">{getFilterLabel("draft")}</SelectItem>
                            <SelectItem value="submitted">{getFilterLabel("submitted")}</SelectItem>
                            <SelectItem value="sent">{getFilterLabel("sent")}</SelectItem>
                            <SelectItem value="approved">{getFilterLabel("approved")}</SelectItem>
                            <SelectItem value="rejected">{getFilterLabel("rejected")}</SelectItem>
                            <SelectItem value="expired">{t('offers.status.expired')}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                  <Separator />
                  <div>
                    <div className="text-sm font-medium text-muted-foreground">
                      {t('offerDetail.status')}
                    </div>
                    <div className="mt-1">
                      {getStatusBadge(offer.status, offer.statusLabel)}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('offerDetail.totalAmount')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">
                    {t('offerDetail.net')}:
                  </span>
                  <span className="text-base font-medium" data-testid="text-net-amount">
                    {formatCurrency(offer.netAmount)}
                  </span>
                </div>
                <Separator />
                <div className="flex items-center justify-between">
                  <span className="text-base font-semibold">
                    {t('offerDetail.gross')}:
                  </span>
                  <span className="text-xl font-bold" data-testid="text-total-amount">
                    {formatCurrency(offer.totalAmount)}
                  </span>
                </div>
              </CardContent>
            </Card>

            {offer.salesChannelName && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t('offerDetail.salesChannel')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-base" data-testid="text-sales-channel">
                    {offer.salesChannelName}
                  </div>
                </CardContent>
              </Card>
            )}

            {offerId ? (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">{t("offerDetail.publicLinkTitle")}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <p className="text-muted-foreground">{t("offerDetail.publicLinkDescription")}</p>
                  {shareLinkMeta?.active ? (
                    <div className="space-y-1 rounded-md border bg-muted/30 p-3">
                      <div>
                        <span className="font-medium">{t("offerDetail.publicLinkActive")}: </span>
                        <span>{shareLinkMeta.expiresAt ? formatDate(shareLinkMeta.expiresAt) : "—"}</span>
                      </div>
                      {shareLinkMeta.lastAccessAt ? (
                        <div className="text-muted-foreground text-xs">
                          {t("offerDetail.publicLinkLastAccess")}: {formatDate(shareLinkMeta.lastAccessAt)}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-muted-foreground">{t("offerDetail.publicLinkNone")}</p>
                  )}
                  {lastPublicShareUrl ? (
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(lastPublicShareUrl).then(
                            () => toast({ title: t("offerDetail.publicLinkCopySuccess") }),
                            () => toast({ title: t("offerDetail.publicLinkError"), variant: "destructive" }),
                          );
                        }}
                      >
                        {t("offerDetail.publicLinkCopy")}
                      </Button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {canManage ? (
                      <Button
                        type="button"
                        size="sm"
                        disabled={createShareLinkMutation.isPending}
                        onClick={() => createShareLinkMutation.mutate()}
                      >
                        {createShareLinkMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin mr-2 inline" aria-hidden />
                        ) : null}
                        {t("offerDetail.publicLinkCreate")}
                      </Button>
                    ) : null}
                    {canManage && shareLinkMeta?.active ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={revokeShareLinkMutation.isPending}
                        onClick={() => revokeShareLinkMutation.mutate()}
                      >
                        {t("offerDetail.publicLinkRevoke")}
                      </Button>
                    ) : null}
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/offers/${offerId}/preview`} target="_blank" rel="noopener noreferrer">
                        {t("offerDetail.publicLinkPreview")}
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : null}
          </TabsContent>

          <TabsContent value="items" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">{t('offerDetail.offerItems')}</CardTitle>
              </CardHeader>
              <CardContent>
                {offer.lineItems && offer.lineItems.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b">
                          <th className="w-8"></th>
                          <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('products.productNumber')}
                          </th>
                          <th className="text-left py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('offerDetail.name')}
                          </th>
                          <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('offerDetail.quantity')}
                          </th>
                          <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('products.price')}
                          </th>
                          <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('offerDetail.taxRate')}
                          </th>
                          <th className="text-right py-3 px-2 text-sm font-medium text-muted-foreground">
                            {t('offerDetail.totalAmount')}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {offer.lineItems.map((item, index) => {
                          const hasChildren = item.children && item.children.length > 0;
                          const hasConfig = !!item.configurationName || !!item.configurationDescription;
                          const isExpandable = hasChildren || hasConfig;
                          const isExpanded = expandedItems.has(item.id);
                          const toggleExpand = () => {
                            setExpandedItems((prev) => {
                              const next = new Set(prev);
                              if (next.has(item.id)) {
                                next.delete(item.id);
                              } else {
                                next.add(item.id);
                              }
                              return next;
                            });
                          };

                          return (
                            <Fragment key={item.id}>
                              <tr
                                className={`border-b last:border-0 ${isExpandable ? 'cursor-pointer hover:bg-muted/50' : ''}`}
                                data-testid={`row-item-${index}`}
                                onClick={isExpandable ? toggleExpand : undefined}
                              >
                                <td className="py-3 px-1 text-center">
                                  {isExpandable ? (
                                    <button
                                      type="button"
                                      className="inline-flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground"
                                      aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
                                    >
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  ) : null}
                                </td>
                                <td className="py-3 px-2 text-sm">
                                  <div className="flex items-center gap-1.5">
                                    {isExpandable && <Package className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />}
                                    <span className="font-mono">{item.productNumber || '-'}</span>
                                  </div>
                                </td>
                                <td className="py-3 px-2 text-sm">
                                  <span>{item.label}</span>
                                  {item.configurationName && (
                                    <span className="text-xs text-muted-foreground ml-1">({item.configurationName})</span>
                                  )}
                                  {hasChildren && (
                                    <Badge variant="secondary" className="ml-2 text-[10px] px-1.5 py-0">
                                      {t('offerDetail.bomCount', { count: item.children!.length })}
                                    </Badge>
                                  )}
                                </td>
                                <td className="py-3 px-2 text-sm text-right">
                                  {item.quantity}
                                </td>
                                <td className="py-3 px-2 text-sm text-right">
                                  {formatCurrency(item.unitPrice)} {t('offerDetail.each')}
                                </td>
                                <td className="py-3 px-2 text-sm text-right">
                                  {item.taxRate}%
                                </td>
                                <td className="py-3 px-2 text-sm text-right font-medium">
                                  {formatCurrency(item.totalPrice)}
                                </td>
                              </tr>

                              {isExpanded && item.configurationDescription && (
                                <tr key={`${item.id}-config-desc`} className="bg-muted/20">
                                  <td className="py-2 px-1"></td>
                                  <td colSpan={6} className="py-2 px-2">
                                    <p className="text-xs text-muted-foreground whitespace-pre-line leading-relaxed">
                                      {item.configurationDescription}
                                    </p>
                                  </td>
                                </tr>
                              )}

                              {isExpanded && hasChildren && (
                                <tr key={`${item.id}-bom-header`} className="bg-muted/30">
                                  <td className="py-1.5 px-1"></td>
                                  <td colSpan={6} className="py-1.5 px-2">
                                    <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                      {t('offerDetail.billOfMaterials')}
                                    </span>
                                  </td>
                                </tr>
                              )}

                              {isExpanded && hasChildren && item.children!.map((child, childIdx) => (
                                <tr
                                  key={`${item.id}-child-${child.id}-${childIdx}`}
                                  className="bg-muted/30 border-b last:border-0"
                                  data-testid={`row-item-${index}-child-${childIdx}`}
                                >
                                  <td className="py-2 px-1"></td>
                                  <td className="py-2 px-2 text-xs pl-8">
                                    <span className="font-mono text-muted-foreground">{child.productNumber || '-'}</span>
                                  </td>
                                  <td className="py-2 px-2 text-xs text-muted-foreground">
                                    {child.label}
                                  </td>
                                  <td className="py-2 px-2 text-xs text-right text-muted-foreground">
                                    {child.quantity}×
                                  </td>
                                  <td className="py-2 px-2 text-xs text-right text-muted-foreground">
                                    -
                                  </td>
                                  <td className="py-2 px-2 text-xs text-right text-muted-foreground">
                                    -
                                  </td>
                                  <td className="py-2 px-2 text-xs text-right text-muted-foreground">
                                    -
                                  </td>
                                </tr>
                              ))}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    {t('offerDetail.noItems')}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="pdf" className="space-y-4">
            <Card>
              <CardContent className="p-0">
                {pdfError ? (
                  <Alert variant="destructive" className="m-4">
                    <AlertDescription>
                      {!offer?.customerId && !hasConfigPdf
                        ? t('offerDetail.pdfNotAvailableForDraft', 'PDF kann nur für Angebote mit zugeordnetem Kunden generiert werden. Dieses Angebot ist vermutlich ein Entwurf ohne Kundeninformationen.')
                        : t('offerDetail.pdfLoadingError')}
                    </AlertDescription>
                  </Alert>
                ) : pdfUrl ? (
                  <div className="w-full h-[600px]">
                    <iframe
                      src={pdfUrl}
                      className="w-full h-full border-0"
                      title={t('offerDetail.pdfPreview')}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-[600px]">
                    <Loader2 className="h-8 w-8 animate-spin" />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
    <OfferConfigPdfOptionsDialog
      open={configPdfOptionsOpen}
      onOpenChange={setConfigPdfOptionsOpen}
      onConfirm={handleConfigPdfOptionsConfirm}
    />
    </>
  );
}
