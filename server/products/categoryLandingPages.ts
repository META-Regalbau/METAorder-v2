// Inhalte der System-Landingpages (Menüpunkte Fachboden-, Büro-, Paletten-, Kragarm-, Weitspannregale) nach der
// gemeinsamen Vorlage A–K (Konzept Kategorie-Landingpages 20.10.2026, E1–E7 vom User freigegeben).
// Eine Quelle für Entwurf (scripts/exportCategoryLandingPages.ts) und später das Schreibskript in den Shop.
// Regel des Users: nur belegte META-Inhalte, nichts Erfundenes, keine Wettbewerber (siehe categoryTexts.ts).
// Jede Zahl steht in catalogFacts.ts (Katalog bzw. Sicherheitshinweise, Seitenangabe in `src`); die Zahlen des
// Rechenbeispiels werden aus Artikeldaten und Katalogformeln errechnet (buildExample), nicht von Hand geschrieben.
// Fachbegriffe als [[schluessel]] bzw. [[schluessel|Text]] verlinken ins Regal-Lexikon (glossary.ts).
import type { IndustryNote } from "@shared/shopContent";
import { CATALOG_SYSTEMS } from "./catalogFacts";

export type LandingNoteKey = "hero" | "systems" | "tiles" | "guide" | "example" | "plan" | "products" | "seo" | "faq" | "advice";
export type LandingLink = { label: string; href: string };

/** Die sechs Schritte des Aufbau-Abschnitts – auf allen Seiten dieselben, in dieser Reihenfolge. */
export const BUILD_STEP_KEYS = ["last", "masse", "zeile", "bedienseite", "kippen", "aufbau"] as const;
export type BuildStepKey = (typeof BUILD_STEP_KEYS)[number];
export type BuildStep = { key: BuildStepKey; title: string; text: string; src: string };

/** Regalzeile für Rechenbeispiel und Zeichnung; Zuschläge laut Katalog-Planmaßen */
export type RowSpec = {
  fields: number;
  /** Nennlänge = Fachbodenlänge (mm) */
  nominal: number;
  height: number;
  depth: number;
  levels: number;
  /** Fachlast je Boden (kg, Artikel) */
  shelfLoad: number;
  /** max. Feldlast des Artikels (kg, Shop-Eigenschaft) */
  fieldLoad: number;
  /** verfügbarer Platz, z. B. Wandlänge (mm) */
  space: number;
  plan: { base: number; addOn: number };
  foot: { base: number; addOn: number };
};

export type BuildExample = {
  row: RowSpec;
  /** Artikel der Beispielzeile (Warenkorb) */
  lines: Array<{ qty: number; number: string; label: string }>;
  configuratorHref: string;
};

export type BuildGuide = {
  title: string;
  intro: string;
  steps: BuildStep[];
  example: BuildExample;
  /** Beschriftung der Zeichnung */
  drawing: { parts: string[]; bracing: string };
  avoid: string[];
  avoidSrc: string;
  operation: string[];
  operationSrc: string;
  instructions: LandingLink;
  service: LandingLink;
};

export type CategoryLandingPage = {
  key: string;
  /** Bestehende Landingpage im Shop (URL und Meta-Texte bleiben dort) */
  landingPageId: string;
  url: string;
  name: string;
  /** Katalogsystem für Maßtabelle (catalogFacts.ts) */
  catalogSystem: string;
  eyebrow: string;
  h1: string;
  lead: string;
  proof: string[];
  ctaPrimary: LandingLink;
  ctaSecondary: LandingLink;
  heroImage: { src: string; alt: string };
  facts: Array<{ value: string; label: string }>;
  systems: { title: string; intro: string; comparisons: string[] };
  tiles: Array<LandingLink & { text: string }>;
  guide: BuildGuide;
  planImages: Array<{ src: string; alt: string }>;
  planNote: string;
  productsTitle: string;
  /** Entwurf: Produktkarten; im Shop zeigt der Produkt-Slider die Topseller der Kategorien */
  productNumbers: string[];
  productsHref: string;
  seo: { title: string; paragraphs: string[]; links: LandingLink[] };
  faqTitle: string;
  faq: Array<{ q: string; a: string }>;
  advice: { title: string; text: string };
  notes: Partial<Record<LandingNoteKey, IndustryNote>>;
};

