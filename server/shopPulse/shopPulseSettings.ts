import type { IStorage } from "../storage";
import {
  normalizeShopPulseSettings,
  SHOP_PULSE_LEARNING_DAYS,
  type ShopPulseSettings,
  type ShopPulseState,
} from "@shared/shopPulse";
import { getEmailIntakeSettings } from "../commercial/emailIntakeSettings";

export const SHOP_PULSE_SETTINGS_KEY = "shop_pulse_settings";
export const SHOP_PULSE_STATE_KEY = "shop_pulse_state";
export const SHOP_PULSE_TEAMS_OUTBOX_KEY = "shop_pulse_teams_outbox";

type SettingsStore = Pick<IStorage, "getSetting" | "saveSetting">;

export async function getShopPulseSettings(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseSettings> {
  return normalizeShopPulseSettings(await store.getSetting(SHOP_PULSE_SETTINGS_KEY, tenantId));
}

export type ShopPulseSettingsUpdate = Partial<Pick<ShopPulseSettings, "enabled" | "teamsWebhookUrl" | "shopWatchDirect">> & {
  /** Lernwoche jetzt beenden */
  endLearning?: boolean;
};

/**
 * Einstellungen ändern. Beim ersten Einschalten beginnt die Lernwoche (7 Tage nur sammeln); danach bleibt
 * learningUntil in der Vergangenheit stehen, ein erneutes Einschalten startet sie nicht wieder.
 */
export function applyShopPulseSettingsUpdate(current: ShopPulseSettings, update: ShopPulseSettingsUpdate, now: Date): ShopPulseSettings {
  const next: ShopPulseSettings = { ...current };
  if (update.enabled !== undefined) next.enabled = update.enabled;
  if (update.teamsWebhookUrl !== undefined) next.teamsWebhookUrl = update.teamsWebhookUrl.trim();
  if (update.shopWatchDirect !== undefined) next.shopWatchDirect = update.shopWatchDirect;
  if (next.enabled && !current.enabled && !current.learningUntil) {
    next.learningUntil = new Date(now.getTime() + SHOP_PULSE_LEARNING_DAYS * 24 * 60 * 60 * 1000).toISOString();
  }
  if (update.endLearning && next.learningUntil && Date.parse(next.learningUntil) > now.getTime()) {
    next.learningUntil = now.toISOString();
  }
  return next;
}

export async function saveShopPulseSettings(store: SettingsStore, tenantId: string | null, settings: ShopPulseSettings): Promise<void> {
  await store.saveSetting(SHOP_PULSE_SETTINGS_KEY, settings, tenantId);
}

export async function getShopPulseState(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<ShopPulseState> {
  const raw = await store.getSetting(SHOP_PULSE_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as ShopPulseState) : {};
}

export async function patchShopPulseState(store: SettingsStore, tenantId: string | null, patch: Partial<ShopPulseState>): Promise<void> {
  const current = await getShopPulseState(store, tenantId);
  await store.saveSetting(SHOP_PULSE_STATE_KEY, { ...current, ...patch }, tenantId);
}

/**
 * Wohin der Shop-Wächter in Teams meldet: an die Direktnachricht des Shop-Puls, wenn dort so eingestellt
 * und eine Adresse hinterlegt ist, sonst an den Kanal aus dem E-Mail-Eingang ("" = kein Teams).
 */
export async function shopWatchTeamsWebhookUrl(store: Pick<IStorage, "getSetting">, tenantId: string | null): Promise<string> {
  const pulse = await getShopPulseSettings(store, tenantId);
  if (pulse.shopWatchDirect && pulse.teamsWebhookUrl) return pulse.teamsWebhookUrl;
  return (await getEmailIntakeSettings(store as IStorage, tenantId)).teamsWebhookUrl.trim();
}
