// Einstellungen der Cross-Selling-Automatik je Mandant (settings: cross_sell_automation_settings).
// Alles, was neu in den Shop schreibt, ist standardmaessig aus (mode "off").
import { z } from "zod";
import { DEFAULT_MANAGED_CROSS_SELLING_GROUP_NAME } from "@shared/schema";

export const CROSS_SELL_AUTOMATION_SETTINGS_KEY = "cross_sell_automation_settings";

export const crossSellAutomationSettingsSchema = z.object({
  /** off: nichts automatisch; review: Pruefliste; auto_dry_run: Pruefliste + Markierung; auto: sichere Ergaenzungen setzen. */
  mode: z.enum(["off", "review", "auto_dry_run", "auto"]),
  /** Name der vom System verwalteten Liste im Shop (eigener Tab, getrennt von Handgruppen). */
  managedGroupName: z.string().trim().min(1).max(80),
  monthlyReviewEnabled: z.boolean(),
  reportEmail: z.string().trim().max(320),
  reviewDayOfMonth: z.number().int().min(1).max(28),
  reviewHourLocal: z.number().int().min(0).max(23),
  maxAutoApplyPerRun: z.number().int().min(0).max(500),
  maxAutoApplyPerSource: z.number().int().min(0).max(20),
  maxTargetsPerManagedGroup: z.number().int().min(1).max(50),
  maxNewQueueItemsPerRun: z.number().int().min(0).max(2000),
  queueMinScore: z.number().min(0).max(1),
  minPairOrders: z.number().int().min(1).max(1000),
  minDistinctCustomers: z.number().int().min(1).max(1000),
  minConfidenceLB: z.number().min(0).max(1),
  minLiftLB: z.number().min(0).max(100),
  minLlmConfidence: z.number().min(0).max(1),
  llmMaxCallsPerRun: z.number().int().min(0).max(1000),
  llmMaxCallsMonthlyRun: z.number().int().min(0).max(5000),
  llmMaxCallsPerMonth: z.number().int().min(0).max(20000),
  llmRecheckDays: z.number().int().min(1).max(3650),
});

export type CrossSellAutomationSettings = z.infer<typeof crossSellAutomationSettingsSchema>;

export const DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS: CrossSellAutomationSettings = {
  mode: "off",
  managedGroupName: DEFAULT_MANAGED_CROSS_SELLING_GROUP_NAME,
  monthlyReviewEnabled: false,
  reportEmail: "",
  reviewDayOfMonth: 1,
  reviewHourLocal: 6,
  maxAutoApplyPerRun: 15,
  maxAutoApplyPerSource: 2,
  maxTargetsPerManagedGroup: 10,
  maxNewQueueItemsPerRun: 100,
  queueMinScore: 0.35,
  minPairOrders: 5,
  minDistinctCustomers: 3,
  minConfidenceLB: 0.1,
  minLiftLB: 1.5,
  minLlmConfidence: 0.8,
  llmMaxCallsPerRun: 40,
  llmMaxCallsMonthlyRun: 300,
  llmMaxCallsPerMonth: 800,
  llmRecheckDays: 180,
};

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

/** Gespeicherte Werte ueber die Standards legen; ungueltige Einzelwerte fallen auf den Standard zurueck. */
export function mergeCrossSellAutomationSettings(stored: unknown): CrossSellAutomationSettings {
  const out: Record<string, unknown> = { ...DEFAULT_CROSS_SELL_AUTOMATION_SETTINGS };
  if (stored && typeof stored === "object") {
    const shape = crossSellAutomationSettingsSchema.shape as Record<string, z.ZodTypeAny>;
    for (const [key, value] of Object.entries(stored as Record<string, unknown>)) {
      const field = shape[key];
      if (!field) continue;
      const parsed = field.safeParse(value);
      if (parsed.success) out[key] = parsed.data;
    }
  }
  return out as CrossSellAutomationSettings;
}

export async function getCrossSellAutomationSettings(
  store: SettingsStore,
  tenantId?: string | null,
): Promise<CrossSellAutomationSettings> {
  return mergeCrossSellAutomationSettings(await store.getSetting(CROSS_SELL_AUTOMATION_SETTINGS_KEY, tenantId));
}

export async function saveCrossSellAutomationSettings(
  store: SettingsStore,
  patch: Partial<CrossSellAutomationSettings>,
  tenantId?: string | null,
): Promise<CrossSellAutomationSettings> {
  const merged = { ...(await getCrossSellAutomationSettings(store, tenantId)), ...patch };
  const validated = crossSellAutomationSettingsSchema.parse(merged);
  await store.saveSetting(CROSS_SELL_AUTOMATION_SETTINGS_KEY, validated, tenantId);
  return validated;
}

/** Globaler Notschalter: CROSS_SELL_AUTOMATION_ENABLED=false schaltet jede Automatik ab. */
export function crossSellAutomationGloballyEnabled(env: string | undefined = process.env.CROSS_SELL_AUTOMATION_ENABLED): boolean {
  return env !== "false";
}
