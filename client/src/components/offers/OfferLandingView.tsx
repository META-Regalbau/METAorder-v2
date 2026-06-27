import { useMemo, useState, Fragment, type ReactNode } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Download, ImageIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import OfferLineItemGlbPreview from "./OfferLineItemGlbPreview";
import metaLogoUrl from "@assets/META-Logo.svg";
import "@google/model-viewer";

export type OfferLandingLineChild = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  productNumber: string | null;
  coverImageUrl?: string | null;
};

export type OfferLandingLineItem = {
  id: string;
  label: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  taxRate: number;
  productNumber: string | null;
  configurationName?: string | null;
  configurationDescription?: string | null;
  coverImageUrl?: string | null;
  children?: OfferLandingLineChild[];
};

export type OfferLandingData = {
  id: string;
  offerNumber: string;
  customerName: string | null;
  customerEmail: string | null;
  totalAmount: number;
  netAmount: number;
  status: string;
  statusLabel?: string | null;
  createdAt: string | null;
  expirationDate: string | null;
  salesChannelName?: string | null;
  lineItems: OfferLandingLineItem[];
};

export type MediaLightboxState =
  | { kind: "image"; src: string; title?: string }
  | { kind: "glb"; url: string; title?: string }
  | null;

function formatMoney(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function statusBadgeVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted") return "default";
  if (s === "rejected" || s === "declined") return "destructive";
  if (s === "expired") return "outline";
  return "secondary";
}

