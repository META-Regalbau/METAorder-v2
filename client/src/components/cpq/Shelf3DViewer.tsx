/**
 * Shelf3DViewer - 3D preview for CPQ shelf configurations
 * Zeigt alle Ständer, Böden, Träger an ihren Positionen (composed scene)
 */

import { useQuery } from "@tanstack/react-query";
import { Suspense } from "react";
import Shelf3DScene from "./Shelf3DScene";

type SceneComponent = {
  productMappingId: string;
  instanceIndex?: number;
  glbUrl: string | null;
  position: { x: number; y: number; z: number };
  scale?: number;
};

type Shelf3DViewerProps = {
  systemId: string;
  config: Record<string, unknown>;
};

export default function Shelf3DViewer({ systemId, config }: Shelf3DViewerProps) {
  const { data: sceneData, isLoading, error: sceneError } = useQuery<{ components: SceneComponent[] }>({
    queryKey: ["/api/cpq/preview/scene", systemId, config],
    queryFn: async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const csrfToken = document.cookie.match(/csrf_token=([^;]+)/)?.[1];
      if (csrfToken) headers["X-CSRF-Token"] = csrfToken;
      const res = await fetch("/api/cpq/preview/scene", {
        method: "POST",
        headers,
        body: JSON.stringify({ systemId, config }),
        credentials: "include",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        let msg = "Szene konnte nicht geladen werden.";
        try {
          const body = text ? JSON.parse(text) : {};
          if (typeof (body as { error?: string }).error === "string") msg = (body as { error: string }).error;
          else if (text) msg = text;
        } catch {
          if (text) msg = text;
        }
        throw new Error(msg);
      }
      return res.json();
    },
    enabled: !!systemId,
  });

  if (sceneError) {
    return (
      <div className="aspect-square bg-muted rounded flex flex-col items-center justify-center text-destructive text-sm p-4 text-center">
        {sceneError.message}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="aspect-square bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">
        Szenen laden…
      </div>
    );
  }

  const components = sceneData?.components ?? [];
  const withGlb = components.filter((c) => c.glbUrl);

  if (withGlb.length === 0) {
    return (
      <div className="aspect-square bg-muted rounded flex flex-col items-center justify-center text-muted-foreground text-sm p-4">
        <div className="mb-2">{components.length} Komponenten</div>
        <div className="text-xs text-center">
          Keine 3D-Modelle (GLB) für diese Konfiguration hinterlegt. GLB-Dateien in <code className="bg-muted px-1 rounded">client/public/cpq-models</code> ablegen oder <code className="bg-muted px-1 rounded">CPQ_GLB_PATH</code> setzen; in der CPQ-Admin pro Produkt Geometrie/GLB-URL pflegen.
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <Suspense
        fallback={
          <div className="aspect-square bg-muted rounded flex items-center justify-center text-muted-foreground text-sm">
            3D-Szene wird geladen…
          </div>
        }
      >
        <Shelf3DScene components={components} />
      </Suspense>
      <div className="px-2 py-1 text-xs text-muted-foreground text-center border-t mt-1">
        {withGlb.length} Komponenten · Schwenken & Zoomen mit Maus
      </div>
    </div>
  );
}
