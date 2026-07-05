import type { IStorage } from "./storage";

export const CRM_PROFITABILITY_SETTINGS_KEY = "crm.profitability";

/** Mindest-Deckungsbeitrag in % auf Herstellkosten (inkl. Ziel für Gemeinkosten). */
export const DEFAULT_CRM_MIN_MARGIN_PERCENT = 20;

export type CrmProfitabilitySettings = {
  minMarginPercent: number;
};

export function parseCrmProfitabilitySettings(raw: unknown): CrmProfitabilitySettings {
  if (!raw || typeof raw !== "object") {
    return { minMarginPercent: DEFAULT_CRM_MIN_MARGIN_PERCENT };
  }
  const value = (raw as { minMarginPercent?: unknown }).minMarginPercent;
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 500) {
    return { minMarginPercent: DEFAULT_CRM_MIN_MARGIN_PERCENT };
  }
  return { minMarginPercent: Math.round(n * 10) / 10 };
}

export async function loadCrmProfitabilitySettings(
  storage: IStorage,
  tenantId?: string | null,
): Promise<CrmProfitabilitySettings> {
  const raw = await storage.getSetting(CRM_PROFITABILITY_SETTINGS_KEY, tenantId);
  return parseCrmProfitabilitySettings(raw);
}

export async function saveCrmProfitabilitySettings(
  storage: IStorage,
  settings: CrmProfitabilitySettings,
  tenantId?: string | null,
): Promise<CrmProfitabilitySettings> {
  const parsed = parseCrmProfitabilitySettings(settings);
  await storage.saveSetting(CRM_PROFITABILITY_SETTINGS_KEY, parsed, tenantId);
  return parsed;
}
