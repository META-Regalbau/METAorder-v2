// Landingpages (Erlebniswelten) der Hauptkategorien: Fachboden-, Paletten-, Kragarm-, Weitspann- und
// Bueroregale. Texte entstehen wie bei den Kategorieseiten (categoryTexts.ts) aus den Produkten der
// zugehoerigen Regal-Kategorien; dazu die vier Kennzahlen im roten Band, ebenfalls aus den Produktdaten.
import type { CategoryProduct } from "./categoryTexts";
import { parseCatalogName } from "../cross-selling/crossSellNameRules";

export type LandingTextFix = { find: RegExp; replace: string; note: string };
export type LandingFaqFix = { question: RegExp; newQuestion?: string; newAnswer?: string; note: string };

export type LandingPageConfig = {
  key: string;
  landingPageId: string;
  /** Name fuer Fakten und Herstellerangaben (Familienregel in categoryTexts.ts greift am Namen) */
  factsName: string;
  url: string;
  /** Regal-Kategorien, aus deren Produkten Fakten und Kennzahlen kommen */
  shelfCategories: RegExp;
  /** Kategorien, auf die die Seite verlinkt ("Direkt zu …") */
  linkCategories: RegExp;
  /** Hauptregaltyp (2. Namensteil) fuer Kennzahlen und Texte – Sonderregale verzerren sonst die Spannen */
  mainType: RegExp;
  /** Welche Last im roten Band steht */
  loadLabel: "Fachlast" | "Feldlast" | "Armlast";
  /** Kennzahlen, die unveraendert bleiben (Index 0–3: Hoehe, Breite, Tiefe, Last) */
  keepFigures?: number[];
  /** Kennzahlen mit festem, im Katalog belegtem Wert (Index -> Text) */
  figureOverrides?: Record<number, string>;
  /** Lastwerte aus den Artikelnamen sind unzuverlaessig (z. B. MULTIPAL: Tragkraft je Palette als "Fachlast") */
  ignoreNameLoads?: boolean;
  /** Kopf (H1 + Einleitung) ersetzen */
  replaceHero?: boolean;
  /** Bisherigen SEO-Abschnitt ersetzen: Textbloecke, deren Inhalt hierauf passt (erster bekommt den Text, weitere werden geleert) */
  replaceSeoText?: RegExp;
  /** Neue Abschnitte am Seitenende: Links, Topseller, SEO-Text, FAQ, Beratung */
  addSections?: boolean;
  textFixes?: LandingTextFix[];
  faqFixes?: LandingFaqFix[];
  /** Was auf der Seite geaendert wird (fuer die Freigabe) */
  plan: string;
};

/** Produkte des Hauptregaltyps (nur Namen im neuen Schema): Grundlage fuer Fakten und Texte der Seite. */
export function mainTypeProducts<T extends { name: string }>(products: T[], cfg: Pick<LandingPageConfig, "mainType">): T[] {
  return products.filter((p) => {
    const n = parseCatalogName(p.name);
    return Boolean(n && cfg.mainType.test(n.type));
  });
}

/** Braucht die Seite KI-Texte (Kopf, SEO-Text, FAQ)? Sonst nur Kennzahlen und Korrekturen. */
export const needsGeneratedText = (cfg: LandingPageConfig) => Boolean(cfg.replaceHero || cfg.replaceSeoText || cfg.addSections);