export const LEXIKON = "/regal-lexikon";
/** Montageanleitungen und -videos auf meta-online.com (Filter Anleitung, Deutsch) – feste PDF-Adressen gibt es dort nicht */
export const INSTRUCTIONS_HREF =
  "https://www.meta-online.com/de-DE/service/kataloge-und-montageanleitungen?oxDeeplink=eyJ1bml2ZXJzYWxTZWFyY2h8MSI6eyJ2aWV3IjoiZmlsdGVyZWQiLCJmaWx0ZXJzIjp7ImNvbnRlbnRUeXBlIjpbImluc3RydWN0aW9uIl0sImNvbnRlbnRMYW5ndWFnZSI6WyJkZSJdfSwicXVlcnkiOiIiLCJoaWRkZW5GaWx0ZXJzIjp7ImJyYW5kIjpbIjZESFRTUTg0UlZWSzFQQkNFQ0NONkFSQzMwIl19fX0%3D";
export const SERVICE_HREF = "https://www.meta-online.com/de-DE/service/montage";

/** Für alle Seiten gleich: sicher im Betrieb (Sicherheitshinweise 02.2024, Katalog S. 16) */
export const OPERATION_COMMON = [
  "Lasten gleichmäßig verteilen, Stöße und Schieben vermeiden, Fach- und Feldlasten nie überschreiten.",
  "Regal, Fachböden und Rahmen nie besteigen.",
  "Beschädigte oder verformte Bauteile sofort ersetzen.",
  "Umbauen oder Umstellen nur unbeladen und nach Rücksprache mit META.",
  "Sichtprüfung jede Woche, [[regalinspektion|Inspektion]] durch eine fachkundige Person spätestens alle 12 Monate (§ 14 Betriebssicherheitsverordnung).",
];
const OPERATION_SRC = "Sicherheitshinweise 02.2024 S. 3; Katalog S. 16";

const FAQ_SELF_BUILD_CLIP = {
  q: "Kann ich ein META CLIP Regal selbst aufbauen?",
  a: "Ja. META CLIP wird ohne Werkzeug gesteckt: Der zerlegte S3-Rahmen ist in drei Klicks fertig, falsches Zusammenstecken ist durch das CLIP-EASY-Verfahren ausgeschlossen; geclinchte Rahmen kommen fertig montiert. Beladen Sie das Regal erst, wenn es vollständig montiert und gesichert ist. Wenn Sie nicht selbst aufbauen möchten, übernimmt das der META-Montageservice.",
};
const FAQ_INSPECTION = {
  q: "Müssen Regale regelmäßig geprüft werden?",
  a: "Ja. Regale sind Arbeitsmittel und unterliegen nach § 14 Betriebssicherheitsverordnung der Prüfpflicht. Die Inspektion muss mindestens alle 12 Monate durch eine fachkundige Person erfolgen. META bietet die Regalinspektion als Service an.",
};

export const ADVICE_COMMON = {
  title: "Sie planen eine größere Anlage?",
  text: "Unser Außendienst berät Sie vor Ort, unsere Projektingenieure erstellen einen Planungsvorschlag mit CAD-Zeichnung, und auf Wunsch bauen geschulte Montageteams Ihre Regale auf.",
};

