/**
 * 3D + AR für eine Stücklistenzeile (öffentlich mit Link-Token oder intern mit Session).
 * `presentationPlaceholderOnly`: Demo-Würfel ohne Artikelnummer (Datei `_metaorder-presentation-placeholder.glb`).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import "@google/model-viewer";

type GlbResolveResponse = {
  filename: string | null;
  url: string | null;
  mtime?: number | null;
  isPresentationPlaceholder?: boolean;
};

type OfferLineItemGlbPreviewProps = {
  productNumber: string | null | undefined;
  manufacturerNumber?: string | null;
  instanceId: string;
  /** z. B. `/api/public/offers/${token}/glb-resolve` oder `/api/cpq/glb-resolve` */
  glbResolveBaseUrl: string;
  className?: string;
  /** Nur Präsentations-GLB (Khronos-Box), keine Artikelnummer nötig */
  presentationPlaceholderOnly?: boolean;
  /** Kompaktere Höhen für Darstellung neben Produktbild */
  compact?: boolean;
  /** Öffnet Lightbox mit voller model-viewer-Größe */
  onRequestLightbox?: (glbUrl: string) => void;
};

export default function OfferLineItemGlbPreview({
  productNumber,
  manufacturerNumber,
  instanceId,
  glbResolveBaseUrl,
  className = "",
  presentationPlaceholderOnly = false,
  compact = false,
  onRequestLightbox,
}: OfferLineItemGlbPreviewProps) {
  const pn = productNumber?.trim();
  const mfr = manufacturerNumber?.trim();

  const { data: glbData, isLoading } = useQuery<GlbResolveResponse>({
    queryKey: [glbResolveBaseUrl, pn, mfr, presentationPlaceholderOnly ? "ph" : "p"],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (presentationPlaceholderOnly) {
        params.set("presentationPlaceholder", "1");
      } else {
        if (pn) params.set("productNumber", pn);
        if (mfr) params.set("manufacturerNumber", mfr);
        if (params.toString().length === 0) return { filename: null, url: null };
      }
      const res = await fetch(`${glbResolveBaseUrl}?${params.toString()}`, {
        credentials: glbResolveBaseUrl.includes("/api/public/") ? "omit" : "include",
      });
      if (!res.ok) return { filename: null, url: null };
      return res.json();
    },
    enabled: presentationPlaceholderOnly || !!(pn || mfr),
  });

  const glbUrl = useMemo(() => {
    if (!glbData?.url) return null;
    const base = glbData.mtime != null ? `${glbData.url}?v=${glbData.mtime}` : glbData.url;
    if (base.startsWith("http")) return base;
    return `${typeof window !== "undefined" ? window.location.origin : ""}${base.startsWith("/") ? base : `/${base}`}`;
  }, [glbData?.url, glbData?.mtime]);

  const viewerHeight = compact ? "min(200px, 42vw)" : "min(320px, 55vh)";

  if (!presentationPlaceholderOnly && !pn && !mfr) {
    return null;
  }

  if (isLoading) {
    return (
      <div
        className={`rounded-md border bg-muted/40 min-h-[100px] flex items-center justify-center text-xs text-muted-foreground ${className}`}
      >
        3D wird gesucht…
      </div>
    );
  }

  if (!glbUrl) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {glbData?.isPresentationPlaceholder ? (
        <p className="text-[11px] text-muted-foreground text-center italic">
          Präsentationsmodell — sobald ein passendes GLB vorliegt, wird automatisch das Produktmodell genutzt.
        </p>
      ) : null}
      <div className="rounded-md border bg-muted/20 p-2">
        <model-viewer
          src={glbUrl}
          ar
          ar-modes="webxr scene-viewer quick-look"
          camera-controls
          touch-action="pan-y"
          style={{
            width: "100%",
            height: viewerHeight,
            minHeight: compact ? 160 : 220,
            background: "#e8e8e8",
          }}
          alt="3D-Modell"
        />
        <p className="text-[11px] text-muted-foreground mt-2 text-center">
          Drehen und zoomen · Smartphone: AR über das Geräte- oder Raum-Icon
        </p>
      </div>
      {onRequestLightbox ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-2"
          onClick={() => onRequestLightbox(glbUrl)}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          3D vergrößern
        </Button>
      ) : null}
      {glbData?.filename ? (
        <p className="text-[10px] text-muted-foreground text-center">GLB: {glbData.filename}</p>
      ) : null}
    </div>
  );
}
