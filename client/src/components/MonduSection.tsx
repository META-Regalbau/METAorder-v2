import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Loader2, Mail, RefreshCw, Send, XCircle } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useLocaleFormat } from "@/hooks/useLocaleFormat";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { apiErrorInfo } from "@/lib/apiError";
import {
  MONDU_DEFAULT_NET_TERM,
  MONDU_LEGAL_FORMS,
  isMonduSellClosed,
  isMonduSellWaiting,
  type MonduHistoryEvent,
  type MonduLegalForm,
  type MonduOrderOverview,
} from "@shared/mondu";

/**
 * Mondu an der Bestellung (Entscheidungen 18.10.2026, shared/mondu.ts):
 * - Shop-Bestellung mit abgebrochener Mondu-Zahlung: Mail mit Link, über den der Kunde die Zahlung im Shop
 *   erneut startet (das Shopware-Plugin führt die Zahlung weiter).
 * - Mondu Sell: Bestellung bei Mondu anlegen, Status mit deutlichem Hinweis bis zur Bestätigung (keine
 *   Sperre), Rechnung geht beim Rechnungsversand automatisch an Mondu.
 */

type Props = { orderId: string; canManage: boolean };

const NO_LEGAL_FORM = "auto";

export default function MonduSection({ orderId, canManage }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const fmt = useLocaleFormat();
  const queryKey = [`/api/orders/${orderId}/mondu`];
  const { data, isLoading } = useQuery<MonduOrderOverview>({ queryKey, retry: false });

  const [resendOpen, setResendOpen] = useState(false);
  const [resendEmail, setResendEmail] = useState("");
  const [sellOpen, setSellOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sellForm, setSellForm] = useState({
    buyerEmail: "",
    netTerm: String(MONDU_DEFAULT_NET_TERM),
    legalForm: NO_LEGAL_FORM as MonduLegalForm | typeof NO_LEGAL_FORM,
    ownerFirstName: "",
    ownerLastName: "",
    ownerBirthDate: "",
  });

  const errorText = (e: Error) => {
    const info = apiErrorInfo(e);
    const detail = info?.detail;
    if (!detail) return e.message;
    const key = `mondu.blocked.${detail}`;
    const translated = t(key);
    return `${e.message}: ${translated !== key ? translated : detail}`;
  };
  const onError = (e: Error) => toast({ title: t("mondu.actionFailed"), description: errorText(e), variant: "destructive" });
  const setOverview = (overview: MonduOrderOverview) => queryClient.setQueryData(queryKey, overview);

  const resendMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/mondu/resend-payment`, { email: resendEmail.trim() || undefined });
      return res.json() as Promise<{ to: string }>;
    },
    onSuccess: ({ to }) => {
      setResendOpen(false);
      toast({ title: t("mondu.shop.sent", { email: to }) });
      queryClient.invalidateQueries({ queryKey });
    },
    onError,
  });

  const sellMutation = useMutation({
    mutationFn: async () => {
      const netTerm = Number.parseInt(sellForm.netTerm, 10);
      const legalForm = sellForm.legalForm === NO_LEGAL_FORM ? null : sellForm.legalForm;
      const res = await apiRequest("POST", `/api/orders/${orderId}/mondu/sell`, {
        buyerEmail: sellForm.buyerEmail.trim() || undefined,
        netTerm: Number.isFinite(netTerm) ? netTerm : null,
        legalForm,
        owner:
          legalForm === "einzelunternehmen"
            ? { firstName: sellForm.ownerFirstName, lastName: sellForm.ownerLastName, birthDate: sellForm.ownerBirthDate }
            : null,
      });
      return res.json() as Promise<MonduOrderOverview>;
    },
    onSuccess: (overview) => {
      setSellOpen(false);
      setOverview(overview);
      toast({ title: t("mondu.sell.created"), description: t("mondu.sell.createdDescription") });
    },
    onError,
  });

  const actionMutation = useMutation({
    mutationFn: async (action: "refresh" | "cancel" | "invoice") => {
      const res = await apiRequest("POST", `/api/orders/${orderId}/mondu/sell/${action}`, {});
      const body = await res.json();
      return { action, body } as {
        action: typeof action;
        body: MonduOrderOverview | { result: { status: string; message: string }; overview: MonduOrderOverview };
      };
    },
    onSuccess: ({ action, body }) => {
      if (action === "invoice" && "result" in body) {
        setOverview(body.overview);
        const ok = body.result.status === "submitted" || body.result.status === "skipped";
        toast({
          title: t(`mondu.sell.invoiceResult.${body.result.status}`),
          description: body.result.message,
          variant: ok ? undefined : "destructive",
        });
        return;
      }
      setOverview(body as MonduOrderOverview);
      if (action === "cancel") {
        setCancelOpen(false);
        toast({ title: t("mondu.sell.canceled") });
      }
    },
    onError,
  });

  if (isLoading || !data) return null;
  const { shop, sell } = data;
  const showSell = !!sell || (data.canCreateSell && canManage);
  if (!shop.isMonduPayment && !showSell) return null;

  const historyLine = (e: MonduHistoryEvent) => {
    const when = fmt.dateTime(e.at);
    const by = e.by ? ` · ${e.by}` : "";
    const text = t(`mondu.history.${e.type}`, {
      state: e.state ? t(`mondu.state.${e.state}`, { defaultValue: e.state }) : "",
      to: e.to ?? "",
      detail: e.detail ?? "",
    });
    return `${when}${by}: ${text}`;
  };

  const historyList = (events: MonduHistoryEvent[], testId: string) =>
    events.length > 0 ? (
      <details className="mt-3 text-xs" data-testid={testId}>
        <summary className="cursor-pointer text-muted-foreground">{t("mondu.history.title", { count: events.length })}</summary>
        <ul className="mt-1 space-y-0.5">
          {[...events].reverse().map((e, i) => (
            <li key={`${e.at}-${i}`}>{historyLine(e)}</li>
          ))}
        </ul>
      </details>
    ) : null;

  const openResend = () => {
    setResendEmail(shop.recipientEmail ?? "");
    setResendOpen(true);
  };

  const openSell = () => {
    setSellForm((f) => ({
      ...f,
      buyerEmail: sell?.buyerEmail ?? data.defaults.buyerEmail ?? "",
      netTerm: String(data.defaults.netTerm),
    }));
    setSellOpen(true);
  };

  const sellAmount = (cents: number | null | undefined, currency: string | null | undefined) =>
    cents != null ? fmt.currencyIn(cents / 100, currency) : "–";

  const stateBadge = (state: string | null) => {
    if (!state) return null;
    const variant = state === "declined" || state === "canceled" ? "destructive" : isMonduSellWaiting(state) ? "secondary" : "default";
    return (
      <Badge variant={variant} data-testid="badge-mondu-sell-state">
        {t(`mondu.state.${state}`, { defaultValue: state })}
      </Badge>
    );
  };

  const ownerMissing =
    sellForm.legalForm === "einzelunternehmen" &&
    (!sellForm.ownerFirstName.trim() || !sellForm.ownerLastName.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(sellForm.ownerBirthDate));

  return (
    <Card className="p-6" data-testid="section-mondu">
      <div className="flex items-center justify-between gap-2 mb-4">
        <h3 className="text-sm font-medium uppercase tracking-wide">{t("mondu.title")}</h3>
        {data.sandbox ? <Badge variant="outline">{t("mondu.sandbox")}</Badge> : null}
      </div>

      {shop.isMonduPayment ? (
        <div className="space-y-2" data-testid="mondu-shop">
          <p className="text-sm">
            {t("mondu.shop.paymentState", {
              method: shop.paymentMethodName ?? "Mondu",
              state: t(`mondu.paymentState.${shop.transactionState ?? "unknown"}`, { defaultValue: shop.transactionState ?? "–" }),
            })}
          </p>
          {shop.canResend ? (
            <>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{t("mondu.shop.notCompleted")}</AlertDescription>
              </Alert>
              {canManage ? (
                <Button type="button" variant="outline" size="sm" onClick={openResend} data-testid="button-mondu-resend">
                  <Mail className="mr-2 h-4 w-4" />
                  {t("mondu.shop.resend")}
                </Button>
              ) : null}
            </>
          ) : shop.blockedReason && shop.blockedReason !== "payment_state" ? (
            <p className="text-xs text-muted-foreground">{t(`mondu.shop.blocked.${shop.blockedReason}`)}</p>
          ) : null}
          {historyList(shop.history, "mondu-shop-history")}
        </div>
      ) : null}

      {showSell ? (
        <div className={shop.isMonduPayment ? "mt-6 border-t pt-4 space-y-3" : "space-y-3"} data-testid="mondu-sell">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-medium">{t("mondu.sell.title")}</p>
            {sell ? stateBadge(sell.state) : null}
          </div>

          {!sell ? <p className="text-sm text-muted-foreground">{t("mondu.sell.intro")}</p> : null}

          {sell && isMonduSellWaiting(sell.state) ? (
            <Alert data-testid="alert-mondu-sell-waiting">
              <Clock className="h-4 w-4" />
              <AlertDescription>{t(`mondu.sell.waiting.${sell.state}`)}</AlertDescription>
            </Alert>
          ) : null}
          {sell?.state === "confirmed" ? (
            <p className="flex items-center gap-1 text-sm text-emerald-700 dark:text-emerald-400">
              <CheckCircle2 className="h-4 w-4" />
              {t("mondu.sell.confirmedHint")}
            </p>
          ) : null}
          {sell && isMonduSellClosed(sell.state) ? (
            <Alert variant="destructive">
              <XCircle className="h-4 w-4" />
              <AlertDescription>
                {t(`mondu.sell.closed.${sell.state}`)}
                {sell.stateReason ? ` (${sell.stateReason})` : ""}
              </AlertDescription>
            </Alert>
          ) : null}

          {sell ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t("mondu.sell.reference")}</span>
              <span className="break-all">{sell.externalReferenceId ?? "–"}</span>
              <span className="text-muted-foreground">{t("mondu.sell.amount")}</span>
              <span>{sellAmount(sell.grossAmountCents, sell.currency)}</span>
              <span className="text-muted-foreground">{t("mondu.sell.netTerm")}</span>
              <span>{sell.netTerm ? t("mondu.sell.days", { count: sell.netTerm }) : "–"}</span>
              <span className="text-muted-foreground">{t("mondu.sell.buyerEmail")}</span>
              <span className="break-all">{sell.buyerEmail ?? "–"}</span>
              <span className="text-muted-foreground">{t("mondu.sell.invoice")}</span>
              <span data-testid="text-mondu-sell-invoice">
                {sell.invoiceUuid
                  ? t("mondu.sell.invoiceSubmitted", {
                      number: sell.invoiceNumber ?? "",
                      state: t(`mondu.invoiceState.${sell.invoiceState ?? "created"}`, { defaultValue: sell.invoiceState ?? "" }),
                    })
                  : sell.invoicePending
                    ? t("mondu.sell.invoicePending")
                    : t("mondu.sell.invoiceNone")}
              </span>
            </div>
          ) : null}
          {sell?.lastError ? (
            <p className="flex items-start gap-1 text-xs text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              {sell.lastError}
            </p>
          ) : null}

          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {data.canCreateSell ? (
                <Button type="button" size="sm" onClick={openSell} data-testid="button-mondu-sell-create">
                  <Send className="mr-2 h-4 w-4" />
                  {sell ? t("mondu.sell.createAgain") : t("mondu.sell.create")}
                </Button>
              ) : null}
              {sell && !isMonduSellClosed(sell.state) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => actionMutation.mutate("refresh")}
                  disabled={actionMutation.isPending}
                  data-testid="button-mondu-sell-refresh"
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${actionMutation.isPending && actionMutation.variables === "refresh" ? "animate-spin" : ""}`} />
                  {t("mondu.sell.refresh")}
                </Button>
              ) : null}
              {sell && sell.invoicePending && !isMonduSellWaiting(sell.state) && !isMonduSellClosed(sell.state) ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => actionMutation.mutate("invoice")}
                  disabled={actionMutation.isPending}
                  data-testid="button-mondu-sell-invoice"
                >
                  {t("mondu.sell.retryInvoice")}
                </Button>
              ) : null}
              {sell && !isMonduSellClosed(sell.state) && !sell.invoiceUuid ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive"
                  onClick={() => setCancelOpen(true)}
                  data-testid="button-mondu-sell-cancel"
                >
                  {t("mondu.sell.cancel")}
                </Button>
              ) : null}
            </div>
          ) : null}
          {sell?.lastCheckedAt ? (
            <p className="text-xs text-muted-foreground">{t("mondu.sell.lastChecked", { when: fmt.dateTime(sell.lastCheckedAt) })}</p>
          ) : null}
          {sell ? historyList(sell.history, "mondu-sell-history") : null}
        </div>
      ) : null}

      <Dialog open={resendOpen} onOpenChange={setResendOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mondu.shop.resendTitle")}</DialogTitle>
            <DialogDescription>{t("mondu.shop.resendDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label htmlFor="mondu-resend-email" className="text-xs">{t("mondu.shop.recipient")}</Label>
              <Input
                id="mondu-resend-email"
                className="mt-1"
                type="email"
                value={resendEmail}
                onChange={(e) => setResendEmail(e.target.value)}
                data-testid="input-mondu-resend-email"
              />
            </div>
            {shop.preview ? (
              <div className="rounded-md border p-3 text-xs">
                <p className="font-medium mb-2">{shop.preview.subject}</p>
                <p className="whitespace-pre-wrap break-words text-muted-foreground" data-testid="text-mondu-resend-preview">
                  {shop.preview.text}
                </p>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setResendOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => resendMutation.mutate()}
              disabled={resendMutation.isPending || !resendEmail.trim()}
              data-testid="button-mondu-resend-confirm"
            >
              {resendMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Mail className="mr-2 h-4 w-4" />}
              {t("mondu.shop.send")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={sellOpen} onOpenChange={setSellOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("mondu.sell.createTitle")}</DialogTitle>
            <DialogDescription>{t("mondu.sell.createDescription")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <span className="text-muted-foreground">{t("mondu.sell.company")}</span>
              <span>{data.defaults.companyName ?? "–"}</span>
              <span className="text-muted-foreground">{t("mondu.sell.amount")}</span>
              <span>{sellAmount(data.defaults.amountCents, data.defaults.currency)}</span>
            </div>
            <div>
              <Label htmlFor="mondu-sell-email" className="text-xs">{t("mondu.sell.buyerEmail")}</Label>
              <Input
                id="mondu-sell-email"
                className="mt-1"
                type="email"
                value={sellForm.buyerEmail}
                onChange={(e) => setSellForm((f) => ({ ...f, buyerEmail: e.target.value }))}
                data-testid="input-mondu-sell-email"
              />
              <p className="mt-1 text-xs text-muted-foreground">{t("mondu.sell.buyerEmailHint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mondu-sell-net-term" className="text-xs">{t("mondu.sell.netTermDays")}</Label>
                <Input
                  id="mondu-sell-net-term"
                  className="mt-1"
                  inputMode="numeric"
                  value={sellForm.netTerm}
                  onChange={(e) => setSellForm((f) => ({ ...f, netTerm: e.target.value.replace(/\D/g, "") }))}
                  data-testid="input-mondu-sell-net-term"
                />
              </div>
              <div>
                <Label htmlFor="mondu-sell-legal-form" className="text-xs">{t("mondu.sell.legalForm")}</Label>
                <Select
                  value={sellForm.legalForm}
                  onValueChange={(v) => setSellForm((f) => ({ ...f, legalForm: v as MonduLegalForm | typeof NO_LEGAL_FORM }))}
                >
                  <SelectTrigger id="mondu-sell-legal-form" className="mt-1" data-testid="select-mondu-sell-legal-form">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_LEGAL_FORM}>{t("mondu.legalForm.auto")}</SelectItem>
                    {MONDU_LEGAL_FORMS.map((f) => (
                      <SelectItem key={f} value={f}>
                        {t(`mondu.legalForm.${f}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {sellForm.legalForm === "einzelunternehmen" ? (
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="mondu-owner-first" className="text-xs">{t("mondu.sell.ownerFirstName")}</Label>
                  <Input
                    id="mondu-owner-first"
                    className="mt-1"
                    value={sellForm.ownerFirstName}
                    onChange={(e) => setSellForm((f) => ({ ...f, ownerFirstName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="mondu-owner-last" className="text-xs">{t("mondu.sell.ownerLastName")}</Label>
                  <Input
                    id="mondu-owner-last"
                    className="mt-1"
                    value={sellForm.ownerLastName}
                    onChange={(e) => setSellForm((f) => ({ ...f, ownerLastName: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="mondu-owner-birth" className="text-xs">{t("mondu.sell.ownerBirthDate")}</Label>
                  <Input
                    id="mondu-owner-birth"
                    className="mt-1"
                    type="date"
                    value={sellForm.ownerBirthDate}
                    onChange={(e) => setSellForm((f) => ({ ...f, ownerBirthDate: e.target.value }))}
                  />
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setSellOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              onClick={() => sellMutation.mutate()}
              disabled={sellMutation.isPending || !sellForm.buyerEmail.trim() || ownerMissing}
              data-testid="button-mondu-sell-confirm"
            >
              {sellMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
              {t("mondu.sell.createConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("mondu.sell.cancelTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("mondu.sell.cancelDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction onClick={() => actionMutation.mutate("cancel")} data-testid="button-mondu-sell-cancel-confirm">
              {t("mondu.sell.cancel")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
