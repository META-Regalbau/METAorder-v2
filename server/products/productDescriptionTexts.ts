// Kurze, SEO-/GEO-taugliche Produktbeschreibungen fuer den Import in Pimcore (nicht in den Shop).
// Aufbau: Einleitung (2–3 Saetze), 4–6 Stichpunkte mit Kerndaten, "Geeignet fuer …" und ein fester
// Schlusssatz je Produktfamilie. Die KI schreibt nur Einleitung, Stichpunkte und Einsatzzweck; den
// Schlusssatz haengt der Code wortgleich an, damit keine Firmenangabe erfunden wird.
//
// Pruefung wie bei den Meta-Texten: nur Zahlen aus dem Artikel, Werte aus dem Namen haben Vorrang,
// keine Preis-/Versand-/Garantie-/Zertifikatsangaben im KI-Teil.
import { z } from "zod";
import type { ProductMetaSource } from "../shopware/client/productMeta";
import { chatCompletion, parseLlmJsonResponse } from "../ai/llmChat";
import { CLAIM_RULES, descriptionText, digitForms, nameValueConflict, productSourceText } from "./productMetaTexts";

export const DESCRIPTION_PROMPT_VERSION = "desc-v1";

const SOURCE_DESCRIPTION_CHARS = 1500;
export const INTRO_MIN = 120;
export const INTRO_MAX = 420;
export const BULLETS_MIN = 3;
export const BULLETS_MAX = 7;
export const BULLET_MAX = 90;
export const SUITABLE_MAX = 170;
/** Laenge ohne Schlusssatz und ohne HTML */
export const BODY_MIN = 250;
export const BODY_MAX = 800;

// ---------------------------------------------------------------------------------------------
// Produktfamilie und Schlusssatz (nur Angaben, die in den heutigen Texten der Familie stehen)

export type ProductFamily = "clip" | "multipal" | "atlas" | "other" | "third_party";

export const CLOSING_SENTENCES: Record<ProductFamily, string> = {
  clip:
    "META CLIP ist „Made in Germany“ – mit 5 Jahren META-Qualitätsgarantie, zuverlässigem Ersatzteilservice und Zertifizierungen wie GS, DIN EN ISO 9001:2015 und RAL-Gütesicherung.",
  multipal:
    "META MULTIPAL ist gütegesichert nach RAL-RG 614/2, trägt das GS-Zeichen und ist DIBt-zugelassen; statische Nachweise nach DIN EN 15512 und Werksprüfung nach DIN EN ISO 9001.",
  atlas: "META ATLAS ist durch GS-Zertifikat und RAL-Gütezeichen bestätigt – mit 5 Jahren Herstellergarantie.",
  other: "META ist zertifiziert nach DIN EN ISO 9001:2015 und DIN ISO 50001 und bietet einen zuverlässigen Ersatzteilservice.",
  /** Fremdware: keine META-Angaben */
  third_party: "",
};

/** GS1-Firmenpraefix von META; andere EAN = Fremdware. */
const META_EAN_PREFIX = "4026212";
/** Familienangaben (Made in Germany, Guetesicherung …) belegen die Texte nur fuer komplette Regale. */
const SHELF_TYPES = new Set(["Regal", "Spezialregal"]);

/**
 * Familie fuer den Schlusssatz: Fremdware ohne META-Angaben; Familiensatz nur fuer komplette Regale
 * (Produktart aus custom_product_main_category_ptype), sonst der firmenweite Satz.
 */
export function productFamily(p: Pick<ProductMetaSource, "name" | "properties" | "productNumber" | "customFields">): ProductFamily {
  if (!p.productNumber.startsWith(META_EAN_PREFIX)) return "third_party";
  const productType = String(p.customFields?.custom_product_main_category_ptype ?? "");
  if (!SHELF_TYPES.has(productType)) return "other";
  const system = p.properties.find((x) => /regal-?system/i.test(x.group))?.option ?? "";
  const probe = `${system} ${p.name}`.toLowerCase();
  if (/\bclip\b/.test(probe)) return "clip";
  if (/multipal/.test(probe)) return "multipal";
  if (/\batlas\b/.test(probe)) return "atlas";
  return "other";
}

