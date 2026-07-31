import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { PaymentStatus } from "@shared/schema";

interface PaymentStatusBadgeProps {
  status: PaymentStatus;
  orderId: string;
}

const paymentStatusConfig: Record<PaymentStatus, { variant: "secondary" | "warning" | "success" | "destructive" }> = {
  open: { variant: "warning" },
  paid: { variant: "success" },
  authorized: { variant: "warning" },
  partially_paid: { variant: "warning" },
  refunded: { variant: "secondary" },
  cancelled: { variant: "destructive" },
  reminded: { variant: "warning" },
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
