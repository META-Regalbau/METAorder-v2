/**
 * MetaClipShelfScene — real GLB rendering for the META CLIP viewport.
 *
 * Calls the existing /api/cpq/preview/scene (same sceneBuilder used elsewhere
 * in the app), which resolves each BOM line to a real GLB by GTIN
 * (client/public/cpq-models, see server/cpqGlbResolve.ts). When the current
 * combination of dimensions has no matching GLB (not every mm/kg permutation
 * in the catalogue has 3D artwork yet), it falls back to the parametric
 * MetaClipShelf3D so the viewport is never empty.
 */
import { lazy, Suspense, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { CpqConfigContext } from "@/lib/metaClipCpq";
import type { MetaClipState } from "@/lib/metaClipCpq";

const Shelf3DScene = lazy(() => import("@/components/cpq/Shelf3DScene"));
const MetaClipShelf3D = lazy(() => import("./MetaClipShelf3D"));

type SceneComponent = {
  productMappingId: string;
  instanceIndex?: number;
  glbUrl: string | null;
  position: { x: number; y: number; z: number };
  scale?: number;
};

export default function MetaClipShelfScene({ systemId, config, state }: { systemId: string; config: CpqConfigContext; state: MetaClipState }) {
  const { data } = useQuery<{ components: SceneComponent[] }>({
    queryKey: [`/api/cpq/preview/scene`, systemId, JSON.stringify(config)],
    enabled: !!systemId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/cpq/preview/scene`, { systemId, config });
      return res.json();
    },
  });

  const withGlb = useMemo(() => (data?.components ?? []).filter((c) => !!c.glbUrl), [data]);

  if (withGlb.length > 0) {
    return (
      <div className="glb-fill">
        <Suspense fallback={null}>
          <Shelf3DScene components={withGlb} />
        </Suspense>
      </div>
    );
  }
  return (
    <Suspense fallback={null}>
      <MetaClipShelf3D state={state} />
    </Suspense>
  );
}
