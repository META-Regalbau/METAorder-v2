/**
 * DiscountTrafficLight - Live-Bewertung des Rabatts (CPQ Rabatt-Ampel)
 */

import { useQuery } from "@tanstack/react-query";

type DiscountLevelResult = {
  id: string;
  name: string;
  color: string;
  discountMin: number;
  discountMax: number;
  messageTemplate: string | null;
  approvalType: string;
  revenueLoss?: number;
  listPrice?: number;
  discountedPrice?: number;
};

type DiscountTrafficLightProps = {
  listPrice: number;
  discountedPrice: number;
  systemId?: string;
  customerGroup?: string;
  orderValue?: number;
};

function interpolateMessage(template: string | null, vars: Record<string, string | number>): string {
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ""));
}

export default function DiscountTrafficLight({
  listPrice,
  discountedPrice,
  systemId,
  customerGroup,
  orderValue,
}: DiscountTrafficLightProps) {
  const discountPercent = listPrice > 0 ? ((listPrice - discountedPrice) / listPrice) * 100 : 0;
  const revenueLoss = listPrice - discountedPrice;

  const { data: level, isLoading } = useQuery<DiscountLevelResult | null>({
    queryKey: ["/api/cpq/discount-levels/evaluate", discountPercent, systemId, customerGroup, orderValue],
    queryFn: async () => {
      const params = new URLSearchParams({
        discount: discountPercent.toFixed(2),
        ...(systemId && { system_id: systemId }),
        ...(customerGroup && { customer_group: customerGroup }),
        ...(orderValue != null && { order_value: String(orderValue) }),
      });
      const res = await fetch(`/api/cpq/discount-levels/evaluate?${params}`, { credentials: "include" });
      if (!res.ok) return null;
      const data = await res.json();
      return data ? { ...data, revenueLoss, listPrice, discountedPrice } : null;
    },
    enabled: listPrice > 0,
  });

  if (isLoading || !level) {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 text-sm text-muted-foreground">
        <div className="w-3 h-3 rounded-full bg-muted animate-pulse" />
        Rabatt-Bewertung wird berechnet…
      </div>
    );
  }

  const message = interpolateMessage(level.messageTemplate, {
    verlust: revenueLoss.toFixed(2),
    marge: listPrice > 0 ? ((discountedPrice / listPrice) * 100).toFixed(1) : "0",
    rabatt: discountPercent.toFixed(1),
    max_rabatt: level.discountMax?.toString() ?? "",
  });

  const approvalLabel =
    level.approvalType === "none"
      ? "Keine Freigabe erforderlich"
      : level.approvalType === "department_lead"
        ? "Freigabe durch Abteilungsleiter"
        : level.approvalType === "management"
          ? "Freigabe durch Geschäftsführung"
          : level.approvalType === "blocked"
            ? "Nicht freigabefähig"
            : level.approvalType;

  return (
    <div
      className="flex flex-col gap-2 p-4 rounded-lg border"
      style={{ borderLeftColor: level.color, borderLeftWidth: "4px" }}
    >
      <div className="flex items-center gap-3">
        <div
          className="w-4 h-4 rounded-full shrink-0"
          style={{ backgroundColor: level.color }}
        />
        <div className="flex-1 min-w-0">
          <div className="font-medium">{level.name}</div>
          <div className="text-xs text-muted-foreground">{approvalLabel}</div>
        </div>
        <div className="text-right shrink-0">
          <div className="font-semibold">{discountPercent.toFixed(1)}% Rabatt</div>
          {revenueLoss > 0 && (
            <div className="text-xs text-muted-foreground">Umsatzverlust: €{revenueLoss.toFixed(2)}</div>
          )}
        </div>
      </div>
      {message && <p className="text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
