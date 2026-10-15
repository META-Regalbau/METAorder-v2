// Texte fuer Kategorieseiten (SEO/GEO): Einleitung ueber der Liste, SEO-Text mit Zwischenueberschriften
// und Massetabelle unter der Liste, FAQ. Fuer Freigabe per Excel, nicht direkt in den Shop.
//
// Die Fakten (Systeme, Masse, Lasten, Ebenen, Oberflaechen) kommen aus den Produkten der Kategorie.
// Die Massetabelle baut der Code aus diesen Fakten - die KI schreibt nur Fliesstext und FAQ, und jede
// Zahl darin muss in den Fakten stehen. Herstellerangaben nur, wenn sie fuer die Familie belegt sind.
import { z } from "zod";
import { chatCompletion, parseLlmJsonResponse } from "../ai/llmChat";
import { CLAIM_RULES, digitForms, expandAbbreviations } from "./productMetaTexts";
import { parseCatalogName } from "../cross-selling/crossSellNameRules";

export const CATEGORY_PROMPT_VERSION = "cat-v1";

export type CategoryProduct = { name: string; properties: Array<{ group: string; option: string }> };

export type CategoryFacts = {
  id: string;
  name: string;
  url: string;
  breadcrumb: string;
  productCount: number;
  systems: string[];
  shelfTypes: string[];
  heights: number[];
  widths: number[];
  depths: number[];
  loads: Array<{ label: string; values: number[] }>;
  levels: string[];
  surfaces: string[];
  /** Weitere Merkmale aus den Eigenschaften (Gruppe -> Werte), nur wenige verschiedene Werte */
  features: Array<{ label: string; values: string[] }>;
  topProducts: string[];
  /** Belegte Herstellerangaben der Familie (aus den heutigen Texten) */
  familyClaims: string | null;
};

const FAMILY_CLAIMS: Array<[RegExp, string]> = [
  [/\bCLIP\b/, "META CLIP ist „Made in Germany“, mit 5 Jahren META-Qualitätsgarantie und Ersatzteilservice; Zertifizierungen u. a. GS, DIN EN ISO 9001:2015, RAL-Gütesicherung."],
  [/MULTIPAL/, "META MULTIPAL Palettenregale sind gütegesichert nach RAL-RG 614/2, tragen das GS-Zeichen und sind DIBt-zugelassen; statische Nachweise nach DIN EN 15512."],
  [/ATLAS/, "META ATLAS ST ist durch GS-Zertifikat und RAL-Gütezeichen bestätigt, mit 5 Jahren Herstellergarantie."],
];

