// ALT-Texte fuer Bilder in Erlebniswelten (CMS) und Linktexte fuer verlinkte Bildkacheln.
// Die Produktbild-Automatik (productImageTexts.ts) deckt nur Bilder an Artikeln ab; in den
// Erlebniswelten standen noch Texte einer alten Bilderkennung ("Ablage, Mobiliar, Krippe, Bett fuer
// Saeuglinge") oder gar keine.
//
// ALT (am Medium, gilt ueberall, wo das Bild steht) beschreibt, was das Bild zeigt:
//  - Produktfoto mit EAN im Dateinamen: Produktname + Ansicht wie bei den Produktbildern
//  - sonst ein geprueft hinterlegter Text (Sichtpruefung + Text des Abschnitts), siehe CMS_IMAGE_ALT_TEXTS
// Linktext (ariaLabel am Bild-Element, Shopware 6.7) nennt das Ziel einer Bildkachel ohne eigenen Text.
// Geschrieben wird nur in der Systemsprache (Deutsch).
import type { MediaTexts, MediaTextsUpdate } from "../shopware/client/media";
import { buildImageTexts, looksLikeFileName, PRODUCT_IMAGE_TEXTS_MARKER, readMarker, type Marker } from "./productImageTexts";

// ---------------------------------------------------------------------------------------------
// Befund

export type AltIssue = "leer" | "Dateiname" | "Bilderkennung";

/** Woerter der alten Bilderkennung; ein ALT nur aus solchen Teilen beschreibt kein META-Produkt. */
const RECOGNITION_LABELS = new Set([
  "ablage",
  "mobiliar",
  "möbel",
  "krippe",
  "bett für säuglinge",
  "handlauf",
  "gitarre",
  "musikinstrument",
  "regal",
]);

export function altIssue(alt: string | null, fileName: string): AltIssue | null {
  const value = (alt ?? "").trim();
  if (!value) return "leer";
  if (looksLikeFileName(value, fileName)) return "Dateiname";
  const parts = value
    .split(",")
    .map((p) => p.trim().toLowerCase())
    .filter(Boolean);
  if (parts.length > 0 && parts.every((p) => RECOGNITION_LABELS.has(p))) return "Bilderkennung";
  return null;
}

/** EAN aus Dateinamen wie "4026212324259_200185364-blickhoehe". */
export function eanFromFileName(fileName: string): string | null {
  return fileName.match(/^(\d{13})_\d+/)?.[1] ?? null;
}

// ---------------------------------------------------------------------------------------------
// Vorschlaege

/**
 * Gepruefte Texte fuer Bilder ohne Produktbezug (oder mit unbrauchbarem Produktnamen), je Medien-ID.
 * Grundlage steht in `source`; Medien-IDs sind in Live und Testshop gleich (Testshop = Kopie).
 */
