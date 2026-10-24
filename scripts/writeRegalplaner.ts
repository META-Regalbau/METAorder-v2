/**
 * Spielt den Regalplaner-Baustein in den Shop ein (shopware/storefront-snippets/regalplaner.js + .css): setzt auf
 * der Seite /regalplaner (scripts/writeRegalplanerPage.ts) METAorder als iframe ein und legt die Stückliste aus dem
 * Regalplaner in den Warenkorb. Nach dem Live-Einspielen REGALPLANER_SNIPPET in STOREFRONT_SNIPPETS übernehmen
 * (Shop-Wächter). Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeRegalplaner.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeRegalplaner.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { REGALPLANER_SNIPPET } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(REGALPLANER_SNIPPET);
