import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import type { Order } from "@shared/schema";

interface BulkTrackingDialogProps {
  isOpen: boolean;
  onClose: () => void;
  selectedOrders: Order[];
  onSuccess: () => void;
}

export default function BulkTrackingDialog({
  isOpen,
  onClose,
  selectedOrders,
  onSuccess,
}: BulkTrackingDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [trackingNumbers, setTrackingNumbers] = useState("");

  const updateTrackingMutation = useMutation({
    mutationFn: async (data: { orderIds: string[]; trackingNumbers: string[] }) => {
      const response = await apiRequest("POST", "/api/orders/bulk-tracking", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/orders'] });
      queryClient.invalidateQueries({ queryKey: ['/api/shipping'] });
      toast({
        title: t('bulkActions.updateSuccess'),
      });
      setTrackingNumbers("");
      onSuccess();
      onClose();
    },
    onError: (error: Error) => {
      toast({
        title: t('bulkActions.updateFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const numbers = trackingNumbers
      .split('\n')
      .map(num => num.trim())
      .filter(num => num.length > 0);

    if (numbers.length !== selectedOrders.length) {
      toast({
        title: t('bulkActions.validationError', { count: selectedOrders.length }),
        variant: "destructive",
      });
      return;
    }

    updateTrackingMutation.mutate({
      orderIds: selectedOrders.map(order => order.id),
      trackingNumbers: numbers,
    });
  };

  const handleClose = () => {
    setTrackingNumbers("");
    onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-bulk-tracking">
        <DialogHeader>
          <DialogTitle>{t('bulkActions.dialogTitle')}</DialogTitle>
          <DialogDescription>
            {t('bulkActions.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-sm font-medium mb-2">{t('bulkActions.selectedOrders')}</Label>
            <div className="border rounded-md p-3 max-h-40 overflow-y-auto bg-muted/50">
              <ul className="space-y-1" data-testid="list-selected-orders">
                {selectedOrders.map((order) => (
                  <li key={order.id} className="text-sm font-mono" data-testid={`item-order-${order.id}`}>
                    {order.orderNumber} - {order.customerName}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div>
            <Label htmlFor="tracking-numbers" className="text-sm font-medium mb-2">
              {t('bulkActions.trackingNumbers')}
            </Label>
            <Textarea
              id="tracking-numbers"
              value={trackingNumbers}
              onChange={(e) => setTrackingNumbers(e.target.value)}
              placeholder={t('bulkActions.trackingNumbersPlaceholder')}
              rows={selectedOrders.length}
              className="font-mono"
              data-testid="textarea-tracking-numbers"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {t('bulkActions.trackingNumbersHelp', { count: selectedOrders.length })}
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              data-testid="button-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={updateTrackingMutation.isPending}
              data-testid="button-submit-tracking"
            >
              {updateTrackingMutation.isPending ? t('common.saving') : t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
