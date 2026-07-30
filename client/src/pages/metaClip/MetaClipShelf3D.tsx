/**
 * MetaClipShelf3D — procedural WebGL rendering of the configured META CLIP bay run.
 *
 * No GLB assets are required: frames (posts + depth braces), shelves and the
 * optional rear panel are generated from the live dimensions, so the model
 * always matches the configuration. The design's three views (Perspektive /
 * Vorderansicht / Draufsicht) drive the camera.
 */
import { useEffect, useMemo, useRef } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { MetaClipState } from "@/lib/metaClipCpq";

const S = 1000; // mm → scene units (metres)

type Kind = "frame" | "shelf" | "rear";
type Box = { pos: [number, number, number]; size: [number, number, number]; kind: Kind };

function buildModel(s: MetaClipState) {
  const post = 40 / S;
  const th = 25 / S; // shelf thickness
  const w = s.breite / S, d = s.tiefe / S, h = s.hoehe / S;
  const bayPitch = w + post;
  const totalW = s.felder * w + (s.felder + 1) * post;
  const x0 = -totalW / 2;
  const boxes: Box[] = [];

  // frames: two vertical posts (front/back) + top & bottom depth braces
  for (let i = 0; i <= s.felder; i++) {
    const fx = x0 + post / 2 + i * bayPitch;
    for (const z of [-d / 2 + post / 2, d / 2 - post / 2]) {
      boxes.push({ pos: [fx, h / 2, z], size: [post, h, post], kind: "frame" });
    }
    for (const y of [post / 2, h - post / 2]) {
      boxes.push({ pos: [fx, y, 0], size: [post * 0.8, post * 0.8, d - post], kind: "frame" });
    }
  }

  // shelves per bay (top shelf at full height) + optional rear panel
  for (let b = 0; b < s.felder; b++) {
    const bx = x0 + post + b * bayPitch + w / 2;
    for (let j = 1; j <= s.boeden; j++) {
      const y = (h / s.boeden) * j;
      boxes.push({ pos: [bx, y - th / 2, 0], size: [w, th, d - post * 0.5], kind: "shelf" });
    }
    if (s.rear) {
      boxes.push({ pos: [bx, h / 2, -d / 2 + post * 0.35], size: [w, h - post, th * 0.5], kind: "rear" });
    }
  }

  const radius = 0.5 * Math.hypot(totalW, h, d);
  const center: [number, number, number] = [0, h / 2, 0];
  return { boxes, radius, center };
}

function material(kind: Kind, surface: MetaClipState["surface"]) {
  // verzinkt → metallic steel; lackiert (RAL 7035) → light warm grey, matte
  const coated = surface === "lackiert";
  const base = coated ? "#d2d3ce" : "#a9aeb3";
  const rear = coated ? "#c2c3bd" : "#8f959b";
  return {
    color: kind === "rear" ? rear : base,
    metalness: coated ? 0.15 : 0.62,
    roughness: coated ? 0.62 : 0.42,
  };
}

function Rig({ view, radius, center }: { view: number; radius: number; center: [number, number, number] }) {
  const { camera } = useThree();
  const controls = useRef<OrbitControlsImpl | null>(null);
  useEffect(() => {
    const [cx, cy, cz] = center;
    if (view === 2) camera.position.set(cx, cy + radius * 2.5, cz + 0.0001); // Draufsicht
    else if (view === 1) camera.position.set(cx, cy, cz + radius * 2.7); // Vorderansicht
    else camera.position.set(cx + radius * 1.35, cy + radius * 1.05, cz + radius * 1.75); // Perspektive
    camera.lookAt(cx, cy, cz);
    if (controls.current) { controls.current.target.set(cx, cy, cz); controls.current.update(); }
  }, [view, radius, center, camera]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableRotate={view === 0}
      enablePan={false}
      enableZoom
      minDistance={radius * 0.9}
      maxDistance={radius * 5}
      target={center}
    />
  );
}

export default function MetaClipShelf3D({ state }: { state: MetaClipState }) {
  const { boxes, radius, center } = useMemo(() => buildModel(state), [state]);
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas dpr={[1, 2]} camera={{ fov: 32, near: 0.01, far: 100 }} style={{ background: "transparent" }}>
        <ambientLight intensity={0.65} />
        <directionalLight position={[3, 6, 4]} intensity={1.15} />
        <directionalLight position={[-4, 3, -3]} intensity={0.35} />
        <group>
          {boxes.map((b, i) => (
            <mesh key={i} position={b.pos}>
              <boxGeometry args={b.size} />
              <meshStandardMaterial {...material(b.kind, state.surface)} />
            </mesh>
          ))}
        </group>
        <Rig view={state.view} radius={radius} center={center} />
      </Canvas>
    </div>
  );
}
