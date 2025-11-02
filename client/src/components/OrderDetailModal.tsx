import { X, FileDown, Loader2, Ticket } from "lucide-react";
import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import StatusBadge from "./StatusBadge";
import ShippingInfoForm from "./ShippingInfoForm";
import AdminDocumentForm from "./AdminDocumentForm";
import CreateTicketDialog from "./CreateTicketDialog";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { getAuthHeaders } from "@/lib/queryClient";

interface OrderDetailModalProps {
  order: Order | null;
  isOpen: boolean;
  onClose: () => void;
  userRole: "employee" | "admin";
  onUpdateShipping: (orderId: string, data: any) => void;
  onUpdateDocuments: (orderId: string, data: any) => void;
}

export default function OrderDetailModal({
  order,
  isOpen,
  onClose,
  userRole,
  onUpdateShipping,
  onUpdateDocuments,
}: OrderDetailModalProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();
  const [isCreateTicketDialogOpen, setIsCreateTicketDialogOpen] = useState(false);

  // Fetch documents for this order - must be before early return
  const { data: documents, isLoading: documentsLoading, error: documentsError } = useQuery<Array<{
    id: string;
    type: string;
    number: string;
    deepLinkCode: string;
  }>>({
    queryKey: ['/api/orders', order?.id, 'documents'],
    enabled: isOpen && !!order?.id,
  });

  if (!order) return null;

  const handleDownloadDocument = async (documentId: string, deepLinkCode: string, documentNumber: string) => {
    try {
      const response = await fetch(`/api/orders/${order.id}/document/${documentId}/${deepLinkCode}`, {
        headers: getAuthHeaders(),
      });
      
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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-order-detail">
        <DialogHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-2xl font-semibold">
                {t('orderDetail.title', { orderNumber: order.orderNumber })}
              </DialogTitle>
            </div>
            <div className="flex items-center gap-2">
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

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">{t('orderDetail.overview')}</TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items">{t('orderDetail.items')}</TabsTrigger>
            <TabsTrigger value="shipping" data-testid="tab-shipping">{t('orderDetail.shipping')}</TabsTrigger>
            {userRole === "admin" && (
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

            {order.billingAddress && (
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.billingAddress')}</h3>
                <div className="space-y-1">
                  {order.billingAddress.company && (
                    <p className="font-medium" data-testid="text-billing-company">{order.billingAddress.company}</p>
                  )}
                  <p className="font-medium" data-testid="text-billing-name">
                    {order.billingAddress.firstName} {order.billingAddress.lastName}
                  </p>
                  <p className="text-sm" data-testid="text-billing-street">{order.billingAddress.street}</p>
                  <p className="text-sm" data-testid="text-billing-city">
                    {order.billingAddress.zipCode} {order.billingAddress.city}
                  </p>
                  <p className="text-sm" data-testid="text-billing-country">{order.billingAddress.country}</p>
                  {order.billingAddress.phoneNumber && (
                    <p className="text-sm mt-2" data-testid="text-billing-phone">
                      <span className="text-muted-foreground">{t('orderDetail.phone')}:</span> {order.billingAddress.phoneNumber}
                    </p>
                  )}
                </div>
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

          {userRole === "admin" && (
            <TabsContent value="documents" className="pt-6">
              <Card className="p-6">
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">{t('orderDetail.documentNumbers')}</h3>
                <AdminDocumentForm
                  defaultValues={{
                    invoiceNumber: order.invoiceNumber || "",
                    deliveryNoteNumber: order.deliveryNoteNumber || "",
                    erpNumber: order.erpNumber || "",
                  }}
                  onSubmit={(data) => {
                    onUpdateDocuments(order.id, data);
                    onClose();
                  }}
                  onCancel={onClose}
                />
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
    </Dialog>
  );
}