export const LANDING_PAGES: LandingPageConfig[] = [
  {
    key: "fachboden",
    landingPageId: "0194e59da2b67a3cb89838ad5800d8a4",
    factsName: "META CLIP Fachbodenregale",
    url: "/fachbodenregale/",
    shelfCategories: /^CLIP (Grundregale|Anbauregale|Komplettregale)$/,
    linkCategories: /^CLIP (Grundregale|Anbauregale|Komplettregale|Zubehör|Böden und Auflagen)$/,
    mainType: /^Fachbodenregal$/,
    loadLabel: "Fachlast",
    replaceSeoText: /Effizient lagern mit System/,
    faqFixes: [
      {
        question: /^Was ist der Unterschied zwischen CLIP, CLIP S3 und CLIP SPLIT\??$/,
        newQuestion: "Was ist der Unterschied zwischen CLIP, CLIP S3 und CLIP SPLIT?",
        newAnswer:
          "Der Unterschied liegt im Rahmen: Bei META CLIP werden vorgefertigte, maschinell geclinchte Rahmen fertig montiert geliefert – sie tragen bis zu über 70 % mehr als zerlegte Rahmen. Bei CLIP S3 kommen die Rahmen zerlegt und werden ohne Werkzeug zusammengesteckt. Beim CLIP SPLIT sind zusätzlich die Rahmenprofile in der Mitte geteilt und können so mit einem Paketdienst verschickt werden.",
        note: "„verschweißt“ ist falsch – CLIP-Rahmen sind geclincht (Katalog S. 28); Fragezeichen ergänzt",
      },
      {
        question: /^Muss ich das Regal (in|an) der Wand oder im Boden befestigen\?$/,
        newQuestion: "Muss ich das Regal an der Wand oder im Boden befestigen?",
        newAnswer: "Ja, wenn das Verhältnis von Höhe zu Tiefe größer als 4 : 1 ist: Dann muss das Regal mit einer Wand- oder Fußverankerung gegen Kippen gesichert werden. Reifenregale und Regale mit Schubladen sind immer mit Fußverankerung zu sichern.",
        note: "Katalog S. 25: „> 4 : 1“, Reifen-/Schubladenregale immer",
      },
      {
        question: /^Ist das META CLIP ein Schwerlastregal\?$/,
        newQuestion: "Wie viel trägt ein META CLIP Regal?",
        newAnswer: "Je nach Ausführung tragen die Fachböden 80, 150, 200, 230 oder 330 kg. Beim Steckregal mit Diagonalverstrebung liegt die Feldlast bei bis zu 1.650 kg mit zerlegten S3-Rahmen und bis zu 2.400 kg mit vorgefertigten, geclinchten Rahmen.",
        note: "„Schwerlastregal“ steht nicht im Katalog; Werte Katalog S. 21/29",
      },
      {
        question: /^Was ist der Unterschied zwischen einem Fachbodenregal und einem Schwerlastregal\?$/,
        newQuestion: "Wofür eignet sich META CLIP?",
        newAnswer: "META CLIP ist ein Fachbodenregalsystem für alle Anwendungen der Kleinteilelagerung, zum Beispiel Ersatzteilmagazine in Industrie und Handwerk. Aus Rahmen und Fachböden entstehen Regalzeilen, die sich mit umfangreichem Systemzubehör an das Lagergut anpassen lassen.",
        note: "„Schwerlastregal … Industriestandards“ ist unbelegt; Katalog S. 19",
      },
    ],
    plan: "Platzhalter-Abschnitt „Effizient lagern mit System“ (Briefing-Text, „CLIP vs. FIX“, „seit über 50 Jahren“) → neuer SEO-Text mit Maßtabelle; Kennzahlen aus Shopdaten; FAQ nach Katalog korrigiert („verschweißt“ → geclincht, Schwerlast-Fragen ersetzt, Kippsicherung > 4 : 1).",
  },
  {
    key: "paletten",
    landingPageId: "018fcfe0689776c3a5dd4d6cc9068494",
    factsName: "META MULTIPAL Palettenregale",
    url: "/palettenregale/",
    shelfCategories: /^MULTIPAL (Grundregale|Anbauregale|Komplettregale)$/,
    linkCategories: /^MULTIPAL (Grundregale|Anbauregale|Komplettregale|Spezialregale|Komponenten|Zubehör|Böden und Auflagen)$/,
    mainType: /^Palettenregal$/,
    loadLabel: "Fachlast", // Feldlast steht nur bei Sonderregalen (Kabeltrommel) im Namen
    // Artikelnamen fuehren teils die Tragkraft je Palette als "Fachlast" (470 kg = 1.400 kg / 3, Katalog S. 131)
    ignoreNameLoads: true,
    figureOverrides: { 3: "bis 5.500 kg Fachlast" }, // Katalog S. 123: Einzel-Fachlasten bis 5,5 t
    replaceHero: true,
    replaceSeoText: /Robuste Lagerlösung|Ideal für Lager, Logistik|Eigenschaften &amp; Vorteile im Überblick/,
    faqFixes: [
      {
        question: /^Kann ich das Regal selbst montieren\?$/,
        newAnswer:
          "Ja. Die Ständerrahmen mit verschraubter Ausfachung werden zerlegt geliefert, die Holme werden mit der 4-Haken-Agraffe eingehängt und gesichert. Palettenregale sind auf einem Betonboden (mindestens C20/25) mit Ankern zu fixieren – bitte beachten Sie die mitgelieferten Sicherheitshinweise.",
        note: "bisher „Stecksystem ohne Werkzeug“; Katalog S. 121/135: verschraubte Ausfachung, eingehängte Holme, Verankerung",
      },
      {
        question: /^Ist das MULTIPAL-Regal auch für schwere Gitterboxen geeignet\?$/,
        newQuestion: "Kann ich Gitterboxen im MULTIPAL-Regal lagern?",
        newAnswer: "Ja, mit dem passenden Zubehör: Gitterboxpaletten lassen sich wegen ihrer Winkelfüße nur schlecht direkt auf den Holmen einlagern. Winkelauflagen führen die Füße und setzen sie sicher auf den Holmen ab.",
        note: "bisher pauschal „Ja“; Katalog S. 210: Winkelauflagen nötig",
      },
      {
        question: /^Gibt es Zubehör wie Anfahrschutz oder Bodenanker\?$/,
        newAnswer: "Ja. Bodenanker sind bei Grund- und Anbauregalen im Lieferumfang. Äußere Ständer im Eckbereich und an Durchfahrten sind mit Rammschutzecken gegen Anprall zu schützen – dafür gibt es Rammschutzecken und U-Rammschutz.",
        note: "Katalog S. 130/135: Anker im Lieferumfang, Rammschutz an Ecken/Durchfahrten Pflicht",
      },
    ],
    plan: "Kopf: neue H1 + Einleitung (bisher Großbuchstaben, Satz unvollständig, „Stecksystem“); Abschnitt „Robuste Lagerlösung“ (3 Textblöcke, ebenfalls „Stecksystem“) → neuer SEO-Text mit Maßtabelle; FAQ: Montage, Gitterboxen und Anfahrschutz nach Katalog korrigiert; Kennzahlen aus Shopdaten, Fachlast laut Katalog (Namen führen Tragkraft je Palette).",
  },
  {
    key: "kragarm",
    landingPageId: "0194e5cc241378798eac2ccd90978e33",
    factsName: "META Kragarmregale MULTISTRONG und ATLAS ST",
    url: "/kragarmregale/",
    shelfCategories: /^(MULTISTRONG Grundregale|MULTISTRONG Anbauregale|ATLAS ST Komplettregale)$/,
    linkCategories: /^(MULTISTRONG Grundregale|MULTISTRONG Anbauregale|ATLAS ST Komplettregale|Kragarmregal Zubehör)$/,
    mainType: /^(Kragarmregal|Langgutregal)$/,
    loadLabel: "Armlast",
    // Achsmaß steht nicht im Namen: MULTISTRONG 1.030/1.330 mm, ATLAS ST 1.350 mm (Katalog S. 156/158)
    figureOverrides: { 1: "1.030 mm bis 1.350 mm Achsmaß" },
    addSections: true,
    plan: "Neue Abschnitte unter den Kacheln: Links zu den Kategorien, Topseller-Slider, SEO-Text mit Maßtabelle, FAQ, Beratung; Kennzahlen aus Shopdaten (Achsmaß bleibt).",
  },
  {
    key: "weitspann",
    landingPageId: "0194e5ccf088794b81760e98653464be",
    factsName: "META Weitspannregale MINI-RACK und SPEED-RACK",
    url: "/weitspannregale/",
    shelfCategories: /^(MINI-RACK Grundregale|MINI-RACK Anbauregale|SPEED-RACK Komplettregale)$/,
    linkCategories: /^(MINI-RACK Grundregale|MINI-RACK Anbauregale|SPEED-RACK Komplettregale|Weitspann-Spezialregale|Weitspannregal Komponenten|Weitspannregal Zubehör)$/,
    mainType: /^Weitspannregal$/,
    loadLabel: "Fachlast",
    addSections: true,
    plan: "Neue Abschnitte unter den Kennzahlen: Links zu den Kategorien, Topseller-Slider, SEO-Text mit Maßtabelle, FAQ, Beratung; Kennzahlen aus Shopdaten.",
  },
  {
    key: "buero",
    landingPageId: "0194e5cb677f72008c0b8b581dc2ac4c",
    factsName: "META COMPACT Büroregale", // so heisst das System im Katalog (S. 99)
    url: "/bueroregale",
    shelfCategories: /^COMPACT (Grundregale|Anbauregale)$/,
    linkCategories: /^COMPACT (Grundregale|Anbauregale)$/,
    mainType: /Büro/,
    loadLabel: "Fachlast",
    keepFigures: [0, 1, 2, 3], // stimmen schon
    textFixes: [
      { find: /META CLIP( COMPACT)? – Planmaße und Sicherheitshinweise/, replace: "META COMPACT – Planmaße und Sicherheitshinweise", note: "Überschrift: System heißt META COMPACT (Katalog S. 99)" },
      { find: /Fachlast:\s*(150[–-]330|80[–-]100) kg, Abdeckboden max\. 200 kg/, replace: "Fachlast: 80 kg, bei 1.250 x 600 mm 100 kg (mit Mittelanschlag)", note: "Lastzeile von CLIP kopiert; COMPACT laut Katalog S. 100" },
      { find: /<li>Kantenhöhe Fachboden: 40 mm<\/li>/, replace: "", note: "Kantenhöhe 40 mm ist ein CLIP-Wert (Katalog S. 25)" },
    ],
    plan: "Überschrift → „META COMPACT – Planmaße …“; Lastzeile (von CLIP kopiert, inkl. Abdeckboden 200 kg und Kantenhöhe 40 mm) → COMPACT-Werte laut Katalog; Kennzahlen stimmen schon. Keine neuen Texte.",
  },
];

