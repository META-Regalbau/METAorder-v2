/**
 * META CLIP configurator.
 *
 * The approved META-CLIP-Konfigurator-Web design, wired to the real CPQ engines:
 *   - options + priced bill-of-materials from the DB-backed `cpq` engine
 *     (GET /systems/:id/options, POST /systems/:id/bill-of-materials)
 *   - rule validation, A/B/C classification and effective Fachlasten from
 *     `cpq-core` (POST /api/cpq-core/validate)
 *   - checkout via cart transfer, plus save-as-offer draft.
 *
 * The six controls live in one UI state; src/lib/metaClipCpq.ts translates it to
 * both engine payloads. Prices/articles are always real Shopware data.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { ShopwareCustomerSearch, customerLabel, type ShopwareCustomer } from "@/components/ShopwareCustomerSearch";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

// Real 3D shelf (WebGL) — lazy so three.js only loads on this page.
// MetaClipRegalAssembly is the real, hand-measured assembly (frame + shelves +
// diagonal bracing, correct hole-raster placement), scaled to whatever
// width/depth/height is configured — see regalAssembly.ts for the scaling
// rationale. Exact/unscaled only at the reference size (1000×500mm,
// 2000/2500mm height); scaled elsewhere, but always the real assembly.
const MetaClipRegalAssembly = lazy(() => import("./metaClip/MetaClipRegalAssembly"));
import {
  DEFAULT_STATE,
  toConfigContext,
  toCpqCoreInput,
  CPQ_CORE_CONTEXT,
  buildConfigCode,
  overallLength,
  formatMoney,
  formatNumber,
  reconcileWithOptions,
  isRegalAssemblySupported,
  type MetaClipState,
  type MetaClipOptions,
  type Surface,
} from "@/lib/metaClipCpq";
import "./metaClip/metaClip.css";

// ---- copy deck (matches the design; the configurator keeps its own DE/EN toggle) ----
const L = {
  de: {
    crumb1: "Regalsysteme", crumb2: "Steckregale", viewLabel: "3D-Ansicht",
    eyebrow: "META CLIP · Steckregal", title: "Regal konfigurieren",
    subtitle: "Sechs Einstellungen. Preis und Stückliste aus dem Live-Katalog.",
    extras: "Zubehör (optional)", rearWall: "Rückwand", noteTitle: "Hinweis",
    priceLabel: "Preis netto", reset: "Zurücksetzen", summary: "Zusammenfassung",
    youSave: "Sie sparen", vsCatalog: "ggü. Katalogpreis", catalogPrice: "Katalogpreis",
    bom: "Stückliste", bomPos: "Position", bomArt: "Art.-Nr.", bomQty: "Stk.",
    bomUnit: "Einzel", bomSum: "Summe", bomTotal: "Summe netto, zzgl. Versand",
    configCodeLabel: "Konfigurations-Code:",
    customerPickerLabel: "Kunde (individuelle Preise)",
    customerPickerHint: "Optional – ohne Auswahl gilt der Katalogpreis.",
    cart: "In den Warenkorb", cartDone: "✓ In den Warenkorb gelegt",
    share: "Als Angebot speichern", shareDone: "✓ Angebot angelegt",
    shareToOffer: "Zum Angebot hinzufügen", shareDoneToOffer: "✓ Zum Angebot hinzugefügt",
    fields: "Anzahl Felder", height: "Höhe", width: "Feldbreite", depth: "Feldtiefe",
    shelves: "Fachböden je Feld", load: "Fachlast", zinc: "Verzinkt", coat: "Lackiert, RAL 7035",
    views: ["Perspektive", "Vorderansicht", "Draufsicht"],
    dim: ["Gesamtlänge", "Höhe", "Feldtiefe", "Felder"],
    sumRows: ["Ausführung", "Gesamtmaß L × H × T", "Felder × Fachböden", "Fachlast", "Gesamttragkraft", "Gewicht, ca."],
    fieldsNote: "Grundfeld + Anbaufelder, gemeinsame Rahmen.",
    shelvesNote: "Einhängbar im 25-mm-Raster.",
    availA: "Auf Lager · Versand in 2–4 Werktagen",
    availB: "Fertigung nach Auftrag · 10–14 Werktage",
    availC: "Sonderausführung · Prüfung erforderlich",
    reviewBlocked: "Prüfung erforderlich",
    pcs: "Felder", pcsShelf: "Böden",
    modeSlider: "Regler", modeChips: "Auswahl", mm: "mm", kg: "kg",
    loadingPrice: "…", emptySystem: "Kein META CLIP System gefunden. Bitte im CPQ-Admin anlegen.",
    bomError: "Konfiguration nicht lieferbar",
    loggedInAs: "Angemeldet als", guestNote: "Sie sind nicht angemeldet — es gilt der Katalogpreis. Melden Sie sich im Shop an, um Ihren individuellen Preis zu sehen und ein Angebot anzufragen.",
    cartComingSoon: "Die Übergabe in den Warenkorb wird in Kürze freigeschaltet.",
    requestOffer: "Angebot anfragen", requestOfferDone: "✓ Angebot angefragt",
  },
  en: {
    crumb1: "Shelving systems", crumb2: "Boltless shelving", viewLabel: "3D view",
    eyebrow: "META CLIP · Boltless shelving", title: "Configure shelving",
    subtitle: "Six settings. Price and bill of materials from the live catalogue.",
    extras: "Accessories (optional)", rearWall: "Rear panel", noteTitle: "Note",
    priceLabel: "Price, net", reset: "Reset", summary: "Summary",
    youSave: "You save", vsCatalog: "vs. catalogue price", catalogPrice: "Catalogue price",
    bom: "Bill of materials", bomPos: "Item", bomArt: "Part no.", bomQty: "Qty",
    bomUnit: "Unit", bomSum: "Total", bomTotal: "Net total, excl. shipping",
    configCodeLabel: "Configuration code:",
    customerPickerLabel: "Customer (individual pricing)",
    customerPickerHint: "Optional – catalogue price applies if none is selected.",
    cart: "Add to cart", cartDone: "✓ Added to cart",
    share: "Save as offer", shareDone: "✓ Offer created",
    shareToOffer: "Add to offer", shareDoneToOffer: "✓ Added to offer",
    fields: "Number of bays", height: "Height", width: "Bay width", depth: "Bay depth",
    shelves: "Shelves per bay", load: "Shelf load", zinc: "Galvanised", coat: "Coated, RAL 7035",
    views: ["Perspective", "Front view", "Top view"],
    dim: ["Overall length", "Height", "Bay depth", "Bays"],
    sumRows: ["Finish", "Overall L × H × D", "Bays × shelves", "Shelf load", "Total capacity", "Weight, approx."],
    fieldsNote: "Starter bay plus add-on bays, shared frames.",
    shelvesNote: "Clipped in on a 25 mm pitch.",
    availA: "In stock · ships in 2–4 working days",
    availB: "Made to order · 10–14 working days",
    availC: "Special build · review required",
    reviewBlocked: "Review required",
    pcs: "bays", pcsShelf: "shelves",
    modeSlider: "Sliders", modeChips: "Chips", mm: "mm", kg: "kg",
    loadingPrice: "…", emptySystem: "No META CLIP system found. Please create it in the CPQ admin.",
    bomError: "Configuration not available",
    loggedInAs: "Signed in as", guestNote: "You're not signed in — catalogue pricing applies. Sign in on the shop to see your individual price and request an offer.",
    cartComingSoon: "Adding this to your cart will be available soon.",
    requestOffer: "Request offer", requestOfferDone: "✓ Offer requested",
  },
} as const;

type Lang = keyof typeof L;

/**
 * Öffentlicher Shop-Modus (siehe PublicCpqConfiguratorPage.tsx): kein
 * Mitarbeiter-Login, die Kundenidentität kommt aus einem serverseitig
 * verifizierten Handoff-Token statt aus der internen Kundensuche.
 */
