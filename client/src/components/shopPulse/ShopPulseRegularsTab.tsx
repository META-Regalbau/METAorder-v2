import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Loader2 } from "lucide-react";
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
import type { ShopPulseRegularCause, ShopPulseRegularSettings, ShopPulseRegularsOverview, ShopPulseRegularState } from "@shared/shopPulseRegulars";

/**
 * Shop-Puls, Reiter „Stammkunden“ (Stufe 3, S3-4): Schwellen (einstellbar), Stammkunden mit üblichem
 * Bestellabstand, Stand (überfällig, gemeldet, wieder bestellt), Empfänger und mögliche Ursache; „Jetzt
 * melden“ für Überfällige und den Altbestand. Server: server/routes/shopPulseRegularRoutes.ts.
 */

const QUERY_KEY = ["/api/shop-pulse/regulars"];
const NUMBER_FIELDS = ["minOrders", "minAnnualRevenue", "overdueFactor", "minDaysSinceLast"] as const;
type NumberField = (typeof NUMBER_FIELDS)[number];

const STATE_CLASS: Record<ShopPulseRegularState, string> = {
  ok: "text-muted-foreground",
  overdue: "border-amber-600 text-amber-800 dark:text-amber-300",
  backlog: "border-amber-600 text-amber-800 dark:text-amber-300",
  alerted: "border-blue-600 text-blue-800 dark:text-blue-300",
  won: "border-emerald-600 text-emerald-800 dark:text-emerald-300",
};

