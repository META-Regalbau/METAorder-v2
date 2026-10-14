// ALT- und TITLE-Texte fuer Produktbilder im Shop (SEO, Barrierefreiheit).
// ALT = Produktname + Ansicht aus dem Dateinamen ("… – Ansicht in Blickhöhe"), TITLE = Produktname.
// Geschrieben wird nur in der Systemsprache (Deutsch); andere Sprachen greifen darauf zurueck.
//
// Von Hand gepflegte Texte bleiben stehen: ueberschrieben wird ein Feld nur, wenn es leer ist,
// (TITLE) noch den Dateinamen traegt, den Shopware beim Hochladen einsetzt, oder noch genau den
// Text enthaelt, den dieses Modul zuletzt geschrieben hat (Markierung im Zusatzfeld am Bild).
import { z } from "zod";
import type { MediaTexts, MediaTextsUpdate, ProductImageLink, ProductImageProduct } from "../shopware/client/media";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "products/productImageTexts" });

export const PRODUCT_IMAGE_TEXTS_SETTINGS_KEY = "product_image_texts_settings";
export const PRODUCT_IMAGE_TEXTS_STATE_KEY = "product_image_texts_state";
/** Zusatzfeld am Bild: zuletzt automatisch geschriebene Texte. */
export const PRODUCT_IMAGE_TEXTS_MARKER = "metaorder_image_texts";

const TITLE_MAX = 255;
const EXAMPLE_COUNT = 12;

// ---------------------------------------------------------------------------------------------
// Texte bilden

/** Ansicht aus dem Dateinamen; die erste passende Regel gewinnt. */
const VIEW_RULES: Array<[RegExp, string]> = [
  [/explo/, "Explosionszeichnung"],
  [/eingebaut/, "im eingebauten Zustand"],
  [/(^|[^a-z])mu([^a-z]|$)/, "Anwendungsbeispiel"],
  [/inhalt|bestueckt|gefuellt/, "mit Beispielbefüllung"],
  [/blickh/, "Ansicht in Blickhöhe"],
  [/seitlich/, "Seitenansicht"],
  [/aufsicht/, "Ansicht von oben"],
  [/frosch/, "Ansicht von unten"],
  [/hinten/, "Rückansicht"],
  [/detail|einzel/, "Detailansicht"],
  [/fachlasttabelle/, "Fachlasttabelle"],
  [/uebersicht/, "Übersicht"],
  [/foto/, "Produktfoto"],
];