const fmt = (n: number) => n.toLocaleString("de-DE");

function span(values: number[], unit: string, label: string): string {
  const v = [...new Set(values.filter((x) => Number.isFinite(x) && x > 0))].sort((a, b) => a - b);
  if (v.length === 0) return "";
  return v[0] === v[v.length - 1] ? `${fmt(v[0])} ${unit} ${label}` : `${fmt(v[0])} ${unit} bis ${fmt(v[v.length - 1])} ${unit} ${label}`;
}

/**
 * Die vier Kennzahlen im roten Band (Hoehe, Breite, Tiefe, Last) aus den Artikelnamen des Hauptregaltyps.
 * Leerer Eintrag = keine Daten; keepFigures = bleibt wie bisher.
 */
export function keyFiguresFromProducts(
  products: CategoryProduct[],
  cfg: Pick<LandingPageConfig, "loadLabel" | "keepFigures" | "mainType" | "figureOverrides">,
  current: string[] = [],
): string[] {
  const heights: number[] = [];
  const widths: number[] = [];
  const depths: number[] = [];
  const loads: number[] = [];
  const loadRe = new RegExp(`^${cfg.loadLabel}\\s+(\\d[\\d.]*)\\s*kg$`, "i");
  for (const p of products) {
    const n = parseCatalogName(p.name);
    if (!n || !cfg.mainType.test(n.type) || n.dims.length !== 3) continue;
    heights.push(n.dims[0]);
    // mehrere Felder: zweites Mass ist die Zeilenlaenge, keine Regalbreite
    const fields = n.segments.map((seg) => seg.match(/^(\d+)\s*Felder$/)).find(Boolean);
    if (!fields || Number(fields[1]) <= 1) widths.push(n.dims[1]);
    depths.push(n.dims[2]);
    for (const seg of n.segments) {
      const m = seg.match(loadRe);
      if (m) loads.push(Number(m[1].replace(/\./g, "")));
    }
  }
  const maxLoad = loads.length ? Math.max(...loads) : 0;
  const figures = [span(heights, "mm", "Höhe"), span(widths, "mm", "Breite"), span(depths, "mm", "Tiefe"), maxLoad ? `bis ${fmt(maxLoad)} kg ${cfg.loadLabel}` : ""];
  for (const i of cfg.keepFigures ?? []) figures[i] = current[i] ?? "";
  for (const [i, v] of Object.entries(cfg.figureOverrides ?? {})) figures[Number(i)] = v;
  return figures;
}

