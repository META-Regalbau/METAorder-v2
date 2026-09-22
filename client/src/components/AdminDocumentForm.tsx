import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { InvoiceAutomationSettings } from "@shared/schema";
import { useTranslation } from "react-i18next";

const createAdminDocumentSchema = () => z.object({
  invoiceNumber: z.string().optional(),
  vorkasseInvoiceNumber: z.string().optional(),
  deliveryNoteNumber: z.string().optional(),
  erpNumber: z.string().optional(),
});

type AdminDocumentFormData = {
  invoiceNumber?: string;
  vorkasseInvoiceNumber?: string;
  deliveryNoteNumber?: string;
  erpNumber?: string;
  /** Rechnung nach dem Erstellen direkt verschicken (nur bei neu eingetragener Rechnungsnummer). */
  sendInvoice?: boolean;
};

interface AdminDocumentFormProps {
  defaultValues?: Partial<AdminDocumentFormData>;
  onSubmit: (data: AdminDocumentFormData) => void;
  onCancel?: () => void;
}

export default function AdminDocumentForm({ defaultValues, onSubmit, onCancel }: AdminDocumentFormProps) {
  const { t } = useTranslation();
  
  const adminDocumentSchema = createAdminDocumentSchema();
  
  const form = useForm<AdminDocumentFormData>({
    resolver: zodResolver(adminDocumentSchema),
    defaultValues: {
      invoiceNumber: defaultValues?.invoiceNumber || "",
      vorkasseInvoiceNumber: defaultValues?.vorkasseInvoiceNumber || "",
      deliveryNoteNumber: defaultValues?.deliveryNoteNumber || "",
      erpNumber: defaultValues?.erpNumber || "",
    },
  });

  // Mandanten-Einstellung: E-Rechnung + automatischer Versand
  const { data: invoiceAutomation } = useQuery<InvoiceAutomationSettings>({
    queryKey: ["/api/settings/invoice-automation"],
    retry: false,
  });
  const [sendInvoice, setSendInvoice] = useState(true);
  useEffect(() => {
    if (invoiceAutomation) setSendInvoice(invoiceAutomation.autoSend);
  }, [invoiceAutomation]);

  const enteredInvoiceNumber = (form.watch("invoiceNumber") || "").trim();
  const isNewInvoiceNumber =
    enteredInvoiceNumber !== "" && enteredInvoiceNumber !== (defaultValues?.invoiceNumber || "").trim();

  const handleSubmit = (data: AdminDocumentFormData) => {
    onSubmit(isNewInvoiceNumber ? { ...data, sendInvoice } : data);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="invoiceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('adminDocuments.invoiceNumber')}</FormLabel>
              <FormControl>
                <Input placeholder={t('adminDocuments.invoiceNumberPlaceholder')} className="font-mono" {...field} data-testid="input-invoice-number" />
              </FormControl>
              <FormMessage />
              {isNewInvoiceNumber && (
                <div className="space-y-2 pt-1">
                  <p className="text-xs text-muted-foreground">
                    {invoiceAutomation?.eInvoice === false
                      ? t('adminDocuments.invoiceHintPdf')
                      : t('adminDocuments.invoiceHintEInvoice')}
                  </p>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="send-invoice-after-create"
                      checked={sendInvoice}
                      onCheckedChange={(value) => setSendInvoice(value === true)}
                      data-testid="checkbox-send-invoice"
                    />
                    <Label htmlFor="send-invoice-after-create" className="text-sm font-normal">
                      {t('adminDocuments.sendInvoiceAfterCreate')}
                    </Label>
                  </div>
                </div>
              )}
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="vorkasseInvoiceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('adminDocuments.vorkasseInvoiceNumber')}</FormLabel>
              <FormControl>
                <Input placeholder={t('adminDocuments.vorkasseInvoiceNumberPlaceholder')} className="font-mono" {...field} data-testid="input-vorkasse-invoice-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="deliveryNoteNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('adminDocuments.deliveryNote')}</FormLabel>
              <FormControl>
                <Input placeholder={t('adminDocuments.deliveryNotePlaceholder')} className="font-mono" {...field} data-testid="input-delivery-note-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="erpNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('adminDocuments.erpNumber')}</FormLabel>
              <FormControl>
                <Input placeholder={t('adminDocuments.erpNumberPlaceholder')} className="font-mono" {...field} data-testid="input-erp-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-documents">
              {t('common.cancel')}
            </Button>
          )}
          <Button type="submit" data-testid="button-save-documents">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
