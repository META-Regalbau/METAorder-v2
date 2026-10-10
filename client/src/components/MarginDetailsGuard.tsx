import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Card } from "@/components/ui/card";
import { useCanViewMarginDetails } from "@/hooks/useMarginVisibility";

/**
 * Seiten mit genauen DB-Werten (Preisprüfung, Rentabilität, Bestell-DB-Analyse) nur mit Recht
 * „DB-Werte sehen“. Die Endpunkte sind auf dem Server ebenso gesperrt.
 */
export default function MarginDetailsGuard({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const canView = useCanViewMarginDetails();
  if (canView) return <>{children}</>;
  return (
    <Card className="p-6 max-w-xl" data-testid="margin-details-forbidden">
      <h1 className="text-lg font-semibold">{t("marginTrafficLight.forbiddenTitle")}</h1>
      <p className="text-sm text-muted-foreground mt-2">{t("marginTrafficLight.forbiddenText")}</p>
    </Card>
  );
}
