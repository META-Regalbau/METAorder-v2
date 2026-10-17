// Regal-Lexikon im Shop (/regal-lexikon): Fachbegriffe, Vergleiche mit Vor- und Nachteilen und ein Wegweiser
// „Welches Regal für welches Lagergut?“. Quelle ist das META Glossar im Bestellkatalog (S. 210), die Planmaße und
// Sicherheitshinweise (S. 211) und die geprüften Katalogaussagen in catalogFacts.ts. Jeder Eintrag nennt seine
// Katalogseite (`src`); tests/unit/glossary.test.ts prüft Quellen, Querverweise und Wettbewerbernamen.
//
// Textformat: einfacher Text, Verweise auf andere Begriffe als [[schluessel]] oder [[schluessel|Linktext]].
// Bewusst nicht enthalten (Klärung bei META offen): CLIP SPLIT, Lebensmittel-Eignung von Beschichtung und PP,
// „Schwerlastregal“, Garantie für Shop-Artikel.

export type GlossaryTopic = "last" | "bauteile" | "aufbau" | "oberflaeche" | "masse" | "systeme";

export const GLOSSARY_TOPICS: Array<{ key: GlossaryTopic; label: string }> = [
  { key: "last", label: "Tragkraft" },
  { key: "bauteile", label: "Bauteile" },
  { key: "aufbau", label: "Aufbau & Sicherheit" },
  { key: "oberflaeche", label: "Oberflächen" },
  { key: "masse", label: "Maße" },
  { key: "systeme", label: "Regalarten & Systeme" },
];

export type GlossaryLink = { label: string; href: string };

export type GlossaryTerm = {
  /** Anker auf der Seite (/regal-lexikon#key) */
  key: string;
  term: string;
  /** Weitere Schreibweisen: Suche auf der Seite, Erklär-Hinweise im Shop (Stufe 2) */
  aliases?: string[];
  topic: GlossaryTopic;
  /** Erklär-Hinweis „i“ auf Produkt- und Kategorieseiten (glossaryHints.ts, scripts/writeGlossaryHints.ts) */
  hint?: boolean;
  text: string;
  /** Beispiel mit META-Werten */
  example?: string;
  link?: GlossaryLink;
  /** Katalogseite(n) oder andere geprüfte Quelle */
  src: string;
};

export type GlossaryComparisonSide = { name: string; plus: string[]; minus: string[]; fit: string; link?: GlossaryLink };

export type GlossaryComparison = {
  key: string;
  title: string;
  /** Frage für die strukturierten Daten (FAQPage) */
  question: string;
  intro: string;
  sides: [GlossaryComparisonSide, GlossaryComparisonSide];
  src: string;
};

export type GlossaryGuideCard = { key: string; title: string; system: string; text: string; links: GlossaryLink[] };

export const GLOSSARY_PAGE = {
  url: "/regal-lexikon",
  name: "Regal-Lexikon",
  menuName: "Regal-Lexikon",
  h1: "Regal-Lexikon: Fachbegriffe einfach erklärt",
  lead: "Was ist der Unterschied zwischen Fachlast und Feldlast? Wann muss ein Regal an die Wand? Welche Rahmen passen zu Ihrem Lager? Hier erklären wir die Begriffe, die Ihnen beim Regalkauf begegnen – mit den Werten der META-Regale.",
  metaTitle: "Regal-Lexikon: Fachbegriffe rund ums Regal einfach erklärt | META",
  metaDescription:
    "Fachlast, Feldlast, Agraffe, geclinchter Rahmen: Das META Regal-Lexikon erklärt über 70 Fachbegriffe und vergleicht Bauweisen mit Vor- und Nachteilen.",
};

export const GLOSSARY_GUIDE: GlossaryGuideCard[] = [
  {
    key: "kleinteile",
    title: "Kleinteile, Kartons und Kästen",
    system: "Fachbodenregal META CLIP",
    text: "Fachböden mit 80 bis 330 kg Fachlast, ohne Werkzeug gesteckt, im 25-mm-Raster verstellbar. Für Ersatzteile, Werkzeug und Verbrauchsmaterial, das von Hand eingelagert wird.",
    links: [
      { label: "Fachbodenregale", href: "/fachbodenregale/" },
      { label: "Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=fachboden" },
    ],
  },
  {
    key: "ordner",
    title: "Ordner und Akten",
    system: "Büroregal META COMPACT",
    text: "Büro-Steckregal für Büro, Meisterbüro und Archiv. Bei 300 mm Tiefe passen in ein 2.500 mm hohes Regal mit 1.000 mm Länge 84 Ordner.",
    links: [
      { label: "Büroregale", href: "/bueroregale" },
      { label: "Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=buero" },
    ],
  },
  {
    key: "sperrig",
    title: "Großes, sperriges Einzelgut",
    system: "Weitspannregal META MINI-RACK oder SPEED-RACK",
    text: "Lange Fachebenen bis 2.600 mm und bis zu 600 kg je Ebene, für Teile, die nicht in ein Fachbodenregal passen. Ebenfalls von Hand bedient.",
    links: [
      { label: "Weitspannregale", href: "/weitspannregale/" },
      { label: "Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=weitspann" },
    ],
  },
  {
    key: "paletten",
    title: "Paletten und Gitterboxen",
    system: "Palettenregal META MULTIPAL",
    text: "Holme im 50-mm-Raster eingehängt, Ständerrahmen bis 12.000 mm hoch, auf Betonboden verankert. Für Gitterboxen gibt es Winkelauflagen.",
    links: [
      { label: "Palettenregale", href: "/palettenregale/" },
      { label: "Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=palette" },
    ],
  },
  {
    key: "langgut",
    title: "Rohre, Profile und Platten",
    system: "Kragarmregal META MULTISTRONG oder ATLAS ST",
    text: "Langgut liegt auf Kragarmen, die bei MULTISTRONG im 100-mm-Raster verstellbar sind. Abrolldorne verhindern, dass Rundmaterial herausrollt.",
    links: [
      { label: "Kragarmregale", href: "/kragarmregale/" },
      { label: "Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=kragarm" },
    ],
  },
  {
    key: "reifen",
    title: "Reifen und Kompletträder",
    system: "META CLIP Reifenregal",
    text: "Vier Reifen je Ebene nebeneinander, 150 kg je Ebene. Ein 2.000 mm hohes Regal nimmt 12 Reifen auf. Reifenregale werden immer mit Fußverankerung gesichert.",
    links: [{ label: "Regale für Kfz und Reifen", href: "/branchen/kfz-werkstatt-reifenhandel" }],
  },
];

