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
import { catalogFactsFor, ignoredShopFeaturesFor } from "./catalogFacts";

export const CATEGORY_PROMPT_VERSION = "cat-v6";

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
  /** Merkmale je System, wenn sie sich zwischen den Systemen unterscheiden (z. B. MINI-RACK Schraub-, SPEED-RACK Steckregal) */
  systemFeatures: Array<{ system: string; values: string[] }>;
  topProducts: string[];
  /** Belegte Herstellerangaben der Familie (aus den heutigen Texten) */
  familyClaims: string | null;
  /** Belegte Systemaussagen aus dem META-Bestellkatalog (catalogFacts.ts), mit Seitenzahl */
  catalogFacts: Array<{ text: string; page: number; system: string }>;
};

// Katalog S. 14: Produktion in Deutschland nur CLIP, FIX, MINI-RACK, SPEED-RACK, MULTIPAL; Garantie auf einen
// Grossteil der Fachboden-, Weitspann-, Paletten- und Kragarmregale; ISO 9001 ist ein Unternehmenszertifikat.
const FAMILY_CLAIMS: Array<[RegExp, string]> = [
  [/\bCLIP\b|^CL\s/i, "META CLIP wird am Unternehmensstandort Deutschland produziert („Made in Germany“). META gibt eine 5-jährige Qualitätsgarantie auf einen Großteil der stationären Fachbodenregale (Ausnahmen in den Garantiebedingungen) und bietet Ersatzteilservice. META CLIP trägt das GS-Zeichen (Schranktüren und Schubladen ausgenommen), ist RAL-gütegesichert (RAL-RG 614/1) und hat eine DIBt-Teilzulassung; META ist nach DIN EN ISO 9001:2015 zertifiziert."],
  [/MULTIPAL|^MP\s/i, "META MULTIPAL Palettenregale sind gütegesichert nach RAL-RG 614/2, tragen das GS-Zeichen und sind DIBt-zugelassen; statische Nachweise nach DIN EN 15512. META MULTIPAL wird am Unternehmensstandort Deutschland produziert („Made in Germany“); 5-jährige Qualitätsgarantie auf einen Großteil der stationären Palettenregale."],
  [/MINI-?RACK|SPEED-?RACK/i, "META MINI-RACK und META SPEED-RACK werden am Unternehmensstandort Deutschland produziert („Made in Germany“); 5-jährige Qualitätsgarantie auf einen Großteil der stationären Weitspannregale."],
  [/ATLAS/i, "META ATLAS ST ist durch GS-Zertifikat und RAL-Gütezeichen bestätigt, mit 5 Jahren Herstellergarantie."],
  [/MULTISTRONG/i, "META MULTISTRONG LIGHT und MEDIUM sind gütegesichert nach RAL-RG 614/5; 5-jährige Qualitätsgarantie auf einen Großteil der stationären Kragarmregale."],
];

const uniqSorted = (values: number[]) => [...new Set(values.filter((v) => Number.isFinite(v) && v > 0))].sort((a, b) => a - b);
const uniq = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];

function propNumber(p: CategoryProduct, group: RegExp): number | null {
  const prop = p.properties.find((x) => group.test(x.group));
  const m = prop?.option.match(/(\d[\d.,]*)/);
  return m ? Number(m[1].replace(/\./g, "").replace(",", ".")) : null;
}

/** Ab so vielen Artikeln bekommt ein System eigene Angaben "Je System". */
const MIN_SYSTEM_PRODUCTS = 5;

