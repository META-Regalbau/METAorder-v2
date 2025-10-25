import { X, FileDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import StatusBadge from "./StatusBadge";
import ShippingInfoForm from "./ShippingInfoForm";
import AdminDocumentForm from "./AdminDocumentForm";
import { useToast } from "@/hooks/use-toast";
import type { Order } from "@shared/schema";

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
  const { toast } = useToast();

  if (!order) return null;

  const handleDownloadInvoice = async () => {
    try {
      console.log("Downloading invoice PDF for order:", order.orderNumber);
      
      const response = await fetch(`/api/orders/${order.id}/invoice`);
      
      if (!response.ok) {
        throw new Error('Failed to download invoice');
      }
      
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `invoice-${order.orderNumber}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({
        title: "Download started",
        description: `Invoice PDF for order ${order.orderNumber} is being downloaded.`,
      });
    } catch (error) {
      console.error("Download failed:", error);
      toast({
        title: "Download failed",
        description: "Could not download the invoice. Please try again.",
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
              Order {order.orderNumber}
            </DialogTitle>
            <StatusBadge status={order.status} />
          </div>
        </DialogHeader>

        <Tabs defaultValue="overview" className="mt-6">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="items" data-testid="tab-items">Items</TabsTrigger>
            <TabsTrigger value="shipping" data-testid="tab-shipping">Shipping</TabsTrigger>
            {userRole === "admin" && (
              <TabsTrigger value="documents" data-testid="tab-documents">Documents</TabsTrigger>
            )}
          </TabsList>

          <TabsContent value="overview" className="pt-6 space-y-4">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">Customer Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-muted-foreground">Name</p>
                  <p className="font-medium" data-testid="text-customer-name">{order.customerName}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Email</p>
                  <p className="font-medium" data-testid="text-customer-email">{order.customerEmail}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Order Date</p>
                  <p className="font-medium">
                    {new Date(order.orderDate).toLocaleDateString('en-US', {
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">Total Amount</p>
                  <p className="font-medium text-lg" data-testid="text-total-amount">${order.totalAmount.toFixed(2)}</p>
                </div>
              </div>
            </Card>

            {order.invoiceNumber && (
              <Card className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-medium uppercase tracking-wide mb-1">Invoice Document</h3>
                    <p className="text-sm text-muted-foreground">
                      Invoice Number: <span className="font-mono font-medium text-foreground">{order.invoiceNumber}</span>
                    </p>
                  </div>
                  <Button onClick={handleDownloadInvoice} data-testid="button-download-invoice">
                    <FileDown className="h-4 w-4 mr-1" />
                    Download Invoice PDF
                  </Button>
                </div>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="items" className="pt-6">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">Order Items</h3>
              {order.items && order.items.length > 0 ? (
                <div className="space-y-3">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between items-center py-2 border-b last:border-0">
                      <div className="flex-1">
                        <p className="font-medium">{item.name}</p>
                        <p className="text-sm text-muted-foreground">Quantity: {item.quantity}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-medium">${item.total.toFixed(2)}</p>
                        <p className="text-sm text-muted-foreground">${item.price.toFixed(2)} each</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No items available</p>
              )}
            </Card>
          </TabsContent>

          <TabsContent value="shipping" className="pt-6">
            <Card className="p-6">
              <h3 className="text-sm font-medium uppercase tracking-wide mb-4">Shipping Information</h3>
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
                <h3 className="text-sm font-medium uppercase tracking-wide mb-4">Document Numbers (Admin Only)</h3>
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
