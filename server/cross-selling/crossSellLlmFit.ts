// KI-Fachpruefung von Cross-Selling-Paaren: passt das Ziel fachlich zur Quelle (Regalsystem,
// Masse, Ergaenzung statt Alternative)? Eine Anfrage je Quelle mit bis zu 12 Zielen.
// Ergebnisse werden im Gedaechtnis (cross_sell_pair_state.llm_*) mit Eingabe-Hash gespeichert.
import { createHash } from "crypto";
import { z } from "zod";
import { chatCompletion, isChatLlmConfigured, parseLlmJsonResponse, resolveChatTarget } from "../ai/llmChat";
import { logger } from "../lib/logger";

const moduleLog = logger.child({ component: "cross-selling/crossSellLlmFit" });

/** Bei Aenderungen am Prompt erhoehen: alle gespeicherten Urteile gelten dann als veraltet. */
export const LLM_FIT_PROMPT_VERSION = "fit-v1";
export const LLM_FIT_MAX_TARGETS = 12;

/** Was die KI ueber ein Produkt sieht (aus dem Produktspiegel). */
export type FitProduct = {
  productNumber: string;
  name: string | null;
  categories?: string[];
  properties?: Array<{ groupName: string; optionName: string }>;
};

export function summarizeFitProduct(p: FitProduct): string {
  const props = (p.properties ?? [])
    .slice(0, 14)
    .map((x) => `${x.groupName}: ${x.optionName}`)
    .join("; ");
  return [
    `nr=${p.productNumber}`,
    `name=${(p.name ?? "").trim()}`,
    p.categories?.length ? `kategorien=${p.categories.slice(0, 4).join(", ")}` : "",
    props ? `eigenschaften=${props}` : "",
  ]
    .filter(Boolean)
    .join(" | ");
}

/** Hash je Paar: aendert sich ein Produkt oder der Prompt, wird neu geprueft. */
export function fitInputHash(source: FitProduct, target: FitProduct): string {
  return createHash("sha256")
    .update(`${LLM_FIT_PROMPT_VERSION}\n${summarizeFitProduct(source)}\n${summarizeFitProduct(target)}`)
    .digest("hex")
    .slice(0, 40);
}

export type FitResult = {
  verdict: "fit" | "unsure" | "no_fit";
  relation: "accessory" | "component" | "consumable" | "alternative" | "unrelated";
  confidence: number;
  reason: string;
};

const RELATIONS = ["accessory", "component", "consumable", "alternative", "unrelated"] as const;

const requiredText = z.union([z.string().min(1), z.number()]).transform(String);

const rawItemSchema = z.object({
  productNumber: requiredText,
  verdict: requiredText,
  relation: z.coerce.string().optional(),
  confidence: z.coerce.number().optional(),
  reason: z.coerce.string().optional(),
});

/**
 * KI-Antwort tolerant einlesen: jeder Eintrag einzeln; Ausreisser (unbekannter Beziehungstyp,
 * Sicherheit als Text oder in Prozent, zu lange Begruendung) werden normalisiert statt die
 * ganze Antwort zu verwerfen.
 */
export function parseFitResponse(parsed: unknown): Array<FitResult & { productNumber: string }> | null {
  const list = Array.isArray(parsed) ? parsed : Array.isArray((parsed as { results?: unknown })?.results) ? (parsed as { results: unknown[] }).results : null;
  if (!list) return null;
  const out: Array<FitResult & { productNumber: string }> = [];
  for (const item of list) {
    const r = rawItemSchema.safeParse(item);
    if (!r.success) continue;
    const v = r.data.verdict.trim().toLowerCase().replace(/[\s-]+/g, "_");
    const verdict: FitResult["verdict"] = v === "fit" || v === "no_fit" || v === "unsure" ? v : v === "nofit" ? "no_fit" : "unsure";
    const rel = (r.data.relation ?? "").trim().toLowerCase();
    const relation: FitResult["relation"] = (RELATIONS as readonly string[]).includes(rel)
      ? (rel as FitResult["relation"])
      : /part|teil|component|bauteil|extension/.test(rel)
        ? "component"
        : /zubeh|access/.test(rel)
          ? "accessory"
          : "unrelated";
    let confidence = Number.isFinite(r.data.confidence) ? (r.data.confidence as number) : 0;
    if (confidence > 1 && confidence <= 100) confidence /= 100;
    confidence = Math.max(0, Math.min(1, confidence));
    out.push({ productNumber: r.data.productNumber.trim(), verdict, relation, confidence, reason: (r.data.reason ?? "").slice(0, 200) });
  }
  return out;
}

/**
 * JSON aus der KI-Antwort holen: direkt, sonst den Block zwischen erster "{" und letzter "}"
 * (Text davor/danach), sonst die einzelnen Eintraege (abgeschnittene Antwort).
 */
