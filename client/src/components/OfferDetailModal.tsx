import { FileDown, Loader2, ChevronDown, ChevronRight, Package, Layers, FileSpreadsheet, FileCode2, Trash2 } from "lucide-react";
import { useState, useEffect, Fragment, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
import "@/styles/metaAdmin.css";

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
  /** true = Überpunkt einer Konfiguration (kein echtes Lineitem, siehe children) */
  isConfigurationGroup?: boolean;
}

interface OfferBillingAddress {
  firstName: string;
  lastName: string;
  street: string;
  zipCode: string;
  city: string;
  country: string;
  company?: string;
  phoneNumber?: string;
}

interface OfferDetail {
  id: string;
  offerNumber: string;
  customerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerNumber: string | null;
  billingAddress: OfferBillingAddress | null;
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
  const [sendEmailOpen, setSendEmailOpen] = useState(false);
  const [sendEmailTo, setSendEmailTo] = useState("");
  const [sendEmailMessage, setSendEmailMessage] = useState("");
  const [isEditing, setIsEditing] = useState(mode === "edit");
  const [editValues, setEditValues] = useState({
    status: "",
    customerName: "",
    customerEmail: "",
    offerNumber: "",
    expirationDate: "",
  });
  const [servicePanelOpen, setServicePanelOpen] = useState(false);
  const [selectedServiceProductNumber, setSelectedServiceProductNumber] = useState<string>("");
  const [servicePriceInput, setServicePriceInput] = useState<string>("");
  const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);

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
      setSendEmailTo((prev) => prev || offer.customerEmail || "");
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

  type MontageSuggestion = {
    installationMinutes: number;
    blocks: number;
    net: number;
    description: string;
    productNumber: string;
    productName: string;
  };
  type ServiceProduct = {
    productNumber: string;
    productId: string;
    name: string;
    priceNet: number;
    taxRate: number;
    serviceType: string;
  };

  const { data: serviceCatalogData, isLoading: serviceCatalogLoading } = useQuery<{ services: ServiceProduct[] }>({
    queryKey: [`/api/offers/${offerId}/service-catalog`],
    enabled: isOpen && !!offerId && servicePanelOpen,
  });
  const serviceCatalog = serviceCatalogData?.services ?? [];
  const selectedService = serviceCatalog.find((s) => s.productNumber === selectedServiceProductNumber) ?? null;
  const isMontageSelected = selectedServiceProductNumber === "SW10002";

  const { data: montageSuggestion, isLoading: montageSuggestionLoading } = useQuery<MontageSuggestion>({
    queryKey: [`/api/offers/${offerId}/montage-suggestion`],
    enabled: isOpen && !!offerId && servicePanelOpen && isMontageSelected,
  });

  useEffect(() => {
    if (!selectedServiceProductNumber) return;
    if (isMontageSelected) {
      if (montageSuggestion) setServicePriceInput(montageSuggestion.net.toFixed(2));
    } else if (selectedService) {
      setServicePriceInput(selectedService.priceNet.toFixed(2));
    }
  }, [selectedServiceProductNumber, isMontageSelected, montageSuggestion, selectedService]);

  const addServiceMutation = useMutation({
    mutationFn: async () => {
      if (!offerId || !selectedServiceProductNumber) return null;
      const unitPriceNet = Number(servicePriceInput.replace(",", "."));
      const response = await apiRequest("POST", `/api/offers/${offerId}/service-line-item`, {
        productNumber: selectedServiceProductNumber,
        unitPriceNet,
        quantity: 1,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
      toast({ title: t("offerDetail.serviceAdded", "Position hinzugefügt") });
      setServicePanelOpen(false);
      setSelectedServiceProductNumber("");
      setServicePriceInput("");
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDetail.serviceAddError", "Position konnte nicht hinzugefügt werden"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const removeLineItemMutation = useMutation({
    mutationFn: async (itemId: string) => {
      if (!offerId) return null;
      const response = await apiRequest("DELETE", `/api/offers/${offerId}/line-items/${itemId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/offers"] });
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}`] });
      toast({ title: t("offerDetail.itemRemoved", "Position entfernt") });
      setConfirmDeleteItemId(null);
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDetail.itemRemoveError", "Position konnte nicht entfernt werden"),
        description: error.message,
        variant: "destructive",
      });
      setConfirmDeleteItemId(null);
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

  const sendOfferEmailMutation = useMutation({
    mutationFn: async () => {
      if (!offerId) throw new Error("missing offer");
      const response = await apiRequest("POST", `/api/offers/${offerId}/send-email`, {
        to: sendEmailTo.trim() || undefined,
        message: sendEmailMessage.trim() || undefined,
      });
      return response.json() as Promise<{ sentTo: string; publicUrl: string }>;
    },
    onSuccess: (data) => {
      setLastPublicShareUrl(data.publicUrl);
      setSendEmailOpen(false);
      setSendEmailMessage("");
      queryClient.invalidateQueries({ queryKey: [`/api/offers/${offerId}/share-link`] });
      toast({ title: t("offerDetail.sendEmailSuccess"), description: data.sentTo });
    },
    onError: (error: Error) => {
      toast({
        title: t("offerDetail.sendEmailError"),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const getStatusBadge = (status: string, statusLabel?: string | null) => {
    const statusKey = status.toLowerCase();
    const statusClassMap: Record<string, string> = {
      draft: "b-outline",
      submitted: "b-warning",
      sent: "b-warning",
      approved: "b-success",
      rejected: "b-destructive",
      expired: "b-outline",
      offered: "b-warning",
      accepted: "b-success",
      declined: "b-destructive",
    };

    const mappedLabel = statusMapping?.[statusKey as keyof OfferStatusMapping]?.label;
    const label = statusLabel || mappedLabel || t(`offers.status.${statusKey}`, status);
    return (
      <span
        className={`mbadge ${statusClassMap[statusKey] || "b-outline"}`}
        data-testid={`badge-offer-status-${statusKey}`}
      >
        {label}
      </span>
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
        <DialogContent className="max-w-4xl madmin" style={{ borderRadius: 2, boxShadow: "none", borderColor: "var(--meta-steel)" }}>
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
        <DialogContent className="max-w-4xl madmin" style={{ borderRadius: 2, boxShadow: "none", borderColor: "var(--meta-steel)" }}>
          <DialogHeader>
            <DialogTitle>{t('offers.errors.loadFailed')}</DialogTitle>
            <DialogDescription className="sr-only">{t('offers.errors.loadFailed')}</DialogDescription>
          </DialogHeader>
          <div className="malert destructive">
            {error instanceof Error ? error.message : t('offers.errors.loadFailed')}
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto madmin" data-testid="modal-offer-detail" style={{ borderRadius: 2, boxShadow: "none", borderColor: "var(--meta-steel)" }}>
        <DialogHeader>
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0" style={{ paddingTop: 6 }}>
              <DialogTitle asChild>
                <h2 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
                  {t('offerDetail.title', { offerNumber: offer.offerNumber })}
                </h2>
              </DialogTitle>
              <DialogDescription className="sr-only">{t('offerDetail.offerInfo')}</DialogDescription>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                className="mbtn sm"
                onClick={handleDownloadPDF}
                data-testid="button-download-pdf"
              >
                <FileDown className="h-4 w-4" />
                {t('offers.downloadPDF')}
              </button>
              {hasConfigPdf && (
                <button
                  type="button"
                  className="mbtn sm"
                  onClick={() => setConfigPdfOptionsOpen(true)}
                  disabled={configPdfLoading}
                  data-testid="button-download-config-pdf"
                >
                  {configPdfLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Layers className="h-4 w-4" />
                  )}
                  {t("offerDetail.downloadConfigPdf")}
                </button>
              )}
              <button
                type="button"
                className="mbtn sm"
                onClick={() => handleDownloadErpExport("csv")}
                disabled={erpExportLoading !== null}
                data-testid="button-download-offer-erp-csv"
                title={t("offerDetail.erpExportCsvHint")}
              >
                {erpExportLoading === "csv" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                {t("offerDetail.downloadErpCsv")}
              </button>
              <button
                type="button"
                className="mbtn sm"
                onClick={() => handleDownloadErpExport("xml")}
                disabled={erpExportLoading !== null}
                data-testid="button-download-offer-erp-xml"
                title={t("offerDetail.erpExportXmlHint")}
              >
                {erpExportLoading === "xml" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileCode2 className="h-4 w-4" />
                )}
                {t("offerDetail.downloadErpXml")}
              </button>
              {canManage && (
                <>
                  <button
                    type="button"
                    className="mbtn sm"
                    onClick={() => approveOfferMutation.mutate()}
                    disabled={approveOfferMutation.isPending || ["approved", "rejected", "expired"].includes(offer.status)}
                    data-testid="button-approve-offer"
                  >
                    {t('offers.actions.approve')}
                  </button>
                  <button
                    type="button"
                    className="mbtn sm destructive"
                    onClick={() => rejectOfferMutation.mutate()}
                    disabled={rejectOfferMutation.isPending || ["rejected", "expired"].includes(offer.status)}
                    data-testid="button-reject-offer"
                  >
                    {t('offers.actions.reject')}
                  </button>
                  <button
                    type="button"
                    className="mbtn sm"
                    onClick={() => setIsEditing((prev) => !prev)}
                    data-testid="button-toggle-edit"
                  >
                    {isEditing ? t('common.cancel') : t('common.edit')}
                  </button>
                  {isEditing && (
                    <button
                      type="button"
                      className="mbtn sm primary"
                      onClick={() => updateOfferMutation.mutate()}
                      disabled={updateOfferMutation.isPending}
                      data-testid="button-save-offer"
                    >
                      {t('common.save')}
                    </button>
                  )}
                </>
              )}
              {getStatusBadge(offer.status)}
            </div>
          </div>
        </DialogHeader>

        <div className="mtabs-list">
          <button
            type="button"
            className={`mtab ${activeTab === "overview" ? "active" : ""}`}
            onClick={() => setActiveTab("overview")}
            data-testid="tab-overview"
          >
            {t('offerDetail.overview')}
          </button>
          <button
            type="button"
            className={`mtab ${activeTab === "items" ? "active" : ""}`}
            onClick={() => setActiveTab("items")}
            data-testid="tab-items"
          >
            {t('offerDetail.items')}
          </button>
          <button
            type="button"
            className={`mtab ${activeTab === "pdf" ? "active" : ""}`}
            onClick={() => setActiveTab("pdf")}
            data-testid="tab-pdf"
          >
            {t('offerDetail.pdfPreview')}
          </button>
        </div>

        {activeTab === "overview" && (
          <div className="space-y-4" style={{ marginTop: 16 }}>
            {offerId && (
              <CpqApprovalPanel
                offerId={offerId}
                canApprove={canApproveCPQ}
              />
            )}
            <div className="mgrid-2">
              <div className="mcard">
                <div className="mcard-head">
                  <h3 className="mcard-title">{t('offerDetail.customerInfo')}</h3>
                </div>
                <div className="mcard-body">
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.name')}
                    </div>
                    {isEditing ? (
                      <input
                        className="minput"
                        value={editValues.customerName}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, customerName: event.target.value }))
                        }
                        data-testid="input-customer-name"
                      />
                    ) : (
                      <div className="mfield-value" data-testid="text-customer-name">
                        {offer.customerName || '-'}
                      </div>
                    )}
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.email')}
                    </div>
                    {isEditing ? (
                      <input
                        className="minput"
                        value={editValues.customerEmail}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, customerEmail: event.target.value }))
                        }
                        data-testid="input-customer-email"
                      />
                    ) : (
                      <div className="mfield-value" data-testid="text-customer-email">
                        {offer.customerEmail || '-'}
                      </div>
                    )}
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.phone')}
                    </div>
                    <div className="mfield-value" data-testid="text-customer-phone">
                      {offer.customerPhone || '-'}
                    </div>
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.customerNumber')}
                    </div>
                    <div className="mfield-value" data-testid="text-customer-number">
                      {offer.customerNumber || '-'}
                    </div>
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.address')}
                    </div>
                    <div className="mfield-value" data-testid="text-customer-address">
                      {offer.billingAddress ? (
                        <>
                          {offer.billingAddress.company && <div>{offer.billingAddress.company}</div>}
                          {(offer.billingAddress.firstName || offer.billingAddress.lastName) && (
                            <div>{[offer.billingAddress.firstName, offer.billingAddress.lastName].filter(Boolean).join(' ')}</div>
                          )}
                          {offer.billingAddress.street && <div>{offer.billingAddress.street}</div>}
                          {(offer.billingAddress.zipCode || offer.billingAddress.city) && (
                            <div>{[offer.billingAddress.zipCode, offer.billingAddress.city].filter(Boolean).join(' ')}</div>
                          )}
                          {offer.billingAddress.country && <div>{offer.billingAddress.country}</div>}
                        </>
                      ) : (
                        '-'
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mcard">
                <div className="mcard-head">
                  <h3 className="mcard-title">{t('offerDetail.offerInfo')}</h3>
                </div>
                <div className="mcard-body">
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.offerNumber')}
                    </div>
                    {isEditing ? (
                      <input
                        className="minput"
                        value={editValues.offerNumber}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, offerNumber: event.target.value }))
                        }
                        data-testid="input-offer-number"
                      />
                    ) : (
                      <div className="mfield-value mono" data-testid="text-offer-number">
                        {offer.offerNumber}
                      </div>
                    )}
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.offerDate')}
                    </div>
                    <div className="mfield-value" data-testid="text-offer-date">
                      {formatDate(offer.createdAt)}
                    </div>
                  </div>
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.expirationDate')}
                    </div>
                    {isEditing ? (
                      <input
                        type="date"
                        className="minput"
                        value={editValues.expirationDate}
                        onChange={(event) =>
                          setEditValues((prev) => ({ ...prev, expirationDate: event.target.value }))
                        }
                        data-testid="input-expiration-date"
                      />
                    ) : (
                      <div className="mfield-value" data-testid="text-expiration-date">
                        {formatDate(offer.expirationDate)}
                      </div>
                    )}
                  </div>
                  {isEditing && (
                    <>
                      <div className="mhr" />
                      <div>
                        <div className="mfield-label">
                          {t('offerDetail.status')}
                        </div>
                        <select
                          className="minput"
                          value={editValues.status}
                          onChange={(event) => setEditValues((prev) => ({ ...prev, status: event.target.value }))}
                          data-testid="select-offer-status"
                        >
                          <option value="draft">{getFilterLabel("draft")}</option>
                          <option value="submitted">{getFilterLabel("submitted")}</option>
                          <option value="sent">{getFilterLabel("sent")}</option>
                          <option value="approved">{getFilterLabel("approved")}</option>
                          <option value="rejected">{getFilterLabel("rejected")}</option>
                          <option value="expired">{t('offers.status.expired')}</option>
                        </select>
                      </div>
                    </>
                  )}
                  <div className="mhr" />
                  <div>
                    <div className="mfield-label">
                      {t('offerDetail.status')}
                    </div>
                    <div className="mt-1">
                      {getStatusBadge(offer.status, offer.statusLabel)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="mcard">
              <div className="mcard-head">
                <h3 className="mcard-title">{t('offerDetail.totalAmount')}</h3>
              </div>
              <div className="mcard-body">
                <div className="flex items-center justify-between">
                  <span className="mfield-label">
                    {t('offerDetail.net')}
                  </span>
                  <span className="mfield-value" data-testid="text-net-amount">
                    {formatCurrency(offer.netAmount)}
                  </span>
                </div>
                <div className="mhr" />
                <div className="flex items-center justify-between">
                  <span style={{ fontSize: 14, fontWeight: 700 }}>
                    {t('offerDetail.gross')}
                  </span>
                  <span style={{ fontFamily: "var(--font-cn)", fontSize: 22, fontWeight: 800 }} data-testid="text-total-amount">
                    {formatCurrency(offer.totalAmount)}
                  </span>
                </div>
              </div>
            </div>

            {offer.salesChannelName && (
              <div className="mcard">
                <div className="mcard-head">
                  <h3 className="mcard-title">{t('offerDetail.salesChannel')}</h3>
                </div>
                <div className="mcard-body">
                  <div className="mfield-value" data-testid="text-sales-channel">
                    {offer.salesChannelName}
                  </div>
                </div>
              </div>
            )}

            {offerId ? (
              <div className="mcard">
                <div className="mcard-head">
                  <h3 className="mcard-title">{t("offerDetail.publicLinkTitle")}</h3>
                </div>
                <div className="mcard-body space-y-3 text-sm">
                  <p style={{ color: "var(--fg-3)" }}>{t("offerDetail.publicLinkDescription")}</p>
                  {shareLinkMeta?.active ? (
                    <div style={{ border: "1px solid var(--meta-steel)", background: "var(--meta-mist)", padding: 12 }}>
                      <div>
                        <span style={{ fontWeight: 700 }}>{t("offerDetail.publicLinkActive")}: </span>
                        <span>{shareLinkMeta.expiresAt ? formatDate(shareLinkMeta.expiresAt) : "—"}</span>
                      </div>
                      {shareLinkMeta.lastAccessAt ? (
                        <div style={{ color: "var(--fg-3)", fontSize: 11 }}>
                          {t("offerDetail.publicLinkLastAccess")}: {formatDate(shareLinkMeta.lastAccessAt)}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p style={{ color: "var(--fg-3)" }}>{t("offerDetail.publicLinkNone")}</p>
                  )}
                  {lastPublicShareUrl ? (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="mbtn sm"
                        onClick={() => {
                          void navigator.clipboard.writeText(lastPublicShareUrl).then(
                            () => toast({ title: t("offerDetail.publicLinkCopySuccess") }),
                            () => toast({ title: t("offerDetail.publicLinkError"), variant: "destructive" }),
                          );
                        }}
                      >
                        {t("offerDetail.publicLinkCopy")}
                      </button>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2">
                    {canManage ? (
                      <button
                        type="button"
                        className="mbtn sm primary"
                        disabled={createShareLinkMutation.isPending}
                        onClick={() => createShareLinkMutation.mutate()}
                      >
                        {createShareLinkMutation.isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                        ) : null}
                        {t("offerDetail.publicLinkCreate")}
                      </button>
                    ) : null}
                    {canManage && shareLinkMeta?.active ? (
                      <button
                        type="button"
                        className="mbtn sm"
                        disabled={revokeShareLinkMutation.isPending}
                        onClick={() => revokeShareLinkMutation.mutate()}
                      >
                        {t("offerDetail.publicLinkRevoke")}
                      </button>
                    ) : null}
                    <Link href={`/offers/${offerId}/preview`} target="_blank" rel="noopener noreferrer" className="mbtn sm">
                        {t("offerDetail.publicLinkPreview")}
                      </Link>
                  </div>
                </div>
              </div>
            ) : null}

            {offerId && canManage ? (
              <div className="mcard">
                <div className="mcard-head">
                  <h3 className="mcard-title">{t("offerDetail.sendEmailTitle")}</h3>
                </div>
                <div className="mcard-body space-y-3 text-sm">
                  <p style={{ color: "var(--fg-3)" }}>{t("offerDetail.sendEmailDescription")}</p>
                  {sendEmailOpen ? (
                    <div className="space-y-3">
                      <div>
                        <label className="mfield-label">{t("offerDetail.email")}</label>
                        <input
                          className="minput"
                          type="email"
                          value={sendEmailTo}
                          onChange={(event) => setSendEmailTo(event.target.value)}
                          placeholder="kunde@beispiel.de"
                          data-testid="input-send-email-to"
                        />
                      </div>
                      <div>
                        <label className="mfield-label">{t("offerDetail.sendEmailMessage")}</label>
                        <textarea
                          className="minput"
                          rows={3}
                          value={sendEmailMessage}
                          onChange={(event) => setSendEmailMessage(event.target.value)}
                          placeholder={t("offerDetail.sendEmailMessagePlaceholder")}
                          data-testid="textarea-send-email-message"
                        />
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="mbtn sm primary"
                          disabled={sendOfferEmailMutation.isPending || !sendEmailTo.trim()}
                          onClick={() => sendOfferEmailMutation.mutate()}
                          data-testid="button-send-email-confirm"
                        >
                          {sendOfferEmailMutation.isPending ? (
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                          ) : null}
                          {t("offerDetail.sendEmailSend")}
                        </button>
                        <button
                          type="button"
                          className="mbtn sm"
                          disabled={sendOfferEmailMutation.isPending}
                          onClick={() => setSendEmailOpen(false)}
                        >
                          {t("offerDetail.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      className="mbtn sm primary"
                      onClick={() => setSendEmailOpen(true)}
                      data-testid="button-send-email-open"
                    >
                      {t("offerDetail.sendEmailOpen")}
                    </button>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {activeTab === "items" && (
          <div className="space-y-4" style={{ marginTop: 16 }}>
            <div className="mcard">
              <div className="mcard-head">
                <h3 className="mcard-title">{t('offerDetail.offerItems')}</h3>
              </div>
              <div className="mcard-body tight">
                {offer.lineItems && offer.lineItems.length > 0 ? (
                  <div className="mtable-wrap" style={{ border: "none" }}>
                    <table className="mtable">
                      <thead>
                        <tr>
                          <th className="w-8"></th>
                          <th>
                            {t('products.productNumber')}
                          </th>
                          <th>
                            {t('offerDetail.name')}
                          </th>
                          <th className="num">
                            {t('offerDetail.quantity')}
                          </th>
                          <th className="num">
                            {t('products.price')}
                          </th>
                          <th className="num">
                            {t('offerDetail.taxRate')}
                          </th>
                          <th className="num">
                            {t('offerDetail.totalAmount')}
                          </th>
                          <th className="w-8"></th>
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
                                className={isExpandable ? 'clickable' : undefined}
                                data-testid={`row-item-${index}`}
                                onClick={isExpandable ? toggleExpand : undefined}
                              >
                                <td className="text-center">
                                  {isExpandable ? (
                                    <button
                                      type="button"
                                      className="mbtn icon ghost"
                                      aria-label={isExpanded ? t('common.collapse') : t('common.expand')}
                                    >
                                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                    </button>
                                  ) : null}
                                </td>
                                <td>
                                  <div className="flex items-center gap-1.5">
                                    {item.isConfigurationGroup ? (
                                      <Layers className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--fg-3)" }} />
                                    ) : isExpandable ? (
                                      <Package className="h-3.5 w-3.5 flex-shrink-0" style={{ color: "var(--fg-3)" }} />
                                    ) : null}
                                    <span style={{ fontFamily: "var(--font-mono, monospace)" }}>{item.productNumber || '-'}</span>
                                  </div>
                                </td>
                                <td>
                                  <span className={item.isConfigurationGroup ? 'font-medium' : undefined}>{item.label}</span>
                                  {item.configurationName && !item.isConfigurationGroup && (
                                    <span className="text-xs ml-1" style={{ color: "var(--fg-3)" }}>({item.configurationName})</span>
                                  )}
                                  {hasChildren && (
                                    <span className="mbadge b-outline" style={{ marginLeft: 8 }}>
                                      {t('offerDetail.bomCount', { count: item.children!.length })}
                                    </span>
                                  )}
                                </td>
                                <td className="num">
                                  {item.isConfigurationGroup ? '–' : item.quantity}
                                </td>
                                <td className="num">
                                  {item.isConfigurationGroup ? '–' : `${formatCurrency(item.unitPrice)} ${t('offerDetail.each')}`}
                                </td>
                                <td className="num">
                                  {item.isConfigurationGroup ? '–' : `${item.taxRate}%`}
                                </td>
                                <td className="num" style={{ fontWeight: 700 }}>
                                  {formatCurrency(item.totalPrice)}
                                </td>
                                <td className="text-center" onClick={(e) => e.stopPropagation()}>
                                  {canManage && !item.isConfigurationGroup && (
                                    confirmDeleteItemId === item.id ? (
                                      <div className="flex items-center justify-center gap-1" style={{ whiteSpace: "nowrap" }}>
                                        <span className="text-xs" style={{ color: "var(--fg-3)" }}>
                                          {t('offerDetail.confirmRemoveItem', 'Wirklich entfernen?')}
                                        </span>
                                        <button
                                          type="button"
                                          className="mbtn icon ghost"
                                          aria-label={t('common.confirm', 'Bestätigen')}
                                          disabled={removeLineItemMutation.isPending}
                                          onClick={() => removeLineItemMutation.mutate(item.id)}
                                          style={{ color: "var(--meta-red-text, #c0392b)" }}
                                        >
                                          {removeLineItemMutation.isPending && removeLineItemMutation.variables === item.id ? (
                                            <Loader2 className="h-4 w-4 animate-spin" />
                                          ) : (
                                            <Trash2 className="h-4 w-4" />
                                          )}
                                        </button>
                                        <button
                                          type="button"
                                          className="mbtn icon ghost"
                                          aria-label={t('common.cancel')}
                                          disabled={removeLineItemMutation.isPending}
                                          onClick={() => setConfirmDeleteItemId(null)}
                                        >
                                          ✕
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        type="button"
                                        className="mbtn icon ghost"
                                        aria-label={t('common.delete')}
                                        onClick={() => setConfirmDeleteItemId(item.id)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    )
                                  )}
                                </td>
                              </tr>

                              {isExpanded && item.configurationDescription && (
                                <tr key={`${item.id}-config-desc`} style={{ background: "var(--meta-mist)" }}>
                                  <td></td>
                                  <td colSpan={7}>
                                    <p className="text-xs whitespace-pre-line leading-relaxed" style={{ color: "var(--fg-3)" }}>
                                      {item.configurationDescription}
                                    </p>
                                  </td>
                                </tr>
                              )}

                              {isExpanded && hasChildren && (
                                <tr key={`${item.id}-bom-header`} style={{ background: "var(--meta-mist)" }}>
                                  <td></td>
                                  <td colSpan={7}>
                                    <span className="mfield-label">
                                      {t('offerDetail.billOfMaterials')}
                                    </span>
                                  </td>
                                </tr>
                              )}

                              {isExpanded && hasChildren && item.children!.map((child, childIdx) => {
                                const childHasPrice = child.unitPrice > 0 || child.totalPrice > 0;
                                return (
                                <tr
                                  key={`${item.id}-child-${child.id}-${childIdx}`}
                                  style={{ background: "var(--meta-mist)" }}
                                  data-testid={`row-item-${index}-child-${childIdx}`}
                                >
                                  <td></td>
                                  <td className="text-xs" style={{ paddingLeft: 32 }}>
                                    <span style={{ fontFamily: "var(--font-mono, monospace)", color: "var(--fg-3)" }}>{child.productNumber || '-'}</span>
                                  </td>
                                  <td className="text-xs" style={{ color: "var(--fg-3)" }}>
                                    {child.label}
                                  </td>
                                  <td className="num text-xs" style={{ color: "var(--fg-3)" }}>
                                    {child.quantity}×
                                  </td>
                                  <td className="num text-xs" style={{ color: "var(--fg-3)" }}>
                                    {childHasPrice ? `${formatCurrency(child.unitPrice)} ${t('offerDetail.each')}` : '-'}
                                  </td>
                                  <td className="num text-xs" style={{ color: "var(--fg-3)" }}>
                                    -
                                  </td>
                                  <td className="num text-xs" style={{ color: "var(--fg-3)" }}>
                                    {childHasPrice ? formatCurrency(child.totalPrice) : '-'}
                                  </td>
                                  <td></td>
                                </tr>
                                );
                              })}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-8" style={{ color: "var(--fg-3)" }}>
                    {t('offerDetail.noItems')}
                  </div>
                )}

                {canManage && (
                  <div style={{ marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}>
                    {!servicePanelOpen ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="mbtn"
                          onClick={() => setServicePanelOpen(true)}
                        >
                          {t('offerDetail.addService', 'Zusatzleistung hinzufügen')}
                        </button>
                        {offerId && (
                          <button
                            type="button"
                            className="mbtn"
                            onClick={() => window.open(`/configurator?offerId=${encodeURIComponent(offerId)}`, "_blank", "noopener")}
                          >
                            {t('offerDetail.addConfiguration', 'Konfiguration hinzufügen')}
                          </button>
                        )}
                        {offerId && (
                          <button
                            type="button"
                            className="mbtn"
                            onClick={() => window.open(`/room-planner?offerId=${encodeURIComponent(offerId)}`, "_blank", "noopener")}
                          >
                            {t('offerDetail.roomPlanner', 'Raumplanung')}
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2" style={{ maxWidth: 420 }}>
                        <div className="flex items-center gap-2">
                          <label className="mfield-label" style={{ margin: 0 }}>
                            {t('offerDetail.serviceType', 'Leistung')}
                          </label>
                          <select
                            className="minput"
                            style={{ width: 260 }}
                            value={selectedServiceProductNumber}
                            onChange={(e) => { setSelectedServiceProductNumber(e.target.value); setServicePriceInput(""); }}
                            disabled={serviceCatalogLoading}
                          >
                            <option value="">
                              {serviceCatalogLoading ? t('common.loading', 'Lädt…') : t('offerDetail.selectService', 'Bitte wählen…')}
                            </option>
                            {serviceCatalog.map((s) => (
                              <option key={s.productNumber} value={s.productNumber}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        </div>

                        {selectedServiceProductNumber && (
                          <>
                            {isMontageSelected && (
                              montageSuggestionLoading ? (
                                <div className="flex items-center gap-2 text-sm" style={{ color: "var(--fg-3)" }}>
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                  {t('offerDetail.montageCalculating', 'Montagepreis wird berechnet…')}
                                </div>
                              ) : montageSuggestion ? (
                                <p className="text-xs" style={{ color: "var(--fg-3)" }}>
                                  {montageSuggestion.description}
                                </p>
                              ) : null
                            )}
                            <div className="flex items-center gap-2">
                              <label className="mfield-label" style={{ margin: 0 }}>
                                {t('offerDetail.serviceNetPrice', 'Preis netto (€)')}
                              </label>
                              <input
                                type="number"
                                step="0.01"
                                min="0"
                                className="minput"
                                style={{ width: 120 }}
                                value={servicePriceInput}
                                onChange={(e) => setServicePriceInput(e.target.value)}
                              />
                            </div>
                          </>
                        )}

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            className="mbtn primary"
                            disabled={addServiceMutation.isPending || !selectedServiceProductNumber || !servicePriceInput}
                            onClick={() => addServiceMutation.mutate()}
                          >
                            {addServiceMutation.isPending ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              t('offerDetail.serviceConfirmAdd', 'Als Position hinzufügen')
                            )}
                          </button>
                          <button
                            type="button"
                            className="mbtn ghost"
                            onClick={() => { setServicePanelOpen(false); setSelectedServiceProductNumber(""); setServicePriceInput(""); }}
                          >
                            {t('common.cancel')}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === "pdf" && (
          <div className="space-y-4" style={{ marginTop: 16 }}>
            <div className="mcard">
              <div className="mcard-body tight">
                {pdfError ? (
                  <div className="malert destructive" style={{ margin: 16 }}>
                    {!offer?.customerId && !hasConfigPdf
                      ? t('offerDetail.pdfNotAvailableForDraft', 'PDF kann nur für Angebote mit zugeordnetem Kunden generiert werden. Dieses Angebot ist vermutlich ein Entwurf ohne Kundeninformationen.')
                      : t('offerDetail.pdfLoadingError')}
                  </div>
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
              </div>
            </div>
          </div>
        )}
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