export const GLOSSARY_COMPARISONS: GlossaryComparison[] = [
  {
    key: "fachboden-weitspann",
    title: "Fachbodenregal oder Weitspannregal",
    question: "Was ist der Unterschied zwischen Fachbodenregal und Weitspannregal?",
    intro: "Beide werden von Hand bedient. Entscheidend sind Größe und Gewicht der einzelnen Teile.",
    sides: [
      {
        name: "Fachbodenregal (META CLIP)",
        plus: ["ohne Werkzeug gesteckt", "Fachböden im 25-mm-Raster verstellbar", "mit Fachteilern in kleine Fächer unterteilbar", "viele Höhen von 1.500 bis 3.000 mm"],
        minus: ["Fachlast bis 330 kg je Boden", "Fachbodenlängen bis 1.700 mm"],
        fit: "Passt für viele kleine und mittlere Teile.",
        link: { label: "Fachbodenregale", href: "/fachbodenregale/" },
      },
      {
        name: "Weitspannregal (MINI-RACK, SPEED-RACK)",
        plus: ["Fachebenen bis 2.600 mm lang", "bis 600 kg je Ebene (MINI-RACK)", "Tiefen bis 1.050 mm"],
        minus: ["Ebenen nur im 50-mm-Raster verstellbar", "MINI-RACK-Rahmen werden verschraubt"],
        fit: "Passt für große, sperrige oder schwere Einzelteile.",
        link: { label: "Weitspannregale", href: "/weitspannregale/" },
      },
    ],
    src: "Katalog S. 19, 21, 103, 106, 114",
  },
  {
    key: "s3-geclincht",
    title: "S3-Rahmen oder geclinchter Rahmen",
    question: "Was ist der Unterschied zwischen CLIP S3-Rahmen und geclinchtem CLIP-Rahmen?",
    intro: "META CLIP gibt es mit zwei Rahmenarten. Im Shop erkennen Sie sie am Namen: „META CLIP S3“ hat zerlegte Rahmen, „META CLIP“ vorgefertigte, geclinchte Rahmen.",
    sides: [
      {
        name: "S3-Rahmen, zerlegt",
        plus: ["im Shop günstiger als die geclinchte Ausführung", "ohne Werkzeug in drei Klicks zusammengesteckt, falsches Stecken ausgeschlossen", "einzige Rahmenart für Regale mit Längsriegeln"],
        minus: ["Rahmen müssen selbst zusammengesteckt werden", "geringere Feldlast: einzeilig mit Diagonalverstrebung bis 1.650 kg", "Tiefensteifen immer verzinkt, auch bei lichtgrauen Stützen"],
        fit: "Passt, wenn der Preis zählt und die Feldlast reicht.",
      },
      {
        name: "Geclinchter Rahmen, vorgefertigt",
        plus: ["bis über 70 % mehr Traglast: einzeilig mit Diagonalverstrebung bis 2.400 kg", "kommt fertig montiert, der Rahmenaufbau entfällt", "komplett verzinkt oder komplett lichtgrau"],
        minus: ["teurer als die S3-Ausführung", "nicht mit Längsriegeln erhältlich"],
        fit: "Passt, wenn schwer gelagert wird oder die Montagezeit knapp ist.",
      },
    ],
    src: "Katalog S. 23, 25, 28, 29; Shop-Preise Live 17.10.2026 (S3 in allen 304 vergleichbaren Paaren günstiger)",
  },
  {
    key: "diagonal-laengsriegel",
    title: "Diagonalverstrebung oder Längsriegel",
    question: "Was ist der Unterschied zwischen Diagonalverstrebung und Längsriegeln?",
    intro: "Beides steift das Regal aus, damit es nicht in Längsrichtung kippt. Der Unterschied liegt im Zugang.",
    sides: [
      {
        name: "Diagonalverstrebung",
        plus: ["Standard bei META CLIP", "sehr effiziente Aussteifung, weil die Diagonalen Zugkräfte aufnehmen", "Ausrichtung mit Spannschlössern"],
        minus: ["Regal nur von einer Seite bedienbar"],
        fit: "Passt für Regale an der Wand.",
      },
      {
        name: "Längsriegel",
        plus: ["Regal von beiden Seiten bedienbar", "bei Doppelregalen kann Lagergut durchgelagert werden, auch Langgut"],
        minus: ["nur mit zerlegten S3-Rahmen erhältlich"],
        fit: "Passt für Regale frei im Raum, die von zwei Gängen aus erreichbar sein sollen.",
      },
    ],
    src: "Katalog S. 23, 210",
  },
  {
    key: "grund-anbau",
    title: "Grundregal oder Anbauregal",
    question: "Was ist der Unterschied zwischen Grundregal und Anbauregal?",
    intro: "Eine Regalzeile besteht immer aus einem Grundregal und beliebig vielen Anbauregalen.",
    sides: [
      {
        name: "Grundregal",
        plus: ["steht für sich allein", "zwei Rahmen, Böden bzw. Holme und Montagezubehör"],
        minus: [],
        fit: "Der Anfang jeder Regalzeile.",
      },
      {
        name: "Anbauregal",
        plus: ["nur ein Rahmen, nutzt den Rahmen des Nachbarregals mit", "verlängert die Zeile Feld für Feld"],
        minus: ["steht nicht allein, nur an einem Grund- oder Anbauregal"],
        fit: "Für jedes weitere Feld derselben Zeile.",
      },
    ],
    src: "Katalog S. 100, 130",
  },
  {
    key: "speedrack-minirack",
    title: "SPEED-RACK oder MINI-RACK",
    question: "Was ist der Unterschied zwischen META SPEED-RACK und META MINI-RACK?",
    intro: "Beides sind Weitspannregale aus verzinktem Stahl mit Böden aus Spanplatte oder Stahlpaneel.",
    sides: [
      {
        name: "META SPEED-RACK",
        plus: ["einfacher Aufbau durch Steckmontage", "Nennmaße = Istmaße", "Länge 1.700 mm besonders für Stapelkästen geeignet"],
        minus: ["nur als Komplettregal, keine Anbauregale", "bis 500 kg je Ebene, bei 2.500 mm Länge 400 kg", "Tiefen 400 bis 800 mm"],
        fit: "Passt für einzelne Regale, die schnell stehen sollen.",
        link: { label: "SPEED-RACK Komplettregale", href: "/speed-rack-komplettregale" },
      },
      {
        name: "META MINI-RACK",
        plus: ["bis 600 kg je Ebene, bei 2.600 mm Länge 490 kg", "Tiefen bis 1.050 mm", "Grund- und Anbauregale für lange Zeilen"],
        minus: ["Rahmen werden verschraubt, Montage mit Werkzeug", "2 Bodenanker je Rahmen nötig", "Lastangaben gelten ab 4 Feldern"],
        fit: "Passt für lange Regalzeilen mit schwerem, tiefem Lagergut.",
        link: { label: "MINI-RACK Grundregale", href: "/mini-rack-grundregale" },
      },
    ],
    src: "Katalog S. 106, 111, 114",
  },
  {
    key: "multistrong-atlas",
    title: "MULTISTRONG oder ATLAS ST",
    question: "Was ist der Unterschied zwischen META MULTISTRONG und META ATLAS ST?",
    intro: "Beides sind Kragarmregale für die liegende Lagerung von Langgut.",
    sides: [
      {
        name: "META MULTISTRONG",
        plus: ["Kragarme im 100-mm-Raster jederzeit versetzbar", "LIGHT bis 220 kg, MEDIUM bis 535 kg je Arm", "später von einseitig auf doppelseitig umbaubar", "Höhen 2.000 bis 3.000 mm"],
        minus: [],
        fit: "Passt, wenn sich das Lagergut ändert oder schwerer ist.",
        link: { label: "MULTISTRONG Grundregale", href: "/multistrong-grundregale" },
      },
      {
        name: "META ATLAS ST",
        plus: ["geschweißte Kragarmständer", "200 kg je Arm"],
        minus: ["nur 2.000 mm hoch", "feste Armlänge 500 mm je Seite", "nur für leichte Belastungen"],
        fit: "Passt für leichtes Langgut und eine einfache, feste Lösung.",
        link: { label: "ATLAS ST Komplettregale", href: "/atlas-st-komplettregale" },
      },
    ],
    src: "Katalog S. 156, 158–163",
  },
  {
    key: "light-medium",
    title: "MULTISTRONG LIGHT oder MEDIUM",
    question: "Was ist der Unterschied zwischen MULTISTRONG LIGHT und MEDIUM?",
    intro: "Im Shop heißen die beiden Baureihen MULTISTRONG L und M. Höhen und Achsmaße sind gleich, Tragkraft und Ständerprofil unterscheiden sich: LIGHT hat Ständer IPE 120, MEDIUM IPE 140.",
    sides: [
      {
        name: "LIGHT (MULTISTRONG L)",
        plus: ["im Shop günstiger als MEDIUM", "Armlast 220 kg bei 400 mm Armlänge"],
        minus: ["Kragarmtiefen nur bis 600 mm", "Ständerlast einseitig bis 1.750 kg"],
        fit: "Passt für leichte Rohre, Leisten und Profile.",
      },
      {
        name: "MEDIUM (MULTISTRONG M)",
        plus: ["Armlast 535 kg bei 400 mm Armlänge", "Kragarmtiefen bis 800 mm", "Ständerlast einseitig bis 2.880 kg"],
        minus: ["im Shop teurer als LIGHT"],
        fit: "Passt für mittelschwere Profile, Tafeln und Platten.",
      },
    ],
    src: "Katalog S. 158, 159, 162, 163; Shop-Preise Live 17.10.2026",
  },
  {
    key: "verzinkt-lichtgrau",
    title: "Verzinkt oder lichtgrau beschichtet",
    question: "Soll ich ein verzinktes oder ein lichtgraues Regal nehmen?",
    intro: "Die Oberfläche ändert nichts an der Tragkraft. Beide Ausführungen sind nur für Innenräume gedacht.",
    sides: [
      {
        name: "Sendzimirverzinkt",
        plus: ["Grundausführung der META-Regale", "im Shop günstiger als die lichtgraue Ausführung"],
        minus: [],
        fit: "Passt für Lager, Werkstatt und Keller.",
      },
      {
        name: "RAL 7035 lichtgrau",
        plus: ["zusätzliche Pulverbeschichtung, abriebfest", "einheitliches Bild in Büro und Verkaufsraum"],
        minus: ["teurer als die verzinkte Ausführung", "bei zerlegten S3-Rahmen bleiben die Tiefensteifen verzinkt"],
        fit: "Passt für sichtbare Bereiche.",
      },
    ],
    src: "Katalog S. 17, 25, 210; Shop-Preise Live 17.10.2026 (verzinkt in allen 549 vergleichbaren CLIP-Paaren günstiger)",
  },
];

