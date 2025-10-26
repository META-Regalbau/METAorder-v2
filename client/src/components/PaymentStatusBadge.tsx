import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { PaymentStatus } from "@shared/schema";

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  orderId: string;
}

const paymentStatusConfig: Record<PaymentStatus, { variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { variant: "secondary" },
  paid: { variant: "default" },
  partially_paid: { variant: "outline" },
  refunded: { variant: "outline" },
  cancelled: { variant: "destructive" },
  reminded: { variant: "secondary" },
  failed: { variant: "destructive" },
};

export default function PaymentStatusBadge({ status, orderId }: PaymentStatusBadgeProps) {
  const { t } = useTranslation();
  const config = paymentStatusConfig[status];
  
  return (
    <Badge 
      variant={config.variant} 
      className="font-medium uppercase text-xs tracking-wide" 
      data-testid={`badge-payment-status-${orderId}`}
    >
      {t(`paymentStatus.${status}`)}
    </Badge>
  );
}
