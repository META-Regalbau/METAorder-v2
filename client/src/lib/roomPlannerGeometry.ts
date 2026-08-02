/**
 * Geometrie-Hilfsfunktionen für den Raumplaner (Client-Spiegel von
 * server/cpq/cpqRoomPlanner.ts) — Kollisionsprüfung während des Ziehens/Drehens,
 * bevor der Server beim Speichern noch einmal verbindlich validiert.
 */

export type CpqRoomRotationDeg = 0 | 90 | 180 | 270;

export type RoomFootprintMm = {
  lengthMm: number;
  depthMm: number;
  heightMm: number;
};

export type RoomPlacement = {
  configKey: string;
  xMm: number;
  yMm: number;
  rotationDeg: CpqRoomRotationDeg;
};

export type RoomRect = { x0: number; y0: number; x1: number; y1: number };

export type RoomWall = "north" | "south" | "east" | "west";
export type RoomWallFeatureType = "door" | "window" | "gate";

/**
 * Rein stilisierte Tür/Fenster/Tor-Markierung in einer Raumwand — ohne Kollisionsprüfung
 * gegen Regale. "offsetMm" misst ab der Wand-Startecke (Nord/Süd ab der linken/West-Ecke,
 * Ost/West ab der oberen/Nord-Ecke), "widthMm" ist die Öffnungsbreite entlang der Wand.
 */
export type RoomWallFeature = {
  id: string;
  wall: RoomWall;
  type: RoomWallFeatureType;
  offsetMm: number;
  widthMm: number;
};

export function wallLengthMmFor(wall: RoomWall, room: { lengthMm: number; widthMm: number }): number {
  return wall === "north" || wall === "south" ? room.lengthMm : room.widthMm;
}

export type WallFeatureGeometry = {
  /** Öffnungs-Endpunkte entlang der Wand (mm, Raumkoordinaten). */
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  /** Einheitsvektor, der ins Rauminnere zeigt (für die Türblatt-/Schwenk-Darstellung). */
  inward: { x: number; y: number };
  /** SVG-Arc-Sweep-Flag (0|1) für den Türschwenk von p1 nach p2. */
  sweepFlag: 0 | 1;
};

/** Geometrie einer Wandöffnung in Raumkoordinaten (mm) — Basis für Tür-/Fenster-/Tor-Rendering. */
export function wallFeatureGeometry(
  feature: RoomWallFeature,
  room: { lengthMm: number; widthMm: number },
): WallFeatureGeometry {
  const { wall, offsetMm, widthMm } = feature;
  let p1: { x: number; y: number };
  let p2: { x: number; y: number };
  let inward: { x: number; y: number };
  let alongWall: { x: number; y: number };

  if (wall === "north") {
    p1 = { x: offsetMm, y: 0 };
    p2 = { x: offsetMm + widthMm, y: 0 };
    alongWall = { x: 1, y: 0 };
    inward = { x: 0, y: 1 };
  } else if (wall === "south") {
    p1 = { x: offsetMm, y: room.widthMm };
    p2 = { x: offsetMm + widthMm, y: room.widthMm };
    alongWall = { x: 1, y: 0 };
    inward = { x: 0, y: -1 };
  } else if (wall === "west") {
    p1 = { x: 0, y: offsetMm };
    p2 = { x: 0, y: offsetMm + widthMm };
    alongWall = { x: 0, y: 1 };
    inward = { x: 1, y: 0 };
  } else {
    p1 = { x: room.lengthMm, y: offsetMm };
    p2 = { x: room.lengthMm, y: offsetMm + widthMm };
    alongWall = { x: 0, y: 1 };
    inward = { x: -1, y: 0 };
  }

  const cross = alongWall.x * inward.y - alongWall.y * inward.x;
  const sweepFlag: 0 | 1 = cross > 0 ? 0 : 1;

  return { p1, p2, inward, sweepFlag };
}

