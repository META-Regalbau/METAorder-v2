/**
 * Setzt den Text der Newsletter-Checkbox auf „Bestellung abschließen“ (Brevo-Plugin) im deutschen
 * Textbaustein-Set des Onlineshops (server/shopContent/checkoutNewsletter.ts). Das Set nutzen auch
 * META Portal und Händlerportal DE, der Text passt für alle.
 *
 * Prüft vorher die Plugin-Einstellungen: Checkbox an und nicht vorausgewählt, sonst Abbruch.
 * Ohne --apply nur Testlauf. Mit --apply Protokoll (Stand vorher) im Arbeitsverzeichnis; --revert stellt
 * den Textbaustein wieder her bzw. löscht ihn (dann gilt wieder der Standardtext des Plugins). Schreibt nur
 * in Shops mit „test.“ in der URL, außer mit --live.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCheckoutNewsletterLabel.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeCheckoutNewsletterLabel.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { readFileSync, writeFileSync } from "fs";
import { storage } from "../server/storage";
import {
  CHECKOUT_NEWSLETTER_LABEL,
  CHECKOUT_NEWSLETTER_SETTINGS,
  CHECKOUT_NEWSLETTER_SNIPPET_KEY,
  checkoutNewsletterSnippetId,
  deSnippetSetId,
  loadCheckoutNewsletterSnippet as loadSnippet,
  type CheckoutNewsletterSnippet as Snippet,
} from "../server/shopContent/checkoutNewsletter";
import { findDeChannel, shopApi, type ShopApi } from "../server/shopContent/shopProducts";

type Protocol = { tenantId: string; at: string; base: string; setId: string; before: Snippet | null };

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function upsertSnippet(api: ShopApi, snippet: Snippet) {
  await api("POST", "_action/sync", [{ action: "upsert", entity: "snippet", payload: [snippet] }]);
}

async function main() {
  const tenantId = process.argv[2];
  if (!tenantId || tenantId.startsWith("--")) {
    console.error("Usage: npx tsx scripts/writeCheckoutNewsletterLabel.ts <tenantId> [--apply] [--live] | --revert <protokoll.json>");
    process.exit(1);
  }
  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) throw new Error(`Keine Shopware-Settings für ${tenantId}`);
  const { api, base, isTest } = shopApi(settings);
  const live = process.argv.includes("--live");

  const revertFile = arg("--revert");
  if (revertFile) {
    const log = JSON.parse(readFileSync(revertFile, "utf8")) as Protocol;
    if (log.tenantId !== tenantId) throw new Error(`Protokoll gehört zu Mandant ${log.tenantId}`);
    if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);
    const current = await loadSnippet(api, log.setId);
    if (log.before) await upsertSnippet(api, log.before);
    else if (current) await api("DELETE", `snippet/${current.id}`);
    console.log(`Textbaustein auf Stand ${log.at} zurückgesetzt`);
    return;
  }

  const channel = await findDeChannel(api, base);
  const config = await api("GET", "_action/system-config?domain=Sendinblue.config");
  if (config[CHECKOUT_NEWSLETTER_SETTINGS.enabled] !== true) throw new Error("Brevo: „Opt-in anzeigen“ ist aus – die Checkbox erscheint nicht");
  if (config[CHECKOUT_NEWSLETTER_SETTINGS.preChecked] === true) throw new Error("Brevo: Checkbox ist vorausgewählt – das ist keine gültige Einwilligung");

  const setId = await deSnippetSetId(api, channel.id, channel.domain);
  const current = await loadSnippet(api, setId);
  console.log(`${base} · Kanal ${channel.name} · Set ${setId}`);
  console.log(`Jetzt: ${current ? `„${current.value}“ (eigener Textbaustein)` : "Standardtext des Plugins"}`);
  console.log(`Neu:   „${CHECKOUT_NEWSLETTER_LABEL}“`);
  if (current?.value === CHECKOUT_NEWSLETTER_LABEL) {
    console.log("Schon aktuell");
    return;
  }

  if (!process.argv.includes("--apply")) {
    console.log("Testlauf – mit --apply schreiben");
    return;
  }
  if (!isTest && !live) throw new Error(`${base} ist kein Testshop – für Live ausdrücklich --live angeben`);

  const log: Protocol = { tenantId, at: new Date().toISOString(), base, setId, before: current };
  const file = `Checkout-Newsletter-Protokoll-${isTest ? "Testing" : "Live"}-${log.at.slice(0, 16).replace(":", "-")}.json`;
  writeFileSync(file, JSON.stringify(log, null, 2));
  console.log(`Protokoll: ${file}`);

  // Ein Textbaustein je Set und Schlüssel: einen vorhandenen (z. B. im Admin angelegt) überschreiben
  await upsertSnippet(api, {
    id: current?.id ?? checkoutNewsletterSnippetId(setId),
    setId,
    translationKey: CHECKOUT_NEWSLETTER_SNIPPET_KEY,
    value: CHECKOUT_NEWSLETTER_LABEL,
    author: "METAorder",
  });
  console.log("Fertig");
}

main().then(() => process.exit(0), (e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
