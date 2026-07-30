/**
 * META CLIP Regalzeile — real assembly geometry, ported from the
 * `cpq-configurator/3d-viewer/viewer.html` prototype (v14). The reference
 * constants below come from hand-measured real GLB bounding boxes and nine
 * rounds of user-verified corrections (hole raster phase, hook direction,
 * Z-depth) — see `Fachbodenregal_CLIP_Datenmodell_Standardregal.md` §2.1/§5
 * for the full derivation. Do not "simplify" these numbers without re-reading
 * that history; several looked redundant but each fixes a specific visual defect.
 *
 * Generalization to arbitrary width/depth/height: only ONE frame GLB per
 * reference height (2000/2500mm) and ONE shelf/diagonal GLB (1000×500mm) are
 * available — there is no separate model per catalogue size. Other sizes are
 * rendered by non-uniformly scaling these same real GLBs (width→X, depth→Z,
 * height→Y-scale of the nearer reference frame), which keeps every
 * configuration visually representative and dimensionally correct, but is an
 * approximation away from the exact reference size (1000×500mm, 2000/2500mm
 * height) where the GLB *is* the real part unscaled. The hole-raster /
 * diagonal-bracing placement math itself (RASTER, HOLE_PHASE, HANG_HEIGHT) is
 * absolute real-world spec, independent of width/depth/height, so it needs no
 * scaling — only the frame's own Z-depth-derived reference points
 * (BACK_POST_OUTER_Z, FRAME_Z_CENTER) scale with depth.
 */
import * as THREE from "three";

export type HeightKey = "2000" | "2500";

export const GLB_ASSEMBLY_BASE = "/cpq-models/assembly/";
export const HEIGHT_GLB: Record<HeightKey, { url: string; refHeightMM: number }> = {
  "2000": { url: GLB_ASSEMBLY_BASE + "frame_plain.glb", refHeightMM: 2000 },
  "2500": { url: GLB_ASSEMBLY_BASE + "frame2500_plain.glb", refHeightMM: 2500 },
};
export const SHELF_GLB_URL = GLB_ASSEMBLY_BASE + "shelf_plain.glb";
export const DIAGONAL_GLB_URL = GLB_ASSEMBLY_BASE + "diagonalstab_plain.glb";

/** Nearest reference frame GLB to scale from for an arbitrary target height. */
export function nearestHeightKey(heightMM: number): HeightKey {
  return Math.abs(heightMM - 2500) < Math.abs(heightMM - 2000) ? "2500" : "2000";
}

// ---- reference geometry (meters, from GLB accessor bounding boxes, at FL=1000mm / Fd=500mm) ----
const REF_FL_M = 1.0;
const REF_FD_M = 0.5;
const REF_CAP_ALLOWANCE = 0.004; // topY = refHeightM - allowance (1.996=2.000-0.004, 2.496=2.500-0.004)
const REF_FRAME_Z_MIN = -0.5405;
const REF_FRAME_Z_MAX = 0.0045; // Rahmentiefe gesamt 545mm (=Fd(500)+45), Referenz für Fd=500mm
const REF_FRAME_Z_CENTER = (REF_FRAME_Z_MIN + REF_FRAME_Z_MAX) / 2;
const REF_BACK_POST_OUTER_Z = -0.536; // äußerste Z-Fläche des hinteren, lochungstragenden Pfostens bei Fd=500mm
const REF_CAP_SIZE = { x: 0.076, z: 0.058 }; // Kappen-Footprint bei Fd=500mm

const CAP_THICKNESS = 0.002; // 2mm Platzhalter, echtes GLB steht laut Datenmodell-Doku aus
const RASTER = 0.05; // 50mm Lochraster (absolut, unabhängig von B/T/H)
const HANG_HEIGHT = 0.1; // 100mm Einhängehöhe unterster Boden (absolut)

// Diagonalstab (Zubehör K): lokale BBox aus dem GLB (Hauptstab + 3 Spannschloss-Kleinteile),
// bei FL=1000mm gemessen. X-Achse skaliert mit der Feldbreite (siehe scaleXFor unten).
const DIAGSTAB_LOCAL_MIN = { x: -0.505625, y: -0.502634, z: -0.01985 };
const DIAGSTAB_LOCAL_MAX = { x: 0.505625, y: 0.502625, z: 0.006042 };
const DIAGSTAB_Z_OVERLAP = 0.018; // absolute Hakentiefe, unabhängig von Fd (finale Nutzer-Feinjustierung, v14)

const DIAGSTAB_SPAN_STEPS = Math.round((DIAGSTAB_LOCAL_MAX.y - DIAGSTAB_LOCAL_MIN.y) / RASTER); // 20 (=1000mm), absolut
const SCALE_Y = (DIAGSTAB_SPAN_STEPS * RASTER) / (DIAGSTAB_LOCAL_MAX.y - DIAGSTAB_LOCAL_MIN.y); // absolut, unabhängig von B/T/H