function foldUmlauts(value: string): string {
  return value
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/** Dateiname ohne EAN_Nummer-Praefix und ohne Shopware-Hash (".1a2b3c4d"). */
function viewPartOfFileName(fileName: string): string {
  const withoutHash = fileName.replace(/\.[0-9a-f]{8}$/i, "");
  const prefixed = withoutHash.match(/^\d{6,}_\d+[-_ ]+(.*)$/);
  return foldUmlauts(prefixed ? prefixed[1] : withoutHash);
}

export function viewLabelFromFileName(fileName: string): string | null {
  const part = viewPartOfFileName(fileName);
  for (const [pattern, label] of VIEW_RULES) {
    if (pattern.test(part)) return label;
  }
  return null;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Name fuer Vorlesen und Suchmaschinen: " | " wird zu ", ". */
export function readableProductName(name: string): string {
  return collapseWhitespace(name.replace(/\s*\|\s*/g, ", ")).replace(/^,\s*|,\s*$/g, "");
}

/**
 * Name fuer ein Bild an mehreren Artikeln: gemeinsame Namensteile (z. B. "META CLIP |
 * Schubladen-Trennblech | verzinkt"), sonst der kuerzeste Name im neuen Schema.
 */
export function sharedProductName(names: string[]): string {
  const unique = [...new Set(names.map(collapseWhitespace).filter(Boolean))];
  if (unique.length <= 1) return unique[0] ?? "";
  const segmented = unique.filter((n) => n.includes("|"));
  const pool = segmented.length > 0 ? segmented : unique;
  if (pool.length === 1) return pool[0];
  const segments = pool.map((n) => n.split("|").map((s) => s.trim()).filter(Boolean));
  const common = segments[0].filter((s) => segments.every((list) => list.includes(s)));
  if (common.length >= 2) return common.join(" | ");
  return [...pool].sort((a, b) => a.length - b.length || a.localeCompare(b))[0];
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s,|–-]+$/, "")}…`;
}

export function buildImageTexts(productName: string, fileName: string): { alt: string; title: string } {
  const name = collapseWhitespace(productName);
  const label = viewLabelFromFileName(fileName);
  const readable = readableProductName(name);
  return {
    alt: label ? `${readable} – ${label}` : readable,
    title: truncateAtWord(name, TITLE_MAX),
  };
}

// ---------------------------------------------------------------------------------------------
// Entscheiden, was geschrieben wird

/** Shopware setzt beim Hochladen den Dateinamen als TITLE (Umlaute im Dateinamen entfernt). */
export function looksLikeFileName(value: string, fileName: string): boolean {
  const norm = (v: string) =>
    v
      .trim()
      .replace(/\.(png|jpe?g|webp|gif|svg|avif|tiff?)$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const a = norm(value);
  return a.length > 0 && a === norm(fileName);
}

type Marker = { alt?: string; title?: string };

function readMarker(media: MediaTexts): Marker {
  const raw = media.customFields?.[PRODUCT_IMAGE_TEXTS_MARKER];
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  return {
    alt: typeof m.alt === "string" ? m.alt : undefined,
    title: typeof m.title === "string" ? m.title : undefined,
  };
}

type FieldDecision = "write" | "unchanged" | "manual";

function decideField(
  current: string | null,
  generated: string,
  markerValue: string | undefined,
  isDefault: (value: string) => boolean,
  force: boolean,
): FieldDecision {
  const value = current ?? "";
  if (value === generated) return "unchanged";
  if (force || !value.trim() || isDefault(value) || (markerValue !== undefined && value === markerValue)) return "write";
  return "manual";
}

export type ImageTextsPlanOptions = {
  /** Vorhandene ALT-Texte ohne Markierung trotzdem ersetzen (einmalig fuer Alt-Bestand). */
  replaceExistingAlt?: boolean;
};

export type ImageTextsExample = {
  fileName: string;
  productNumber: string;
  alt: string;
  title: string;
  previousAlt: string | null;
  previousTitle: string | null;
};

export type ImageTextsPlan = {
  images: number;
  updates: MediaTextsUpdate[];
  altChanges: number;
  titleChanges: number;
  keptManualAlt: number;
  keptManualTitle: number;
  unchanged: number;
  withoutProductName: number;
  examples: ImageTextsExample[];
};

export function planImageTextUpdates(
  links: ProductImageLink[],
  products: ProductImageProduct[],
  media: MediaTexts[],
  options: ImageTextsPlanOptions = {},
): ImageTextsPlan {
  const productById = new Map(products.map((p) => [p.id, p]));
  const productsByMedia = new Map<string, ProductImageProduct[]>();
  for (const link of links) {
    const product = productById.get(link.productId);
    if (!product) continue;
    const list = productsByMedia.get(link.mediaId) ?? [];
    if (!list.some((p) => p.id === product.id)) list.push(product);
    productsByMedia.set(link.mediaId, list);
  }

  const plan: ImageTextsPlan = {
    images: 0,
    updates: [],
    altChanges: 0,
    titleChanges: 0,
    keptManualAlt: 0,
    keptManualTitle: 0,
    unchanged: 0,
    withoutProductName: 0,
    examples: [],
  };

  for (const item of media) {
    const owners = productsByMedia.get(item.id);
    if (!owners || owners.length === 0) continue;
    plan.images += 1;
    const name = sharedProductName(owners.map((p) => p.name));
    if (!name) {
      plan.withoutProductName += 1;
      continue;
    }
    const generated = buildImageTexts(name, item.fileName);
    const marker = readMarker(item);
    const altDecision = decideField(item.alt, generated.alt, marker.alt, () => false, Boolean(options.replaceExistingAlt));
    const titleDecision = decideField(item.title, generated.title, marker.title, (v) => looksLikeFileName(v, item.fileName), false);
    if (altDecision === "manual") plan.keptManualAlt += 1;
    if (titleDecision === "manual") plan.keptManualTitle += 1;
    if (altDecision !== "write" && titleDecision !== "write") {
      if (altDecision === "unchanged" && titleDecision === "unchanged") plan.unchanged += 1;
      continue;
    }

    const update: MediaTextsUpdate = { id: item.id, customFields: {} };
    const nextMarker: Marker = { ...marker };
    if (altDecision === "write") {
      update.alt = generated.alt;
      nextMarker.alt = generated.alt;
      plan.altChanges += 1;
    }
    if (titleDecision === "write") {
      update.title = generated.title;
      nextMarker.title = generated.title;
      plan.titleChanges += 1;
    }
    update.customFields = { [PRODUCT_IMAGE_TEXTS_MARKER]: nextMarker };
    plan.updates.push(update);
    if (plan.examples.length < EXAMPLE_COUNT) {
      plan.examples.push({
        fileName: item.fileName,
        productNumber: owners[0].productNumber,
        alt: update.alt ?? item.alt ?? "",
        title: update.title ?? item.title ?? "",
        previousAlt: item.alt,
        previousTitle: item.title,
      });
    }
  }
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Lauf

export type ImageTextsClient = {
  fetchProductImageLinks(): Promise<ProductImageLink[]>;
  fetchProductImageProducts(): Promise<ProductImageProduct[]>;
  fetchMediaTexts(ids: string[]): Promise<MediaTexts[]>;
  syncMediaTexts(updates: MediaTextsUpdate[]): Promise<void>;
};

export type ImageTextsTrigger = "manual" | "scheduled" | "script";

export type ImageTextsRunSummary = {
  trigger: ImageTextsTrigger;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  images: number;
  /** Bilder mit mindestens einem neuen Text (im Testlauf: wuerden geaendert). */
  changed: number;
  altChanges: number;
  titleChanges: number;
  keptManualAlt: number;
  keptManualTitle: number;
  unchanged: number;
  withoutProductName: number;
  examples: ImageTextsExample[];
  error?: string;
};

export async function runProductImageTexts(
  client: ImageTextsClient,
  options: ImageTextsPlanOptions & { dryRun: boolean; trigger: ImageTextsTrigger; now?: () => Date },
): Promise<ImageTextsRunSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const links = await client.fetchProductImageLinks();
  const products = await client.fetchProductImageProducts();
  const mediaIds = [...new Set(links.map((l) => l.mediaId))];
  const media = await client.fetchMediaTexts(mediaIds);
  const plan = planImageTextUpdates(links, products, media, options);
  if (!options.dryRun && plan.updates.length > 0) {
    await client.syncMediaTexts(plan.updates);
  }
  const summary: ImageTextsRunSummary = {
    trigger: options.trigger,
    dryRun: options.dryRun,
    startedAt,
    finishedAt: now().toISOString(),
    images: plan.images,
    changed: plan.updates.length,
    altChanges: plan.altChanges,
    titleChanges: plan.titleChanges,
    keptManualAlt: plan.keptManualAlt,
    keptManualTitle: plan.keptManualTitle,
    unchanged: plan.unchanged,
    withoutProductName: plan.withoutProductName,
    examples: plan.examples,
  };
  moduleLog.info(
    { trigger: summary.trigger, dryRun: summary.dryRun, images: summary.images, changed: summary.changed, keptManualAlt: summary.keptManualAlt, keptManualTitle: summary.keptManualTitle },
    "Bildtexte: Lauf abgeschlossen",
  );
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Einstellungen und Zustand je Mandant

export const productImageTextsSettingsSchema = z.object({
  /** Naechtlicher Lauf fuer neue/umbenannte Artikel; Standard aus. */
  enabled: z.boolean(),
  /** Stunde (Europe/Berlin), ab der der taegliche Lauf faellig ist. */
  hourLocal: z.number().int().min(0).max(23),
});
export type ProductImageTextsSettings = z.infer<typeof productImageTextsSettingsSchema>;

export const DEFAULT_PRODUCT_IMAGE_TEXTS_SETTINGS: ProductImageTextsSettings = { enabled: false, hourLocal: 3 };

export type ProductImageTextsState = {
  lastRun?: ImageTextsRunSummary;
  /** Berlin-Datum (YYYY-MM-DD) des letzten geplanten Laufs - hoechstens einer je Tag. */
  lastScheduledDay?: string;
};

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

export async function getProductImageTextsSettings(store: SettingsStore, tenantId: string | null): Promise<ProductImageTextsSettings> {
  const parsed = productImageTextsSettingsSchema.partial().safeParse(await store.getSetting(PRODUCT_IMAGE_TEXTS_SETTINGS_KEY, tenantId));
  return { ...DEFAULT_PRODUCT_IMAGE_TEXTS_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveProductImageTextsSettings(
  store: SettingsStore,
  patch: Partial<ProductImageTextsSettings>,
  tenantId: string | null,
): Promise<ProductImageTextsSettings> {
  const merged = productImageTextsSettingsSchema.parse({ ...(await getProductImageTextsSettings(store, tenantId)), ...patch });
  await store.saveSetting(PRODUCT_IMAGE_TEXTS_SETTINGS_KEY, merged, tenantId);
  return merged;
}

export async function getProductImageTextsState(store: SettingsStore, tenantId: string | null): Promise<ProductImageTextsState> {
  const raw = await store.getSetting(PRODUCT_IMAGE_TEXTS_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as ProductImageTextsState) : {};
}

export async function saveProductImageTextsState(store: SettingsStore, patch: ProductImageTextsState, tenantId: string | null): Promise<void> {
  const current = await getProductImageTextsState(store, tenantId);
  await store.saveSetting(PRODUCT_IMAGE_TEXTS_STATE_KEY, { ...current, ...patch }, tenantId);
}

/** Berlin-Datum und -Stunde. */
export function berlinDayAndHour(now: Date): { day: string; hour: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) };
}

export function isScheduledRunDue(now: Date, settings: ProductImageTextsSettings, state: ProductImageTextsState): boolean {
  if (!settings.enabled) return false;
  const { day, hour } = berlinDayAndHour(now);
  return hour >= settings.hourLocal && state.lastScheduledDay !== day;
}
