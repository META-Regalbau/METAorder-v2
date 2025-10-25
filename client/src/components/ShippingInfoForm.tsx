import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

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
      title: "Shipping information updated",
      description: "The shipping details have been saved successfully.",
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
              <FormLabel className="font-medium">Carrier</FormLabel>
              <FormControl>
                <Input placeholder="e.g., DHL, UPS, FedEx" {...field} data-testid="input-carrier" />
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
              <FormLabel className="font-medium">Tracking Number</FormLabel>
              <FormControl>
                <Input placeholder="Enter tracking number" className="font-mono" {...field} data-testid="input-tracking-number" />
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
              <FormLabel className="font-medium">Shipped Date</FormLabel>
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
              Cancel
            </Button>
          )}
          <Button type="submit" data-testid="button-save-shipping">
            Save Shipping Info
          </Button>
        </div>
      </form>
    </Form>
  );
}
