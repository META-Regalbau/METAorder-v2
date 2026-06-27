import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Order } from "@shared/schema";
import { FileDown, FileText, Loader2, Package, Trash2 } from "lucide-react";
import type { InstallmentPlanApi } from "./InstallmentPlanDialog";

interface InstallmentPlanSectionProps {
  order: Order;
  canManage: boolean;
}

function statusVariant(
  status: string
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "active" || status === "completed") return "default";
  if (status === "cancelled") return "destructive";
  return "secondary";
}

export default function InstallmentPlanSection({ order, canManage }: InstallmentPlanSectionProps) {
  const { t, i18n } = useTranslation();
  const { toast } = useToast();

  const { data: plans = [], isLoading } = useQuery<InstallmentPlanApi[]>({
    queryKey: ["/api/orders", order.id, "installment-plans"],
    queryFn: async () => {
      const res = await fetch(`/api/orders/${order.id}/installment-plans`, { credentials: "include" });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async ({ planId, invoiceId }: { planId: string; invoiceId: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/installment-plans/${planId}/invoices/${invoiceId}/mark-paid`,
        {}
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "installment-plans"] });
      toast({ title: t("installmentPlan.markPaidSuccess") });
    },
    onError: (e: Error) => {
      toast({ title: t("installmentPlan.markPaidFailed"), description: e.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (planId: string) => {
      const res = await apiRequest("DELETE", `/api/installment-plans/${planId}`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders", order.id, "installment-plans"] });
      toast({ title: t("installmentPlan.deleteSuccess") });
    },
    onError: (e: Error) => {
      toast({ title: t("installmentPlan.deleteFailed"), description: e.message, variant: "destructive" });
    },
  });

  const eur = (n: number) =>
    new Intl.NumberFormat(i18n.language, { style: "currency", currency: "EUR" }).format(n);

  const formatDate = (d: string | null) => {
    if (!d) return "—";
    return new Date(d).toLocaleDateString(i18n.language);
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t("installmentPlan.loading")}
      </div>
    );
  }

  if (plans.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("installmentPlan.noPlans")}</p>;
  }

  return (
    <div className="space-y-6">
      {plans.map((plan) => {
        const invs = plan.invoices ?? [];
        const nonCancelled = invs.filter((i) => i.status !== "cancelled");
        const paidCount = nonCancelled.filter((i) => i.status === "paid").length;
        const totalCount = nonCancelled.length;
        const pct = totalCount > 0 ? Math.round((paidCount / totalCount) * 100) : 0;

        return (
          <Card key={plan.id} className="p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{t("installmentPlan.planLabel")}</span>
                <Badge variant={statusVariant(plan.status)}>{t(`installmentPlan.status.${plan.status}`)}</Badge>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={`/api/installment-plans/${plan.id}/invoices-zip`}
                    className="gap-1 inline-flex items-center"
                  >
                    <Package className="h-4 w-4" />
                    {t("installmentPlan.downloadAllInvoices")}
                  </a>
                </Button>
                {(plan.status === "pending_confirmation" || plan.status === "active" || plan.status === "completed") && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={`/api/installment-plans/${plan.id}/agreement-pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gap-1 inline-flex items-center"
                    >
                      <FileDown className="h-4 w-4" />
                      {t("installmentPlan.downloadAgreement")}
                    </a>
                  </Button>
                )}
                {canManage && plan.status === "draft" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive"
                    onClick={() => {
                      if (confirm(t("installmentPlan.deleteConfirm"))) deleteMutation.mutate(plan.id);
                    }}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            <div>
              <div className="flex justify-between text-xs text-muted-foreground mb-1">
                <span>{t("installmentPlan.progress")}</span>
                <span>
                  {paidCount} / {totalCount}
                </span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
              </div>
            </div>

            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                {t("installmentPlan.summaryDeposit")}: {eur(plan.depositAmount)}
                {plan.depositPercent != null && ` (${plan.depositPercent.toFixed(2).replace(".", ",")} %)`}
                {" · "}{t("installmentPlan.summaryRemaining")}: {eur(plan.remainingAmount)}
                {" · "}{plan.numberOfInstallments} {t("installmentPlan.rates")}
              </p>
              {plan.agreementConfirmedAt && (
                <p>
                  {t("installmentPlan.confirmedAt")}: {formatDate(plan.agreementConfirmedAt)}{" "}
                  {plan.agreementConfirmedBy ? `(${plan.agreementConfirmedBy})` : ""}
                </p>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="py-2 pr-2">{t("installmentPlan.colType")}</th>
                    <th className="py-2 pr-2">{t("installmentPlan.colInvoiceNumber")}</th>
                    <th className="py-2 pr-2">{t("installmentPlan.colAmount")}</th>
                    <th className="py-2 pr-2">{t("installmentPlan.colDue")}</th>
                    <th className="py-2 pr-2">{t("installmentPlan.colStatus")}</th>
                    <th className="py-2 pr-2">PDF</th>
                    {canManage && plan.status === "active" && <th className="py-2">{t("common.actions")}</th>}
                  </tr>
                </thead>
                <tbody>
                  {invs
                    .slice()
                    .sort((a, b) => a.sequenceNumber - b.sequenceNumber)
                    .map((inv) => (
                      <tr key={inv.id} className="border-b border-border/50">
                        <td className="py-2 pr-2">
                          {inv.type === "deposit" ? t("installmentPlan.typeDeposit") : t("installmentPlan.typeRate")}
                        </td>
                        <td className="py-2 pr-2 font-mono text-xs">{inv.invoiceNumber ?? "—"}</td>
                        <td className="py-2 pr-2">{eur(inv.amount)}</td>
                        <td className="py-2 pr-2">{formatDate(inv.dueDate)}</td>
                        <td className="py-2 pr-2">
                          <Badge variant="outline" className="text-xs">
                            {t(`installmentPlan.invoiceStatus.${inv.status}`)}
                          </Badge>
                        </td>
                        <td className="py-2 pr-2">
                          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" asChild>
                            <a
                              href={`/api/installment-plans/${plan.id}/invoices/${inv.id}/pdf`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title={t("installmentPlan.downloadInvoicePdf")}
                            >
                              <FileText className="h-4 w-4" />
                            </a>
                          </Button>
                        </td>
                        {canManage && plan.status === "active" && (
                          <td className="py-2">
                            {inv.status !== "paid" && inv.status !== "cancelled" && (
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={markPaidMutation.isPending}
                                onClick={() => markPaidMutation.mutate({ planId: plan.id, invoiceId: inv.id })}
                              >
                                {t("installmentPlan.markPaid")}
                              </Button>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
