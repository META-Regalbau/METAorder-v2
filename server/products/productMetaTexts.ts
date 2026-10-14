// Meta-Title und Meta-Description der Artikel im Shop, per KI im Stil der schon gepflegten Texte.
// Nur aktive, sichtbare Artikel; geschrieben wird in der Systemsprache (Deutsch).
//
// Von Hand gepflegte Texte bleiben stehen: ein Feld wird nur geschrieben, wenn es leer ist oder
// noch genau den Text enthaelt, den dieses Modul zuletzt geschrieben hat (Markierung im
// Zusatzfeld am Artikel). Eigene Texte werden neu erzeugt, wenn sich Name, Eigenschaften oder
// Beschreibung geaendert haben (Quell-Hash in der Markierung).
//
// Jeder KI-Text wird geprueft: Laenge, keine Zahl, die nicht im Artikel steht, keine Aussagen zu
// Preis, Versand, Garantie oder Zertifikaten, die der Artikel nicht hergibt. Durchgefallene
// Texte werden einmal neu angefragt, sonst bleibt der Artikel unveraendert.
import { createHash } from "crypto";
import { z } from "zod";
import type { ProductMetaSource, ProductMetaUpdate } from "../shopware/client/productMeta";
import { chatCompletion, parseLlmJsonResponse } from "../ai/llmChat";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "products/productMetaTexts" });

export const PRODUCT_META_TEXTS_SETTINGS_KEY = "product_meta_texts_settings";
export const PRODUCT_META_TEXTS_STATE_KEY = "product_meta_texts_state";
/** Zusatzfeld am Artikel: zuletzt automatisch geschriebene Texte + Quell-Hash. */
export const PRODUCT_META_TEXTS_MARKER = "metaorder_meta_texts";
/** Bei Aenderungen am Prompt erhoehen: eigene Texte gelten dann als veraltet. */
export const META_PROMPT_VERSION = "meta-v1";

export const META_TITLE_MIN = 25;
export const META_TITLE_MAX = 70;
export const META_DESCRIPTION_MIN = 70;
export const META_DESCRIPTION_MAX = 160;

const BATCH_SIZE = 10;
const STYLE_EXAMPLE_COUNT = 8;
const DESCRIPTION_CHARS = 700;
const MAX_PROPERTIES = 25;
const EXAMPLE_COUNT = 12;

// ---------------------------------------------------------------------------------------------
// Quelle aufbereiten

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", auml: "ä", ouml: "ö", uuml: "ü",
  Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß", ndash: "–", mdash: "—", deg: "°", times: "×",
};

