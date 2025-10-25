import { X, FileDown, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import StatusBadge from "./StatusBadge";
import ShippingInfoForm from "./ShippingInfoForm";
import AdminDocumentForm from "./AdminDocumentForm";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import type { Order } from "@shared/schema";
import { useTranslation } from "react-i18next";

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
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" data-testid="modal-order-detail">
        <DialogHeader>
          <div className="flex items-center justify-between">
            <DialogTitle className="text-2xl font-semibold">
              {t('orderDetail.title', { orderNumber: order.orderNumber })}
            </DialogTitle>
            <StatusBadge status={order.status} />
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
                  <p className="font-medium text-lg" data-testid="text-total-amount">€{order.totalAmount.toFixed(2)}</p>
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
                    <div key={item.id} className="flex justify-between items-center py-2 border-b last:border-0">
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">{t('orderDetail.quantity')}: {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">€{item.total.toFixed(2)}</p>
                        <p className="text-sm text-muted-foreground">€{item.price.toFixed(2)} {t('orderDetail.each')}</p>
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
    </Dialog>
  );
}