/** Text einer Kennzahl aus dem bisherigen Slot-HTML (letzte h2 mit Text, die erste traegt nur das Icon). */
export function keyFigureText(slotHtml: string): string {
  const parts = [...slotHtml.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/g)].map((m) =>
    m[1].replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim(),
  );
  return parts.filter(Boolean).pop() ?? "";
}

/**
 * Ersetzt den Text der Kennzahl im Slot-HTML; Icon-Ueberschrift und Schriftfarbe bleiben. Der ganze Inhalt
 * der Text-Ueberschrift wird ersetzt (manche Slots haben die Einheit in einem eigenen span), damit ein
 * zweiter Lauf nichts mehr aendert.
 */
export function replaceKeyFigure(slotHtml: string, figure: string): string {
  const blocks = [...slotHtml.matchAll(/(<h2[^>]*>)([\s\S]*?)(<\/h2>)/g)].filter((m) => m[2].replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim());
  const last = blocks[blocks.length - 1];
  if (!last || last.index === undefined) return slotHtml;
  const color = last[2].match(/<font[^>]*color="([^"]+)"/)?.[1] ?? last[2].match(/color:\s*([^;"]+)/)?.[1]?.trim() ?? "#ffffff";
  const safe = figure.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const next = `${last[1]}<font color="${color}">${safe}</font>${last[3]}`;
  return slotHtml.slice(0, last.index) + next + slotHtml.slice(last.index + last[0].length);
}
