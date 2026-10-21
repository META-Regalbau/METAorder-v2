// Inhalte der System-Landingpages (Menüpunkte Fachboden-, Büro-, Paletten-, Kragarm-, Weitspannregale) nach der
// gemeinsamen Vorlage A–K (Konzept Kategorie-Landingpages 20.10.2026, E1–E7 vom User freigegeben).
// Eine Quelle für Entwurf (scripts/exportCategoryLandingPages.ts) und später das Schreibskript in den Shop.
// Regel des Users: nur belegte META-Inhalte, nichts Erfundenes, keine Wettbewerber (siehe categoryTexts.ts).
// Jede Zahl steht in catalogFacts.ts (Katalog bzw. Sicherheitshinweise, Seitenangabe in `src`); die Zahlen der
// Rechenbeispiele werden aus Artikeldaten und Katalog-Planmaßen errechnet ({platzhalter} in den Vorlagen).
// Fachbegriffe als [[schluessel]] bzw. [[schluessel|Text]] verlinken ins Regal-Lexikon (glossary.ts).
import type { IndustryNote } from "@shared/shopContent";
import type { GlossaryComparison } from "./glossary";
import { CATALOG_SYSTEMS } from "./catalogFacts";

export type LandingNoteKey = "hero" | "systems" | "tiles" | "guide" | "example" | "plan" | "products" | "seo" | "faq" | "advice";
export type LandingLink = { label: string; href: string };

/** Die sechs Schritte des Aufbau-Abschnitts – auf allen Seiten dieselben, in dieser Reihenfolge. */
export const BUILD_STEP_KEYS = ["last", "masse", "zeile", "bedienseite", "kippen", "aufbau"] as const;
export type BuildStepKey = (typeof BUILD_STEP_KEYS)[number];
export type BuildStep = { key: BuildStepKey; title: string; text: string; src: string };

/** Regalzeile für Rechenbeispiel und Zeichnung */
export type RowSpec = {
  /** Zeichnung: Fachboden-/Weitspannregal, Palettenregal oder Kragarmregal */
  kind: "shelf" | "pallet" | "cantilever";
  fields: number;
  /** Nennlänge (Fachboden-, Holmlänge) bzw. Achsmaß beim Kragarmregal (mm) */
  nominal: number;
  height: number;
  /** Nenntiefe bzw. Armlänge (mm) */
  depth: number;
  /** Ebenen, die zur Feld- bzw. Ständerlast zählen */
  loadLevels: number;
  /** Lasteinheiten je Ebene (Paletten je Holmebene; sonst 1) */
  perLevel: number;
  /** Last je Einheit: Fachlast, Last je Palettenplatz, Armlast (kg, Artikel) */
  perLoad: number;
  /** Feldlast bzw. Ständerlast (kg) */
  totalLoad: number;
  /** Gewicht des Lagerguts je Einheit, z. B. Palette (kg); optional */
  itemWeight?: number;
  /** verfügbarer Platz, z. B. Wandlänge (mm) */
  space: number;
  /** Zuschläge zur Länge laut Katalog (Grundregal, Anbauregal) und wie das Maß heißt */
  length: { base: number; addOn: number; label: string };
  /** Zweites Längenmaß (z. B. Planmaß neben dem Fußplatten-Außenmaß) */
  secondary?: { base: number; addOn: number; label: string };
  /** Einheiten je Feld (Ordner, Palettenplätze), für {units} */
  perField?: number;
  /** Bodenanker je Rahmen, für {anchors} */
  anchorsPerFrame?: number;
  /** Zeichnung: Ebenen, Aussteifung, Bodenstil */
  drawLevels: number;
  bracing: "diagonal" | "none";
  board?: "steel" | "wood";
};

export type BuildExample = {
  row: RowSpec;
  /** Texte je Schritt mit {platzhaltern} aus rowFigures */
  texts: Partial<Record<BuildStepKey, string>>;
  /** Kippsicherung: Text bei > 4 : 1 bzw. höchstens 4 : 1 (für {anchorVerdict}) */
  anchorYes: string;
  anchorNo: string;
  title: string;
  sub: string;
  /** Artikel der Beispielzeile (Warenkorb) */
  lines: Array<{ qty: number; number: string; label: string }>;
  configuratorHref: string;
};