/** HTML-Beschreibung als Fliesstext. */
export function descriptionText(html: string): string {
  return (html || "")
    .replace(/<(br|\/p|\/li|\/h\d)[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}

export function productSourceText(p: Pick<ProductMetaSource, "name" | "properties" | "description">): string {
  const props = p.properties
    .slice(0, MAX_PROPERTIES)
    .map((x) => `${x.group}: ${x.option}`)
    .join("; ");
  const desc = descriptionText(p.description).slice(0, DESCRIPTION_CHARS);
  return [`Name: ${p.name}`, props ? `Eigenschaften: ${props}` : "", desc ? `Beschreibung: ${desc}` : ""]
    .filter(Boolean)
    .join("\n");
}

export function productSourceHash(p: Pick<ProductMetaSource, "name" | "properties" | "description">): string {
  return createHash("sha256").update(`${META_PROMPT_VERSION}\n${productSourceText(p)}`).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------------------------
// Entscheiden, was neu entsteht

type Marker = { metaTitle?: string; metaDescription?: string; sourceHash?: string };

function readMarker(p: ProductMetaSource): Marker {
  const raw = p.customFields?.[PRODUCT_META_TEXTS_MARKER];
  if (!raw || typeof raw !== "object") return {};
  const m = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : undefined);
  return { metaTitle: str(m.metaTitle), metaDescription: str(m.metaDescription), sourceHash: str(m.sourceHash) };
}

type FieldDecision = "write" | "unchanged" | "manual";

function decideField(current: string | null, markerValue: string | undefined, sourceChanged: boolean): FieldDecision {
  const value = (current ?? "").trim();
  if (!value) return "write";
  if (markerValue !== undefined && current === markerValue) return sourceChanged ? "write" : "unchanged";
  return "manual";
}

export type MetaCandidate = {
  product: ProductMetaSource;
  writeTitle: boolean;
  writeDescription: boolean;
  sourceHash: string;
  marker: Marker;
};

export type MetaSelection = {
  /** Aktive, sichtbare Artikel */
  products: number;
  candidates: MetaCandidate[];
  keptManualTitle: number;
  keptManualDescription: number;
  unchanged: number;
};

export function selectMetaCandidates(products: ProductMetaSource[]): MetaSelection {
  const selection: MetaSelection = { products: 0, candidates: [], keptManualTitle: 0, keptManualDescription: 0, unchanged: 0 };
  for (const product of products) {
    if (!product.active || !product.visible || !product.name) continue;
    selection.products += 1;
    const marker = readMarker(product);
    const sourceHash = productSourceHash(product);
    // Eigene Texte, die die aktuellen Pruefregeln nicht mehr bestehen, werden neu erzeugt
    const ownTitle = marker.metaTitle !== undefined && product.metaTitle === marker.metaTitle;
    const ownDescription = marker.metaDescription !== undefined && product.metaDescription === marker.metaDescription;
    const failsRules =
      (ownTitle || ownDescription) &&
      validateGeneratedMeta(product, { metaTitle: product.metaTitle ?? "", metaDescription: product.metaDescription ?? "" }) !== null;
    const sourceChanged = marker.sourceHash !== sourceHash || failsRules;
    const title = decideField(product.metaTitle, marker.metaTitle, sourceChanged);
    const description = decideField(product.metaDescription, marker.metaDescription, sourceChanged);
    if (title === "manual") selection.keptManualTitle += 1;
    if (description === "manual") selection.keptManualDescription += 1;
    if (title !== "write" && description !== "write") {
      if (title === "unchanged" && description === "unchanged") selection.unchanged += 1;
      continue;
    }
    selection.candidates.push({ product, writeTitle: title === "write", writeDescription: description === "write", sourceHash, marker });
  }
  return selection;
}

/** Stilvorlagen: von Hand gepflegte Texte, je Produktfamilie (erster Namensteil) hoechstens eine. */
export function pickStyleExamples(products: ProductMetaSource[], count = STYLE_EXAMPLE_COUNT): ProductMetaSource[] {
  const manual = products
    .filter((p) => p.active && p.metaTitle?.trim() && p.metaDescription?.trim())
    .filter((p) => {
      const m = readMarker(p);
      return p.metaTitle !== m.metaTitle && p.metaDescription !== m.metaDescription;
    })
    .sort((a, b) => a.productNumber.localeCompare(b.productNumber));
  const seen = new Set<string>();
  const picked: ProductMetaSource[] = [];
  for (const p of manual) {
    const family = p.name.split(/[|(]/)[0].trim().split(/\s+/).slice(0, 2).join(" ").toLowerCase();
    if (seen.has(family)) continue;
    seen.add(family);
    picked.push(p);
    if (picked.length >= count) break;
  }
  return picked;
}

// ---------------------------------------------------------------------------------------------
// Pruefen

/** Aussagen, die nur stehen duerfen, wenn der Artikel sie selbst hergibt. */
const CLAIM_RULES: Array<[RegExp, string]> = [
  [/versandkostenfrei|kostenlos|gratis/i, "shipping"],
  [/lieferzeit|sofort lieferbar|lieferbar in|\b24\s*h\b/i, "delivery"],
  [/€|\beuro\b|\bpreis|günstig|billig|rabatt|sonderangebot/i, "price"],
  [/tüv|gs[- ]geprüft|zertifiziert|\bdin\b|\ben\s?\d{3,}/i, "certificate"],
  [/made in germany|deutsche qualität|qualität aus deutschland/i, "origin"],
  [/garantie/i, "warranty"],
  // RAL-Farbe heisst nicht automatisch pulverbeschichtet
  [/pulverbeschicht|lackiert|feuerverzinkt|edelstahl|eloxiert/i, "surface"],
];

function digitForms(text: string): Set<string> {
  const forms = new Set<string>();
  for (const token of text.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    forms.add(token.replace(/[.,]/g, ""));
    for (const run of token.match(/\d+/g) ?? []) forms.add(run);
  }
  return forms;
}

export type GeneratedMeta = { metaTitle: string; metaDescription: string };

const KG_PATTERN = /(\d+(?:[.,]\d+)?)\s*kg/gi;
const DIMENSIONS_PATTERN = /(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*[x×]\s*(\d+(?:[.,]\d+)?)/gi;
const digitsOnly = (v: string) => v.replace(/[.,]/g, "");

function kgValues(text: string): string[] {
  return [...text.matchAll(KG_PATTERN)].map((m) => digitsOnly(m[1]));
}

function dimensionTriples(text: string): string[] {
  return [...text.matchAll(DIMENSIONS_PATTERN)].map((m) => [m[1], m[2], m[3]].map(digitsOnly).join("x"));
}

/**
 * Werte aus dem Namen haben Vorrang: Eigenschaften widersprechen dem Namen teils (Live:
 * "Fachlast 80 kg" im Namen, "max. Fachlast: 200 kg" in den Eigenschaften).
 */
function nameValueConflict(name: string, text: string): string | null {
  const nameKg = kgValues(name);
  if (nameKg.length > 0) {
    const wrong = kgValues(text).find((v) => !nameKg.includes(v));
    if (wrong) return `name_kg_${wrong}`;
  }
  const nameDims = dimensionTriples(name);
  if (nameDims.length > 0) {
    const wrong = dimensionTriples(text).find((v) => !nameDims.includes(v));
    if (wrong) return `name_dimensions_${wrong}`;
  }
  return null;
}

/** null = in Ordnung, sonst Grund. */
export function validateGeneratedMeta(product: ProductMetaSource, gen: GeneratedMeta): string | null {
  const title = gen.metaTitle.trim();
  const description = gen.metaDescription.trim();
  if (title.length < META_TITLE_MIN || title.length > META_TITLE_MAX) return `title_length_${title.length}`;
  if (description.length < META_DESCRIPTION_MIN || description.length > META_DESCRIPTION_MAX) return `description_length_${description.length}`;
  if (/[\r\n]/.test(title + description) || /^["'„“]|["'“”]$/.test(title)) return "format";
  const source = productSourceText({ ...product, description: product.description });
  const allowed = digitForms(source);
  for (const token of `${title} ${description}`.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const whole = token.replace(/[.,]/g, "");
    const runs = token.match(/\d+/g) ?? [];
    if (!allowed.has(whole) && !runs.every((r) => allowed.has(r))) return `number_${token}`;
  }
  const conflict = nameValueConflict(product.name, `${title} ${description}`);
  if (conflict) return conflict;
  for (const [pattern, reason] of CLAIM_RULES) {
    if (pattern.test(`${title} ${description}`) && !pattern.test(source)) return `claim_${reason}`;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// KI

const SYSTEM_PROMPT = `Du schreibst SEO-Meta-Texte für Artikel im Onlineshop von META Regalbau (Regale, Lagertechnik und Zubehör für Gewerbe und Privat).
Für jeden Artikel:
- metaTitle: 50–65 Zeichen, höchstens ${META_TITLE_MAX}. Wichtigste Suchbegriffe zuerst: Serie/System (z. B. META CLIP S3), Produktart, Maße kompakt (z. B. 2000x1300x400 mm), danach 1–2 Merkmale, getrennt mit " | ". Kein Shopname, keine Artikelnummer.
- metaDescription: 120–155 Zeichen, höchstens ${META_DESCRIPTION_MAX}. Ein bis zwei Sätze: was es ist, die wichtigsten Daten (Maße, Fachlast, Böden, Oberfläche) und wofür es sich eignet. Natürliche Sprache, Sie-Form oder neutral.
Regeln:
- Nur Fakten aus Name, Eigenschaften und Beschreibung. Keine Zahl, kein Maß, keine Last, Stückzahl oder Farbe, die dort nicht steht.
- Keine Preise, Rabatte, Lieferzeiten, Versandkosten, Garantie, Zertifikate oder Herkunftsangaben, außer sie stehen ausdrücklich im Artikel.
- Oberfläche genau so nennen wie im Artikel (z. B. "verzinkt", "RAL 7035"); aus einer RAL-Farbe nicht "pulverbeschichtet" oder "lackiert" machen.
- Nennt der Name Maße oder Fachlast (neue Namen mit "|"), gelten genau diese Werte – auch wenn Eigenschaften oder Beschreibung andere nennen. Weitere Lasten (z. B. Feldlast) dann nicht nennen. Nur bei alten Kurznamen ohne solche Angaben die Eigenschaften nutzen.
- Abkürzungen: "kpl" = komplett (vollständiger Satz, nicht "montiert"), "vzk" = verzinkt, "ER"/"DR" = einseitig/doppelseitig, "GR"/"AR" = Grundregal/Anbauregal.
- Ein Anbauregal ist eine Erweiterung (braucht ein Grundregal); ein Grundregal steht für sich. Zubehör nicht als komplettes Regal beschreiben.
- Alte, abgekürzte Namen (z. B. "KR H Fuß 220 DR 400 R5010") mit Hilfe der Eigenschaften verständlich ausschreiben; was sich nicht sicher deuten lässt, weglassen.
- Abwechslungsreich formulieren, nicht jede Beschreibung mit demselben Satz enden lassen.
Antworte nur mit JSON: {"items":[{"nr":"<Artikelnummer>","metaTitle":"...","metaDescription":"..."}]} – für jeden Artikel genau ein Eintrag.`;

function buildUserPrompt(batch: ProductMetaSource[], examples: ProductMetaSource[], feedback?: Map<string, string>): string {
  const lines: string[] = [];
  if (examples.length > 0) {
    lines.push("STILVORLAGEN (vom Team gepflegt):");
    for (const ex of examples) {
      lines.push(`- Name: ${ex.name}\n  metaTitle: ${ex.metaTitle}\n  metaDescription: ${ex.metaDescription}`);
    }
    lines.push("");
  }
  lines.push("ARTIKEL:");
  for (const p of batch) {
    lines.push(`### nr=${p.productNumber}\n${productSourceText(p)}`);
    const note = feedback?.get(p.productNumber);
    if (note) lines.push(`HINWEIS: Der letzte Vorschlag wurde verworfen (${note}). Bitte die Regeln genau einhalten.`);
  }
  return lines.join("\n");
}

const itemSchema = z.object({
  nr: z.union([z.string(), z.number()]).transform(String),
  metaTitle: z.string(),
  metaDescription: z.string(),
});

export type MetaGenerator = (
  batch: ProductMetaSource[],
  examples: ProductMetaSource[],
  feedback?: Map<string, string>,
) => Promise<Map<string, GeneratedMeta>>;

/** KI-Aufruf ueber die Mandanten-Einstellungen (Stufe "smart"). */
export function llmMetaGenerator(getSetting: (key: string) => Promise<any>): MetaGenerator {
  return async (batch, examples, feedback) => {
    const text = await chatCompletion(getSetting, {
      tier: "smart",
      temperature: 0.4,
      max_tokens: 4000,
      response_json: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(batch, examples, feedback) },
      ],
    });
    const parsed = parseLlmJsonResponse(text) as { items?: unknown };
    const out = new Map<string, GeneratedMeta>();
    for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
      const item = itemSchema.safeParse(raw);
      if (item.success) {
        out.set(item.data.nr.trim(), { metaTitle: item.data.metaTitle.trim(), metaDescription: item.data.metaDescription.trim() });
      }
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Lauf

export type MetaTextsClient = {
  fetchProductMetaSources(): Promise<ProductMetaSource[]>;
  syncProductMetaTexts(updates: ProductMetaUpdate[]): Promise<void>;
};

export type MetaTextsTrigger = "manual" | "scheduled" | "script";

export type MetaTextsExample = {
  productNumber: string;
  name: string;
  metaTitle: string;
  metaDescription: string;
};

export type MetaTextsRunSummary = {
  trigger: MetaTextsTrigger;
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  /** Aktive, sichtbare Artikel */
  products: number;
  /** Artikel, die neue Texte brauchen */
  candidates: number;
  /** In diesem Lauf bearbeitet (Grenze je Lauf) */
  processed: number;
  /** Geschrieben (im Testlauf: erzeugt und geprueft) */
  written: number;
  titleChanges: number;
  descriptionChanges: number;
  rejected: number;
  /** Bleiben fuer spaetere Laeufe */
  remaining: number;
  keptManualTitle: number;
  keptManualDescription: number;
  unchanged: number;
  examples: MetaTextsExample[];
  rejectedExamples: Array<{ productNumber: string; name: string; reason: string }>;
  error?: string;
};

export type MetaRunOptions = {
  dryRun: boolean;
  trigger: MetaTextsTrigger;
  /** Hoechstens so viele Artikel je Lauf */
  maxProducts: number;
  /** Parallele KI-Anfragen */
  concurrency?: number;
  onProgress?: (done: number, total: number) => void;
  now?: () => Date;
};

function toUpdate(c: MetaCandidate, gen: GeneratedMeta): ProductMetaUpdate {
  const update: ProductMetaUpdate = { id: c.product.id, customFields: {} };
  const marker: Marker = { ...c.marker, sourceHash: c.sourceHash };
  if (c.writeTitle) {
    update.metaTitle = gen.metaTitle;
    marker.metaTitle = gen.metaTitle;
  }
  if (c.writeDescription) {
    update.metaDescription = gen.metaDescription;
    marker.metaDescription = gen.metaDescription;
  }
  update.customFields = { [PRODUCT_META_TEXTS_MARKER]: marker };
  return update;
}

export async function runProductMetaTexts(
  client: MetaTextsClient,
  generate: MetaGenerator,
  options: MetaRunOptions,
): Promise<MetaTextsRunSummary> {
  const now = options.now ?? (() => new Date());
  const startedAt = now().toISOString();
  const products = await client.fetchProductMetaSources();
  const selection = selectMetaCandidates(products);
  const examples = pickStyleExamples(products);
  const work = selection.candidates.slice(0, Math.max(0, options.maxProducts));
  const summary: MetaTextsRunSummary = {
    trigger: options.trigger,
    dryRun: options.dryRun,
    startedAt,
    finishedAt: startedAt,
    products: selection.products,
    candidates: selection.candidates.length,
    processed: work.length,
    written: 0,
    titleChanges: 0,
    descriptionChanges: 0,
    rejected: 0,
    remaining: selection.candidates.length - work.length,
    keptManualTitle: selection.keptManualTitle,
    keptManualDescription: selection.keptManualDescription,
    unchanged: selection.unchanged,
    examples: [],
    rejectedExamples: [],
  };

  const batches: MetaCandidate[][] = [];
  for (let i = 0; i < work.length; i += BATCH_SIZE) batches.push(work.slice(i, i + BATCH_SIZE));
  const concurrency = Math.max(1, options.concurrency ?? 3);
  let done = 0;

  const generateChecked = async (batch: MetaCandidate[]) => {
    const accepted = new Map<string, GeneratedMeta>();
    const reasons = new Map<string, string>();
    let pending = batch;
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      let generated = new Map<string, GeneratedMeta>();
      try {
        generated = await generate(pending.map((c) => c.product), examples, attempt > 0 ? new Map(reasons) : undefined);
      } catch (err) {
        moduleLog.warn({ err, attempt }, "Meta-Texte: KI-Anfrage fehlgeschlagen");
      }
      const next: MetaCandidate[] = [];
      for (const c of pending) {
        const gen = generated.get(c.product.productNumber);
        const reason = gen ? validateGeneratedMeta(c.product, gen) : "missing";
        if (gen && !reason) {
          accepted.set(c.product.id, gen);
          reasons.delete(c.product.productNumber);
        } else {
          reasons.set(c.product.productNumber, reason ?? "missing");
          next.push(c);
        }
      }
      pending = next;
    }
    return { accepted, rejected: pending.map((c) => ({ c, reason: reasons.get(c.product.productNumber) ?? "missing" })) };
  };

  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = batches.slice(i, i + concurrency);
    const results = await Promise.all(wave.map(generateChecked));
    const updates: ProductMetaUpdate[] = [];
    wave.forEach((batch, index) => {
      const { accepted, rejected } = results[index];
      for (const c of batch) {
        const gen = accepted.get(c.product.id);
        if (!gen) continue;
        updates.push(toUpdate(c, gen));
        if (c.writeTitle) summary.titleChanges += 1;
        if (c.writeDescription) summary.descriptionChanges += 1;
        if (summary.examples.length < EXAMPLE_COUNT) {
          summary.examples.push({
            productNumber: c.product.productNumber,
            name: c.product.name,
            metaTitle: c.writeTitle ? gen.metaTitle : c.product.metaTitle ?? "",
            metaDescription: c.writeDescription ? gen.metaDescription : c.product.metaDescription ?? "",
          });
        }
      }
      for (const { c, reason } of rejected) {
        summary.rejected += 1;
        if (summary.rejectedExamples.length < EXAMPLE_COUNT) {
          summary.rejectedExamples.push({ productNumber: c.product.productNumber, name: c.product.name, reason });
        }
      }
      done += batch.length;
    });
    if (!options.dryRun && updates.length > 0) await client.syncProductMetaTexts(updates);
    summary.written += updates.length;
    options.onProgress?.(done, work.length);
  }

  summary.finishedAt = now().toISOString();
  moduleLog.info(
    {
      trigger: summary.trigger,
      dryRun: summary.dryRun,
      candidates: summary.candidates,
      processed: summary.processed,
      written: summary.written,
      rejected: summary.rejected,
      remaining: summary.remaining,
    },
    "Meta-Texte: Lauf abgeschlossen",
  );
  return summary;
}

// ---------------------------------------------------------------------------------------------
// Einstellungen und Zustand je Mandant

export const productMetaTextsSettingsSchema = z.object({
  /** Taeglicher Lauf fuer neue/geaenderte Artikel; Standard aus. */
  enabled: z.boolean(),
  /** Stunde (Europe/Berlin), ab der der taegliche Lauf faellig ist. */
  hourLocal: z.number().int().min(0).max(23),
  /** Hoechstens so viele Artikel je Lauf (KI-Kosten begrenzen). */
  maxPerRun: z.number().int().min(1).max(10000),
});
export type ProductMetaTextsSettings = z.infer<typeof productMetaTextsSettingsSchema>;

export const DEFAULT_PRODUCT_META_TEXTS_SETTINGS: ProductMetaTextsSettings = { enabled: false, hourLocal: 4, maxPerRun: 300 };

/** Testlauf: nur so viele Artikel (zum Ansehen, wenig KI-Kosten). */
export const META_DRY_RUN_PRODUCTS = 20;

export type ProductMetaTextsState = {
  lastRun?: MetaTextsRunSummary;
  lastScheduledDay?: string;
};

type SettingsStore = {
  getSetting(key: string, tenantId?: string | null): Promise<any>;
  saveSetting(key: string, value: any, tenantId?: string | null): Promise<any>;
};

export async function getProductMetaTextsSettings(store: SettingsStore, tenantId: string | null): Promise<ProductMetaTextsSettings> {
  const parsed = productMetaTextsSettingsSchema.partial().safeParse(await store.getSetting(PRODUCT_META_TEXTS_SETTINGS_KEY, tenantId));
  return { ...DEFAULT_PRODUCT_META_TEXTS_SETTINGS, ...(parsed.success ? parsed.data : {}) };
}

export async function saveProductMetaTextsSettings(
  store: SettingsStore,
  patch: Partial<ProductMetaTextsSettings>,
  tenantId: string | null,
): Promise<ProductMetaTextsSettings> {
  const merged = productMetaTextsSettingsSchema.parse({ ...(await getProductMetaTextsSettings(store, tenantId)), ...patch });
  await store.saveSetting(PRODUCT_META_TEXTS_SETTINGS_KEY, merged, tenantId);
  return merged;
}

export async function getProductMetaTextsState(store: SettingsStore, tenantId: string | null): Promise<ProductMetaTextsState> {
  const raw = await store.getSetting(PRODUCT_META_TEXTS_STATE_KEY, tenantId);
  return raw && typeof raw === "object" ? (raw as ProductMetaTextsState) : {};
}

export async function saveProductMetaTextsState(store: SettingsStore, patch: ProductMetaTextsState, tenantId: string | null): Promise<void> {
  const current = await getProductMetaTextsState(store, tenantId);
  await store.saveSetting(PRODUCT_META_TEXTS_STATE_KEY, { ...current, ...patch }, tenantId);
}
