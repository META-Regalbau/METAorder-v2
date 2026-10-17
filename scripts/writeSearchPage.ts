/**
 * Spielt die Anpassungen der Suchergebnisseite in den Shop ein
 * (shopware/storefront-snippets/search-page.js + .css): Hinweis auf Themenseiten über den Treffern,
 * gekürzte Filterleiste, Hilfe bei leeren Treffern.
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeSearchPage.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeSearchPage.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { storefrontSnippet } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(storefrontSnippet("metaorder-search-page"));
