import { useMemo, useState, Fragment, lazy, Suspense, type ReactNode } from "react";
import { format } from "date-fns";
import { de } from "date-fns/locale";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ChevronDown, ChevronRight, Download, ImageIcon, Layers, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import OfferLineItemGlbPreview from "./OfferLineItemGlbPreview";
import metaLogoUrl from "@assets/META-Logo.svg";
import { CPQ_3D_PREVIEW } from "@/lib/featureFlags";
import "./offerLanding.css";

// three.js/GLTFExporter/model-viewer sind schwer und werden nur gebraucht, wenn diese
// Angebotsseite tatsächlich eine CPQ-Konfiguration oder Raumplanung zeigt — lazy laden,
// damit Angebote ohne CPQ-Inhalt sie nicht ins Hauptbundle ziehen (Muster wie RoomScene3D
// im Admin-Raumplaner).
const CpqRegalArViewer = lazy(() => import("./CpqRegalArViewer"));
const CpqRoomArViewer = lazy(() => import("./CpqRoomArViewer"));

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
  /** CPQ ConfigContext (Maße) fürs interaktive 3D+AR-Modell, falls diese Position aus dem CPQ-Konfigurator stammt. */
  cpqConfig?: Record<string, unknown> | null;
  /** true = Überpunkt einer Konfiguration (kein echtes Lineitem, siehe children) */
  isConfigurationGroup?: boolean;
};

export type OfferLandingRoomPlan = {
  name: string | null;
  lengthMm: number;
  widthMm: number;
  heightMm: number;
  placements: Array<{ configKey: string; xMm: number; yMm: number; rotationDeg: 0 | 90 | 180 | 270 }>;
  configurations: Array<{
    configKey: string;
    footprint: { lengthMm: number; depthMm: number; heightMm: number };
    cpqConfig: Record<string, unknown>;
  }>;
  wallFeatures?: Array<{ id: string; wall: "north" | "south" | "east" | "west"; type: "door" | "window" | "gate"; offsetMm: number; widthMm: number }>;
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
  /** Raumplanung (falls im Angebot platziert) fürs interaktive 3D+AR-Modell. */
  roomPlan?: OfferLandingRoomPlan | null;
};

export type MediaLightboxState =
  | { kind: "image"; src: string; title?: string }
  | { kind: "glb"; url: string; title?: string }
  | null;