/**
 * Preisaussagen in den Vergleichen („im Shop günstiger“): Der Export prüft sie gegen den Produktspiegel. Verglichen
 * werden aktive Artikel, deren Namen nach `key` gleich sind; `cheaper` muss in jedem Paar günstiger sein.
 */
export type GlossaryPriceClaim = { comparison: string; label: string; cheaper: RegExp; dearer: RegExp; key: (name: string) => string };

export const GLOSSARY_PRICE_CLAIMS: GlossaryPriceClaim[] = [
  {
    comparison: "s3-geclincht",
    label: "CLIP S3 günstiger als CLIP (geclincht)",
    cheaper: /^META CLIP S3 \| Fachbodenregal \|(?!.*Längsriegel)/,
    dearer: /^META CLIP \| Fachbodenregal \|/,
    key: (n) => n.replace(/^META CLIP S3 \|/, "META CLIP |"),
  },
  {
    comparison: "verzinkt-lichtgrau",
    label: "CLIP-Fachbodenregale verzinkt günstiger als RAL 7035",
    cheaper: /^META CLIP( S3)? \| Fachbodenregal \|.*\| verzinkt$/,
    dearer: /^META CLIP( S3)? \| Fachbodenregal \|.*\| RAL 7035$/,
    key: (n) => n.replace(/\| (verzinkt|RAL 7035)$/, "|"),
  },
  {
    comparison: "light-medium",
    label: "MULTISTRONG L günstiger als M",
    cheaper: /^META MULTISTRONG L \|/,
    dearer: /^META MULTISTRONG M \|/,
    key: (n) => n.replace(/^META MULTISTRONG [LM] \|/, "MS |").replace(/\| Armlast \d+ kg /, "| "),
  },
];

export type GlossaryPriceCheck = { claim: GlossaryPriceClaim; pairs: number; holds: number; avgSavingPct: number; violations: string[] };

/** Preisaussagen gegen Artikel (Name, Netto-Preis) prüfen; eine Aussage gilt, wenn es Paare gibt und alle passen. */
export function checkGlossaryPriceClaims(products: Array<{ name: string; priceNet: number }>): GlossaryPriceCheck[] {
  return GLOSSARY_PRICE_CLAIMS.map((claim) => {
    const dearer = new Map<string, number>();
    for (const p of products) if (claim.dearer.test(p.name)) dearer.set(claim.key(p.name), p.priceNet);
    let pairs = 0;
    let holds = 0;
    let saving = 0;
    const violations: string[] = [];
    for (const p of products) {
      if (!claim.cheaper.test(p.name)) continue;
      const other = dearer.get(claim.key(p.name));
      if (other === undefined || !(other > 0)) continue;
      pairs++;
      saving += 1 - p.priceNet / other;
      if (p.priceNet < other) holds++;
      else violations.push(`${p.name}: ${p.priceNet} € ≥ ${other} €`);
    }
    return { claim, pairs, holds, avgSavingPct: pairs ? Math.round((saving / pairs) * 1000) / 10 : 0, violations };
  });
}

