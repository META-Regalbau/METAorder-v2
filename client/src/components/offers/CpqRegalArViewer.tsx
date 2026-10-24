/**
 * Interaktive 3D+AR-Ansicht des konfigurierten META CLIP Regals auf der
 * öffentlichen Angebotsseite. Baut die echte, maßstabsgetreue Assembly (siehe
 * client/src/pages/metaClip/regalAssembly.ts — dieselbe Geometrie wie im
 * Konfigurator und im PDF-Vorschaubild) aus der gespeicherten CPQ-Konfiguration
 * nach, fügt ein helles Bodenraster hinzu (damit es nicht "schwebt") und
 * exportiert das Ergebnis als GLB (pages/metaClip/regalGlb.ts), das <model-viewer> für
 * die interaktive 3D-Ansicht UND für AR verwendet (Android WebXR; iPhone Quick Look mit
 * dem USDZ, das model-viewer selbst aus dem GLB erzeugt).
 */
import { useEffect, useState } from "react";
import "@google/model-viewer";
import { buildRegalGlbUrl } from "@/pages/metaClip/regalGlb";
import FullscreenViewport from "@/components/FullscreenViewport";

type CpqRegalArViewerProps = {
  /** Raw stored CpqConfigContext (field_count/height/depth/width/level_count/...). */
  cpqConfig: Record<string, unknown> | null | undefined;
  compact?: boolean;
};

function readNumber(config: Record<string, unknown>, key: string, fallback: number): number {
  const v = config[key];
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Maps the stored CPQ ConfigContext onto buildRegalGroup's parameters. */
function toRegalParams(config: Record<string, unknown>) {
  return {
    fieldCount: readNumber(config, "field_count", 2),
    levels: readNumber(config, "level_count", 5),
    widthMM: readNumber(config, "width", 1000),
    depthMM: readNumber(config, "depth", 500),
    heightMM: readNumber(config, "height", 2200),
  };
}

export default function CpqRegalArViewer({ cpqConfig, compact = false }: CpqRegalArViewerProps) {
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!cpqConfig) return;
    let cancelled = false;
    let currentUrl: string | null = null;
    setError(false);
    buildRegalGlbUrl(toRegalParams(cpqConfig))
      .then((url) => {
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        currentUrl = url;
        setGlbUrl(url);
      })
      .catch((e) => {
        console.warn("[CpqRegalArViewer] 3D-Modell konnte nicht erzeugt werden:", e);
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(cpqConfig ?? {})]);

  if (!cpqConfig) return null;

  const viewerHeight = compact ? "min(220px, 45vw)" : "min(380px, 60vh)";

  if (error) return null;

  if (!glbUrl) {
    return (
      <div
        className="rounded-md border bg-muted/40 flex items-center justify-center text-xs text-muted-foreground"
        style={{ height: viewerHeight, minHeight: 220 }}
      >
        3D-Modell wird erzeugt…
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="rounded-md border bg-muted/20 p-2">
        <FullscreenViewport label="Regal im Vollbild anzeigen">
          <model-viewer
            src={glbUrl}
            ar
            ar-modes="webxr scene-viewer quick-look"
            camera-controls
            touch-action="pan-y"
            style={{ width: "100%", height: viewerHeight, minHeight: 220, background: "#f5f5f5" }}
            alt="3D-Ansicht des konfigurierten META CLIP Regals"
          />
        </FullscreenViewport>
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Drehen und zoomen · Smartphone: AR über das Geräte- oder Raum-Icon
        </p>
      </div>
    </div>
  );
}