export const CMS_IMAGE_ALT_TEXTS: Record<string, { alt: string; source: string }> = {
  "019546e4b60e74dbafdc13bd5b98b795": {
    alt: "META CLIP Regal – Maßzeichnung mit Rahmenhöhe (A), Fachhöhe (B), Tiefensteife (C) und Maßen in Längsrichtung (D, F, G)",
    source: "Sichtprüfung + Legende im Abschnitt „A) Standard-Rahmenhöhe …“ (Fachbodenregale)",
  },
  "019546e5d85d74828ef87639c38436ac": {
    alt: "META CLIP Regal – Maßzeichnung der Fußplatten in Längsrichtung: Innenmaß (D), Rahmenmaß (F), Außenmaß (G), Profilbreite (H)",
    source: "Sichtprüfung + Legende im Abschnitt „A) Standard-Rahmenhöhe …“ (Fachbodenregale)",
  },
  "019546e6f9ea7511b9357084763b0ebf": {
    alt: "META CLIP Doppelregal – Maßzeichnung in Tiefenrichtung: Rahmeninnenmaß (K), Rahmenaußenmaß (L), Doppelregaltiefe (M), Außenmaß Fußplatte (N), Zwischenmaß (P)",
    source: "Sichtprüfung + Legende im Abschnitt „K) Rahmeninnenmaß …“ (Fachbodenregale)",
  },
  "019546e7d5c47f2cb21d89006220fb4f": {
    alt: "META CLIP Regal – Maßzeichnung der Fußplatten in Tiefenrichtung: Rahmeninnenmaß (K), Rahmenaußenmaß (L), Außenmaß Fußplatte (N), Überstand der Fußplatte 4,5 mm",
    source: "Sichtprüfung (Beschriftung im Bild) + Legende im Abschnitt „K) Rahmeninnenmaß …“ (Fachbodenregale)",
  },
  "0194f65b881d7b268f9cff081ec5d4e8": {
    alt: "META CLIP Regal – Maßzeichnung mit Legende: Rahmenhöhe (A), Fachhöhe (B), Tiefensteife (C), Innen-, Rahmen- und Außenmaß in Längsrichtung (D, F, G), Profilbreite (H)",
    source: "Sichtprüfung (Legende im Bild)",
  },
  "0194f65bf4bb733da71d03417a6a8beb": {
    alt: "META CLIP Doppelregal – Maßzeichnung mit Legende in Tiefenrichtung: Rahmeninnenmaß (K), Rahmenaußenmaß (L), Doppelregaltiefe (M), Außenmaß Fußplatte (N), Überstand der Fußplatte (O), Zwischenmaß (P)",
    source: "Sichtprüfung (Legende im Bild)",
  },
  "0194e9c99ef87cfb819aaa858d14f421": {
    alt: "Ein- oder doppelseitig nutzbare Regale: mit Diagonalverstrebung einseitig, mit Längsriegeln doppelseitig bedienbar",
    source: "Sichtprüfung (Überschriften im Bild)",
  },
  "019594f3cf7174ffa3fdb6f2abd0d7ad": {
    alt: "Drahtgitterfachboden für META CLIP Regale – bis zu 75 % Rabatt",
    source: "Sichtprüfung (Text im Bild) + Abschnittstext „Abverkauf von Drahtgitterfachböden für META CLIP Regale“",
  },
  "019f3bef7ce87c0b828061baca1645e6": {
    alt: "Summer Sale – 10 % Rabatt auf alles mit dem Code SUMMER10",
    source: "Sichtprüfung (Text im Bild)",
  },
  "019594f771b875c78cd4f177107b6386": {
    alt: "Reifenregal mit eingelagerten Reifen, daneben ein Fahrzeug mit META-Beschriftung",
    source: "Sichtprüfung",
  },
  "01999eabda447ed882034f6916c19992": {
    alt: "Reifenlager: Gang mit beidseitig bestückten Reifenregalen",
    source: "Sichtprüfung + Abschnittstext „Ihre Vorteile mit META Reifenregalen“",
  },
  "01999eabda4673de9e5e6c7942922e4b": {
    alt: "Reifenregal mit 3 Feldern und 3 Ebenen, mit Reifen bestückt – Ansicht in Blickhöhe",
    source: "Sichtprüfung + Dateiname „Reifenregal_3-Felder-blickhoehe“",
  },
  "0199b827272176eebb2d0d69aaf5471a": {
    alt: "Reifen ohne Regal auf dem Boden, daneben Kartons und eine Werkbank",
    source: "Sichtprüfung + Abschnittstext „Lose gestapelte Reifen im Keller oder in der Werkstatt …“",
  },
  "018ff2ce12e87d3dbfd143b7bdff919d": {
    alt: "META MULTIPAL Palettenregal, Anbauregal, 2700 x 2700 x 1100 mm – Ansicht in Blickhöhe",
    source: "Produkt 4026212430059 (Name im Shop „MULTIPAL Anbauregal 2700 x 2700 x 1100 mm 3Lvl | 2970 kg“, ohne Kürzel)",
  },
};

export type MediaTextsProposal = { alt: string; title: string | null; source: string };

/**
 * Vorschlag fuer ein Bild mit Befund. TITLE nur, wenn er leer ist oder noch den Dateinamen traegt
 * und ein Produktname vorliegt; von Hand gepflegte ALT-Texte (ohne Befund) bleiben stehen.
 */
export function proposeMediaTexts(
  media: Pick<MediaTexts, "id" | "fileName" | "alt" | "title">,
  productName: string | null,
): MediaTextsProposal | null {
  if (!altIssue(media.alt, media.fileName)) return null;
  const fixed = CMS_IMAGE_ALT_TEXTS[media.id];
  if (fixed) return { alt: fixed.alt, title: null, source: fixed.source };
  if (!productName?.trim()) return null;
  const generated = buildImageTexts(productName, media.fileName);
  const titleIsDefault = !(media.title ?? "").trim() || looksLikeFileName(media.title ?? "", media.fileName);
  return { alt: generated.alt, title: titleIsDefault ? generated.title : null, source: `Produkt ${eanFromFileName(media.fileName)} (Name + Ansicht aus Dateiname)` };
}

// ---------------------------------------------------------------------------------------------
// Bilder in den Layouts finden

