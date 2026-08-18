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
import * as THREE from "three";
import { Canvas, useThree } from "@react-three/fiber";
import { Environment, OrbitControls, useGLTF } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { buildRegalGroup, HEIGHT_GLB, SHELF_GLB_URL, DIAGONAL_GLB_URL } from "./regalAssembly";
import { buildRegalDimensions, disposeDimensions } from "./regalDimensions";
import { cameraForView, unionBox } from "./regalFraming";
import type { MetaClipState } from "@/lib/metaClipCpq";

function Rig({ view, box }: { view: number; box: THREE.Box3 }) {
  const { camera, size } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  // Größe des Viewports geht mit ein: je breiter das Fenster, desto näher darf die Kamera
  // heran, ohne dass etwas aus dem Bild fällt — dadurch wächst die Darstellung mit.
  const fit = useMemo(
    () => cameraForView(box, view, (camera as THREE.PerspectiveCamera).fov ?? 32, size.width / size.height),
    [box, view, camera, size.width, size.height],
  );
  useEffect(() => {
    camera.position.set(...fit.position);
    camera.lookAt(...fit.target);
    if (controls.current) {
      controls.current.target.set(...fit.target);
      controls.current.update();
    }
  }, [fit, camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={view === 0}
      enablePan={false}
      enableZoom
      minDistance={fit.distance * 0.4}
      maxDistance={fit.distance * 4}
      target={fit.target}
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
  lang,
  showDims,
}: {
  fieldCount: number;
  levels: number;
  widthMM: number;
  depthMM: number;
  heightMM: number;
  view: number;
  lang: "de" | "en";
  showDims: boolean;
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

  // Bemaßung als eigene Gruppe: sie hängt zusätzlich an der Ansicht (in der Draufsicht
  // ist die Höhe ein Punkt, in der Vorderansicht die Tiefe) und wird deshalb getrennt
  // vom Aufbau neu gebaut.
  const dimensions = useMemo(
    () =>
      showDims ? buildRegalDimensions(built, { widthMM, heightMM, depthMM, fieldCount, view, lang }) : null,
    [built, widthMM, heightMM, depthMM, fieldCount, view, lang, showDims],
  );
  useEffect(() => () => { if (dimensions) disposeDimensions(dimensions); }, [dimensions]);

  // Bounding-Box über beide Gruppen, sonst schneidet die Kamera die äußeren Maßketten ab.
  const box = useMemo(
    () => unionBox(dimensions ? [built.group, dimensions] : [built.group]),
    [built, dimensions],
  );

  return (
    <>
      <primitive object={built.group} />
      {dimensions && <primitive object={dimensions} />}
      <Rig view={view} box={box} />
    </>
  );
}

export default function MetaClipRegalAssembly({ state }: { state: MetaClipState }) {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas
        dpr={[1, 2]}
        camera={{ fov: 32, near: 0.01, far: 100 }}
        gl={{ toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.55 }}
        style={{ background: "transparent" }}
      >
        {/* Echte, lokal gehostete HDRI (kein CDN-Fetch, keine Netzwerk-
            abhängigkeit) statt handgebauter Lightformer-Panels — gibt dem
            verzinkten Stahl (metalness 0.75) die feinen, natürlichen
            Kontraste/Glanzlichter eines echten Studio-Environments, ähnlich
            der automatischen neutralen Umgebung, die <model-viewer/> im
            AR-Viewer der Angebotsseite intern erzeugt. `flat` (kein
            Tonemapping) hat die Szene hart weiß ausgebrannt, weil Highlights
            ohne Rolloff bei 1.0 hart abgeschnitten werden — und ignoriert
            zusätzlich toneMappingExposure komplett. ACES-Filmic rollt
            Highlights weich ab; die niedrige Exposure zieht die insgesamt
            sehr helle HDRI wieder auf ein normales Niveau. */}
        <Environment files="/env/studio_small_03_1k.hdr" background={false} />
        <Assembly
          fieldCount={state.felder}
          levels={state.boeden}
          widthMM={state.breite}
          depthMM={state.tiefe}
          heightMM={state.hoehe}
          view={state.view}
          lang={state.lang}
          showDims={state.showDims}
        />
      </Canvas>
    </div>
  );
}

useGLTF.preload(HEIGHT_GLB["2000"].url);
useGLTF.preload(HEIGHT_GLB["2500"].url);
useGLTF.preload(SHELF_GLB_URL);
useGLTF.preload(DIAGONAL_GLB_URL);