export function ShopPulseRegularsTab() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const query = useQuery<ShopPulseRegularsOverview>({ queryKey: QUERY_KEY });
  const data = query.data;
  const [form, setForm] = useState<Record<NumberField, string>>({ minOrders: "", minAnnualRevenue: "", overdueFactor: "", minDaysSinceLast: "" });

  useEffect(() => {
    if (!data) return;
    setForm(Object.fromEntries(NUMBER_FIELDS.map((f) => [f, String(data.settings[f])])) as Record<NumberField, string>);
  }, [data?.settings.minOrders, data?.settings.minAnnualRevenue, data?.settings.overdueFactor, data?.settings.minDaysSinceLast]);

  const save = useMutation({
    mutationFn: async (update: Partial<ShopPulseRegularSettings>) => (await apiRequest("PUT", "/api/shop-pulse/regulars/settings", update)).json() as Promise<ShopPulseRegularsOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast({ title: t("shopPulse.regulars.saved") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.regulars.saveFailed"), description: error.message, variant: "destructive" }),
  });
  const alert = useMutation({
    mutationFn: async (customerNumber: string) => (await apiRequest("POST", `/api/shop-pulse/regulars/${encodeURIComponent(customerNumber)}/alert`)).json() as Promise<ShopPulseRegularsOverview>,
    onSuccess: (next) => {
      queryClient.setQueryData(QUERY_KEY, next);
      toast({ title: t("shopPulse.regulars.alerted") });
    },
    onError: (error: Error) => toast({ title: t("shopPulse.regulars.alertFailed"), description: error.message, variant: "destructive" }),
  });

  if (query.isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("shopPulse.loading")}
      </div>
    );
  }
  if (query.isError || !data) return <Card className="p-4 text-sm text-destructive">{t("shopPulse.regulars.loadError")}</Card>;

  const causeText = (c: ShopPulseRegularCause) =>
    c.kind === "price"
      ? t("shopPulse.regulars.causes.price", { name: c.name, old: fmt.currency(c.oldPrice), new: fmt.currency(c.newPrice), percent: fmt.percentValue(c.percent, 1) })
      : t(`shopPulse.regulars.causes.${c.detail}`, { name: c.name, days: c.days ?? 0 });
  const parsed = Object.fromEntries(NUMBER_FIELDS.map((f) => [f, Number(form[f].replace(",", "."))])) as Record<NumberField, number>;
  const valid = NUMBER_FIELDS.every((f) => form[f].trim() !== "" && Number.isFinite(parsed[f]));

  return (
    <div className="space-y-4">
      <Card className="p-4 space-y-3" data-testid="shop-pulse-regulars-settings">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1 max-w-3xl">
            <h2 className="font-semibold">{t("shopPulse.regulars.title")}</h2>
            <p className="text-sm text-muted-foreground">{t("shopPulse.regulars.hint")}</p>
          </div>
          <div className="flex items-center gap-2">
            <Switch id="shop-pulse-regulars-enabled" checked={data.settings.enabled} disabled={save.isPending} onCheckedChange={(enabled) => save.mutate({ enabled })} data-testid="switch-shop-pulse-regulars" />
            <Label htmlFor="shop-pulse-regulars-enabled">{t("shopPulse.regulars.enable")}</Label>
          </div>
        </div>
        <form
          className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 items-end"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) save.mutate({ minOrders: Math.round(parsed.minOrders), minAnnualRevenue: parsed.minAnnualRevenue, overdueFactor: parsed.overdueFactor, minDaysSinceLast: Math.round(parsed.minDaysSinceLast) });
          }}
        >
          {NUMBER_FIELDS.map((f) => (
            <div key={f} className="space-y-1">
              <Label htmlFor={`shop-pulse-regulars-${f}`}>{t(`shopPulse.regulars.fields.${f}`)}</Label>
              <Input id={`shop-pulse-regulars-${f}`} inputMode="decimal" value={form[f]} onChange={(e) => setForm({ ...form, [f]: e.target.value })} data-testid={`input-shop-pulse-regulars-${f}`} />
            </div>
          ))}
          <Button type="submit" disabled={!valid || save.isPending} data-testid="button-shop-pulse-regulars-save">
            {t("shopPulse.regulars.save")}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          {data.lastRunAt ? t("shopPulse.regulars.lastRun", { at: fmt.dateTime(data.lastRunAt) }) : t("shopPulse.regulars.neverRun")}
        </p>
      </Card>

      <Card className="overflow-x-auto">
        {data.customers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground" data-testid="shop-pulse-regulars-empty">
            {t("shopPulse.regulars.empty")}
          </p>
        ) : (
          <Table data-testid="shop-pulse-regulars">
            <TableHeader>
              <TableRow>
                <TableHead>{t("shopPulse.regulars.columns.customer")}</TableHead>
                <TableHead>{t("shopPulse.regulars.columns.rhythm")}</TableHead>
                <TableHead className="text-right">{t("shopPulse.regulars.columns.revenue")}</TableHead>
                <TableHead>{t("shopPulse.regulars.columns.state")}</TableHead>
                <TableHead>{t("shopPulse.regulars.columns.details")}</TableHead>
                <TableHead>{t("shopPulse.regulars.columns.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.customers.map((c) => (
                <TableRow key={c.customerNumber} data-testid={`row-shop-pulse-regular-${c.customerNumber}`}>
                  <TableCell className="align-top">
                    <div className="font-medium">{c.company || c.contactName || c.customerNumber}</div>
                    <div className="text-xs text-muted-foreground">{t("shopPulse.regulars.customerNumber", { number: c.customerNumber })}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm">
                    <div>{t("shopPulse.regulars.rhythm", { days: fmt.number(c.usualGapDays, 1), orders: c.orders })}</div>
                    <div className="text-xs text-muted-foreground">{t("shopPulse.regulars.last", { at: fmt.date(c.lastOrderAt), days: c.daysSinceLast })}</div>
                  </TableCell>
                  <TableCell className="align-top text-sm text-right whitespace-nowrap">{fmt.currencyWhole(c.annualRevenue)}</TableCell>
                  <TableCell className="align-top text-sm">
                    <Badge variant="outline" className={STATE_CLASS[c.state]}>
                      {t(`shopPulse.regulars.states.${c.state}`)}
                    </Badge>
                    {c.alertedAt ? <div className="text-xs text-muted-foreground mt-1">{t("shopPulse.regulars.alertedAt", { at: fmt.dateTime(c.alertedAt) })}</div> : null}
                    {c.wonAt ? <div className="text-xs text-muted-foreground">{t("shopPulse.regulars.wonAt", { at: fmt.date(c.wonAt) })}</div> : null}
                    {c.recipient ? (
                      <div className="text-xs text-muted-foreground mt-1">
                        {c.recipient.source === "rep" ? t("shopPulse.regulars.toRep", { name: c.recipient.name }) : t("shopPulse.regulars.toOliver")}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top text-xs max-w-md">
                    {c.lastItems.length ? <div>{t("shopPulse.regulars.lastItems", { items: c.lastItems.map((i) => `${i.quantity}× ${i.name}`).join("; ") })}</div> : null}
                    {c.causes.length ? (
                      <ul className="mt-1 list-disc pl-4 text-amber-800 dark:text-amber-300">
                        {c.causes.map((x, i) => (
                          <li key={i}>{causeText(x)}</li>
                        ))}
                      </ul>
                    ) : null}
                  </TableCell>
                  <TableCell className="align-top">
                    {c.state === "overdue" || c.state === "backlog" ? (
                      <Button size="sm" variant="outline" disabled={alert.isPending} onClick={() => alert.mutate(c.customerNumber)} data-testid={`button-shop-pulse-regular-alert-${c.customerNumber}`}>
                        <BellRing className="h-4 w-4 mr-1" aria-hidden="true" />
                        {t("shopPulse.regulars.alertNow")}
                      </Button>
                    ) : null}
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
