/**
 * Offscreen capture of the real META CLIP assembly (see regalAssembly.ts) from
 * three fixed camera angles — Perspektive / Vorderansicht / Draufsicht —
 * composited into one landscape image for the offer PDF.
 *
 * Layout: large Perspektive on the left, Vorderansicht (top) and Draufsicht
 * (bottom) stacked on the right at the same combined height — matching the
 * PDF's image slot (server/offerConfigPdf.ts drawConfigSection: max 468×248pt,
 * ≈1.887:1 landscape), so the composite fits at full width without letterboxing.
 *
 * Runs outside React/Fiber: a bare THREE.WebGLRenderer against a detached
 * canvas, loading the same 4 real GLBs via a plain GLTFLoader — no drei/R3F
 * mount needed for a one-shot snapshot, and it works for any configuration
 * (scaled from the same reference GLBs, same as the live viewport).
 */
import * as THREE from "three";
import { buildRegalGroup, loadRegalTemplates } from "./regalAssembly";
import type { MetaClipState } from "@/lib/metaClipCpq";

const PDF_IMAGE_ASPECT = 468 / 248; // server/offerConfigPdf.ts's image slot (imgMaxW/imgMaxH)

type View = 0 | 1 | 2; // 0 Perspektive, 1 Vorderansicht, 2 Draufsicht

function positionCamera(camera: THREE.PerspectiveCamera, view: View, radius: number, center: THREE.Vector3) {
  const { x: cx, y: cy, z: cz } = center;
  if (view === 2) camera.position.set(cx, cy + radius * 2.4, cz + 0.0001); // Draufsicht
  else if (view === 1) camera.position.set(cx, cy, cz + radius * 2.6); // Vorderansicht
  else camera.position.set(cx + radius * 1.3, cy + radius * 1.0, cz + radius * 1.7); // Perspektive
  camera.lookAt(cx, cy, cz);
}

function renderView(scene: THREE.Scene, view: View, radius: number, center: THREE.Vector3, widthPx: number, heightPx: number): string {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(widthPx, heightPx, false);
  renderer.setClearColor(0xffffff, 1);
  const camera = new THREE.PerspectiveCamera(32, widthPx / heightPx, 0.01, 100);
  positionCamera(camera, view, radius, center);
  renderer.render(scene, camera);
  const dataUrl = canvas.toDataURL("image/png");
  renderer.dispose();
  return dataUrl;
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
}

/**
 * Builds the composite and returns a `data:image/png;base64,...` string ready
 * for the offer's cpqSource.previewImageBase64 → PDF image slot.
 */
export async function captureRegalCompositeImage(state: MetaClipState): Promise<string> {
  const templates = await loadRegalTemplates();
  const built = buildRegalGroup(templates, {
    fieldCount: state.felder,
    levels: state.boeden,
    widthMM: state.breite,
    depthMM: state.tiefe,
    heightMM: state.hoehe,
    aussteifung: true,
  });

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xffffff);
  scene.add(new THREE.AmbientLight(0xffffff, 0.7));
  const dl1 = new THREE.DirectionalLight(0xffffff, 1.1);
  dl1.position.set(3, 6, 4);
  scene.add(dl1);
  const dl2 = new THREE.DirectionalLight(0xffffff, 0.35);
  dl2.position.set(-4, 3, -3);
  scene.add(dl2);
  scene.add(built.group);

  const radius = 0.55 * Math.hypot(built.totalLengthM, built.topY, built.depthM);
  const center = new THREE.Vector3(built.totalLengthM / 2, built.topY / 2, built.frameZCenterM);

  const TOTAL_W = 1600;
  const TOTAL_H = Math.round(TOTAL_W / PDF_IMAGE_ASPECT);
  const LEFT_W = Math.round(TOTAL_W * 0.62);
  const RIGHT_W = TOTAL_W - LEFT_W;
  const RIGHT_TOP_H = Math.round(TOTAL_H / 2);
  const RIGHT_BOTTOM_H = TOTAL_H - RIGHT_TOP_H;

  const perspectiveUrl = renderView(scene, 0, radius, center, LEFT_W, TOTAL_H);
  const frontUrl = renderView(scene, 1, radius, center, RIGHT_W, RIGHT_TOP_H);
  const topUrl = renderView(scene, 2, radius, center, RIGHT_W, RIGHT_BOTTOM_H);

  const canvas = document.createElement("canvas");
  canvas.width = TOTAL_W;
  canvas.height = TOTAL_H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, TOTAL_W, TOTAL_H);

  const [perspImg, frontImg, topImg] = await Promise.all([loadImage(perspectiveUrl), loadImage(frontUrl), loadImage(topUrl)]);
  ctx.drawImage(perspImg, 0, 0, LEFT_W, TOTAL_H);
  ctx.drawImage(frontImg, LEFT_W, 0, RIGHT_W, RIGHT_TOP_H);
  ctx.drawImage(topImg, LEFT_W, RIGHT_TOP_H, RIGHT_W, RIGHT_BOTTOM_H);

  // Hairline separators, matching the brand's rule aesthetic (metaClip.css --meta-steel).
  ctx.strokeStyle = "#e8e8e8";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(LEFT_W, 0);
  ctx.lineTo(LEFT_W, TOTAL_H);
  ctx.moveTo(LEFT_W, RIGHT_TOP_H);
  ctx.lineTo(TOTAL_W, RIGHT_TOP_H);
  ctx.stroke();

  return canvas.toDataURL("image/png");
}
