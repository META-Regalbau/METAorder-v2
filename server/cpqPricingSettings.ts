import type { IStorage } from "./storage";

export const CPQ_PRICING_SETTINGS_KEY = "cpq.pricing";

/**
 * "Erweiterter Preis" / Katalogpreis: Shopware-Preisregel "Standard Preise Portal (Bruttopreisliste)".
 * Basis für den prozentualen B2B-Rabatt (nicht der Shop-Preis).
 */
export const DEFAULT_EXTENDED_PRICE_RULE_ID = "019d72e169957987baf36345494b67f9";
export const DEFAULT_EXTENDED_PRICE_RULE_NAME = "Standard Preise Portal (Bruttopreisliste)";

/**
 * Verkaufskanal-Namenspräfix, das einen Kunden als B2B-Portal-Kunden markiert
 * (z. B. "META Händler Portal DE", "META Händler Portal AT"). Nur für diese
 * Kunden gilt der erweiterte Preis (Portal-Regel) − B2B-Standardrabatt.
 * Alle anderen Kanäle (z. B. "META Regalbau DE") sind normale Onlineshop-Kunden.
 */
export const DEFAULT_PORTAL_CHANNEL_NAME_PREFIX = "META Händler Portal";

export type CpqPricingSettings = {
  extendedPriceRuleId: string | null;
  extendedPriceRuleName: string | null;
  /** Zusatzrabatt-Regel: liefert bereits den fertigen Endpreis (kein zusätzlicher %-Abzug nötig). */
  additionalDiscountRuleId: string | null;
  additionalDiscountRuleName: string | null;
  /** Verkaufskanal-Namenspräfix für B2B-Portal-Kunden (case-insensitiv geprüft). */
  portalChannelNamePrefix: string;
};

function normalizeId(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

function normalizeName(value: unknown): string | null {
  const s = typeof value === "string" ? value.trim() : "";
  return s.length > 0 ? s : null;
}

export function parseCpqPricingSettings(raw: unknown): CpqPricingSettings {
  if (!raw || typeof raw !== "object") {
    return {
      extendedPriceRuleId: DEFAULT_EXTENDED_PRICE_RULE_ID,
      extendedPriceRuleName: DEFAULT_EXTENDED_PRICE_RULE_NAME,
      additionalDiscountRuleId: null,
      additionalDiscountRuleName: null,
      portalChannelNamePrefix: DEFAULT_PORTAL_CHANNEL_NAME_PREFIX,
    };
  }
  const value = raw as Record<string, unknown>;
  return {
    extendedPriceRuleId: normalizeId(value.extendedPriceRuleId) ?? DEFAULT_EXTENDED_PRICE_RULE_ID,
    extendedPriceRuleName: normalizeName(value.extendedPriceRuleName) ?? DEFAULT_EXTENDED_PRICE_RULE_NAME,
    additionalDiscountRuleId: normalizeId(value.additionalDiscountRuleId),
    additionalDiscountRuleName: normalizeName(value.additionalDiscountRuleName),
    portalChannelNamePrefix: normalizeName(value.portalChannelNamePrefix) ?? DEFAULT_PORTAL_CHANNEL_NAME_PREFIX,
  };
}

export async function loadCpqPricingSettings(
  storage: IStorage,
  tenantId?: string | null,
): Promise<CpqPricingSettings> {
  const raw = await storage.getSetting(CPQ_PRICING_SETTINGS_KEY, tenantId);
  return parseCpqPricingSettings(raw);
}

export async function saveCpqPricingSettings(
  storage: IStorage,
  settings: Partial<CpqPricingSettings>,
  tenantId?: string | null,
): Promise<CpqPricingSettings> {
  const parsed = parseCpqPricingSettings(settings);
  await storage.saveSetting(CPQ_PRICING_SETTINGS_KEY, parsed, tenantId);
  return parsed;
}