/** "0 mm" beim Verstellraster heisst: fest, nicht verstellbar (z. B. Kragarme bei ATLAS ST). */
function featureValue(option: string): string {
  return /^0\s*mm$/i.test(option.trim()) ? "nicht verstellbar" : option.trim();
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
        // "4 Felder | 2000 x 5400 x 500 mm": 5400 ist die Laenge der Regalzeile, keine Regalbreite
        const fields = parsed.segments.map((seg) => seg.match(/^(\d+)\s*Felder$/)).find(Boolean);
        if (!fields || Number(fields[1]) <= 1) widths.push(parsed.dims[1]);
        depths.push(parsed.dims[2]);
      }
      for (const seg of parsed.segments) {
        const load = seg.match(/^(Fachlast|Feldlast|Armlast)\s+(\d[\d.,]*)\s*kg$/i);
        if (load) loadMap.set(load[1], [...(loadMap.get(load[1]) ?? []), Number(load[2].replace(/\./g, ""))]);
        // nur saubere Werte ("5", "4+1"); kaputte Namen wie "Fachlast 2800 kg| 3 Ebenen" auslassen
        const level = seg.match(/^(\d+(?:\+\d+)?)\s*Ebenen$/);
        if (level) levels.push(level[1]);
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
    // Eigenschaft sagt nur, ob Rahmen/Staender vormontiert sind – nicht das ganze Regal
    [/^Rahmen vormontiert\?$/i, "Rahmen vormontiert"],
    [/^Ständer vormontiert\?$/i, "Ständer vormontiert"],
    [/^Fahrbar\?$/i, "fahrbar"],
  ];
  const features: Array<{ label: string; values: string[] }> = [];
  // Wo der Katalog den Aufbau beschreibt, gilt die Shop-Eigenschaft nicht (z. B. "Schraubregal" bei MULTIPAL)
  const ignored = ignoredShopFeaturesFor(meta.name);
  for (const [re, label] of featureGroups.filter(([, l]) => !ignored.has(l))) {
    // "0 mm" (z. B. Verstellraster bei festen Kragarmen) ist kein Merkmal, sondern "nicht vorhanden"
    const values = uniq(products.flatMap((p) => p.properties.filter((x) => re.test(x.group)).map((x) => featureValue(x.option))));
    if (values.length > 0 && values.length <= 6) features.push({ label, values });
  }
  // Merkmale je System: nur wenn es mehrere Systeme gibt und sich die Werte unterscheiden
  const perSystem = new Map<string, Map<string, Set<string>>>();
  const addSys = (sys: string, label: string, value: string) => {
    if (!perSystem.has(sys)) perSystem.set(sys, new Map());
    const m = perSystem.get(sys)!;
    if (!m.has(label)) m.set(label, new Set());
    m.get(label)!.add(value);
  };
  for (const p of products) {
    const parsed = parseCatalogName(p.name);
    const sys = parsed?.system;
    if (!sys || !/^META\s/.test(sys)) continue;
    if (parsed && parsed.dims.length === 3) addSys(sys, "Regalart", parsed.role ?? "Komplettregal");
    if (parsed && parsed.dims.length === 3) {
      addSys(sys, "Höhen (mm)", String(parsed.dims[0]));
      const fields = parsed.segments.map((seg) => seg.match(/^(\d+)\s*Felder$/)).find(Boolean);
      if (!fields || Number(fields[1]) <= 1) addSys(sys, "Breiten (mm)", String(parsed.dims[1]));
      addSys(sys, "Tiefen (mm)", String(parsed.dims[2]));
    }
    for (const seg of parsed?.segments ?? []) {
      const load = seg.match(/^(Fachlast|Feldlast|Armlast)\s+(\d[\d.,]*)\s*kg$/i);
      if (load) addSys(sys, `${load[1]} (kg)`, load[2].replace(/\./g, ""));
    }
    for (const [re, label] of featureGroups.filter(([, l]) => !ignored.has(l))) {
      for (const x of p.properties.filter((o) => re.test(o.group))) addSys(sys, label, featureValue(x.option));
    }
  }
  // Systeme mit sehr wenigen Artikeln (z. B. 1 CLIP SPLIT) sagen nichts ueber das System aus
  const systemCounts = new Map<string, number>();
  for (const p of products) {
    const sys = parseCatalogName(p.name)?.system;
    if (sys) systemCounts.set(sys, (systemCounts.get(sys) ?? 0) + 1);
  }
  for (const sys of [...perSystem.keys()]) if ((systemCounts.get(sys) ?? 0) < MIN_SYSTEM_PRODUCTS) perSystem.delete(sys);
  const systemFeatures: Array<{ system: string; values: string[] }> = [];
  if (perSystem.size > 1) {
    const labels = new Set([...perSystem.values()].flatMap((m) => [...m.keys()]));
    // nur Merkmale, die alle Systeme haben (fehlende Eigenschaft ist kein Unterschied)
    const differing = [...labels].filter(
      (label) => [...perSystem.values()].every((m) => m.has(label)) && new Set([...perSystem.values()].map((m) => [...m.get(label)!].sort().join("/"))).size > 1,
    );
    for (const [sys, m] of perSystem) {
      const sorted = (l: string) => [...m.get(l)!].sort((a, b) => (Number(a) && Number(b) ? Number(a) - Number(b) : a.localeCompare(b)));
      const values = differing.filter((l) => m.has(l)).map((l) => `${l}: ${sorted(l).join(", ")}`);
      if (values.length) systemFeatures.push({ system: sys, values });
    }
  }
  // Herstellerangaben nur, wenn die Kategorie selbst zur Familie gehoert UND ihre Artikel ueberwiegend
  // (mind. 80 %) aus dieser Familie stammen - ein einzelner Kombi-Artikel reicht nicht.
  const family = FAMILY_CLAIMS.find(([re]) => {
    if (!re.test(meta.name)) return false;
    const inFamily = products.filter((p) => re.test(parseCatalogName(p.name)?.system ?? p.name)).length;
    return products.length > 0 && inFamily / products.length >= 0.8;
  });
  return {
    ...meta,
    productCount: products.length,
    systems: uniq(systems.filter((x) => /^META\s/.test(x))),
    shelfTypes: uniq(shelfTypes),
    heights: uniqSorted(heights),
    widths: uniqSorted(widths),
    depths: uniqSorted(depths),
    loads: [...loadMap].map(([label, values]) => ({ label, values: uniqSorted(values) })),
    levels: uniq(levels).sort((a, b) => parseInt(a) - parseInt(b)),
    surfaces: uniq(surfaces),
    features,
    systemFeatures,
    topProducts: products.slice(0, 8).map((p) => p.name),
    familyClaims: family ? family[1] : null,
    catalogFacts: catalogFactsFor(meta.name),
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
  for (const feat of f.features) if (!/^(Rahmen vormontiert|Ständer vormontiert|fahrbar)$/.test(feat.label)) rows.push([feat.label, feat.values.join(", ")]);
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
    ...(f.systemFeatures ?? []).map((x) => `Je System – ${x.system}: ${x.values.join("; ")}`),
    `Beispielartikel: ${f.topProducts.join(" ; ")}`,
    f.familyClaims ? `Belegte Herstellerangaben: ${f.familyClaims}` : "Belegte Herstellerangaben: keine",
    ...((f.catalogFacts ?? []).length
      ? ["Belegte Katalogangaben (META-Bestellkatalog, beschreiben das System – das Shop-Sortiment kann kleiner sein):", ...f.catalogFacts.map((c) => `- ${c.system}: ${c.text}`)]
      : []),
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

/** Fachregeln fuer Schreiber und Pruefer (Plausibilitaet, User 15.10.2026). */
const DOMAIN_RULES = `- Ein Anbauregal braucht ein Grundregal und nutzt dessen Rahmen mit; ein Grundregal steht für sich.
- Bei Fachboden-, Paletten- und Weitspannregalen heißen die Rahmen „Seitenrahmen“ bzw. „Ständerrahmen“ – beides ist richtig. Bei Kragarmregalen heißen sie „Ständer“ (an ihnen hängen die Kragarme). Ein Kragarm-Grundregal hat zwei Ständer, ein Anbauregal nutzt EINEN Ständer des Nachbarregals mit und spart damit genau einen Ständer (kein Ständerpaar).
- Doppelregal: bei Fachboden-, Paletten- und Weitspannregalen zwei Regalzeilen Rücken an Rücken; bei Kragarmregalen heißt doppelseitig, dass die Kragarme an beiden Seiten derselben Ständer sitzen. Das Wort „doppeltief“ nicht verwenden.
- Fachboden- und Büroregale sind für Kleinteile, Kartons, Behälter, Ordner – nicht für Paletten oder palettierte Ware.
- Ein Doppelregal ist beidseitig nutzbar; „einseitig oder beidseitig“ nicht auf Doppelregale beziehen.
- „Rahmen vormontiert: ja“ bzw. „Ständer vormontiert: ja“ heißt nur, dass die Rahmen bzw. Ständer vormontiert sind – nicht das ganze Regal.
- „Belegte Katalogangaben“ dürfen genutzt werden (Aufbau, Sicherheit, Systemwerte). Systemwerte aus dem Katalog als Möglichkeit des Systems kennzeichnen („im System bis …“, „auf Anfrage“), Sortimentswerte aus den Kategoriedaten. Keine Katalog- oder Seitenverweise im Text.
- Sicherheitshinweise nicht miteinander verknüpfen: „nur für Handbedienung“ gilt immer, nicht nur bei Verankerung.
- Die Shop-„Breite“ bei Kragarmregalen ist die Feldbreite (1.000/1.300 mm), das Katalog-„Achsmaß“ (1.030/1.330/1.350 mm) ist ein anderes Maß – nicht gleichsetzen.
- Sicherheitshinweise aus dem Katalog genau wiedergeben (z. B. „über 4 : 1“, „nur für Handbedienung“), nicht abschwächen.
- Alle Angaben beschreiben das Sortiment im Shop, nicht die grundsätzlichen Möglichkeiten eines Systems (nicht „reines Anbauregal-System“, sondern „im Shop als … erhältlich“).
- Regalarten, Maße, Lasten und Aufbauart, die unter „Je System“ stehen, gelten nur für dieses System. Gibt es eine Regalart (z. B. Grund-/Anbauregal) nur bei einem System, nicht für alle behaupten.
- Keine Aussagen über die Darstellung im Shop (Kennzeichnung, Filter, Produktübersicht, Konfigurator).
- Keine allgemeinen Qualitäts- oder Eignungsfloskeln ohne Daten („für den Dauereinsatz geeignet“, „langlebig“, „robust“), keine Leistungsversprechen (Durchsatz, Ersparnis, „beliebig erweiterbar“).
- Nur META-Inhalte: keine anderen Hersteller, Marken oder Wettbewerber, keine Vergleiche mit ihnen.`;

const SYSTEM_PROMPT = `Du schreibst Texte für Kategorieseiten im Onlineshop von META Regalbau (Regale und Lagertechnik, B2B). Ziel: Sichtbarkeit in Google und in KI-Suchen (GEO) und eine gute Kaufentscheidung. Sachlich, konkret, keine Werbefloskeln, Sie-Form.
Liefere als JSON:
- h1: Überschrift der Seite (höchstens 60 Zeichen), Suchbegriff zuerst, z. B. "Fachbodenregale – Grundregale von META CLIP".
- intro: 2–3 Sätze (200–450 Zeichen) für ÜBER der Produktliste: was findet man hier, für wen, wichtigste Auswahlhilfe.
- sections: 3–4 Abschnitte für UNTER der Produktliste, je {heading (Frage oder klare Aussage, höchstens 70 Zeichen), paragraphs: 1–3 Absätze mit je höchstens 450 Zeichen}. Themen: Einsatzbereiche; Auswahl (Maße, Lasten, Grund- vs. Anbauregal, Zubehör); Aufbau/Erweiterung; ggf. Qualität (nur mit den belegten Herstellerangaben).
- faq: 4–6 Fragen, die Kunden vor dem Kauf stellen, mit Antworten von höchstens 350 Zeichen.
Regeln:
- Nur Fakten aus den gelieferten Kategoriedaten. Zahlen (Maße, Lasten, Ebenen, Anzahl) nur, wenn sie dort stehen. Keine erfundenen Normen, Zertifikate, Garantien, Herkunftsangaben – außer wörtlich aus "Belegte Herstellerangaben".
- Keine Preise, Rabatte, Lieferzeiten, Versandkosten.
${DOMAIN_RULES}
- Allgemeines Regalwissen nur, wenn es für die gelieferten META-Daten zutrifft; im Zweifel weglassen.
- Konkrete Daten aus den Kategoriedaten nutzen (Maßbereiche, Lasten, Ebenen, Aufbauart, Raster) – sie helfen Kunden und KI-Suchen; nichts darüber hinaus erfinden.
- Typkürzel (T1 N, SR 120/25 …) nicht ausdeuten und nicht aufzählen.
- Keine Quellenverweise im Text („laut Daten“, „laut Beispielkonfigurationen“, „in den Produktdaten“); Negativ-Aussagen („nicht fahrbar“) nur, wenn sie für die Auswahl wichtig sind.
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
  if (/doppeltief/i.test(plain)) return "„doppeltief“ ist falsch – ein Doppelregal sind zwei Regalzeilen Rücken an Rücken; das Wort weglassen";
  const source = factsText(f);
  const allowed = digitForms(source);
  for (const token of plain.match(/\d+(?:[.,]\d+)*/g) ?? []) {
    const whole = token.replace(/[.,]/g, "");
    const runs = token.match(/\d+/g) ?? [];
    if (!allowed.has(whole) && !runs.every((r) => allowed.has(r))) return `die Zahl ${token} steht nicht in den Kategoriedaten – weglassen`;
  }
  const claims = `${f.familyClaims ?? ""} ${(f.catalogFacts ?? []).map((c) => c.text).join(" ")}`;
  for (const m of plain.match(new RegExp(COMPANY_CLAIMS.source, "gi")) ?? []) {
    const term = m.trim().replace(/[- ]+$/, "").toLowerCase();
    if (!claims.toLowerCase().includes(term)) return `Herstellerangabe „${m}“ ist für diese Kategorie nicht belegt – weglassen`;
  }
  const sourceExpanded = expandAbbreviations(source);
  for (const [pattern, reason] of CLAIM_RULES) {
    if (reason === "certificate" || reason === "warranty" || reason === "origin") continue; // oben über familyClaims geprüft
    if (pattern.test(plain) && !pattern.test(sourceExpanded)) {
      if (reason === "competitor") return "keine anderen Hersteller oder Wettbewerber nennen – nur META";
      return `keine Angaben zu ${reason === "price" ? "Preisen" : reason === "delivery" || reason === "shipping" ? "Lieferung/Versand" : "Oberflächenbehandlung"}, die nicht in den Daten stehen`;
    }
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

export type PlausibilityIssue = { quote: string; reason: string };
/** Zweiter Leser: meldet unbelegte oder unplausible Aussagen (leere Liste = in Ordnung). */
export type CategoryTextReviewer = (facts: CategoryFacts, text: GeneratedCategoryText) => Promise<PlausibilityIssue[]>;

const norm = (v: string) => v.toLowerCase().replace(/[„“"'.,;:!?()–-]/g, " ").replace(/\s+/g, " ").trim();
const sentences = (v: string) => v.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

/**
 * Entfernt die beanstandeten Saetze (Zitat ist Teil des Satzes). Leere Absaetze, Abschnitte und FAQ
 * fallen weg; ob der Rest noch reicht, entscheidet danach validateCategoryText.
 */
export function removeQuotedSentences(g: GeneratedCategoryText, quotes: string[]): GeneratedCategoryText {
  const qs = quotes.map(norm).filter((q) => q.length >= 8);
  const hit = (sentence: string) => qs.some((q) => norm(sentence).includes(q) || q.includes(norm(sentence)));
  const clean = (text: string) => sentences(text).filter((x) => !hit(x)).join(" ");
  return {
    h1: g.h1,
    intro: clean(g.intro),
    sections: g.sections
      .map((sec) => ({ heading: sec.heading, paragraphs: sec.paragraphs.map(clean).filter(Boolean) }))
      .filter((sec) => sec.paragraphs.length > 0),
    faq: g.faq.filter((x) => !hit(x.q)).map((x) => ({ q: x.q, a: clean(x.a) })).filter((x) => x.a),
  };
}

const issuesText = (issues: PlausibilityIssue[]) => issues.map((i) => `„${i.quote.trim()}“ – ${i.reason.trim()}`).join("; ");

const REVIEW_PROMPT = `Du prüfst einen Shop-Text von META Regalbau (Hersteller von Regalen) auf Plausibilität, bevor er veröffentlicht wird.
Grundlage sind NUR die gelieferten Kategoriedaten (Produkte von META) und allgemein gültiges, unstrittiges Regalwissen.
Melde jede Aussage, die
- in den Daten nicht belegt ist und kein unstrittiges Regalwissen ist (z. B. erfundene Eigenschaften, Zubehör, Einsatzorte, die nicht zu den Produkten passen),
- den Daten widerspricht oder Werte falsch zuordnet (z. B. Zeilenlänge als Breite, Fachlast als Feldlast, falsche Aufbauart),
- technisch unplausibel ist,
- andere Hersteller/Wettbewerber nennt oder ein Leistungsversprechen ohne Daten macht (Durchsatz, Ersparnis, Superlative).
- Merkmale falsch einem System zuordnet oder verwischt, obwohl die Daten sie unter „Je System“ trennen,
- bei Kragarmregalen „doppelseitig“ als zwei Regalzeilen Rücken an Rücken beschreibt (richtig: Kragarme an beiden Seiten derselben Ständer),
- etwas über die Darstellung im Shop behauptet (Kennzeichnung, Filter, Produktübersicht).
Diese Fachregeln gelten; melde jeden Verstoß:
${DOMAIN_RULES}
Nicht melden: Stil, Länge, Wiederholungen, Formulierungen ohne inhaltliches Problem.
Antworte nur mit JSON: {"issues":[{"quote":"wörtliches Zitat","reason":"kurz, warum"}]} – leere Liste, wenn alles plausibel ist.`;

const reviewSchema = z.object({ issues: z.array(z.object({ quote: z.string(), reason: z.string() })) });

export function llmCategoryTextReviewer(getSetting: (key: string) => Promise<any>): CategoryTextReviewer {
  return async (facts, g) => {
    const text = await chatCompletion(getSetting, {
      tier: "smart",
      temperature: 0,
      max_tokens: 2000,
      response_json: true,
      messages: [
        { role: "system", content: REVIEW_PROMPT },
        { role: "user", content: `KATEGORIEDATEN:\n${factsText(facts)}\n\nTEXT:\n${categoryTextPlain(g)}` },
      ],
    });
    const parsed = reviewSchema.safeParse(parseLlmJsonResponse(text));
    if (!parsed.success) return [{ quote: "", reason: "Plausibilitätsprüfung: Antwort nicht lesbar" }];
    return parsed.data.issues.filter((i) => i.quote.trim());
  };
}

export async function generateCategoryText(
  facts: CategoryFacts,
  generate: CategoryTextGenerator,
  review?: CategoryTextReviewer,
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
    if (reason) {
      feedback = reason;
      continue;
    }
    if (!review) return { text: g, problem: "" };
    const issues = await review(facts, g);
    if (issues.length === 0) return { text: g, problem: "" };
    // Beanstandete Saetze streichen; reicht der Rest und besteht er die Pruefung erneut, ist er gut
    const repaired = removeQuotedSentences(g, issues.map((i) => i.quote));
    if (!validateCategoryText(facts, repaired) && (await review(facts, repaired)).length === 0) return { text: repaired, problem: "" };
    // letzter Versuch: Text behalten, Zweifel als Pruefhinweis (wird dann nicht geschrieben)
    if (attempt === 2) return { text: g, problem: `Plausibilität: ${issuesText(issues)}` };
    feedback = `Diese Aussagen sind unbelegt oder unplausibel – weglassen oder korrigieren: ${issuesText(issues)}`;
  }
  return { text: null, problem: feedback ?? "unbekannt" };
}
