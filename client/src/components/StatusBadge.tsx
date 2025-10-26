import { Badge } from "@/components/ui/badge";
import { useTranslation } from "react-i18next";
import type { OrderStatus } from "@shared/schema";

interface StatusBadgeProps {
  status: OrderStatus;
}

const statusConfig: Record<OrderStatus, { variant: "default" | "secondary" | "outline" | "destructive" }> = {
  open: { variant: "secondary" },
  in_progress: { variant: "default" },
  completed: { variant: "outline" },
  cancelled: { variant: "destructive" },
};

export default function StatusBadge({ status }: StatusBadgeProps) {
  const { t } = useTranslation();
  const config = statusConfig[status];
  
  return (
    <Badge variant={config.variant} className="font-medium uppercase text-xs tracking-wide" data-testid={`badge-status-${status}`}>
      {t(`status.${status}`)}
    </Badge>
  );
}
