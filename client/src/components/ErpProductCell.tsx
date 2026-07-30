import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import type { ErpProductLabel } from "@shared/productVariantLabel";
import { buildErpProductLabel } from "@shared/productVariantLabel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

export function ErpProductCell({
  productNumber,
  label,
  showActiveToggle = false,
}: {
  productNumber: string;
  label?: ErpProductLabel | null;
  /** Active/Inaktiv umschalten (Shopware + Mirror) */
  showActiveToggle?: boolean;
}) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const resolved = label || buildErpProductLabel({ productNumber });
  const attrs = [
    resolved.size ? `${t("erp.size")}: ${resolved.size}` : null,
    resolved.color ? `${t("erp.color")}: ${resolved.color}` : null,
  ].filter(Boolean);
  const isInactive = resolved.active === false;

  const toggleActive = useMutation({
    mutationFn: async (active: boolean) => {
      const res = await apiRequest("PATCH", "/api/erp/products/active", {
        productNumber: resolved.productNumber,
        shopwareId: resolved.shopwareId || undefined,
        active,
      });
      return res.json();
    },
    onSuccess: (_data, active) => {
      queryClient.invalidateQueries({ queryKey: ["/api/erp/product-labels"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/stock/reconcile"] });
      queryClient.invalidateQueries({ queryKey: ["/api/erp/products/search"] });
      toast({
        title: active ? t("erp.productActivated") : t("erp.productDeactivated"),
      });
    },
    onError: (e: Error) =>
      toast({ title: t("errors.failed"), description: e.message, variant: "destructive" }),
  });

  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <div className="flex items-center gap-2 min-w-0 flex-wrap">
        <span className="font-mono text-sm font-medium">{resolved.productNumber}</span>
        {isInactive ? (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {t("erp.inactive")}
          </Badge>
        ) : null}
        {resolved.isParent ? (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            {t("erp.parentProduct")}
          </Badge>
        ) : null}
      </div>
      {resolved.name ? (
        <span className="text-sm truncate" title={resolved.name}>
          {resolved.name}
        </span>
      ) : null}
      {attrs.length > 0 ? (
        <span className="text-xs text-muted-foreground">{attrs.join(" · ")}</span>
      ) : resolved.optionsLabel ? (
        <span className="text-xs text-muted-foreground truncate">{resolved.optionsLabel}</span>
      ) : null}
      {showActiveToggle && !resolved.isParent ? (
        <div className="pt-1">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={toggleActive.isPending}
            onClick={() => toggleActive.mutate(isInactive)}
          >
            {isInactive ? t("erp.activate") : t("erp.deactivate")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
