/**
 * Reine THREE.Group-Bauer für die Raum-3D-Szene — geteilt zwischen dem
 * interaktiven Viewer (RoomScene3D.tsx, react-three-fiber) und dem
 * Offscreen-Snapshot fürs Angebots-PDF (captureRoomImage.ts). Kein React/R3F
 * hier, damit beide Konsumenten dieselbe Geometrie ohne Duplikation nutzen.
 */
import * as THREE from "three";
import { buildRegalGroup, type RegalTemplates } from "./regalAssembly";
import {
  placementRect,
  wallFeatureGeometry,
  type RoomFootprintMm,
  type RoomPlacement,
  type RoomWallFeature,
} from "@/lib/roomPlannerGeometry";

export type RoomScene3DConfiguration = {
  configKey: string;
  footprint: RoomFootprintMm;
  cpqConfig: Record<string, unknown>;
};

export type RoomDims = { lengthMm: number; widthMm: number; heightMm: number };

function buildFloorGrid(lengthM: number, widthM: number): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, 512, 512);
  ctx.strokeStyle = "#d8d8d8";
  ctx.lineWidth = 2;
  const cells = 8;
  const step = 512 / cells;
  for (let i = 0; i <= cells; i++) {
    ctx.beginPath();
    ctx.moveTo(i * step, 0);
    ctx.lineTo(i * step, 512);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, i * step);
    ctx.lineTo(512, i * step);
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, Math.round(lengthM)), Math.max(1, Math.round(widthM)));
  const geo = new THREE.PlaneGeometry(lengthM, widthM);
  const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.9 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(lengthM / 2, 0, widthM / 2);
  return mesh;
}

function buildRoomOutline(lengthM: number, widthM: number, heightM: number): THREE.LineSegments {
  const geo = new THREE.BoxGeometry(lengthM, heightM, widthM);
  const edges = new THREE.EdgesGeometry(geo);
  const mat = new THREE.LineBasicMaterial({ color: 0xb0392b, transparent: true, opacity: 0.35 });
  const lines = new THREE.LineSegments(edges, mat);
  lines.position.set(lengthM / 2, heightM / 2, widthM / 2);
  return lines;
}

/** Boden-Raster + Raum-Umriss (Wireframe-Box) für die gegebenen Raummaße (mm). */
export function buildRoomShellGroup(room: RoomDims): THREE.Group {
  const g = new THREE.Group();
  g.add(buildFloorGrid(room.lengthMm / 1000, room.widthMm / 1000));
  g.add(buildRoomOutline(room.lengthMm / 1000, room.widthMm / 1000, room.heightMm / 1000));
  return g;
}

function buildLineSegments(pairs: Array<[THREE.Vector3, THREE.Vector3]>, color: number, dashed = false): THREE.LineSegments {
  const points: THREE.Vector3[] = [];
  for (const [a, b] of pairs) points.push(a, b);
  const geo = new THREE.BufferGeometry().setFromPoints(points);
  const mat = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.08, gapSize: 0.05 })
    : new THREE.LineBasicMaterial({ color });
  const lines = new THREE.LineSegments(geo, mat);
  if (dashed) lines.computeLineDistances();
  return lines;
}

