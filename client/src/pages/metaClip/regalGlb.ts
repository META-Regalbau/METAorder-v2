/**
 * Das konfigurierte META CLIP Regal als GLB (Blob-URL) für <model-viewer>: interaktive 3D-Ansicht und AR
 * (Android WebXR, iPhone Quick Look – model-viewer erzeugt das USDZ dafür selbst aus dem GLB).
 * Gleiche Geometrie wie im Konfigurator (regalAssembly.ts), dazu ein helles Bodenraster, damit das Regal
 * nicht schwebt. Genutzt von der Angebotsseite (CpqRegalArViewer) und der AR-Seite des Regalplaners.
 */
import * as THREE from "three";
import { GLTFExporter } from "three-stdlib";
import { buildRegalGroup, loadRegalTemplates } from "./regalAssembly";

export type RegalGlbParams = {
  fieldCount: number;
  levels: number;
  widthMM: number;
  depthMM: number;
  heightMM: number;
};

/** Erzeugt das GLB; die zurückgegebene Blob-URL gibt der Aufrufer mit URL.revokeObjectURL wieder frei. */
export async function buildRegalGlbUrl(params: RegalGlbParams): Promise<string> {
  const templates = await loadRegalTemplates();
  const built = buildRegalGroup(templates, { ...params, aussteifung: true, floorGrid: true });

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(3, 6, 4);
  scene.add(dl);
  scene.add(built.group);

  const exporter = new GLTFExporter();
  const glb = await new Promise<ArrayBuffer>((resolve, reject) => {
    exporter.parse(
      scene,
      (result) => resolve(result as ArrayBuffer),
      (err) => reject(err),
      { binary: true },
    );
  });
  const blob = new Blob([glb], { type: "model/gltf-binary" });
  return URL.createObjectURL(blob);
}
