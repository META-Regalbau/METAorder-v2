/**
 * Spielt „Das passt dazu“ für Mini-Warenkorb und Warenkorbseite in den Shop ein
 * (shopware/storefront-snippets/checkout-cross-selling.js + .css).
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeCheckoutCrossSelling.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeCheckoutCrossSelling.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { storefrontSnippet } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(storefrontSnippet("metaorder-checkout-cross-selling"));