// ---------------------------------------------------------------------------------------------
// Pruefen und HTML bauen

export type GeneratedDescription = { intro: string; bullets: string[]; suitableFor: string };

/** Firmenangaben gehoeren nur in den festen Schlusssatz. */
const COMPANY_CLAIMS = /made in germany|garantie|gewährleistung|zertifi|gütesicher|gütezeichen|\bgs[- ]|\bdibt\b|iso\s?\d{4,5}|ersatzteilservice/i;

export function bodyText(gen: GeneratedDescription): string {
  return [gen.intro, ...gen.bullets, gen.suitableFor].join(" ");
}

/** null = in Ordnung, sonst Grund. */
export function validateGeneratedDescription(product: ProductMetaSource, gen: GeneratedDescription): string | null {
  const intro = gen.intro.trim();
  const bullets = gen.bullets.map((b) => b.trim()).filter(Boolean);
  const suitable = gen.suitableFor.trim();
  if (intro.length < INTRO_MIN || intro.length > INTRO_MAX) return `intro_length_${intro.length}`;
  if (bullets.length < BULLETS_MIN || bullets.length > BULLETS_MAX) return `bullets_count_${bullets.length}`;
  const longBullet = bullets.find((b) => b.length > BULLET_MAX);
  if (longBullet) return `bullet_length_${longBullet.length}`;
  if (!suitable || suitable.length > SUITABLE_MAX) return `suitable_length_${suitable.length}`;
  const body = bodyText({ intro, bullets, suitableFor: suitable });
  if (body.length < BODY_MIN || body.length > BODY_MAX) return `body_length_${body.length}`;
  if (/<[a-z/][^>]*>/i.test(body)) return "html";
  if (COMPANY_CLAIMS.test(body)) return "company_claim";
  if (productFamily(product) === "third_party" && /\b(der|die|das|ein|eine)\s+META\b/i.test(body)) return "third_party_as_meta";
  const source = productSourceText(product, SOURCE_DESCRIPTION_CHARS);
  const allowed = digitForms(source);
  for (const token of body.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const whole = token.replace(/[.,]/g, "");
    const runs = token.match(/\d+/g) ?? [];
    if (!allowed.has(whole) && !runs.every((r) => allowed.has(r))) return `number_${token}`;
  }
  const conflict = nameValueConflict(product.name, body);
  if (conflict) return conflict;
  for (const [pattern, reason] of CLAIM_RULES) {
    if (pattern.test(body) && !pattern.test(source)) return `claim_${reason}`;
  }
  return null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildDescriptionHtml(gen: GeneratedDescription, family: ProductFamily): string {
  return [
    `<p>${escapeHtml(gen.intro.trim())}</p>`,
    `<ul>${gen.bullets.map((b) => `<li>${escapeHtml(b.trim())}</li>`).join("")}</ul>`,
    `<p>${escapeHtml(gen.suitableFor.trim())}</p>`,
    CLOSING_SENTENCES[family] ? `<p>${escapeHtml(CLOSING_SENTENCES[family])}</p>` : "",
  ].join("");
}

/** Klartext-Laenge des fertigen Texts (fuer die Excel-Spalte). */
export function htmlTextLength(html: string): number {
  return descriptionText(html).length;
}

// ---------------------------------------------------------------------------------------------
// KI

const SYSTEM_PROMPT = `Du schreibst kurze Produktbeschreibungen für den Onlineshop von META Regalbau (Regale, Lagertechnik, Zubehör). Ziel: gute Auffindbarkeit in Google und in KI-Suchen (ChatGPT, Perplexity, Google AI Overviews) – also klare, sachliche Aussagen mit konkreten Daten statt Werbefloskeln.
Für jeden Artikel liefere:
- intro: 2–3 Sätze (${INTRO_MIN}–${INTRO_MAX} Zeichen). Der erste Satz sagt eindeutig und mit verständlicher Bezeichnung (nicht dem alten Kurznamen), was der Artikel ist („Das META CLIP S3 Anbauregal ist ein verzinktes Fachbodenregal …“), der zweite, wofür und für wen er sich eignet bzw. welchen Nutzen er bringt.
- bullets: 4–6 Stichpunkte (bei Kleinteilen mindestens 3) mit je höchstens ${BULLET_MAX} Zeichen: Kerndaten mit Einheit (Maße H x B x T, Fachlast, Ebenen/Böden, Oberfläche, Bauart) und Besonderheiten (z. B. werkzeuglose Montage, Raster, Erweiterbarkeit, Kompatibilität) – nur, was im Artikel steht. Format "Merkmal: Wert" wo sinnvoll.
- suitableFor: ein Satz, beginnend mit „Geeignet für“ (höchstens ${SUITABLE_MAX} Zeichen), konkrete Einsatzorte/Branchen.
Regeln:
- Nur Fakten aus Name, Eigenschaften und Beschreibung. Keine Zahl, kein Maß, keine Last, die dort nicht steht.
- Nennt der Name Maße oder Fachlast (neue Namen mit "|"), gelten genau diese Werte – auch wenn Eigenschaften oder Beschreibung andere nennen. Nur bei alten Kurznamen ohne solche Angaben die Eigenschaften nutzen.
- Keine Firmenangaben (Made in Germany, Garantie, Zertifikate, GS, ISO, Ersatzteilservice) – die werden separat ergänzt.
- Keine Preise, Rabatte, Lieferzeiten, Versandkosten. Oberfläche genau wie im Artikel; aus einer RAL-Farbe nicht „pulverbeschichtet“ machen, außer es steht im Artikel.
- Ein Anbauregal ist eine Erweiterung (braucht ein Grundregal); ein Grundregal steht für sich. Zubehör nicht als komplettes Regal beschreiben.
- Typkürzel und Bezeichnungen wie "VW2 N", "T1 N", "SR 120/25", "4HN", "FAZ II" unverändert übernehmen und NICHT ausdeuten (nicht raten, wofür sie stehen).
- Abkürzungen: "kpl" = komplett, "vzk" = verzinkt, "ER"/"DR" = einseitig/doppelseitig, "GR"/"AR" = Grundregal/Anbauregal, "KR" = Kragarm, "MP" = MULTIPAL, "CL" = CLIP. Was sich nicht sicher deuten lässt, weglassen.
- Sie-Form oder neutral, kein HTML, keine Emojis, keine Ausrufezeichen-Reihen. Abwechslungsreich formulieren.
Antworte nur mit JSON: {"items":[{"nr":"<Artikelnummer>","intro":"...","bullets":["...","..."],"suitableFor":"Geeignet für ..."}]} – für jeden Artikel genau ein Eintrag.`;

function buildUserPrompt(batch: ProductMetaSource[], feedback?: Map<string, string>): string {
  const lines: string[] = ["ARTIKEL:"];
  for (const p of batch) {
    lines.push(`### nr=${p.productNumber}\n${productSourceText(p, SOURCE_DESCRIPTION_CHARS)}`);
    if (productFamily(p) === "third_party") {
      lines.push("HINWEIS: Fremdware, nicht von META hergestellt – nicht als META-Produkt bezeichnen (\"passend für META …\" ist erlaubt).");
    }
    const note = feedback?.get(p.productNumber);
    if (note) lines.push(`HINWEIS: Der letzte Vorschlag wurde verworfen (${note}). Bitte die Regeln genau einhalten.`);
  }
  return lines.join("\n");
}

const itemSchema = z.object({
  nr: z.union([z.string(), z.number()]).transform(String),
  intro: z.string(),
  bullets: z.array(z.string()),
  suitableFor: z.string(),
});

export type DescriptionGenerator = (
  batch: ProductMetaSource[],
  feedback?: Map<string, string>,
) => Promise<Map<string, GeneratedDescription>>;

export function llmDescriptionGenerator(getSetting: (key: string) => Promise<any>): DescriptionGenerator {
  return async (batch, feedback) => {
    const text = await chatCompletion(getSetting, {
      tier: "smart",
      temperature: 0.4,
      max_tokens: 8000,
      response_json: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserPrompt(batch, feedback) },
      ],
    });
    const parsed = parseLlmJsonResponse(text) as { items?: unknown };
    const out = new Map<string, GeneratedDescription>();
    for (const raw of Array.isArray(parsed?.items) ? parsed.items : []) {
      const item = itemSchema.safeParse(raw);
      if (item.success) {
        out.set(item.data.nr.trim(), {
          intro: item.data.intro.trim(),
          bullets: item.data.bullets.map((b) => b.trim()).filter(Boolean),
          suitableFor: item.data.suitableFor.trim(),
        });
      }
    }
    return out;
  };
}

