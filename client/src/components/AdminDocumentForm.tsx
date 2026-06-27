import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
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

  const handleSubmit = (data: AdminDocumentFormData) => {
    onSubmit(data);
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
