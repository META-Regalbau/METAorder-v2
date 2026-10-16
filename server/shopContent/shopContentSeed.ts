/**
 * Ausgangsdaten der Shop-Inhalte aus dem Code (server/products/industryPages.ts, homeSections.ts).
 * „Aus Code übernehmen“ legt daraus Version 1 an; gemeinsame Texte, die eine Seite unveraendert nutzt,
 * werden dabei als Verweis gespeichert (compressIndustryPage).
 */
import { compressIndustryPage, type ShopContentData, type ShopContentKind } from "@shared/shopContent";
import { HOME_TEASER, INDUSTRY_COMMON, INDUSTRY_PAGES } from "../products/industryPages";
import { MONDU, RABATT } from "../products/homeSections";

export type ShopContentSeedEntry = { [K in ShopContentKind]: { kind: K; key: string; name: string; position: number; data: ShopContentData[K] } }[ShopContentKind];

/** Schluessel der Eintraege ausser den Branchenseiten (die heissen wie ihr `key`) */
export const SHOP_CONTENT_KEYS = { common: "branchen", homeTeaser: "start-branchen", homeRabatt: "start-rabatt", homeMondu: "start-mondu" } as const;

export function shopContentSeed(): ShopContentSeedEntry[] {
  return [
    ...INDUSTRY_PAGES.map((p, i): ShopContentSeedEntry => ({ kind: "industry_page", key: p.key, name: p.name, position: i, data: compressIndustryPage(p, INDUSTRY_COMMON) })),
    { kind: "home_teaser", key: SHOP_CONTENT_KEYS.homeTeaser, name: "Startseite: Regale für Ihre Branche", position: 0, data: HOME_TEASER },
    { kind: "home_rabatt", key: SHOP_CONTENT_KEYS.homeRabatt, name: "Startseite: Rabattstaffel", position: 1, data: RABATT },
    { kind: "home_mondu", key: SHOP_CONTENT_KEYS.homeMondu, name: "Startseite: B2B-Zahlung (Mondu)", position: 2, data: MONDU },
    { kind: "common", key: SHOP_CONTENT_KEYS.common, name: "Gemeinsame Texte der Branchenseiten", position: 0, data: INDUSTRY_COMMON },
  ];
}