export function placementRect(placement: RoomPlacement, footprint: RoomFootprintMm): RoomRect {
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

export type RoomLayoutViolation =
  | { type: "wall-collision"; configKey: string }
  | { type: "min-spacing"; configKeyA: string; configKeyB: string };

export function validateRoomPlacements(
  room: { lengthMm: number; widthMm: number },
  placements: RoomPlacement[],
  footprintsByConfigKey: Map<string, RoomFootprintMm>,
  minSpacingMm: number,
): RoomLayoutViolation[] {
  const violations: RoomLayoutViolation[] = [];
  const rects = new Map<string, RoomRect>();

  for (const p of placements) {
    const footprint = footprintsByConfigKey.get(p.configKey);
    if (!footprint) continue;
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

/** Prüft eine einzelne Kandidatenposition gegen Wände + alle anderen (bereits platzierten) Rechtecke. */
export function isPlacementValid(
  room: { lengthMm: number; widthMm: number },
  candidate: RoomPlacement,
  footprint: RoomFootprintMm,
  others: Array<{ configKey: string; rect: RoomRect }>,
  minSpacingMm: number,
): boolean {
  const rect = placementRect(candidate, footprint);
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > room.lengthMm || rect.y1 > room.widthMm) return false;
  const inflated = inflate(rect, minSpacingMm / 2);
  for (const other of others) {
    if (other.configKey === candidate.configKey) continue;
    if (rectsIntersect(inflated, inflate(other.rect, minSpacingMm / 2))) return false;
  }
  return true;
}

export type RoomClearance = { distanceMm: number; toWall: boolean };
export type RoomClearances = { top: RoomClearance; right: RoomClearance; bottom: RoomClearance; left: RoomClearance };

/**
 * Für die Bemaßung im Editor: Abstand von jeder der 4 Kanten eines Rechtecks
 * zum jeweils nächstgelegenen Hindernis in dieser Richtung — entweder die
 * Raumwand oder ein anderes Regal, das sich mit der Kante (auf der jeweils
 * anderen Achse) überschneidet. "top"/"bottom" beziehen sich auf die y-Achse
 * (Richtung y=0 bzw. y=widthMm), "left"/"right" auf die x-Achse.
 */
export function computeClearances(
  rect: RoomRect,
  room: { lengthMm: number; widthMm: number },
  others: RoomRect[],
): RoomClearances {
  const overlapsX = (o: RoomRect) => o.x0 < rect.x1 && o.x1 > rect.x0;
  const overlapsY = (o: RoomRect) => o.y0 < rect.y1 && o.y1 > rect.y0;

  let topDist = rect.y0;
  let topWall = true;
  let bottomDist = room.widthMm - rect.y1;
  let bottomWall = true;
  let leftDist = rect.x0;
  let leftWall = true;
  let rightDist = room.lengthMm - rect.x1;
  let rightWall = true;

  for (const o of others) {
    if (o.y1 <= rect.y0 && overlapsX(o)) {
      const d = rect.y0 - o.y1;
      if (d < topDist) { topDist = d; topWall = false; }
    }
    if (o.y0 >= rect.y1 && overlapsX(o)) {
      const d = o.y0 - rect.y1;
      if (d < bottomDist) { bottomDist = d; bottomWall = false; }
    }
    if (o.x1 <= rect.x0 && overlapsY(o)) {
      const d = rect.x0 - o.x1;
      if (d < leftDist) { leftDist = d; leftWall = false; }
    }
    if (o.x0 >= rect.x1 && overlapsY(o)) {
      const d = o.x0 - rect.x1;
      if (d < rightDist) { rightDist = d; rightWall = false; }
    }
  }

  return {
    top: { distanceMm: Math.max(0, Math.round(topDist)), toWall: topWall },
    right: { distanceMm: Math.max(0, Math.round(rightDist)), toWall: rightWall },
    bottom: { distanceMm: Math.max(0, Math.round(bottomDist)), toWall: bottomWall },
    left: { distanceMm: Math.max(0, Math.round(leftDist)), toWall: leftWall },
  };
}

/** Schwelle für die automatische Vorderseiten-Ausrichtung an Wänden (mm). */
export const AUTO_FACE_WALL_THRESHOLD_MM = 500;

/**
 * Ermittelt, ob ein Regal an der gegebenen Kandidatenposition automatisch gedreht werden
 * soll, damit seine Vorderseite von einer nahen Wand wegzeigt (sobald diese näher als
 * `thresholdMm` ist — Standard 500mm/50cm). Prüft mehrere nahe Wände in Reihenfolge
 * wachsender Distanz: steht das Regal z. B. in einer Ecke und würde die Ausrichtung zur
 * nächstgelegenen Wand mit einem Nachbarregal kollidieren (Rotation ändert bei Regalen mit
 * Breite ≠ Tiefe den belegten Fußabdruck), wird stattdessen die zweitnächste Wand probiert
 * usw. — damit nicht bei jeder Kollision ersatzlos die alte, ggf. irreführende Ausrichtung
 * stehen bleibt. Gibt die Ziel-Rotation zurück, oder null, wenn keine Wand nah genug ist,
 * die aktuelle Rotation bereits zu einer nahen Wand passt, oder keine der Kandidaten-Rotationen
 * an dieser Stelle gültig ist.
 */
export function computeAutoFaceRotation(
  candidate: RoomPlacement,
  footprint: RoomFootprintMm,
  room: { lengthMm: number; widthMm: number },
  others: Array<{ configKey: string; rect: RoomRect }>,
  minSpacingMm: number,
  thresholdMm: number = AUTO_FACE_WALL_THRESHOLD_MM,
): CpqRoomRotationDeg | null {
  const rect = placementRect(candidate, footprint);
  // Front-Konvention (siehe FrontMarker in RoomPlannerPage.tsx): 0°→Süden, 90°→Westen,
  // 180°→Norden, 270°→Osten. "Nah an Wand X" → Front muss von X wegzeigen, also zur
  // gegenüberliegenden Himmelsrichtung.
  const nearWalls = [
    { dist: rect.y0, rotation: 0 as CpqRoomRotationDeg }, // nah an Nordwand → Front nach Süden
    { dist: room.widthMm - rect.y1, rotation: 180 as CpqRoomRotationDeg }, // nah an Südwand → Front nach Norden
    { dist: rect.x0, rotation: 270 as CpqRoomRotationDeg }, // nah an Westwand → Front nach Osten
    { dist: room.lengthMm - rect.x1, rotation: 90 as CpqRoomRotationDeg }, // nah an Ostwand → Front nach Westen
  ]
    .filter((w) => w.dist < thresholdMm)
    .sort((a, b) => a.dist - b.dist);

  for (const wall of nearWalls) {
    if (wall.rotation === candidate.rotationDeg) return null; // zeigt bereits von dieser nahen Wand weg
    const rotatedCandidate: RoomPlacement = { ...candidate, rotationDeg: wall.rotation };
    if (isPlacementValid(room, rotatedCandidate, footprint, others, minSpacingMm)) {
      return wall.rotation;
    }
  }
  return null;
}

/** Erste freie (kollisionsfreie) Position im Raster für eine noch nicht platzierte Konfiguration. */
export function findFreeSpot(
  room: { lengthMm: number; widthMm: number },
  footprint: RoomFootprintMm,
  placed: RoomPlacement[],
  footprintsByConfigKey: Map<string, RoomFootprintMm>,
  minSpacingMm: number,
): { xMm: number; yMm: number } | null {
  const others = placed
    .map((p) => {
      const fp = footprintsByConfigKey.get(p.configKey);
      return fp ? { configKey: p.configKey, rect: placementRect(p, fp) } : null;
    })
    .filter((o): o is { configKey: string; rect: RoomRect } => !!o);

  const step = Math.max(50, Math.round(minSpacingMm || 50));
  for (let y = 0; y + footprint.depthMm <= room.widthMm; y += step) {
    for (let x = 0; x + footprint.lengthMm <= room.lengthMm; x += step) {
      const candidate: RoomPlacement = { configKey: "__probe__", xMm: x, yMm: y, rotationDeg: 0 };
      if (isPlacementValid(room, candidate, footprint, others, minSpacingMm)) {
        return { xMm: x, yMm: y };
      }
    }
  }
  return null;
}
