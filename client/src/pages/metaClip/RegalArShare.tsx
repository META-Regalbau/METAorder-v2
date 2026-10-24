/**
 * Einstieg in die AR-Ansicht (PublicRegalplanerArPage, /regalplaner/ar) unter der 3D-Ansicht des Regalplaners:
 * am Handy/Tablet (grober Zeiger) ein Knopf, der die AR-Seite öffnet; am Desktop ein QR-Code auf dieselbe
 * Seite zum Scannen mit dem Handy. Die AR-Seite liegt bei METAorder selbst, nicht im iframe des Shops.
 */
import { useEffect, useState } from "react";
import { arPageUrl, type MetaClipState } from "@/lib/metaClipCpq";

type Texts = { arPhone: string; arDesktop: string; arQrHint: string; arClose: string; arOpenLink: string };

function isTouchDevice(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
}

export default function RegalArShare({ state, t }: { state: MetaClipState; t: Texts }) {
  const url = arPageUrl(window.location.origin, state);
  const [open, setOpen] = useState(false);
  const [qrSvg, setQrSvg] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    import("qrcode")
      .then((QRCode) => QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#ffffff" } }))
      .then((svg) => { if (!cancelled) setQrSvg(svg); })
      .catch((e) => console.warn("[RegalplanerAR] QR-Code konnte nicht erzeugt werden:", e));
    return () => { cancelled = true; };
  }, [open, url]);

  if (isTouchDevice()) {
    return (
      <button type="button" className="btn btn-md btn-secondary" onClick={() => window.open(url, "_blank", "noopener")}>
        {t.arPhone}
      </button>
    );
  }

  return (
    <div className="ar-share">
      <button type="button" className="btn btn-md btn-secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? t.arClose : t.arDesktop}
      </button>
      {open && (
        <div className="ar-qr" role="group" aria-label={t.arDesktop}>
          {qrSvg ? <div className="ar-qr-code" dangerouslySetInnerHTML={{ __html: qrSvg }} /> : <div className="ar-qr-code" />}
          <div className="ar-qr-text">
            <span>{t.arQrHint}</span>
            <a href={url} target="_blank" rel="noopener">{t.arOpenLink}</a>
          </div>
        </div>
      )}
    </div>
  );
}
