/**
 * Spielt den Regal-Schnellkonfigurator in den Shop ein (shopware/storefront-snippets/quick-configurator.js
 * + .css): Formular auf /regal-schnellkonfigurator (Fachboden-, Paletten-, Weitspann-, Kragarm-, Großfach- und
 * Büroregale), kleines Formular auf der Startseite, Einstiegskasten auf den Seiten und Listen der Regalarten,
 * Link auf den Produktseiten der Grund- und Anbauregale. Seite, Artikeltabelle und Startseiten-Abschnitt
 * schreibt scripts/writeQuickConfiguratorPage.ts.
 * Ablauf, Protokoll und Rückbau: scripts/lib/storefrontSnippetEntry.ts.
 *
 * Aufruf (im App-Container):
 *   NODE_ENV=development npx tsx scripts/writeQuickConfigurator.ts <tenantId> [--apply] [--live]
 *   NODE_ENV=development npx tsx scripts/writeQuickConfigurator.ts <tenantId> --revert <protokoll.json> [--live]
 */
import { storefrontSnippet } from "../server/shopContent/shopEntityIds";
import { runStorefrontSnippetScript } from "./lib/storefrontSnippetEntry";

runStorefrontSnippetScript(storefrontSnippet("metaorder-quick-configurator"));