export type BuildGuide = {
  title: string;
  intro: string;
  steps: BuildStep[];
  example: BuildExample;
  /** Legende der Zeichnung (Nummern 1…n) */
  parts: string[];
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
  /** Bisherige Erlebniswelt der Landingpage (Agentur); bleibt erhalten und kommt mit --revert zurück */
  agencyCmsPageId: string;
  /** Bestehende FAQ-Gruppe der Seite (bekommt die Fragen aus dem Code); ohne Angabe legt das Skript eine eigene an */
  faqGroupId?: string;
  url: string;
  name: string;
  /** Katalogsysteme für die Maßtabellen (catalogFacts.ts) */
  catalogSystems: string[];
  eyebrow: string;
  h1: string;
  lead: string;
  proof: string[];
  ctaPrimary: LandingLink;
  ctaSecondary: LandingLink;
  heroImage: { src: string; alt: string };
  facts: Array<{ value: string; label: string }>;
  /** Vergleiche: Schlüssel aus dem Regal-Lexikon oder eigene (extraComparisons) */
  systems: { title: string; intro: string; comparisons: string[]; extraComparisons?: GlossaryComparison[] };
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
/** Service-Seiten im Shop (servicePages.ts): Anleitungen/Videos mit Sprung zur Regalart, Montageservice-Anfrage */
const INSTRUCTIONS = (anchor: string) => ({ label: "Montageanleitungen und Videos", href: `/service/montageanleitungen#${anchor}` });
const SERVICE = { label: "Montageservice anfragen", href: "/service/montageservice" };

/** Für alle Seiten gleich: sicher im Betrieb (Sicherheitshinweise 02.2024, Katalog S. 16) */
export const OPERATION_COMMON = [
  "Lasten gleichmäßig verteilen, Stöße und Schieben vermeiden, Fach- und Feldlasten nie überschreiten.",
  "Regal und Bauteile nie besteigen.",
  "Beschädigte oder verformte Bauteile sofort ersetzen.",
  "Umbauen oder Umstellen nur unbeladen und nach Rücksprache mit META.",
  "Sichtprüfung jede Woche, [[regalinspektion|Inspektion]] durch eine fachkundige Person spätestens alle 12 Monate (§ 14 Betriebssicherheitsverordnung).",
];
const OPERATION_SRC = "Sicherheitshinweise 02.2024 S. 3; Katalog S. 16";
/** Schluss des Aufbau-Schritts, für alle Seiten gleich (Sicherheitshinweise 02.2024 S. 2) */
const BUILD_END = "Sichern Sie das Regal schon während der Montage gegen Kippen, beladen Sie es erst danach und bringen Sie das Typenschild gut sichtbar an.";

const FAQ_INSPECTION = {
  q: "Müssen Regale regelmäßig geprüft werden?",
  a: "Ja. Regale sind Arbeitsmittel und unterliegen nach § 14 Betriebssicherheitsverordnung der Prüfpflicht. Die Inspektion muss mindestens alle 12 Monate durch eine fachkundige Person erfolgen. META bietet die Regalinspektion als Service an.",
};
const SERVICE_SENTENCE = "Wenn Sie nicht selbst aufbauen möchten, übernimmt das der META-Montageservice.";

export const ADVICE_COMMON = {
  title: "Sie planen eine größere Anlage?",
  text: "Unser Außendienst berät Sie vor Ort, unsere Projektingenieure erstellen einen Planungsvorschlag mit CAD-Zeichnung, und auf Wunsch bauen geschulte Montageteams Ihre Regale auf.",
};
const ADVICE_NOTE: IndustryNote = { text: "Gemeinsamer Beratungsblock aller fünf Seiten.", src: "Katalog S. 11; Shop-Footer" };
const GUIDE_NOTE_COMMON =
  "Neuer Abschnitt F. Sechs feste Schritte auf allen fünf Seiten; Fachbegriffe verlinken ins Regal-Lexikon. Schritt 6 und „Sicher im Betrieb“ stammen aus den Sicherheitshinweisen, die jeder Lieferung beiliegen (DGUV Regel 108-007 bewusst nicht genannt, zurückgezogen).";
const INSTRUCTIONS_CHECK = "Montageanleitungen und Montageservice verlinken auf die neuen Service-Seiten im Shop (/service/montageanleitungen, /service/montageservice)";

const LEXIKON_LINK = { label: "Regal-Lexikon: Fachlast, Feldlast und mehr", href: LEXIKON };
const BRANCHE = {
  kfz: { label: "Regale für Kfz-Werkstatt und Reifenhandel", href: "/branchen/kfz-werkstatt-reifenhandel" },
  handwerk: { label: "Regale fürs Handwerk", href: "/branchen/handwerk-werkstatt" },
  industrie: { label: "Regale für die Industrie", href: "/branchen/industrie-produktion" },
  buero: { label: "Regale für Büro, Archiv und Verwaltung", href: "/branchen/buero-archiv-verwaltung" },
  handel: { label: "Regale für Handel und Versand", href: "/branchen/handel-versand" },
};

/** Gleiche Vorlage für die Zeilen-Rechnung aller Systeme mit Grund- und Anbauregal */
const ROW_TEXT = (what: string, unit: string) =>
  `${what} {space} mm, ${unit} {nominal} mm: 1 Grundregal + {addOns} Anbauregale = {baseLen} + {addOns} × {addOnLen} = {length} mm {lengthLabel} – {fitVerdict}.`;

export const CATEGORY_LANDING_PAGES: CategoryLandingPage[] = [
  // ───────────────────────────── Fachbodenregale ─────────────────────────────
  {
    key: "fachboden",
    landingPageId: "0194e59da2b67a3cb89838ad5800d8a4",
    agencyCmsPageId: "0194e574b4ac7285a215a414de3f8bf4",
    faqGroupId: "01948db5b1d076d1afa0f97a8c87a7c6", // Agentur-Gruppe „Fachbodenregale“, auch auf /faq
    url: "/fachbodenregale/",
    name: "Fachbodenregale",
    catalogSystems: ["clip"],
    eyebrow: "META CLIP Fachbodenregale",
    h1: "Fachbodenregale für Kleinteile, Ersatzteile und Kartons",
    lead:
      "META CLIP besteht aus zwei Bausteinen: Rahmen und Fachböden. Daraus entstehen Regalzeilen mit beliebig vielen Feldern, gesteckt ohne Werkzeug. Die Fachböden hängen Sie in der Höhe in 25-mm-Schritten ein, so passt jedes Fach zu Ihrem Lagergut; Systemzubehör ergänzt das Regal. Hier bestellen Sie die Regale direkt und sehen Schritt für Schritt, worauf es beim Aufbau ankommt.",
    proof: ["Gefertigt in Arnsberg", "Steckmontage ohne Werkzeug", "Böden in 25-mm-Schritten höhenverstellbar", "Kostenloser Versand"],
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
          text: "Höhe 1.500 bis 3.000 mm (1.000 und bis 4.500 mm auf Anfrage), Tiefe 300 bis 800 mm, Fachbodenlänge 750 bis 1.700 mm. Die [[fachhoehe]] richtet sich nach Ihrem Lagergut; die Fachböden lassen sich in 25-mm-Schritten höher oder tiefer einhängen.",
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
          text: `Prüfen Sie den Lieferumfang anhand des Lieferscheins. META CLIP wird ohne Werkzeug gesteckt: Der S3-Rahmen ist in drei Klicks fertig, falsches Zusammenstecken ist ausgeschlossen ([[clip-easy]]); geclinchte Rahmen kommen fertig montiert. ${BUILD_END}`,
          src: "Katalog S. 28; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          kind: "shelf",
          fields: 3,
          nominal: 1000,
          height: 2000,
          depth: 400,
          loadLevels: 5,
          perLevel: 1,
          perLoad: 150,
          totalLoad: 1100,
          space: 3200,
          length: { base: 82, addOn: 41, label: "bis zu den Fußplatten" },
          secondary: { base: 56, addOn: 6, label: "Planmaß" },
          drawLevels: 5,
          bracing: "diagonal",
          board: "steel",
        },
        texts: {
          last: "{loadLevels} Böden × {perLoad} kg = {sumLoad} kg. Das Beispielregal hat eine Feldlast von {totalLoad} kg – {loadVerdict}.",
          zeile: ROW_TEXT("Wand", "Böden"),
          kippen: "{height} mm hoch, {depth} mm tief: {anchorVerdict}",
        },
        anchorYes: "mehr als 4 : 1, also je Regal ein Wandbefestigungsset.",
        anchorNo: "höchstens 4 : 1, keine Verankerung vorgeschrieben.",
        title: "Beispiel: {space} mm Wand",
        sub: "{fields} Felder à {nominal} mm, {height} mm hoch, {depth} mm tief, {loadLevels} Böden à {perLoad} kg, an der Wand befestigt",
        lines: [
          { qty: 1, number: "4026212260212", label: "CLIP S3 Grundregal 2000 × 1000 × 400 mm, 150 kg" },
          { qty: 2, number: "4026212260229", label: "CLIP S3 Anbauregal 2000 × 1000 × 400 mm, 150 kg" },
          { qty: 1, number: "4026212303179", label: "Wandbefestigungsset für Grundregal" },
          { qty: 2, number: "4026212109764", label: "Wandbefestigungsset für Anbauregal" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=fachboden&hoehe=2000&breite=1000&tiefe=400&last=150&laenge=3200",
      },
      parts: ["Rahmen", "Fachboden", "Diagonalverstrebung (Rückseite)"],
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
      instructions: INSTRUCTIONS("fachbodenregale"),
      service: SERVICE,
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
      links: [LEXIKON_LINK, BRANCHE.handwerk, BRANCHE.industrie, BRANCHE.kfz],
    },
    faqTitle: "Häufige Fragen zu Fachbodenregalen",
    faq: [
      {
        q: "Kann ich ein META CLIP Regal selbst aufbauen?",
        a: `Ja. META CLIP wird ohne Werkzeug gesteckt: Der zerlegte S3-Rahmen ist in drei Klicks fertig, falsches Zusammenstecken ist durch das CLIP-EASY-Verfahren ausgeschlossen; geclinchte Rahmen kommen fertig montiert. Beladen Sie das Regal erst, wenn es vollständig montiert und gesichert ist. ${SERVICE_SENTENCE}`,
      },
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
      guide: { text: GUIDE_NOTE_COMMON, checks: [INSTRUCTIONS_CHECK, "Diagonalverstrebung in jedem Feld oder nur im Grundregal? Zeichnung zeigt sie nur im Grundregal"], src: "Katalog S. 21–29, 81, 210; Sicherheitshinweise 02.2024" },
      example: {
        text: "Beispiel errechnet, nicht getippt: Fußplatten 1.082 + 2 × 1.041 mm (Katalog S. 26), Planmaß 1.056 + 2 × 1.006 mm (S. 25). Feldlast 1.100 kg = Shop-Eigenschaft „max. Feldlast“ des Artikels; Kippsicherung laut Shop-Eigenschaft „vorgeschrieben: ja“. Im Shop wird der Knopf ein echtes Warenkorb-Formular wie auf den Branchenseiten.",
        checks: ["Wandbefestigungsset „META CLIP“ passt auch zu CLIP S3?"],
        src: "Katalog S. 25, 26, 81; Live-Artikel",
      },
      plan: { text: "Die vier Maßzeichnungen der Agentur bleiben (Bilder aus den Shop-Medien); daneben die Systemwerte als Tabelle statt der langen Buchstabenliste.", src: "Katalog S. 21, 25, 26" },
      products: { text: "Im Shop: Shopware-Produktslider mit den Topsellern aus CLIP Grund- und Anbauregalen. Im Entwurf die ersten Artikel der Live-Listen (Sortierung Topseller).", src: "Live-Listen /clip-grundregale, /clip-anbauregale" },
      seo: { text: "Kurzer Text statt des Briefing-Platzhalters „Effizient lagern mit System“; Links ins Lexikon und auf die Branchenseiten.", src: "Katalog S. 11, 19, 25" },
      faq: { text: "FAQ-Plugin (hueb). Antworten aus den Korrekturen vom 15.10. (landingPageTexts.ts) plus „Selbst aufbauen?“ und die gemeinsame Prüfpflicht-Frage.", src: "Katalog S. 16, 19, 21, 25, 28, 29" },
      advice: ADVICE_NOTE,
    },
  },

  // ───────────────────────────── Büroregale ─────────────────────────────
  {
    key: "buero",
    landingPageId: "0194e5cb677f72008c0b8b581dc2ac4c",
    agencyCmsPageId: "0194f90cc31670c4ae41b165f94945b9",
    url: "/bueroregale",
    name: "Büroregale",
    catalogSystems: ["compact"],
    eyebrow: "META COMPACT Büroregale",
    h1: "Büroregale für Ordner, Akten und Archiv",
    lead:
      "META COMPACT ist das Büro-Steckregal für Büro, Meisterbüro und Archiv: ohne Werkzeug montiert, die Fachböden in der Höhe in 25-mm-Schritten einhängbar, verzinkt oder in RAL 7035 lichtgrau. Ein Regal mit 1.000 mm Länge und 2.200 mm Höhe nimmt bei 300 mm Tiefe 72 Ordner auf.",
    proof: ["Steckmontage ohne Werkzeug", "Böden in 25-mm-Schritten höhenverstellbar", "Verzinkt oder lichtgrau", "Kostenloser Versand"],
    ctaPrimary: { label: "Regal konfigurieren", href: "/regal-schnellkonfigurator?regalart=buero" },
    ctaSecondary: { label: "So bauen Sie Ihr Regal", href: "#aufbau" },
    heroImage: { src: "https://shop.meta-online.com/media/e2/5e/d8/1739475639/05_META_COMPACT_Steckregale-1024x1024.webp", alt: "META COMPACT Büroregal mit Ordnern" },
    facts: [
      { value: "1.850–2.500 mm", label: "Höhe" },
      { value: "750–1.250 mm", label: "Länge" },
      { value: "300 / 600 mm", label: "Tiefe" },
      { value: "bis 105", label: "Ordner je Regal (300 mm tief)" },
    ],
    systems: {
      title: "Welche Ausführung passt?",
      intro: "META COMPACT gibt es verzinkt mit zerlegten S3-Rahmen oder in RAL 7035 lichtgrau mit vorgefertigten, geclinchten Rahmen. Jede Regalzeile beginnt mit einem Grundregal.",
      comparisons: ["verzinkt-lichtgrau", "grund-anbau"],
    },
    tiles: [
      { label: "Grundregale", text: "Das erste Regal einer Zeile: 2 Rahmen mit Stahlfüßen und Fachböden", href: "/compact-grundregale" },
      { label: "Anbauregale", text: "Jedes weitere Regal: 1 Rahmen und Fachböden", href: "/compact-anbauregale" },
      { label: "Büro, Archiv und Verwaltung", text: "Branchenlösung mit Planungshilfe für Ordner und Akten", href: "/branchen/buero-archiv-verwaltung" },
      { label: "Fachbodenregale", text: "META CLIP für schwerere Lasten bis 330 kg je Boden", href: "/fachbodenregale/" },
    ],
    guide: {
      title: "So bauen Sie Ihr META COMPACT Büroregal",
      intro: "In sechs Schritten vom Ordnerbestand zur fertigen Regalzeile. Die Werte gelten für META COMPACT laut Bestellkatalog.",
      steps: [
        {
          key: "last",
          title: "Last bestimmen",
          text: "Ein Fachboden trägt 80 kg, bei 1.250 x 600 mm mit Mittelanschlag 100 kg – jeweils [[gleichmaessig-verteilt|gleichmäßig verteilt]]. Für Ordner hilft die Ordnerkapazität laut Katalog: bei 300 mm Tiefe 45 bis 105 Ordner je Regal, bei 600 mm Tiefe doppelt so viele.",
          src: "Katalog S. 100, 101",
        },
        {
          key: "masse",
          title: "Maße wählen",
          text: "Höhen 1.850, 2.200 und 2.500 mm mit 5, 6 oder 7 Böden, Längen 750, 1.000 und 1.250 mm, Tiefen 300 und 600 mm. Die Fachböden lassen sich in 25-mm-Schritten höher oder tiefer einhängen.",
          src: "Katalog S. 99–101",
        },
        {
          key: "zeile",
          title: "Regalzeile zusammensetzen",
          text: "Das erste Regal ist ein [[grundregal]] mit 2 Rahmen und Stahlfüßen, jedes weitere ein [[anbauregal]] mit 1 Rahmen. [[planmass|Planmaß]]: Grundregal Länge + 56 mm, Anbauregal + 6 mm, Tiefe + 36 mm. Fach- und Feldlasten gelten ab 3 Feldern.",
          src: "Katalog S. 100",
        },
        {
          key: "bedienseite",
          title: "Bedienseite festlegen",
          text: "An der Wand: einseitiges Regal, ausgesteift mit [[diagonalverstrebung|Diagonalstreben]] an der Rückseite. Frei im Raum: doppelseitiges Regal mit [[laengsriegel|Längsriegeln]], von beiden Seiten erreichbar.",
          src: "Katalog S. 101",
        },
        {
          key: "kippen",
          title: "Gegen Kippen sichern",
          text: "Ein einseitiges Regal ist mehr als 4-mal so hoch wie tief und muss deshalb immer gegen Kippen gesichert werden: mit einem Wandbefestigungs- oder Fußverdübelungsset. Die Stahlfüße sind dübelfähig.",
          src: "Katalog S. 100, 101",
        },
        {
          key: "aufbau",
          title: "Aufbauen",
          text: `Prüfen Sie den Lieferumfang anhand des Lieferscheins. META COMPACT wird ohne Werkzeug gesteckt. ${BUILD_END}`,
          src: "Katalog S. 99; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          kind: "shelf",
          fields: 3,
          nominal: 1000,
          height: 2200,
          depth: 300,
          loadLevels: 6,
          perLevel: 1,
          perLoad: 80,
          totalLoad: 1750,
          space: 3200,
          length: { base: 56, addOn: 6, label: "Planmaß" },
          perField: 72,
          drawLevels: 6,
          bracing: "diagonal",
          board: "steel",
        },
        texts: {
          last: "{loadLevels} Böden × {perLoad} kg = {sumLoad} kg, Feldlast des Regals {totalLoad} kg – {loadVerdict}. Platz für {fields} × {perField} = {units} Ordner.",
          zeile: ROW_TEXT("Wand", "Regallänge"),
          kippen: "{height} mm hoch, {depth} mm tief, einseitig: {anchorVerdict}",
        },
        anchorYes: "mehr als 4 : 1, also je Regal ein Wandbefestigungsset.",
        anchorNo: "höchstens 4 : 1.",
        title: "Beispiel: {space} mm Wand im Büro",
        sub: "{fields} Regale à {nominal} mm, {height} mm hoch, {depth} mm tief, je {loadLevels} Böden, an der Wand befestigt",
        lines: [
          { qty: 1, number: "4026212287813", label: "COMPACT S3 Grundregal 2200 × 1000 × 300 mm" },
          { qty: 2, number: "4026212287820", label: "COMPACT S3 Anbauregal 2200 × 1000 × 300 mm" },
          { qty: 1, number: "4026212303179", label: "Wandbefestigungsset für Grundregal" },
          { qty: 2, number: "4026212109764", label: "Wandbefestigungsset für Anbauregal" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=buero&hoehe=2200&breite=1000&tiefe=300&laenge=3200",
      },
      parts: ["Rahmen", "Fachboden", "Diagonalstreben (Rückseite)"],
      avoid: [
        "Ein einseitiges Regal ohne Wand- oder Fußverankerung aufstellen.",
        "Die Fachlast überschreiten: Ein Fachboden trägt 80 kg, nur bei 1.250 x 600 mm 100 kg.",
        "Das Regal beladen, bevor es fertig montiert und gesichert ist.",
        "Auf Fachböden oder Rahmen steigen.",
      ],
      avoidSrc: "Katalog S. 100; Sicherheitshinweise 02.2024 S. 2–3",
      operation: OPERATION_COMMON,
      operationSrc: OPERATION_SRC,
      instructions: INSTRUCTIONS("fachbodenregale"),
      service: SERVICE,
    },
    planImages: [],
    planNote: "Planmaße: Grundregal Nennlänge + 56 mm, Anbauregal Nennlänge + 6 mm, Tiefe Nenntiefe + 36 mm.",
    productsTitle: "Meistgekaufte Büroregale",
    productNumbers: ["4026212287790", "4026212287875", "4026212287851", "4026212285871", "4026212287806", "4026212287882", "4026212285888", "4026212287868"],
    productsHref: "/compact-grundregale",
    seo: {
      title: "META COMPACT: das Büro-Steckregal",
      paragraphs: [
        "META COMPACT ist ein Büro-Steckregal für Büro, Meisterbüro und Archiv. Die Fachböden haben End- und Mittelanschlag (der Abdeckboden ohne) und lassen sich in der Höhe in 25-mm-Schritten versetzen; die Stahlfüße sind dübelfähig.",
        "Verzinkt kommt META COMPACT mit zerlegten S3-Rahmen, in RAL 7035 lichtgrau mit vorgefertigten, geclinchten Rahmen.",
      ],
      links: [LEXIKON_LINK, BRANCHE.buero, { label: "Fachbodenregale für schwerere Lasten", href: "/fachbodenregale/" }],
    },
    faqTitle: "Häufige Fragen zu Büroregalen",
    faq: [
      {
        q: "Kann ich ein META COMPACT Büroregal selbst aufbauen?",
        a: `Ja. META COMPACT wird ohne Werkzeug gesteckt. Ein einseitiges Regal muss gegen Kippen gesichert werden, weil es mehr als 4-mal so hoch wie tief ist; dafür gibt es Wandbefestigungs- und Fußverdübelungssets. Beladen Sie das Regal erst, wenn es fertig montiert und gesichert ist. ${SERVICE_SENTENCE}`,
      },
      {
        q: "Wie viele Ordner passen in ein META COMPACT Regal?",
        a: "Bei 300 mm Tiefe 45, 60 oder 75 Ordner bei 1.850 mm Höhe (5 Böden), 54, 72 oder 90 bei 2.200 mm (6 Böden) und 63, 84 oder 105 bei 2.500 mm (7 Böden) – jeweils für 750, 1.000 oder 1.250 mm Länge. Bei 600 mm Tiefe passen doppelt so viele hinein.",
      },
      { q: "Wie viel trägt ein Fachboden?", a: "80 kg bei gleichmäßig verteilter Last; bei 1.250 x 600 mm mit Mittelanschlag 100 kg." },
      {
        q: "Verzinkt oder lichtgrau?",
        a: "Verzinkt kommt META COMPACT mit zerlegten S3-Rahmen, in RAL 7035 lichtgrau mit vorgefertigten, geclinchten Rahmen. Die Fachlast ist bei beiden gleich; die lichtgraue Ausführung passt in sichtbare Bereiche wie das Büro.",
      },
      FAQ_INSPECTION,
    ],
    advice: ADVICE_COMMON,
    notes: {
      hero: {
        text: "Bisher stand hier die Überschrift „META CLIP – Planmaße“ und eine CLIP-Lastzeile. Jetzt nur COMPACT-Werte laut Katalog. „Gefertigt in Arnsberg“ fehlt bewusst: Der Katalog nennt Arnsberg nur für CLIP, FIX, MINI-RACK, SPEED-RACK und MULTIPAL.",
        src: "Katalog S. 11, 99–101",
      },
      systems: { text: "Vergleiche aus dem Regal-Lexikon. „S3 oder geclincht“ passt hier nicht, weil die Rahmenart bei COMPACT an der Farbe hängt.", src: "Katalog S. 17, 100, 210" },
      tiles: { text: "Für COMPACT gibt es nur Grund- und Anbauregale als eigene Kategorien; dazu Branchenseite und Fachbodenregale als Weg für schwerere Lasten.", src: "Shop-Kategorien Live" },
      guide: { text: GUIDE_NOTE_COMMON, checks: [INSTRUCTIONS_CHECK], src: "Katalog S. 99–101; Sicherheitshinweise 02.2024" },
      example: {
        text: "Planmaß 1.056 + 2 × 1.006 mm (Katalog S. 100). Ordner: 72 je Regal bei 2.200 × 1.000 × 300 mm (S. 101). Feldlast 1.750 kg = Shop-Eigenschaft „max. Feldlast“; Kippsicherung laut Shop „vorgeschrieben: ja“.",
        checks: ["Im Shop gibt es nur das Wandbefestigungsset „META CLIP“ – passt es zu COMPACT (Katalog S. 101 führt eigene COMPACT-Sets)?"],
        src: "Katalog S. 100, 101; Live-Artikel",
      },
      plan: { text: "Die beiden bisherigen Maßzeichnungen zeigen CLIP und entfallen; stattdessen Systemwerte und Planmaße als Text.", src: "Katalog S. 99, 100" },
      products: { text: "Im Shop: Produktslider mit den Topsellern aus COMPACT Grund- und Anbauregalen.", src: "Live-Listen /compact-grundregale, /compact-anbauregale" },
      seo: { text: "Bisher kein SEO-Text auf der Seite.", src: "Katalog S. 99, 100" },
      faq: { text: "Bisher keine FAQ auf der Seite. Neue Gruppe im FAQ-Plugin.", src: "Katalog S. 16, 99–101" },
      advice: ADVICE_NOTE,
    },
  },

  // ───────────────────────────── Palettenregale ─────────────────────────────
  {
    key: "paletten",
    landingPageId: "018fcfe0689776c3a5dd4d6cc9068494",
    agencyCmsPageId: "019546f2850d7019ad025f86b7cd2be0",
    faqGroupId: "01948db6257f7c278c34d4779b8edfb2", // Agentur-Gruppe „Palettenregale“, auch auf /faq
    url: "/palettenregale/",
    name: "Palettenregale",
    catalogSystems: ["multipal"],
    eyebrow: "META MULTIPAL Palettenregale",
    h1: "Palettenregale für Europaletten, Gitterboxen und Stückgut",
    lead:
      "META MULTIPAL ist das Palettenregalsystem aus Arnsberg: Ständerrahmen mit verschraubter Ausfachung, Holme im 50-mm-Raster eingehängt und mit Sicherungsstiften gesichert, gütegesichert nach RAL-RG 614/2 mit GS-Zeichen. Hier bestellen Sie Grund- und Anbauregale und sehen, wie Sie eine Regalzeile richtig planen.",
    proof: ["Gefertigt in Arnsberg", "RAL-RG 614/2 und GS-Zeichen", "Statik nach DIN EN 15512", "Kostenloser Versand"],
    ctaPrimary: { label: "Regal konfigurieren", href: "/regal-schnellkonfigurator?regalart=palette" },
    ctaSecondary: { label: "So bauen Sie Ihr Regal", href: "#aufbau" },
    heroImage: { src: "https://shop.meta-online.com/media/c3/9a/82/1737642833/09_META_MULTIPAL_Palettenregale-1024x1024.webp", alt: "META MULTIPAL Palettenregal mit Europaletten" },
    facts: [
      { value: "2.200–12.000 mm", label: "Rahmenhöhe (verzinkt)" },
      { value: "1.825–3.600 mm", label: "Holmlänge" },
      { value: "800 / 1.100 mm", label: "Rahmentiefe" },
      { value: "bis 5,5 t", label: "Fachlast je Ebene" },
    ],
    systems: {
      title: "Wie wird eingelagert?",
      intro: "Ein Palettenregal plant man von der Palette aus: Gewicht, Maße und Einlagerungsrichtung bestimmen Holme, Rahmen und Zubehör.",
      comparisons: ["laengs-quer", "grund-anbau"],
      extraComparisons: [
        {
          key: "laengs-quer",
          title: "Längs- oder Quereinlagerung",
          question: "Was ist der Unterschied zwischen Längs- und Quereinlagerung?",
          intro: "MULTIPAL eignet sich für beide Richtungen. Entscheidend ist, ob die Palette von Holm zu Holm reicht.",
          sides: [
            {
              name: "Längseinlagerung",
              plus: ["Europalette 1.200 mm tief auf 1.100 mm tiefem Rahmen, 50 mm Überstand je Seite", "bei 2.700 mm Holmlänge 3 Europaletten je Ebene", "liegt direkt auf den Holmen"],
              minus: [],
              fit: "Der Standard für Europaletten.",
            },
            {
              name: "Quereinlagerung",
              plus: ["auch für Paletten, die nicht von Holm zu Holm reichen"],
              minus: ["Tiefenauflagen erforderlich (Tragkraft je Paar 1.100 oder 1.500 kg)"],
              fit: "Passt, wenn Paletten quer eingelagert werden müssen.",
            },
          ],
          src: "Katalog S. 121, 128, 131, 143",
        },
      ],
    },
    tiles: [
      { label: "Grundregale", text: "Das erste Feld: 2 Ständerrahmen mit Bodenankern und Holmen", href: "/multipal-grundregale" },
      { label: "Anbauregale", text: "Jedes weitere Feld: 1 Ständerrahmen mit Bodenankern und Holmen", href: "/multipal-anbauregale" },
      { label: "Böden und Auflagen", text: "Drahtböden, Gitterroste, Spanplatten und Tiefenauflagen", href: "/multipal-boeden-und-auflagen" },
      { label: "Zubehör", text: "Sicherungsstifte, Durchschubsicherung, Distanzstücke und mehr", href: "/multipal-zubehoer" },
    ],
    guide: {
      title: "So bauen Sie Ihr META MULTIPAL Palettenregal",
      intro: "In sechs Schritten von der Palette zur fertigen Regalzeile. Die Werte gelten für META MULTIPAL laut Bestellkatalog; Lastangaben ersetzen keine statische Auslegung im Einzelfall.",
      steps: [
        {
          key: "last",
          title: "Last bestimmen",
          text: "Ausgangspunkt ist das Gewicht je Palette. Eine Ebene trägt bis zu 5,5 t ([[fachlast]]), ein Feld bis zu 25 t ([[feldlast]]); maßgebend ist jeweils der kleinere Wert. Im Shop steht im Artikelnamen die Last je [[palettenplatz|Palettenplatz]].",
          src: "Katalog S. 123, 132; Shop-Artikel",
        },
        {
          key: "masse",
          title: "Maße wählen",
          text: "Fachhöhe und Zahl der Ebenen richten sich nach der Ladungshöhe – Ladungsmaße können die Nennmaße überschreiten. Die Holme hängen im 50-mm-Raster. Der Stapler braucht als Hubhöhe die Oberkante des obersten Holms plus 200 mm; die stirnseitigen Rahmen sollten mindestens 500 mm höher sein als die oberste Ablage.",
          src: "Katalog S. 121, 128",
        },
        {
          key: "zeile",
          title: "Regalzeile zusammensetzen",
          text: "Das erste Feld ist ein [[grundregal]] mit 2 Ständerrahmen, jedes weitere ein [[anbauregal]] mit 1 Ständerrahmen. Länge mit Ständer 85/20: Grundregal Holmlänge + 170 mm, Anbauregal + 85 mm. Die Lastwerte gelten ab 4 Feldern mit mindestens 2 Holmpaaren je Feld; bei weniger Feldern werden sie abgemindert.",
          src: "Katalog S. 125, 128",
        },
        {
          key: "bedienseite",
          title: "Bedienseite festlegen",
          text: "Einseitige Regale stehen an der Wand, Doppelregale Rücken an Rücken mit Distanzstücken. Seiten, an denen nicht be- und entladen wird, müssen gegen Herabfallen von Lagergut gesichert sein; an Verkehrswegen und Arbeitsbereichen mit Rückwandgittern.",
          src: "Katalog S. 135, 136, 138",
        },
        {
          key: "kippen",
          title: "Verankern und schützen",
          text: "Palettenregale stehen auf Beton der Mindestgüte C20/25, etwa 200 mm stark, und werden mit 2 Ankern je Fußplatte gesichert; die [[bodenanker|Bodenanker]] liegen den Ständerrahmen bei. Äußere Ständer an Ecken und Durchfahrten schützen Sie mit [[rammschutz|Rammschutzecken]] gegen Anprall.",
          src: "Katalog S. 134, 135, 211",
        },
        {
          key: "aufbau",
          title: "Aufbauen",
          text: `Prüfen Sie den Lieferumfang anhand des Lieferscheins. Die Ständerrahmen kommen zerlegt, die Ausfachung wird verschraubt, die Holme mit der [[agraffe]] eingehängt; je Holm gehören zwei [[sicherungsstift|Sicherungsstifte]] hinein. ${BUILD_END}`,
          src: "Katalog S. 121, 134, 138; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          kind: "pallet",
          fields: 4,
          nominal: 2700,
          height: 2700,
          depth: 1100,
          loadLevels: 2,
          perLevel: 3,
          perLoad: 990,
          totalLoad: 5940,
          itemWeight: 900,
          space: 11500,
          length: { base: 170, addOn: 85, label: "Gesamtlänge" },
          perField: 9,
          anchorsPerFrame: 4,
          drawLevels: 3,
          bracing: "none",
        },
        texts: {
          last: "Palette {itemWeight} kg, Regal {perLoad} kg je Palettenplatz – {itemVerdict}. Je Feld {loadLevels} Holmebenen × {perLevel} Paletten × {perLoad} kg = {sumLoad} kg, Feldlast {totalLoad} kg – {loadVerdict}.",
          zeile: ROW_TEXT("Hallenwand", "Holme") + " Das sind {units} Europalettenplätze inklusive Bodenebene.",
          kippen: "{frames} Ständerrahmen mit je {anchorsPerFrame} Bodenankern = {anchors} Anker, dazu Rammschutzecken für die äußeren Ständer.",
        },
        anchorYes: "",
        anchorNo: "",
        title: "Beispiel: {space} mm Hallenwand",
        sub: "{fields} Felder à {nominal} mm, Rahmen {height} × {depth} mm, 3 Lagerebenen inklusive Boden, Paletten bis {itemWeight} kg",
        lines: [
          { qty: 1, number: "4026212292435", label: "MULTIPAL Grundregal 2700 × 2700 × 1100 mm, 990 kg je Palette" },
          { qty: 3, number: "4026212323771", label: "MULTIPAL Anbauregal 2700 × 2700 × 1100 mm, 990 kg je Palette" },
          { qty: 2, number: "4026212056846", label: "Rammschutzecke" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=palette&hoehe=2700&breite=2700&tiefe=1100&palettengewicht=900&laenge=11500",
      },
      parts: ["Ständerrahmen", "Holm", "Europalette"],
      avoid: [
        "Mit weniger als 4 Feldern die vollen Lastwerte ansetzen – sie werden dann abgemindert.",
        "Holme ohne Sicherungsstifte einhängen.",
        "Ohne Verankerung oder auf ungeeignetem Boden aufstellen – Voraussetzung ist Beton C20/25.",
        "Durchschubsicherung oder hintere Aufkantung als Palettenstopp benutzen.",
        "Paletten auf Stahlpaneel-Böden stellen – die sind für Kartonware gedacht.",
      ],
      avoidSrc: "Katalog S. 125, 135, 136, 138, 139, 143",
      operation: OPERATION_COMMON,
      operationSrc: OPERATION_SRC,
      instructions: INSTRUCTIONS("palettenregale"),
      service: SERVICE,
    },
    planImages: [],
    planNote: "Planmaße: Grundregal Nennlänge + 170 mm (Ständer 85/20), + 200 mm (100/20) oder + 240 mm (120/20, 120/25); Anbauregal + 85, + 100 oder + 120 mm. Gesamttiefe = Rahmentiefe.",
    productsTitle: "Meistgekaufte Palettenregale",
    productNumbers: ["4026212334678", "4026212334722", "4026212248722", "4026212334708", "4026212323887", "4026212358650", "4026212348484", "4026212358629"],
    productsHref: "/multipal-grundregale",
    seo: {
      title: "META MULTIPAL: Palettenregale aus Arnsberg",
      paragraphs: [
        "META MULTIPAL ist für die Paletten- und Stückgutlagerung gebaut. Die Ständerrahmen bestehen aus kaltverformten Profilen mit verschraubter Ausfachung; die Kastenholme werden mit der 4-Haken-Agraffe eingehängt.",
        "Die Ständerprofile gibt es verzinkt oder in RAL 5010 enzianblau, die Holme in RAL 2001 rotorange. Die statische Nachweisführung erfolgt nach DIN EN 15512:2021; die DIBt-Zulassung erlaubt die Verwendung im Sinne der Landesbauordnungen.",
      ],
      links: [LEXIKON_LINK, BRANCHE.industrie, BRANCHE.handel],
    },
    faqTitle: "Häufige Fragen zu Palettenregalen",
    faq: [
      {
        q: "Kann ich das Palettenregal selbst montieren?",
        a: `Ja. Die Ständerrahmen mit verschraubter Ausfachung werden zerlegt geliefert, die Holme werden mit der 4-Haken-Agraffe eingehängt und mit zwei Sicherungsstiften je Holm gesichert. Palettenregale sind auf einem Betonboden (mindestens C20/25) mit Ankern zu fixieren – bitte beachten Sie die mitgelieferten Sicherheitshinweise. ${SERVICE_SENTENCE}`,
      },
      {
        q: "Wie viele Paletten passen in ein Feld?",
        a: "Für Europaletten (1.200 x 800 mm): bei 2.700 mm Feldlänge 9 Palettenplätze mit 3 Lagerebenen oder 12 mit 4 Lagerebenen, bei 1.825 mm Feldlänge 6 oder 8 – jeweils inklusive Bodenlagerebene.",
      },
      {
        q: "Was bedeutet die Last im Artikelnamen?",
        a: "Im Artikelnamen steht die Tragkraft je Palettenplatz. Eine Holmebene trägt bei 2.700 mm Holmlänge drei Europaletten nebeneinander; maßgebend bleibt der kleinere Wert aus Fach- und Feldlast.",
      },
      {
        q: "Kann ich Gitterboxen im MULTIPAL-Regal lagern?",
        a: "Ja, mit dem passenden Zubehör: Gitterboxpaletten lassen sich wegen ihrer Winkelfüße nur schlecht direkt auf den Holmen einlagern. Winkelauflagen führen die Füße und setzen sie sicher auf den Holmen ab.",
      },
      {
        q: "Gibt es Zubehör wie Anfahrschutz oder Bodenanker?",
        a: "Ja. Bodenanker sind bei Grund- und Anbauregalen im Lieferumfang. Äußere Ständer im Eckbereich und an Durchfahrten sind mit Rammschutzecken gegen Anprall zu schützen – dafür gibt es Rammschutzecken und U-Rammschutz.",
      },
      FAQ_INSPECTION,
    ],
    advice: ADVICE_COMMON,
    notes: {
      hero: {
        text: "Neue H1 statt „META MULTIPAL PALETTENREGAL“ in Großbuchstaben; „Stecksystem“ gestrichen (Holme eingehängt, Ausfachung verschraubt). Kennzahlen = Systemwerte laut Katalog, nicht die Artikelnamen (die führen die Last je Palettenplatz).",
        src: "Katalog S. 14, 121, 123",
      },
      systems: { text: "„Längs- oder Quereinlagerung“ ist ein eigener Vergleich dieser Seite (nicht im Lexikon); Grundlage Planmaß-Zeichnung S. 128 und Tiefenauflagen S. 143.", src: "Katalog S. 121, 128, 131, 143" },
      tiles: { text: "Spezialregale (Gefahrstoff, Kabeltrommel) und Komponenten bleiben über das Menü erreichbar; hier nur die vier Wege für ein Standard-Palettenregal.", src: "Shop-Kategorien Live (Inhalt am 21.10.2026 geprüft)" },
      guide: {
        text: GUIDE_NOTE_COMMON + " Schritt 5 heißt hier „Verankern und schützen“, weil Palettenregale immer verankert werden.",
        checks: [INSTRUCTIONS_CHECK, "Abminderung bei weniger als 4 Feldern: Prozentwerte nur aus der Grafik S. 131/133 ablesbar, deshalb im Text ohne Zahlen"],
        src: "Katalog S. 121–143, 211; Sicherheitshinweise 02.2024",
      },
      example: {
        text: "Länge 2.870 + 3 × 2.785 mm (Ständer 85/20 laut Shop-Eigenschaft „Stützentyp“, Katalog S. 128). 9 Palettenplätze je Feld (S. 131). Feldlast 5.940 kg und 2.970 kg je Ebene = Shop-Eigenschaften; die 990 kg im Namen gelten je Palettenplatz. 4 Bodenanker je Rahmen (S. 134).",
        checks: ["2 Rammschutzecken je Zeile richtig, oder je nach Aufstellung 4?"],
        src: "Katalog S. 128, 131, 134, 135; Live-Artikel",
      },
      plan: { text: "Bisher keine Maßzeichnung; Systemwerte und Planmaße als Text.", src: "Katalog S. 123, 128, 211" },
      products: { text: "Im Shop: Produktslider mit den Topsellern aus MULTIPAL Grund- und Anbauregalen (ohne Gefahrstoff- und Kabeltrommelregale).", src: "Live-Listen /multipal-grundregale, /multipal-anbauregale" },
      seo: { text: "Ersetzt die drei Agentur-Blöcke „Robuste Lagerlösung …“ mit „Stecksystem“.", src: "Katalog S. 121, 123" },
      faq: { text: "Montage, Gitterboxen und Anfahrschutz aus den Korrekturen vom 15.10.; neu: Paletten je Feld und Last im Artikelnamen.", src: "Katalog S. 16, 121, 130–135, 210; Shop-Artikel" },
      advice: ADVICE_NOTE,
    },
  },

  // ───────────────────────────── Kragarmregale ─────────────────────────────
  {
    key: "kragarm",
    landingPageId: "0194e5cc241378798eac2ccd90978e33",
    agencyCmsPageId: "0194f90d1f80728cb401e73f6a95c8be",
    url: "/kragarmregale/",
    name: "Kragarmregale",
    catalogSystems: ["multistrong", "atlas"],
    eyebrow: "META Kragarmregale",
    h1: "Kragarmregale für Rohre, Profile und Platten",
    lead:
      "Kragarmregale lagern langes Material liegend: Rohre, Profile und Leisten sowie Tafel- und Plattenware. META MULTISTRONG gibt es als LIGHT und MEDIUM mit Kragarmen im 100-mm-Raster, META ATLAS ST als einfache, geschweißte Lösung für leichte Belastungen.",
    proof: ["Kragarme im 100-mm-Raster", "Aushebesicherung", "Einseitig oder doppelseitig", "Kostenloser Versand"],
    ctaPrimary: { label: "Regal konfigurieren", href: "/regal-schnellkonfigurator?regalart=kragarm" },
    ctaSecondary: { label: "So bauen Sie Ihr Regal", href: "#aufbau" },
    heroImage: { src: "https://shop.meta-online.com/media/9b/eb/63/1737642871/11_META_MULTISTRONG_MEDIUM-1024x1024.webp", alt: "META MULTISTRONG Kragarmregal mit Rohren" },
    facts: [
      { value: "2.000–3.000 mm", label: "Höhe" },
      { value: "1.030 / 1.330 mm", label: "Achsmaß MULTISTRONG" },
      { value: "400–800 mm", label: "Armlänge" },
      { value: "bis 535 kg", label: "Armlast (MEDIUM)" },
    ],
    systems: {
      title: "Welches Kragarmregal passt?",
      intro: "META hat zwei Kragarmsysteme: MULTISTRONG ist verstellbar und in zwei Laststufen erhältlich, ATLAS ST hat feste, geschweißte Ständer.",
      comparisons: ["multistrong-atlas", "light-medium"],
    },
    tiles: [
      { label: "MULTISTRONG Grundregale", text: "Das erste Feld: 2 Kragarmständer mit Armen und Ausfachung", href: "/multistrong-grundregale" },
      { label: "MULTISTRONG Anbauregale", text: "Jedes weitere Feld: 1 Kragarmständer mit Armen", href: "/multistrong-anbauregale" },
      { label: "ATLAS ST Komplettregale", text: "Geschweißte Komplettregale mit 2 bis 5 Feldern", href: "/atlas-st-komplettregale" },
      { label: "Zubehör", text: "Abrolldorne, Zusatz-Fachböden und Aufsteckhalter", href: "/kragarmregal-zubehoer" },
    ],
    guide: {
      title: "So bauen Sie Ihr META Kragarmregal",
      intro: "In sechs Schritten vom Langgut zur fertigen Regalzeile. Die Werte gelten für META MULTISTRONG laut Bestellkatalog.",
      steps: [
        {
          key: "last",
          title: "Last bestimmen",
          text: "Maßgebend ist die [[armlast]]: Sie sinkt mit der Armlänge – bei LIGHT 220, 175 und 140 kg für 400, 500 und 600 mm, bei MEDIUM 535, 430, 355 und 250 kg für 400 bis 800 mm. Alle Arme eines Ständers zusammen dürfen die [[staenderlast]] nicht überschreiten: einseitig bis 1.750 kg (LIGHT) bzw. 2.880 kg (MEDIUM). Die Fußebene trägt so viel wie ein Kragarm.",
          src: "Katalog S. 158, 159, 163",
        },
        {
          key: "masse",
          title: "Maße wählen",
          text: "Höhe 2.000, 2.500 oder 3.000 mm, [[achsmass|Achsmaß]] 1.030 oder 1.330 mm. Die Armlänge ist die nutzbare Tiefe je Seite; die Kragarme lassen sich im 100-mm-Raster versetzen.",
          src: "Katalog S. 156, 158–160",
        },
        {
          key: "zeile",
          title: "Regalzeile zusammensetzen",
          text: "Das erste Feld ist ein [[grundregal]] mit 2 Ständern, jedes weitere ein [[anbauregal]] mit 1 Ständer; ausgefacht wird jedes Feld. Länge eines LIGHT-Grundregals: Achsmaß + 64 mm, MEDIUM: Achsmaß + 73 mm. Jedes Anbauregal verlängert die Zeile um ein Achsmaß.",
          src: "Katalog S. 158, 162, 164",
        },
        {
          key: "bedienseite",
          title: "Bedienseite festlegen",
          text: "Einseitige Regale stehen an der Wand, doppelseitige sind von beiden Seiten bestückbar. Die Ständerprofile sind beidseitig gelocht: Für den Umbau von einseitig auf doppelseitig wird nur das Fußteil getauscht.",
          src: "Katalog S. 158",
        },
        {
          key: "kippen",
          title: "Gegen Kippen und Herausrollen sichern",
          text: "Ist das Regal mehr als 4-mal so hoch wie tief oder erfordern es die betrieblichen Bedingungen, wird es mit Fußverdübelungssets verankert. Die [[stellschraube]] gibt den Kragarmen eine Vorneigung, sodass Rundmaterial zum Ständer rollt; bei Rundmaterial sind [[abrolldorn|Abrolldorne]] Vorschrift.",
          src: "Katalog S. 160–162, 210",
        },
        {
          key: "aufbau",
          title: "Aufbauen",
          text: `Prüfen Sie den Lieferumfang anhand des Lieferscheins. Die Kragarme werden in die Ständer gesteckt und mit der Stellschraube festgezogen; die Aushebesicherung verhindert, dass sie beim Ein- und Auslagern herausgehoben werden. ${BUILD_END}`,
          src: "Katalog S. 160; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          kind: "cantilever",
          fields: 3,
          nominal: 1030,
          height: 2000,
          depth: 500,
          loadLevels: 5,
          perLevel: 1,
          perLoad: 175,
          totalLoad: 1750,
          space: 3200,
          length: { base: 64, addOn: 0, label: "Gesamtlänge" },
          drawLevels: 5,
          bracing: "diagonal",
        },
        texts: {
          last: "Je Ständer {loadLevels} Ebenen (Kragarme und Fuß) × {perLoad} kg = {sumLoad} kg, Ständerlast einseitig {totalLoad} kg – {loadVerdict}.",
          zeile: ROW_TEXT("Wand", "Achsmaß"),
          kippen: "{height} mm hoch, Armlänge {depth} mm: {anchorVerdict}",
        },
        anchorYes: "mehr als 4 : 1, also Fußverdübelungssets.",
        anchorNo: "höchstens 4 : 1 – Fußverankerung nur, wenn die betrieblichen Bedingungen es erfordern.",
        title: "Beispiel: {space} mm Wand für Rohre",
        sub: "MULTISTRONG LIGHT, {fields} Felder, Achsmaß {nominal} mm, {height} mm hoch, Armlänge {depth} mm, einseitig",
        lines: [
          { qty: 1, number: "4026212118698", label: "MULTISTRONG L Grundregal 2000 × 1000 × 500 mm, einseitig" },
          { qty: 2, number: "4026212118704", label: "MULTISTRONG L Anbauregal 2000 × 1000 × 500 mm, einseitig" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=kragarm&hoehe=2000&breite=1000&tiefe=500&laenge=3200",
      },
      parts: ["Kragarmständer", "Kragarm", "Langgut", "Ausfachung"],
      avoid: [
        "Die Armlast des kurzen Arms auch für längere Arme ansetzen – sie sinkt mit der Armlänge.",
        "Rundmaterial ohne Abrolldorne lagern.",
        "Mit Fachböden mehr Last erwarten – sie erhöhen die Tragkraft der Kragarme nicht.",
        "Das Regal beladen, bevor es fertig montiert ist.",
        "Auf Kragarme oder Ständer steigen.",
      ],
      avoidSrc: "Katalog S. 163, 168, 210; Sicherheitshinweise 02.2024 S. 2–3",
      operation: OPERATION_COMMON,
      operationSrc: OPERATION_SRC,
      instructions: INSTRUCTIONS("kragarmregale"),
      service: SERVICE,
    },
    planImages: [],
    planNote: "Länge Grundregal: LIGHT Achsmaß + 64 mm, MEDIUM Achsmaß + 73 mm. Tiefe einseitig: Nenntiefe + 210 mm (LIGHT) bzw. + 230 mm (MEDIUM). ATLAS ST: Achsmaß 1.350 mm.",
    productsTitle: "Meistgekaufte Kragarmregale",
    productNumbers: ["4026212119718", "4026212120233", "4026212118698", "4026212119213", "4026212120240", "4026212120004", "4026212275407", "4026212275384"],
    productsHref: "/multistrong-grundregale",
    seo: {
      title: "Langgut lagern mit META MULTISTRONG und ATLAS ST",
      paragraphs: [
        "META MULTISTRONG ist für die liegende Langgutlagerung sowie Tafel- und Plattenware gebaut, als LIGHT mit Ständern IPE 120 und als MEDIUM mit IPE 140. Die Kragarme sind gesteckt und mit einer Feststellschraube gesichert.",
        "META ATLAS ST hat geschweißte Kragarmständer aus warm- und kaltgewalzten Stahlprofilen, ist 2.000 mm hoch, ein- oder doppelseitig und in RAL 5010 enzianblau.",
      ],
      links: [LEXIKON_LINK, BRANCHE.handwerk, BRANCHE.industrie],
    },
    faqTitle: "Häufige Fragen zu Kragarmregalen",
    faq: [
      {
        q: "Kann ich ein Kragarmregal selbst aufbauen?",
        a: `Ja. Bei MULTISTRONG werden die Kragarme in die Ständer gesteckt und mit der Stellschraube festgezogen; die Ausfachung verbindet die Ständer in jedem Feld. Beladen Sie das Regal erst nach vollständiger Montage. ${SERVICE_SENTENCE}`,
      },
      {
        q: "Wie viel trägt ein Kragarm?",
        a: "Das hängt von der Armlänge ab: MULTISTRONG LIGHT trägt 220, 175 oder 140 kg bei 400, 500 oder 600 mm, MEDIUM 535, 430, 355 oder 250 kg bei 400, 500, 600 oder 800 mm. ATLAS ST trägt 200 kg je Arm.",
      },
      { q: "Kann ich ein einseitiges Regal später doppelseitig machen?", a: "Ja, bei MULTISTRONG: Die Ständerprofile sind beidseitig gelocht, für den Umbau wird nur das Fußteil getauscht." },
      { q: "Brauche ich Abrolldorne?", a: "Bei Rundmaterial ja: Abrolldorne werden in die Kragarme gesteckt und verhindern, dass Rohre unbeabsichtigt herausrollen." },
      FAQ_INSPECTION,
    ],
    advice: ADVICE_COMMON,
    notes: {
      hero: {
        text: "Bisher nur Kopf und Kacheln (Agentur-Abschnitte für „Headless“ ausgeblendet). Kennzahlen = Systemwerte laut Katalog; die Last ist jetzt die Armlast (bisher „3.500 kg Ständerlast“, das ist der doppelseitige LIGHT-Wert). „Gefertigt in Arnsberg“ fehlt bewusst (Katalog nennt Kragarmregale dort nicht).",
        src: "Katalog S. 11, 156, 158–160",
      },
      systems: { text: "Beide Vergleiche aus dem Regal-Lexikon.", src: "Katalog S. 156, 158–163" },
      tiles: { text: "Die drei Kategorien und das Zubehör, wie bisher im Menü.", src: "Shop-Kategorien Live (Inhalt am 21.10.2026 geprüft)" },
      guide: {
        text: GUIDE_NOTE_COMMON,
        checks: [INSTRUCTIONS_CHECK, "„Jedes Anbauregal verlängert um ein Achsmaß“ ist abgeleitet (Katalog nennt nur die Grundregal-Länge) – so rechnet auch der Schnellkonfigurator"],
        src: "Katalog S. 156–168, 210; Sicherheitshinweise 02.2024",
      },
      example: {
        text: "Shop-Feldbreite 1.000 mm = Achsmaß 1.030 mm. Länge 1.094 + 2 × 1.030 mm. Ständerlast 1.750 kg laut Katalog (LIGHT einseitig), Armlast 175 kg bei 500 mm laut Artikel. Kippsicherung laut Shop „vorgeschrieben: nein“ – passt zu 2.000 : 500 = 4 : 1.",
        src: "Katalog S. 158, 162, 163; Live-Artikel",
      },
      plan: { text: "Bisher keine Maßzeichnung; Systemwerte (MULTISTRONG und ATLAS ST) und Planmaße als Text.", src: "Katalog S. 156, 158, 162, 164" },
      products: { text: "Im Shop: Produktslider mit den Topsellern aus MULTISTRONG und ATLAS ST.", src: "Live-Listen /multistrong-grundregale, /multistrong-anbauregale, /atlas-st-komplettregale" },
      seo: { text: "Bisher kein SEO-Text.", src: "Katalog S. 156, 158, 162" },
      faq: { text: "Bisher keine FAQ. Neue Gruppe im FAQ-Plugin.", src: "Katalog S. 16, 156–163, 210" },
      advice: ADVICE_NOTE,
    },
  },

  // ───────────────────────────── Weitspannregale ─────────────────────────────
  {
    key: "weitspann",
    landingPageId: "0194e5ccf088794b81760e98653464be",
    agencyCmsPageId: "0194f90dd7b3716a8524f49e9db3bccb",
    url: "/weitspannregale/",
    name: "Weitspannregale",
    catalogSystems: ["minirack", "speedrack"],
    eyebrow: "META Weitspannregale",
    h1: "Weitspannregale für großes und schweres Einzelgut",
    lead:
      "META MINI-RACK trägt bis 600 kg je Ebene auf bis zu 2.600 mm Länge und baut lange Regalzeilen aus Grund- und Anbauregalen. META SPEED-RACK steht als gestecktes Komplettregal schnell im Lager. Böden aus Spanplatte oder Stahlpaneel, Profile verzinkt.",
    proof: ["Gefertigt in Arnsberg", "Bis 600 kg je Ebene", "Spanplatte oder Stahlpaneel", "Kostenloser Versand"],
    ctaPrimary: { label: "Regal konfigurieren", href: "/regal-schnellkonfigurator?regalart=weitspann" },
    ctaSecondary: { label: "So bauen Sie Ihr Regal", href: "#aufbau" },
    heroImage: { src: "https://shop.meta-online.com/media/1d/6c/d3/1739473776/07_META_SPEED-RACK_Weitspannregale-1024x1024.webp", alt: "META SPEED-RACK Weitspannregal mit Kisten und Eimern" },
    facts: [
      { value: "1.970–3.000 mm", label: "Höhe" },
      { value: "1.400–2.600 mm", label: "Fachlänge" },
      { value: "400–1.050 mm", label: "Tiefe" },
      { value: "bis 600 kg", label: "Fachlast (MINI-RACK)" },
    ],
    systems: {
      title: "Welches Weitspannregal passt?",
      intro: "META hat zwei Weitspannsysteme: SPEED-RACK als gestecktes Komplettregal und MINI-RACK mit verschraubten Rahmen für lange Regalzeilen.",
      comparisons: ["speedrack-minirack", "fachboden-weitspann"],
    },
    tiles: [
      { label: "MINI-RACK Grundregale", text: "Das erste Feld: 2 Rahmen und 3 Einlegeböden", href: "/mini-rack-grundregale" },
      { label: "MINI-RACK Anbauregale", text: "Jedes weitere Feld: 1 Rahmen und 3 Einlegeböden", href: "/mini-rack-anbauregale" },
      { label: "SPEED-RACK Komplettregale", text: "Gesteckte Einzelregale, Nennmaße = Istmaße", href: "/speed-rack-komplettregale" },
      { label: "Zubehör", text: "Unterzüge, Trennbügel, Profilverbinder und Anker", href: "/weitspannregal-zubehoer" },
    ],
    guide: {
      title: "So bauen Sie Ihr META Weitspannregal",
      intro: "In sechs Schritten vom Lagergut zur fertigen Regalzeile. Die Werte gelten für META MINI-RACK und SPEED-RACK laut Bestellkatalog.",
      steps: [
        {
          key: "last",
          title: "Last bestimmen",
          text: "Eine Ebene trägt beim MINI-RACK bis 600 kg, bei 2.600 mm Länge 490 kg, beim SPEED-RACK bis 500 kg, bei 2.500 mm Länge 400 kg – jeweils [[gleichmaessig-verteilt|gleichmäßig verteilt]]. Alle Ebenen eines Feldes zusammen dürfen die [[feldlast]] nicht überschreiten: MINI-RACK bis 4.600 kg, SPEED-RACK bis 3.000 kg.",
          src: "Katalog S. 106, 111, 114",
        },
        {
          key: "masse",
          title: "Maße wählen",
          text: "MINI-RACK: Höhen 2.200, 2.500 und 3.000 mm, Tiefen 650, 800 und 1.050 mm, Fachlängen 1.400 bis 2.600 mm. SPEED-RACK: Höhen 1.970 bis 2.970 mm, Tiefen 400 bis 800 mm, Fachlängen 1.700 bis 2.500 mm. Die Ebenen lassen sich im 50-mm-Raster versetzen.",
          src: "Katalog S. 106, 111, 114",
        },
        {
          key: "zeile",
          title: "Regalzeile zusammensetzen",
          text: "MINI-RACK baut lange Zeilen aus einem [[grundregal]] (2 Rahmen) und [[anbauregal|Anbauregalen]] (1 Rahmen). [[planmass|Planmaß]]: Grundregal Nennlänge + 107 mm, Anbauregal + 51 mm; die Lastwerte gelten ab 4 Feldern. SPEED-RACK gibt es nur als [[komplettregal]], mehrere Regale verbinden Profilverbinder.",
          src: "Katalog S. 106, 109, 114",
        },
        {
          key: "bedienseite",
          title: "Bedienseite festlegen",
          text: "Eingelagert wird liegend oder stehend. Für Doppelzeilen baut man beim MINI-RACK 100 mm lange Distanzstücke ein. [[trennbuegel|Trennbügel]] teilen die Ebenen; die Stufenholme sind dafür alle 200 mm gelocht.",
          src: "Katalog S. 111, 114, 118",
        },
        {
          key: "kippen",
          title: "Gegen Kippen sichern",
          text: "Ist das Regal mehr als 4-mal so hoch wie tief, sichern Sie es gegen Kippen: MINI-RACK mit 2 Bodenankern je Rahmen, SPEED-RACK mit dem Verdübelungsset (4 Stück je Regal).",
          src: "Katalog S. 106, 109, 114",
        },
        {
          key: "aufbau",
          title: "Aufbauen",
          text: `Prüfen Sie den Lieferumfang anhand des Lieferscheins. SPEED-RACK wird gesteckt. Beim MINI-RACK werden die Rahmen aus Stützen, Diagonalen, Horizontalen und Fußplatten verschraubt; die [[stufenholm|Stufenholme]] werden mit Sicherungsstiften gesichert und die [[unterzug|Unterzüge]] eingeschoben – sie haben eine statische Funktion. ${BUILD_END}`,
          src: "Katalog S. 106, 111, 118; Sicherheitshinweise 02.2024 S. 2",
        },
      ],
      example: {
        row: {
          kind: "shelf",
          fields: 4,
          nominal: 1800,
          height: 2200,
          depth: 650,
          loadLevels: 3,
          perLevel: 1,
          perLoad: 600,
          totalLoad: 3200,
          space: 7500,
          length: { base: 107, addOn: 51, label: "Planmaß" },
          drawLevels: 3,
          bracing: "none",
          board: "wood",
        },
        texts: {
          last: "{loadLevels} Ebenen × {perLoad} kg = {sumLoad} kg, Feldlast des Regals {totalLoad} kg – {loadVerdict}.",
          zeile: ROW_TEXT("Wand", "Fachlänge"),
          kippen: "{height} mm hoch, {depth} mm tief: {anchorVerdict}",
        },
        anchorYes: "mehr als 4 : 1, also 2 Bodenanker je Rahmen.",
        anchorNo: "höchstens 4 : 1, keine Kippsicherung vorgeschrieben.",
        title: "Beispiel: {space} mm Wand",
        sub: "MINI-RACK, {fields} Felder à {nominal} mm, {height} mm hoch, {depth} mm tief, {loadLevels} Spanplattenböden à {perLoad} kg",
        lines: [
          { qty: 1, number: "4026212057690", label: "MINI-RACK Grundregal 2200 × 1800 × 650 mm, 600 kg, Spanplatte" },
          { qty: 3, number: "4026212057713", label: "MINI-RACK Anbauregal 2200 × 1800 × 650 mm, 600 kg, Spanplatte" },
        ],
        configuratorHref: "/regal-schnellkonfigurator?regalart=weitspann&hoehe=2200&breite=1800&tiefe=650&last=600&laenge=7500",
      },
      parts: ["Rahmen", "Stufenholm mit Spanplatte"],
      avoid: [
        "Bei weniger als 4 Feldern die vollen Lastwerte ansetzen – sie gelten ab 4 Feldern.",
        "Unterzüge weglassen – sie haben eine statische Funktion.",
        "Das Regal beladen, bevor es fertig montiert und gesichert ist.",
        "Lagergut einseitig stapeln statt gleichmäßig verteilen.",
        "Auf Böden oder Rahmen steigen.",
      ],
      avoidSrc: "Katalog S. 114, 118; Sicherheitshinweise 02.2024 S. 2–3",
      operation: OPERATION_COMMON,
      operationSrc: OPERATION_SRC,
      instructions: INSTRUCTIONS("weitspannregale"),
      service: SERVICE,
    },
    planImages: [],
    planNote: "Planmaße MINI-RACK: Grundregal Nennlänge + 107 mm, Anbauregal Nennlänge + 51 mm. SPEED-RACK: Nennmaße = Istmaße.",
    productsTitle: "Meistgekaufte Weitspannregale",
    productNumbers: ["4026212057898", "4026212057577", "4026212057911", "4026212057720", "4026212205282", "4026212204926", "4026212205176", "4026212144086"],
    productsHref: "/mini-rack-grundregale",
    seo: {
      title: "MINI-RACK und SPEED-RACK aus Arnsberg",
      paragraphs: [
        "META MINI-RACK ist ein Weitspannregal für großes und schweres Einzelgut, das liegend oder stehend eingelagert wird. Die Böden sind aus Spanplatte natur oder Stahlpaneel, die Oberfläche ist sendzimirverzinkt.",
        "META SPEED-RACK ist ein konstruktiv einfaches Weitspannregal mit Winkelprofilen: Die Böden liegen versenkt im Stufenholm, zwei Unterzüge tragen jede Fachebene. Die Länge 1.700 mm eignet sich besonders für Stapelkästen.",
      ],
      links: [LEXIKON_LINK, BRANCHE.handel, BRANCHE.handwerk],
    },
    faqTitle: "Häufige Fragen zu Weitspannregalen",
    faq: [
      {
        q: "Kann ich ein Weitspannregal selbst aufbauen?",
        a: `Ja. SPEED-RACK wird gesteckt. Beim MINI-RACK kommen die Rahmen zerlegt und werden verschraubt; die Stufenholme werden mit Sicherungsstiften gesichert. Beladen Sie das Regal erst nach vollständiger Montage. ${SERVICE_SENTENCE}`,
      },
      {
        q: "Wie viel trägt eine Ebene?",
        a: "Beim MINI-RACK 600 kg bei 1.400 bis 2.200 mm Länge und 490 kg bei 2.600 mm, beim SPEED-RACK 500 kg, bei 2.500 mm Länge 400 kg – jeweils bei gleichmäßig verteilter Last.",
      },
      {
        q: "SPEED-RACK oder MINI-RACK?",
        a: "SPEED-RACK ist ein gestecktes Komplettregal, Nennmaße = Istmaße – gut für einzelne Regale, die schnell stehen sollen. MINI-RACK hat verschraubte Rahmen, trägt mehr, ist bis 1.050 mm tief und baut lange Zeilen aus Grund- und Anbauregalen.",
      },
      FAQ_INSPECTION,
    ],
    advice: ADVICE_COMMON,
    notes: {
      hero: {
        text: "Bisher nur Kopf und Kennzahlen. Kennzahlen umfassen jetzt beide Systeme (vorher nur SPEED-RACK). Bild = bisheriges SPEED-RACK-Bild.",
        src: "Katalog S. 11, 104, 106, 111",
      },
      systems: { text: "Beide Vergleiche aus dem Regal-Lexikon.", src: "Katalog S. 19, 21, 103, 106, 111, 114" },
      tiles: { text: "Spezialregale (Profillager) und Komponenten bleiben über das Menü erreichbar.", src: "Shop-Kategorien Live (Inhalt am 21.10.2026 geprüft)" },
      guide: { text: GUIDE_NOTE_COMMON, checks: [INSTRUCTIONS_CHECK], src: "Katalog S. 106–118; Sicherheitshinweise 02.2024" },
      example: {
        text: "Planmaß 1.907 + 3 × 1.851 mm (Katalog S. 114, S. 112 nennt 1.907 mm als Außenlänge). 4 Felder, weil die Lastwerte erst ab 4 Feldern gelten. Feldlast 3.200 kg = Shop-Eigenschaft; Kippsicherung laut Shop „vorgeschrieben: nein“.",
        src: "Katalog S. 112, 114; Live-Artikel",
      },
      plan: { text: "Bisher keine Maßzeichnung; Systemwerte (MINI-RACK und SPEED-RACK) und Planmaße als Text.", src: "Katalog S. 104, 106, 111, 114" },
      products: { text: "Im Shop: Produktslider mit den Topsellern aus MINI-RACK und SPEED-RACK.", src: "Live-Listen /mini-rack-grundregale, /mini-rack-anbauregale, /speed-rack-komplettregale" },
      seo: { text: "Bisher kein SEO-Text.", src: "Katalog S. 106, 111, 114" },
      faq: { text: "Bisher keine FAQ. Neue Gruppe im FAQ-Plugin.", src: "Katalog S. 16, 106, 111, 114" },
      advice: ADVICE_NOTE,
    },
  },
];

const fmt = (n: number) => n.toLocaleString("de-DE");

/** Zahlen des Rechenbeispiels aus Artikelwerten und Katalog-Zuschlägen */
export function rowFigures(r: RowSpec) {
  const addOns = r.fields - 1;
  const len = (m: { base: number; addOn: number }) => ({
    base: r.nominal + m.base,
    addOn: r.nominal + m.addOn,
    total: r.nominal + m.base + addOns * (r.nominal + m.addOn),
  });
  const main = len(r.length);
  const sumLoad = r.loadLevels * r.perLevel * r.perLoad;
  const frames = r.fields + 1;
  return {
    addOns,
    frames,
    baseLen: main.base,
    addOnLen: main.addOn,
    length: main.total,
    secondary: r.secondary ? len(r.secondary) : undefined,
    fits: main.total <= r.space,
    sumLoad,
    loadOk: sumLoad <= r.totalLoad,
    itemOk: r.itemWeight === undefined || r.itemWeight <= r.perLoad,
    units: (r.perField ?? 0) * r.fields,
    anchors: (r.anchorsPerFrame ?? 0) * frames,
    anchor: r.height / r.depth > 4,
  };
}

/** Werte für die {platzhalter} eines Beispiels */
export function exampleValues(ex: BuildExample): Record<string, string> {
  const r = ex.row;
  const f = rowFigures(r);
  return {
    fields: String(r.fields),
    nominal: fmt(r.nominal),
    height: fmt(r.height),
    depth: fmt(r.depth),
    loadLevels: String(r.loadLevels),
    perLevel: String(r.perLevel),
    perLoad: fmt(r.perLoad),
    totalLoad: fmt(r.totalLoad),
    itemWeight: r.itemWeight === undefined ? "" : fmt(r.itemWeight),
    space: fmt(r.space),
    addOns: String(f.addOns),
    frames: String(f.frames),
    baseLen: fmt(f.baseLen),
    addOnLen: fmt(f.addOnLen),
    length: fmt(f.length),
    lengthLabel: r.length.label,
    sumLoad: fmt(f.sumLoad),
    units: fmt(f.units),
    perField: String(r.perField ?? ""),
    anchors: String(f.anchors),
    anchorsPerFrame: String(r.anchorsPerFrame ?? ""),
    loadVerdict: f.loadOk ? "passt" : "zu viel",
    itemVerdict: f.itemOk ? "passt" : "zu schwer",
    fitVerdict: f.fits ? "passt" : "passt nicht",
    anchorVerdict: f.anchor ? ex.anchorYes : ex.anchorNo,
  };
}

/** Vorlage mit {platzhaltern} füllen; unbekannte Platzhalter werfen. */
export function fillExample(template: string, ex: BuildExample): string {
  const v = exampleValues(ex);
  return template.replace(/\{([a-zA-Z]+)\}/g, (_, k: string) => {
    if (!(k in v)) throw new Error(`Platzhalter {${k}} unbekannt`);
    return v[k];
  });
}

/** Texte des Rechenbeispiels je Schritt */
export function exampleTexts(ex: BuildExample): Partial<Record<BuildStepKey, string>> {
  return Object.fromEntries(Object.entries(ex.texts).map(([k, t]) => [k, fillExample(t as string, ex)]));
}

/** Maßtabellen (Systemwerte) der Seite aus catalogFacts.ts */
export function catalogSpans(page: CategoryLandingPage): Array<{ label: string; page: number; rows: Array<[string, string]> }> {
  return page.catalogSystems.map((key) => {
    const sys = CATALOG_SYSTEMS.find((s) => s.key === key);
    if (!sys?.spans) throw new Error(`${page.key}: Katalogsystem ${key} ohne Maßtabelle`);
    return { label: sys.label, ...sys.spans };
  });
}

/** Artikelnummern, die der Entwurf aus dem Shop-Stand braucht */
export function landingProductNumbers(page: CategoryLandingPage): string[] {
  return [...new Set([...page.productNumbers, ...page.guide.example.lines.map((l) => l.number)])];
}
