/**
 * MetaClipRegalAssembly — renders the real META CLIP bay run from four real,
 * hand-measured GLB parts (frame 2000mm, frame 2500mm, shelf, diagonal strut)
 * using the exact assembly algorithm from the 3d-viewer prototype, scaled to
 * whatever width/depth/height the user configured (see regalAssembly.ts for
 * the ported logic, its derivation history, and the scaling rationale).
 * Works for every catalogue dimension — exact/unscaled only at the one
 * reference size (1000×500mm, 2000/2500mm height), scaled elsewhere.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { buildRegalGroup, HEIGHT_GLB, SHELF_GLB_URL, DIAGONAL_GLB_URL } from "./regalAssembly";
import type { MetaClipState } from "@/lib/metaClipCpq";

function Rig({ view, radius, center }: { view: number; radius: number; center: [number, number, number] }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => {
    const [cx, cy, cz] = center;
    if (view === 2) camera.position.set(cx, cy + radius * 2.4, cz + 0.0001); // Draufsicht
    else if (view === 1) camera.position.set(cx, cy, cz + radius * 2.6); // Vorderansicht
    else camera.position.set(cx + radius * 1.3, cy + radius * 1.0, cz + radius * 1.7); // Perspektive
    camera.lookAt(cx, cy, cz);
    if (controls.current) {
      controls.current.target.set(cx, cy, cz);
      controls.current.update();
    }
  }, [view, radius, center, camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={view === 0}
      enablePan={false}
      enableZoom
      minDistance={radius * 0.8}
      maxDistance={radius * 5}
      target={center}
    />
  );
}

function Assembly({
  fieldCount,
  levels,
  widthMM,
  depthMM,
  heightMM,
  view,
}: {
  fieldCount: number;
  levels: number;
  widthMM: number;
  depthMM: number;
  heightMM: number;
  view: number;
}) {
  const frame2000 = useGLTF(HEIGHT_GLB["2000"].url);
  const frame2500 = useGLTF(HEIGHT_GLB["2500"].url);
  const shelf = useGLTF(SHELF_GLB_URL);
  const diagonal = useGLTF(DIAGONAL_GLB_URL);

  const built = useMemo(
    () =>
      buildRegalGroup(
        { frame: { "2000": frame2000.scene, "2500": frame2500.scene }, shelf: shelf.scene, diagonal: diagonal.scene },
        { fieldCount, levels, widthMM, depthMM, heightMM, aussteifung: true },
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fieldCount, levels, widthMM, depthMM, heightMM, frame2000.scene, frame2500.scene, shelf.scene, diagonal.scene],
  );

  const radius = 0.55 * Math.hypot(built.totalLengthM, built.topY, built.depthM);
  const center: [number, number, number] = [built.totalLengthM / 2, built.topY / 2, built.frameZCenterM];

  return (
    <>
      <primitive object={built.group} />
      <Rig view={view} radius={radius} center={center} />
    </>
  );
}

export default function MetaClipRegalAssembly({ state }: { state: MetaClipState }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas dpr={[1, 2]} camera={{ fov: 32, near: 0.01, far: 100 }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 6, 4]} intensity={1.1} />
        <directionalLight position={[-4, 3, -3]} intensity={0.35} />
        <Assembly
          fieldCount={state.felder}
          levels={state.boeden}
          widthMM={state.breite}
          depthMM={state.tiefe}
          heightMM={state.hoehe}
          view={state.view}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(HEIGHT_GLB["2000"].url);
useGLTF.preload(HEIGHT_GLB["2500"].url);
useGLTF.preload(SHELF_GLB_URL);
useGLTF.preload(DIAGONAL_GLB_URL);
