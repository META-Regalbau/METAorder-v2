import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import bwipjs from "bwip-js/browser";
import { Loader2, Printer, RefreshCw } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  LOCATION_LABEL_FORMATS,
  buildLocationLabelZpl,
  getLocationLabelFormat,
  loadStoredLocationLabelFormatId,
  locationSubtitle,
  storeLocationLabelFormatId,
  type LocationLabelFormatId,
  type LocationLabelInput,
} from "@/lib/labels/locationLabelZpl";
import {
  BrowserPrintUnavailableError,
  discoverPrinters,
  sendZpl,
  type ZebraDevice,
} from "@/lib/zebra/browserPrint";

export type PrintableLocation = LocationLabelInput;

type Props = {
  locations: PrintableLocation[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function LabelPreview({
  location,
  widthMm,
  heightMm,
}: {
  location: PrintableLocation;
  widthMm: number;
  heightMm: number;
}) {
  const qrRef = useRef<HTMLCanvasElement>(null);
  const barcodeRef = useRef<HTMLCanvasElement>(null);
  const code = location.code.trim();

  // Vorschaubox deckeln, Seitenverhältnis des echten Etiketts beibehalten
  const maxW = 260;
  const maxH = 260;
  const scale = Math.min(maxW / widthMm, maxH / heightMm);
  const previewW = Math.round(widthMm * scale);
  const previewH = Math.round(heightMm * scale);
  const isLarge = widthMm >= 80;
  const subtitle = locationSubtitle(location);

  useEffect(() => {
    if (!code) return;
    try {
      if (qrRef.current) {
        bwipjs.toCanvas(qrRef.current, {
          bcid: "qrcode",
          text: code,
          scale: isLarge ? 3 : 2,
          includetext: false,
        });
      }
    } catch {
      // preview only
    }
    try {
      if (barcodeRef.current) {
        bwipjs.toCanvas(barcodeRef.current, {
          bcid: "code128",
          text: code,
          scale: isLarge ? 2 : 1,
          height: isLarge ? 12 : 8,
          includetext: false,
        });
      }
    } catch {
      // preview only
    }
  }, [code, isLarge]);

  return (
    <div
      className="border rounded-md bg-white text-black p-2 shadow-sm overflow-hidden flex flex-col"
      style={{ width: previewW, height: previewH }}
      aria-hidden
    >
      <div className="font-mono font-bold leading-none truncate text-xl">{code}</div>
      <div className="text-[10px] text-neutral-600 leading-tight truncate mt-1">
        {subtitle || " "}
      </div>
      <div className="flex items-end gap-2 mt-auto min-h-0">
        <canvas ref={qrRef} className="shrink-0 max-h-full" />
        <canvas ref={barcodeRef} className="min-w-0 flex-1 max-h-full" />
      </div>
    </div>
  );
}

export function PrintLocationLabelDialog({ locations, open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [copies, setCopies] = useState(1);
  const [formatId, setFormatId] = useState<LocationLabelFormatId>(
    loadStoredLocationLabelFormatId,
  );
  const [printers, setPrinters] = useState<ZebraDevice[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>("");
  const [loadingPrinters, setLoadingPrinters] = useState(false);
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);

  const format = useMemo(() => getLocationLabelFormat(formatId), [formatId]);

  const validLocations = useMemo(
    () => locations.filter((l) => l.code.trim().length > 0),
    [locations],
  );

  const selectedPrinter = useMemo(
    () => printers.find((p) => p.uid === selectedUid) ?? null,
    [printers, selectedUid],
  );

  const previewLocation = validLocations[previewIndex] ?? validLocations[0] ?? null;

  async function loadPrinters() {
    setLoadingPrinters(true);
    setPrinterError(null);
    try {
      const { printers: list, defaultUid } = await discoverPrinters();
      setPrinters(list);
      if (list.length === 0) {
        setSelectedUid("");
        setPrinterError(t("productLabels.noPrinters"));
      } else {
        const uid =
          (defaultUid && list.some((p) => p.uid === defaultUid) ? defaultUid : null) || list[0].uid;
        setSelectedUid(uid);
      }
    } catch (e) {
      setPrinters([]);
      setSelectedUid("");
      let msg = t("productLabels.browserPrintMissing");
      if (e instanceof BrowserPrintUnavailableError) {
        msg =
          e.message === "browser_print_unreachable"
            ? t("productLabels.browserPrintMissing")
            : t("productLabels.browserPrintHostBlocked");
      } else if (e instanceof Error && e.message) {
        msg = e.message;
      }
      setPrinterError(msg);
    } finally {
      setLoadingPrinters(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setCopies(1);
    setPreviewIndex(0);
    setFormatId(loadStoredLocationLabelFormatId());
    void loadPrinters();
  }, [open]);

  function handleFormatChange(id: string) {
    const next = getLocationLabelFormat(id).id;
    setFormatId(next);
    storeLocationLabelFormatId(next);
  }

  async function handlePrint() {
    if (!selectedPrinter || validLocations.length === 0) return;
    setPrinting(true);
    try {
      for (const location of validLocations) {
        const zpl = buildLocationLabelZpl(location, {
          copies,
          widthMm: format.widthMm,
          heightMm: format.heightMm,
        });
        await sendZpl(selectedPrinter, zpl);
      }
      toast({ title: t("locationLabels.printSuccess", { count: validLocations.length }) });
      onOpenChange(false);
    } catch (e) {
      toast({
        title: t("errors.failed"),
        description: e instanceof Error ? e.message : t("productLabels.printFailed"),
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("locationLabels.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("locationLabels.dialogDescription", {
              count: validLocations.length,
              width: format.widthMm,
              height: format.heightMm,
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {previewLocation ? (
            <div className="flex flex-col sm:flex-row gap-4 items-start">
              <LabelPreview
                location={previewLocation}
                widthMm={format.widthMm}
                heightMm={format.heightMm}
              />
              <div className="flex-1 space-y-2 min-w-0">
                <p className="text-sm font-mono font-medium truncate">{previewLocation.code}</p>
                <p className="text-xs text-muted-foreground truncate">
                  {locationSubtitle(previewLocation) || "—"}
                </p>
                {validLocations.length > 1 ? (
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={previewIndex <= 0}
                      onClick={() => setPreviewIndex((i) => Math.max(0, i - 1))}
                    >
                      ‹
                    </Button>
                    <span className="text-xs text-muted-foreground">
                      {previewIndex + 1} / {validLocations.length}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={previewIndex >= validLocations.length - 1}
                      onClick={() =>
                        setPreviewIndex((i) => Math.min(validLocations.length - 1, i + 1))
                      }
                    >
                      ›
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("locationLabels.noLocations")}</p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="loc-label-format">{t("productLabels.format")}</Label>
              <Select value={formatId} onValueChange={handleFormatChange}>
                <SelectTrigger id="loc-label-format">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOCATION_LABEL_FORMATS.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {t(`locationLabels.formats.${f.id}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="loc-label-copies">{t("locationLabels.copies")}</Label>
              <Input
                id="loc-label-copies"
                type="number"
                min={1}
                max={999}
                value={copies}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  setCopies(Number.isFinite(n) ? Math.max(1, Math.min(999, Math.floor(n))) : 1);
                }}
              />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center justify-between gap-2">
                <Label>{t("productLabels.printer")}</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => void loadPrinters()}
                  disabled={loadingPrinters}
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${loadingPrinters ? "animate-spin" : ""}`} />
                </Button>
              </div>
              {loadingPrinters ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("productLabels.loadingPrinters")}
                </p>
              ) : printers.length > 0 ? (
                <Select value={selectedUid} onValueChange={setSelectedUid}>
                  <SelectTrigger>
                    <SelectValue placeholder={t("productLabels.selectPrinter")} />
                  </SelectTrigger>
                  <SelectContent>
                    {printers.map((p) => (
                      <SelectItem key={p.uid} value={p.uid}>
                        {p.name || p.uid}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-destructive">
                  {printerError || t("productLabels.noPrinters")}
                </p>
              )}
            </div>
          </div>

          {printerError && printers.length > 0 ? (
            <p className="text-sm text-muted-foreground">{printerError}</p>
          ) : null}

          <p className="text-xs text-muted-foreground">{t("productLabels.browserPrintHint")}</p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {t("productLabels.cancel")}
          </Button>
          <Button
            type="button"
            onClick={() => void handlePrint()}
            disabled={printing || !selectedPrinter || validLocations.length === 0 || loadingPrinters}
          >
            {printing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Printer className="h-4 w-4 mr-2" />
            )}
            {t("productLabels.print")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
