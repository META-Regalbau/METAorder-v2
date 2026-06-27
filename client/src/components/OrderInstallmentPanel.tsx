/**
 * Kombiniert Liste + Dialog für Teilzahlungspläne.
 * In der Bestellansicht ist die Einbindung in OrderDetailModal im Tab „Teilzahlung“ (orderDetail.installmentsTab).
 * Dieses Panel kann alternativ auf anderen Seiten mit denselben Props verwendet werden.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { Order } from "@shared/schema";
import InstallmentPlanDialog from "./InstallmentPlanDialog";
import InstallmentPlanSection from "./InstallmentPlanSection";

export default function OrderInstallmentPanel({
  order,
  canView,
  canManage,
}: {
  order: Order;
  canView: boolean;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!canView) return null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium uppercase tracking-wide">{t("installmentPlan.sectionTitle")}</h3>
        {canManage && (
          <Button type="button" variant="outline" size="sm" onClick={() => setDialogOpen(true)}>
            {t("installmentPlan.newPlan")}
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">{t("installmentPlan.sectionDescription")}</p>
      <InstallmentPlanSection order={order} canManage={canManage} />
      <InstallmentPlanDialog open={dialogOpen} onOpenChange={setDialogOpen} order={order} />
    </div>
  );
}
