/**
 * Interaktive 3D+AR-Ansicht der Raumplanung auf der öffentlichen Angebotsseite.
 * Baut Raum-Umriss + alle platzierten Regale (dieselbe Geometrie wie der
 * Raumplaner im Admin, siehe client/src/pages/metaClip/roomSceneBuild.ts) zu
 * einer gemeinsamen Szene zusammen und exportiert sie als GLB für
 * <model-viewer> — gleiches Muster wie CpqRegalArViewer.tsx für ein einzelnes
 * Regal, nur für die gesamte Raumszene.
 */
import { useEffect, useState } from "react";
import * as THREE from "three";
import { GLTFExporter } from "three-stdlib";
import "@google/model-viewer";
import { loadRegalTemplates } from "@/pages/metaClip/regalAssembly";
import {
  buildRoomShellGroup,
  buildRoomShelvesGroup,
  buildWallFeaturesGroup,
  type RoomDims,
  type RoomScene3DConfiguration,
} from "@/pages/metaClip/roomSceneBuild";
import type { RoomPlacement, RoomWallFeature } from "@/lib/roomPlannerGeometry";
import FullscreenViewport from "@/components/FullscreenViewport";

export type CpqRoomArViewerProps = {
  room: RoomDims;
  placements: RoomPlacement[];
  configurations: RoomScene3DConfiguration[];
  wallFeatures?: RoomWallFeature[];
  compact?: boolean;
};

async function buildRoomGlbObjectUrl(
  room: RoomDims,
  placements: RoomPlacement[],
  configurations: RoomScene3DConfiguration[],
  wallFeatures: RoomWallFeature[],
): Promise<string> {
  const templates = await loadRegalTemplates();

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const dl = new THREE.DirectionalLight(0xffffff, 1.0);
  dl.position.set(3, 6, 4);
  scene.add(dl);
  scene.add(buildRoomShellGroup(room));
  scene.add(buildWallFeaturesGroup(wallFeatures, room));
  scene.add(buildRoomShelvesGroup(templates, placements, configurations));

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

export default function CpqRoomArViewer({ room, placements, configurations, wallFeatures = [], compact = false }: CpqRoomArViewerProps) {
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (placements.length === 0) return;
    let cancelled = false;
    let currentUrl: string | null = null;
    setError(false);
    buildRoomGlbObjectUrl(room, placements, configurations, wallFeatures)
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setGlbUrl(url);
      })
      .catch((e) => {
        console.warn("[CpqRoomArViewer] 3D-Modell konnte nicht erzeugt werden:", e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(room), JSON.stringify(placements), JSON.stringify(configurations), JSON.stringify(wallFeatures)]);

  if (placements.length === 0) return null;

  const viewerHeight = compact ? "min(260px, 50vw)" : "min(440px, 65vh)";

  if (error) return null;

  if (!glbUrl) {
    return (
      <div
        className="rounded-md border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground"
        style={{ height: viewerHeight, minHeight: 220 }}
      >
        3D-Modell des Raums wird erzeugt…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/20 p-2">
        <FullscreenViewport label="Raum im Vollbild anzeigen">
          <model-viewer
            src={glbUrl}
            ar
            ar-modes="webxr scene-viewer quick-look"
            ar-scale="fixed"
            camera-controls
            touch-action="pan-y"
            style={{ width: "100%", height: viewerHeight, minHeight: 220, background: "#f5f5f5" }}
            alt="3D-Ansicht der Raumplanung"
          />
        </FullscreenViewport>
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Drehen und zoomen · Smartphone: AR über das Geräte- oder Raum-Icon
        </p>
      </div>
    </div>
  );
}