/** Produktbild und 3D nebeneinander (ab sm); Klick auf Bild öffnet Lightbox. */
function OfferPositionMediaGrid({
  coverImageUrl,
  onImageLightbox,
  showGlb,
  glbPreview,
  imageMaxClass = "max-h-52",
}: {
  coverImageUrl?: string | null;
  onImageLightbox?: () => void;
  showGlb: boolean;
  glbPreview: ReactNode;
  /** Stückliste etwas kleiner */
  imageMaxClass?: string;
}) {
  const hasImg = !!(coverImageUrl && coverImageUrl.trim());
  const twoCol = hasImg && showGlb;

  return (
    <div
      className={cn(
        "grid gap-4",
        twoCol ? "sm:grid-cols-2 sm:items-start" : "grid-cols-1",
      )}
    >
      {hasImg && onImageLightbox ? (
        <div className="flex min-w-0 flex-col gap-1">
          <button
            type="button"
            onClick={onImageLightbox}
            className="group rounded-lg border bg-muted/10 p-3 text-left transition hover:border-primary/35 hover:bg-muted/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <img
              src={coverImageUrl}
              alt=""
              className={cn("mx-auto w-full object-contain", imageMaxClass)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground group-hover:text-foreground">
              <ImageIcon className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              Zum Vergrößern antippen
            </p>
          </button>
        </div>
      ) : null}
      {showGlb ? <div className="min-w-0">{glbPreview}</div> : null}
    </div>
  );
}

function MediaLightboxDialog({
  state,
  onClose,
}: {
  state: MediaLightboxState;
  onClose: () => void;
}) {
  const open = state !== null;
  const title =
    state?.title ||
    (state?.kind === "image" ? "Produktbild" : state?.kind === "glb" ? "3D-Modell" : "");

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] w-full max-w-[min(96vw,56rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8">{title}</DialogTitle>
        </DialogHeader>
        {state?.kind === "image" ? (
          <img
            src={state.src}
            alt=""
            className="mx-auto max-h-[min(82vh,800px)] w-full object-contain"
          />
        ) : null}
        {state?.kind === "glb" ? (
          <div className="w-full rounded-md border bg-muted/20 p-1">
            <model-viewer
              src={state.url}
              camera-controls
              touch-action="pan-y"
              ar
              ar-modes="webxr scene-viewer quick-look"
              style={{
                width: "100%",
                height: "min(72vh, 640px)",
                background: "#e8e8e8",
              }}
              alt="3D-Modell"
            />
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              Maus: drehen und zoomen · Mobil: AR über das Geräte-Icon
            </p>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export type OfferLandingViewProps = {
  offer: OfferLandingData;
  /** Ablauf des Share-Links (nicht Angebots-Gültigkeit) */
  shareExpiresAt?: string | null;
  /** gesetzt = öffentliche GLB-API und PDF-Downloads ohne Login */
  publicToken?: string | null;
  /** interne Vorschau: PDF mit Session von /api/offers/:id/... */
  internalOfferIdForPdf?: string | null;
  showCustomerActions?: boolean;
  acceptLoading?: boolean;
  declineLoading?: boolean;
  onAccept?: () => void;
  onDecline?: (reason?: string) => void;
  banner?: { type: "success" | "error" | "info"; message: string } | null;
};

export default function OfferLandingView({
  offer,
  shareExpiresAt,
  publicToken,
  internalOfferIdForPdf,
  showCustomerActions = false,
  acceptLoading = false,
  declineLoading = false,
  onAccept,
  onDecline,
  banner,
}: OfferLandingViewProps) {
  const { toast } = useToast();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);
  const [mediaLightbox, setMediaLightbox] = useState<MediaLightboxState>(null);
  const [pdfLoading, setPdfLoading] = useState<null | "standard" | "config">(null);

  const glbBase = useMemo(
    () =>
      publicToken
        ? `/api/public/offers/${encodeURIComponent(publicToken)}/glb-resolve`
        : "/api/cpq/glb-resolve",
    [publicToken],
  );

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const showPdfDownloads = !!(publicToken || internalOfferIdForPdf);

  const downloadPdf = async (kind: "standard" | "config") => {
    const creds = publicToken ? ("omit" as const) : ("include" as const);
    let url: string;
    if (publicToken) {
      url =
        kind === "standard"
          ? `/api/public/offers/${encodeURIComponent(publicToken)}/pdf`
          : `/api/public/offers/${encodeURIComponent(publicToken)}/config-pdf?download=true`;
    } else if (internalOfferIdForPdf) {
      url =
        kind === "standard"
          ? `/api/offers/${internalOfferIdForPdf}/pdf?download=true`
          : `/api/offers/${internalOfferIdForPdf}/config-pdf?download=true`;
    } else {
      return;
    }

    setPdfLoading(kind);
    try {
      const response = await fetch(url, { credentials: creds });
      if (!response.ok) {
        const errJson = await response.json().catch(() => null);
        throw new Error(errJson?.error || errJson?.message || "Download fehlgeschlagen");
      }
      const blob = await response.blob();
      const ct = response.headers.get("content-type") || "";
      const isPdf =
        ct.includes("application/pdf") || (blob.type && blob.type.includes("pdf"));
      if (!isPdf) {
        let msg = "Antwort ist kein PDF";
        try {
          const parsed = JSON.parse(await blob.text());
          if (parsed?.error || parsed?.message) {
            msg = String(parsed.error || parsed.message);
          }
        } catch {
          /* ignore */
        }
        throw new Error(msg);
      }
      const objectUrl = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      const num = (offer.offerNumber || offer.id).replace(/[^a-zA-Z0-9._-]+/g, "_");
      a.download =
        kind === "standard" ? `Angebot-${num}.pdf` : `angebot-konfiguration-${num}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(objectUrl);
      document.body.removeChild(a);
      toast({
        title: "PDF gespeichert",
        description: kind === "standard" ? "Angebots-PDF" : "Konfigurations-PDF",
      });
    } catch (e) {
      console.error("PDF download:", e);
      toast({
        title: "PDF nicht verfügbar",
        description: e instanceof Error ? e.message : "Unbekannter Fehler",
        variant: "destructive",
      });
    } finally {
      setPdfLoading(null);
    }
  };

  const label = offer.statusLabel || offer.status;

  return (
    <div className="max-w-3xl mx-auto space-y-8 pb-16 px-4 py-8">
      <MediaLightboxDialog state={mediaLightbox} onClose={() => setMediaLightbox(null)} />

      <div className="text-center space-y-3">
        <img
          src={metaLogoUrl}
          alt=""
          className="h-12 sm:h-14 w-auto mx-auto"
          width={180}
          height={56}
        />
        <p className="text-sm text-muted-foreground uppercase tracking-wide">Angebot</p>
        <h1 className="text-3xl font-semibold tracking-tight">{offer.offerNumber}</h1>
        {offer.customerName ? <p className="text-lg text-muted-foreground">{offer.customerName}</p> : null}
        <div className="flex flex-wrap justify-center gap-2 pt-2">
          <Badge variant={statusBadgeVariant(offer.status)}>{label}</Badge>
        </div>
      </div>

      {banner ? (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            banner.type === "success"
              ? "bg-emerald-50 border-emerald-200 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-800 dark:text-emerald-100"
              : banner.type === "error"
                ? "bg-destructive/10 border-destructive/30 text-destructive"
                : "bg-muted border-border"
          }`}
        >
          {banner.message}
        </div>
      ) : null}

      {shareExpiresAt ? (
        <p className="text-center text-xs text-muted-foreground">
          Link gültig bis {format(new Date(shareExpiresAt), "PPp", { locale: de })}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Übersicht</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {offer.expirationDate ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Angebot gültig bis</span>
              <span>{format(new Date(offer.expirationDate.slice(0, 10)), "PPP", { locale: de })}</span>
            </div>
          ) : null}
          {offer.createdAt ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Erstellt</span>
              <span>{format(new Date(offer.createdAt), "PPP", { locale: de })}</span>
            </div>
          ) : null}
          {offer.salesChannelName ? (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Vertriebskanal</span>
              <span>{offer.salesChannelName}</span>
            </div>
          ) : null}
          <Separator className="my-3" />
          <div className="flex justify-between font-medium">
            <span>Netto</span>
            <span>{formatMoney(offer.netAmount)}</span>
          </div>
          <div className="flex justify-between text-lg font-semibold">
            <span>Brutto gesamt</span>
            <span>{formatMoney(offer.totalAmount)}</span>
          </div>
        </CardContent>
      </Card>

      {showPdfDownloads ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">PDF</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col sm:flex-row flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              className="justify-center gap-2"
              disabled={pdfLoading !== null}
              onClick={() => void downloadPdf("standard")}
            >
              {pdfLoading === "standard" ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
              ) : (
                <Download className="h-4 w-4 shrink-0" aria-hidden />
              )}
              Angebots-PDF
            </Button>
            <Button
              type="button"
              variant="outline"
              className="justify-center gap-2"
              disabled={pdfLoading !== null}
              onClick={() => void downloadPdf("config")}
            >
              {pdfLoading === "config" ? (
                <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
              ) : (
                <Download className="h-4 w-4 shrink-0" aria-hidden />
              )}
              Konfigurations-PDF
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="space-y-4">
        <h2 className="text-xl font-semibold">Positionen</h2>
        {offer.lineItems.map((item) => {
          const open = expanded.has(item.id);
          const hasChildren = item.children && item.children.length > 0;
          const hasProductGlbKey = !!(item.productNumber && item.productNumber.trim());
          const showPresentationOnly = !hasProductGlbKey && !item.coverImageUrl;
          const showGlb = hasProductGlbKey || showPresentationOnly;
          const hasImg = !!(item.coverImageUrl && item.coverImageUrl.trim());
          const compactGlb = hasImg && showGlb;

          return (
            <Card key={item.id}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    {hasChildren ? (
                      <button
                        type="button"
                        className="flex items-start gap-2 text-left font-medium w-full"
                        onClick={() => toggle(item.id)}
                      >
                        {open ? <ChevronDown className="h-4 w-4 mt-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 shrink-0" />}
                        <span>{item.label}</span>
                      </button>
                    ) : (
                      <p className="font-medium">{item.label}</p>
                    )}
                    {item.configurationName ? (
                      <p className="text-sm text-muted-foreground mt-1">{item.configurationName}</p>
                    ) : null}
                    {item.configurationDescription ? (
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap mt-1">{item.configurationDescription}</p>
                    ) : null}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-medium">{formatMoney(item.totalPrice)}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.quantity} × {formatMoney(item.unitPrice)}
                    </p>
                  </div>
                </div>

                {showGlb || hasImg ? (
                  <OfferPositionMediaGrid
                    coverImageUrl={item.coverImageUrl}
                    onImageLightbox={
                      hasImg
                        ? () =>
                            setMediaLightbox({
                              kind: "image",
                              src: item.coverImageUrl!,
                              title: item.label,
                            })
                        : undefined
                    }
                    showGlb={showGlb}
                    glbPreview={
                      hasProductGlbKey ? (
                        <OfferLineItemGlbPreview
                          productNumber={item.productNumber}
                          instanceId={`line-${item.id}`}
                          glbResolveBaseUrl={glbBase}
                          compact={compactGlb}
                          onRequestLightbox={(url) =>
                            setMediaLightbox({ kind: "glb", url, title: item.label })
                          }
                        />
                      ) : showPresentationOnly ? (
                        <OfferLineItemGlbPreview
                          presentationPlaceholderOnly
                          productNumber={null}
                          instanceId={`line-ph-${item.id}`}
                          glbResolveBaseUrl={glbBase}
                          compact={compactGlb}
                          onRequestLightbox={(url) =>
                            setMediaLightbox({ kind: "glb", url, title: item.label })
                          }
                        />
                      ) : null
                    }
                  />
                ) : null}

                {hasChildren && open ? (
                  <div className="pl-4 border-l-2 border-muted space-y-4 mt-2">
                    {item.children!.map((ch) => {
                      const chHasImg = !!(ch.coverImageUrl && ch.coverImageUrl.trim());

                      return (
                        <Fragment key={ch.id}>
                          <div className="flex justify-between text-sm gap-2">
                            <span className="text-muted-foreground">
                              {ch.label}
                              {ch.productNumber ? ` · ${ch.productNumber}` : ""}
                            </span>
                            <span>
                              {ch.quantity}×
                            </span>
                          </div>
                          {chHasImg ? (
                            <OfferPositionMediaGrid
                              coverImageUrl={ch.coverImageUrl}
                              onImageLightbox={() =>
                                setMediaLightbox({
                                  kind: "image",
                                  src: ch.coverImageUrl!,
                                  title: ch.label,
                                })
                              }
                              showGlb={false}
                              imageMaxClass="max-h-40"
                              glbPreview={null}
                            />
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {showCustomerActions ? (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg">Entscheidung</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Sie können dieses Angebot direkt annehmen oder ablehnen. Bei Annahme wird der Status in unserem System aktualisiert.
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <Button className="flex-1" size="lg" onClick={onAccept} disabled={acceptLoading || declineLoading}>
                {acceptLoading ? "Wird gesendet…" : "Angebot annehmen"}
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                size="lg"
                onClick={() => setShowDecline((v) => !v)}
                disabled={acceptLoading || declineLoading}
              >
                Ablehnen
              </Button>
            </div>
            {showDecline ? (
              <div className="space-y-2">
                <Input
                  placeholder="Optional: Grund für die Ablehnung"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                />
                <Button
                  variant="destructive"
                  disabled={declineLoading || acceptLoading}
                  onClick={() => onDecline?.(declineReason.trim() || undefined)}
                >
                  {declineLoading ? "Wird gesendet…" : "Ablehnung bestätigen"}
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