// ---------------------------------------------------------------------------------------------
// Lauf (ohne Schreiben in den Shop)

export type DescriptionRow = {
  productNumber: string;
  ifsNumber: string;
  name: string;
  family: ProductFamily;
  html: string;
  textLength: number;
  oldTextLength: number;
  oldHtml: string;
  /** leer = in Ordnung; sonst Grund, warum kein Text entstand */
  problem: string;
};

export async function generateDescriptions(
  products: ProductMetaSource[],
  generate: DescriptionGenerator,
  options: {
    batchSize?: number;
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    /** Je Welle die fertigen Zeilen (Zwischenstand sichern) */
    onRows?: (rows: DescriptionRow[]) => void;
  } = {},
): Promise<DescriptionRow[]> {
  const batchSize = options.batchSize ?? 6;
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const batches: ProductMetaSource[][] = [];
  for (let i = 0; i < products.length; i += batchSize) batches.push(products.slice(i, i + batchSize));
  const rows: DescriptionRow[] = [];
  let done = 0;

  const runBatch = async (batch: ProductMetaSource[]) => {
    const accepted = new Map<string, GeneratedDescription>();
    const reasons = new Map<string, string>();
    let pending = batch;
    for (let attempt = 0; attempt < 2 && pending.length > 0; attempt++) {
      let generated = new Map<string, GeneratedDescription>();
      try {
        generated = await generate(pending, attempt > 0 ? new Map(reasons) : undefined);
      } catch (err) {
        reasons.set("__error__", err instanceof Error ? err.message : String(err));
      }
      const next: ProductMetaSource[] = [];
      for (const p of pending) {
        const gen = generated.get(p.productNumber);
        const reason = gen ? validateGeneratedDescription(p, gen) : "missing";
        if (gen && !reason) {
          accepted.set(p.productNumber, gen);
          reasons.delete(p.productNumber);
        } else {
          reasons.set(p.productNumber, reason ?? "missing");
          next.push(p);
        }
      }
      pending = next;
    }
    return batch.map((p): DescriptionRow => {
      const family = productFamily(p);
      const gen = accepted.get(p.productNumber);
      const html = gen ? buildDescriptionHtml(gen, family) : "";
      const ifs = p.customFields?.wdu_ifs_productnumber;
      return {
        productNumber: p.productNumber,
        ifsNumber: ifs === undefined || ifs === null ? "" : String(ifs),
        name: p.name,
        family,
        html,
        textLength: html ? htmlTextLength(html) : 0,
        oldTextLength: descriptionText(p.description).length,
        oldHtml: p.description,
        problem: gen ? "" : reasons.get(p.productNumber) ?? "missing",
      };
    });
  };

  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = batches.slice(i, i + concurrency);
    const results = await Promise.all(wave.map(runBatch));
    for (const r of results) rows.push(...r);
    options.onRows?.(results.flat());
    done += wave.reduce((n, b) => n + b.length, 0);
    options.onProgress?.(done, products.length);
  }
  return rows;
}
