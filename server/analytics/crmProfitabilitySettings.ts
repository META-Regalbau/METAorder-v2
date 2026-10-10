import type { IStorage } from "../storage";

export const CRM_PROFITABILITY_SETTINGS_KEY = "crm.profitability";

/** Mindest-Deckungsbeitrag in % auf Herstellkosten (inkl. Ziel für Gemeinkosten): ab hier grün. */
export const DEFAULT_CRM_MIN_MARGIN_PERCENT = 20;

/** Unter diesem Aufschlag auf Herstellkosten ist die Ampel rot, dazwischen gelb. */
export const DEFAULT_CRM_WARN_MARGIN_PERCENT = 7;

export type CrmProfitabilitySettings = {
  /** Grün ab diesem Aufschlag auf Herstellkosten. */
  minMarginPercent: number;
  /** Rot unter diesem Aufschlag; zwischen warn und min gelb. Nie größer als minMarginPercent. */
  warnMarginPercent: number;
};

function parsePercent(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 500) return null;
  return Math.round(n * 10) / 10;
}

export function parseCrmProfitabilitySettings(raw: unknown): CrmProfitabilitySettings {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const minMarginPercent = parsePercent(obj.minMarginPercent) ?? DEFAULT_CRM_MIN_MARGIN_PERCENT;
  const warn = parsePercent(obj.warnMarginPercent) ?? DEFAULT_CRM_WARN_MARGIN_PERCENT;
  return { minMarginPercent, warnMarginPercent: Math.min(warn, minMarginPercent) };
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
