import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Order } from "@shared/schema";
import { FileDown, Loader2 } from "lucide-react";
import { Separator } from "@/components/ui/separator";

export type InstallmentPlanApi = {
  id: string;
  status: string;
  orderNumber: string;
  totalAmount: number;
  depositAmount: number;
  depositPercent?: number | null;
  remainingAmount: number;
  numberOfInstallments: number;
  agreementPdfPath?: string | null;
  agreementConfirmedAt?: string | null;
  agreementConfirmedBy?: string | null;
  invoices: Array<{
    id: string;
    type: string;
    sequenceNumber: number;
    invoiceNumber: string | null;
    amount: number;
    dueDate: string | null;
    status: string;
  }>;
};

type DepositMode = "amount" | "percent";

type Step = 1 | 2 | 3;

function splitRemaining(remaining: number, n: number): number[] {
  const cents = Math.round(remaining * 100);
  const base = Math.floor(cents / n);
  const rem = cents - base * n;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push((base + (i === n - 1 ? rem : 0)) / 100);
  }
  return out;
}

function addMonthsIso(start: Date, months: number): string {
  const d = new Date(start);
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

interface InstallmentPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Order;
}

export default function InstallmentPlanDialog({
  open,
  onOpenChange,
  order,
}: InstallmentPlanDialogProps) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [depositMode, setDepositMode] = useState<DepositMode>("amount");
  const [depositAmount, setDepositAmount] = useState("");
  const [depositPercent, setDepositPercent] = useState("");
  const [numberOfInstallments, setNumberOfInstallments] = useState<3 | 6 | 12>(3);
  const [depositInvoiceNumber, setDepositInvoiceNumber] = useState("");
  const [installmentNumbers, setInstallmentNumbers] = useState<string[]>(["", "", ""]);
  const [useAutoDates, setUseAutoDates] = useState(true);
  const [dateStart, setDateStart] = useState(() => new Date().toISOString().slice(0, 10));
  const [createdPlan, setCreatedPlan] = useState<InstallmentPlanApi | null>(null);
  const [confirmedBy, setConfirmedBy] = useState("");

  const total = typeof order.totalAmount === "number" ? order.totalAmount : Number(order.totalAmount);

  useEffect(() => {
    if (!open) {
      setStep(1);
      setDepositMode("amount");
      setDepositAmount("");
      setDepositPercent("");
      setNumberOfInstallments(3);
      setDepositInvoiceNumber("");
      setInstallmentNumbers(["", "", ""]);
      setUseAutoDates(true);
      setDateStart(new Date().toISOString().slice(0, 10));
      setCreatedPlan(null);
      setConfirmedBy("");
    }
  }, [open]);

  useEffect(() => {
    setInstallmentNumbers((prev) => {
      const next = Array.from({ length: numberOfInstallments }, (_, i) => prev[i] ?? "");
      return next;
    });
  }, [numberOfInstallments]);

  const effectiveDeposit = useMemo(() => {
    if (depositMode === "percent") {
      const pct = parseFloat(depositPercent.replace(",", "."));
      if (!Number.isFinite(pct) || pct <= 0 || pct >= 100) return null;
      return Math.round(total * pct) / 100;
    }
    const d = parseFloat(depositAmount.replace(",", "."));
    if (!Number.isFinite(d) || d <= 0) return null;
    return d;
  }, [depositMode, depositAmount, depositPercent, total]);

  const remaining = useMemo(() => {
    if (effectiveDeposit === null || effectiveDeposit >= total) return null;
    return Math.round((total - effectiveDeposit) * 100) / 100;
  }, [effectiveDeposit, total]);

  const previewAmounts = useMemo(() => {
    if (remaining === null || remaining <= 0) return [];
    return splitRemaining(remaining, numberOfInstallments);
  }, [remaining, numberOfInstallments]);

  const buildDueDates = (): string[] | undefined => {
    if (!useAutoDates) return undefined;
    const start = new Date(dateStart);
    if (Number.isNaN(start.getTime())) return undefined;
    const out: string[] = [addMonthsIso(start, 0)];
    for (let i = 1; i <= numberOfInstallments; i++) {
      out.push(addMonthsIso(start, i));
    }
    return out;
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      if (effectiveDeposit === null || effectiveDeposit <= 0 || effectiveDeposit >= total) {
        throw new Error(t("installmentPlan.validationDeposit"));
      }
      const nums = installmentNumbers.map((s) => s.trim());
      if (nums.some((s) => !s)) {
        throw new Error(t("installmentPlan.validationNumbers"));
      }
      const body: Record<string, unknown> = {
        numberOfInstallments,
        depositInvoiceNumber: depositInvoiceNumber.trim(),
        installmentInvoiceNumbers: nums,
      };
      if (depositMode === "percent") {
        body.depositPercent = parseFloat(depositPercent.replace(",", "."));
      } else {
        body.depositAmount = effectiveDeposit;
      }
      const due = buildDueDates();
      if (due) body.dueDates = due;
      const res = await apiRequest("POST", `/api/orders/${order.id}/installment-plans`, body);
      return res.json() as Promise<InstallmentPlanApi>;
    },
    onSuccess: (data) => {
      setCreatedPlan(data);
      setStep(3);
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "installment-plans"] });
      toast({ title: t("installmentPlan.createSuccess") });
    },
    onError: (e: Error) => {
      toast({ title: t("installmentPlan.createFailed"), description: e.message, variant: "destructive" });
    },
  });

  const sendAgreementMutation = useMutation({
    mutationFn: async () => {
      if (!createdPlan) throw new Error("no plan");
      const res = await apiRequest("POST", `/api/installment-plans/${createdPlan.id}/send-agreement`, {});
      return res.json() as Promise<{ plan: InstallmentPlanApi }>;
    },
    onSuccess: async (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "installment-plans"] });
      if (data?.plan) setCreatedPlan(data.plan);
      else {
        const r = await fetch(`/api/installment-plans/${createdPlan!.id}`, { credentials: "include" });
        if (r.ok) setCreatedPlan(await r.json());
      }
      toast({ title: t("installmentPlan.agreementGenerated") });
    },
    onError: (e: Error) => {
      toast({ title: t("installmentPlan.agreementFailed"), description: e.message, variant: "destructive" });
    },
  });

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!createdPlan) throw new Error("no plan");
      const res = await apiRequest("POST", `/api/installment-plans/${createdPlan.id}/confirm`, {
        confirmedBy: confirmedBy.trim(),
      });
      return res.json() as Promise<InstallmentPlanApi>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "installment-plans"] });
      setCreatedPlan(data);
      toast({ title: t("installmentPlan.confirmSuccess") });
      onOpenChange(false);
    },
    onError: (e: Error) => {
      toast({ title: t("installmentPlan.confirmFailed"), description: e.message, variant: "destructive" });
    },
  });

  const eur = (n: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(n);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto z-[100]"
        data-testid="dialog-installment-plan"
      >
        <DialogHeader>
          <DialogTitle>{t("installmentPlan.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("installmentPlan.dialogDescription", { orderNumber: order.orderNumber })}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm font-medium text-foreground" data-testid="installment-step-label">
          {step === 1 && t("installmentPlan.step1Title")}
          {step === 2 && t("installmentPlan.step2Title")}
          {step === 3 && createdPlan && t("installmentPlan.step3Title")}
        </p>
        <Separator />

        {step === 1 && (
          <div className="space-y-4 py-2" data-testid="installment-step1-config">
            <p className="text-sm text-muted-foreground">
              {t("installmentPlan.orderTotal")}: <strong>{eur(total)}</strong>
            </p>
            <div className="space-y-2">
              <Label>{t("installmentPlan.depositLabel")}</Label>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    depositMode === "amount"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-accent"
                  }`}
                  onClick={() => setDepositMode("amount")}
                >
                  EUR
                </button>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-medium rounded-md border transition-colors ${
                    depositMode === "percent"
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background text-muted-foreground border-input hover:bg-accent"
                  }`}
                  onClick={() => setDepositMode("percent")}
                >
                  %
                </button>
              </div>
              {depositMode === "amount" ? (
                <Input
                  type="text"
                  inputMode="decimal"
                  value={depositAmount}
                  onChange={(e) => setDepositAmount(e.target.value)}
                  placeholder="0,00"
                />
              ) : (
                <div className="space-y-1">
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={depositPercent}
                    onChange={(e) => setDepositPercent(e.target.value)}
                    placeholder="z. B. 30"
                  />
                  {effectiveDeposit !== null && effectiveDeposit > 0 && (
                    <p className="text-xs text-muted-foreground">
                      = {eur(effectiveDeposit)}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Label>{t("installmentPlan.installmentCount")}</Label>
              <Select
                value={String(numberOfInstallments)}
                onValueChange={(v) => setNumberOfInstallments(Number(v) as 3 | 6 | 12)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="3">3</SelectItem>
                  <SelectItem value="6">6</SelectItem>
                  <SelectItem value="12">12</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{t("installmentPlan.depositInvoiceNumber")}</Label>
              <Input
                value={depositInvoiceNumber}
                onChange={(e) => setDepositInvoiceNumber(e.target.value)}
                placeholder="RE-…"
              />
            </div>
            {installmentNumbers.map((val, idx) => (
              <div key={idx} className="space-y-2">
                <Label>
                  {t("installmentPlan.installmentInvoiceNumber", { index: idx + 1 })}
                </Label>
                <Input
                  value={val}
                  onChange={(e) => {
                    const next = [...installmentNumbers];
                    next[idx] = e.target.value;
                    setInstallmentNumbers(next);
                  }}
                  placeholder="RE-…"
                />
              </div>
            ))}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="autoDates"
                checked={useAutoDates}
                onChange={(e) => setUseAutoDates(e.target.checked)}
              />
              <Label htmlFor="autoDates" className="font-normal cursor-pointer">
                {t("installmentPlan.autoDueDates")}
              </Label>
            </div>
            {useAutoDates && (
              <div className="space-y-2">
                <Label>{t("installmentPlan.firstDueDate")}</Label>
                <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} />
              </div>
            )}
            {remaining !== null && remaining > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("installmentPlan.remainingPreview")}: {eur(remaining)} → {t("installmentPlan.perInstallment")}:{" "}
                {previewAmounts.map((a) => eur(a)).join(" · ")}
              </p>
            )}
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4 py-2 text-sm">
            <p>{t("installmentPlan.reviewIntro")}</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                {t("installmentPlan.reviewDeposit")}: {effectiveDeposit !== null ? eur(effectiveDeposit) : "—"}
                {depositMode === "percent" && ` (${depositPercent.replace(".", ",")} %)`}
                {" — "}
                {depositInvoiceNumber}
              </li>
              {previewAmounts.map((a, i) => (
                <li key={i}>
                  {t("installmentPlan.reviewInstallment", { index: i + 1 })}: {eur(a)} — {installmentNumbers[i]}
                </li>
              ))}
            </ul>
          </div>
        )}

        {step === 3 && createdPlan && (
          <div className="space-y-4 py-2">
            <p className="text-sm">{t("installmentPlan.step3Intro")}</p>
            {createdPlan.status === "draft" && (
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => sendAgreementMutation.mutate()}
                disabled={sendAgreementMutation.isPending}
              >
                {sendAgreementMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("installmentPlan.generatingPdf")}
                  </>
                ) : (
                  t("installmentPlan.generateAndSendAgreement")
                )}
              </Button>
            )}
            {createdPlan.status !== "draft" && (
              <Button variant="outline" className="w-full" asChild>
                <a
                  href={`/api/installment-plans/${createdPlan.id}/agreement-pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center gap-2"
                >
                  <FileDown className="h-4 w-4" />
                  {t("installmentPlan.downloadAgreement")}
                </a>
              </Button>
            )}
            <div className="space-y-2">
              <Label>{t("installmentPlan.confirmedByLabel")}</Label>
              <Input
                value={confirmedBy}
                onChange={(e) => setConfirmedBy(e.target.value)}
                placeholder={t("installmentPlan.confirmedByPlaceholder")}
              />
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => confirmMutation.mutate()}
              disabled={confirmMutation.isPending || !confirmedBy.trim()}
            >
              {confirmMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t("installmentPlan.confirming")}
                </>
              ) : (
                t("installmentPlan.recordCustomerConfirm")
              )}
            </Button>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {step === 1 && (
            <Button
              type="button"
              onClick={() => setStep(2)}
              disabled={effectiveDeposit === null || effectiveDeposit <= 0 || effectiveDeposit >= total || !depositInvoiceNumber}
            >
              {t("installmentPlan.nextReview")}
            </Button>
          )}
          {step === 2 && (
            <>
              <Button type="button" variant="outline" onClick={() => setStep(1)}>
                {t("common.previous")}
              </Button>
              <Button
                type="button"
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("installmentPlan.creating")}
                  </>
                ) : (
                  t("installmentPlan.createPlan")
                )}
              </Button>
            </>
          )}
          {step === 3 && (
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
