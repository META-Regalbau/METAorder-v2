import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useTranslation } from "react-i18next";
import type { Order } from "@shared/schema";

interface CreateTicketDialogProps {
  isOpen: boolean;
  onClose: () => void;
  linkedOrder?: Order | null;
}

export default function CreateTicketDialog({
  isOpen,
  onClose,
  linkedOrder,
}: CreateTicketDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("normal");
  const [category, setCategory] = useState("general");

  const createTicketMutation = useMutation({
    mutationFn: async (data: {
      title: string;
      description: string;
      priority: string;
      category: string;
      orderId?: string;
      orderNumber?: string;
    }) => {
      const response = await apiRequest("POST", "/api/tickets", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/tickets'] });
      resetForm();
      onClose();
      toast({
        title: t('tickets.createSuccess'),
      });
    },
    onError: (error: Error) => {
      toast({
        title: t('tickets.createFailed'),
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const resetForm = () => {
    setTitle("");
    setDescription("");
    setPriority("normal");
    setCategory("general");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim() || !description.trim()) {
      toast({
        title: t('tickets.createFailed'),
        description: "Bitte füllen Sie alle Pflichtfelder aus",
        variant: "destructive",
      });
      return;
    }

    createTicketMutation.mutate({
      title: title.trim(),
      description: description.trim(),
      priority,
      category,
      orderId: linkedOrder?.id,
      orderNumber: linkedOrder?.orderNumber,
    });
  };

  const handleClose = () => {
    if (!createTicketMutation.isPending) {
      resetForm();
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl" data-testid="dialog-create-ticket">
        <DialogHeader>
          <DialogTitle>{t('tickets.createTicket')}</DialogTitle>
          <DialogDescription className="sr-only">
            {t('tickets.createTicket')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 mt-4">
          {linkedOrder && (
            <div className="p-3 bg-muted rounded-md">
              <p className="text-sm font-medium mb-1">{t('tickets.relatedOrder')}</p>
              <p className="text-sm text-muted-foreground" data-testid="text-linked-order">
                {linkedOrder.orderNumber} - {linkedOrder.customerName}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="title">{t('tickets.subject')} *</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('tickets.subject')}
              required
              data-testid="input-title"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">{t('tickets.description')} *</Label>
            <Textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('tickets.description')}
              rows={6}
              required
              data-testid="input-description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="priority">{t('tickets.priority')}</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priority" data-testid="select-priority">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t('tickets.priorityLow')}</SelectItem>
                  <SelectItem value="normal">{t('tickets.priorityNormal')}</SelectItem>
                  <SelectItem value="high">{t('tickets.priorityHigh')}</SelectItem>
                  <SelectItem value="urgent">{t('tickets.priorityUrgent')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">{t('tickets.category')}</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger id="category" data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">{t('tickets.categoryGeneral')}</SelectItem>
                  <SelectItem value="order_issue">{t('tickets.categoryOrderIssue')}</SelectItem>
                  <SelectItem value="product_inquiry">{t('tickets.categoryProductInquiry')}</SelectItem>
                  <SelectItem value="technical_support">{t('tickets.categoryTechnicalSupport')}</SelectItem>
                  <SelectItem value="complaint">{t('tickets.categoryComplaint')}</SelectItem>
                  <SelectItem value="feature_request">{t('tickets.categoryFeatureRequest')}</SelectItem>
                  <SelectItem value="other">{t('tickets.categoryOther')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={createTicketMutation.isPending}
              data-testid="button-cancel"
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={createTicketMutation.isPending}
              data-testid="button-submit"
            >
              {createTicketMutation.isPending ? t('common.creating') : t('tickets.createTicket')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
