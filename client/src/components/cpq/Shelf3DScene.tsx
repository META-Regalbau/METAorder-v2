/**
 * Shelf3DScene - composed 3D preview with all Ständer, Böden, Träger at positions
 * Uses Three.js via @react-three/fiber
 */

import { Component, type ErrorInfo, type ReactNode, Suspense, useMemo, useEffect } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { Center, OrbitControls, useGLTF } from "@react-three/drei";

class GLBErrorBoundary extends Component<{ fallback?: ReactNode; children: ReactNode }> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(_err: Error, _info: ErrorInfo) {
    // Einzelmodell fehlgeschlagen – Fallback anzeigen, Szene bleibt nutzbar
  }
  render() {
    if (this.state.hasError) return this.props.fallback ?? null;
    return this.props.children;
  }
}

// Keine Environment-Reflexion – Modelldarstellung unabhängig von Umgebung
function SceneSetup() {
  const { scene } = useThree();
  useEffect(() => {
    scene.environment = null;
  }, [scene]);
  return null;
}

type SceneComponent = {
  productMappingId: string;
  instanceIndex?: number;
  glbUrl: string | null;
  position: { x: number; y: number; z: number };
  scale?: number;
};

// GLB-Skalierung: Blender-Export typisch 1 Einheit = 1m (glTF-Standard). Bei 1mm/unit: 0.001
const MODEL_SCALE = 1;

function ModelInstance({
  url,
  position,
  scale = 1,
}: {
  url: string;
  position: [number, number, number];
  scale?: number;
}) {
  const fullUrl = url.startsWith("http") ? url : `${window.location.origin}${url.startsWith("/") ? url : `/${url}`}`;
  const { scene } = useGLTF(fullUrl);
  const clone = useMemo(() => scene.clone(), [scene]);
  const s = scale * MODEL_SCALE;
  return (
    <group position={position}>
      <Center>
        <primitive object={clone} scale={[s, s, s]} />
      </Center>
    </group>
  );
}

function SceneContent({ components, target }: { components: SceneComponent[]; target: [number, number, number] }) {
  const withGlb = components.filter((c): c is SceneComponent & { glbUrl: string } => !!c.glbUrl);
  const scale = 0.001; // mm → m

  return (
    <>
      {/* Weiches Basislicht */}
      <ambientLight intensity={1.0} />
      <hemisphereLight args={["#ffffff", "#888888", 0.7]} />
      {/* Frontales Key-Light (Kamera auf +Z → Licht von vorn) */}
      <directionalLight position={[0, 2, 5]} intensity={1.8} />
      {/* Seitliches Fill-Light */}
      <directionalLight position={[4, 4, 4]} intensity={0.6} />
      <directionalLight position={[-4, 4, 4]} intensity={0.5} />
      {withGlb.map((c, idx) => (
        <GLBErrorBoundary key={`${c.productMappingId}-${c.instanceIndex ?? idx}`} fallback={null}>
          <Suspense fallback={null}>
            <ModelInstance
              url={c.glbUrl}
              position={[c.position.x * scale, c.position.y * scale, c.position.z * scale]}
              scale={c.scale ?? 1}
            />
          </Suspense>
        </GLBErrorBoundary>
      ))}
      <OrbitControls
        makeDefault
        target={target}
        enablePan
        enableZoom
        minDistance={0.5}
        maxDistance={20}
      />
    </>
  );
}

type Shelf3DSceneProps = {
  components: SceneComponent[];
  /** Kleinere Mindesthöhe (z. B. neben Produktbild in Angebots-Landingpage) */
  compact?: boolean;
};

export default function Shelf3DScene({ components, compact = false }: Shelf3DSceneProps) {
  const withGlb = components.filter((c) => c.glbUrl);
  if (withGlb.length === 0) return null;

  const scale = 0.001;
  const positions = withGlb.map((c) => [c.position.x * scale, c.position.y * scale, c.position.z * scale] as [number, number, number]);
  const center = useMemo(() => {
    const n = positions.length;
    if (n === 0) return [0, 0, 0] as [number, number, number];
    const sum = positions.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]);
    return [sum[0] / n, sum[1] / n, sum[2] / n] as [number, number, number];
  }, [positions]);

  // Kamera auf Z-Achse hinter dem Zentrum, damit Modell mittig (Höhe + Breite) im Viewport liegt
  const cameraDistance = 2.5;
  const cameraPosition = useMemo(
    () => [center[0], center[1], center[2] + cameraDistance] as [number, number, number],
    [center]
  );

  // Neutrales Grau: Modell-Darstellung unabhängig von Seiten-Theme
  const bgColor = "#e8e8e8";

  return (
    <div
      className={
        compact
          ? "w-full aspect-square min-h-[120px] max-h-52 rounded overflow-hidden"
          : "w-full aspect-square min-h-[200px] rounded overflow-hidden"
      }
      style={{ backgroundColor: bgColor }}
    >
      <Canvas
        camera={{
          position: cameraPosition,
          fov: 50,
          near: 0.01,
          far: 100,
        }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={[bgColor]} />
        <SceneSetup />
        <Suspense fallback={null}>
          <SceneContent components={components} target={center} />
        </Suspense>
      </Canvas>
    </div>
  );
}
