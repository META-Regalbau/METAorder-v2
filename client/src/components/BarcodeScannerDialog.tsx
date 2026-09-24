import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Html5Qrcode } from "html5-qrcode";
import { ScanLine } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { isSecureCameraContext } from "@/lib/barcode/normalizeScanCode";
import {
  barcodeScanBox,
  createScanAcceptor,
  SCANNER_EXPERIMENTAL_FEATURES,
  SCANNER_FORMATS,
} from "@/lib/barcode/scannerConfig";
import { stopBarcodeScanner } from "@/lib/barcode/stopScanner";

const SCANNER_ELEMENT_ID = "metaorder-barcode-scanner";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called for each accepted scan (after normalize + dedupe). Dialog stays open. */
  onScan: (code: string) => void;
  /** Optional subtitle under the title */
  description?: string;
};

export function BarcodeScannerDialog({
  open,
  onOpenChange,
  onScan,
  description,
}: Props) {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function start() {
      setError(null);
      setStarting(true);

      if (!isSecureCameraContext()) {
        setError(t("barcodeScan.httpsRequired"));
        setStarting(false);
        return;
      }

      // Wait a tick so the dialog DOM node exists
      await new Promise((r) => setTimeout(r, 50));
      if (cancelled) return;

      const el = document.getElementById(SCANNER_ELEMENT_ID);
      if (!el) {
        setError(t("barcodeScan.cameraError"));
        setStarting(false);
        return;
      }

      try {
        const scanner = new Html5Qrcode(SCANNER_ELEMENT_ID, {
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
  }, [open, t]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ScanLine className="h-5 w-5" />
            {t("barcodeScan.title")}
          </DialogTitle>
          <DialogDescription>
            {description || t("barcodeScan.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {starting && !error ? (
            <p className="text-sm text-muted-foreground">{t("barcodeScan.starting")}</p>
          ) : null}
          <div
            id={SCANNER_ELEMENT_ID}
            className="overflow-hidden rounded-md bg-black min-h-[220px] w-full [&_video]:w-full [&_video]:rounded-md"
          />
          <p className="text-xs text-muted-foreground">{t("barcodeScan.hint")}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("barcodeScan.close")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
