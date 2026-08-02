/**
 * Offscreen-Snapshot der Raumplanung (Perspektive, isometrisch-ähnlicher
 * Winkel) fürs Angebots-PDF — analog zu captureRegalImage.ts, aber für die
 * gesamte Raumszene (mehrere Regale + Raum-Umriss) statt eines einzelnen
 * Regals. Läuft außerhalb von React/Fiber (bare THREE.WebGLRenderer), damit
 * kein R3F-Mount nötig ist.
 */
import * as THREE from "three";
import { loadRegalTemplates } from "./regalAssembly";
import {
  buildRoomShellGroup,
  buildRoomShelvesGroup,
  buildWallFeaturesGroup,
  roomCameraFraming,
  type RoomDims,
  type RoomScene3DConfiguration,
} from "./roomSceneBuild";
import type { RoomPlacement, RoomWallFeature } from "@/lib/roomPlannerGeometry";

// server/offerConfigPdf.ts drawRoomPlanSection: gleicher Bildslot wie die Regal-Konfigurationsbilder.
const PDF_IMAGE_ASPECT = 468 / 248;

export async function captureRoomCompositeImage(
  room: RoomDims,
  placements: RoomPlacement[],
  configurations: RoomScene3DConfiguration[],
  wallFeatures: RoomWallFeature[] = [],
): Promise<string | null> {
  if (placements.length === 0) return null;
  const templates = await loadRegalTemplates();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl1 = new THREE.DirectionalLight(0xffffff, 1.1);
  dl1.position.set(3, 6, 4);
  scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dl2.position.set(-4, 3, -3);
  scene.add(dl2);

  scene.add(buildRoomShellGroup(room));
  scene.add(buildWallFeaturesGroup(wallFeatures, room));
  scene.add(buildRoomShelvesGroup(templates, placements, configurations));

  const { target, position } = roomCameraFraming(room);

  const W = 1600;
  const H = Math.round(W / PDF_IMAGE_ASPECT);
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.setClearColor(0xffffff, 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.55;

  const camera = new THREE.PerspectiveCamera(40, W / H, 0.02, 200);
  camera.position.set(position[0], position[1], position[2]);
  camera.lookAt(target[0], target[1], target[2]);

  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL("image/png");
  renderer.dispose();
  return dataUrl;
}
