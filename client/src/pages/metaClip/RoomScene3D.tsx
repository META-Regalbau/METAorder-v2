/**
 * Raumplanung Phase 2: 3D-Ansicht des Raums mit allen platzierten Regalen an
 * ihrer 2D-Position (x/y/Rotation) — Drehbar, zoombar und schwenkbar
 * (OrbitControls). Geometrie kommt aus roomSceneBuild.ts (geteilt mit dem
 * Offscreen-PDF-Snapshot in captureRoomImage.ts).
 */
import { useMemo } from "react";
import * as THREE from "three";
import { Canvas } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import { HEIGHT_GLB, SHELF_GLB_URL, DIAGONAL_GLB_URL } from "./regalAssembly";
import {
  buildRoomShellGroup,
  buildRoomShelvesGroup,
  buildWallFeaturesGroup,
  roomCameraFraming,
  type RoomDims,
  type RoomScene3DConfiguration,
} from "./roomSceneBuild";
import type { RoomPlacement, RoomWallFeature } from "@/lib/roomPlannerGeometry";

export type { RoomScene3DConfiguration } from "./roomSceneBuild";

function SceneInner({
  room,
  placements,
  configurations,
  wallFeatures,
  target,
  radius,
}: {
  room: RoomDims;
  placements: RoomPlacement[];
  configurations: RoomScene3DConfiguration[];
  wallFeatures: RoomWallFeature[];
  target: [number, number, number];
  radius: number;
}) {
  const frame2000 = useGLTF(HEIGHT_GLB["2000"].url);
  const frame2500 = useGLTF(HEIGHT_GLB["2500"].url);
  const shelf = useGLTF(SHELF_GLB_URL);
  const diagonal = useGLTF(DIAGONAL_GLB_URL);

  const roomGroup = useMemo(
    () => buildRoomShellGroup(room),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [room.lengthMm, room.widthMm, room.heightMm],
  );

  const wallFeaturesGroup = useMemo(
    () => buildWallFeaturesGroup(wallFeatures, room),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wallFeatures, room.lengthMm, room.widthMm, room.heightMm],
  );

  const shelvesGroup = useMemo(
    () =>
      buildRoomShelvesGroup(
        { frame: { "2000": frame2000.scene, "2500": frame2500.scene }, shelf: shelf.scene, diagonal: diagonal.scene },
        placements,
        configurations,
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [placements, configurations, frame2000.scene, frame2500.scene, shelf.scene, diagonal.scene],
  );

  return (
    <>
      <primitive object={roomGroup} />
      <primitive object={wallFeaturesGroup} />
      <primitive object={shelvesGroup} />
      <OrbitControls makeDefault enableRotate enableZoom enablePan minDistance={radius * 0.3} maxDistance={radius * 4} target={target} />
    </>
  );
}

export default function RoomScene3D({
  room,
  placements,
  configurations,
  wallFeatures = [],
}: {
  room: RoomDims;
  placements: RoomPlacement[];
  configurations: RoomScene3DConfiguration[];
  wallFeatures?: RoomWallFeature[];
}) {
  const { radius, target, position } = roomCameraFraming(room);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 40, near: 0.02, far: 200, position }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.55 }}
        style={{ background: "transparent" }}
      >
        <Environment files="/env/studio_small_03_1k.hdr" background={false} />
        <ambientLight intensity={0.4} />
        <SceneInner room={room} placements={placements} configurations={configurations} wallFeatures={wallFeatures} target={target} radius={radius} />
      </Canvas>
    </div>
  );
}

useGLTF.preload(HEIGHT_GLB["2000"].url);
useGLTF.preload(HEIGHT_GLB["2500"].url);
useGLTF.preload(SHELF_GLB_URL);
useGLTF.preload(DIAGONAL_GLB_URL);
