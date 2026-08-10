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

/**
 * Richtung, in die die Vorderseite bei gegebener Rotation zeigt.
 * Konvention wie im FrontMarker: 0°→Süden, 90°→Westen, 180°→Norden, 270°→Osten.
 */
export function frontDirection(rotationDeg: CpqRoomRotationDeg): { dx: number; dy: number } {
  if (rotationDeg === 0) return { dx: 0, dy: 1 };
  if (rotationDeg === 90) return { dx: -1, dy: 0 };
  if (rotationDeg === 180) return { dx: 0, dy: -1 };
  return { dx: 1, dy: 0 };
}

/** Liegt b (ganz oder teilweise) vor der Vorderseite von a? */
function liegtVorDerFront(a: { rect: RoomRect; rotationDeg: CpqRoomRotationDeg }, b: RoomRect): boolean {
  const dir = frontDirection(a.rotationDeg);
  if (dir.dy === 1) return b.y0 >= a.rect.y1;
  if (dir.dy === -1) return b.y1 <= a.rect.y0;
  if (dir.dx === 1) return b.x0 >= a.rect.x1;
  return b.x1 <= a.rect.x0;
}

/** Tatsächlicher Abstand zweier Rechtecke; 0 bei Überlappung. */
function abstandMm(a: RoomRect, b: RoomRect): number {
  const dx = Math.max(0, Math.max(a.x0 - b.x1, b.x0 - a.x1));
  const dy = Math.max(0, Math.max(a.y0 - b.y1, b.y0 - a.y1));
  return Math.max(dx, dy);
}

/**
 * Geforderter Abstand zwischen zwei Regalen.
 *
 * Seitlich und hinten genügt der Mindestabstand; vor der Vorderseite muss der Gang passen.
 * Maßgeblich ist der größere der beiden Ansprüche — stehen sich zwei Regale mit den Fronten
 * gegenüber, teilen sie sich EINEN Gang. Würde man beide Ansprüche addieren, käme der
 * doppelte Gang heraus.
 */
export function requiredGapMm(
  a: { rect: RoomRect; rotationDeg: CpqRoomRotationDeg },
  b: { rect: RoomRect; rotationDeg: CpqRoomRotationDeg },
  minSpacingMm: number,
  frontClearanceMm: number,
): number {
  const vonA = liegtVorDerFront(a, b.rect) ? frontClearanceMm : minSpacingMm;
  const vonB = liegtVorDerFront(b, a.rect) ? frontClearanceMm : minSpacingMm;
  return Math.max(vonA, vonB);
}

export type RoomLayoutViolation =
  | { type: "wall-collision"; configKey: string }
  | { type: "min-spacing"; configKeyA: string; configKeyB: string }
  | { type: "opening-blocked"; configKey: string; featureId: string }
  | { type: "front-clearance"; configKeyA: string; configKeyB: string; requiredMm: number; actualMm: number };

/**
 * Freizuhaltende Tiefe vor einer Wandöffnung, in mm.
 *
 * Tür: der Schwenkbereich entspricht der Türblattbreite — eine 1.000er Tür braucht 1.000 mm
 * davor. Tor: Anfahr- und Rangierzone, deutlich mehr als die reine Öffnungsbreite, hier
 * konservativ die Öffnungsbreite mindestens aber 1.500 mm. Fenster: Regale dürfen davor
 * stehen (Brüstungshöhe), deshalb keine Sperrfläche.
 */
export function openingClearanceDepthMm(feature: RoomWallFeature): number {
  if (feature.type === "window") return 0;
  if (feature.type === "gate") return Math.max(1500, feature.widthMm);
  return feature.widthMm;
}

/**
 * Sperrflächen vor Türen und Toren als Rechtecke in Raumkoordinaten.
 * Ein Regal, das eines dieser Rechtecke schneidet, verstellt die Öffnung.
 */