export const GLOSSARY_TERMS: GlossaryTerm[] = [
  // Tragkraft
  {
    key: "fachlast",
    term: "Fachlast",
    topic: "last",
    hint: true,
    text: "So viel darf auf einem einzelnen Fachboden oder einer Fachebene liegen – gleichmäßig über die ganze Fläche verteilt. Alle Fachlasten eines Regalfeldes zusammen dürfen die [[feldlast|Feldlast]] nicht überschreiten.",
    example: "META CLIP gibt es mit 80, 150, 200, 230 und 330 kg Fachlast.",
    link: { label: "CLIP Grundregale", href: "/clip-grundregale" },
    src: "Katalog S. 21, 210",
  },
  {
    key: "feldlast",
    term: "Feldlast",
    topic: "last",
    hint: true,
    text: "Die Gesamttragkraft eines [[regalfeld|Regalfeldes]], also des Bereichs zwischen zwei Rahmen. Die Fachlasten übereinander dürfen zusammen nicht mehr ergeben. Wie hoch die Feldlast ist, hängt von der [[fachhoehe|Fachhöhe]] ab.",
    example: "CLIP-Steckregal mit Diagonalverstrebung: bis 1.650 kg mit S3-Rahmen, bis 2.400 kg mit geclinchten Rahmen. Die Angaben gelten bei CLIP für Regalzeilen ab 3 Feldern, bei MULTIPAL und MINI-RACK ab 4 Feldern.",
    src: "Katalog S. 25, 29, 114, 125, 210",
  },
  {
    key: "fachhoehe",
    term: "Fachhöhe",
    aliases: ["Knicklänge"],
    topic: "last",
    text: "Der Abstand von der Oberkante des Hallenbodens oder eines Fachs bis zur Oberkante des nächsten Fachs. Fachleute sagen auch Knicklänge. Ist ein Abstand zwischen zwei Ebenen größer als die anderen, bestimmt er die Tragfähigkeit des ganzen Regals ([[feldlast|Feldlast]]).",
    src: "Katalog S. 210",
  },
  {
    key: "gleichmaessig-verteilt",
    term: "Gleichmäßig verteilte Last",
    aliases: ["Punktlast"],
    topic: "last",
    text: "Alle Lastangaben der META-Regale gelten nur, wenn die Last ruhig aufliegt und gleichmäßig über die Fläche verteilt ist. Liegt ein schweres Teil auf kleiner Fläche, gilt die angegebene Fachlast nicht ohne Weiteres – sprechen Sie uns in diesem Fall an.",
    src: "Katalog S. 25, 211",
  },
  {
    key: "armlast",
    term: "Armlast",
    aliases: ["Kragarmbelastung", "Kragarmlast"],
    topic: "last",
    hint: true,
    text: "So viel darf auf einem einzelnen [[kragarm|Kragarm]] liegen. Je länger der Arm, desto weniger trägt er.",
    example: "MULTISTRONG LIGHT: 220 kg bei 400 mm, 175 kg bei 500 mm, 140 kg bei 600 mm Armlänge. MULTISTRONG MEDIUM: 535 kg bei 400 mm bis 250 kg bei 800 mm.",
    src: "Katalog S. 163",
  },
  {
    key: "staenderlast",
    term: "Ständerlast",
    topic: "last",
    hint: true,
    text: "Die Gesamtlast, die ein [[kragarmstaender|Kragarmständer]] mit allen seinen Armen tragen darf. Doppelseitige Ständer tragen doppelt so viel wie einseitige.",
    example: "MULTISTRONG LIGHT einseitig bis 1.750 kg, doppelseitig bis 3.500 kg; MEDIUM 2.880 bzw. 5.760 kg.",
    src: "Katalog S. 158, 159",
  },
  {
    key: "palettenplatz",
    term: "Palettenplatz",
    topic: "last",
    text: "Der Platz für eine Palette im [[palettenregal|Palettenregal]]. Wie viele Plätze ein Feld hat, hängt von der Feldlänge und der Zahl der Lagerebenen ab.",
    example: "Bei 2.700 mm Feldlänge stehen drei Europaletten nebeneinander: mit 3 Lagerebenen 9 Palettenplätze, mit 4 Lagerebenen 12 – jeweils inklusive Bodenebene. Bei 1.825 mm Feldlänge sind es 6 bzw. 8.",
    src: "Katalog S. 131",
  },

  // Bauteile
  {
    key: "rahmen",
    term: "Rahmen",
    aliases: ["Ständerrahmen", "Regalrahmen"],
    topic: "bauteile",
    text: "Das seitliche Tragteil eines Regals: zwei senkrechte [[stuetze|Stützen]], verbunden durch [[tiefensteife|Tiefensteifen]] oder ein Fachwerk aus Profilen. Zwischen zwei Rahmen liegen die Böden oder Holme.",
    src: "Katalog S. 121, 210",
  },
  {
    key: "stuetze",
    term: "Stütze",
    aliases: ["Stützenprofil"],
    topic: "bauteile",
    text: "Senkrechtes Tragelement aus kalt umgeformtem Stahl. Mit Tiefensteifen oder einem Fachwerk verbunden ergeben zwei Stützen einen [[rahmen|Rahmen]]. Die Stützen leiten die Last aller Ebenen in den Hallenboden.",
    src: "Katalog S. 210",
  },
  {
    key: "tiefensteife",
    term: "Tiefensteife",
    topic: "bauteile",
    text: "Querverbindung zwischen den beiden Stützen eines Rahmens. Beim vorgefertigten CLIP-Rahmen ist sie fest mit den Stützen verbunden ([[geclincht|geclincht]]), beim [[s3-rahmen|S3-Rahmen]] wird sie ohne Werkzeug eingesteckt.",
    src: "Katalog S. 28, 210",
  },
  {
    key: "fachboden",
    term: "Fachboden",
    topic: "bauteile",
    text: "Die Ablage im [[fachbodenregal|Fachbodenregal]]. Die CLIP-Fachböden haben eine 40 mm hohe Kante, sind im 25-mm-Raster höhenverstellbar und im 50-mm-Raster gelocht, damit sich [[fachteiler|Fachteiler]] einsetzen lassen – außer bei den 80-kg-Fachböden.",
    link: { label: "CLIP Böden und Auflagen", href: "/clip-boeden-und-auflagen" },
    src: "Katalog S. 19, 25",
  },
  {
    key: "abdeckboden",
    term: "Abdeckboden",
    topic: "bauteile",
    text: "Der oberste Boden eines Fachbodenregals. Er darf höchstens mit 200 kg belastet werden. Beim Büroregal COMPACT hat er im Gegensatz zu den übrigen Fachböden keinen End- und Mittelanschlag.",
    src: "Katalog S. 25, 100",
  },
  {
    key: "holm",
    term: "Holm",
    aliases: ["Holmpaar", "Traverse"],
    topic: "bauteile",
    text: "Waagerechter Träger im [[palettenregal|Palettenregal]], auf dem die Paletten stehen. Zwei Holme bilden ein Holmpaar und damit eine Lagerebene. Sie werden mit der [[agraffe|Agraffe]] im 50-mm-Raster in die Rahmen eingehängt und mit [[sicherungsstift|Sicherungsstiften]] gesichert.",
    link: { label: "MULTIPAL Komponenten", href: "/multipal-komponenten" },
    src: "Katalog S. 121, 125, 210",
  },
  {
    key: "stufenholm",
    term: "Stufenholm",
    topic: "bauteile",
    text: "Holm mit einer Stufe, in die die Böden des [[weitspannregal|Weitspannregals]] eingelegt werden. Die versenkten Böden sind so ringsum an den Kanten geschützt. Beim MINI-RACK sind die Stufenholme im 200-mm-Raster für [[trennbuegel|Trennbügel]] gelocht.",
    src: "Katalog S. 106, 114",
  },
  {
    key: "agraffe",
    term: "Agraffe",
    topic: "bauteile",
    text: "Hakenlasche an Holmen oder Längsriegeln (von französisch agrafe, Haken). Sie wird in die Stützen eingehängt, leitet die Last ins Profil und steift das Regal zusätzlich aus. Die MULTIPAL-Holme haben eine 4-Haken-Agraffe.",
    src: "Katalog S. 121, 210",
  },
  {
    key: "sicherungsstift",
    term: "Sicherungsstift",
    topic: "bauteile",
    text: "Verhindert, dass die [[holm|Holme]] im Palettenregal unbeabsichtigt herausgehoben werden. Sicherungsstifte müssen eingesetzt werden.",
    src: "Katalog S. 121, 210",
  },
  {
    key: "unterzug",
    term: "Unterzug",
    aliases: ["Längsunterzug", "Tiefenunterzug"],
    topic: "bauteile",
    text: "Strebe unter dem Boden. Unterzüge erhöhen die Tragkraft von Fachböden und verhindern, dass sie sich durchbiegen. Bei [[spanplatte|Spanplatten]] verhindern sie Durchbiegen und Bruch, bei [[stufenholm|Stufenholmen]], dass sich die Holme unter Last verdrehen. Je nach Boden gibt es Längs- und Tiefenunterzüge.",
    example: "Beim SPEED-RACK hat jede Fachebene zwei Unterzüge.",
    src: "Katalog S. 106, 210",
  },
  {
    key: "kragarm",
    term: "Kragarm",
    topic: "bauteile",
    text: "Der waagerechte Arm am Ständer eines [[kragarmregal|Kragarmregals]], auf dem das Langgut liegt. Bei MULTISTRONG werden die Kragarme eingesteckt, mit der [[stellschraube|Stellschraube]] gesichert und lassen sich im 100-mm-Raster versetzen.",
    src: "Katalog S. 160",
  },
  {
    key: "kragarmstaender",
    term: "Kragarmständer",
    topic: "bauteile",
    text: "Die senkrechte Säule des Kragarmregals, an der die [[kragarm|Kragarme]] sitzen. Bei MULTISTRONG ist sie ein Stahlprofil IPE 120 (LIGHT) oder IPE 140 (MEDIUM), beidseitig gelocht; bei ATLAS ST ist der Ständer geschweißt.",
    src: "Katalog S. 156, 158, 159",
  },
  {
    key: "abrolldorn",
    term: "Abrolldorn",
    topic: "bauteile",
    text: "Wird in den [[kragarm|Kragarm]] gesteckt und verhindert, dass Rundmaterial wie Rohre unbeabsichtigt herausrollt. Bei der Lagerung von Rundmaterial schreibt die DGUV Information 208-061 ihn vor.",
    link: { label: "Kragarmregal Zubehör", href: "/kragarmregal-zubehoer" },
    src: "Katalog S. 161, 210",
  },
  {
    key: "stellschraube",
    term: "Stellschraube",
    topic: "bauteile",
    text: "Aushebesicherung an den Kragarmen von MULTISTRONG. Beim Anziehen drückt sich eine Platte mit zwei Zähnen in das Ständerprofil und hebt den Arm leicht an: Rundmaterial rollt dadurch zum Ständer, und der Arm lässt sich nicht unbeabsichtigt herausnehmen.",
    src: "Katalog S. 160, 210",
  },
  {
    key: "winkelauflage",
    term: "Winkelauflage",
    topic: "bauteile",
    text: "Zubehör für Gitterboxpaletten. Diese haben Winkelfüße und lassen sich nur schlecht direkt auf die Holme stellen. Die Winkelauflagen führen die Füße und setzen sie sicher auf den Holmen ab.",
    link: { label: "MULTIPAL Böden und Auflagen", href: "/multipal-boeden-und-auflagen" },
    src: "Katalog S. 210",
  },
  {
    key: "durchschubsicherung",
    term: "Durchschubsicherung",
    topic: "bauteile",
    text: "Verhindert, dass Paletten beim Einlagern auf der Rückseite aus dem Regal geschoben werden. Sie ist kein Anschlag: Planmäßig gegen die Durchschubsicherung zu fahren, ist nicht vorgesehen.",
    link: { label: "MULTIPAL Zubehör", href: "/multipal-zubehoer" },
    src: "Katalog S. 210",
  },
  {
    key: "fachteiler",
    term: "Fachteiler",
    aliases: ["Trenngitter"],
    topic: "bauteile",
    text: "Unterteilen einen Fachboden in kleinere Fächer. Sie werden in die 50-mm-Lochung der CLIP-Fachböden gesteckt. Die 80-kg-Fachböden haben diese Lochung nicht.",
    link: { label: "CLIP Zubehör", href: "/clip-zubehoer" },
    src: "Katalog S. 19",
  },
  {
    key: "trennbuegel",
    term: "Trennbügel",
    topic: "bauteile",
    text: "Unterteilen die Ebenen des MINI-RACK Weitspannregals. Sie werden in die im 200-mm-Raster gelochten [[stufenholm|Stufenholme]] eingesetzt.",
    src: "Katalog S. 114",
  },
  {
    key: "rammschutz",
    term: "Rammschutz",
    aliases: ["Anfahrschutz", "Rammschutzecke"],
    topic: "bauteile",
    text: "Schützt die Stützen des Palettenregals vor Anprall. Äußere Ständer im Eckbereich und an Durchfahrten müssen mit Rammschutzecken geschützt werden.",
    link: { label: "MULTIPAL Zubehör", href: "/multipal-zubehoer" },
    src: "Katalog S. 135",
  },

  // Aufbau & Sicherheit
  {
    key: "grundregal",
    term: "Grundregal",
    topic: "aufbau",
    hint: true,
    text: "Ein Regal, das für sich allein steht: mit zwei Rahmen und je nach System Böden oder Holme. Jede [[regalzeile|Regalzeile]] beginnt mit einem Grundregal; daneben kommen [[anbauregal|Anbauregale]].",
    src: "Katalog S. 100, 130",
  },
  {
    key: "anbauregal",
    term: "Anbauregal",
    topic: "aufbau",
    hint: true,
    text: "Erweiterung für ein vorhandenes Regal. Es hat nur einen Rahmen und nutzt den Rahmen des Nachbarregals mit. So wird die Regalzeile Feld für Feld verlängert.",
    link: { label: "CLIP Anbauregale", href: "/clip-anbauregale" },
    src: "Katalog S. 100, 130",
  },
  {
    key: "komplettregal",
    term: "Komplettregal",
    topic: "aufbau",
    hint: true,
    text: "Ein Regal mit allen Teilen, das als ein Artikel bestellt wird. Das Weitspannregal SPEED-RACK gibt es nur so, als Grundregal ohne Anbauregale.",
    src: "Katalog S. 106",
  },
  {
    key: "regalfeld",
    term: "Regalfeld",
    aliases: ["Feld"],
    topic: "aufbau",
    text: "Der Bereich zwischen zwei Rahmen. Für ein Feld gilt die [[feldlast|Feldlast]].",
    src: "Katalog S. 210",
  },
  {
    key: "regalzeile",
    term: "Regalzeile",
    topic: "aufbau",
    text: "Mehrere [[regalfeld|Regalfelder]] nebeneinander: ein Grundregal und beliebig viele Anbauregale. Die Lastangaben gelten erst ab einer Mindestzahl von Feldern je Zeile – bei CLIP ab 3, bei MULTIPAL und MINI-RACK ab 4 Feldern. Bei weniger Feldern trägt das Regal weniger.",
    src: "Katalog S. 25, 114, 125",
  },
  {
    key: "steckregal",
    term: "Steckregal",
    topic: "aufbau",
    text: "Regal, dessen Teile ohne Schrauben zusammengesteckt werden. Bei META sind das unter anderem CLIP und COMPACT, die sich ohne Werkzeug aufbauen lassen, und das Weitspannregal SPEED-RACK.",
    src: "Katalog S. 19, 99, 106",
  },
  {
    key: "schraubregal",
    term: "Schraubregal",
    topic: "aufbau",
    text: "Regal, dessen Teile verschraubt werden, zum Beispiel das Fachbodenregal META FIX für feste Installationen. Im Gegensatz zum [[steckregal|Steckregal]] braucht die Montage Werkzeug.",
    src: "Katalog S. 94",
  },
  {
    key: "clip-easy",
    term: "CLIP-EASY",
    topic: "aufbau",
    text: "Steckverfahren der CLIP-Regale: Die Verbindungsstelle zwischen Rahmen und Tiefensteife ist deutlich sichtbar vorgegeben, ein falsches Zusammenstecken ist nicht möglich. Für die Montage braucht es kein Werkzeug.",
    src: "Katalog S. 28",
  },
  {
    key: "aussteifung",
    term: "Aussteifung",
    topic: "aufbau",
    text: "Macht ein Regal in Längsrichtung stabil. Fachbodenregale werden meist über [[diagonalverstrebung|Diagonalen]] ausgesteift, manche über [[laengsriegel|Längsriegel]]. Bei Palettenregalen übernimmt die Rahmenwirkung der Holme diese Aufgabe.",
    src: "Katalog S. 210",
  },
  {
    key: "diagonalverstrebung",
    term: "Diagonalverstrebung",
    aliases: ["Diagonalaussteifung", "Spannkreuz"],
    topic: "aufbau",
    hint: true,
    text: "Gekreuzte Diagonalstäbe an der Rückseite des Regals. Weil sie Zugkräfte aufnehmen, ist das eine sehr effiziente Aussteifung. Regale mit Diagonalverstrebung sind einseitig bedienbar und ideal für die Aufstellung an Wänden; ausgerichtet wird mit [[spannschloss|Spannschlössern]].",
    src: "Katalog S. 23, 210",
  },
  {
    key: "laengsriegel",
    term: "Längsriegel",
    aliases: ["Längsriegelaussteifung"],
    topic: "aufbau",
    hint: true,
    text: "Winkelprofile mit je einer [[agraffe|Agraffe]] rechts und links, die Steckregale in festen Abständen aussteifen. Der Boden wird in die Winkel eingelegt. Regale mit Längsriegeln sind von beiden Seiten bedienbar; es gibt sie mit zerlegten S3-Rahmen.",
    src: "Katalog S. 23, 210",
  },
  {
    key: "spannschloss",
    term: "Spannschloss",
    topic: "aufbau",
    text: "Sitzt an den Diagonalverstrebungen der CLIP-Regale. Damit wird das Regal beim Aufbau ausgerichtet.",
    src: "Katalog S. 23",
  },
  {
    key: "kippsicherung",
    term: "Höhen-/Tiefenverhältnis 4 : 1",
    aliases: ["Kippsicherung", "4:1"],
    topic: "aufbau",
    hint: true,
    text: "Ist ein Regal mehr als viermal so hoch wie tief, muss es gegen Kippen gesichert werden – mit einer [[fussverankerung|Wandbefestigung oder Fußverankerung]]. Reifenregale und Regale mit Schubladen werden immer mit Fußverankerung gesichert, einseitige COMPACT-Büroregale immer.",
    example: "2.500 mm hoch und 500 mm tief ergibt 5 : 1 – das Regal muss gesichert werden. 2.000 mm hoch und 600 mm tief ergibt gut 3 : 1.",
    src: "Katalog S. 25, 100, 211",
  },
  {
    key: "fussverankerung",
    term: "Wandbefestigung und Fußverankerung",
    aliases: ["Fußverankerung", "Wandbefestigung", "Fußverdübelung"],
    topic: "aufbau",
    text: "Sichern ein Regal gegen Kippen: Die Wandbefestigung verbindet es mit der Wand, die Fußverankerung verdübelt die Füße im Boden. Welche Lösung passt, hängt vom Aufstellort ab; Pflicht ist eine davon ab einem Verhältnis von Höhe zu Tiefe über [[kippsicherung|4 : 1]].",
    src: "Katalog S. 25, 100, 211",
  },
  {
    key: "bodenanker",
    term: "Bodenanker",
    topic: "aufbau",
    text: "Befestigen Paletten- und Weitspannregale im Betonboden. Palettenregale sind mit 2 Ankern je Fußplatte zu sichern; bei MULTIPAL-Grund- und Anbauregalen sind die Anker im Lieferumfang. Das MINI-RACK braucht 2 Bodenanker je Rahmen.",
    src: "Katalog S. 114, 130, 211",
  },
  {
    key: "hallenboden",
    term: "Hallenboden",
    aliases: ["Betonboden", "Betongüte", "C20/25"],
    topic: "aufbau",
    text: "Unter jedem Regal muss der Boden ausreichend tragfähig sein. Palettenregale werden auf Beton der Mindestgüte C20/25 mit etwa 200 mm Stärke aufgestellt und mit [[bodenanker|Ankern]] fixiert.",
    src: "Katalog S. 135, 211",
  },
  {
    key: "handbedienung",
    term: "Handbedienung",
    topic: "aufbau",
    text: "Fachboden-, Weitspann- und Kragarmregale von META sind nur für die Handbedienung ausgelegt: Sie werden von Hand be- und entladen.",
    src: "Katalog S. 25, 106, 114, 156, 162",
  },
  {
    key: "regalinspektion",
    term: "Regalinspektion",
    aliases: ["Prüfpflicht", "Regalprüfung"],
    topic: "aufbau",
    text: "Regale sind Arbeitsmittel und unterliegen nach § 14 Betriebssicherheitsverordnung der Prüfpflicht. Mindestens alle 12 Monate muss eine fachkundige Person sie prüfen. Verantwortlich ist der Betreiber. META bietet die Regalinspektion als Service an, mit Prüfprotokoll und Prüfplakette.",
    src: "Katalog S. 16",
  },
  {
    key: "innenaufstellung",
    term: "Innenaufstellung",
    topic: "aufbau",
    text: "Die META-Regale sind für eine reine Innenaufstellung konzipiert – auch die verzinkten. Wind, Schnee und Erdbeben sind in den Lastangaben nicht berücksichtigt.",
    src: "Katalog S. 17",
  },
  {
    key: "gs-zeichen",
    term: "GS-Zeichen",
    topic: "aufbau",
    text: "Zeichen für „geprüfte Sicherheit“. Bei META überwacht das Materialprüfungsamt MPA NRW in regelmäßigen Audits die Herstellung. Zubehör wie Schranktüren und Schubladen ist durch das GS-Zeichen nicht abgedeckt.",
    src: "Katalog S. 14",
  },
  {
    key: "ral-guetesicherung",
    term: "RAL-Gütesicherung",
    aliases: ["RAL-RG 614"],
    topic: "aufbau",
    text: "Gütezeichen des RAL Deutschen Instituts für Gütesicherung und Kennzeichnung mit regelmäßigen, unabhängigen Kontrollen. Für Regale gibt es eigene Richtlinien: RAL-RG 614/1 für Fachbodenregale, 614/2 für Palettenregale, 614/5 für die Kragarmregale MULTISTRONG LIGHT und MEDIUM.",
    src: "Katalog S. 14",
  },

  // Oberflächen
  {
    key: "sendzimirverzinkt",
    term: "Sendzimirverzinkt",
    aliases: ["verzinkt", "Sendzimirverzinkung"],
    topic: "oberflaeche",
    hint: true,
    text: "Grundausführung der META-Regale. Das Stahlband wird vor der Verarbeitung im Durchlaufofen gereinigt und durch ein flüssiges Zinkbad geführt; die Zinkschicht wird danach genau eingestellt.",
    src: "Katalog S. 17, 210",
  },
  {
    key: "pulverbeschichtung",
    term: "Pulverbeschichtung",
    aliases: ["kunststoffbeschichtet", "lackiert"],
    topic: "oberflaeche",
    text: "Zusätzliche Kunststoffbeschichtung auf Epoxy-Polyesterbasis, abriebfest und mit hoher Oberflächengüte. META bietet sie für CLIP und COMPACT in RAL 7035 lichtgrau an. Das Beschichtungsverfahren erzeugt keine chemischen Abfälle, das Wasser wird im Kreislauf aufbereitet.",
    src: "Katalog S. 17, 25, 210",
  },
  {
    key: "ral-farben",
    term: "RAL-Farben",
    aliases: ["RAL 7035", "lichtgrau", "enzianblau", "rotorange"],
    topic: "oberflaeche",
    text: "Die Farben der META-Regale werden nach RAL benannt, sind aber nur RAL-ähnlich: 7035 lichtgrau (CLIP, COMPACT), 5010 enzianblau (MULTIPAL-Ständer, Kragarmregale) und 2001 rotorange (MULTIPAL-Holme).",
    src: "Katalog S. 17, 123, 155",
  },
  {
    key: "geclincht",
    term: "Geclincht",
    aliases: ["Clinchen", "geclinchter Rahmen", "vorgefertigter Rahmen"],
    topic: "oberflaeche",
    hint: true,
    text: "Clinchen ist ein Druck-Füge-Verfahren: Stütze und Tiefensteifen werden ohne Schweißen kraftschlüssig verbunden. Die vorgefertigten CLIP-Rahmen kommen fertig montiert, sind sehr tragfähig, und nichts behindert den Einbau der Böden. Das Verfahren ist deutlich umweltfreundlicher als Schweißen.",
    link: { label: "Vergleich S3 oder geclincht", href: "#vergleich-s3-geclincht" },
    src: "Katalog S. 28, 210",
  },
  {
    key: "s3-rahmen",
    term: "S3-Rahmen",
    aliases: ["CLIP S3", "zerlegter Rahmen"],
    topic: "oberflaeche",
    hint: true,
    text: "Zerlegter CLIP-Rahmen, der ohne Werkzeug in drei Klicks zusammengesteckt wird. Im Shop heißen diese Regale „META CLIP S3“. Die Tiefensteifen sind immer verzinkt.",
    link: { label: "Vergleich S3 oder geclincht", href: "#vergleich-s3-geclincht" },
    src: "Katalog S. 25, 28",
  },
  {
    key: "spanplatte",
    term: "Spanplatte",
    topic: "oberflaeche",
    text: "Einlegeboden aus 19 mm starker Spanplatte für die Weitspannregale SPEED-RACK und MINI-RACK. [[unterzug|Unterzüge]] verhindern, dass sie sich durchbiegt oder bricht. Alternative: [[stahlpaneel|Stahlpaneel]].",
    src: "Katalog S. 106, 114, 210",
  },
  {
    key: "stahlpaneel",
    term: "Stahlpaneel",
    topic: "oberflaeche",
    text: "Einlegeboden aus Stahl für die Weitspannregale SPEED-RACK und MINI-RACK – die Alternative zur [[spanplatte|Spanplatte]]. Wie diese wird er in die [[stufenholm|Stufenholme]] versenkt.",
    src: "Katalog S. 106, 114",
  },

  // Maße
  {
    key: "nennmass",
    term: "Nennmaß",
    aliases: ["Nennlänge", "Nenntiefe"],
    topic: "masse",
    text: "Das Maß im Artikelnamen, bei Fachbodenregalen zum Beispiel die Länge und Tiefe der Fachböden. Das Regal ist außen etwas größer, weil Stützen und Rahmen dazukommen – siehe [[planmass|Planmaß]].",
    src: "Katalog S. 21, 211",
  },
  {
    key: "planmass",
    term: "Planmaß",
    aliases: ["Außenmaß", "Gesamtlänge"],
    topic: "masse",
    hint: true,
    text: "Der tatsächliche Platzbedarf eines Regals. Damit planen Sie, ob die Regalzeile an die Wand passt.",
    example: "CLIP: Grundregal Nennlänge + 56 mm, jedes Anbauregal + 6 mm, Tiefe + 36 mm. MINI-RACK: Grundregal + 107 mm, Anbauregal + 51 mm. MULTIPAL (Ständertyp 85): Grundregal Holmlänge + 170 mm, Anbauregal + 85 mm. SPEED-RACK: Nennmaße = Istmaße.",
    link: { label: "Gesamtlänge im Schnellkonfigurator berechnen", href: "/regal-schnellkonfigurator" },
    src: "Katalog S. 211",
  },
  {
    key: "achsmass",
    term: "Achsmaß",
    topic: "masse",
    hint: true,
    text: "Beim Kragarmregal der Abstand von Mitte zu Mitte zweier Kragarmständer.",
    example: "MULTISTRONG: Achsmaß 1.030 oder 1.330 mm; die Länge eines Grundregals ist das Achsmaß plus 64 mm (LIGHT) bzw. 73 mm (MEDIUM). ATLAS ST: 1.350 mm.",
    src: "Katalog S. 158, 211",
  },
  {
    key: "raster",
    term: "Raster",
    aliases: ["Lochraster", "Verstellraster"],
    topic: "masse",
    text: "Der Abstand, in dem sich Böden, Holme oder Arme in der Höhe versetzen lassen.",
    example: "CLIP-Fachböden 25 mm, Weitspann-Ebenen und MULTIPAL-Holme 50 mm, MULTISTRONG-Kragarme 100 mm.",
    src: "Katalog S. 19, 106, 121, 160",
  },
  {
    key: "kantenhoehe",
    term: "Kantenhöhe",
    topic: "masse",
    text: "Die Höhe der abgekanteten Ränder eines Fachbodens. Bei META CLIP beträgt sie 40 mm.",
    src: "Katalog S. 25",
  },
  {
    key: "einseitig-doppelseitig",
    term: "Einseitig und doppelseitig",
    aliases: ["einseitig", "doppelseitig"],
    topic: "masse",
    text: "Einseitige Regale sind von einer Seite zugänglich und stehen meist an der Wand. Doppelseitige Regale sind von beiden Seiten nutzbar und stehen frei im Raum. Ein MULTISTRONG-Kragarmregal lässt sich nachträglich von einseitig auf doppelseitig umbauen – nur das Fußteil wird getauscht.",
    src: "Katalog S. 23, 101, 158",
  },
  {
    key: "einzeilig-doppelzeilig",
    term: "Einzeilig und doppelzeilig",
    aliases: ["Doppelregal", "doppelzeilig"],
    topic: "masse",
    text: "Doppelzeilige Regale sind zwei Regalzeilen, die Rücken an Rücken fest verbunden sind; der Zugriff ist von beiden Seiten möglich.",
    example: "Tiefe eines doppelzeiligen CLIP-Regals: 2 × Nenntiefe + 75 mm.",
    src: "Katalog S. 29, 211",
  },

  // Regalarten & Systeme
  {
    key: "fachbodenregal",
    term: "Fachbodenregal",
    topic: "systeme",
    text: "Regal mit [[fachboden|Fachböden]] für Kleinteile, Kartons und Kästen, die von Hand eingelagert werden. Bei META ist das vor allem META CLIP mit Fachlasten von 80 bis 330 kg.",
    link: { label: "Alles zu Fachbodenregalen", href: "/fachbodenregale/" },
    src: "Katalog S. 19, 21",
  },
  {
    key: "bueroregal",
    term: "Büroregal",
    aliases: ["Büro-Steckregal", "Aktenregal", "Ordnerregal"],
    topic: "systeme",
    text: "Steckregal für Büro, Meisterbüro und Archiv. META COMPACT hat Fachböden mit 80 kg Fachlast (100 kg bei 1.250 × 600 mm) und dübelfähige Stahlfüße.",
    example: "Bei 300 mm Tiefe passen in ein 2.500 mm hohes Regal mit 7 Böden 63, 84 oder 105 Ordner – je nach Länge 750, 1.000 oder 1.250 mm.",
    link: { label: "Alles zu Büroregalen", href: "/bueroregale" },
    src: "Katalog S. 99, 100, 101",
  },
  {
    key: "weitspannregal",
    term: "Weitspannregal",
    topic: "systeme",
    text: "Regal mit langen Fachebenen für große, sperrige und schwere Einzelteile, die liegend oder stehend von Hand eingelagert werden. META SPEED-RACK trägt bis 500 kg je Ebene, META MINI-RACK bis 600 kg.",
    link: { label: "Alles zu Weitspannregalen", href: "/weitspannregale/" },
    src: "Katalog S. 103, 106, 111, 114",
  },
  {
    key: "palettenregal",
    term: "Palettenregal",
    topic: "systeme",
    text: "Regal für Paletten und Stückgut. META MULTIPAL erlaubt Längs- und Quereinlagerung; die Holme werden im 50-mm-Raster eingehängt, die Rahmen sind bis 12.000 mm hoch. Palettenregale stehen auf Betonboden und werden verankert.",
    link: { label: "Alles zu Palettenregalen", href: "/palettenregale/" },
    src: "Katalog S. 121, 123, 135",
  },
  {
    key: "kragarmregal",
    term: "Kragarmregal",
    aliases: ["Langgutregal"],
    topic: "systeme",
    text: "Regal für die liegende Lagerung von Langgut wie Rohren und Profilen sowie von Tafeln und Platten. Das Lagergut liegt auf [[kragarm|Kragarmen]], die von einem Ständer abstehen.",
    link: { label: "Alles zu Kragarmregalen", href: "/kragarmregale/" },
    src: "Katalog S. 155, 156, 162",
  },
  {
    key: "grossfachregal",
    term: "Großfachregal",
    topic: "systeme",
    text: "Regal mit besonders großen Fächern für großvolumiges Lagergut und die liegende Lagerung langer, sperriger Waren. Das CLIP-Großfachregal hat 1.500 oder 1.700 mm lange Fachböden; außerdem gibt es MULTIPAL-Großfachregale.",
    link: { label: "Großfachregal im Schnellkonfigurator", href: "/regal-schnellkonfigurator?regalart=grossfach" },
    src: "Katalog S. 42, 146",
  },
  {
    key: "schraegbodenregal",
    term: "Schrägbodenregal",
    topic: "systeme",
    text: "Fachbodenregal mit um etwa 12° geneigten Böden: Die Ware gleitet zur Entnahmeseite. Ideal für Kartonware wie Schraubenpäckchen oder Kunststoffkästen mit loser Ware.",
    src: "Katalog S. 58, 59",
  },
  {
    key: "kommissionierablage",
    term: "Kommissionierablage",
    topic: "systeme",
    text: "Ablage an Regalen mit schrägen Ebenen oder Röllchenleisten, auf der die entnommene Ware zusammengestellt wird.",
    src: "Katalog S. 210",
  },
  {
    key: "reifenregal",
    term: "Reifenregal",
    topic: "systeme",
    text: "META CLIP Regal für Reifen und Kompletträder. Je Ebene stehen vier Reifen nebeneinander, jede Ebene trägt 150 kg. Reifenregale werden immer mit Fußverankerung gesichert.",
    example: "2.000 mm Höhe: 3 Ebenen, 12 Reifen. 2.500 mm Höhe: 4 Ebenen, 16 Reifen. Reifendurchmesser höchstens 700 mm.",
    link: { label: "Regale für Kfz und Reifen", href: "/branchen/kfz-werkstatt-reifenhandel" },
    src: "Katalog S. 25, 50, 51",
  },
  {
    key: "kabeltrommelregal",
    term: "Kabeltrommelregal",
    topic: "systeme",
    text: "Regal mit Auflagen für Kabeltrommeln, von denen das Kabel direkt abgewickelt werden kann. Die Achse wird separat bestellt und richtet sich nach Trommelgewicht, Trommelbreite und Fachbreite.",
    link: { label: "Regale für Handwerk", href: "/branchen/handwerk-werkstatt" },
    src: "Katalog S. 148–153",
  },
  {
    key: "meta-clip",
    term: "META CLIP",
    topic: "systeme",
    text: "Fachbodenregalsystem aus Rahmen und Fachböden für die Kleinteilelagerung, zum Beispiel Ersatzteilmagazine in Industrie und Handwerk. Gesteckt ohne Werkzeug, Höhen 1.500 bis 3.000 mm, Fachlasten 80 bis 330 kg. Mit [[geclincht|geclinchten]] oder [[s3-rahmen|S3-Rahmen]].",
    link: { label: "CLIP Grundregale", href: "/clip-grundregale" },
    src: "Katalog S. 19, 21, 28",
  },
  {
    key: "meta-compact",
    term: "META COMPACT",
    aliases: ["CLIP COMPACT"],
    topic: "systeme",
    text: "Büro-Steckregal für Büro, Meisterbüro und Archiv, im Shop als „META CLIP COMPACT“. Höhen 1.850, 2.200 und 2.500 mm, Tiefen 300 und 600 mm, verzinkt oder lichtgrau.",
    link: { label: "COMPACT Grundregale", href: "/compact-grundregale" },
    src: "Katalog S. 99, 100",
  },
  {
    key: "meta-multipal",
    term: "META MULTIPAL",
    topic: "systeme",
    text: "Palettenregalsystem für Paletten und Stückgut. Gütegesichert nach RAL-RG 614/2 mit GS-Zeichen; Ständerrahmen bis 12.000 mm, Einzel-Fachlasten bis 5,5 t.",
    link: { label: "MULTIPAL Grundregale", href: "/multipal-grundregale" },
    src: "Katalog S. 121, 123",
  },
  {
    key: "meta-multistrong",
    term: "META MULTISTRONG",
    aliases: ["MULTISTRONG L", "MULTISTRONG M"],
    topic: "systeme",
    text: "Kragarmregal mit eingesteckten, im 100-mm-Raster verstellbaren Kragarmen – als LIGHT für leichte und MEDIUM für mittlere Belastungen, im Shop MULTISTRONG L und M.",
    link: { label: "Vergleich LIGHT oder MEDIUM", href: "#vergleich-light-medium" },
    src: "Katalog S. 158–162",
  },
  {
    key: "meta-atlas",
    term: "META ATLAS ST",
    topic: "systeme",
    text: "Kragarmregal mit geschweißten Ständern für leichtes Langgut: 2.000 mm hoch, 500 mm Armlänge je Seite, 200 kg je Arm, ein- oder doppelseitig.",
    link: { label: "ATLAS ST Komplettregale", href: "/atlas-st-komplettregale" },
    src: "Katalog S. 156",
  },
  {
    key: "meta-speed-rack",
    term: "META SPEED-RACK",
    topic: "systeme",
    text: "Weitspannregal aus Winkelprofilen, gesteckt und nur als Komplettregal erhältlich. Fachlängen 1.700, 2.000 und 2.500 mm, bis 500 kg je Ebene.",
    link: { label: "SPEED-RACK Komplettregale", href: "/speed-rack-komplettregale" },
    src: "Katalog S. 106",
  },
  {
    key: "meta-mini-rack",
    term: "META MINI-RACK",
    topic: "systeme",
    text: "Weitspannregal mit verschraubten Rahmen für großes und schweres Einzelgut, als Grund- und Anbauregal. Fachlängen 1.400 bis 2.600 mm, Tiefen bis 1.050 mm, bis 600 kg je Ebene.",
    link: { label: "MINI-RACK Grundregale", href: "/mini-rack-grundregale" },
    src: "Katalog S. 111, 114",
  },
];

