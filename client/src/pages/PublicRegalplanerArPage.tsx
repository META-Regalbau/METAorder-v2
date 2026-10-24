/**
 * AR-Ansicht des Regalplaners: /regalplaner/ar?rp=<Konfigurations-Code>&lang=de|en
 *
 * Eigene Seite statt einer Ansicht im Regalplaner, weil der Regalplaner im Shop in einem iframe steckt:
 * Quick Look (iPhone) und WebXR (Android) laufen oben im Browser ohne iframe-Freigaben. Der Regalplaner
 * öffnet die Seite am Handy per Knopf und zeigt am Desktop einen QR-Code darauf (metaClip/RegalArShare.tsx).
 *
 * Das Modell entsteht im Browser aus dem Code (regalGlb.ts) – keine Anmeldung, keine Shop-Daten. Es zeigt
 * Rahmen, Böden und Diagonalstäbe in Originalgröße (ar-scale fixed); Rückwand und Farbe zeigt es nicht.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import "@google/model-viewer";
import { parseConfigCode, overallLength, DEFAULT_STATE, formatNumber } from "@/lib/metaClipCpq";
import { buildRegalGlbUrl } from "./metaClip/regalGlb";
import "./metaClip/metaClip.css";

const T = {
  de: {
    eyebrow: "META CLIP · AR-Ansicht",
    title: "Regal in Ihrem Raum ansehen",
    fields: (n: number) => (n === 1 ? "1 Feld" : `${n} Felder`),
    shelves: (n: number) => `${n} Böden je Feld`,
    clinch: "vormontierte Rahmen",
    s3: "Steckrahmen S3",
    loading: "3D-Modell wird erzeugt …",
    arButton: "In meinem Raum ansehen",
    howTo: "Kamera auf den Boden richten und das Handy langsam bewegen, bis das Regal erscheint. Es steht in Originalgröße.",
    noAr: "AR funktioniert am Smartphone oder Tablet: iPhone/iPad mit Safari oder Android mit Chrome (Geräte mit Google ARCore). Hier können Sie das Regal drehen und zoomen.",
    note: "Das Modell zeigt Rahmen, Böden und Diagonalstäbe in Originalgröße. Rückwand und Oberfläche sind nicht dargestellt.",
    invalid: "Dieser Link enthält keine gültige Regal-Konfiguration. Bitte öffnen Sie die AR-Ansicht erneut aus dem Regalplaner.",
    error: "Das 3D-Modell konnte nicht erzeugt werden.",
    alt: "3D-Modell des konfigurierten META CLIP Regals",
  },
  en: {
    eyebrow: "META CLIP · AR view",
    title: "See the shelving in your room",
    fields: (n: number) => (n === 1 ? "1 bay" : `${n} bays`),
    shelves: (n: number) => `${n} shelves per bay`,
    clinch: "pre-assembled frames",
    s3: "S3 plug-in frames",
    loading: "Building 3D model …",
    arButton: "View in my room",
    howTo: "Point the camera at the floor and move the phone slowly until the shelving appears. It is shown at actual size.",
    noAr: "AR works on smartphones and tablets: iPhone/iPad with Safari or Android with Chrome (devices with Google ARCore). Here you can rotate and zoom the shelving.",
    note: "The model shows frames, shelves and diagonal braces at actual size. Rear panel and finish are not shown.",
    invalid: "This link does not contain a valid shelving configuration. Please open the AR view again from the shelf planner.",
    error: "The 3D model could not be built.",
    alt: "3D model of the configured META CLIP shelving",
  },
} as const;

type ModelViewerElement = HTMLElement & { canActivateAR?: boolean };

export default function PublicRegalplanerArPage() {
  const params = useMemo(() => new URLSearchParams(window.location.search), []);
  const lang = params.get("lang") === "en" ? "en" : "de";
  const t = T[lang];
  const config = useMemo(() => parseConfigCode(params.get("rp")), [params]);
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [canAr, setCanAr] = useState<boolean | null>(null);
  const viewerRef = useRef<ModelViewerElement>(null);

  useEffect(() => {
    if (!config) return;
    let cancelled = false;
    let url: string | null = null;
    buildRegalGlbUrl({ fieldCount: config.felder, levels: config.boeden, widthMM: config.breite, depthMM: config.tiefe, heightMM: config.hoehe })
      .then((u) => {
        if (cancelled) { URL.revokeObjectURL(u); return; }
        url = u;
        setGlbUrl(u);
      })
      .catch((e) => {
        console.warn("[RegalplanerAR] 3D-Modell konnte nicht erzeugt werden:", e);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [config]);

  // Ob AR verfügbar ist, weiß model-viewer erst nach dem Laden des Modells
  useEffect(() => {
    const el = viewerRef.current;
    if (!el || !glbUrl) return;
    const onLoad = () => setCanAr(!!el.canActivateAR);
    el.addEventListener("load", onLoad);
    return () => el.removeEventListener("load", onLoad);
  }, [glbUrl]);

  const nf = (n: number) => formatNumber(n, lang);
  const summary = config
    ? `${t.fields(config.felder)} · ${nf(overallLength({ ...DEFAULT_STATE, ...config }))} × ${nf(config.hoehe)} × ${config.tiefe} mm · ${t.shelves(config.boeden)} · ${config.rahmen === "s3" ? t.s3 : t.clinch}`
    : "";

  return (
    <div className="mclip" style={{ minHeight: "100vh" }}>
      <div className="cfg" style={{ minHeight: "100vh" }}>
        <div className="cfg-head">
          <img src="/img/meta-logo-red.png" alt="META" />
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12, maxWidth: 960, width: "100%", margin: "0 auto" }}>
          <span className="eyebrow">{t.eyebrow}</span>
          <span className="panel-title">{t.title}</span>
          {!config ? (
            <div className="alert error" role="alert"><div className="body">{t.invalid}</div></div>
          ) : (
            <>
              <span className="panel-sub">{summary}</span>
              <div className="viewport" style={{ minHeight: "min(70vh, 640px)" }}>
                {failed ? (
                  <div className="control-note" style={{ padding: 24 }}>{t.error}</div>
                ) : !glbUrl ? (
                  <div className="control-note" style={{ padding: 24 }}>{t.loading}</div>
                ) : (
                  <model-viewer
                    ref={viewerRef}
                    src={glbUrl}
                    ar
                    ar-modes="webxr scene-viewer quick-look"
                    ar-scale="fixed"
                    ar-placement="floor"
                    camera-controls
                    touch-action="pan-y"
                    shadow-intensity="0.6"
                    alt={t.alt}
                    style={{ width: "100%", height: "min(70vh, 640px)", background: "#f5f5f5" }}
                  >
                    <button slot="ar-button" type="button" className="btn btn-lg btn-primary"
                      style={{ position: "absolute", left: 16, right: 16, bottom: 16, width: "auto" }}>
                      {t.arButton}
                    </button>
                  </model-viewer>
                )}
              </div>
              <span className="control-note">{canAr === false ? t.noAr : t.howTo}</span>
              <span className="control-note">{t.note}</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