export function openingBlockZones(
  features: RoomWallFeature[],
  room: { lengthMm: number; widthMm: number },
): Array<{ featureId: string; rect: RoomRect }> {
  const zones: Array<{ featureId: string; rect: RoomRect }> = [];
  for (const f of features) {
    const tiefe = openingClearanceDepthMm(f);
    if (tiefe <= 0) continue;
    const von = Math.max(0, f.offsetMm);
    const bis = Math.min(wallLengthMmFor(f.wall, room), f.offsetMm + f.widthMm);
    if (bis <= von) continue;

    let rect: RoomRect;
    if (f.wall === "north") rect = { x0: von, y0: 0, x1: bis, y1: tiefe };
    else if (f.wall === "south") rect = { x0: von, y0: room.widthMm - tiefe, x1: bis, y1: room.widthMm };
    else if (f.wall === "west") rect = { x0: 0, y0: von, x1: tiefe, y1: bis };
    else rect = { x0: room.lengthMm - tiefe, y0: von, x1: room.lengthMm, y1: bis };

    zones.push({ featureId: f.id, rect });
  }
  return zones;
}

export function validateRoomPlacements(
  room: { lengthMm: number; widthMm: number },
  placements: RoomPlacement[],
  footprintsByConfigKey: Map<string, RoomFootprintMm>,
  minSpacingMm: number,
  /** Wandöffnungen; ohne Angabe wird nicht gegen Sperrflächen geprüft (Altverhalten). */
  wallFeatures?: RoomWallFeature[],
  /** Gangbreite vor der Vorderseite; ohne Angabe gilt überall der Mindestabstand. */
  frontClearanceMm?: number,
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

  const rotationByKey = new Map(placements.map((p) => [p.configKey, p.rotationDeg]));
  const keys = [...rects.keys()];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) {
      const a = { rect: rects.get(keys[i])!, rotationDeg: rotationByKey.get(keys[i])! };
      const b = { rect: rects.get(keys[j])!, rotationDeg: rotationByKey.get(keys[j])! };
      const gefordert = requiredGapMm(a, b, minSpacingMm, frontClearanceMm ?? minSpacingMm);
      const tatsaechlich = abstandMm(a.rect, b.rect);
      if (tatsaechlich >= gefordert) continue;
      // Reicht schon der seitliche Mindestabstand nicht, ist das der Grundverstoß;
      // erst darüber hinaus geht es um den Gang.
      if (tatsaechlich < minSpacingMm) {
        violations.push({ type: "min-spacing", configKeyA: keys[i], configKeyB: keys[j] });
      } else {
        violations.push({
          type: "front-clearance",
          configKeyA: keys[i],
          configKeyB: keys[j],
          requiredMm: gefordert,
          actualMm: Math.round(tatsaechlich),
        });
      }
    }
  }

  for (const zone of openingBlockZones(wallFeatures ?? [], room)) {
    for (const [configKey, rect] of rects) {
      if (rectsIntersect(rect, zone.rect)) {
        violations.push({ type: "opening-blocked", configKey, featureId: zone.featureId });
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
  /** rotationDeg mitgeben, damit der Gang vor der Vorderseite geprüft werden kann. */
  others: Array<{ configKey: string; rect: RoomRect; rotationDeg?: CpqRoomRotationDeg }>,
  minSpacingMm: number,
  /** Gangbreite vor der Vorderseite; ohne Angabe gilt überall der Mindestabstand. */
  frontClearanceMm?: number,
): boolean {
  const rect = placementRect(candidate, footprint);
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > room.lengthMm || rect.y1 > room.widthMm) return false;
  const gang = frontClearanceMm ?? minSpacingMm;
  const a = { rect, rotationDeg: candidate.rotationDeg };
  for (const other of others) {
    if (other.configKey === candidate.configKey) continue;
    // Ohne bekannte Rotation des Nachbarn nur dessen Rückseite annehmen (Mindestabstand) —
    // die Vorderseite des Kandidaten wird trotzdem berücksichtigt.
    const b = { rect: other.rect, rotationDeg: other.rotationDeg ?? candidate.rotationDeg };
    const gefordert = other.rotationDeg === undefined
      ? Math.max(liegtVorDerFront(a, other.rect) ? gang : minSpacingMm, minSpacingMm)
      : requiredGapMm(a, b, minSpacingMm, gang);
    if (abstandMm(rect, other.rect) < gefordert) return false;
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
 * Standard-Wandabstand (mm).
 *
 * Regale stehen nicht bündig an der Wand: Sockelleisten, Rohrleitungen und die Reinigung
 * brauchen Luft, und bei Anbauregalen liegen die Rahmenfüße auf. 150 mm ist der Wert, mit
 * dem in der Praxis geplant wird.
 */
export const DEFAULT_WALL_CLEARANCE_MM = 150;

/**
 * Rückt eine Platzierung auf den Soll-Wandabstand, wenn sie näher als dieser an einer Wand
 * liegt. Ohne das würde die Autodrehung ein Regal zwar korrekt ausrichten, es aber bündig
 * an der Wand kleben lassen.
 *
 * Wirkt je Achse getrennt und nur nach innen — ein Regal in der Raummitte bleibt unberührt.
 */
export function snapToWallClearance(
  placement: RoomPlacement,
  footprint: RoomFootprintMm,
  room: { lengthMm: number; widthMm: number },
  clearanceMm: number = DEFAULT_WALL_CLEARANCE_MM,
): RoomPlacement {
  const rect = placementRect(placement, footprint);
  const breite = rect.x1 - rect.x0;
  const tiefe = rect.y1 - rect.y0;

  let x = placement.xMm;
  let y = placement.yMm;

  if (rect.x0 < clearanceMm) x = clearanceMm;
  else if (room.lengthMm - rect.x1 < clearanceMm) x = room.lengthMm - clearanceMm - breite;

  if (rect.y0 < clearanceMm) y = clearanceMm;
  else if (room.widthMm - rect.y1 < clearanceMm) y = room.widthMm - clearanceMm - tiefe;

  // Passt das Regal nicht mehr zwischen die Wände, bleibt die ursprüngliche Position —
  // ein Sprung auf eine negative Koordinate wäre schlechter als ein zu kleiner Abstand.
  if (x < 0 || y < 0 || x + breite > room.lengthMm || y + tiefe > room.widthMm) return placement;
  return { ...placement, xMm: Math.round(x), yMm: Math.round(y) };
}

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

// ---------------------------------------------------------------------------------------
// Automatische Anordnung
//
// Bewusst deterministisch: dieselbe Konfiguration ergibt immer dieselbe Anordnung. Das
// Ergebnis landet im Angebots-PDF, dort wäre eine bei jedem Klick andere Aufteilung nicht
// vermittelbar. Beide Verfahren liefern nur Platzierungen; die Prüfung bleibt bei
// validateRoomPlacements, damit Auto- und Handanordnung denselben Regeln unterliegen.
// ---------------------------------------------------------------------------------------

export type AutoLayoutItem = { configKey: string; footprint: RoomFootprintMm };

export type AutoLayoutOptions = {
  minSpacingMm: number;
  /** Abstand zur Wand — Sockelleisten, Anfahrschutz, Reinigung. */
  wallClearanceMm: number;
  /** Nur für "rows": lichte Gangbreite zwischen zwei Regalzeilen. */
  aisleWidthMm: number;
  /** Freiraum vor der Vorderseite; fällt ohne Angabe auf aisleWidthMm zurück. */
  frontClearanceMm: number;
  wallFeatures: RoomWallFeature[];
};

export type AutoLayoutResult = {
  placements: RoomPlacement[];
  /** configKeys, für die kein Platz gefunden wurde. */
  unplaced: string[];
};

const DEFAULT_AUTO_LAYOUT: Pick<
  AutoLayoutOptions,
  "minSpacingMm" | "wallClearanceMm" | "aisleWidthMm" | "frontClearanceMm"
> = {
  minSpacingMm: 100,
  wallClearanceMm: DEFAULT_WALL_CLEARANCE_MM,
  aisleWidthMm: 1200,
  frontClearanceMm: 1200,
};

function passtOhneKonflikt(
  kandidat: { rect: RoomRect; rotationDeg: CpqRoomRotationDeg },
  room: { lengthMm: number; widthMm: number },
  belegt: Array<{ rect: RoomRect; rotationDeg: CpqRoomRotationDeg }>,
  zonen: Array<{ rect: RoomRect }>,
  minSpacingMm: number,
  frontClearanceMm: number,
): boolean {
  const { rect } = kandidat;
  if (rect.x0 < 0 || rect.y0 < 0 || rect.x1 > room.lengthMm || rect.y1 > room.widthMm) return false;
  for (const b of belegt) {
    if (abstandMm(rect, b.rect) < requiredGapMm(kandidat, b, minSpacingMm, frontClearanceMm)) return false;
  }
  for (const z of zonen) if (rectsIntersect(rect, z.rect)) return false;
  return true;
}

/**
 * Wandverteilung: Regale mit dem Rücken an die Wände, im Uhrzeigersinn ab der Nordwand.
 *
 * Die Rotation ist je Wand fest, damit die Bedienseite immer ins Rauminnere zeigt: Nord 0°,
 * Ost 90°, Süd 180°, West 270°. Große Regale zuerst — sonst blockieren viele kleine die
 * langen Wandabschnitte und die großen bleiben übrig.
 */
export function autoLayoutAlongWalls(
  room: { lengthMm: number; widthMm: number },
  items: AutoLayoutItem[],
  options: Partial<AutoLayoutOptions> = {},
): AutoLayoutResult {
  const zusammengefuehrt = { ...DEFAULT_AUTO_LAYOUT, wallFeatures: [], ...options };
  // Ohne eigenen Wert gilt der Gang als Freiraum vor der Vorderseite.
  const opt = {
    ...zusammengefuehrt,
    frontClearanceMm: options.frontClearanceMm ?? zusammengefuehrt.aisleWidthMm,
  };
  const zonen = openingBlockZones(opt.wallFeatures, room);
  const belegt: Array<{ rect: RoomRect; rotationDeg: CpqRoomRotationDeg }> = [];
  const placements: RoomPlacement[] = [];
  const unplaced: string[] = [];

  const offen = [...items].sort((a, b) => b.footprint.lengthMm - a.footprint.lengthMm);
  const waende: Array<{ wall: RoomWall; rotationDeg: CpqRoomRotationDeg }> = [
    { wall: "north", rotationDeg: 0 },
    { wall: "east", rotationDeg: 90 },
    { wall: "south", rotationDeg: 180 },
    { wall: "west", rotationDeg: 270 },
  ];

  for (const item of offen) {
    let gesetzt = false;
    for (const { wall, rotationDeg } of waende) {
      const gedreht = rotationDeg === 90 || rotationDeg === 270;
      const breite = gedreht ? item.footprint.depthMm : item.footprint.lengthMm;
      const tiefe = gedreht ? item.footprint.lengthMm : item.footprint.depthMm;

      // Entlang der Wand in Schritten suchen: kleine Schritte finden Lücken zwischen
      // Öffnungen, ohne dass ein vollständiges Packing nötig wäre.
      const schritt = Math.max(50, Math.round(opt.minSpacingMm / 2));
      const maxEntlang =
        wall === "north" || wall === "south"
          ? room.lengthMm - breite - opt.wallClearanceMm
          : room.widthMm - tiefe - opt.wallClearanceMm;

      for (let d = opt.wallClearanceMm; d <= maxEntlang; d += schritt) {
        let x: number;
        let y: number;
        if (wall === "north") { x = d; y = opt.wallClearanceMm; }
        else if (wall === "south") { x = d; y = room.widthMm - tiefe - opt.wallClearanceMm; }
        else if (wall === "west") { x = opt.wallClearanceMm; y = d; }
        else { x = room.lengthMm - breite - opt.wallClearanceMm; y = d; }

        const kandidat: RoomPlacement = { configKey: item.configKey, xMm: Math.round(x), yMm: Math.round(y), rotationDeg };
        const rect = placementRect(kandidat, item.footprint);
        const eintrag = { rect, rotationDeg };
        if (!passtOhneKonflikt(eintrag, room, belegt, zonen, opt.minSpacingMm, opt.frontClearanceMm)) continue;
        placements.push(kandidat);
        belegt.push(eintrag);
        gesetzt = true;
        break;
      }
      if (gesetzt) break;
    }
    if (!gesetzt) unplaced.push(item.configKey);
  }

  return { placements, unplaced };
}

/**
 * Reihen: Regalzeilen quer zum Raum, dazwischen ein Gang in voller Breite.
 *
 * Klassische Lageraufteilung. Die Zeilen laufen entlang der Raumlänge, gestapelt über die
 * Raumtiefe. Je Zeile werden Regale nebeneinander gesetzt, bis die Länge voll ist; danach
 * beginnt nach einem Gang die nächste Zeile. Rotation 0° — Bedienseite zum Gang.
 */
export function autoLayoutRows(
  room: { lengthMm: number; widthMm: number },
  items: AutoLayoutItem[],
  options: Partial<AutoLayoutOptions> = {},
): AutoLayoutResult {
  const zusammengefuehrt = { ...DEFAULT_AUTO_LAYOUT, wallFeatures: [], ...options };
  // Ohne eigenen Wert gilt der Gang als Freiraum vor der Vorderseite.
  const opt = {
    ...zusammengefuehrt,
    frontClearanceMm: options.frontClearanceMm ?? zusammengefuehrt.aisleWidthMm,
  };
  const zonen = openingBlockZones(opt.wallFeatures, room);
  const belegt: Array<{ rect: RoomRect; rotationDeg: CpqRoomRotationDeg }> = [];
  const placements: RoomPlacement[] = [];
  const unplaced: string[] = [];

  // Nach Tiefe gruppieren: Regale gleicher Tiefe ergeben eine bündige Zeile.
  const offen = [...items].sort(
    (a, b) => b.footprint.depthMm - a.footprint.depthMm || b.footprint.lengthMm - a.footprint.lengthMm,
  );

  let y = opt.wallClearanceMm;
  let i = 0;
  while (i < offen.length && y < room.widthMm) {
    const zeilenTiefe = offen[i].footprint.depthMm;
    if (y + zeilenTiefe + opt.wallClearanceMm > room.widthMm) break;

    let x = opt.wallClearanceMm;
    let inZeile = 0;
    while (i < offen.length) {
      const item = offen[i];
      // Nur Regale ähnlicher Tiefe in dieselbe Zeile, sonst franst die Zeile aus.
      if (Math.abs(item.footprint.depthMm - zeilenTiefe) > 50) break;
      const breite = item.footprint.lengthMm;
      if (x + breite + opt.wallClearanceMm > room.lengthMm) break;

      const kandidat: RoomPlacement = { configKey: item.configKey, xMm: Math.round(x), yMm: Math.round(y), rotationDeg: 0 };
      const rect = placementRect(kandidat, item.footprint);
      const eintrag = { rect, rotationDeg: 0 as CpqRoomRotationDeg };
      if (passtOhneKonflikt(eintrag, room, belegt, zonen, opt.minSpacingMm, opt.frontClearanceMm)) {
        placements.push(kandidat);
        belegt.push(eintrag);
        inZeile += 1;
        x += breite + opt.minSpacingMm;
        i += 1;
      } else {
        // Sperrfläche oder Kollision: an dieser Stelle vorbeirücken statt aufzugeben.
        x += Math.max(100, Math.round(opt.minSpacingMm));
        if (x + breite + opt.wallClearanceMm > room.lengthMm) break;
      }
    }

    if (inZeile === 0) {
      // In dieser Zeile ging nichts. Passt das Regal überhaupt in den Raum, liegt es an
      // dieser Zeile → nach unten rücken. Ist es schlicht zu groß, muss es aussortiert
      // werden — sonst blockiert ein übergroßes Regal alle nachfolgenden, weil der Index
      // nie weiterläuft.
      const item = offen[i];
      const passtNieInDenRaum =
        item.footprint.lengthMm + 2 * opt.wallClearanceMm > room.lengthMm ||
        item.footprint.depthMm + 2 * opt.wallClearanceMm > room.widthMm;
      if (passtNieInDenRaum) {
        unplaced.push(item.configKey);
        i += 1;
        continue;
      }
      y += Math.max(200, zeilenTiefe);
      continue;
    }
    y += zeilenTiefe + opt.aisleWidthMm;
  }

  for (; i < offen.length; i++) unplaced.push(offen[i].configKey);
  return { placements, unplaced };
}

export type AutoLayoutMode = "walls" | "rows";

export function autoLayout(
  mode: AutoLayoutMode,
  room: { lengthMm: number; widthMm: number },
  items: AutoLayoutItem[],
  options: Partial<AutoLayoutOptions> = {},
): AutoLayoutResult {
  return mode === "rows" ? autoLayoutRows(room, items, options) : autoLayoutAlongWalls(room, items, options);
}