/**
 * Katalogaussagen, die nicht in catalogFacts.ts stehen, aber im Lexikon verwendet werden. Der Test prüft, dass jede
 * Zahl des Lexikons in catalogFacts.ts oder hier vorkommt.
 */
export const GLOSSARY_EXTRA_FACTS: Array<{ text: string; page: number | string }> = [
  { text: "Planmaße: CLIP Grundregal Nennlänge + 56 mm, Anbauregal + 6 mm, Nenntiefe + 36 mm, doppelzeilig 2 × Nenntiefe + 75 mm.", page: 211 },
  { text: "Planmaße: MINI-RACK Grundregal Nennlänge + 107 mm, Anbauregal + 51 mm; MULTIPAL Grundregal Holmlänge + 170 mm, Anbauregal + 85 mm (Ständertyp 85).", page: 211 },
  { text: "Planmaße: MULTISTRONG LIGHT Länge = Achsmaß + 64 mm, MEDIUM + 73 mm; ATLAS ST Achsmaß 1.350 mm.", page: 211 },
  { text: "Palettenregale sind generell mit 2 Ankern pro Fußplatte zu sichern.", page: 211 },
  { text: "Höhen-/Tiefenverhältnis > 4 : 1 gegen Kippen sichern; Beispiel 2.500 : 500 = 5 : 1, 2.000 : 600 = gut 3 : 1.", page: 25 },
  { text: "Reifenregal: vier Reifen je Ebene, 150 kg je Ebene; 2.000 mm Höhe 3 Ebenen und 12 Reifen, 2.500 mm Höhe 4 Ebenen und 16 Reifen; Reifendurchmesser höchstens 700 mm.", page: "50 f. (Branchenseite Kfz)" },
  { text: "Schrägbodenregal: Neigung der Ebenen 12°.", page: 58 },
  { text: "CLIP Großfachregal: Fachlängen 1.500 und 1.700 mm.", page: 42 },
  { text: "Regalinspektion: Prüfung im Abstand von höchstens 12 Monaten nach § 14 BetrSichV.", page: 16 },
  { text: "RAL-RG 614/1 Fachbodenregale, 614/2 Palettenregale, 614/5 Kragarmregale LIGHT und MEDIUM; Farben RAL 7035, 5010, 2001; DGUV Information 208-061.", page: "14, 17, 210" },
  { text: "SPEED-RACK: Spanplatten 19 mm, zwei Unterzüge je Fachebene; MINI-RACK Stufenholme im 200-mm-Raster gelocht.", page: "106, 114" },
  { text: "Büroregal COMPACT: 63, 84 oder 105 Ordner bei 2.500 mm Höhe mit 7 Böden und 750, 1.000 oder 1.250 mm Länge; 1.250 × 600 mm.", page: 101 },
  { text: "CLIP: drei Klicks zum fertigen Rahmen; bis zu über 70 % mehr Traglast; Kantenhöhe 40 mm.", page: "25, 28" },
  { text: "MULTIPAL-Holme mit 4-Haken-Agraffe.", page: 121 },
];