export function extractFitJson(text: string): unknown {
  const direct = parseLlmJsonResponse(text);
  if (direct && typeof direct === "object" && (Array.isArray(direct) || Array.isArray((direct as { results?: unknown }).results))) return direct;
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      const block = JSON.parse(text.slice(first, last + 1));
      if (block && Array.isArray((block as { results?: unknown }).results)) return block;
    } catch {
      // weiter mit einzelnen Eintraegen
    }
  }
  const items: unknown[] = [];
  for (const m of text.matchAll(/\{[^{}]*"productNumber"[^{}]*\}/g)) {
    try {
      items.push(JSON.parse(m[0]));
    } catch {
      // unvollstaendiger Eintrag
    }
  }
  return items.length > 0 ? { results: items } : direct;
}

const SYSTEM_PROMPT = `Du bist Fachberater fuer Lager- und Fachbodenregale (Hersteller META) und pruefst Cross-Selling-Vorschlaege fuer einen Onlineshop.
Fuer jedes ZIEL entscheidest du, ob es als Ergaenzung zur QUELLE angeboten werden sollte.
Pruefe:
- Gleiches oder kompatibles Regalsystem bzw. gleiche Serie (z. B. CLIP nur mit CLIP-Zubehoer, MULTISTRONG nur mit MULTISTRONG).
- Masse: Fachboeden, Rueckwaende, Trennbleche usw. muessen zu Breite/Tiefe der Quelle passen, Zubehoer zur Hoehe.
- Ergaenzung statt Alternative: ein anderes Regal in anderer Groesse ist eine Alternative (relation "alternative"), kein Cross-Selling.
relation: "accessory" (Zubehoer), "component" (Bauteil/Erweiterung, z. B. Anbauregal, Zusatzboden), "consumable" (Verbrauchsmaterial, Kleinteile), "alternative" (Ersatzprodukt/andere Groesse), "unrelated".
verdict: "fit" nur bei klarer fachlicher Passung; "unsure", wenn Angaben fehlen; sonst "no_fit".
confidence: 0 bis 1. reason: hoechstens 200 Zeichen, Deutsch, konkret (z. B. "Fachboden 1300x600 passt zu Regal 1300x600, gleiches System CLIP").
Antworte NUR als JSON: {"results":[{"productNumber":"...","verdict":"fit|unsure|no_fit","relation":"...","confidence":0.0,"reason":"..."}]}`;

export type FitCallOutcome =
  | { ok: true; results: Map<string, FitResult>; model: string }
  | { ok: false; reason: "not_configured" | "error"; error?: string };

/**
 * Prueft bis zu 12 Ziele fuer eine Quelle. Abgelehnte Beispiele (Grund + Paar) helfen der KI,
 * die Massstaebe des Teams zu treffen. Unbekannte Artikelnummern in der Antwort werden verworfen.
 */
export async function checkCrossSellFit(params: {
  getSetting: (key: string) => Promise<any>;
  source: FitProduct;
  targets: FitProduct[];
  rejectedExamples?: Array<{ source: string; target: string; reason: string }>;
}): Promise<FitCallOutcome> {
  const targets = params.targets.slice(0, LLM_FIT_MAX_TARGETS);
  if (targets.length === 0) return { ok: true, results: new Map(), model: "" };
  if (!(await isChatLlmConfigured(params.getSetting))) return { ok: false, reason: "not_configured" };

  const lines = [
    `QUELLE: ${summarizeFitProduct(params.source)}`,
    "ZIELE:",
    ...targets.map((t) => `- ${summarizeFitProduct(t)}`),
  ];
  if (params.rejectedExamples?.length) {
    lines.push("", "Vom Team frueher ABGELEHNT (als Massstab):");
    for (const ex of params.rejectedExamples.slice(0, 10)) {
      lines.push(`- ${ex.source} -> ${ex.target}: ${ex.reason}`);
    }
  }

  try {
    const { model } = await resolveChatTarget(params.getSetting, "smart");
    const ask = () =>
      chatCompletion(params.getSetting, {
        tier: "smart",
        temperature: 0.1,
        max_tokens: 2600,
        response_json: true,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: lines.join("\n") },
        ],
      });
    // Gelegentlich bricht eine Antwort nach wenigen Zeichen ab: dann genau einmal neu fragen
    let text = await ask();
    let items = parseFitResponse(extractFitJson(text));
    if (!items || items.length === 0) {
      text = await ask();
      items = parseFitResponse(extractFitJson(text));
    }
    if (!items) {
      moduleLog.warn(
        { source: params.source.productNumber, length: text.length, start: text.slice(0, 200), end: text.slice(-200) },
        "KI-Fachpruefung: Antwort nicht lesbar",
      );
      return { ok: false, reason: "error", error: "invalid_response" };
    }
    const allowed = new Set(targets.map((t) => t.productNumber));
    const results = new Map<string, FitResult>();
    for (const { productNumber, ...r } of items) {
      if (allowed.has(productNumber)) results.set(productNumber, r);
    }
    return { ok: true, results, model };
  } catch (err: any) {
    moduleLog.warn({ err, source: params.source.productNumber }, "KI-Fachpruefung fehlgeschlagen");
    return { ok: false, reason: "error", error: err?.message || String(err) };
  }
}
