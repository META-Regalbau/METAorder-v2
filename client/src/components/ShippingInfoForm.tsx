import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";

const shippingInfoSchema = z.object({
  carrier: z.string().min(1, "Carrier is required"),
  trackingNumber: z.string().min(1, "Tracking number is required"),
  shippedDate: z.string().min(1, "Shipped date is required"),
});

type ShippingInfoFormData = z.infer<typeof shippingInfoSchema>;

interface ShippingInfoFormProps {
  defaultValues?: Partial<ShippingInfoFormData>;
  onSubmit: (data: ShippingInfoFormData) => void;
  onCancel?: () => void;
}

export default function ShippingInfoForm({ defaultValues, onSubmit, onCancel }: ShippingInfoFormProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  
  const form = useForm<ShippingInfoFormData>({
    resolver: zodResolver(shippingInfoSchema),
    defaultValues: {
      carrier: defaultValues?.carrier || "",
      trackingNumber: defaultValues?.trackingNumber || "",
      shippedDate: defaultValues?.shippedDate || "",
    },
  });

  const handleSubmit = (data: ShippingInfoFormData) => {
    console.log("Shipping info submitted:", data);
    onSubmit(data);
    toast({
      title: t('orderDetail.shippingUpdated'),
      description: t('orderDetail.shippingSuccess'),
    });
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
        <FormField
          control={form.control}
          name="carrier"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('shipping.carrier')}</FormLabel>
              <FormControl>
                <Input placeholder={t('shipping.carrierPlaceholder')} {...field} data-testid="input-carrier" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="trackingNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('shipping.trackingNumber')}</FormLabel>
              <FormControl>
                <Input placeholder={t('shipping.trackingPlaceholder')} className="font-mono" {...field} data-testid="input-tracking-number" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <FormField
          control={form.control}
          name="shippedDate"
          render={({ field }) => (
            <FormItem>
              <FormLabel className="font-medium">{t('shipping.shippedDate')}</FormLabel>
              <FormControl>
                <Input type="date" {...field} data-testid="input-shipped-date" />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        <div className="flex justify-end gap-2 pt-2">
          {onCancel && (
            <Button type="button" variant="outline" onClick={onCancel} data-testid="button-cancel-shipping">
              {t('common.cancel')}
            </Button>
          )}
          <Button type="submit" data-testid="button-save-shipping">
            {t('common.save')}
          </Button>
        </div>
      </form>
    </Form>
  );
}
