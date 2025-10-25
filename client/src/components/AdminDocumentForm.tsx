import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const adminDocumentSchema = z.object({
  invoiceNumber: z.string().optional(),
  deliveryNoteNumber: z.string().optional(),
  erpNumber: z.string().optional(),
});

type AdminDocumentFormData = z.infer<typeof adminDocumentSchema>;

interface AdminDocumentFormProps {
  defaultValues?: Partial<AdminDocumentFormData>;
  onSubmit: (data: AdminDocumentFormData) => void;
  onCancel?: () => void;
}

export default function AdminDocumentForm({ defaultValues, onSubmit, onCancel }: AdminDocumentFormProps) {
  const { toast } = useToast();
  
  const form = useForm<AdminDocumentFormData>({
    resolver: zodResolver(adminDocumentSchema),
    defaultValues: {
      invoiceNumber: defaultValues?.invoiceNumber || "",
      deliveryNoteNumber: defaultValues?.deliveryNoteNumber || "",
      erpNumber: defaultValues?.erpNumber || "",
    },
  });

  const handleSubmit = (data: AdminDocumentFormData) => {
    console.log("Admin document info submitted:", data);
    onSubmit(data);
    toast({
      title: "Document numbers updated",
      description: "The document information has been saved successfully.",
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="invoiceNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">Invoice Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter invoice number" className="font-mono" {...field} data-testid="input-invoice-number" />
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
              <FormLabel className="font-medium">Delivery Note Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter delivery note number" className="font-mono" {...field} data-testid="input-delivery-note-number" />
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
              <FormLabel className="font-medium">ERP Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter ERP number" className="font-mono" {...field} data-testid="input-erp-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-documents">
              Cancel
            </Button>
          )}
          <Button type="submit" data-testid="button-save-documents">
            Save Document Numbers
          </Button>
        </div>
      </form>
    </Form>
  );
}
