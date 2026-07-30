import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
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
import {
  isSecureCameraContext,
  normalizeScanCode,
} from "@/lib/barcode/normalizeScanCode";

const SCANNER_ELEMENT_ID = "metaorder-barcode-scanner";
const DEDUP_MS = 1500;

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
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);
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
          formatsToSupport: [
            Html5QrcodeSupportedFormats.QR_CODE,
            Html5QrcodeSupportedFormats.CODE_128,
            Html5QrcodeSupportedFormats.EAN_13,
            Html5QrcodeSupportedFormats.EAN_8,
            Html5QrcodeSupportedFormats.CODE_39,
          ],
          verbose: false,
        });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 8,
            qrbox: (viewfinderWidth, viewfinderHeight) => {
              const w = Math.floor(Math.min(viewfinderWidth, viewfinderHeight) * 0.85);
              const h = Math.floor(Math.min(w, viewfinderHeight * 0.45));
              return { width: w, height: Math.max(120, h) };
            },
            aspectRatio: 1.333,
          },
          (decoded) => {
            const code = normalizeScanCode(decoded);
            if (!code) return;
            const now = Date.now();
            const last = lastScanRef.current;
            if (last && last.code === code && now - last.at < DEDUP_MS) return;
            lastScanRef.current = { code, at: now };
            onScanRef.current(code);
          },
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
      if (scanner) {
        void scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {
            try {
              scanner.clear();
            } catch {
              // ignore
            }
          });
      }
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
