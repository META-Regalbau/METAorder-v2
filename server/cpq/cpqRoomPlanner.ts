/**
 * Geometrie-Hilfsfunktionen für die Raumplanung: Footprint einer CPQ-Konfiguration
 * (Grundriss in mm) und Kollisionsprüfung (Wand + Mindestabstand) für Platzierungen
 * in einem rechteckigen Raum. Rotation ist auf 90°-Schritte begrenzt, damit die
 * Kollisionsprüfung mit einfachen achsenparallelen Rechtecken (AABB) auskommt.
 */

export type CpqRoomRotationDeg = 0 | 90 | 180 | 270;

export type RoomFootprintMm = {
  lengthMm: number;
  depthMm: number;
  heightMm: number;
};

/** Grundriss aus der rohen CPQ-ConfigContext (field_count/width/depth/height) ableiten. */
export function computeFootprintFromCpqConfig(
  config: Record<string, unknown> | null | undefined,
): RoomFootprintMm | null {
  if (!config) return null;
  const fieldCount = Number(config.field_count);
  const width = Number(config.width);
  const depth = Number(config.depth);
  const height = Number(config.height);
  if (
    !Number.isFinite(fieldCount) ||
    !Number.isFinite(width) ||
    !Number.isFinite(depth) ||
    !Number.isFinite(height) ||
    fieldCount <= 0 ||
    width <= 0 ||
    depth <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    lengthMm: fieldCount * width + (fieldCount + 1) * 40,
    depthMm: depth,
    heightMm: height,
  };
}

export type RoomRect = { x0: number; y0: number; x1: number; y1: number };

/** (x,y) ist die linke/untere Ecke der Platzierung im Raumkoordinatensystem. */
export function placementRect(
  placement: { xMm: number; yMm: number; rotationDeg: CpqRoomRotationDeg },
  footprint: RoomFootprintMm,
): RoomRect {
  const rotated = placement.rotationDeg === 90 || placement.rotationDeg === 270;
  const w = rotated ? footprint.depthMm : footprint.lengthMm;
  const d = rotated ? footprint.lengthMm : footprint.depthMm;
  return { x0: placement.xMm, y0: placement.yMm, x1: placement.xMm + w, y1: placement.yMm + d };
}

function rectsIntersect(a: RoomRect, b: RoomRect): boolean {
  return a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
}

function inflate(rect: RoomRect, by: number): RoomRect {
  return { x0: rect.x0 - by, y0: rect.y0 - by, x1: rect.x1 + by, y1: rect.y1 + by };
}

export type RoomPlannableConfiguration = {
  configKey: string;
  name: string;
  footprint: RoomFootprintMm;
  cpqConfig: Record<string, unknown>;
};

/**
 * Extrahiert aus den Angebots-Lineitems (siehe offerDetailBuilder.ts) alle
 * Konfigurationsgruppen, die einen berechenbaren Grundriss haben — gemeinsame
 * Quelle für die Raumplanung-Routen UND den Raum-Abschnitt im Angebotsdetail
 * (Admin + öffentliche Angebotsseite), damit die Footprint-Logik nicht an
 * mehreren Stellen dupliziert wird.
 */
export function extractRoomPlannableConfigurations(
  lineItems: Array<{ id: string; label: string; isConfigurationGroup?: boolean; cpqConfig?: Record<string, unknown> | null }>,
): RoomPlannableConfiguration[] {
  const configurations: RoomPlannableConfiguration[] = [];
  for (const li of lineItems) {
    if (!li.isConfigurationGroup || !li.cpqConfig) continue;
    const footprint = computeFootprintFromCpqConfig(li.cpqConfig);
    if (footprint) configurations.push({ configKey: li.id, name: li.label, footprint, cpqConfig: li.cpqConfig });
  }
  return configurations;
}

export type RoomLayoutViolation =
  | { type: "wall-collision"; configKey: string }
  | { type: "min-spacing"; configKeyA: string; configKeyB: string }
  | { type: "missing-footprint"; configKey: string };

/**
 * Prüft alle Platzierungen gegen Raumgrenzen und Mindestabstand zueinander.
 * Rückgabe: leere Liste = alles gültig.
 */
export function validateRoomPlacements(
  room: { lengthMm: number; widthMm: number },
  placements: Array<{ configKey: string; xMm: number; yMm: number; rotationDeg: CpqRoomRotationDeg }>,
  footprintsByConfigKey: Map<string, RoomFootprintMm>,
  minSpacingMm: number,
): RoomLayoutViolation[] {
  const violations: RoomLayoutViolation[] = [];
  const rects = new Map<string, RoomRect>();

  for (const p of placements) {
    const footprint = footprintsByConfigKey.get(p.configKey);
    if (!footprint) {
      violations.push({ type: "missing-footprint", configKey: p.configKey });
      continue;
    }
    const rect = placementRect(p, footprint);
    rects.set(p.configKey, rect);
    if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > room.lengthMm || rect.y1 > room.widthMm) {
      violations.push({ type: "wall-collision", configKey: p.configKey });
    }
  }

  const keys = [...rects.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = rects.get(keys[i])!;
      const b = rects.get(keys[j])!;
      if (rectsIntersect(inflate(a, minSpacingMm / 2), inflate(b, minSpacingMm / 2))) {
        violations.push({ type: "min-spacing", configKeyA: keys[i], configKeyB: keys[j] });
      }
    }
  }

  return violations;
}
