/**
 * Spielt das Newsletter-Modal mit Willkommensrabatt in den Shop ein
 * (shopware/storefront-snippets/exit-intent.js + .css): erscheint, wenn Besucher die Seite verlassen wollen.
 * Die Aktion mit dem Code legt vorher scripts/writeExitIntentPromotion.ts an.
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeExitIntent.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeExitIntent.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { storefrontSnippet } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(storefrontSnippet("metaorder-exit-intent"));
