/**
 * Regalplaner eingebettet in die Shop-Seite /regalplaner (iframe, siehe PublicRegalplanerPage.tsx).
 *
 * Nachrichten an die Shop-Seite (shopware/storefront-snippets/regalplaner.js), immer nur an die Adresse des
 * einbettenden Shops:
 * - { source, type: "height", height }: Höhe des Inhalts, damit der Rahmen ohne eigenen Rollbalken wächst.
 * - { source, type: "cart", configCode, items: [{ id, quantity, name }] }: Stückliste; der Shop legt die
 *   Artikel in der Sitzung des Besuchers in den Warenkorb (Kundenpreise rechnet der Shop selbst).
 *
 * Von der Shop-Seite kommt { source, type: "viewport", top }: wie viele Pixel des Rahmens oben verdeckt sind
 * (über den Bildschirmrand gescrollt oder unter einer mitlaufenden Kopfzeile). Damit bleibt die 3D-Ansicht
 * am Desktop stehen, obwohl im iframe selbst nichts scrollt (useEmbedStickyStage).
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

/** Breite, ab der Ansicht und Einstellungen nebeneinander stehen (metaClip.css, @media min-width 901px). */
const SIDE_BY_SIDE_MIN_WIDTH = 901;

/**
 * Schiebt .stage innerhalb von .cfg-main so weit nach unten, wie der Rahmen oben verdeckt ist – höchstens bis
 * zum Ende der Einstellungen. Direkt im Stil, ohne React-Render je Scroll-Schritt.
 */
export function useEmbedStickyStage(shopOrigin: string | null): void {
  useEffect(() => {
    if (!shopOrigin) return;
    let hidden = 0;
    const apply = () => {
      const stage = document.querySelector<HTMLElement>(".mclip .stage");
      const main = document.querySelector<HTMLElement>(".mclip .cfg-main");
      if (!stage || !main) return;
      if (window.innerWidth < SIDE_BY_SIDE_MIN_WIDTH) {
        stage.style.transform = "";
        return;
      }
      const mainTop = main.getBoundingClientRect().top + window.scrollY;
      const room = main.offsetHeight - stage.offsetHeight;
      const shift = Math.max(0, Math.min(room, hidden - mainTop));
      stage.style.transform = shift > 0 ? `translateY(${Math.round(shift)}px)` : "";
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== shopOrigin || event.source !== window.parent) return;
      const data = event.data as { source?: string; type?: string; top?: unknown };
      if (data?.source !== EMBED_MESSAGE_SOURCE || data.type !== "viewport") return;
      const top = Number(data.top);
      if (!Number.isFinite(top)) return;
      hidden = Math.max(0, top);
      apply();
    };
    window.addEventListener("message", onMessage);
    window.addEventListener("resize", apply);
    return () => {
      window.removeEventListener("message", onMessage);
      window.removeEventListener("resize", apply);
    };
  }, [shopOrigin]);
}