/** Rein stilisierte Tür/Fenster/Tor-Markierung an der Wandöffnung — Liniengrafik, keine echte Geometrie/Kollision. */
function buildWallFeatureGroup(feature: RoomWallFeature, room: RoomDims): THREE.Group {
  const geo = wallFeatureGeometry(feature, room);
  const p1 = new THREE.Vector3(geo.p1.x / 1000, 0, geo.p1.y / 1000);
  const p2 = new THREE.Vector3(geo.p2.x / 1000, 0, geo.p2.y / 1000);
  const inward = new THREE.Vector3(geo.inward.x, 0, geo.inward.y);
  const widthM = feature.widthMm / 1000;
  const heightM = room.heightMm / 1000;
  const g = new THREE.Group();

  if (feature.type === "door") {
    const doorHeightM = Math.min(2.1, heightM * 0.9);
    const p1Top = p1.clone().setY(doorHeightM);
    const p2Top = p2.clone().setY(doorHeightM);
    g.add(buildLineSegments([[p1, p1Top], [p2, p2Top], [p1Top, p2Top]], 0x3a3a3a));

    const leafEnd = p1.clone().addScaledVector(inward, widthM);
    g.add(buildLineSegments([[p1, leafEnd]], 0x777777));

    const alongWall = p2.clone().sub(p1).normalize();
    const angle1 = Math.atan2(inward.z, inward.x);
    const angle2 = Math.atan2(alongWall.z, alongWall.x);
    let delta = angle2 - angle1;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    const arcPoints: THREE.Vector3[] = [];
    const SEGMENTS = 16;
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const a = angle1 + delta * t;
      arcPoints.push(new THREE.Vector3(p1.x + Math.cos(a) * widthM, 0.003, p1.z + Math.sin(a) * widthM));
    }
    const arcGeo = new THREE.BufferGeometry().setFromPoints(arcPoints);
    const arcMat = new THREE.LineDashedMaterial({ color: 0x999999, dashSize: 0.05, gapSize: 0.04 });
    const arcLine = new THREE.Line(arcGeo, arcMat);
    arcLine.computeLineDistances();
    g.add(arcLine);
    return g;
  }

  if (feature.type === "window") {
    const sillM = Math.min(0.9, heightM * 0.3);
    const headM = Math.min(2.1, heightM * 0.9);
    const p1Sill = p1.clone().setY(sillM);
    const p1Head = p1.clone().setY(headM);
    const p2Sill = p2.clone().setY(sillM);
    const p2Head = p2.clone().setY(headM);
    const mid = p1.clone().lerp(p2, 0.5);
    const midSill = mid.clone().setY(sillM);
    const midHead = mid.clone().setY(headM);
    g.add(
      buildLineSegments(
        [
          [p1Sill, p2Sill],
          [p1Head, p2Head],
          [p1Sill, p1Head],
          [p2Sill, p2Head],
          [midSill, midHead],
        ],
        0x2c6e8f,
      ),
    );
    return g;
  }

  // Tor
  const gateHeightM = Math.min(2.5, heightM * 0.95);
  const p1Top = p1.clone().setY(gateHeightM);
  const p2Top = p2.clone().setY(gateHeightM);
  g.add(buildLineSegments([[p1, p1Top], [p2, p2Top], [p1Top, p2Top], [p1, p2]], 0xa06b1f, true));
  return g;
}

/** Alle Wandelemente (Türen/Fenster/Tore) eines Raums als Liniengrafik-Gruppe. */
export function buildWallFeaturesGroup(features: RoomWallFeature[], room: RoomDims): THREE.Group {
  const g = new THREE.Group();
  for (const f of features) g.add(buildWallFeatureGroup(f, room));
  return g;
}

/**
 * Ein Regal-Assembly pro Platzierung, um sein eigenes Footprint-Zentrum gedreht
 * (90°-Schritte) und an das Zentrum seines 2D-Platzierungsrechtecks verschoben.
 */
export function buildRoomShelvesGroup(
  templates: RegalTemplates,
  placements: RoomPlacement[],
  configurations: RoomScene3DConfiguration[],
): THREE.Group {
  const g = new THREE.Group();
  for (const p of placements) {
    const config = configurations.find((c) => c.configKey === p.configKey);
    if (!config) continue;
    const cfg = config.cpqConfig;
    const fieldCount = Number(cfg.field_count);
    const levels = Number(cfg.level_count);
    const widthMM = Number(cfg.width);
    const depthMM = Number(cfg.depth);
    const heightMM = Number(cfg.height);
    if (![fieldCount, levels, widthMM, depthMM, heightMM].every((n) => Number.isFinite(n) && n > 0)) continue;

    const built = buildRegalGroup(templates, { fieldCount, levels, widthMM, depthMM, heightMM, aussteifung: true });
    // Recenter the assembly's local footprint on its own origin so a Y rotation
    // turns it in place, then move it to the target world position.
    built.group.position.set(-built.totalLengthM / 2, 0, -built.frameZCenterM);
    const wrapper = new THREE.Group();
    wrapper.add(built.group);
    wrapper.rotation.y = (p.rotationDeg * Math.PI) / 180;

    const rect = placementRect(p, config.footprint);
    wrapper.position.set((rect.x0 + rect.x1) / 2 / 1000, 0, (rect.y0 + rect.y1) / 2 / 1000);
    g.add(wrapper);
  }
  return g;
}

/** Kamera-Rahmenwerte (Radius/Ziel/Startposition), konsistent zwischen Live-Viewer und Snapshot. */
export function roomCameraFraming(room: RoomDims) {
  const lengthM = room.lengthMm / 1000;
  const widthM = room.widthMm / 1000;
  const heightM = room.heightMm / 1000;
  const radius = 0.85 * Math.max(lengthM, widthM, heightM * 2);
  const target: [number, number, number] = [lengthM / 2, heightM / 4, widthM / 2];
  const position: [number, number, number] = [
    lengthM / 2 + radius * 0.9,
    heightM * 1.1 + radius * 0.5,
    widthM / 2 + radius * 1.1,
  ];
  return { radius, target, position };
}
