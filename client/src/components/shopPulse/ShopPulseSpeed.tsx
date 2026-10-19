import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Gauge, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { ShopPulseSpeedOverview } from "@shared/shopPulse";

/**
 * Shop-Puls Stufe 3 (S3-5), Karte „Ladezeit“: PageSpeed-Insights-Schlüssel (verschlüsselt gespeichert),
 * Schalter, feste Produktseite (leer = umsatzstärkster Artikel) und die letzte Messung je Seitentyp mit
 * Labor- und Felddaten. Ohne Schlüssel: Hinweis „nicht eingerichtet“. Server: server/routes/shopPulseSpeedRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/speed"];

export function ShopPulseSpeed() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useQuery<ShopPulseSpeedOverview>({ queryKey: QUERY_KEY });
  const data = query.data;
  const [apiKey, setApiKey] = useState("");
  const [productPath, setProductPath] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: async (body: Record<string, unknown>) => (await apiRequest("PUT", "/api/shop-pulse/speed/settings", body)).json() as Promise<ShopPulseSpeedOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setApiKey("");
      setProductPath(null);
      toast({ title: t("shopPulse.speed.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.speed.saveFailed"), description: error.message, variant: "destructive" }),
  });
  if (!data) return null;
  const latest = data.days[0];
  const previous = data.days[1];
  const sec = (ms: number | null | undefined) => (typeof ms === "number" ? t("shopPulse.speed.seconds", { value: fmt.decimal(ms / 1000, 1) }) : "–");
  const product = productPath ?? data.paths.product;

  return (
    <Card className="p-4 space-y-3" data-testid="shop-pulse-speed">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 max-w-3xl">
          <h2 className="font-semibold flex items-center gap-2">
            <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            {t("shopPulse.speed.title")}
          </h2>
          <p className="text-xs text-muted-foreground">{t("shopPulse.speed.hint")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Switch id="shop-pulse-speed-enabled" checked={data.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate({ enabled })} data-testid="switch-shop-pulse-speed" />
          <Label htmlFor="shop-pulse-speed-enabled">{t("shopPulse.speed.enable")}</Label>
        </div>
      </div>
      {data.problem ? (
        <p className="text-sm text-amber-700 dark:text-amber-300" role="note" data-testid="text-shop-pulse-speed-problem">
          {t(`shopPulse.speed.problems.${data.problem}`)}
        </p>
      ) : null}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const body: Record<string, unknown> = {};
          if (apiKey.trim()) body.apiKey = apiKey.trim();
          if (productPath !== null) body.paths = { product: productPath.trim() };
          if (Object.keys(body).length) save.mutate(body);
        }}
      >
        <div className="space-y-1 min-w-0 flex-1 basis-64">
          <Label htmlFor="shop-pulse-speed-key">{t("shopPulse.speed.keyLabel")}</Label>
          <Input id="shop-pulse-speed-key" type="password" autoComplete="off" value={apiKey} placeholder={data.hasKey ? t("shopPulse.speed.keySet") : t("shopPulse.speed.keyPlaceholder")} onChange={(e) => setApiKey(e.target.value)} data-testid="input-shop-pulse-speed-key" />
        </div>
        <div className="space-y-1 min-w-0 flex-1 basis-64">
          <Label htmlFor="shop-pulse-speed-product">{t("shopPulse.speed.productLabel")}</Label>
          <Input id="shop-pulse-speed-product" value={product} placeholder={t("shopPulse.speed.productPlaceholder")} onChange={(e) => setProductPath(e.target.value)} data-testid="input-shop-pulse-speed-product" />
        </div>
        <Button type="submit" disabled={save.isPending || (!apiKey.trim() && productPath === null)} data-testid="button-shop-pulse-speed-save">
          {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
          {t("shopPulse.speed.save")}
        </Button>
        {data.hasKey ? (
          <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate({ apiKey: "" })} data-testid="button-shop-pulse-speed-key-remove">
            {t("shopPulse.speed.keyRemove")}
          </Button>
        ) : null}
      </form>
      <p className="text-xs text-muted-foreground">{t("shopPulse.speed.keyHelp")}</p>
      {latest ? (
        <div className="overflow-x-auto">
          <p className="text-xs text-muted-foreground mb-1">{t("shopPulse.speed.measuredAt", { at: fmt.dateTime(latest.at) })}</p>
          <Table data-testid="table-shop-pulse-speed">
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopPulse.speed.columns.page")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.speed.columns.score")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.speed.columns.lcp")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.speed.columns.tbt")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.speed.columns.cls")}</TableHead>
                <TableHead>{t("shopPulse.speed.columns.field")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {latest.results.map((r) => {
                const prev = previous?.results.find((p) => p.type === r.type);
                return (
                  <TableRow key={r.type}>
                    <TableCell className="text-sm">
                      <div>{t(`shopPulse.speed.pages.${r.type}`)}</div>
                      <div className="text-xs text-muted-foreground break-all">{r.url}</div>
                      {r.error ? <div className="text-xs text-destructive">{r.error}</div> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">
                      {r.score ?? "–"}
                      {prev?.score != null && r.score != null ? <div className="text-xs text-muted-foreground">{t("shopPulse.speed.previous", { value: prev.score })}</div> : null}
                    </TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">{sec(r.lcpMs)}</TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">{typeof r.tbtMs === "number" ? t("shopPulse.speed.ms", { value: fmt.integer(r.tbtMs) }) : "–"}</TableCell>
                    <TableCell className="text-right text-sm whitespace-nowrap">{typeof r.cls === "number" ? fmt.decimal(r.cls, 2) : "–"}</TableCell>
                    <TableCell className="text-xs">
                      {r.field
                        ? t(r.field.source === "url" ? "shopPulse.speed.fieldUrl" : "shopPulse.speed.fieldOrigin", {
                            lcp: sec(r.field.lcpMs),
                            inp: typeof r.field.inpMs === "number" ? t("shopPulse.speed.ms", { value: fmt.integer(r.field.inpMs) }) : "–",
                            cls: typeof r.field.cls === "number" ? fmt.decimal(r.field.cls, 2) : "–",
                          })
                        : t("shopPulse.speed.noField")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">{t("shopPulse.speed.none")}</p>
      )}
    </Card>
  );
}