const uniqSorted = (values: number[]) => [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function propNumber(p: CategoryProduct, group: RegExp): number | null {
  const prop = p.properties.find((x) => group.test(x.group));
  const m = prop?.option.match(/(\d[\d.,]*)/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}

/** Fakten einer Kategorie aus ihren Produkten (Name im neuen Schema hat Vorrang vor Eigenschaften). */
export function buildCategoryFacts(
  meta: { id: string; name: string; url: string; breadcrumb: string },
  products: CategoryProduct[],
): CategoryFacts {
  const heights: number[] = [];
  const widths: number[] = [];
  const depths: number[] = [];
  const loadMap = new Map<string, number[]>();
  const levels: string[] = [];
  const surfaces: string[] = [];
  const systems: string[] = [];
  const shelfTypes: string[] = [];
  for (const p of products) {
    const parsed = parseCatalogName(p.name);
    if (parsed) {
      systems.push(parsed.system);
      if (parsed.role) shelfTypes.push(parsed.role);
      if (parsed.dims.length === 3) {
        heights.push(parsed.dims[0]);
        widths.push(parsed.dims[1]);
        depths.push(parsed.dims[2]);
      }
      for (const seg of parsed.segments) {
        const load = seg.match(/^(Fachlast|Feldlast|Armlast)\s+(\d[\d.,]*)\s*kg$/i);
        if (load) loadMap.set(load[1], [...(loadMap.get(load[1]) ?? []), Number(load[2].replace(/\./g, ""))]);
        if (/Ebenen$/.test(seg)) levels.push(seg.replace(/\s*Ebenen$/, ""));
      }
      if (parsed.surface) surfaces.push(parsed.segments.find((s) => s.toLowerCase() === parsed.surface) ?? parsed.surface);
    } else {
      const h = propNumber(p, /^Höhe$/i);
      const b = propNumber(p, /^Breite$/i);
      const t = propNumber(p, /^Tiefe$/i);
      if (h) heights.push(h);
      if (b) widths.push(b);
      if (t) depths.push(t);
    }
  }
  // Merkmale aus Eigenschaften: nur aussagekraeftige Gruppen mit wenigen Werten
  const featureGroups: Array<[RegExp, string]> = [
    [/^Aufbauart$/i, "Aufbauart"],
    [/^Bauweise$/i, "Bauweise"],
    [/^Nutzung$/i, "Nutzung"],
    [/^Verstellraster \(Höhe\)$/i, "Verstellraster (Höhe)"],
    [/^Ständertyp$|^Rahmentyp/i, "Rahmen-/Ständertyp"],
    [/^Rahmen vormontiert\?$|^Ständer vormontiert\?$/i, "vormontiert"],
    [/^Fahrbar\?$/i, "fahrbar"],
  ];
  const features: Array<{ label: string; values: string[] }> = [];
  for (const [re, label] of featureGroups) {
    const values = uniq(products.flatMap((p) => p.properties.filter((x) => re.test(x.group)).map((x) => x.option)));
    if (values.length > 0 && values.length <= 6) features.push({ label, values });
  }
  const family = FAMILY_CLAIMS.find(([re]) => re.test(`${meta.name} ${systems.join(" ")}`));
  return {
    ...meta,
    productCount: products.length,
    systems: uniq(systems),
    shelfTypes: uniq(shelfTypes),
    heights: uniqSorted(heights),
    widths: uniqSorted(widths),
    depths: uniqSorted(depths),
    loads: [...loadMap].map(([label, values]) => ({ label, values: uniqSorted(values) })),
    levels: uniq(levels).sort((a, b) => parseInt(a) - parseInt(b)),
    surfaces: uniq(surfaces),
    features,
    topProducts: products.slice(0, 8).map((p) => p.name),
    familyClaims: family ? family[1] : null,
  };
}

const fmt = (n: number) => n.toLocaleString("de-DE");
const range = (values: number[], unit: string) =>
  values.length === 0 ? "" : values.length <= 6 ? `${values.map(fmt).join(", ")} ${unit}` : `${fmt(values[0])} bis ${fmt(values[values.length - 1])} ${unit}`;

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Massetabelle aus den Fakten (leer, wenn nichts Belastbares da ist). */
export function factsTableHtml(f: CategoryFacts): string {
  const rows: Array<[string, string]> = [];
  if (f.systems.length) rows.push(["Regalsysteme", f.systems.join(", ")]);
  if (f.shelfTypes.length) rows.push(["Ausführungen", f.shelfTypes.join(", ")]);
  if (f.heights.length) rows.push(["Höhen", range(f.heights, "mm")]);
  if (f.widths.length) rows.push(["Breiten", range(f.widths, "mm")]);
  if (f.depths.length) rows.push(["Tiefen", range(f.depths, "mm")]);
  for (const l of f.loads) rows.push([l.label, range(l.values, "kg")]);
  if (f.levels.length) rows.push(["Ebenen", f.levels.length <= 8 ? f.levels.join(", ") : `${f.levels[0]} bis ${f.levels[f.levels.length - 1]}`]);
  if (f.surfaces.length) rows.push(["Oberflächen", f.surfaces.join(", ")]);
  for (const feat of f.features) if (!/^(vormontiert|fahrbar)$/.test(feat.label)) rows.push([feat.label, feat.values.join(", ")]);
  if (rows.length < 2) return "";
  return `<table><tbody>${rows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
}

export function factsText(f: CategoryFacts): string {
  const lines = [
    `Kategorie: ${f.name} (${f.breadcrumb})`,
    `Anzahl Artikel: ${f.productCount}`,
    f.systems.length ? `Systeme: ${f.systems.join(", ")}` : "",
    f.shelfTypes.length ? `Ausführungen: ${f.shelfTypes.join(", ")}` : "",
    f.heights.length ? `Höhen (mm): ${f.heights.join(", ")}` : "",
    f.widths.length ? `Breiten (mm): ${f.widths.join(", ")}` : "",
    f.depths.length ? `Tiefen (mm): ${f.depths.join(", ")}` : "",
    ...f.loads.map((l) => `${l.label} (kg): ${l.values.join(", ")}`),
    f.levels.length ? `Ebenen: ${f.levels.join(", ")}` : "",
    f.surfaces.length ? `Oberflächen: ${f.surfaces.join(", ")}` : "",
    ...f.features.map((x) => `${x.label}: ${x.values.join(", ")}`),
    `Beispielartikel: ${f.topProducts.join(" ; ")}`,
    f.familyClaims ? `Belegte Herstellerangaben: ${f.familyClaims}` : "Belegte Herstellerangaben: keine",
  ];
  return lines.filter(Boolean).join("\n");
}

// ---------------------------------------------------------------------------------------------
// KI

export type GeneratedCategoryText = {
  h1: string;
  intro: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
  faq: Array<{ q: string; a: string }>;
};

const SYSTEM_PROMPT = `Du schreibst Texte für Kategorieseiten im Onlineshop von META Regalbau (Regale und Lagertechnik, B2B). Ziel: Sichtbarkeit in Google und in KI-Suchen (GEO) und eine gute Kaufentscheidung. Sachlich, konkret, keine Werbefloskeln, Sie-Form.
Liefere als JSON:
- h1: Überschrift der Seite (höchstens 60 Zeichen), Suchbegriff zuerst, z. B. "Fachbodenregale – Grundregale von META CLIP".
- intro: 2–3 Sätze (200–450 Zeichen) für ÜBER der Produktliste: was findet man hier, für wen, wichtigste Auswahlhilfe.
- sections: 3–4 Abschnitte für UNTER der Produktliste, je {heading (Frage oder klare Aussage, höchstens 70 Zeichen), paragraphs: 1–3 Absätze mit je höchstens 450 Zeichen}. Themen: Einsatzbereiche; Auswahl (Maße, Lasten, Grund- vs. Anbauregal, Zubehör); Aufbau/Erweiterung; ggf. Qualität (nur mit den belegten Herstellerangaben).
- faq: 4–6 Fragen, die Kunden vor dem Kauf stellen, mit Antworten von höchstens 350 Zeichen.
Regeln:
- Nur Fakten aus den gelieferten Kategoriedaten. Zahlen (Maße, Lasten, Ebenen, Anzahl) nur, wenn sie dort stehen. Keine erfundenen Normen, Zertifikate, Garantien, Herkunftsangaben – außer wörtlich aus "Belegte Herstellerangaben".
- Keine Preise, Rabatte, Lieferzeiten, Versandkosten.
- Ein Anbauregal braucht ein Grundregal und nutzt dessen Rahmen mit; ein Grundregal steht für sich. Bei Kragarmregalen heißen die Rahmen „Ständer“ (an ihnen hängen die Kragarme), bei Fachboden-, Paletten- und Weitspannregalen „Seitenrahmen“ bzw. „Ständerrahmen“. Das ist allgemeines Regalwissen und darf erklärt werden.
- Konkrete Daten aus den Kategoriedaten nutzen (Maßbereiche, Lasten, Ebenen, Aufbauart, Raster) – sie helfen Kunden und KI-Suchen; nichts darüber hinaus erfinden.
- Typkürzel (T1 N, SR 120/25 …) nicht ausdeuten.
- Kein HTML, keine Emojis, keine Aufzählungszeichen im Text.
Antworte nur mit JSON: {"h1":"…","intro":"…","sections":[{"heading":"…","paragraphs":["…"]}],"faq":[{"q":"…","a":"…"}]}`;

const schema = z.object({
  h1: z.string(),
  intro: z.string(),
  sections: z.array(z.object({ heading: z.string(), paragraphs: z.array(z.string()) })),
  faq: z.array(z.object({ q: z.string(), a: z.string() })),
});

export type CategoryTextGenerator = (facts: CategoryFacts, feedback?: string) => Promise<GeneratedCategoryText | null>;

export function llmCategoryTextGenerator(getSetting: (key: string) => Promise<any>): CategoryTextGenerator {
  return async (facts, feedback) => {
    const text = await chatCompletion(getSetting, {
      tier: "smart",
      temperature: 0.4,
      max_tokens: 6000,
      response_json: true,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: `${factsText(facts)}${feedback ? `\n\nHINWEIS: Der letzte Vorschlag wurde verworfen: ${feedback}. Bitte korrigieren.` : ""}` },
      ],
    });
    const parsed = schema.safeParse(parseLlmJsonResponse(text));
    return parsed.success ? parsed.data : null;
  };
}

// ---------------------------------------------------------------------------------------------
// Pruefen und HTML

const COMPANY_CLAIMS = /made in germany|garantie|gewährleistung|zertifi|gütesicher|gütezeichen|\bgs[- ]|\bdibt\b|iso\s?\d{4,5}|din en|ral-rg/i;

export function categoryTextPlain(g: GeneratedCategoryText): string {
  return [g.h1, g.intro, ...g.sections.flatMap((s) => [s.heading, ...s.paragraphs]), ...g.faq.flatMap((f) => [f.q, f.a])].join(" ");
}

/** null = in Ordnung, sonst Grund (verstaendlich, geht als Hinweis an die KI zurueck). */
export function validateCategoryText(f: CategoryFacts, g: GeneratedCategoryText): string | null {
  if (g.h1.trim().length < 10 || g.h1.trim().length > 60) return `Überschrift (h1) 10–60 Zeichen, war ${g.h1.trim().length}`;
  if (g.intro.trim().length < 180 || g.intro.trim().length > 480) return `Einleitung 200–450 Zeichen, war ${g.intro.trim().length}`;
  if (g.sections.length < 3 || g.sections.length > 4) return `3–4 Abschnitte, waren ${g.sections.length}`;
  for (const s of g.sections) {
    if (!s.heading.trim() || s.heading.length > 80) return "Abschnittsüberschriften höchstens 70 Zeichen";
    if (s.paragraphs.length < 1 || s.paragraphs.length > 3) return "1–3 Absätze je Abschnitt";
    if (s.paragraphs.some((p) => p.length > 520)) return "Absätze höchstens 450 Zeichen";
  }
  if (g.faq.length < 4 || g.faq.length > 6) return `4–6 FAQ, waren ${g.faq.length}`;
  if (g.faq.some((x) => !x.q.trim().endsWith("?"))) return "FAQ: jede Frage endet mit Fragezeichen";
  const longFaq = g.faq.find((x) => x.a.length > 450);
  if (longFaq) return `FAQ-Antwort höchstens 350 Zeichen (eine hatte ${longFaq.a.length})`;
  const plain = categoryTextPlain(g);
  if (/<[a-z/][^>]*>/i.test(plain)) return "kein HTML im Text";
  const source = factsText(f);
  const allowed = digitForms(source);
  for (const token of plain.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const whole = token.replace(/[.,]/g, "");
    const runs = token.match(/\d+/g) ?? [];
    if (!allowed.has(whole) && !runs.every((r) => allowed.has(r))) return `die Zahl ${token} steht nicht in den Kategoriedaten – weglassen`;
  }
  const claims = f.familyClaims ?? "";
  for (const m of plain.match(new RegExp(COMPANY_CLAIMS.source, "gi")) ?? []) {
    if (!claims.toLowerCase().includes(m.toLowerCase())) return `Herstellerangabe „${m}“ ist für diese Kategorie nicht belegt – weglassen`;
  }
  const sourceExpanded = expandAbbreviations(source);
  for (const [pattern, reason] of CLAIM_RULES) {
    if (reason === "certificate" || reason === "warranty" || reason === "origin") continue; // oben über familyClaims geprüft
    if (pattern.test(plain) && !pattern.test(sourceExpanded)) return `keine Angaben zu ${reason === "price" ? "Preisen" : reason === "delivery" || reason === "shipping" ? "Lieferung/Versand" : "Oberflächenbehandlung"}, die nicht in den Daten stehen`;
  }
  return null;
}

export function buildCategoryHtml(f: CategoryFacts, g: GeneratedCategoryText): { introHtml: string; seoHtml: string; faqHtml: string; faqJson: string } {
  const p = (t: string) => `<p>${escapeHtml(t.trim())}</p>`;
  const table = factsTableHtml(f);
  const sections = g.sections.map((s) => `<h2>${escapeHtml(s.heading.trim())}</h2>${s.paragraphs.map(p).join("")}`);
  if (table) sections.splice(Math.min(1, sections.length), 0, `<h2>${escapeHtml(f.name)}: Maße und Ausführungen im Überblick</h2>${table}`);
  return {
    introHtml: p(g.intro),
    seoHtml: sections.join(""),
    faqHtml: `<h2>Häufige Fragen</h2>${g.faq.map((x) => `<h3>${escapeHtml(x.q.trim())}</h3>${p(x.a)}`).join("")}`,
    faqJson: JSON.stringify(g.faq.map((x) => ({ q: x.q.trim(), a: x.a.trim() }))),
  };
}

export async function generateCategoryText(
  facts: CategoryFacts,
  generate: CategoryTextGenerator,
): Promise<{ text: GeneratedCategoryText | null; problem: string }> {
  let feedback: string | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    let g: GeneratedCategoryText | null = null;
    try {
      g = await generate(facts, feedback);
    } catch (err) {
      feedback = undefined;
      if (attempt === 2) return { text: null, problem: err instanceof Error ? err.message : String(err) };
      continue;
    }
    if (!g) {
      feedback = "Antwort war kein gültiges JSON im verlangten Format";
      continue;
    }
    const reason = validateCategoryText(facts, g);
    if (!reason) return { text: g, problem: "" };
    feedback = reason;
  }
  return { text: null, problem: feedback ?? "unbekannt" };
}
