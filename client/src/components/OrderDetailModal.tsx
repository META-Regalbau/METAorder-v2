import { X, FileDown, Loader2, Ticket, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import StatusBadge from "./StatusBadge";
import ShippingInfoForm from "./ShippingInfoForm";
import AdminDocumentForm from "./AdminDocumentForm";
import InstallmentPlanSection from "./InstallmentPlanSection";
import InstallmentPlanDialog from "./InstallmentPlanDialog";
import CreateTicketDialog from "./CreateTicketDialog";
import TicketDetailModal from "./TicketDetailModal";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Order, OrderAddress, Ticket as TicketType, Role } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { apiRequest, queryClient } from "@/lib/queryClient";

function formatSettlementAmountDe(n: number): string {
  return new Intl.NumberFormat("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Parst deutsche Betragsstrings (z. B. "3.715,18"); einfaches replace(",", ".") liefert 3.715 statt 3715,18. */
function parseGermanAmountInput(raw: string): number {
  const s = raw.trim().replace(/\s/g, "");
  if (!s) return NaN;
  if (s.includes(",")) {
    const normalized = s.replace(/\./g, "").replace(",", ".");
    const n = parseFloat(normalized);
    return Number.isFinite(n) ? n : NaN;
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : NaN;
}

type AdditionalInvoiceItemForm = {
  description: string;
  quantity: string;
  unitNetPrice: string;
  vatRate: "0" | "7" | "19";
};

function createDefaultAdditionalInvoiceItem(description: string): AdditionalInvoiceItemForm {
  return {
    description,
    quantity: "1",
    unitNetPrice: "0,00",
    vatRate: "19",
  };
}

function formatAddressMultiline(addr: OrderAddress, phonePrefix: string): string {
  const lines: string[] = [];
  if (addr.company?.trim()) lines.push(addr.company.trim());
  const name = [addr.firstName, addr.lastName].filter((p) => p?.trim()).join(" ");
  if (name) lines.push(name);
  if (addr.street?.trim()) lines.push(addr.street.trim());
  const cityLine = [addr.zipCode, addr.city].filter((p) => p?.trim()).join(" ");
  if (cityLine) lines.push(cityLine);
  if (addr.country?.trim()) lines.push(addr.country.trim());
  if (addr.phoneNumber?.trim()) lines.push(`${phonePrefix}: ${addr.phoneNumber.trim()}`);
  return lines.join("\n");
}

interface OrderDetailModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  userRole: "employee" | "admin";
  userPermissions?: Role['permissions'];
  canManageCrm?: boolean;
  canApproveCrm?: boolean;
  hasDuplicate?: boolean;
  onUpdateShipping: (orderId: string, data: any) => void;
  onUpdateDocuments: (orderId: string, data: any) => void;
}

export default function OrderDetailModal({
  order,
  isOpen,
  onClose,
  userRole,
  userPermissions,
  canManageCrm = false,
  canApproveCrm = false,
  hasDuplicate = false,
  onUpdateShipping,
  onUpdateDocuments,
}: OrderDetailModalProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [isCreateTicketDialogOpen, setIsCreateTicketDialogOpen] = useState(false);
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [isTicketDetailOpen, setIsTicketDetailOpen] = useState(false);
  const [isAssignDialogOpen, setIsAssignDialogOpen] = useState(false);
  const [assignedToUserId, setAssignedToUserId] = useState("");
  const [assignmentReason, setAssignmentReason] = useState("");
  const [installmentDialogOpen, setInstallmentDialogOpen] = useState(false);

  const [settlementInvoiceNumber, setSettlementInvoiceNumber] = useState("");
  const [settlementOriginalNumber, setSettlementOriginalNumber] = useState("");
  const [settlementOriginalAmount, setSettlementOriginalAmount] = useState("");
  const [settlementStornoNumber, setSettlementStornoNumber] = useState("");
  const [settlementStornoAmount, setSettlementStornoAmount] = useState("");
  const [settlementInvoiceDate, setSettlementInvoiceDate] = useState("");

  const [additionalInvoiceNumber, setAdditionalInvoiceNumber] = useState("");
  const [additionalInvoiceDate, setAdditionalInvoiceDate] = useState("");
  const [additionalReferenceNumber, setAdditionalReferenceNumber] = useState("");
  const [additionalInvoiceNote, setAdditionalInvoiceNote] = useState("");
  const [additionalInvoiceItems, setAdditionalInvoiceItems] = useState<AdditionalInvoiceItemForm[]>([
    createDefaultAdditionalInvoiceItem(""),
  ]);

  /** Gleiche Basis wie Tab „Dokumente“: Admin oder explizite Dokumenten-Rechte */
  const canAccessOrderDocuments =
    userRole === "admin" ||
    !!userPermissions?.viewDocuments ||
    !!userPermissions?.manageDocuments;
  const canManageInstallments = userRole === "admin" || !!userPermissions?.manageDocuments;
  const canManageSettlementPdf =
    userRole === "admin" || !!userPermissions?.manageDocuments;
  const canManageAdditionalInvoice = canManageSettlementPdf;

  const additionalInvoiceTotals = useMemo(() => {
    let net = 0;
    let gross = 0;
    const vatByRate: Partial<Record<0 | 7 | 19, number>> = {};
    for (const item of additionalInvoiceItems) {
      const qty = parseFloat(item.quantity.trim().replace(",", "."));
      const unitNet = parseGermanAmountInput(item.unitNetPrice);
      const vatRate = Number(item.vatRate) as 0 | 7 | 19;
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(unitNet) || unitNet < 0) {
        continue;
      }
      const lineNet = Math.round(qty * unitNet * 100) / 100;
      const lineTax = Math.round(lineNet * (vatRate / 100) * 100) / 100;
      net = Math.round((net + lineNet) * 100) / 100;
      gross = Math.round((gross + lineNet + lineTax) * 100) / 100;
      vatByRate[vatRate] = Math.round(((vatByRate[vatRate] ?? 0) + lineTax) * 100) / 100;
    }
    return { net, gross, vatByRate };
  }, [additionalInvoiceItems]);

  // Fetch documents for this order - must be before early return
  const { data: documents, isLoading: documentsLoading, error: documentsError } = useQuery<
    Array<{
      id: string;
      type: string;
      number: string;
      deepLinkCode: string;
      amountGross?: number | null;
    }>
  >({
    queryKey: ['/api/orders', order?.id, 'documents'],
    enabled: isOpen && !!order?.id,
  });

  const settlementInvoiceDocOptions = useMemo(() => {
    if (!documents) return [];
    return documents.filter((d) => d.type === "invoice");
  }, [documents]);

  const settlementStornoDocOptions = useMemo(() => {
    if (!documents) return [];
    return documents.filter((d) => {
      const t = (d.type || "").toLowerCase();
      return (
        t === "cancellation" ||
        t === "credit_note" ||
        t === "cancellation_invoice" ||
        t === "storno" ||
        t === "storno_invoice" ||
        t === "invoice_cancellation" ||
        t.includes("storno")
      );
    });
  }, [documents]);

  useEffect(() => {
    if (!order?.id) return;
    setSettlementInvoiceNumber("");
    setSettlementOriginalNumber("");
    setSettlementOriginalAmount("");
    setSettlementStornoNumber("");
    setSettlementStornoAmount("");
    setSettlementInvoiceDate("");
    setAdditionalInvoiceNumber("");
    setAdditionalInvoiceDate("");
    setAdditionalReferenceNumber("");
    setAdditionalInvoiceNote("");
    setAdditionalInvoiceItems([
      createDefaultAdditionalInvoiceItem(t("orderDetail.additionalInvoiceDefaultDescription")),
    ]);
  }, [order?.id, t]);

  // Fetch tickets for this order
  const { data: orderTickets = [] } = useQuery<TicketType[]>({
    queryKey: ['/api/orders', order?.id, 'tickets'],
    enabled: isOpen && !!order?.id,
  });

  const { data: orderAssignments = [] } = useQuery<any[]>({
    queryKey: ['/api/crm/assignments', order?.id],
    queryFn: async () => {
      const response = await fetch(`/api/crm/assignments?orderId=${order?.id}`, { credentials: "include" });
      if (!response.ok) {
        throw new Error(await response.text());
      }
      return response.json();
    },
    enabled: isOpen && !!order?.id && (canManageCrm || canApproveCrm),
  });

  const { data: crmAssignees = [] } = useQuery<Array<{ id: string; username: string; skills?: string[] }>>({
    queryKey: ['/api/crm/assignees'],
    enabled: isAssignDialogOpen && canManageCrm,
  });

  const createAssignmentMutation = useMutation({
    mutationFn: async () => {
      if (!order?.id) throw new Error("No order selected");
      if (!assignedToUserId) throw new Error("No assignee selected");
      const response = await apiRequest("POST", "/api/crm/assignments", {
        orderId: order.id,
        orderNumber: order.orderNumber,
        assignedToUserId,
        reason: assignmentReason.trim() || undefined,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/crm/assignments', order?.id] });
      toast({ title: t("crm.assignments.requested") });
      setIsAssignDialogOpen(false);
      setAssignedToUserId("");
      setAssignmentReason("");
    },
    onError: (error: Error) => {
      toast({ title: t("crm.assignments.requestFailed"), description: error.message, variant: "destructive" });
    },
  });

  // Create proforma invoice mutation
  const createProformaMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/orders/${order!.id}/proforma`, {});
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      queryClient.invalidateQueries({ queryKey: ['/api/orders', order?.id, 'documents'] });
      toast({
        title: t('orderDetail.proformaCreateSuccess'),
        description: t('orderDetail.proformaCreateSuccessDesc', { number: data.proformaNumber }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('orderDetail.proformaCreateFailed'),
        description: error.message || t('orderDetail.proformaCreateFailedDesc'),
        variant: "destructive",
      });
    },
  });

  const downloadDunningPdf = async (stage: number = 1) => {
    if (!order) return;
    try {
      const url = `/api/dunning/order/${order.id}/pdf?stage=${stage}`;
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error("Download fehlgeschlagen");
      const blob = await response.blob();
      const contentDisposition = response.headers.get("Content-Disposition");
      const match = contentDisposition?.match(/filename="?([^";\n]+)"?/);
      const fileName = match?.[1] || `Mahnung-Stufe-${stage}-${order.orderNumber || order.id}.pdf`;
      const urlObj = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(urlObj);
      document.body.removeChild(a);
      toast({
        title: t('orderDetail.downloadStarted'),
        description: t('orderDetail.downloadSuccess', { orderNumber: order.orderNumber }),
      });
    } catch (err: any) {
      toast({
        title: t('orderDetail.downloadUnavailable'),
        description: err.message || t('orderDetail.documentsError'),
        variant: "destructive",
      });
    }
  };

  const sendDunningMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/dunning/send", { orderId: order!.id });
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: t('orderDetail.dunningSendSuccess'),
        description: t('orderDetail.dunningSendSuccessDesc', { stage: data.stage }),
        ...(data.downloadUrl && {
          action: (
            <ToastAction altText={t('orderDetail.dunningDownloadPdf')} onClick={() => downloadDunningPdf(data.stage)}>
              {t('orderDetail.dunningDownloadPdf')}
            </ToastAction>
          ),
        }),
      });
    },
    onError: (error: any) => {
      toast({
        title: t('orderDetail.dunningSendError'),
        description: error.message || t('orderDetail.dunningSendErrorDesc'),
        variant: "destructive",
      });
    },
  });

  const settlementPdfMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("No order");
      const originalAmountGross = parseGermanAmountInput(settlementOriginalAmount);
      const stornoAmountGross = parseGermanAmountInput(settlementStornoAmount);
      if (!settlementInvoiceNumber.trim()) {
        throw new Error(t("orderDetail.settlementValidationNumber"));
      }
      if (!settlementOriginalNumber.trim()) {
        throw new Error(t("orderDetail.settlementValidationOriginalNumber"));
      }
      if (!Number.isFinite(originalAmountGross) || originalAmountGross <= 0) {
        throw new Error(t("orderDetail.settlementValidationOriginalAmount"));
      }
      if (!settlementStornoNumber.trim()) {
        throw new Error(t("orderDetail.settlementValidationStornoNumber"));
      }
      if (!Number.isFinite(stornoAmountGross) || stornoAmountGross < 0) {
        throw new Error(t("orderDetail.settlementValidationStornoAmount"));
      }
      if (stornoAmountGross > originalAmountGross) {
        throw new Error(t("orderDetail.settlementValidationStornoTooLarge"));
      }
      const body: Record<string, unknown> = {
        settlementInvoiceNumber: settlementInvoiceNumber.trim(),
        originalInvoiceNumber: settlementOriginalNumber.trim(),
        originalAmountGross,
        stornoInvoiceNumber: settlementStornoNumber.trim(),
        stornoAmountGross,
      };
      if (settlementInvoiceDate.trim()) {
        body.invoiceDate = settlementInvoiceDate.trim();
      }
      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;
      const res = await fetch(`/api/orders/${order.id}/settlement-invoice/pdf`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const j = (await res.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          try {
            const text = await res.text();
            if (text) msg = text.slice(0, 200);
          } catch {
            /* ignore */
          }
        }
        throw new Error(msg);
      }
      return res.blob();
    },
    onSuccess: (blob) => {
      if (!order) return;
      const urlObj = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = urlObj;
      a.download = `abschlussrechnung-${settlementInvoiceNumber.trim().replace(/[^\w.-]+/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(urlObj);
      document.body.removeChild(a);
      toast({
        title: t("orderDetail.settlementPdfSuccess"),
        description: t("orderDetail.settlementPdfSuccessDesc", {
          number: settlementInvoiceNumber.trim(),
        }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDetail.settlementPdfFailed"),
        description: error.message || t("orderDetail.settlementPdfFailedDesc"),
        variant: "destructive",
      });
    },
  });

  const additionalInvoiceMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("No order");
      if (!additionalInvoiceNumber.trim()) {
        throw new Error(t("orderDetail.additionalInvoiceValidationNumber"));
      }

      const items = additionalInvoiceItems.map((item, index) => {
        const quantity = parseFloat(item.quantity.trim().replace(",", "."));
        const unitNetPrice = parseGermanAmountInput(item.unitNetPrice);
        if (!item.description.trim()) {
          throw new Error(t("orderDetail.additionalInvoiceValidationDescription", { index: index + 1 }));
        }
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error(t("orderDetail.additionalInvoiceValidationQuantity", { index: index + 1 }));
        }
        if (!Number.isFinite(unitNetPrice) || unitNetPrice < 0) {
          throw new Error(t("orderDetail.additionalInvoiceValidationUnitNet", { index: index + 1 }));
        }
        return {
          description: item.description.trim(),
          quantity,
          unitNetPrice,
          vatRate: Number(item.vatRate),
        };
      });

      if (items.length === 0) {
        throw new Error(t("orderDetail.additionalInvoiceValidationItems"));
      }

      const body: Record<string, unknown> = {
        invoiceNumber: additionalInvoiceNumber.trim(),
        items,
      };
      if (additionalInvoiceDate.trim()) {
        body.invoiceDate = additionalInvoiceDate.trim();
      }
      if (additionalReferenceNumber.trim()) {
        body.referenceInvoiceNumber = additionalReferenceNumber.trim();
      }
      if (additionalInvoiceNote.trim()) {
        body.note = additionalInvoiceNote.trim();
      }

      const csrfMatch = document.cookie.match(/csrf_token=([^;]+)/);
      const csrfToken = csrfMatch ? csrfMatch[1] : null;
      const res = await fetch(`/api/orders/${order.id}/additional-invoice`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}),
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const j = (await res.json()) as { error?: string; message?: string };
          if (j.error) msg = j.error;
          else if (j.message) msg = j.message;
        } catch {
          try {
            const text = await res.text();
            if (text) msg = text.slice(0, 200);
          } catch {
            /* ignore */
          }
        }
        throw new Error(msg);
      }
      return res.json() as Promise<{ documentId?: string; documentNumber?: string }>;
    },
    onSuccess: (data) => {
      if (!order) return;
      const documentNumber = data.documentNumber || additionalInvoiceNumber.trim();
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "documents"] });
      setAdditionalInvoiceNumber("");
      setAdditionalInvoiceDate("");
      setAdditionalReferenceNumber("");
      setAdditionalInvoiceNote("");
      setAdditionalInvoiceItems([
        createDefaultAdditionalInvoiceItem(t("orderDetail.additionalInvoiceDefaultDescription")),
      ]);
      toast({
        title: t("orderDetail.additionalInvoiceSuccess"),
        description: t("orderDetail.additionalInvoiceSuccessDesc", {
          number: documentNumber,
        }),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t("orderDetail.additionalInvoiceFailed"),
        description: error.message || t("orderDetail.additionalInvoiceFailedDesc"),
        variant: "destructive",
      });
    },
  });

  const handleTicketClick = (ticket: TicketType) => {
    setSelectedTicketId(ticket.id);
    setIsTicketDetailOpen(true);
  };

  if (!order) return null;

  /** Immer: Übersicht, Positionen, Versand, Teilzahlung; optional: Dokumente, Nachberechnung */
  const orderDetailTabCount =
    4 + (canAccessOrderDocuments ? 1 : 0) + (canManageAdditionalInvoice ? 1 : 0);

  const handleDownloadDocument = async (documentId: string, deepLinkCode: string, documentNumber: string) => {
    try {
      const response = await fetch(`/api/orders/${order.id}/document/${documentId}/${deepLinkCode}`);
      
      if (!response.ok) {
        throw new Error('Failed to download document');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${documentNumber || documentId}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: t('orderDetail.downloadStarted'),
        description: t('orderDetail.downloadSuccess', { orderNumber: order.orderNumber }),
      });
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: t('orderDetail.downloadFailed'),
        description: t('orderDetail.downloadError'),
        variant: "destructive",
      });
    }
  };

  return (
    <>
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-order-detail">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-2xl font-semibold">
                {t('orderDetail.title', { orderNumber: order.orderNumber })}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {t('orderDetail.overview')}
              </DialogDescription>
              <div
                className="mt-3 flex flex-wrap items-start justify-between gap-4 rounded-md border bg-muted/30 px-4 py-3 text-sm"
                data-testid="block-order-and-customer-numbers"
              >
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t("orderDetail.orderNumberLabel")}
                  </p>
                  <p className="font-mono font-semibold" data-testid="text-header-order-number">
                    {order.orderNumber}
                  </p>
                </div>
                {order.customerNumber ? (
                  <div className="text-left sm:text-right">
                    <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      {t("orderDetail.customerNumberLabel")}
                    </p>
                    <p className="font-mono font-semibold" data-testid="text-header-customer-number">
                      {order.customerNumber}
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {canManageCrm && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setIsAssignDialogOpen(true)}
                  data-testid="button-request-assignment"
                >
                  {t("crm.assignments.request")}
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCreateTicketDialogOpen(true)}
                data-testid="button-create-ticket-from-order"
              >
                <Ticket className="h-4 w-4 mr-2" />
                {t('tickets.createTicket')}
              </Button>
              <StatusBadge status={order.status} />
            </div>
          </div>
        </DialogHeader>

        {hasDuplicate && (
          <Alert className="mt-4" variant="destructive" data-testid="alert-duplicate-order">
            <AlertDescription>{t("orders.duplicateWarning")}</AlertDescription>
          </Alert>
        )}

        {orderTickets.length > 0 && (
          <Alert className="mt-4" data-testid="alert-existing-tickets">
            <Ticket className="h-4 w-4" />
            <AlertDescription className="flex items-center justify-between">
              <span>
                {orderTickets.length === 1 
                  ? t('orderDetail.hasOneTicket')
                  : t('orderDetail.hasMultipleTickets', { count: orderTickets.length })}
              </span>
              <div className="flex gap-2 flex-wrap">
                {orderTickets.map((ticket) => (
                  <Button
                    key={ticket.id}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTicketClick(ticket)}
                    data-testid={`button-view-ticket-${ticket.id}`}
                  >
                    <ExternalLink className="h-3 w-3 mr-1" />
                    {ticket.ticketNumber}
                  </Button>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {orderAssignments.length > 0 && (
          <Alert className="mt-4" data-testid="alert-existing-assignments">
            <AlertDescription className="flex items-center justify-between">
              <span>{t("crm.assignments.existing")}</span>
              <div className="flex gap-2 flex-wrap">
                {orderAssignments.map((assignment) => (
                  <Badge key={assignment.id} variant="outline">
                    {assignment.assignedToUserName || "—"} · {t(`crm.assignments.status.${assignment.status}`)}
                  </Badge>
                ))}
              </div>
            </AlertDescription>
          </Alert>
        )}

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList
            className={
              orderDetailTabCount >= 6
                ? "grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-1 h-auto"
                : orderDetailTabCount >= 5
                  ? "grid w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-1 h-auto"
                  : "grid w-full grid-cols-2 sm:grid-cols-4 gap-1 h-auto"
            }
          >
            <TabsTrigger value="overview" data-testid="tab-overview">{t('orderDetail.overview')}</TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items">{t('orderDetail.items')}</TabsTrigger>
            <TabsTrigger value="shipping" data-testid="tab-shipping">{t('orderDetail.shipping')}</TabsTrigger>
            <TabsTrigger value="installments" data-testid="tab-installments">
              {t("orderDetail.installmentsTab")}
            </TabsTrigger>
            {canManageAdditionalInvoice && (
              <TabsTrigger value="additional-invoice" data-testid="tab-additional-invoice">
                {t("orderDetail.additionalInvoiceTab")}
              </TabsTrigger>
            )}
            {canAccessOrderDocuments && (
              <TabsTrigger value="documents" data-testid="tab-documents">{t('orderDetail.documents')}</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="pt-6 space-y-4">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.customerInfo')}</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.name')}</p>
                  <p className="font-medium" data-testid="text-customer-name">{order.customerName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.email')}</p>
                  <p className="font-medium" data-testid="text-customer-email">{order.customerEmail}</p>
                </div>
                {order.customerPhone && (
                  <div>
                    <p className="text-sm text-muted-foreground">{t('orderDetail.phone')}</p>
                    <p className="font-medium" data-testid="text-customer-phone">{order.customerPhone}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.orderDate')}</p>
                  <p className="font-medium">
                    {new Date(order.orderDate).toLocaleDateString(i18n.language, {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.totalAmount')}</p>
                  <div className="space-y-1">
                    <p className="font-medium text-lg" data-testid="text-total-amount">€{order.totalAmount.toFixed(2)} <span className="text-xs text-muted-foreground">{t('orderDetail.gross')}</span></p>
                    <p className="text-sm text-muted-foreground" data-testid="text-net-total-amount">€{(order.netTotalAmount || 0).toFixed(2)} <span className="text-xs">{t('orderDetail.net')}</span></p>
                  </div>
                </div>
              </div>
            </Card>

            {(order.paymentMethod || order.shippingMethod || order.shippingInfo?.shippedDate || order.deliveryDateEarliest || order.deliveryDateLatest) && (
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.paymentAndShipping')}</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">{t('orderDetail.paymentMethod')}</p>
                    <p className="font-medium" data-testid="text-payment-method">{order.paymentMethod || '–'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('orderDetail.shippingMethod')}</p>
                    <p className="font-medium" data-testid="text-shipping-method">{order.shippingMethod || '–'}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('orderDetail.shippedDate')}</p>
                    <p className="font-medium" data-testid="text-shipped-date">
                      {order.shippingInfo?.shippedDate
                        ? new Date(order.shippingInfo.shippedDate).toLocaleDateString(i18n.language, {
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })
                        : '–'}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">{t('orderDetail.deliveryDatePlanned')}</p>
                    <p className="font-medium" data-testid="text-delivery-date-planned">
                      {order.deliveryDateEarliest || order.deliveryDateLatest
                        ? [order.deliveryDateEarliest, order.deliveryDateLatest]
                            .filter(Boolean)
                            .map((d) =>
                              new Date(d!).toLocaleDateString(i18n.language, {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                              })
                            )
                            .join(' – ')
                        : '–'}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {order.billingAddress && (
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.billingAddress')}</h3>
                <Textarea
                  readOnly
                  aria-label={t("orderDetail.billingAddress")}
                  className="min-h-[7rem] resize-none font-sans text-sm leading-relaxed"
                  data-testid="textarea-billing-address-full"
                  value={formatAddressMultiline(order.billingAddress, t("orderDetail.phone"))}
                />
              </Card>
            )}

            {order.shippingAddress && (
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.shippingAddress')}</h3>
                <div className="space-y-1">
                  {order.shippingAddress.company && (
                    <p className="font-medium" data-testid="text-shipping-company">{order.shippingAddress.company}</p>
                  )}
                  <p className="font-medium" data-testid="text-shipping-name">
                    {order.shippingAddress.firstName} {order.shippingAddress.lastName}
                  </p>
                  <p className="text-sm" data-testid="text-shipping-street">{order.shippingAddress.street}</p>
                  <p className="text-sm" data-testid="text-shipping-city">
                    {order.shippingAddress.zipCode} {order.shippingAddress.city}
                  </p>
                  <p className="text-sm" data-testid="text-shipping-country">{order.shippingAddress.country}</p>
                  {order.shippingAddress.phoneNumber && (
                    <p className="text-sm mt-2" data-testid="text-shipping-phone">
                      <span className="text-muted-foreground">{t('orderDetail.phone')}:</span> {order.shippingAddress.phoneNumber}
                    </p>
                  )}
                </div>
              </Card>
            )}

            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.erpDocumentNumbers')}</h3>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.erpOrderNumber')}</p>
                  <p className="font-mono font-medium" data-testid="text-erp-order-number">
                    {order.erpNumber || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.erpDeliveryNoteNumber')}</p>
                  <p className="font-mono font-medium" data-testid="text-erp-delivery-note-number">
                    {order.deliveryNoteNumber || '-'}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('orderDetail.erpInvoiceNumber')}</p>
                  <p className="font-mono font-medium" data-testid="text-erp-invoice-number">
                    {order.invoiceNumber || '-'}
                  </p>
                </div>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.allDocuments')}</h3>
              {documentsError ? (
                <div className="text-center py-8">
                  <p className="text-destructive text-sm font-medium mb-2">{t('errors.loadFailed')}</p>
                  {documentsError instanceof Error && documentsError.message.includes('Shopware settings not configured') ? (
                    <p className="text-muted-foreground text-sm">{t('errors.notConfiguredDescription')}</p>
                  ) : (
                    <p className="text-muted-foreground text-sm">{t('orderDetail.documentsError')}</p>
                  )}
                </div>
              ) : documentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">{t('orderDetail.loadingDocuments')}</span>
                </div>
              ) : documents && documents.length > 0 ? (
                <div className="space-y-2">
                  {documents.map((doc) => {
                    const canDownload = !!doc.deepLinkCode;
                    return (
                      <div
                        key={doc.id}
                        className="flex items-center justify-between p-3 border rounded-lg hover-elevate"
                        data-testid={`document-${doc.id}`}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <Badge variant="secondary" data-testid={`badge-type-${doc.type}`}>
                              {t(`documentTypes.${doc.type}`)}
                            </Badge>
                            {doc.number && (
                              <span className="font-mono text-sm font-medium" data-testid={`text-number-${doc.id}`}>
                                {doc.number}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground">
                            {t('orderDetail.documentType')}: {t(`documentTypes.${doc.type}`)}
                            {!canDownload && <span className="ml-2 text-destructive">({t('orderDetail.downloadUnavailable')})</span>}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          onClick={() => handleDownloadDocument(doc.id, doc.deepLinkCode, doc.number)}
                          disabled={!canDownload}
                          data-testid={`button-download-${doc.id}`}
                        >
                          <FileDown className="h-4 w-4 mr-1" />
                          {t('orderDetail.downloadDocument')}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">{t('orderDetail.noDocuments')}</p>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="items" className="pt-6">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.orderItems')}</h3>
              {order.items && order.items.length > 0 ? (
                <div className="space-y-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center py-2 border-b last:border-0" data-testid={`orderitem-${item.id}`}>
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">{t('orderDetail.quantity')}: {item.quantity}</p>
                        <p className="text-xs text-muted-foreground">{t('orderDetail.taxRate')}: {item.taxRate}%</p>
                      </div>
                      <div className="text-right">
                        <div className="space-y-1">
                          <div>
                            <p className="font-medium">€{item.total.toFixed(2)} <span className="text-xs text-muted-foreground">{t('orderDetail.gross')}</span></p>
                            <p className="text-sm text-muted-foreground">€{item.netTotal.toFixed(2)} <span className="text-xs">{t('orderDetail.net')}</span></p>
                          </div>
                          <div className="text-sm">
                            <p className="text-muted-foreground">€{item.price.toFixed(2)} {t('orderDetail.each')} <span className="text-xs">({t('orderDetail.gross')})</span></p>
                            <p className="text-xs text-muted-foreground">€{item.netPrice.toFixed(2)} {t('orderDetail.each')} ({t('orderDetail.net')})</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">{t('orderDetail.noItems')}</p>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="shipping" className="pt-6">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.shippingInfo')}</h3>
              <ShippingInfoForm
                defaultValues={{
                  carrier: order.shippingInfo?.carrier || "",
                  trackingNumber: order.shippingInfo?.trackingNumber || "",
                  shippedDate: order.shippingInfo?.shippedDate || "",
                }}
                onSubmit={(data) => {
                  onUpdateShipping(order.id, data);
                  onClose();
                }}
                onCancel={onClose}
              />
            </Card>
          </TabsContent>

          <TabsContent value="installments" className="pt-6">
            <Card className="p-6" data-testid="section-installments-tab">
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-medium uppercase tracking-wide">
                    {t("installmentPlan.sectionTitle")}
                  </h3>
                  {canManageInstallments && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setInstallmentDialogOpen(true)}>
                      {t("installmentPlan.newPlan")}
                    </Button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground">{t("installmentPlan.sectionDescription")}</p>
                <InstallmentPlanSection order={order} canManage={canManageInstallments} />
              </div>
            </Card>
          </TabsContent>

          {canManageAdditionalInvoice && (
            <TabsContent value="additional-invoice" className="pt-6">
              <Card className="p-6" data-testid="section-additional-invoice">
                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium uppercase tracking-wide mb-2">
                      {t("orderDetail.additionalInvoiceTitle")}
                    </h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t("orderDetail.additionalInvoiceDescription")}
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2 space-y-2">
                        <Label htmlFor="additional-invoice-number">
                          {t("orderDetail.additionalInvoiceNumber")}
                        </Label>
                        <Input
                          id="additional-invoice-number"
                          className="font-mono"
                          value={additionalInvoiceNumber}
                          onChange={(e) => setAdditionalInvoiceNumber(e.target.value)}
                          placeholder={t("orderDetail.additionalInvoiceNumberPlaceholder")}
                          data-testid="input-additional-invoice-number"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="additional-invoice-date">
                          {t("orderDetail.additionalInvoiceDate")}
                        </Label>
                        <Input
                          id="additional-invoice-date"
                          type="date"
                          value={additionalInvoiceDate}
                          onChange={(e) => setAdditionalInvoiceDate(e.target.value)}
                          data-testid="input-additional-invoice-date"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t("orderDetail.additionalInvoiceReference")}</Label>
                        <Select
                          value={
                            settlementInvoiceDocOptions.find(
                              (d) => d.number === additionalReferenceNumber,
                            )?.id ?? "__none__"
                          }
                          onValueChange={(id) => {
                            if (id === "__none__") {
                              setAdditionalReferenceNumber("");
                              return;
                            }
                            const doc = settlementInvoiceDocOptions.find((d) => d.id === id);
                            setAdditionalReferenceNumber(doc?.number ?? "");
                          }}
                        >
                          <SelectTrigger data-testid="select-additional-invoice-reference">
                            <SelectValue placeholder={t("orderDetail.settlementPickPlaceholder")} />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">
                              {t("orderDetail.settlementPickNone")}
                            </SelectItem>
                            {settlementInvoiceDocOptions.map((d) => (
                              <SelectItem key={d.id} value={d.id}>
                                {d.number}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="sm:col-span-2 space-y-2">
                        <Label htmlFor="additional-invoice-note">
                          {t("orderDetail.additionalInvoiceNote")}
                        </Label>
                        <Textarea
                          id="additional-invoice-note"
                          value={additionalInvoiceNote}
                          onChange={(e) => setAdditionalInvoiceNote(e.target.value)}
                          placeholder={t("orderDetail.additionalInvoiceNotePlaceholder")}
                          rows={3}
                          data-testid="input-additional-invoice-note"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label>{t("orderDetail.additionalInvoiceItems")}</Label>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setAdditionalInvoiceItems((current) => [
                            ...current,
                            createDefaultAdditionalInvoiceItem(
                              t("orderDetail.additionalInvoiceDefaultDescription"),
                            ),
                          ])
                        }
                        data-testid="button-additional-invoice-add-item"
                      >
                        <Plus className="mr-2 h-4 w-4" />
                        {t("orderDetail.additionalInvoiceAddItem")}
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {additionalInvoiceItems.map((item, index) => (
                        <div
                          key={`additional-invoice-item-${index}`}
                          className="grid gap-3 rounded-md border p-3 sm:grid-cols-12"
                          data-testid={`additional-invoice-item-${index}`}
                        >
                          <div className="sm:col-span-5 space-y-2">
                            <Label>{t("orderDetail.additionalInvoiceItemDescription")}</Label>
                            <Input
                              value={item.description}
                              onChange={(e) =>
                                setAdditionalInvoiceItems((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, description: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                              data-testid={`input-additional-invoice-description-${index}`}
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-2">
                            <Label>{t("orderDetail.additionalInvoiceItemQuantity")}</Label>
                            <Input
                              inputMode="decimal"
                              value={item.quantity}
                              onChange={(e) =>
                                setAdditionalInvoiceItems((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, quantity: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                              data-testid={`input-additional-invoice-quantity-${index}`}
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-2">
                            <Label>{t("orderDetail.additionalInvoiceItemUnitNet")}</Label>
                            <Input
                              inputMode="decimal"
                              value={item.unitNetPrice}
                              onChange={(e) =>
                                setAdditionalInvoiceItems((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index
                                      ? { ...row, unitNetPrice: e.target.value }
                                      : row,
                                  ),
                                )
                              }
                              placeholder="0,00"
                              data-testid={`input-additional-invoice-unit-net-${index}`}
                            />
                          </div>
                          <div className="sm:col-span-2 space-y-2">
                            <Label>{t("orderDetail.additionalInvoiceItemVat")}</Label>
                            <Select
                              value={item.vatRate}
                              onValueChange={(value: "0" | "7" | "19") =>
                                setAdditionalInvoiceItems((current) =>
                                  current.map((row, rowIndex) =>
                                    rowIndex === index ? { ...row, vatRate: value } : row,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger data-testid={`select-additional-invoice-vat-${index}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="0">0 %</SelectItem>
                                <SelectItem value="7">7 %</SelectItem>
                                <SelectItem value="19">19 %</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="sm:col-span-1 flex items-end justify-end">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              disabled={additionalInvoiceItems.length <= 1}
                              onClick={() =>
                                setAdditionalInvoiceItems((current) =>
                                  current.filter((_, rowIndex) => rowIndex !== index),
                                )
                              }
                              data-testid={`button-additional-invoice-remove-${index}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-1">
                      <div className="flex justify-between gap-4">
                        <span>{t("orderDetail.additionalInvoiceTotalNet")}</span>
                        <span className="font-mono">{formatSettlementAmountDe(additionalInvoiceTotals.net)} €</span>
                      </div>
                      {([0, 7, 19] as const).map((rate) => {
                        const tax = additionalInvoiceTotals.vatByRate[rate];
                        if (!tax) return null;
                        return (
                          <div key={rate} className="flex justify-between gap-4">
                            <span>{t("orderDetail.additionalInvoiceVat", { rate })}</span>
                            <span className="font-mono">{formatSettlementAmountDe(tax)} €</span>
                          </div>
                        );
                      })}
                      <div className="flex justify-between gap-4 font-medium pt-1">
                        <span>{t("orderDetail.additionalInvoiceTotalGross")}</span>
                        <span className="font-mono">{formatSettlementAmountDe(additionalInvoiceTotals.gross)} €</span>
                      </div>
                    </div>

                    <Button
                      type="button"
                      disabled={additionalInvoiceMutation.isPending}
                      onClick={() => additionalInvoiceMutation.mutate()}
                      data-testid="button-additional-invoice-create"
                    >
                      {additionalInvoiceMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t("orderDetail.additionalInvoiceCreating")}
                        </>
                      ) : (
                        t("orderDetail.additionalInvoiceCreate")
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            </TabsContent>
          )}

          {canAccessOrderDocuments && (
            <TabsContent value="documents" className="pt-6">
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.documentNumbers')}</h3>
                <AdminDocumentForm
                  defaultValues={{
                    invoiceNumber: order.invoiceNumber || "",
                    vorkasseInvoiceNumber: order.vorkasseInvoiceNumber || "",
                    deliveryNoteNumber: order.deliveryNoteNumber || "",
                    erpNumber: order.erpNumber || "",
                  }}
                  onSubmit={(data) => {
                    onUpdateDocuments(order.id, data);
                    onClose();
                  }}
                  onCancel={onClose}
                />

                <Separator className="my-6" />

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium uppercase tracking-wide mb-2">{t('orderDetail.proformaTitle')}</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t('orderDetail.proformaDescription')}
                    </p>
                    {order.proformaNumber && (
                      <Alert className="mb-4">
                        <AlertDescription>
                          <strong>{t('orderDetail.proformaNumberLabel')}</strong> {order.proformaNumber}
                        </AlertDescription>
                      </Alert>
                    )}
                    <Button
                      onClick={() => createProformaMutation.mutate()}
                      disabled={createProformaMutation.isPending || !!order.proformaNumber}
                      variant="outline"
                    >
                      {createProformaMutation.isPending ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          {t('orderDetail.proformaCreating')}
                        </>
                      ) : order.proformaNumber ? (
                        t('orderDetail.proformaAlreadyCreated')
                      ) : (
                        t('orderDetail.proformaCreate')
                      )}
                    </Button>
                  </div>
                </div>

                {canManageSettlementPdf && (
                  <>
                    <Separator className="my-6" />

                    <div className="space-y-4">
                      <div>
                        <h3 className="text-sm font-medium uppercase tracking-wide mb-2">
                          {t("orderDetail.settlementTitle")}
                        </h3>
                        <p className="text-sm text-muted-foreground mb-4">
                          {t("orderDetail.settlementDescription")}
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="sm:col-span-2 space-y-2">
                            <Label htmlFor="settlement-invoice-number">
                              {t("orderDetail.settlementInvoiceNumber")}
                            </Label>
                            <Input
                              id="settlement-invoice-number"
                              className="font-mono"
                              value={settlementInvoiceNumber}
                              onChange={(e) => setSettlementInvoiceNumber(e.target.value)}
                              placeholder={t("orderDetail.settlementInvoiceNumberPlaceholder")}
                              data-testid="input-settlement-invoice-number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t("orderDetail.settlementPickOriginal")}</Label>
                            <Select
                              value={
                                settlementInvoiceDocOptions.find(
                                  (d) => d.number === settlementOriginalNumber,
                                )?.id ?? "__none__"
                              }
                              onValueChange={(id) => {
                                if (id === "__none__") {
                                  setSettlementOriginalNumber("");
                                  setSettlementOriginalAmount("");
                                  return;
                                }
                                const doc = settlementInvoiceDocOptions.find((d) => d.id === id);
                                setSettlementOriginalNumber(doc?.number ?? "");
                                if (
                                  doc != null &&
                                  typeof doc.amountGross === "number" &&
                                  Number.isFinite(doc.amountGross)
                                ) {
                                  setSettlementOriginalAmount(formatSettlementAmountDe(doc.amountGross));
                                }
                              }}
                            >
                              <SelectTrigger data-testid="select-settlement-original-doc">
                                <SelectValue placeholder={t("orderDetail.settlementPickPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  {t("orderDetail.settlementPickNone")}
                                </SelectItem>
                                {settlementInvoiceDocOptions.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.number}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settlement-original-number">
                              {t("orderDetail.settlementOriginalNumber")}
                            </Label>
                            <Input
                              id="settlement-original-number"
                              className="font-mono"
                              value={settlementOriginalNumber}
                              onChange={(e) => setSettlementOriginalNumber(e.target.value)}
                              data-testid="input-settlement-original-number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settlement-original-amount">
                              {t("orderDetail.settlementOriginalAmount")}
                            </Label>
                            <Input
                              id="settlement-original-amount"
                              inputMode="decimal"
                              value={settlementOriginalAmount}
                              onChange={(e) => setSettlementOriginalAmount(e.target.value)}
                              placeholder="0,00"
                              data-testid="input-settlement-original-amount"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>{t("orderDetail.settlementPickStorno")}</Label>
                            <Select
                              value={
                                settlementStornoDocOptions.find(
                                  (d) => d.number === settlementStornoNumber,
                                )?.id ?? "__none__"
                              }
                              onValueChange={(id) => {
                                if (id === "__none__") {
                                  setSettlementStornoNumber("");
                                  setSettlementStornoAmount("");
                                  return;
                                }
                                const doc = settlementStornoDocOptions.find((d) => d.id === id);
                                setSettlementStornoNumber(doc?.number ?? "");
                                if (
                                  doc != null &&
                                  typeof doc.amountGross === "number" &&
                                  Number.isFinite(doc.amountGross)
                                ) {
                                  setSettlementStornoAmount(formatSettlementAmountDe(doc.amountGross));
                                }
                              }}
                            >
                              <SelectTrigger data-testid="select-settlement-storno-doc">
                                <SelectValue placeholder={t("orderDetail.settlementPickPlaceholder")} />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">
                                  {t("orderDetail.settlementPickNone")}
                                </SelectItem>
                                {settlementStornoDocOptions.map((d) => (
                                  <SelectItem key={d.id} value={d.id}>
                                    {d.number}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settlement-storno-number">
                              {t("orderDetail.settlementStornoNumber")}
                            </Label>
                            <Input
                              id="settlement-storno-number"
                              className="font-mono"
                              value={settlementStornoNumber}
                              onChange={(e) => setSettlementStornoNumber(e.target.value)}
                              data-testid="input-settlement-storno-number"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="settlement-storno-amount">
                              {t("orderDetail.settlementStornoAmount")}
                            </Label>
                            <Input
                              id="settlement-storno-amount"
                              inputMode="decimal"
                              value={settlementStornoAmount}
                              onChange={(e) => setSettlementStornoAmount(e.target.value)}
                              placeholder="0,00"
                              data-testid="input-settlement-storno-amount"
                            />
                          </div>
                          <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor="settlement-invoice-date">
                              {t("orderDetail.settlementInvoiceDate")}
                            </Label>
                            <Input
                              id="settlement-invoice-date"
                              type="date"
                              value={settlementInvoiceDate}
                              onChange={(e) => setSettlementInvoiceDate(e.target.value)}
                              data-testid="input-settlement-invoice-date"
                            />
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="outline"
                          className="mt-4"
                          disabled={settlementPdfMutation.isPending}
                          onClick={() => settlementPdfMutation.mutate()}
                          data-testid="button-settlement-pdf"
                        >
                          {settlementPdfMutation.isPending ? (
                            <>
                              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              {t("orderDetail.settlementGenerating")}
                            </>
                          ) : (
                            t("orderDetail.settlementDownloadPdf")
                          )}
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                <Separator className="my-6" />

                <div className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium uppercase tracking-wide mb-2">{t('orderDetail.dunningTitle')}</h3>
                    <p className="text-sm text-muted-foreground mb-4">
                      {t('orderDetail.dunningDescription')}
                    </p>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        onClick={() => sendDunningMutation.mutate()}
                        disabled={sendDunningMutation.isPending}
                        variant="outline"
                      >
                        {sendDunningMutation.isPending ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            {t('orderDetail.dunningSending')}
                          </>
                        ) : (
                          t('orderDetail.dunningSend')
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadDunningPdf(1)}
                        className="gap-2"
                      >
                        <FileDown className="h-4 w-4" />
                        {t('orderDetail.dunningDownloadPdf')}
                      </Button>
                    </div>
                  </div>
                </div>
              </Card>
            </TabsContent>
          )}
        </Tabs>
      </DialogContent>

      <CreateTicketDialog
        isOpen={isCreateTicketDialogOpen}
        onClose={() => setIsCreateTicketDialogOpen(false)}
        linkedOrder={order}
      />

      <TicketDetailModal
        ticketId={selectedTicketId}
        isOpen={isTicketDetailOpen}
        onClose={() => {
          setIsTicketDetailOpen(false);
          setSelectedTicketId(null);
        }}
        canManageTickets={userPermissions?.manageTickets || false}
        canManageCrm={canManageCrm}
        canApproveCrm={canApproveCrm}
      />

      <Dialog open={isAssignDialogOpen} onOpenChange={setIsAssignDialogOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-request-assignment">
          <DialogHeader>
            <DialogTitle>{t("crm.assignments.requestTitle")}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("crm.assignments.requestTitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">{t("crm.assignments.order")}</p>
              <p className="font-medium">{order?.orderNumber}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("crm.assignments.assignee")}</p>
              <Select value={assignedToUserId} onValueChange={setAssignedToUserId}>
                <SelectTrigger>
                  <SelectValue placeholder={t("crm.assignments.selectAssignee")} />
                </SelectTrigger>
                <SelectContent>
                  {crmAssignees.map((assignee) => (
                    <SelectItem key={assignee.id} value={assignee.id}>
                      {assignee.username}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">{t("crm.assignments.reason")}</p>
              <Textarea
                rows={3}
                value={assignmentReason}
                onChange={(event) => setAssignmentReason(event.target.value)}
                placeholder={t("crm.assignments.reasonPlaceholder")}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsAssignDialogOpen(false)}>
                {t("common.cancel")}
              </Button>
              <Button
                onClick={() => createAssignmentMutation.mutate()}
                disabled={!assignedToUserId || createAssignmentMutation.isPending}
              >
                {t("crm.assignments.send")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>

    <InstallmentPlanDialog
      open={installmentDialogOpen}
      onOpenChange={setInstallmentDialogOpen}
      order={order}
    />
    </>
  );
}
