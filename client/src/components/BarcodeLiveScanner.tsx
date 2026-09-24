import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Html5Qrcode } from "html5-qrcode";
import { isSecureCameraContext } from "@/lib/barcode/normalizeScanCode";
import {
  barcodeScanBox,
  createScanAcceptor,
  SCANNER_EXPERIMENTAL_FEATURES,
  SCANNER_FORMATS,
} from "@/lib/barcode/scannerConfig";
import { stopBarcodeScanner } from "@/lib/barcode/stopScanner";


type Props = {
  /** When false, camera is stopped and cleared. */
  active: boolean;
  onScan: (code: string) => void;
  className?: string;
};

/**
 * Dauer-Kamera-Scanner für Mobile Picking (ohne Dialog).
 * Ruft onScan nach Normalize + Dedup auf; bleibt aktiv bis active=false.
 */
export function BarcodeLiveScanner({ active, onScan, className }: Props) {
  const { t } = useTranslation();
  const reactId = useId().replace(/:/g, "");
  const elementId = `metaorder-barcode-live-${reactId}`;
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!active) return;

    let cancelled = false;

    async function start() {
      setError(null);
      setStarting(true);

      if (!isSecureCameraContext()) {
        setError(t("barcodeScan.httpsRequired"));
        setStarting(false);
        return;
      }

      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;

      const el = document.getElementById(elementId);
      if (!el) {
        setError(t("barcodeScan.cameraError"));
        setStarting(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode(elementId, {
          formatsToSupport: SCANNER_FORMATS,
          experimentalFeatures: SCANNER_EXPERIMENTAL_FEATURES,
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 8,
            qrbox: barcodeScanBox,
            aspectRatio: 1.333,
          },
          createScanAcceptor((code) => onScanRef.current(code)),
          () => {
            // ignore frame-level "not found"
          },
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (/NotAllowedError|Permission|denied/i.test(msg)) {
          setError(t("barcodeScan.permissionDenied"));
        } else if (/secure|https|Only secure/i.test(msg)) {
          setError(t("barcodeScan.httpsRequired"));
        } else {
          setError(t("barcodeScan.cameraError"));
        }
      } finally {
        if (!cancelled) setStarting(false);
      }
    }

    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      scannerRef.current = null;
      stopBarcodeScanner(scanner);
    };
  }, [active, elementId, t]);

  return (
    <div className={className}>
      {error ? (
        <p className="text-sm text-destructive px-3 py-2" role="alert">
          {error}
        </p>
      ) : null}
      {starting && !error ? (
        <p className="text-sm text-muted-foreground px-3 py-1">{t("barcodeScan.starting")}</p>
      ) : null}
      <div
        id={elementId}
        className="overflow-hidden bg-black min-h-[180px] w-full [&_video]:w-full"
      />
      {!error ? (
        <p className="text-xs text-muted-foreground px-3 py-1">{t("barcodeScan.hint")}</p>
      ) : null}
    </div>
  );
}