/** [[schluessel]] und [[schluessel|Text]] im Text */
export const GLOSSARY_REF = /\[\[([a-z0-9-]+)(?:\|([^\]]+))?\]\]/g;

/** Alle Verweisziele eines Textes */
export function glossaryRefs(text: string): string[] {
  return [...text.matchAll(GLOSSARY_REF)].map((m) => m[1]);
}

/** Text ohne Verweis-Markierung (für Excel, strukturierte Daten, Suche) */
export function glossaryPlain(text: string): string {
  const byKey = new Map(GLOSSARY_TERMS.map((t) => [t.key, t.term]));
  return text.replace(GLOSSARY_REF, (_m, key: string, label?: string) => label ?? byKey.get(key) ?? key);
}

/** Begriffe alphabetisch (deutsche Sortierung) */
export function sortedGlossaryTerms(terms: GlossaryTerm[] = GLOSSARY_TERMS): GlossaryTerm[] {
  return [...terms].sort((a, b) => a.term.localeCompare(b.term, "de", { sensitivity: "base" }));
}

/** Anfangsbuchstabe für die A–Z-Leiste (Umlaute zum Grundbuchstaben) */
export function glossaryLetter(term: string): string {
  const c = term.trim().charAt(0).toUpperCase();
  return ({ Ä: "A", Ö: "O", Ü: "U" } as Record<string, string>)[c] ?? c;
}
