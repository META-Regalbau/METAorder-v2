/**
 * Regalplaner eingebettet in die Shop-Seite /regalplaner (iframe, siehe PublicRegalplanerPage.tsx).
 *
 * Nachrichten an die Shop-Seite (shopware/storefront-snippets/regalplaner.js), immer nur an die Adresse des
 * einbettenden Shops:
 * - { source, type: "height", height }: Höhe des Inhalts, damit der Rahmen ohne eigenen Rollbalken wächst.
 * - { source, type: "cart", configCode, items: [{ id, quantity, name }] }: Stückliste; der Shop legt die
 *   Artikel in der Sitzung des Besuchers in den Warenkorb (Kundenpreise rechnet der Shop selbst).
 */
import { useEffect } from "react";

export const EMBED_MESSAGE_SOURCE = "metaorder-regalplaner";

export type ShopCartMessage = {
  configCode: string;
  items: Array<{ id: string; quantity: number; name: string }>;
};

export function postCartToShop(shopOrigin: string, cart: ShopCartMessage): void {
  window.parent.postMessage({ source: EMBED_MESSAGE_SOURCE, type: "cart", ...cart }, shopOrigin);
}

/** Meldet die Inhaltshöhe an die Shop-Seite, solange shopOrigin gesetzt ist. */
export function useReportEmbedHeight(shopOrigin: string | null): void {
  useEffect(() => {
    if (!shopOrigin || typeof ResizeObserver === "undefined") return;
    let last = 0;
    const send = () => {
      const height = Math.ceil(document.documentElement.scrollHeight);
      if (Math.abs(height - last) < 2) return;
      last = height;
      window.parent.postMessage({ source: EMBED_MESSAGE_SOURCE, type: "height", height }, shopOrigin);
    };
    const observer = new ResizeObserver(send);
    observer.observe(document.body);
    send();
    return () => observer.disconnect();
  }, [shopOrigin]);
}
