/**
 * Feste IDs der Shop-Entitäten, die METAorder anlegt (Schreibskripte unter scripts/ und Shop-Wächter).
 * Die IDs entstehen aus festen Schlüsseln (md5) – so findet jeder Lauf seine Entitäten wieder, auch ohne
 * Protokolldatei. Schlüssel nie ändern, sonst entsteht ein zweiter Eintrag.
 */
import { createHash } from "crypto";

const md5 = (text: string) => createHash("md5").update(text).digest("hex");

/** Branchenseiten (scripts/writeIndustryPages.ts): Teil z. B. "lp", "cms", "faq", "faq-0"; Startseite key "home" */
export const industryEntityId = (key: string, part: string) => md5(`metaorder-industry:${key}:${part}`);

/** System-Landingpages Vorlage A–K (scripts/writeCategoryLandingPages.ts): Teil z. B. "cms", "faq-0" */
export const landingEntityId = (key: string, part: string) => md5(`metaorder-landing:${key}:${part}`);

/** Seite und Startseiten-Abschnitt des Schnellkonfigurators (scripts/writeQuickConfiguratorPage.ts) */
export const quickConfigId = (part: string) => md5(`metaorder-quick-config:${part}`);

/** Aktion und Regel des Newsletter-Willkommensrabatts (scripts/writeExitIntentPromotion.ts) */
export const exitIntentPromotionId = (part: string) => md5(`metaorder-exit-intent-promotion:${part}`);

/** Eintrag im Plugin „Eigenes CSS/JS“ (DneCustomCssJs) je Storefront-Baustein */
export const snippetEntryId = (key: string) => md5(key);

export type StorefrontSnippetDef = {
  /** Grundlage der festen Eintrags-ID (md5), nie ändern */
  key: string;
  name: string;
  /** Dateiname ohne Endung in shopware/storefront-snippets (.js und .css) */
  file: string;
  script: string;
  protocolPrefix: string;
  /** CSS-Klasse, die im kompilierten Theme-JS und -CSS stehen muss (Prüfung Shop-Wächter) */
  marker: string;
};

export const STOREFRONT_SNIPPETS: StorefrontSnippetDef[] = [
  {
    key: "metaorder-checkout-cross-selling",
    name: "METAorder: Das passt dazu im Warenkorb",
    file: "checkout-cross-selling",
    script: "writeCheckoutCrossSelling.ts",
    protocolPrefix: "Warenkorb-Crossselling-Protokoll",
    marker: "meta-xsell",
  },
  {
    key: "metaorder-product-variants",
    name: "METAorder: Auch erhältlich in (Produktseite)",
    file: "product-variants",
    script: "writeProductVariants.ts",
    protocolPrefix: "Auch-erhaeltlich-Protokoll",
    marker: "meta-variants",
  },
  {
    key: "metaorder-quick-configurator",
    name: "METAorder: Regal-Schnellkonfigurator",
    file: "quick-configurator",
    script: "writeQuickConfigurator.ts",
    protocolPrefix: "Schnellkonfigurator-Protokoll",
    marker: "meta-qc",
  },
  {
    key: "metaorder-search-page",
    name: "METAorder: Suchergebnisseite",
    file: "search-page",
    script: "writeSearchPage.ts",
    protocolPrefix: "Suchseite-Protokoll",
    marker: "meta-search-hint",
  },
  {
    key: "metaorder-exit-intent",
    name: "METAorder: Newsletter-Modal mit Willkommensrabatt (Exit-Intent)",
    file: "exit-intent",
    script: "writeExitIntent.ts",
    protocolPrefix: "Exit-Intent-Protokoll",
    marker: "meta-exit",
  },
];

export function storefrontSnippet(key: string): StorefrontSnippetDef {
  const snippet = STOREFRONT_SNIPPETS.find((s) => s.key === key);
  if (!snippet) throw new Error(`Unbekannter Storefront-Baustein ${key}`);
  return snippet;
}

/**
 * Kundenmails B0: Hinweis auf E-Mail-Werbung an Bestandskunden (Kasse und Registrierung). Bewusst NICHT in
 * STOREFRONT_SNIPPETS, solange er nicht live ist (sonst meldet der Shop-Wächter einen fehlenden Baustein). Nach dem
 * Einspielen (scripts/writeEmailNotice.ts, erst nach Freigabe durch den DSB) in die Liste oben übernehmen.
 */
export const EMAIL_NOTICE_SNIPPET: StorefrontSnippetDef = {
  key: "metaorder-email-notice",
  name: "METAorder: Hinweis E-Mail-Werbung an Bestandskunden (Kasse, Registrierung)",
  file: "email-notice",
  script: "writeEmailNotice.ts",
  protocolPrefix: "E-Mail-Hinweis-Protokoll",
  marker: "meta-mail-notice",
};
