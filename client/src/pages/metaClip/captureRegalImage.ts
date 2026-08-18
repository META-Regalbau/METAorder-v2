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
import { buildRegalDimensions, disposeDimensions } from "./regalDimensions";
import { cameraForView, unionBox } from "./regalFraming";
import type { MetaClipState } from "@/lib/metaClipCpq";

const PDF_IMAGE_ASPECT = 468 / 248; // server/offerConfigPdf.ts's image slot (imgMaxW/imgMaxH)

type View = 0 | 1 | 2; // 0 Perspektive, 1 Vorderansicht, 2 Draufsicht

function renderView(scene: THREE.Scene, view: View, box: THREE.Box3, widthPx: number, heightPx: number): string {
  const canvas = document.createElement("canvas");
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(widthPx, heightPx, false);
  renderer.setClearColor(0xffffff, 1);
  const camera = new THREE.PerspectiveCamera(32, widthPx / heightPx, 0.01, 100);
  // Jede Kachel hat ein eigenes Seitenverhältnis (breite Perspektive links, flache
  // Vorder-/Draufsicht rechts) — deshalb wird pro Kachel neu eingepasst.
  const fit = cameraForView(box, view, camera.fov, widthPx / heightPx);
  camera.position.set(...fit.position);
  camera.lookAt(...fit.target);
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

  // Bemaßung wie im Live-Viewport — pro Ansicht neu, weil sie ansichtsabhängig ist
  // (Höhe entfällt in der Draufsicht, Tiefe in der Vorderansicht).
  const dimensionsFor = (view: View) =>
    !state.showDims
      ? null
      : buildRegalDimensions(built, {
          widthMM: state.breite,
          heightMM: state.hoehe,
          depthMM: state.tiefe,
          fieldCount: state.felder,
          view,
          lang: state.lang,
        });

  // Bounding-Box über die größte Bemaßung (die Perspektive zeigt alle Maße), damit auch
  // in den beiden anderen Kacheln nichts abgeschnitten wird.
  const framingDims = dimensionsFor(0);
  const box = unionBox(framingDims ? [built.group, framingDims] : [built.group]);
  if (framingDims) disposeDimensions(framingDims);

  const TOTAL_W = 1600;
  const TOTAL_H = Math.round(TOTAL_W / PDF_IMAGE_ASPECT);
  const LEFT_W = Math.round(TOTAL_W * 0.62);
  const RIGHT_W = TOTAL_W - LEFT_W;
  const RIGHT_TOP_H = Math.round(TOTAL_H / 2);
  const RIGHT_BOTTOM_H = TOTAL_H - RIGHT_TOP_H;

  const renderWithDimensions = (view: View, widthPx: number, heightPx: number) => {
    const dims = dimensionsFor(view);
    if (dims) scene.add(dims);
    try {
      return renderView(scene, view, box, widthPx, heightPx);
    } finally {
      if (dims) {
        scene.remove(dims);
        disposeDimensions(dims);
      }
    }
  };

  const perspectiveUrl = renderWithDimensions(0, LEFT_W, TOTAL_H);
  const frontUrl = renderWithDimensions(1, RIGHT_W, RIGHT_TOP_H);
  const topUrl = renderWithDimensions(2, RIGHT_W, RIGHT_BOTTOM_H);

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
