import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, ShoppingBag } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopPulseMerchantOverview } from "@shared/shopPulse";

/**
 * Shop-Puls Stufe 3 (S3-6), Google Merchant Center (nur lesend): Schalter, Händler-ID, Dienstkonto-JSON (wird
 * nie angezeigt, nur ersetzt oder gelöscht), Stand der Einrichtung. Ohne Einrichtung setzt die Prüfung aus.
 * Server: server/routes/shopPulseMerchantRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/merchant-center"];

export function ShopPulseMerchantSettings() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const query = useQuery<ShopPulseMerchantOverview>({ queryKey: QUERY_KEY });
  const [merchantId, setMerchantId] = useState("");
  const [json, setJson] = useState("");
  const data = query.data;
  useEffect(() => {
    if (data) setMerchantId(data.merchantId);
  }, [data?.merchantId]);

  const save = useMutation({
    mutationFn: async (body: { enabled?: boolean; merchantId?: string; serviceAccountJson?: string }) =>
      (await apiRequest("PUT", "/api/shop-pulse/merchant-center/settings", body)).json() as Promise<ShopPulseMerchantOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setJson("");
      toast({ title: t("shopPulse.merchant.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.merchant.saveFailed"), description: error.message, variant: "destructive" }),
  });

  if (!data) return null;
  return (
    <Card className="p-4 space-y-3" data-testid="shop-pulse-merchant-settings">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-semibold flex items-center gap-2">
            <ShoppingBag className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("shopPulse.merchant.title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("shopPulse.merchant.hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="shop-pulse-merchant-enabled" checked={data.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate({ enabled })} data-testid="switch-shop-pulse-merchant" />
          <Label htmlFor="shop-pulse-merchant-enabled">{t("shopPulse.merchant.enable")}</Label>
        </div>
      </div>
      <form
        className="grid gap-3 md:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ merchantId: merchantId.trim(), ...(json.trim() ? { serviceAccountJson: json.trim() } : {}) });
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="shop-pulse-merchant-id">{t("shopPulse.merchant.merchantId")}</Label>
          <Input id="shop-pulse-merchant-id" inputMode="numeric" value={merchantId} placeholder="123456789" aria-describedby="shop-pulse-merchant-id-hint" onChange={(e) => setMerchantId(e.target.value)} data-testid="input-shop-pulse-merchant-id" />
          <p id="shop-pulse-merchant-id-hint" className="text-xs text-muted-foreground">
            {t("shopPulse.merchant.merchantIdHint")}
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="shop-pulse-merchant-json">{t("shopPulse.merchant.serviceAccount")}</Label>
          <Textarea
            id="shop-pulse-merchant-json"
            value={json}
            rows={3}
            autoComplete="off"
            spellCheck={false}
            placeholder={data.hasServiceAccount ? t("shopPulse.merchant.serviceAccountSet", { email: data.serviceAccountEmail ?? "–" }) : t("shopPulse.merchant.serviceAccountNone")}
            onChange={(e) => setJson(e.target.value)}
            data-testid="input-shop-pulse-merchant-json"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 md:col-span-2">
          <Button type="submit" disabled={save.isPending} data-testid="button-shop-pulse-merchant-save">
            {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
            {t("shopPulse.merchant.save")}
          </Button>
          {data.hasServiceAccount ? (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ serviceAccountJson: "" })}>
              {t("shopPulse.merchant.removeServiceAccount")}
            </Button>
          ) : null}
          <span className={`text-sm ${data.problem ? "text-amber-700 dark:text-amber-300" : ""}`} role="status" data-testid="text-shop-pulse-merchant-status">
            {data.problem ? t(`shopPulse.merchant.problems.${data.problem}`) : t("shopPulse.merchant.ready")}
          </span>
        </div>
      </form>
    </Card>
  );
}