export const CATEGORY_LANDING_PAGES: CategoryLandingPage[] = [
  {
    key: "fachboden",
    landingPageId: "0194e59da2b67a3cb89838ad5800d8a4",
    url: "/fachbodenregale/",
    name: "Fachbodenregale",
    catalogSystem: "clip",
    eyebrow: "META CLIP Fachbodenregale",
    h1: "Fachbodenregale für Kleinteile, Ersatzteile und Kartons",
    lead:
      "META CLIP besteht aus zwei Bausteinen: Rahmen und Fachböden. Daraus entstehen Regalzeilen mit beliebig vielen Feldern, gesteckt ohne Werkzeug, mit Fachböden im 25-mm-Raster und Systemzubehör für Ihr Lagergut. Hier bestellen Sie die Regale direkt und sehen Schritt für Schritt, worauf es beim Aufbau ankommt.",
    proof: ["Gefertigt in Arnsberg", "Steckmontage ohne Werkzeug", "Fachböden im 25-mm-Raster", "Kostenloser Versand"],
    ctaPrimary: { label: "Regal konfigurieren", href: "/regal-schnellkonfigurator?regalart=fachboden" },
    ctaSecondary: { label: "So bauen Sie Ihr Regal", href: "#aufbau" },
    heroImage: {
      src: "https://shop.meta-online.com/media/75/cc/af/1737642560/01_META_CLIP_Steckregale-1024x1024.webp",
      alt: "META CLIP Fachbodenregale mit Schubladen und Türen",
    },
    facts: [
      { value: "1.500–3.000 mm", label: "Höhe (1.000 und bis 4.500 mm auf Anfrage)" },
      { value: "750–1.700 mm", label: "Fachbodenlänge" },
      { value: "300–800 mm", label: "Tiefe" },
      { value: "bis 330 kg", label: "Fachlast je Boden" },
    ],
    systems: {
      title: "Welche Ausführung passt?",
      intro: "META CLIP gibt es mit zwei Rahmenarten und zwei Arten der Aussteifung. Im Shop erkennen Sie die Rahmen am Namen: „META CLIP S3“ hat zerlegte Rahmen, „META CLIP“ vorgefertigte, geclinchte Rahmen.",
      comparisons: ["s3-geclincht", "diagonal-laengsriegel"],
    },
    tiles: [
      { label: "Grundregale", text: "Das erste Feld jeder Regalzeile: 2 Rahmen und Fachböden", href: "/clip-grundregale" },
      { label: "Anbauregale", text: "Jedes weitere Feld: 1 Rahmen und Fachböden", href: "/clip-anbauregale" },
      { label: "Böden und Auflagen", text: "Zusatz-Fachböden, Drahtböden und weitere Zusatzebenen", href: "/clip-boeden-und-auflagen" },
      { label: "Zubehör", text: "Fachteiler, Wandbefestigung, Rammschutz und mehr", href: "/clip-zubehoer" },
    ],
    guide: {
      title: "So bauen Sie Ihr META CLIP Fachbodenregal",
      intro: "In sechs Schritten vom Lagergut zur fertigen Regalzeile. Die Werte gelten für META CLIP laut Bestellkatalog.",
      steps: [
        {
          key: "last",
          title: "Last bestimmen",
          text: "Wiegen Sie, was auf einen Fachboden kommt. META CLIP Fachböden tragen 80, 150, 200, 230 oder 330 kg bei [[gleichmaessig-verteilt|gleichmäßig verteilter Last]]. Alle Böden eines Feldes zusammen dürfen die [[feldlast]] nicht überschreiten: mit Diagonalverstrebung bis 1.650 kg bei S3-Rahmen und bis 2.400 kg bei geclinchten Rahmen.",
          src: "Katalog S. 21, 25, 29, 210",
        },
        {
          key: "masse",
          title: "Maße wählen",
          text: "Höhe 1.500 bis 3.000 mm (1.000 und bis 4.500 mm auf Anfrage), Tiefe 300 bis 800 mm, Fachbodenlänge 750 bis 1.700 mm. Die [[fachhoehe]] richtet sich nach Ihrem Lagergut; die Fachböden lassen sich im 25-mm-Raster versetzen.",
          src: "Katalog S. 21, 26",
        },
        {
          key: "zeile",
          title: "Regalzeile zusammensetzen",
          text: "Das erste Feld ist ein [[grundregal]] mit 2 Rahmen, jedes weitere ein [[anbauregal]] mit 1 Rahmen. Den Platzbedarf bestimmen die Fußplatten: Grundregal Fachbodenlänge + 82 mm, jedes Anbauregal + 41 mm. Die Feldlasten gelten für Regalzeilen ab 3 Feldern.",
          src: "Katalog S. 25, 26",
        },
        {
          key: "bedienseite",
          title: "Bedienseite festlegen",
          text: "An der Wand: [[diagonalverstrebung]] an der Rückseite, das Regal wird von vorn bedient und mit Spannschlössern ausgerichtet. Frei im Raum: [[laengsriegel]], von beiden Seiten bedienbar, auch für Langgut (nur mit S3-Rahmen). Doppelzeilige Regale stehen Rücken an Rücken und sind fest verbunden.",
          src: "Katalog S. 23, 29",
        },
        {
          key: "kippen",
          title: "Gegen Kippen sichern",
          text: "Ist das Regal mehr als 4-mal so hoch wie tief, sichern Sie es mit einem Wandbefestigungs- oder Fußverdübelungsset gegen Kippen. Die Sets gibt es für Grund- und Anbauregal. Reifenregale und Regale mit Schubladen immer mit Fußverankerung sichern. Die stirnseitigen Rahmen schützt eine nachrüstbare [[rammschutz|Rammschutzwand]].",
          src: "Katalog S. 25, 81",
        },
        {
          key: "aufbau",
          title: "Aufbauen",
          text: "Prüfen Sie den Lieferumfang anhand des Lieferscheins. META CLIP wird ohne Werkzeug gesteckt: Der S3-Rahmen ist in drei Klicks fertig, falsches Zusammenstecken ist ausgeschlossen ([[clip-easy]]); geclinchte Rahmen kommen fertig montiert. Sichern Sie das Regal schon während der Montage gegen Kippen, beladen Sie es erst danach und bringen Sie das Typenschild gut sichtbar an.",
          src: "Katalog S. 28; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          fields: 3,
          nominal: 1000,
          height: 2000,
          depth: 400,
          levels: 5,
          shelfLoad: 150,
          fieldLoad: 1100,
          space: 3200,
          plan: { base: 56, addOn: 6 },
          foot: { base: 82, addOn: 41 },
        },
        lines: [
          { qty: 1, number: "4026212260212", label: "CLIP S3 Grundregal 2000 × 1000 × 400 mm, 150 kg" },
          { qty: 2, number: "4026212260229", label: "CLIP S3 Anbauregal 2000 × 1000 × 400 mm, 150 kg" },
          { qty: 1, number: "4026212303179", label: "Wandbefestigungsset für Grundregal" },
          { qty: 2, number: "4026212109764", label: "Wandbefestigungsset für Anbauregal" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=fachboden&hoehe=2000&breite=1000&tiefe=400&last=150&laenge=3200",
      },
      drawing: { parts: ["Rahmen", "Fachboden", "Diagonalverstrebung (Rückseite)"], bracing: "diagonal" },
      avoid: [
        "Das Regal beladen, bevor es fertig montiert und gesichert ist.",
        "Nur auf die Fachlast achten: Alle Böden eines Feldes zusammen dürfen nicht mehr tragen als die Feldlast.",
        "Ein hohes, schmales Regal ohne Wand- oder Fußverankerung aufstellen.",
        "Lagergut einseitig stapeln statt gleichmäßig verteilen.",
        "Auf Fachböden oder Rahmen steigen.",
      ],
      avoidSrc: "Katalog S. 25, 210; Sicherheitshinweise 02.2024 S. 2–3",
      operation: OPERATION_COMMON,
      operationSrc: OPERATION_SRC,
      instructions: { label: "Montageanleitungen und Videos", href: INSTRUCTIONS_HREF },
      service: { label: "Montageservice anfragen", href: SERVICE_HREF },
    },
    planImages: [
      {
        src: "https://shop.meta-online.com/media/f1/96/cd/1740651149/Screenshot%202025-02-27%20111132.webp",
        alt: "META CLIP Regal – Maßzeichnung mit Rahmenhöhe (A), Fachhöhe (B) und Tiefensteife (C)",
      },
      {
        src: "https://shop.meta-online.com/media/b2/3b/e3/1740651223/Screenshot%202025-02-27%20111319.webp",
        alt: "META CLIP Regal – Maßzeichnung der Fußplatten in Längsrichtung: Innenmaß (D), Rahmenmaß (F), Außenmaß (G)",
      },
      {
        src: "https://shop.meta-online.com/media/a2/ac/de/1740651297/Screenshot%202025-02-27%20111432.webp",
        alt: "META CLIP Doppelregal – Maßzeichnung in Tiefenrichtung: Rahmeninnenmaß (K), Rahmenaußenmaß (L), Doppelregaltiefe (M)",
      },
      {
        src: "https://shop.meta-online.com/media/65/cb/67/1740651353/Screenshot%202025-02-27%20111534.webp",
        alt: "META CLIP Regal – Maßzeichnung der Fußplatten in Tiefenrichtung",
      },
    ],
    planNote: "Planmaße einzeilig: Grundregal Nennlänge + 56 mm, Anbauregal + 6 mm, Tiefe Nenntiefe + 36 mm; doppelzeilig 2 x Nenntiefe + 75 mm. Nennlänge = Fachbodenlänge.",
    productsTitle: "Meistgekaufte Fachbodenregale",
    productNumbers: ["4026212260250", "4026212260212", "4026212323382", "4026212281491", "4026212260229", "4026212260267", "4026212259988", "4026212281545"],
    productsHref: "/clip-grundregale",
    seo: {
      title: "META CLIP: das Fachbodenregal aus Arnsberg",
      paragraphs: [
        "META CLIP ist ein Fachbodenregalsystem für alle Anwendungen der Kleinteilelagerung, zum Beispiel Ersatzteilmagazine in Industrie und Handwerk. Gefertigt wird es am META-Standort Arnsberg.",
        "Die Fachböden sind im 50-mm-Raster gelocht und nehmen Fachteiler und Trenngitter auf (außer 80-kg-Fachböden). Die Oberflächen sind sendzimirverzinkt oder zusätzlich kunststoffbeschichtet in RAL 7035 lichtgrau.",
      ],
      links: [
        { label: "Regal-Lexikon: Fachlast, Feldlast und mehr", href: LEXIKON },
        { label: "Regale fürs Handwerk", href: "/branchen/handwerk-werkstatt" },
        { label: "Regale für die Industrie", href: "/branchen/industrie-produktion" },
        { label: "Regale für Kfz-Werkstatt und Reifenhandel", href: "/branchen/kfz-werkstatt-reifenhandel" },
      ],
    },
    faqTitle: "Häufige Fragen zu Fachbodenregalen",
    faq: [
      FAQ_SELF_BUILD_CLIP,
      {
        q: "Was ist der Unterschied zwischen META CLIP und CLIP S3?",
        a: "Der Unterschied liegt im Rahmen: Bei META CLIP werden vorgefertigte, maschinell geclinchte Rahmen fertig montiert geliefert – sie tragen bis zu über 70 % mehr als zerlegte Rahmen. Bei CLIP S3 kommen die Rahmen zerlegt und werden ohne Werkzeug zusammengesteckt.",
      },
      {
        q: "Wie viel trägt ein META CLIP Regal?",
        a: "Je nach Ausführung tragen die Fachböden 80, 150, 200, 230 oder 330 kg. Beim Steckregal mit Diagonalverstrebung liegt die Feldlast bei bis zu 1.650 kg mit zerlegten S3-Rahmen und bis zu 2.400 kg mit vorgefertigten, geclinchten Rahmen.",
      },
      {
        q: "Muss ich das Regal an der Wand oder im Boden befestigen?",
        a: "Ja, wenn das Verhältnis von Höhe zu Tiefe größer als 4 : 1 ist: Dann muss das Regal mit einer Wand- oder Fußverankerung gegen Kippen gesichert werden. Reifenregale und Regale mit Schubladen sind immer mit Fußverankerung zu sichern.",
      },
      {
        q: "Wofür eignet sich META CLIP?",
        a: "META CLIP ist ein Fachbodenregalsystem für alle Anwendungen der Kleinteilelagerung, zum Beispiel Ersatzteilmagazine in Industrie und Handwerk. Aus Rahmen und Fachböden entstehen Regalzeilen, die sich mit umfangreichem Systemzubehör an das Lagergut anpassen lassen.",
      },
      FAQ_INSPECTION,
    ],
    advice: ADVICE_COMMON,
    notes: {
      hero: {
        text: "Kopf und Kennzahlen nach Vorlage A/B. Kennzahlen sind Systemwerte laut Katalog: Fachlast 330 kg statt bisher „4.400 kg Fachlast“ (4.400 kg ist die höchste Feldlast). Bild = bisheriges Agenturbild aus den Shop-Medien. Vorteile ohne Garantie (bleibt draußen wie im Lexikon) und ohne „RAL-gütegesichert“ (Katalog nennt RAL-RG 614/1 nur allgemein für Fachbodenregale, nicht ausdrücklich für CLIP). URL und Meta-Texte bleiben an der Landingpage unverändert.",
        src: "Katalog S. 11, 19, 21; Shop-Kopfzeile",
      },
      systems: {
        text: "Vergleiche kommen 1:1 aus dem Regal-Lexikon (glossary.ts), damit Lexikon und Landingpage dasselbe sagen. Die Preisaussage S3 < geclincht prüft exportGlossary.ts gegen den Shop.",
        src: "Katalog S. 23, 25, 28, 29, 210",
      },
      tiles: {
        text: "„CLIP Komplettregale“ fehlt bewusst: Die Kategorie ist live leer (alle Artikel inaktiv, Befund 15.10.2026).",
        src: "Shop-Kategorien Live (Inhalt der Listen am 20.10.2026 geprüft)",
      },
      guide: {
        text: "Neuer Abschnitt F. Sechs feste Schritte auf allen fünf Seiten; Fachbegriffe verlinken ins Regal-Lexikon. Schritt 6 und „Sicher im Betrieb“ stammen aus den Sicherheitshinweisen, die jeder Lieferung beiliegen (DGUV Regel 108-007 bewusst nicht genannt, zurückgezogen).",
        checks: ["Montageanleitungen: meta-online.com hat keine festen PDF-Adressen, Link führt auf die gefilterte Liste (Anleitungen + Videos)"],
        src: "Katalog S. 21–29, 81, 210; Sicherheitshinweise 02.2024",
      },
      example: {
        text: "Beispiel errechnet, nicht getippt: Fußplatten 1.082 + 2 × 1.041 mm (Katalog S. 26), Planmaß 1.056 + 2 × 1.006 mm (S. 25). Feldlast 1.100 kg = Shop-Eigenschaft „max. Feldlast“ des Artikels; Kippsicherung laut Shop-Eigenschaft „vorgeschrieben: ja“. Im Shop wird der Knopf ein echtes Warenkorb-Formular wie auf den Branchenseiten.",
        checks: ["Wandbefestigungsset „META CLIP“ passt auch zu CLIP S3?"],
        src: "Katalog S. 25, 26, 81; Live-Artikel",
      },
      plan: {
        text: "Die vier Maßzeichnungen der Agentur bleiben (Bilder aus den Shop-Medien); darunter jetzt die Systemwerte als Tabelle statt der langen Buchstabenliste.",
        src: "Katalog S. 21, 25, 26",
      },
      products: {
        text: "Im Shop: Shopware-Produktslider mit den Topsellern aus CLIP Grund- und Anbauregalen. Im Entwurf die ersten Artikel der Live-Listen (Sortierung Topseller).",
        src: "Live-Listen /clip-grundregale, /clip-anbauregale",
      },
      seo: {
        text: "Kurzer Text statt des Briefing-Platzhalters „Effizient lagern mit System“; Links ins Lexikon und auf die Branchenseiten.",
        src: "Katalog S. 11, 19, 25",
      },
      faq: {
        text: "FAQ-Plugin (hueb). Antworten aus den Korrekturen vom 15.10. (landingPageTexts.ts) plus „Selbst aufbauen?“ und die gemeinsame Prüfpflicht-Frage.",
        src: "Katalog S. 16, 19, 21, 25, 28, 29",
      },
      advice: { text: "Gemeinsamer Beratungsblock aller fünf Seiten.", src: "Katalog S. 11; Shop-Footer" },
    },
  },
];

const fmt = (n: number) => n.toLocaleString("de-DE");

/** Zahlen des Rechenbeispiels aus Artikelwerten und Katalog-Zuschlägen */
export function rowFigures(r: RowSpec) {
  const addOns = r.fields - 1;
  const planLength = r.nominal + r.plan.base + addOns * (r.nominal + r.plan.addOn);
  const footLength = r.nominal + r.foot.base + addOns * (r.nominal + r.foot.addOn);
  const frames = r.fields + 1;
  const sumLoad = r.levels * r.shelfLoad;
  return {
    addOns,
    frames,
    planBase: r.nominal + r.plan.base,
    planAddOn: r.nominal + r.plan.addOn,
    footBase: r.nominal + r.foot.base,
    footAddOn: r.nominal + r.foot.addOn,
    planLength,
    footLength,
    fits: footLength <= r.space,
    sumLoad,
    loadOk: sumLoad <= r.fieldLoad,
    ratio: r.height / r.depth,
    anchor: r.height / r.depth > 4,
  };
}

/** Texte des Rechenbeispiels je Schritt (nur Schritte, zu denen das Beispiel etwas sagt) */
export function exampleTexts(r: RowSpec): Partial<Record<BuildStepKey, string>> {
  const f = rowFigures(r);
  return {
    last: `${r.levels} Böden × ${fmt(r.shelfLoad)} kg = ${fmt(f.sumLoad)} kg. Das Beispielregal hat eine Feldlast von ${fmt(r.fieldLoad)} kg – ${f.loadOk ? "passt" : "zu viel"}.`,
    zeile: `Wand ${fmt(r.space)} mm, Böden ${fmt(r.nominal)} mm: 1 Grundregal + ${f.addOns} Anbauregale = ${fmt(f.footBase)} + ${f.addOns} × ${fmt(f.footAddOn)} = ${fmt(f.footLength)} mm bis zu den Fußplatten – ${f.fits ? "passt" : "passt nicht"}.`,
    kippen: `${fmt(r.height)} mm hoch, ${fmt(r.depth)} mm tief: ${f.anchor ? "mehr als 4 : 1, also je Regal ein Wandbefestigungsset" : "höchstens 4 : 1, keine Verankerung vorgeschrieben"}.`,
  };
}

/** Maßtabelle (Systemwerte) der Seite aus catalogFacts.ts */
export function catalogSpans(page: CategoryLandingPage): { page: number; rows: Array<[string, string]> } {
  const sys = CATALOG_SYSTEMS.find((s) => s.key === page.catalogSystem);
  if (!sys?.spans) throw new Error(`${page.key}: Katalogsystem ${page.catalogSystem} ohne Maßtabelle`);
  return sys.spans;
}

/** Artikelnummern, die der Entwurf aus dem Shop-Stand braucht */
export function landingProductNumbers(page: CategoryLandingPage): string[] {
  return [...new Set([...page.productNumbers, ...page.guide.example.lines.map((l) => l.number)])];
}
