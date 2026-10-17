/**
 * Newsletter-Checkbox auf „Bestellung abschließen“: kommt vom Brevo-Plugin (NewsletterSendinblue,
 * Einstellung „Opt-in anzeigen“, nicht vorausgewählt). Angehakt legt Shopware beim Bestellen einen
 * Newsletter-Empfänger an und schickt die Double-Opt-in-Mail (geprüft im Testshop 17.10.2026).
 *
 * Das Plugin liest nur die globale Einstellung und zeigt den Text ohne HTML. Ein eigener Text in der
 * Plugin-Einstellung ginge an alle Kanäle, auch an die fremdsprachigen Händlerportale. Deshalb setzt
 * METAorder den Text über den Textbaustein im deutschen Set (scripts/writeCheckoutNewsletterLabel.ts).
 */
import { createHash } from "crypto";
import type { ShopApi } from "./shopProducts";

export const CHECKOUT_NEWSLETTER_SNIPPET_KEY = "brevo.checkoutConfirm.optInDefaultLabel";
/** Ersetzt den Standardtext des Plugins „Abonnieren Sie Updates und Angebote“ */
export const CHECKOUT_NEWSLETTER_LABEL =
  "Ja, ich möchte den META-Newsletter mit Neuheiten und Aktionen rund um Regalsysteme erhalten. " +
  "Sie bekommen dazu eine Bestätigungs-E-Mail und können sich jederzeit abmelden.";
/** Globale Plugin-Einstellungen, ohne die die Checkbox fehlt bzw. vorausgewählt wäre */
export const CHECKOUT_NEWSLETTER_SETTINGS = {
  enabled: "Sendinblue.config.isDisplayOptInEnabled",
  preChecked: "Sendinblue.config.isDisplayOptInChecked",
} as const;

/** Feste ID des Textbausteins je Set (md5 wie server/shopContent/shopEntityIds.ts), nie ändern */
export const checkoutNewsletterSnippetId = (setId: string) =>
  createHash("md5").update(`metaorder-checkout-newsletter:${setId}`).digest("hex");

export type CheckoutNewsletterSnippet = { id: string; setId: string; translationKey: string; value: string; author: string };

/** Textbaustein-Set der Storefront-Domain des Onlineshops */
export async function deSnippetSetId(api: ShopApi, channelId: string, domain: string): Promise<string> {
  const res = await api("POST", "search/sales-channel-domain", {
    filter: [{ type: "equals", field: "salesChannelId", value: channelId }],
    includes: { sales_channel_domain: ["url", "snippetSetId"] },
  });
  const setId = (res?.data ?? []).find((d: any) => d.url.replace(/\/$/, "") === domain)?.snippetSetId;
  if (!setId) throw new Error(`Kein Textbaustein-Set für ${domain}`);
  return setId;
}

/** Eigener Textbaustein für den Checkbox-Text im Set, null = Standardtext des Plugins */
export async function loadCheckoutNewsletterSnippet(api: ShopApi, setId: string): Promise<CheckoutNewsletterSnippet | null> {
  const res = await api("POST", "search/snippet", {
    filter: [{ type: "equals", field: "setId", value: setId }, { type: "equals", field: "translationKey", value: CHECKOUT_NEWSLETTER_SNIPPET_KEY }],
  });
  const s = res?.data?.[0];
  return s ? { id: s.id, setId: s.setId, translationKey: s.translationKey, value: s.value, author: s.author } : null;
}