export type CmsImageUsage = {
  pageId: string;
  pageName: string;
  section: number;
  /** Kanaele, auf die der Abschnitt beschraenkt ist (moorl), leer = ueberall */
  sectionChannels: string[];
  block: number;
  element: string;
  slotId: string | null;
  slotType: string | null;
  mediaId: string;
  link: string;
  /** Ueberschrift neben dem Bild: Text im selben Block, sonst der Textblock direkt danach */
  heading: string;
  /** Linktext am Element (nur Bild-Elemente) */
  ariaLabel: string | null;
};

const isId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{32}$/i.test(v);
export const plainText = (html: unknown) =>
  String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const headingOf = (html: unknown) => {
  const h = String(html ?? "").match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
  const text = plainText(h ? h[1] : html);
  return text.length <= 80 ? text : "";
};
/** Links der ssik-Elemente: Kategorie als "navigation/<id>" wie interne Shopware-Links. */
const ssikLink = (link: any) => (isId(link?.internalLink) ? `navigation/${link.internalLink}` : String(link?.externalLink ?? ""));
const byPosition = <T extends { position: number }>(list: T[] | undefined) => [...(list ?? [])].sort((a, b) => a.position - b.position);

/** Alle Medien in Bild-, Slider- und Shop-the-Look-Elementen sowie Hintergruenden eines Layouts. */
export function collectCmsImageUsages(page: any): CmsImageUsage[] {
  const out: CmsImageUsage[] = [];
  for (const section of byPosition<any>(page.sections)) {
    const channels: string[] = Array.isArray(section.customFields?.moorl_section_config?.salesChannel) ? section.customFields.moorl_section_config.salesChannel : [];
    const blocks = byPosition<any>(section.blocks);
    const base = { pageId: page.id, pageName: page.name, section: section.position, sectionChannels: channels };
    if (isId(section.backgroundMediaId)) out.push({ ...base, block: -1, element: "Abschnitt-Hintergrund", slotId: null, slotType: null, mediaId: section.backgroundMediaId, link: "", heading: "", ariaLabel: null });
    blocks.forEach((block, i) => {
      const slots: any[] = block.slots ?? [];
      const textSlot = slots.find((s) => s.type === "text");
      const next = blocks[i + 1];
      const nextText = next && (next.slots ?? []).length === 1 && next.slots[0].type === "text" ? next.slots[0] : null;
      const heading = headingOf((textSlot ?? nextText)?.config?.content?.value);
      const at = { ...base, block: block.position };
      if (isId(block.backgroundMediaId)) out.push({ ...at, element: `${block.type} Hintergrund`, slotId: null, slotType: null, mediaId: block.backgroundMediaId, link: "", heading, ariaLabel: null });
      for (const slot of slots) {
        const cfg = slot.translated?.config ?? slot.config ?? {};
        const add = (mediaId: unknown, link: unknown, element: string, ariaLabel: string | null = null) => {
          if (isId(mediaId)) out.push({ ...at, element, slotId: slot.id, slotType: slot.type, mediaId, link: typeof link === "string" ? link : "", heading, ariaLabel });
        };
        if (slot.type === "image") add(cfg.media?.value, cfg.url?.value, `${block.type}/${slot.slot}`, cfg.ariaLabel?.value ?? null);
        if (slot.type === "image-slider") for (const item of cfg.sliderItems?.value ?? []) add(item.mediaId, item.url, "image-slider");
        if (slot.type === "moorl-shop-the-look") add(cfg.media?.value, "", "shop-the-look");
        if (/^ssik-extra-parallax/.test(slot.type)) add(cfg.media?.value?.image?.value, ssikLink(cfg.link?.value), slot.type);
        if (slot.type === "ssik-extra-slider") for (const item of cfg.slider?.value ?? []) add(item.image?.value, ssikLink(item.link), slot.type);
      }
    });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Linktexte fuer Bildkacheln

/** Kategorie-ID aus internen Links ("<kanal>/navigation/<id>#") bzw. Pfad und Filter aus URLs. */
export function parseCmsLink(url: string): { categoryId: string | null; path: string | null; propertyIds: string[] } {
  const value = url.trim();
  const nav = value.match(/(?:^|\/)navigation\/([0-9a-f]{32})/i);
  if (nav) return { categoryId: nav[1].toLowerCase(), path: null, propertyIds: [] };
  try {
    const parsed = new URL(value, "https://shop.invalid");
    const propertyIds = (parsed.searchParams.get("properties") ?? "").split("|").filter((id) => /^[0-9a-f]{32}$/i.test(id));
    return { categoryId: null, path: decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, ""), propertyIds };
  } catch {
    return { categoryId: null, path: null, propertyIds: [] };
  }
}

/** "Einzeilige Regale – CLIP Grundregale (Einfachregal)"; die Ueberschrift entfaellt, wenn das Ziel sie schon nennt. */
export function linkLabel(target: string, heading?: string | null, filterOptions: string[] = []): string {
  const name = filterOptions.length ? `${target} (${filterOptions.join(", ")})` : target;
  const h = (heading ?? "").replace(/\s+/g, " ").trim();
  if (!h || name.toLowerCase().includes(h.toLowerCase())) return name;
  return `${h} – ${name}`;
}

// ---------------------------------------------------------------------------------------------
// Schreiben, Protokoll, Zuruecknehmen

export type MediaTextRow = { mediaId: string; alt: string; title?: string | null };
export type SlotLabelRow = { slotId: string; ariaLabel: string };
export type CmsSlotState = { id: string; config: Record<string, any> | null };
export type SlotConfigUpdate = { id: string; config: Record<string, any> };

export type CmsImageTextsProtocol = {
  tenantId: string;
  at: string;
  media: Array<{ id: string; alt: string | null; title: string | null; marker: Marker | null }>;
  slots: Array<{ id: string; config: Record<string, any> | null }>;
};

export type CmsImageTextsPlan = {
  mediaUpdates: MediaTextsUpdate[];
  slotUpdates: SlotConfigUpdate[];
  /** Bisherige Werte aller Eintraege, die geschrieben werden. */
  previous: Pick<CmsImageTextsProtocol, "media" | "slots">;
  unchanged: number;
  /** Medien/Slots aus der Liste, die es im Shop nicht (mehr) gibt. */
  missing: string[];
};

export function planCmsImageTexts(mediaRows: MediaTextRow[], slotRows: SlotLabelRow[], media: MediaTexts[], slots: CmsSlotState[]): CmsImageTextsPlan {
  const plan: CmsImageTextsPlan = { mediaUpdates: [], slotUpdates: [], previous: { media: [], slots: [] }, unchanged: 0, missing: [] };
  const mediaById = new Map(media.map((m) => [m.id, m]));
  for (const row of mediaRows) {
    const alt = row.alt.trim();
    const title = row.title?.trim() || null;
    if (!alt) continue;
    const current = mediaById.get(row.mediaId);
    if (!current) {
      plan.missing.push(`Medium ${row.mediaId}`);
      continue;
    }
    const writeTitle = title !== null && current.title !== title;
    if (current.alt === alt && !writeTitle) {
      plan.unchanged += 1;
      continue;
    }
    const marker = readMarker(current);
    const update: MediaTextsUpdate = { id: current.id, alt, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: { ...marker, alt, ...(writeTitle ? { title } : {}) } } };
    if (writeTitle) update.title = title!;
    plan.mediaUpdates.push(update);
    const hadMarker = current.customFields?.[PRODUCT_IMAGE_TEXTS_MARKER] && typeof current.customFields[PRODUCT_IMAGE_TEXTS_MARKER] === "object";
    plan.previous.media.push({ id: current.id, alt: current.alt, title: current.title, marker: hadMarker ? marker : null });
  }
  const slotById = new Map(slots.map((s) => [s.id, s]));
  for (const row of slotRows) {
    const label = row.ariaLabel.trim();
    if (!label) continue;
    const current = slotById.get(row.slotId);
    if (!current) {
      plan.missing.push(`Slot ${row.slotId}`);
      continue;
    }
    if (current.config?.ariaLabel?.value === label) {
      plan.unchanged += 1;
      continue;
    }
    const config = structuredClone(current.config ?? {});
    config.ariaLabel = { source: "static", value: label };
    plan.slotUpdates.push({ id: current.id, config });
    plan.previous.slots.push({ id: current.id, config: current.config });
  }
  return plan;
}

/** Aenderungen aus einem Protokoll zuruecknehmen: alte Texte, alte Markierung (oder keine), alte Slot-Konfiguration. */
export function revertCmsImageTexts(protocol: Pick<CmsImageTextsProtocol, "media" | "slots">): { mediaUpdates: Array<{ id: string; alt: string | null; title: string | null; customFields: Record<string, unknown> }>; slotUpdates: Array<{ id: string; config: Record<string, any> | null }> } {
  return {
    mediaUpdates: protocol.media.map((m) => ({ id: m.id, alt: m.alt, title: m.title, customFields: { [PRODUCT_IMAGE_TEXTS_MARKER]: m.marker } })),
    slotUpdates: protocol.slots.map((s) => ({ id: s.id, config: s.config })),
  };
}
