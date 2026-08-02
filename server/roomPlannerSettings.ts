import type { IStorage } from "./storage";

export const ROOM_PLANNER_SETTINGS_KEY = "cpq.roomPlanner";

/** Mindestabstand zwischen zwei Regalen in der Raumplanung, falls kein Raum-Layout einen eigenen Wert setzt. */
export const DEFAULT_MIN_SPACING_MM = 100;

export type RoomPlannerSettings = {
  defaultMinSpacingMm: number;
};

function normalizeSpacing(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
}

export function parseRoomPlannerSettings(raw: unknown): RoomPlannerSettings {
  if (!raw || typeof raw !== "object") {
    return { defaultMinSpacingMm: DEFAULT_MIN_SPACING_MM };
  }
  const value = raw as Record<string, unknown>;
  return {
    defaultMinSpacingMm: normalizeSpacing(value.defaultMinSpacingMm) ?? DEFAULT_MIN_SPACING_MM,
  };
}

export async function loadRoomPlannerSettings(
  storage: IStorage,
  tenantId?: string | null,
): Promise<RoomPlannerSettings> {
  const raw = await storage.getSetting(ROOM_PLANNER_SETTINGS_KEY, tenantId);
  return parseRoomPlannerSettings(raw);
}

export async function saveRoomPlannerSettings(
  storage: IStorage,
  settings: Partial<RoomPlannerSettings>,
  tenantId?: string | null,
): Promise<RoomPlannerSettings> {
  const parsed = parseRoomPlannerSettings(settings);
  await storage.saveSetting(ROOM_PLANNER_SETTINGS_KEY, parsed, tenantId);
  return parsed;
}