export type CpqCustomerMode = {
  handoffToken: string;
  customerId: string | null;
  customerName: string | null;
  isPortalCustomer: boolean;
};

// ---- server response shapes ----
type CpqSystem = { id: string; name: string; slug?: string; status?: string };
type BomLineItem = {
  productId: string; productNumber: string; manufacturerNumber?: string; name: string;
  quantity: number; unitPrice: number; lineTotal: number; componentType?: string;
  catalogUnitPrice?: number; discountPercent?: number;
};
type BomResult = { items: BomLineItem[]; totalPrice: number; totalCatalogPrice?: number; errors: string[]; warnings: string[] };
type CoreDecision = {
  valid: boolean;
  classification: "A" | "B" | "C";
  errors: Array<{ messageDe?: string; message?: string } | string>;
  disclaimers: string[];
  computed?: { effectiveFachlasten?: Array<{ effectiveKg: number; nominalKg: number; reducedByFieldLimit: boolean }> };
};

// ---- 3D-slot schematic (line drawing, reflects the configuration) ----
function schematic(s: MetaClipState): string {
  const W = 1000, H = 620, pad = 70;
  const bays = s.felder, shelves = s.boeden;
  const stroke = "var(--meta-graphite)", thin = "var(--meta-steel)", accent = "var(--meta-red)";
  const parts: string[] = [];
  const rect = (x: number, y: number, w: number, h: number, sw: number, col: string, fill = "none") =>
    `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="${fill}" stroke="${col}" stroke-width="${sw}"/>`;
  const line = (x1: number, y1: number, x2: number, y2: number, sw: number, col: string) =>
    `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${col}" stroke-width="${sw}"/>`;
  const totalLen = bays * s.breite + (bays + 1) * 40;

  if (s.view === 2) {
    const availW = W - pad * 2, availH = H - pad * 2;
    const scale = Math.min(availW / totalLen, availH / s.tiefe);
    const dw = s.tiefe * scale, cw = s.breite * scale, post = 40 * scale, totW = totalLen * scale;
    const ox = (W - totW) / 2, oy = (H - dw) / 2;
    parts.push(rect(ox, oy, totW, dw, 2, stroke));
    let x = ox;
    for (let i = 0; i < bays; i++) { x += post; parts.push(rect(x, oy, cw, dw, 1.4, thin)); x += cw; }
    let px = ox;
    for (let p = 0; p <= bays; p++) { parts.push(rect(px, oy, post, dw, 2, stroke, "var(--meta-chrome)")); if (p < bays) px += post + cw; }
  } else {
    const availWf = W - pad * 2, availHf = H - pad * 2;
    const persp = s.view === 0;
    const dx = persp ? 60 : 0, dy = persp ? -34 : 0;
    const scaleF = Math.min((availWf - Math.abs(dx)) / totalLen, (availHf - Math.abs(dy)) / s.hoehe);
    const cwF = s.breite * scaleF, postF = 40 * scaleF, hF = s.hoehe * scaleF, totWf = totalLen * scaleF;
    const oxF = (W - totWf - dx) / 2, oyF = (H - hF - Math.abs(dy)) / 2 + (persp ? -dy : 0);
    const top = oyF, bot = oyF + hF;
    if (persp) {
      const bx = oxF + dx, byTop = top + dy, byBot = bot + dy;
      parts.push(rect(bx, byTop, totWf, hF, 1.2, thin));
      parts.push(line(oxF, top, bx, byTop, 1, thin));
      parts.push(line(oxF + totWf, top, bx + totWf, byTop, 1, thin));
      parts.push(line(oxF + totWf, bot, bx + totWf, byBot, 1, thin));
    }
    let ux = oxF;
    for (let u = 0; u <= bays; u++) {
      parts.push(rect(ux, top, postF, hF, 2, stroke, "var(--meta-chrome)"));
      if (persp) parts.push(line(ux + postF, top, ux + postF + dx, top + dy, 0.8, thin));
      if (u < bays) ux += postF + cwF;
    }
    let sx = oxF;
    for (let b = 0; b < bays; b++) {
      sx += postF;
      for (let sh = 0; sh < shelves; sh++) {
        const sy = top + hF * (sh + 1) / (shelves + 1);
        const swk = s.last >= 330 ? 3 : s.last >= 230 ? 2.2 : 1.6;
        parts.push(line(sx, sy, sx + cwF, sy, swk, stroke));
        if (persp) {
          parts.push(line(sx, sy, sx + dx, sy + dy, 0.8, thin));
          parts.push(line(sx + cwF, sy, sx + cwF + dx, sy + dy, 0.8, thin));
          parts.push(line(sx + dx, sy + dy, sx + cwF + dx, sy + dy, 1, thin));
        }
      }
      sx += cwF;
    }
    parts.push(line(oxF - 8, bot, oxF + totWf + 8, bot, 2, accent));
  }
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${parts.join("")}</svg>`;
}

export default function CPQConfiguratorPage({ customerMode }: { customerMode?: CpqCustomerMode } = {}) {
  const { i18n } = useTranslation();
  const { toast } = useToast();
  const [state, setState] = useState<MetaClipState>({
    ...DEFAULT_STATE,
    lang: i18n.language?.startsWith("en") ? "en" : "de",
  });
  const [added, setAdded] = useState(false);
  const [shared, setShared] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<ShopwareCustomer | null>(null);
  const reconciled = useRef(false);

  // Optionaler Zielangebot-Modus: /configurator?offerId=... hängt die Konfiguration als
  // neue Konfigurationsgruppe an ein bereits bestehendes Angebot an, statt ein neues anzulegen.
  // Nur im internen Mitarbeiter-Modus relevant — im öffentlichen Shop-Modus gibt es kein offerId.
  const targetOfferId = useMemo(
    () => (customerMode ? null : new URLSearchParams(window.location.search).get("offerId")),
    [customerMode],
  );

  // Im öffentlichen Shop-Modus (customerMode) laufen alle CPQ-Requests über die /public/*-Routen
  // mit dem verifizierten Handoff-Token statt über Mitarbeiter-Session + interne Kundensuche.
  const cpqBase = customerMode ? "/api/cpq/public" : "/api/cpq";
  const cpqCoreValidatePath = customerMode ? "/api/cpq-core/public/validate" : "/api/cpq-core/validate";
  const withToken = (url: string) =>
    customerMode ? `${url}${url.includes("?") ? "&" : "?"}cpqToken=${encodeURIComponent(customerMode.handoffToken)}` : url;
  const bodyWithToken = <T extends object>(body: T): T & { cpqToken?: string } =>
    customerMode ? { ...body, cpqToken: customerMode.handoffToken } : body;
  const effectiveCustomerId = customerMode ? customerMode.customerId ?? undefined : selectedCustomer?.id;

  const lang = state.lang as Lang;
  const t = L[lang];
  const patch = (p: Partial<MetaClipState>) => { setAdded(false); setState((s) => ({ ...s, ...p })); };

  // 1) system
  const { data: systems = [], isLoading: systemsLoading } = useQuery<CpqSystem[]>({
    queryKey: [`${cpqBase}/systems`, customerMode?.handoffToken ?? null],
    queryFn: async () => {
      const res = await apiRequest("GET", withToken(`${cpqBase}/systems`));
      return res.json() as Promise<CpqSystem[]>;
    },
  });
  const system = useMemo(
    () => systems.find((x) => x.slug === "meta-clip") ?? systems.find((x) => /clip/i.test(x.name)) ?? systems[0],
    [systems],
  );
  const systemId = system?.id;

  // 2) options (server-driven, catalogue-derived)
  const { data: options } = useQuery<MetaClipOptions>({
    queryKey: [`${cpqBase}/systems/${systemId}/options`, "opts"],
    enabled: !!systemId,
    queryFn: async () => {
      const res = await apiRequest("GET", withToken(`${cpqBase}/systems/${systemId}/options?step=2&config=%7B%7D`));
      const json = await res.json();
      return json.availableOptions as MetaClipOptions;
    },
  });
  useEffect(() => {
    if (options && !reconciled.current) { reconciled.current = true; setState((s) => reconcileWithOptions(s, options)); }
  }, [options]);

  // Slider/Stepper feuern bei jedem Schritt eine State-Änderung — die BOM- und
  // Regel-Validierungs-Requests (teuer: Shopware-Preise, Rule-Engine) werden über den
  // debounced State entkoppelt, damit schnelle Eingaben nicht pro Schritt einen Request auslösen.
  const debouncedState = useDebouncedValue(state, 300);
  const config = useMemo(() => toConfigContext(debouncedState), [debouncedState]);
  const coreInput = useMemo(() => toCpqCoreInput(debouncedState), [debouncedState]);
  // Nur als Suspense-Fallback gebraucht (fast nie sichtbar, da die 3D-Komponente längst
  // geladen ist) — trotzdem memoized, damit der SVG-String nicht bei jedem Render neu gebaut wird.
  const schematicSvg = useMemo(() => schematic(state), [state]);

  // 3) priced BOM (cpq)
  const { data: bom, isFetching: bomFetching } = useQuery<BomResult>({
    queryKey: [`${cpqBase}/systems/${systemId}/bill-of-materials`, JSON.stringify(config), effectiveCustomerId ?? null],
    enabled: !!systemId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await apiRequest(
        "POST",
        `${cpqBase}/systems/${systemId}/bill-of-materials`,
        bodyWithToken({ config, customerId: effectiveCustomerId }),
      );
      return res.json() as Promise<BomResult>;
    },
  });

  // 4) rules / classification / effective loads (cpq-core)
  const { data: core } = useQuery<CoreDecision>({
    queryKey: [cpqCoreValidatePath, systemId, JSON.stringify(coreInput)],
    enabled: !!systemId,
    placeholderData: (prev) => prev,
    queryFn: async () => {
      const res = await apiRequest(
        "POST",
        cpqCoreValidatePath,
        bodyWithToken({ systemId, context: CPQ_CORE_CONTEXT, configuration: coreInput }),
      );
      return res.json() as Promise<CoreDecision>;
    },
  });

  // ---- mutations (CTAs) ----
  const cartMut = useMutation({
    mutationFn: async () => {
      const cart_items = (bom?.items ?? []).map((i) => ({ product_id: i.productId, product_number: i.productNumber, quantity: i.quantity }));
      const res = await apiRequest("POST", "/api/cpq/cart/transfer", { cart_items, create_offer: false });
      return res.json();
    },
    onSuccess: () => { setAdded(true); toast({ title: t.cartDone }); setTimeout(() => setAdded(false), 2500); },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });
  const offerMut = useMutation({
    mutationFn: async () => {
      // Best-effort: a PDF without the image is still useful, so a capture
      // failure (e.g. WebGL context lost) must not block saving the offer.
      let previewImageBase64: string | null = null;
      try {
        const { captureRegalCompositeImage } = await import("./metaClip/captureRegalImage");
        previewImageBase64 = await captureRegalCompositeImage(state);
      } catch (e) {
        console.warn("[CPQ] Regal-Vorschaubild konnte nicht erzeugt werden:", e);
      }
      const billOfMaterials = {
        items: (bom?.items ?? []).map((i) => ({
          productId: i.productId, productNumber: i.productNumber, name: i.name,
          quantity: i.quantity, unitPrice: i.unitPrice, lineTotal: i.lineTotal, componentType: i.componentType,
          catalogUnitPrice: i.catalogUnitPrice, discountPercent: i.discountPercent,
        })),
        totalPrice: bom?.totalPrice ?? 0,
        totalCatalogPrice: bom?.totalCatalogPrice,
      };

      const res = customerMode
        ? await apiRequest(
            "POST",
            "/api/cpq/public/offer-request",
            bodyWithToken({ systemId, systemName: system?.name ?? "META CLIP", config, previewImageBase64, billOfMaterials }),
          )
        : targetOfferId
          ? await apiRequest("POST", `/api/offers/${targetOfferId}/cpq-configuration`, {
              systemId, systemName: system?.name ?? "META CLIP",
              config,
              previewImageBase64,
              billOfMaterials,
            })
          : await apiRequest("POST", "/api/offer-drafts/from-cpq", {
              systemId, systemName: system?.name ?? "META CLIP",
              config,
              previewImageBase64,
              customerId: selectedCustomer?.id,
              billOfMaterials,
            });
      return res.json();
    },
    onSuccess: () => {
      setShared(true);
      toast({ title: targetOfferId ? t.shareDoneToOffer : t.shareDone });
      setTimeout(() => setShared(false), 2500);
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  // ---- derived display ----
  const coated = state.surface === "lackiert";
  const laenge = overallLength(state);
  const nominalCapacity = state.felder * state.boeden * state.last;
  const weight = (state.felder + 1) * (state.hoehe / 1000) * 9.5
    + state.felder * state.boeden * ((state.breite * state.tiefe) / 1e6) * 11
    + (state.rear ? state.felder * 12 : 0);
  const configCode = buildConfigCode(state);

  const classification = core?.classification ?? "A";
  const coreValid = core?.valid ?? true;
  const blocked = classification === "C" || !coreValid;
  const bomErrors = bom?.errors ?? [];
  const coreErrorMsgs = (core?.errors ?? []).map((e) => (typeof e === "string" ? e : e.messageDe ?? e.message ?? "")).filter(Boolean);
  const disclaimer = coreErrorMsgs[0] ?? bomErrors[0] ?? core?.disclaimers?.[0] ?? null;
  const disclaimerIsError = coreErrorMsgs.length > 0 || bomErrors.length > 0;

  const availText = classification === "C" ? t.availC : classification === "B" ? t.availB : t.availA;
  const availDot = classification === "C" ? "var(--meta-red)" : classification === "B" ? "#c98a00" : "#1e8e47";

  const price = bom?.totalPrice ?? 0;
  const catalogPrice = bom?.totalCatalogPrice ?? 0;
  const saveAmount = catalogPrice > price ? catalogPrice - price : 0;
  const savePercent = catalogPrice > 0 && saveAmount > 0 ? Math.round((saveAmount / catalogPrice) * 1000) / 10 : 0;
  const rearItem = (bom?.items ?? []).find((i) => /rückwand|rear/i.test(i.componentType ?? ""));

  const options0: MetaClipOptions = options ?? {
    heights: [state.hoehe], depths: [state.tiefe], widths: [state.breite],
    field_counts: [], level_counts: [], loads: [state.last], surfaces: ["verzinkt"],
  };
  const surfaces = options0.surfaces?.length ? options0.surfaces : ["verzinkt"];

  // ---- render helpers ----
  const money = (n: number) => formatMoney(n, lang);
  const nf = (n: number, d = 0) => formatNumber(n, lang, d);

  type OptControl = { key: "hoehe" | "breite" | "tiefe" | "last"; label: string; opts: number[]; unit: string; fmt: (v: number) => string };
  const optControls: OptControl[] = [
    { key: "hoehe", label: t.height, opts: options0.heights, unit: t.mm, fmt: (v) => nf(v) },
    { key: "breite", label: t.width, opts: options0.widths, unit: t.mm, fmt: (v) => nf(v) },
    { key: "tiefe", label: t.depth, opts: options0.depths, unit: t.mm, fmt: (v) => String(v) },
    { key: "last", label: t.load, opts: options0.loads, unit: t.kg, fmt: (v) => String(v) },
  ];

  const chip = (on: boolean, label: string, onClick: () => void, disabled = false, key?: string | number) => (
    <button key={key} type="button" className={on ? "on" : ""} disabled={disabled} onClick={onClick}>{label}</button>
  );

  if (systemsLoading) return <div className="mclip"><div className="cfg" style={{ padding: 48, color: "var(--fg-3)" }}>…</div></div>;
  if (!systemId) return <div className="mclip"><div className="cfg" style={{ padding: 48, color: "var(--fg-2)" }}>{t.emptySystem}</div></div>;

  return (
    <div className="mclip">
      <div className="cfg" role="application" aria-label="META CLIP Konfigurator">
        {/* header */}
        <div className="cfg-head">
          <img src="/img/meta-logo-red.png" alt="META" />
          <div className="head-div" />
          <div className="crumbs"><span>{t.crumb1}</span><span>›</span><span>{t.crumb2}</span><span>›</span><span className="now">META CLIP</span></div>
          <div style={{ flex: 1 }} />
          <div className="seg" role="group" aria-label={t.viewLabel}>
            <button type="button" className={state.mode === "slider" ? "on" : ""} onClick={() => setState((s) => ({ ...s, mode: "slider" }))}>{t.modeSlider}</button>
            <button type="button" className={state.mode === "chips" ? "on" : ""} onClick={() => setState((s) => ({ ...s, mode: "chips" }))}>{t.modeChips}</button>
          </div>
          <div className="lang-toggle">
            <button type="button" style={{ color: lang === "de" ? "var(--meta-red)" : "var(--fg-3)" }} onClick={() => setState((s) => ({ ...s, lang: "de" }))}>DE</button>
            <button type="button" style={{ color: lang === "en" ? "var(--meta-red)" : "var(--fg-3)" }} onClick={() => setState((s) => ({ ...s, lang: "en" }))}>EN</button>
          </div>
        </div>

        <div className="cfg-main">
          {/* stage */}
          <div className="stage">
            <div className="stage-top">
              <span className="view-label">{t.viewLabel}</span>
              <div style={{ flex: 1 }} />
              <div className="view-opts">
                {t.views.map((label, i) => chip(state.view === i, label, () => setState((s) => ({ ...s, view: i })), false, i))}
              </div>
            </div>
            <div className="viewport">
              <Suspense fallback={<div dangerouslySetInnerHTML={{ __html: schematicSvg }} />}>
                <MetaClipRegalAssembly state={state} />
              </Suspense>
              <div className="view-caption">{t.views[state.view]} · {nf(laenge)} × {nf(state.hoehe)} × {state.tiefe} {t.mm}</div>
              <div className="view-hint">{isRegalAssemblySupported(state) ? "3D · echter Aufbau" : "3D · echter Aufbau (skaliert)"}</div>
            </div>
            <div className="dims">
              {[[t.dim[0], `${nf(laenge)} ${t.mm}`], [t.dim[1], `${nf(state.hoehe)} ${t.mm}`], [t.dim[2], `${state.tiefe} ${t.mm}`], [t.dim[3], String(state.felder)]].map(([k, v], i) => (
                <div className="cell" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
          </div>

          {/* panel */}
          <div className="panel">
            <div className="panel-head">
              <span className="eyebrow">{t.eyebrow}</span>
              <span className="panel-title">{t.title}</span>
              <span className="panel-sub">{t.subtitle}</span>
            </div>
            <div className="rule" />

            {customerMode ? (
              <div className="control">
                <div className="control-head">
                  <span className="control-label">{customerMode.customerId ? t.loggedInAs : t.customerPickerLabel}</span>
                </div>
                {customerMode.customerId ? (
                  <span className="control-note">{customerMode.customerName || customerMode.customerId}</span>
                ) : (
                  <span className="control-note">{t.guestNote}</span>
                )}
              </div>
            ) : (
              <div className="control">
                <div className="control-head">
                  <span className="control-label">{t.customerPickerLabel}</span>
                </div>
                <ShopwareCustomerSearch
                  value={selectedCustomer}
                  onChange={setSelectedCustomer}
                  endpoint="/api/cpq/customer-search"
                  placeholder={t.customerPickerLabel}
                />
                <span className="control-note">{t.customerPickerHint}</span>
              </div>
            )}

            <div className="rule" />

            <div className="controls">
              <Stepper label={t.fields} value={state.felder} min={1} max={8} unit={t.pcs} note={t.fieldsNote}
                onDec={() => patch({ felder: Math.max(1, state.felder - 1) })} onInc={() => patch({ felder: Math.min(8, state.felder + 1) })} />

              {optControls.map((c) => {
                const cur = state[c.key];
                const idx = Math.max(0, c.opts.indexOf(cur));
                return (
                  <div className="control" key={c.key}>
                    <div className="control-head">
                      <span className="control-label">{c.label}</span>
                      <span className="control-value">{c.fmt(cur)} {c.unit}</span>
                    </div>
                    {state.mode === "chips" ? (
                      <div className="chips">
                        {c.opts.map((v) => chip(v === cur, c.fmt(v), () => patch({ [c.key]: v } as Partial<MetaClipState>), false, v))}
                      </div>
                    ) : (
                      <div className="slider">
                        <input type="range" min={0} max={Math.max(0, c.opts.length - 1)} step={1} value={idx}
                          aria-label={c.label}
                          onChange={(e) => patch({ [c.key]: c.opts[Number(e.target.value)] } as Partial<MetaClipState>)} />
                        <div className="ticks">{c.opts.map((v) => <span key={v} className={`tick ${v === cur ? "on" : ""}`}>{c.fmt(v)}</span>)}</div>
                      </div>
                    )}
                  </div>
                );
              })}

              <Stepper label={t.shelves} value={state.boeden} min={1} max={8} unit={t.pcsShelf} note={t.shelvesNote}
                onDec={() => patch({ boeden: Math.max(1, state.boeden - 1) })} onInc={() => patch({ boeden: Math.min(8, state.boeden + 1) })} />
            </div>

            <div className="rule" />

            {/* extras */}
            <div className="extras">
              <span className="extras-label">{t.extras}</span>
              <div className="surface">
                {surfaces.map((sf) => chip(state.surface === sf, sf === "lackiert" ? t.coat : t.zinc, () => patch({ surface: sf as Surface }), false, sf))}
              </div>
              <button type="button" className="rear" aria-pressed={state.rear} onClick={() => patch({ rear: !state.rear })}>
                <span className="name">{t.rearWall}</span>
                <span className="meta">
                  {state.rear && rearItem ? <span className="price">+ {money(rearItem.lineTotal)}</span> : null}
                  <span className={`box ${state.rear ? "on" : ""}`}>{state.rear ? "✓" : ""}</span>
                </span>
              </button>
            </div>

            {disclaimer && (
              <div className={`alert ${disclaimerIsError ? "error" : ""}`} role="note">
                <div className="title">{disclaimerIsError ? t.bomError : t.noteTitle}</div>
                <div className="body">{disclaimer}</div>
              </div>
            )}

            <div className="spring" />

            {/* checkout */}
            <div className="checkout">
              <div className="price-row">
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span className="price-label">{t.priceLabel}</span>
                  <span className={`price-net ${bomFetching && !bom ? "loading" : ""}`}>
                    {bomErrors.length ? "—" : bom ? money(price) : t.loadingPrice}
                  </span>
                  {!bomErrors.length && saveAmount > 0 && (
                    <span style={{ fontSize: 12, color: "#1e8e47" }}>
                      {t.youSave} {money(saveAmount)} ({savePercent}%) {t.vsCatalog}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                  <span className="price-gross">{bom && !bomErrors.length ? `${money(price * 1.19)}${lang === "de" ? " inkl. MwSt." : " incl. VAT"}` : ""}</span>
                  <span className={`badge-class ${classification === "C" ? "c" : ""}`} title={`Klasse ${classification}`}>{classification}</span>
                </div>
              </div>
              <div className="avail">
                <span className="dot" style={{ background: availDot }} />
                <span className="txt">{availText}</span>
              </div>
              {customerMode ? (
                <div className="control-note" style={{ textAlign: "center", padding: "10px 0" }}>{t.cartComingSoon}</div>
              ) : (
                <button type="button" className="btn btn-lg btn-primary"
                  disabled={blocked || bomFetching || !!bomErrors.length || !bom?.items?.length || cartMut.isPending}
                  onClick={() => cartMut.mutate()}>
                  {blocked ? t.reviewBlocked : added ? t.cartDone : t.cart}
                </button>
              )}
              <div className="btn-actions">
                {!customerMode && (
                  <button type="button" className="btn btn-md btn-secondary"
                    disabled={!bom?.items?.length || !!bomErrors.length || offerMut.isPending}
                    onClick={() => offerMut.mutate()}>
                    {shared ? (targetOfferId ? t.shareDoneToOffer : t.shareDone) : (targetOfferId ? t.shareToOffer : t.share)}
                  </button>
                )}
                {customerMode?.customerId && (
                  <button type="button" className="btn btn-md btn-secondary"
                    disabled={blocked || !bom?.items?.length || !!bomErrors.length || offerMut.isPending}
                    onClick={() => offerMut.mutate()}>
                    {shared ? t.requestOfferDone : t.requestOffer}
                  </button>
                )}
                <button type="button" className="btn btn-md btn-tertiary"
                  onClick={() => { reconciled.current = false; setState((s) => reconcileWithOptions({ ...DEFAULT_STATE, lang: s.lang, mode: s.mode }, options0)); }}>
                  {t.reset}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* footer: summary + BOM */}
        <div className="cfg-foot">
          <div className="summary">
            <span className="sec-label">{t.summary}</span>
            <div className="sum-rows">
              {[
                [t.sumRows[0], `META CLIP · ${coated ? t.coat : t.zinc}${state.rear ? " · " + t.rearWall : ""}`],
                [t.sumRows[1], `${nf(laenge)} × ${nf(state.hoehe)} × ${state.tiefe} ${t.mm}`],
                [t.sumRows[2], `${state.felder} × ${state.boeden}`],
                [t.sumRows[3], `${state.last} ${t.kg}`],
                [t.sumRows[4], `${nf(nominalCapacity)} ${t.kg}`],
                [t.sumRows[5], `${nf(weight, 0)} ${t.kg}`],
              ].map(([k, v], i) => (
                <div className="sum-row" key={i}><span className="k">{k}</span><span className="v">{v}</span></div>
              ))}
            </div>
            <span className="config-code">{t.configCodeLabel} <code>{configCode}</code></span>
          </div>

          <div className="bom">
            <span className="sec-label">{t.bom}</span>
            <div className="bom-grid bom-head">
              <span>{t.bomPos}</span><span>{t.bomArt}</span>
              <span className="num">{t.bomQty}</span><span className="num">{t.bomUnit}</span><span className="num">{t.bomSum}</span>
            </div>
            {(bom?.items ?? []).map((b, i) => (
              <div className="bom-grid bom-row" key={i}>
                <span>{b.name}</span>
                <span className="bom-art" title={b.manufacturerNumber ?? b.productNumber}>{b.manufacturerNumber ?? b.productNumber}</span>
                <span className="num">{b.quantity}</span>
                <span className="num muted">
                  {b.discountPercent && b.discountPercent > 0 && b.catalogUnitPrice != null ? (
                    <>
                      <span style={{ textDecoration: "line-through", opacity: 0.55, marginRight: 4 }}>
                        {money(b.catalogUnitPrice)}
                      </span>
                      {money(b.unitPrice)}
                    </>
                  ) : (
                    money(b.unitPrice)
                  )}
                </span>
                <span className="num bold">{money(b.lineTotal)}</span>
              </div>
            ))}
            {!bom?.items?.length && !bomErrors.length && <div className="control-note">…</div>}
            {bomErrors.map((e, i) => <div className="control-note" key={i} style={{ color: "var(--meta-red)" }}>{e}</div>)}
            <div className="bom-total">
              <span className="k">{t.bomTotal}</span>
              <span className="v">{bom && !bomErrors.length ? money(price) : "—"}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- stepper sub-component ----
function Stepper(props: { label: string; value: number; min: number; max: number; unit: string; note?: string; onDec: () => void; onInc: () => void }) {
  const { label, value, min, max, unit, note, onDec, onInc } = props;
  return (
    <div className="control">
      <div className="control-head"><span className="control-label">{label}</span></div>
      <div className="stepper">
        <button type="button" className="dec" disabled={value <= min} onClick={onDec} aria-label="−">–</button>
        <div className="val"><span>{value}</span><span className="unit">{unit}</span></div>
        <button type="button" className="inc" disabled={value >= max} onClick={onInc} aria-label="+">+</button>
      </div>
      {note && <span className="control-note">{note}</span>}
    </div>
  );
}
