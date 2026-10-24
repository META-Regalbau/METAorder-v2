/**
 * Regalplaner für Shop-Besucher ohne Shopware-Plugin: Die Shop-Seite /regalplaner
 * (scripts/writeRegalplanerPage.ts + shopware/storefront-snippets/regalplaner.js) bettet
 * `/regalplaner?shop=<Adresse des Shops>` als iframe ein.
 *
 * Der Server stellt dafür einen Gast-Token für den Mandanten dieses Shops aus
 * (GET /api/cpq/public/guest-token). Gäste sehen Katalogpreise; „In den Warenkorb“ schickt die
 * Stückliste per postMessage an die Shop-Seite, die sie in der Sitzung des Besuchers in den Warenkorb
 * legt – dort gelten dann Händler- und Kundenpreise (metaClip/shopEmbed.ts).
 *
 * Von einer Produktseite aus hängt der Shop zusätzlich `rp=<Konfigurations-Code>` an (Maße, Felder, Ebenen,
 * Fachlast, Oberfläche des Artikels); der Planer startet dann mit diesen Werten.
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { parseConfigCode } from "@/lib/metaClipCpq";
import CPQConfiguratorPage from "./CPQConfiguratorPage";

function shopOriginFromQuery(): string | null {
  try {
    const raw = new URLSearchParams(window.location.search).get("shop");
    return raw ? new URL(raw).origin : null;
  } catch {
    return null;
  }
}

export default function PublicRegalplanerPage() {
  const shop = shopOriginFromQuery();
  const initialState = useMemo(() => parseConfigCode(new URLSearchParams(window.location.search).get("rp")), []);
  const { data, isLoading, error } = useQuery({
    queryKey: ["cpq-guest-token", shop],
    queryFn: async (): Promise<{ token: string }> => {
      const res = await fetch(`/api/cpq/public/guest-token?shop=${encodeURIComponent(shop ?? "")}`, { credentials: "omit" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Regalplaner konnte nicht gestartet werden");
      }
      return res.json();
    },
    enabled: !!shop,
    retry: 1,
    // Token gilt 4 Stunden; danach beim nächsten Fokus neu holen
    staleTime: 3 * 60 * 60 * 1000,
  });

  if (!shop || error) {
    return (
      <div className="min-h-[320px] flex items-center justify-center p-6 bg-background">
        <p className="text-destructive text-center max-w-md">
          {(error as Error)?.message || "Bitte öffnen Sie den Regalplaner über den Onlineshop."}
        </p>
      </div>
    );
  }
  if (isLoading || !data) {
    return (
      <div className="min-h-[320px] flex items-center justify-center p-6 bg-background">
        <p className="text-muted-foreground">Regalplaner wird geladen…</p>
      </div>
    );
  }
  return (
    <CPQConfiguratorPage
      customerMode={{ handoffToken: data.token, customerId: null, customerName: null, isPortalCustomer: false, embedShopOrigin: shop }}
      initialState={initialState}
    />
  );
}
