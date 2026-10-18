import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Copy, KeyRound, Loader2, ShieldAlert, ShoppingCart, Trash2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { SHOP_PULSE_CART_RULES, type ShopPulseCartOverview, type ShopPulseCartSettingsUpdate, type ShopPulseCartState } from "@shared/shopPulseCart";

/**
 * Shop-Puls, Reiter „Warenkorb-Alarm“ (Stufe 2, S2-3): Schalter (Standard aus, erst nach Freigabe durch den
 * Datenschutzbeauftragten), Schwelle, Wartezeit, Ersatz-Empfänger, Angaben für das Plugin (Adresse,
 * Mandanten-ID, Schlüssel erzeugen) und die gemeldeten Warenkörbe mit Stand. Server:
 * server/routes/shopPulseCartRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/cart-alarm"];

const STATE_CLASS: Record<ShopPulseCartState, string> = {
  waiting: "",
  alarmed: "border-amber-600 text-amber-800 dark:text-amber-300",
  ordered: "text-muted-foreground",
  won: "border-emerald-600 text-emerald-800 dark:text-emerald-300",
  below: "text-muted-foreground",
};

export function ShopPulseCartTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useQuery<ShopPulseCartOverview>({ queryKey: QUERY_KEY });
  const [secret, setSecret] = useState<string | null>(null);
  const [form, setForm] = useState({ thresholdNet: "", waitHours: "", fallbackEmail: "", fallbackName: "" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const data = query.data;

  useEffect(() => {
    if (!data) return;
    setForm({
      thresholdNet: String(data.settings.thresholdNet),
      waitHours: String(data.settings.waitHours),
      fallbackEmail: data.settings.fallbackEmail,
      fallbackName: data.settings.fallbackName,
    });
  }, [data?.settings.thresholdNet, data?.settings.waitHours, data?.settings.fallbackEmail, data?.settings.fallbackName]);

  const save = useMutation({
    mutationFn: async (update: ShopPulseCartSettingsUpdate) => (await apiRequest("PUT", "/api/shop-pulse/cart-alarm/settings", update)).json() as Promise<ShopPulseCartOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast({ title: t("shopPulse.cart.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.cart.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const rotate = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/shop-pulse/cart-alarm/secret")).json() as Promise<ShopPulseCartOverview & { secret: string }>,
    onSuccess: (next) => {
      const { secret: created, ...rest } = next;
      queryClient.setQueryData(QUERY_KEY, rest);
      setSecret(created);
    },
    onError: (error: Error) => toast({ title: t("shopPulse.cart.secretFailed"), description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: async () => (await apiRequest("DELETE", "/api/shop-pulse/cart-alarm/carts")).json() as Promise<ShopPulseCartOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      setConfirmDelete(false);
      toast({ title: t("shopPulse.cart.deleted") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.cart.deleteFailed"), description: error.message, variant: "destructive" }),
  });

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t("shopPulse.cart.copied") });
    } catch {
      toast({ title: t("shopPulse.cart.copyFailed"), variant: "destructive" });
    }
  };

  if (query.isLoading) {
    return (
      <Card className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("shopPulse.loading")}
      </Card>
    );
  }
  if (query.isError || !data) return <Card className="p-4 text-sm text-destructive">{t("shopPulse.cart.loadError")}</Card>;

  const threshold = Number(form.thresholdNet.replace(",", "."));
  const wait = Number(form.waitHours.replace(",", "."));
  const formValid = Number.isFinite(threshold) && threshold >= 0 && Number.isFinite(wait) && wait >= 1 && wait <= 336 && (form.fallbackEmail.trim() === "" || /^\S+@\S+\.\S+$/.test(form.fallbackEmail.trim()));
  const busy = save.isPending || rotate.isPending || remove.isPending;

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-4" data-testid="shop-pulse-cart-settings">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-3xl">
            <h2 className="font-semibold flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
              {t("shopPulse.cart.title")}
            </h2>
            <p className="text-sm text-muted-foreground">{t("shopPulse.cart.hint", SHOP_PULSE_CART_RULES)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="shop-pulse-cart-enabled" checked={data.settings.enabled} disabled={busy} onCheckedChange={(enabled) => save.mutate({ enabled })} data-testid="switch-shop-pulse-cart-enabled" />
            <Label htmlFor="shop-pulse-cart-enabled">{t("shopPulse.cart.enable")}</Label>
          </div>
        </div>
        <p className="flex items-start gap-2 rounded-md border border-amber-600/40 bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200" role="note">
          <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          {t("shopPulse.cart.privacy")}
        </p>
        <form
          className="grid gap-3 md:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (formValid) save.mutate({ thresholdNet: threshold, waitHours: wait, fallbackEmail: form.fallbackEmail.trim(), fallbackName: form.fallbackName.trim() });
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-cart-threshold">{t("shopPulse.cart.threshold")}</Label>
            <Input id="shop-pulse-cart-threshold" inputMode="decimal" value={form.thresholdNet} onChange={(e) => setForm({ ...form, thresholdNet: e.target.value })} data-testid="input-shop-pulse-cart-threshold" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-cart-wait">{t("shopPulse.cart.wait")}</Label>
            <Input id="shop-pulse-cart-wait" inputMode="numeric" value={form.waitHours} onChange={(e) => setForm({ ...form, waitHours: e.target.value })} data-testid="input-shop-pulse-cart-wait" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-cart-fallback-email">{t("shopPulse.cart.fallbackEmail")}</Label>
            <Input
              id="shop-pulse-cart-fallback-email"
              type="email"
              value={form.fallbackEmail}
              placeholder={t("shopPulse.cart.fallbackPlaceholder")}
              aria-describedby="shop-pulse-cart-fallback-hint"
              onChange={(e) => setForm({ ...form, fallbackEmail: e.target.value })}
              data-testid="input-shop-pulse-cart-fallback-email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="shop-pulse-cart-fallback-name">{t("shopPulse.cart.fallbackName")}</Label>
            <Input id="shop-pulse-cart-fallback-name" value={form.fallbackName} maxLength={120} onChange={(e) => setForm({ ...form, fallbackName: e.target.value })} data-testid="input-shop-pulse-cart-fallback-name" />
          </div>
          <p id="shop-pulse-cart-fallback-hint" className="text-xs text-muted-foreground md:col-span-2">
            {t("shopPulse.cart.recipientHint")} {data.mailConfigured ? t("shopPulse.cart.mailOn") : t("shopPulse.cart.mailOff")}
          </p>
          <div className="md:col-span-2">
            <Button type="submit" disabled={!formValid || busy} data-testid="button-shop-pulse-cart-save">
              {save.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {t("shopPulse.cart.save")}
            </Button>
          </div>
        </form>
      </Card>

      <Card className="p-4 space-y-3" data-testid="shop-pulse-cart-plugin">
        <h3 className="font-medium flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          {t("shopPulse.cart.pluginTitle")}
        </h3>
        <p className="text-sm text-muted-foreground max-w-3xl">{t("shopPulse.cart.pluginHint")}</p>
        <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t("shopPulse.cart.endpoint")}</dt>
          <dd className="break-all font-mono text-xs">{data.endpointUrl ?? "–"}</dd>
          <dt className="text-muted-foreground">{t("shopPulse.cart.tenant")}</dt>
          <dd className="break-all font-mono text-xs">{data.tenantId ?? "–"}</dd>
          <dt className="text-muted-foreground">{t("shopPulse.cart.secret")}</dt>
          <dd>{data.hasSecret ? t("shopPulse.cart.secretSet") : t("shopPulse.cart.secretNone")}</dd>
          <dt className="text-muted-foreground">{t("shopPulse.cart.lastSignal")}</dt>
          <dd>{data.lastSignalAt ? fmt.dateTime(data.lastSignalAt) : t("shopPulse.cart.lastSignalNone")}</dd>
        </dl>
        {secret ? (
          <div className="rounded-md border bg-muted/40 p-3 space-y-2" role="status" data-testid="shop-pulse-cart-secret">
            <p className="text-sm">{t("shopPulse.cart.secretOnce")}</p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all text-xs">{secret}</code>
              <Button size="sm" variant="outline" onClick={() => copy(secret)} data-testid="button-shop-pulse-cart-secret-copy">
                <Copy className="h-4 w-4 mr-1" aria-hidden="true" />
                {t("shopPulse.cart.copy")}
              </Button>
            </div>
          </div>
        ) : null}
        <Button size="sm" variant="outline" disabled={busy} onClick={() => rotate.mutate()} data-testid="button-shop-pulse-cart-secret">
          {rotate.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <KeyRound className="h-4 w-4 mr-1" aria-hidden="true" />}
          {data.hasSecret ? t("shopPulse.cart.secretRotate") : t("shopPulse.cart.secretCreate")}
        </Button>
      </Card>

      <Card className="overflow-x-auto" data-testid="shop-pulse-cart-list">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4">
          <h3 className="font-medium">{t("shopPulse.cart.listTitle", { count: data.carts.length })}</h3>
          {data.carts.length ? (
            confirmDelete ? (
              <div className="flex items-center gap-2" role="group" aria-label={t("shopPulse.cart.confirmDelete")}>
                <span className="text-xs">{t("shopPulse.cart.confirmDelete")}</span>
                <Button size="sm" variant="destructive" disabled={busy} onClick={() => remove.mutate()} data-testid="button-shop-pulse-cart-delete-confirm">
                  {t("shopPulse.cart.delete")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  {t("shopPulse.signals.cancel")}
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} data-testid="button-shop-pulse-cart-delete">
                <Trash2 className="h-4 w-4 mr-1" aria-hidden="true" />
                {t("shopPulse.cart.delete")}
              </Button>
            )
          ) : null}
        </div>
        {data.carts.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">{data.settings.enabled ? t("shopPulse.cart.empty") : t("shopPulse.cart.emptyOff")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopPulse.cart.columns.customer")}</TableHead>
                <TableHead>{t("shopPulse.cart.columns.contact")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.cart.columns.net")}</TableHead>
                <TableHead>{t("shopPulse.cart.columns.updated")}</TableHead>
                <TableHead>{t("shopPulse.cart.columns.state")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.carts.map((c) => (
                <TableRow key={c.id} data-testid={`row-shop-pulse-cart-${c.customerNumber}`}>
                  <TableCell className="align-top text-sm">
                    <div className="font-medium">{c.company || "–"}</div>
                    <div className="text-xs text-muted-foreground">{c.customerNumber}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <div>{c.contactName || "–"}</div>
                    <div className="text-xs text-muted-foreground break-all">{[c.contactEmail, c.contactPhone].filter(Boolean).join(" · ")}</div>
                  </TableCell>
                  <TableCell className="align-top text-right text-sm whitespace-nowrap">
                    <div>{fmt.currency(c.netTotal)}</div>
                    <div className="text-xs text-muted-foreground">{t("shopPulse.cart.positions", { count: c.positionCount })}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm whitespace-nowrap">{fmt.dateTime(c.cartUpdatedAt)}</TableCell>
                  <TableCell className="align-top text-sm">
                    <Badge variant="outline" className={STATE_CLASS[c.state]}>
                      {t(`shopPulse.cart.states.${c.state}`)}
                    </Badge>
                    {c.alarmedAt ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        {t("shopPulse.cart.alarmedTo", { date: fmt.dateTime(c.alarmedAt), to: c.alarmRecipient ?? "–" })}
                        {c.alarmMailed ? ` · ${t("shopPulse.cart.mailed")}` : ""}
                      </div>
                    ) : null}
                    {c.orderedAt ? <div className="text-xs text-muted-foreground">{t("shopPulse.cart.orderedAt", { date: fmt.dateTime(c.orderedAt), order: c.orderNumber ?? "–" })}</div> : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
