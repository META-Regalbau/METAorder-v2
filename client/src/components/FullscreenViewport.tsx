/**
 * Generischer Vollbild-Wrapper für 3D/AR-Viewer (model-viewer, react-three-fiber
 * Canvas, ...). Nutzt die native Fullscreen-API — funktioniert unabhängig vom
 * Inhalt, solange dieser sich per CSS auf 100% Breite/Höhe strecken lässt.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minimize2 } from "lucide-react";
import "./fullscreenViewport.css";

type FullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void>;
};
type FullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => Promise<void>;
};

export default function FullscreenViewport({
  children,
  className,
  style,
  label = "Vollbild anzeigen",
  /** false = Inhalt behält im Vollbild seine natürliche Größe (zentriert), statt auf 100% gestreckt zu werden — z. B. für ein SVG ohne viewBox, das sonst nicht sauber mitskaliert. */
  stretchContent = true,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  label?: string;
  stretchContent?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    const handler = () => {
      const doc = document as FullscreenDocument;
      const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
      setIsFullscreen(active === ref.current);
    };
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  const toggle = useCallback(() => {
    const doc = document as FullscreenDocument;
    const active = doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
    if (active === ref.current) {
      (doc.exitFullscreen ? doc.exitFullscreen() : doc.webkitExitFullscreen?.())?.catch(() => {});
      return;
    }
    const el = ref.current as FullscreenElement | null;
    (el?.requestFullscreen ? el.requestFullscreen() : el?.webkitRequestFullscreen?.())?.catch(() => {});
  }, []);

  return (
    <div ref={ref} className={`fs-viewport ${className || ""}`} style={style}>
      <div className={`fs-viewport-content ${stretchContent ? "fs-viewport-content--stretch" : ""}`}>{children}</div>
      <button
        type="button"
        className="fs-viewport-btn"
        onClick={toggle}
        aria-label={isFullscreen ? "Vollbild verlassen" : label}
        title={isFullscreen ? "Vollbild verlassen" : label}
      >
        {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </button>
    </div>
  );
}