// Echte Loch-Mittelpunkte liegen 25mm phasenversetzt, nicht bei rohen RASTER-Vielfachen ab Y=0 (absolut).
const HOLE_PHASE = 0.025;
const DIAG_BASE_STEP = Math.round((HANG_HEIGHT - HOLE_PHASE) / RASTER);
function holeY(step: number): number {
  return HOLE_PHASE + step * RASTER;
}

type Orientation = "A" | "B";

/**
 * Orientation "A" (unscaled Y): runs native (minX,minY) → (maxX,maxY) → "/" seen from the front.
 * Orientation "B" (Y-mirrored via negative scale, NOT a 180° X-rotation — that also flips Z): "\".
 * Z-mirror (scale.z=-1, both orientations) points the hook the confirmed-correct way.
 * `scaleX` is the field-width-dependent stretch (FL_M / native diagonal width).
 */
function makeDiagonal(diagonalTemplate: THREE.Object3D, scaleX: number, xLeft: number, orientation: Orientation, baseY: number, posZ: number): THREE.Object3D {
  const diag = diagonalTemplate.clone(true);
  if (orientation === "B") {
    diag.scale.set(scaleX, -SCALE_Y, -1);
    diag.position.set(xLeft - scaleX * DIAGSTAB_LOCAL_MIN.x, baseY + SCALE_Y * DIAGSTAB_LOCAL_MAX.y, posZ);
  } else {
    diag.scale.set(scaleX, SCALE_Y, -1);
    diag.position.set(xLeft - scaleX * DIAGSTAB_LOCAL_MIN.x, baseY - SCALE_Y * DIAGSTAB_LOCAL_MIN.y, posZ);
  }
  return diag;
}

function diagonalHoleEndpoints(f: number, orientation: Orientation, baseStep: number) {
  if (orientation === "B") {
    return [
      { frame: f, step: baseStep + DIAGSTAB_SPAN_STEPS },
      { frame: f + 1, step: baseStep },
    ];
  }
  return [
    { frame: f, step: baseStep },
    { frame: f + 1, step: baseStep + DIAGSTAB_SPAN_STEPS },
  ];
}

/**
 * Places one diagonal strut in bay f, avoiding hole collisions with struts already
 * placed at shared frames: searches outward from the standard hang-height step
 * (0, +1, -1, +2, -2, ... raster steps) for the first position where both hole
 * endpoints are still free, then reserves them.
 */
function placeDiagonal(
  diagonalTemplate: THREE.Object3D,
  scaleX: number,
  posZ: number,
  usedHoles: Set<string>,
  group: THREE.Group,
  xLeft: number,
  f: number,
  orientation: Orientation,
): void {
  const maxSearchSteps = 40;
  let chosenBaseStep: number | null = null;
  let chosenEndpoints: string[] | null = null;
  for (let s = 0; s <= maxSearchSteps && chosenBaseStep === null; s++) {
    const candidates = s === 0 ? [0] : [s, -s];
    for (const delta of candidates) {
      const baseStep = DIAG_BASE_STEP + delta;
      const endpoints = diagonalHoleEndpoints(f, orientation, baseStep);
      const keys = endpoints.map((e) => e.frame + "_" + e.step);
      if (keys.every((k) => !usedHoles.has(k))) {
        chosenBaseStep = baseStep;
        chosenEndpoints = keys;
        break;
      }
    }
  }
  if (chosenBaseStep === null) {
    chosenBaseStep = DIAG_BASE_STEP; // practically never hit
  } else {
    chosenEndpoints!.forEach((k) => usedHoles.add(k));
  }
  const diag = makeDiagonal(diagonalTemplate, scaleX, xLeft, orientation, holeY(chosenBaseStep), posZ);
  diag.userData.kind = `diag:f${f}:${orientation}`;
  group.add(diag);
}

function levelPositions(topY: number, n: number): number[] {
  const bottom = HANG_HEIGHT;
  const top = topY - CAP_THICKNESS;
  if (n <= 1) return [bottom];
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const raw = bottom + (top - bottom) * (i / (n - 1));
    positions.push(Math.round(raw / RASTER) * RASTER);
  }
  positions[0] = bottom;
  positions[n - 1] = top;
  for (let i = 1; i < positions.length; i++) {
    if (positions[i] <= positions[i - 1]) positions[i] = positions[i - 1] + RASTER;
  }
  return positions;
}

export type RegalTemplates = {
  frame: Record<HeightKey, THREE.Object3D>;
  shelf: THREE.Object3D;
  diagonal: THREE.Object3D;
};

