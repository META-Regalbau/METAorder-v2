/**
 * Öffentlicher Einstieg in den CPQ-Konfigurator für echte Shop-Besucher (Gast
 * oder eingeloggter Kunde) — erreicht über einen Link auf der
 * Shopware-Produktseite mit einem signierten Handoff-Token (siehe
 * server/cpqHandoffToken.ts). Kein METAorder-Mitarbeiter-Login nötig.
 *
 * Verifiziert den Token einmal serverseitig, liest daraus die Kundenidentität
 * (oder null für Gast) und reicht sie als `customerMode` an den bestehenden
 * Konfigurator weiter — derselbe Konfigurator wie im internen Admin-Bereich,
 * nur mit anderer Datenquelle für "wer bin ich" statt der internen
 * Kundensuche.
 */
import { useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import CPQConfiguratorPage from "./CPQConfiguratorPage";

type HandoffVerifyResponse = {
  valid: boolean;
  customerId: string | null;
  customerName: string | null;
  isPortalCustomer: boolean;
  productId: string | null;
};

export default function PublicCpqConfiguratorPage() {
  const [, params] = useRoute("/konfigurator/:token");
  const token = params?.token ? decodeURIComponent(params.token) : "";

  const { data, isLoading, error } = useQuery({
    queryKey: ["cpq-handoff", token],
    queryFn: async (): Promise<HandoffVerifyResponse> => {
      const res = await fetch(`/api/cpq/public/handoff?cpqToken=${encodeURIComponent(token)}`, { credentials: "omit" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Link ungültig oder abgelaufen");
      }
      return res.json();
    },
    enabled: !!token,
    retry: false,
  });

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground">Ungültiger Link.</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground">Konfigurator wird geladen…</p>
      </div>
    );
  }

  if (error || !data?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <p className="text-destructive text-center max-w-md">
          {(error as Error)?.message || "Dieser Link ist ungültig oder abgelaufen. Bitte rufen Sie die Produktseite erneut auf."}
        </p>
      </div>
    );
  }

  return (
    <CPQConfiguratorPage
      customerMode={{
        handoffToken: token,
        customerId: data.customerId,
        customerName: data.customerName,
        isPortalCustomer: data.isPortalCustomer,
      }}
    />
  );
}