function formatMoney(n: number) {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(n);
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "approved" || s === "accepted") return "st-accepted";
  if (s === "rejected" || s === "declined") return "st-rejected";
  if (s === "expired") return "st-expired";
  return "st-open";
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
            className="group border p-3 text-left transition hover:border-[var(--fg-3)] hover:bg-[var(--meta-mist)] focus:outline-none"
            style={{ borderColor: "var(--meta-steel)", borderRadius: 2 }}
          >
            <img
              src={coverImageUrl}
              alt=""
              className={cn("mx-auto w-full object-contain", imageMaxClass)}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
            <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs" style={{ color: "var(--fg-3)" }}>
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
    <div className="moffer">
      <div className="wrap">
        <MediaLightboxDialog state={mediaLightbox} onClose={() => setMediaLightbox(null)} />

        <div className="hero">
          <img src={metaLogoUrl} alt="" className="logo" width={180} height={56} />
          <span className="eyebrow">Angebot</span>
          <h1 className="num">{offer.offerNumber}</h1>
          {offer.customerName ? <p className="customer">{offer.customerName}</p> : null}
          <span className={`status ${statusClass(offer.status)}`}>{label}</span>
          {shareExpiresAt ? (
            <p className="expiry">
              Link gültig bis {format(new Date(shareExpiresAt), "PPp", { locale: de })}
            </p>
          ) : null}
        </div>

        {banner ? (
          <div className={`banner ${banner.type}`}>{banner.message}</div>
        ) : null}

        <div className="panel">
          <div className="panel-head">
            <span className="eyebrow">Übersicht</span>
            <h2>Angebotsdaten</h2>
          </div>
          <div className="panel-body">
            {offer.expirationDate ? (
              <div className="kv">
                <span className="k">Angebot gültig bis</span>
                <span className="v">{format(new Date(offer.expirationDate.slice(0, 10)), "PPP", { locale: de })}</span>
              </div>
            ) : null}
            {offer.createdAt ? (
              <div className="kv">
                <span className="k">Erstellt</span>
                <span className="v">{format(new Date(offer.createdAt), "PPP", { locale: de })}</span>
              </div>
            ) : null}
            {offer.salesChannelName ? (
              <div className="kv">
                <span className="k">Vertriebskanal</span>
                <span className="v">{offer.salesChannelName}</span>
              </div>
            ) : null}
            <div className="totals">
              <div className="row net">
                <span className="k">Netto</span>
                <span className="v">{formatMoney(offer.netAmount)}</span>
              </div>
              <div className="row gross">
                <span className="k">Brutto gesamt</span>
                <span className="v">{formatMoney(offer.totalAmount)}</span>
              </div>
            </div>
          </div>
        </div>

        {showPdfDownloads ? (
          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">Dokumente</span>
              <h2>PDF-Export</h2>
            </div>
            <div className="panel-body btn-row">
              <button
                type="button"
                className="btn"
                disabled={pdfLoading !== null}
                onClick={() => void downloadPdf("standard")}
              >
                {pdfLoading === "standard" ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                ) : (
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Angebots-PDF
              </button>
              <button
                type="button"
                className="btn"
                disabled={pdfLoading !== null}
                onClick={() => void downloadPdf("config")}
              >
                {pdfLoading === "config" ? (
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" aria-hidden />
                ) : (
                  <Download className="h-4 w-4 shrink-0" aria-hidden />
                )}
                Konfigurations-PDF
              </button>
            </div>
          </div>
        ) : null}

        {offer.roomPlan && offer.roomPlan.placements.length > 0 ? (
          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">Raumplanung</span>
              <h2>{offer.roomPlan.name?.trim() || "Ihr Raum"}</h2>
            </div>
            <div className="panel-body">
              <Suspense fallback={<div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: "var(--fg-3, #777)" }}>3D-Ansicht wird geladen…</div>}>
                <CpqRoomArViewer
                  room={{
                    lengthMm: offer.roomPlan.lengthMm,
                    widthMm: offer.roomPlan.widthMm,
                    heightMm: offer.roomPlan.heightMm,
                  }}
                  placements={offer.roomPlan.placements}
                  configurations={offer.roomPlan.configurations}
                  wallFeatures={offer.roomPlan.wallFeatures ?? []}
                />
              </Suspense>
            </div>
          </div>
        ) : null}

        <h2 className="section-title">Positionen</h2>
        {offer.lineItems.map((item) => {
          const open = expanded.has(item.id);
          const hasChildren = item.children && item.children.length > 0;
          const hasProductGlbKey = !!(item.productNumber && item.productNumber.trim());
          const showPresentationOnly = !hasProductGlbKey && !item.coverImageUrl;
          const showGlb = CPQ_3D_PREVIEW && (hasProductGlbKey || showPresentationOnly);
          const hasImg = !!(item.coverImageUrl && item.coverImageUrl.trim());
          const compactGlb = hasImg && showGlb;
          const isGroup = !!item.isConfigurationGroup;

          return (
            <div className="item" key={item.id}>
              <div
                className={`item-head ${hasChildren ? "clickable" : ""}`}
                onClick={hasChildren ? () => toggle(item.id) : undefined}
              >
                <div className="item-title-row">
                  {hasChildren ? (open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : null}
                  {isGroup ? <Layers className="h-4 w-4" /> : null}
                  <div className="item-title">
                    <span className="name">
                      {item.label}
                      {hasChildren ? (
                        <span className="badge">{item.children!.length} Teile</span>
                      ) : null}
                    </span>
                    {item.configurationName && !isGroup ? (
                      <p className="sub">{item.configurationName}</p>
                    ) : null}
                    {item.configurationDescription ? (
                      <p className="desc">{item.configurationDescription}</p>
                    ) : null}
                  </div>
                </div>
                <div className="item-price">
                  <p className="total">{formatMoney(item.totalPrice)}</p>
                  {!isGroup ? (
                    <p className="unit">
                      {item.quantity} × {formatMoney(item.unitPrice)}
                    </p>
                  ) : null}
                </div>
              </div>

              {item.cpqConfig ? (
                <div className="viewport-wrap">
                  <Suspense fallback={<div style={{ padding: 16, textAlign: "center", fontSize: 12.5, color: "var(--fg-3, #777)" }}>3D-Ansicht wird geladen…</div>}>
                    <CpqRegalArViewer cpqConfig={item.cpqConfig} compact={hasImg} />
                  </Suspense>
                </div>
              ) : null}

              {showGlb || hasImg ? (
                <div className="item-media">
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
                </div>
              ) : null}

              {hasChildren && open ? (
                <div className="bom">
                  <div className="bom-caption">Stückliste</div>
                  {item.children!.map((ch) => {
                    const chHasImg = !!(ch.coverImageUrl && ch.coverImageUrl.trim());
                    const chHasPrice = ch.unitPrice > 0 || ch.totalPrice > 0;

                    return (
                      <Fragment key={ch.id}>
                        <div className="bom-row">
                          <span className="label">
                            {ch.label}
                            {ch.productNumber ? <span className="pn"> · {ch.productNumber}</span> : null}
                          </span>
                          <span className="amt">
                            {ch.quantity}× {chHasPrice ? `${formatMoney(ch.unitPrice)} je` : ""}
                            {chHasPrice ? <span className="total">{formatMoney(ch.totalPrice)}</span> : null}
                          </span>
                        </div>
                        {chHasImg ? (
                          <div className="item-media">
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
                          </div>
                        ) : null}
                      </Fragment>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {showCustomerActions ? (
          <div className="panel decision">
            <div className="panel-head">
              <span className="eyebrow">Entscheidung</span>
              <h2>Wie möchten Sie fortfahren?</h2>
            </div>
            <div className="panel-body">
              <p>
                Sie können dieses Angebot direkt annehmen oder ablehnen. Bei Annahme wird der Status in unserem System aktualisiert.
              </p>
              <div className="btn-row">
                <button
                  type="button"
                  className="btn primary"
                  onClick={onAccept}
                  disabled={acceptLoading || declineLoading}
                >
                  {acceptLoading ? "Wird gesendet…" : "Angebot annehmen"}
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setShowDecline((v) => !v)}
                  disabled={acceptLoading || declineLoading}
                >
                  Ablehnen
                </button>
              </div>
              {showDecline ? (
                <div className="mt-3">
                  <input
                    type="text"
                    placeholder="Optional: Grund für die Ablehnung"
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn block"
                    style={{ borderColor: "#b3241a", color: "#b3241a" }}
                    disabled={declineLoading || acceptLoading}
                    onClick={() => onDecline?.(declineReason.trim() || undefined)}
                  >
                    {declineLoading ? "Wird gesendet…" : "Ablehnung bestätigen"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