export type BuildRegalResult = {
  group: THREE.Group;
  /** Bounding info for camera framing (meters). */
  topY: number;
  totalLengthM: number;
  frameZCenterM: number;
  depthM: number;
};

export function buildRegalGroup(
  templates: RegalTemplates,
  opts: { fieldCount: number; levels: number; widthMM: number; depthMM: number; heightMM: number; aussteifung: boolean },
): BuildRegalResult {
  const group = new THREE.Group();
  const nFields = Math.max(1, Math.min(20, Math.round(opts.fieldCount)));
  const nLevels = Math.max(1, Math.round(opts.levels));

  const FL_M = opts.widthMM / 1000;
  const fdScale = opts.depthMM / 500; // Fd relative to the 500mm reference the frame/shelf GLBs were measured at
  const heightKey = nearestHeightKey(opts.heightMM);
  const refHeightMM = HEIGHT_GLB[heightKey].refHeightMM;
  const heightScale = opts.heightMM / refHeightMM;
  const topY = opts.heightMM / 1000 - REF_CAP_ALLOWANCE;

  const frameZCenter = REF_FRAME_Z_CENTER * fdScale;
  const backPostOuterZ = REF_BACK_POST_OUTER_Z * fdScale;
  const diagPosZ = backPostOuterZ + DIAGSTAB_Z_OVERLAP + DIAGSTAB_LOCAL_MIN.z;
  const diagScaleX = FL_M / (DIAGSTAB_LOCAL_MAX.x - DIAGSTAB_LOCAL_MIN.x);

  const frameTemplate = templates.frame[heightKey];

  // N Felder teilen sich N+1 Rahmen (Grundfeld + Anbaufelder). Rahmenbreite (50mm) bleibt
  // fix — nur die Höhe (Ziel-H / Referenz-H) und Tiefe (Ziel-Fd / 500mm) werden skaliert.
  const nFrames = nFields + 1;
  for (let i = 0; i < nFrames; i++) {
    const frame = frameTemplate.clone(true);
    frame.scale.set(1, heightScale, fdScale);
    frame.position.set(i * FL_M, 0, 0);
    group.add(frame);
  }

  const positions = levelPositions(topY, nLevels);
  for (let f = 0; f < nFields; f++) {
    const xCenter = f * FL_M + FL_M / 2;
    positions.forEach((y) => {
      const shelf = templates.shelf.clone(true);
      shelf.scale.set(FL_M / REF_FL_M, 1, fdScale);
      shelf.position.set(xCenter, y, frameZCenter);
      group.add(shelf);
    });
  }

  // Kappen-Platzhalter (2mm, echtes GLB steht laut Datenmodell-Doku noch aus); Footprint
  // Z-skaliert mit Fd, damit sie über den (ggf. tieferen/flacheren) Rahmen passt.
  const capGeo = new THREE.BoxGeometry(REF_CAP_SIZE.x, CAP_THICKNESS, REF_CAP_SIZE.z * fdScale);
  const capMat = new THREE.MeshStandardMaterial({ color: 0xdd3333, transparent: true, opacity: 0.55 });
  for (let i = 0; i < nFrames; i++) {
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(i * FL_M, topY + CAP_THICKNESS / 2, frameZCenter);
    group.add(cap);
  }

  // Aussteifung (Diagonalstab, Zubehör K): erstes Feld = Kreuz aus 2 Streben,
  // jedes weitere Feld = 1 Strebe, alternierende Ausrichtung, Lochraster-Kollisionsvermeidung.
  // Höhen-/Tiefen-unabhängig (RASTER/HOLE_PHASE/HANG_HEIGHT sind absolute Werte) — nur
  // Feldbreite (X) und die vom Rahmen geerbte Z-Position (Fd) fließen ein.
  if (opts.aussteifung) {
    const usedHoles = new Set<string>();
    for (let f = 0; f < nFields; f++) {
      const xLeft = f * FL_M;
      if (f === 0) {
        placeDiagonal(templates.diagonal, diagScaleX, diagPosZ, usedHoles, group, xLeft, f, "A");
        placeDiagonal(templates.diagonal, diagScaleX, diagPosZ, usedHoles, group, xLeft, f, "B");
      } else {
        const orientation: Orientation = f % 2 === 1 ? "B" : "A";
        placeDiagonal(templates.diagonal, diagScaleX, diagPosZ, usedHoles, group, xLeft, f, orientation);
      }
    }
  }

  const depthM = (REF_FRAME_Z_MAX - REF_FRAME_Z_MIN) * fdScale;
  return { group, topY, totalLengthM: nFields * FL_M, frameZCenterM: frameZCenter, depthM };
}
