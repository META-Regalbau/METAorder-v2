// Inhalte der Branchen-Landingpages (Konzept 15.10.2026, Welle 1). Eine Quelle fuer Design-Entwuerfe,
// Freigabe-Excel und das Schreibskript in den Shop. Seit der Pflegeoberflaeche (Shop-Inhalte, 16.10.2026)
// sind das die Ausgangsdaten: „Aus Code übernehmen“ legt sie als Version 1 in der Datenbank an.
// Regel des Users: nur belegte META-Inhalte, nichts Erfundenes, keine Wettbewerber (siehe categoryTexts.ts).
// Jede Zahl steht im META-Bestellkatalog (Seitenangabe in `src`) oder kommt aus dem Shop-Artikel.
// Preise stehen nie im Text, sondern als Platzhalter {p:<Artikelnummer>} und werden beim Erzeugen
// aus dem Shop-Stand eingesetzt.

// Typen und Schema: shared/shopContent.ts (dieselbe Form speichert die Pflegeoberflaeche in der Datenbank).
import type { IndustryCommon, IndustryNote, IndustryPage, HomeTeaser } from "@shared/shopContent";

export type { IndustryArea, IndustryExample, IndustryIcon, IndustryNote, IndustryNoteKey, IndustryPage, IndustryTable } from "@shared/shopContent";

export const CONTACT = { phone: "02932 957-0", tel: "+4929329570", hours: "8:15 bis 16:30 Uhr", mail: "digital-service@meta-online.com" };

/** Fuer alle Seiten gleich: Betreiberpflichten und Hinweis (Katalog S. 16, 17; DGUV 208-061). */
const OPERATOR_COMMON = [
  "Lastangaben einhalten, Lasten gleichmäßig verteilen",
  "Regale mindestens alle 12 Monate durch eine fachkundige Person prüfen lassen (§ 14 BetrSichV)",
  "Nur in Innenräumen aufstellen",
];
const DUTY_HINT =
  "Hinweis: Die Pflichten ergeben sich aus Betriebssicherheitsverordnung und DGUV Information 208-061. Diese Übersicht ersetzt keine Gefährdungsbeurteilung.";

const WHY_CLIP = [
  { title: "Made in Germany", text: "CLIP-, MULTIPAL- und Weitspannregale aus eigener Produktion in Deutschland" },
  { title: "5 Jahre Garantie*", text: "META-Qualitätsgarantie zusätzlich zur gesetzlichen Gewährleistung" },
  { title: "Ohne Werkzeug", text: "CLIP-Steckmontage, Fachböden im 25-mm-Raster" },
  { title: "Erweiterbar", text: "Anbauregale und Zubehör aus demselben System" },
  { title: "Montageservice", text: "Geschulte Montageteams auf Anfrage" },
  { title: "Nur B2B", text: "Kostenloser Versand an Gewerbekunden" },
];

const DOCS_COMMON = [
  { label: "Montageanleitungen", where: "meta-online.com" },
  { label: "Regalinspektion: Ablauf und Pflichten", where: "meta-online.com" },
  { label: "Angebot anfordern", where: "im Shop" },
];

const FAQ_INSPECTION = {
  q: "Müssen Regale regelmäßig geprüft werden?",
  a: "Ja. Regale sind Arbeitsmittel und unterliegen nach § 14 Betriebssicherheitsverordnung der Prüfpflicht. Die Inspektion muss mindestens alle 12 Monate durch eine fachkundige Person erfolgen. META bietet die Regalinspektion als Service an.",
};

const NOTE_DUTIES: IndustryNote = {
  text: "Roter Abschnitt wie auf den System-Landingpages. Trennt META-Leistung und Betreiberpflicht – Einkäufer brauchen das für die interne Freigabe. DGUV Regel 108-007 bewusst nicht genannt (zurückgezogen, ersetzt durch DGUV Information 208-061).",
  src: "Katalog S. 11, 16, 17, 25",
};
const NOTE_WHY: IndustryNote = {
  text: "Vorteilsleiste = ein gemeinsamer Textblock für alle Branchenseiten. Garantie-Sternchen muss auf die Garantiebedingungen verlinken. „Made in Germany“ gilt laut Katalog für CLIP, FIX, MINI-RACK, SPEED-RACK und MULTIPAL – nicht für MULTISTRONG und COMPACT, deshalb hier mit Systemnamen.",
  src: "Katalog S. 11, 14, 19; Shop-Header",
};

/** Gemeinsame Texte aller Branchenseiten – Ausgangsdaten fuer die Pflege in METAorder (kind = common). */
export const INDUSTRY_COMMON: IndustryCommon = {
  contact: CONTACT,
  operator: OPERATOR_COMMON,
  dutyHint: DUTY_HINT,
  why: WHY_CLIP,
  docs: DOCS_COMMON,
  faq: [FAQ_INSPECTION],
  noteDuties: NOTE_DUTIES,
  noteWhy: NOTE_WHY,
};

/** Teaser „Regale für Ihre Branche“ auf der Startseite (nur DE-Kanal, nach „META Bestseller“). */
export const HOME_TEASER: HomeTeaser = {
  eyebrow: "Branchenlösungen",
  title: "Regale für Ihre Branche",
  intro: "Welches Regal passt zu Ihrem Betrieb? Wählen Sie Ihre Branche – mit Planungshilfe, Beispielrechnung und den passenden Regalen zum Bestellen.",
  more: "Zur Branchenlösung",
  advice: { title: "Ihre Branche ist nicht dabei?", text: "Wir beraten Sie persönlich und stellen die passenden Regale für Ihr Lager zusammen." },
};

export const INDUSTRY_PAGES: IndustryPage[] = [
  // ───────────────────────────── Kfz ─────────────────────────────
  {
    key: "kfz",
    name: "Kfz-Werkstatt, Autohaus & Reifenhandel",
    short: "Kfz & Reifen",
    tagline: "Reifen, Ersatzteile, Betriebsstoffe",
    teaser: { goods: "Reifen, Ersatzteile, Öle und Betriebsstoffe", fact: "Reifenregale mit bis zu 16 Reifen je Feld" },
    url: "/branchen/kfz-werkstatt-reifenhandel",
    metaTitle: "Reifenregale & Werkstattregale für Kfz-Betriebe | META",
    metaDescription:
      "Reifenregale, Regalwagen, Ersatzteil- und Umweltregale für Werkstatt, Autohaus und Reifenhandel – mit Planungshilfe und Preisen, direkt vom Hersteller.",
    eyebrow: "Branchenlösung Kfz & Reifen",
    h1: "Regale für Kfz-Werkstatt, Autohaus und Reifenhandel",
    lead:
      "Kundenräder einlagern, Ersatzteile griffbereit halten, Öle und Betriebsstoffe sicher abstellen: mit META CLIP Reifenregalen, Fachboden- und Umweltregalen aus einem Stecksystem. Hier finden Sie die passenden Regale direkt zum Bestellen.",
    proof: ["Made in Germany", "5 Jahre META-Qualitätsgarantie*", "Steckmontage ohne Werkzeug", "Kostenloser Versand"],
    ctaPrimary: "Reifenregal planen",
    ctaSecondary: "Alle Werkstatt-Regale",
    hero: { number: "4026212270242", tag: "META CLIP S3 Reifenregal", alt: "META CLIP S3 Reifenregal, Grundregal 2000 x 1300 x 400 mm, verzinkt" },
    facts: [
      { value: "150 kg", label: "Fachlast je Ebene" },
      { value: "bis 16", label: "Reifen je Regalfeld" },
      { value: "700 mm", label: "max. Reifen-Ø" },
      { value: "3 oder 4", label: "Ebenen (2.000 / 2.500 mm)" },
    ],
    areasTitle: "Was in Werkstatt und Autohaus gelagert wird",
    areasIntro: "Sechs typische Bereiche – jeweils mit dem META-Regal, das dafür gebaut ist, und dem direkten Weg zu den Artikeln.",
    areas: [
      { icon: "tire", title: "Räder- und Reifeneinlagerung", text: "Saisonale Kundenräder und eigener Reifenbestand, je Satz vier Reifen nebeneinander auf einer Ebene.", solution: "CLIP S3 Reifenregal · 150 kg je Ebene · 3 oder 4 Ebenen", linkLabel: "Reifenregale ansehen", linkTarget: "Reifenregal" },
      { icon: "move", title: "Räder mobil an die Hebebühne", text: "Den Radsatz nicht tragen, sondern fahren – vom Lager direkt zum Arbeitsplatz.", solution: "CLIP Regalwagen für Reifen · 1.850 × 1.300 × 400 mm", linkLabel: "Regalwagen ansehen", linkTarget: "Regalwagen" },
      { icon: "grid", title: "Ersatzteile und Verschleißteile", text: "Filter, Bremsbeläge, Kleinteile: Fachböden mit Fachteilern, Sichtlagerkästen oder Schrägböden für Kartonware.", solution: "CLIP Fachbodenregal · Sichtlagerkasten- und Schrägbodenregal", linkLabel: "Ersatzteilregale ansehen", linkTarget: "/clip-grundregale" },
      { icon: "drop", title: "Öle und Betriebsstoffe", text: "Gebinde mit wassergefährdenden Flüssigkeiten auf Wannenböden mit Auffangvolumen abstellen.", solution: "CLIP S3 Umweltregal · Wannenböden mit Ü-Zeichen", linkLabel: "Umweltregale ansehen", linkTarget: "Umweltregal" },
      { icon: "cabinet", title: "Werkzeug und Wertvolles", text: "Verschließbar und in die Regalzeile integriert: Schrankmodule mit Türen oder Schubladen.", solution: "CLIP Schrankmodul · Türen oder Schubladen · RAL 7035", linkLabel: "Schrankmodule ansehen", linkTarget: "Schrankmodul" },
      { icon: "pallet", title: "Paletten und Großteile", text: "Angelieferte Paletten, Karosserieteile und sperriges Gut im Hallenlager.", solution: "MULTIPAL Palettenregal · MINI-RACK Weitspannregal", linkLabel: "Palettenregale ansehen", linkTarget: "/multipal-grundregale" },
    ],
    planning: {
      title: "Welches Reifenregal passt – und wie viele brauchen Sie?",
      intro: "Die Regalbreite richtet sich nach der Reifenbreite, die Höhe nach der Zahl der Ebenen. Auf jeder Ebene stehen vier Reifen – also ein Radsatz.",
      tables: [
        {
          head: ["Regalbreite", "Reifenbreite bis", "Normfelge", "2.000 mm hoch", "2.500 mm hoch"],
          rows: [
            ["<b>1.000 mm</b>", "225 mm", "6½ J", "3 Ebenen · 12 Reifen", "4 Ebenen · 16 Reifen"],
            ["<b>1.150 mm</b>", "265 mm", "7½ J", "3 Ebenen · 12 Reifen", "4 Ebenen · 16 Reifen"],
            ["<b>1.300 mm</b>", "305 mm", "9 J", "3 Ebenen · 12 Reifen", "4 Ebenen · 16 Reifen"],
          ],
          numCols: [3, 4],
          hideMobile: [2],
          caption: "Regaltiefe 400 mm, max. Reifendurchmesser 700 mm, Fachlast 150 kg je Ebene bei gleichmäßig verteilter Last.",
        },
        {
          head: ["Preis je Regalfeld (netto)", "Grundregal", "Anbauregal"],
          rows: [
            ["1.000 mm · 2.000 / 2.500 mm hoch", "{p:4026212266610} / {p:4026212275636}", "{p:4026212266627} / {p:4026212275643}"],
            ["1.150 mm · 2.000 / 2.500 mm hoch", "{p:4026212328479} / {p:4026212328509}", "{p:4026212328486} / {p:4026212328516}"],
            ["1.300 mm · 2.000 / 2.500 mm hoch", "{p:4026212270242} / {p:4026212275650}", "{p:4026212270259} / {p:4026212275667}"],
          ],
          numCols: [1, 2],
          caption: "Eine Regalzeile beginnt mit einem Grundregal (2 Rahmen), jedes weitere Feld ist ein Anbauregal (1 Rahmen). Preise META CLIP S3, verzinkt, zzgl. MwSt.",
        },
      ],
      example: {
        title: "Beispiel: 24 Radsätze",
        sub: "Reifen bis 265 mm breit · Raumhöhe ab 2,5 m · 4 Ebenen → 4 Radsätze je Feld → 6 Felder",
        lines: [
          { qty: 1, number: "4026212328509", label: "Grundregal 2.500 × 1.150 × 400 mm" },
          { qty: 5, number: "4026212328516", label: "Anbauregal 2.500 × 1.150 × 400 mm" },
          { qty: 1, number: "4026212303186", label: "Fußverdübelungs-Set Grundregal" },
          { qty: 5, number: "4026212303193", label: "Fußverdübelungs-Set Anbauregal" },
        ],
        perLabel: { divisor: 24, unit: "Radsatz-Stellplatz", extra: "Zeilenlänge ca. 7 m" },
        warn: "<b>Pflicht:</b> Reifenregale immer mit Fußverankerung gegen Kippen sichern – das Set gehört in jede Bestellung.",
        cta: "Diese Zusammenstellung in den Warenkorb",
      },
    },
    productsTitle: "Bewährte Regale für Werkstatt und Autohaus",
    products: [
      { number: "4026212270242", use: "Reifen", title: "META CLIP S3 Reifenregal · Grundregal", spec: "2.000 × 1.300 × 400 mm · 3 Ebenen · 150 kg · verzinkt" },
      { number: "4026212270259", use: "Reifen", title: "META CLIP S3 Reifenregal · Anbauregal", spec: "2.000 × 1.300 × 400 mm · 3 Ebenen · 150 kg · verzinkt" },
      { number: "4026212443615", use: "Mobil", title: "META CLIP Regalwagen für Reifen", spec: "1.850 × 1.300 × 400 mm · 150 kg · verzinkt" },
      { number: "4026212282467", use: "Betriebsstoffe", title: "META CLIP S3 Umweltregal · Wannenböden", spec: "2.000 × 1.000 × 500 mm · 5 Ebenen · verzinkt" },
      { number: "4026212234152", use: "Kleinteile", title: "META CLIP S3 Sichtlagerkastenregal", spec: "2.000 × 1.000 × 300 mm · 60 Kästen · 10 Ebenen" },
      { number: "4026212266559", use: "Kartonware", title: "META CLIP S3 Schrägbodenregal", spec: "2.000 × 1.000 × 500 mm · 8 Ebenen · 230 kg" },
      { number: "4026212238723", use: "Verschließbar", title: "META CLIP Schrankmodul mit Volltür", spec: "2.000 × 1.000 × 600 mm · RAL 7035" },
      { number: "4026212327175", use: "Schutzausrüstung", title: "META CLIP Arbeitsschutzregal", spec: "2.000 × 1.000 × 600 mm · mit Kleiderstange" },
    ],
    duties: {
      meta: [
        "Lastangaben je Ebene: 150 kg Fachlast bei gleichmäßig verteilter Last",
        "Fußverdübelungs- und Wandbefestigungs-Sets für Grund- und Anbauregal",
        "Montageanleitung; auf Wunsch Montage durch geschulte META-Teams",
        "Regalinspektion durch META als Service",
      ],
      operator: [
        "Reifenregale immer mit Fußverankerung gegen Kippen sichern",
        ...OPERATOR_COMMON,
        "Brandschutz im Reifenlager mit Versicherer bzw. Brandschutzbeauftragtem abstimmen",
      ],
      hint: DUTY_HINT,
    },
    why: [{ title: "Made in Germany", text: "CLIP-Regale aus eigener Produktion in Deutschland" }, ...WHY_CLIP.slice(1)],
    project: {
      eyebrow: "Größere Anlage geplant?",
      title: "Vom Reifenregal bis zum mehrgeschossigen Räderlager",
      text: "Für Hunderte oder Tausende Radsätze plant META komplette Anlagen – mit Bühnen, mehreren Ebenen und Montage. Ein Beispiel: das dreigeschossige Räderlager von RÄDLOG für bis zu 9.000 Radsätze.",
      cta: "Projektanfrage stellen",
      link: { label: "Referenz ansehen", href: "https://www.meta-online.com/de-DE/referenzen/raedlog" },
    },
    docs: [{ label: "Broschüre „Lagerlösungen für Kfz-Zubehörteile und Reifen“", where: "Blätterkatalog" }, ...DOCS_COMMON],
    faqTitle: "Reifenregale in Werkstatt und Autohaus",
    faq: [
      { q: "Wie viele Reifen passen in ein META Reifenregal?", a: "Je Ebene stehen vier Reifen nebeneinander. Ein Regal mit 2.000 mm Höhe hat 3 Ebenen und nimmt 12 Reifen auf, mit 2.500 mm Höhe sind es 4 Ebenen und 16 Reifen. Die Regalbreite wählen Sie nach der Reifenbreite: 1.000 mm für Reifen bis 225 mm, 1.150 mm bis 265 mm und 1.300 mm bis 305 mm. Der Reifendurchmesser darf höchstens 700 mm betragen." },
      { q: "Tragen die Regale auch schwere SUV-Kompletträder?", a: "Jede Ebene trägt 150 kg bei gleichmäßig verteilter Last. Bei vier Rädern je Ebene sind das bis zu 37,5 kg pro Rad." },
      { q: "Muss ein Reifenregal am Boden befestigt werden?", a: "Ja. Reifenregale müssen immer mit einer Fußverankerung gegen Kippen gesichert werden. Passende Fußverdübelungs-Sets für Grund- und Anbauregal gibt es im Shop." },
      { q: "Was ist der Unterschied zwischen Grundregal und Anbauregal?", a: "Das Grundregal steht mit zwei Rahmen für sich allein. Das Anbauregal hat nur einen Rahmen und wird an ein bestehendes Regal angebaut. Eine Regalzeile besteht also aus einem Grundregal und beliebig vielen Anbauregalen." },
      { q: "Wie aufwendig ist die Montage?", a: "META CLIP S3 wird ohne Werkzeug gesteckt; durch das CLIP-EASY-Verfahren ist ein falsches Zusammenstecken nicht möglich. Wenn Sie nicht selbst aufbauen möchten, übernehmen geschulte META-Montageteams den Aufbau." },
      { q: "Kann ich Reifen auch mobil lagern?", a: "Mit dem META CLIP Regalwagen für Reifen bringen Sie die Räder direkt an die Hebebühne. Der Wagen misst 1.850 × 1.300 × 400 mm und hat Rollen mit 125 mm Durchmesser, die beiden vorderen Lenkrollen sind gebremst." },
      FAQ_INSPECTION,
    ],
    advice: { title: "Sie planen ein Reifenlager oder richten eine Werkstatt ein?", text: "Schicken Sie uns Raummaße und Anzahl der Radsätze – wir stellen die passenden Regale zusammen und sagen Ihnen, was Sie für die Befestigung brauchen." },
    notes: {
      nav: { text: "„Branchen“ als zusätzlicher Menüpunkt neben den Regalsystemen (Zweitnavigation). Alternative ohne Menüänderung: Startseite, Service-Menü und Footer. Ersetzt die Kampagne /reifenwechsel2025 (301)." },
      hero: { text: "H1 nennt Branche und Lagergut (Nutzer suchen „Reifenregal“, nicht „Branche“). Vorteile nur belegt. Bild: besser ein Anwendungsfoto aus dem META-Bestand (Katalog S. 202 ff.) – Bildrechte klären. Kennzahlen aus der Reifenregal-Tabelle.", src: "Katalog S. 14, 19, 50; Shop-Header" },
      areas: { text: "Jede Karte führt auf eine gefilterte Liste. Kfz-Käufer bestellen im Shop zu 60 % CLIP und zu 38 % MULTIPAL – deshalb Paletten als eigener Bereich. Katalog nennt Schrankmodule ausdrücklich für Werkstatt, Magazin und Lager; den Regalwagen „direkt an die Hebebühne“.", src: "Katalog S. 48, 50, 52, 58, 61, 62; Bestellspiegel Shop DE" },
      planning: { text: "Zwei Tabellen + Beispiel als Produkt-Set („in den Warenkorb“, Bundle-Muster wie /reifenwechsel2025). Ein echter Rechner bräuchte Theme-Arbeit → optional. Das Fußverdübelungs-Set im Shop trägt im Bildnamen die Katalog-Nr. 181557 (Reifenregal-Set) – sehr wahrscheinlich dasselbe Set.", src: "Katalog S. 25, 50; Shop-Preise 15.10.2026", checks: ["Planmaß Reifenregal für „Zeilenlänge ca. 7 m“", "Fußverdübelungs-Set 4026212303186/-193 = Katalog 181557/181558?"] },
      products: { text: "Standard-Produkt-Slider: Preise, Lieferzeit und Warenkorb live aus dem Shop. Etiketten („Reifen“, „Mobil“) wären Theme-Arbeit – ohne Agentur zwei Slider mit Zwischenüberschrift.", src: "Live-Shop 15.10.2026" },
      duties: { ...NOTE_DUTIES, text: NOTE_DUTIES.text + " Brandschutz-Satz ist ein allgemeiner Hinweis ohne Zahl." },
      why: NOTE_WHY,
      project: { text: "RÄDLOG ist eine MULTIFLOOR-Anlage (kein Shop-Artikel) und wird deshalb als Projekt gezeigt. Shop-Seiten /kataloge und /datenblaetter sind leer – bis dahin auf meta-online.com verlinken.", src: "META-Referenzen", checks: ["RÄDLOG: Übersicht sagt CLIP, Detailseite MULTIFLOOR"] },
      faq: { text: "Vorhandenes FAQ-Plugin (Gruppe + Fragen). Fragen aus echten Suchanfragen, Antworten nur mit Katalogwerten. 37,5 kg je Rad gerechnet (150 kg : 4).", src: "Katalog S. 11, 16, 19, 25, 28, 50, 52", checks: ["Regalwagen: Katalog max. 100 kg Fachlast, Shop-Artikel 150 kg", "Rollen/Bremsen aus Katalog für CLIP-Regalwagen allgemein – gilt für Reifen-Variante?"] },
      advice: { text: "Telefon (tel:-Link) und E-Mail aus dem Shop-Footer. Kein neues Formular nötig.", checks: ["Wochentage der Erreichbarkeit (Footer nennt nur die Uhrzeit)"] },
    },
  },

  // ───────────────────────────── Handwerk ─────────────────────────────
  {
    key: "handwerk",
    name: "Handwerk & Werkstatt",
    short: "Handwerk & Werkstatt",
    tagline: "Elektro, SHK, Metallbau",
    teaser: { goods: "Kabeltrommeln, Rohre, Profile und Kleinteile", fact: "Kabeltrommelregale bis 5.500 kg Feldlast" },
    url: "/branchen/handwerk-werkstatt",
    metaTitle: "Werkstattregale & Kabeltrommelregale fürs Handwerk | META",
    metaDescription:
      "Regale für Elektro-, SHK- und Metallbaubetriebe: Kabeltrommelregale, Regale für Rohre und Profile, Schrägboden- und Sichtlagerkastenregale vom Hersteller.",
    eyebrow: "Branchenlösung Handwerk",
    h1: "Regale für Handwerk und Werkstatt – Elektro, SHK und Metallbau",
    lead:
      "Kabeltrommeln, Rohre und Profile, Schrauben und Fittings, dazu das Material für die nächste Baustelle: Im Handwerk liegt auf engem Raum sehr Unterschiedliches. META hat für jedes Lagergut das passende Regal – vom Kabeltrommelregal bis zum Schrägbodenregal.",
    proof: ["CLIP und MULTIPAL Made in Germany", "5 Jahre META-Qualitätsgarantie*", "Erweiterbar mit Anbauregalen", "Kostenloser Versand"],
    ctaPrimary: "Regal nach Material finden",
    ctaSecondary: "Alle Werkstatt-Regale",
    hero: { number: "4026212394337", tag: "META MULTIPAL Kabeltrommelregal", alt: "META MULTIPAL Kabeltrommelregal, Grundregal 2700 x 1300 x 1100 mm, Typ 2, verzinkt" },
    facts: [
      { value: "bis 5.500 kg", label: "Feldlast Kabeltrommelregal" },
      { value: "3 Typen", label: "Kabeltrommelauflagen" },
      { value: "900–1.300 mm", label: "Fachbreiten" },
      { value: "Ø 42 / 60 mm", label: "Kabeltrommel-Achsen" },
    ],
    areasTitle: "Was im Handwerksbetrieb gelagert wird",
    areasIntro: "Vom Kabel bis zur Schraube: sechs Lagerbereiche – jeweils mit dem META-Regal, das dafür gebaut ist.",
    areas: [
      { icon: "drum", title: "Kabeltrommeln", text: "Trommeln auf Achsen lagern und das Kabel direkt im Regal abwickeln.", solution: "MULTIPAL Kabeltrommelregal · Auflage Typ 1, 2 oder 3 · Achsen Ø 42 oder 60 mm", linkLabel: "Kabeltrommelregale ansehen", linkTarget: "Kabeltrommelregal" },
      { icon: "profiles", title: "Profile und Stabmaterial stehend", text: "Leisten, Profile und Stabmaterial stehend, sortiert und griffbereit.", solution: "MINI-RACK oder MULTIPAL Profillagerregal", linkLabel: "Profillagerregale ansehen", linkTarget: "Profillagerregal" },
      { icon: "pipes", title: "Rohre und Langgut liegend", text: "Rohre und Stangen liegend auf Kragarmen; Abrolldorne verhindern, dass Rundmaterial herausrollt.", solution: "MULTISTRONG L Kragarmregal · Kragarme im 100-mm-Raster", linkLabel: "Kragarmregale ansehen", linkTarget: "/multistrong-grundregale" },
      { icon: "screws", title: "Schrauben, Fittings, Kleinteile", text: "Kartonware und Kästen gleiten auf geneigten Böden nach vorn zur Entnahme; Kleinteile in Sichtlagerkästen.", solution: "CLIP S3 Schrägbodenregal · 12° Neigung · Sichtlagerkastenregal", linkLabel: "Kleinteileregale ansehen", linkTarget: "Schrägbodenregal" },
      { icon: "box", title: "Material für die Baustelle", text: "Kommissioniertes Material, Geräte und Ersatzteile für den nächsten Einsatz.", solution: "CLIP Fachbodenregal · Fachlasten 80 bis 330 kg", linkLabel: "Fachbodenregale ansehen", linkTarget: "/clip-grundregale" },
      { icon: "helmet", title: "Arbeitsschutz und Kleidung", text: "Schutzausrüstung auf Fachböden, Arbeitskleidung an der Kleiderstange.", solution: "CLIP Arbeitsschutzregal · Kleiderstange 60 kg · Fachböden 100 kg", linkLabel: "Arbeitsschutzregal ansehen", linkTarget: "Arbeitsschutzregal" },
    ],
    planning: {
      title: "Welches Regal für welches Material?",
      stacked: true,
      intro: "Im Handwerk entscheidet das Lagergut über das Regalsystem. Die Tabelle zeigt, was wofür gebaut ist – mit den wichtigsten Werten und dem Einstiegspreis im Shop.",
      tables: [
        {
          head: ["Material", "META-Regal", "Wichtige Werte", "ab netto"],
          rows: [
            ["<b>Kabeltrommeln</b>", "MULTIPAL Kabeltrommelregal", "Fachbreiten 900 / 1.100 / 1.300 mm, Tiefe 1.100 mm, Feldlast bis 4.000 kg (2 Holme) bzw. 5.500 kg (3 Holme)", "{p:4026212393774}"],
            ["<b>Profile stehend</b>", "MINI-RACK Profillagerregal", "Höhe 2.200 bis 3.000 mm, Länge 1.400 mm, Tiefe 500 mm", "{p:4026212128642}"],
            ["<b>Rohre liegend</b>", "MULTISTRONG L Kragarmregal", "Armlast 220 / 175 / 140 kg bei 400 / 500 / 600 mm Armlänge, Höhe 2.000 bis 3.000 mm", "{p:4026212118698}"],
            ["<b>Schraubenpäckchen, Kästen</b>", "CLIP S3 Schrägbodenregal", "12° Neigung, Böden mit Fachteilerdrähten, Fachlast bis 230 kg", "{p:4026212440997}"],
            ["<b>Kleinteile in Kästen</b>", "CLIP S3 Sichtlagerkastenregal", "mit 21 bis 60 Sichtlagerkästen aus Polypropylen", "{p:4026212234176}"],
            ["<b>Allgemeines Material</b>", "CLIP Fachbodenregal", "Fachlasten 80, 150, 200, 230 und 330 kg, Fachböden im 25-mm-Raster", "{p:4026212417449}"],
          ],
          numCols: [3],
          hideMobile: [2],
          caption: "Fach- und Feldlasten bei gleichmäßig verteilter Last. Einstiegspreise für das jeweils kleinste Grundregal im Shop, zzgl. MwSt.",
        },
        {
          head: ["Kabeltrommelauflage", "Geeignet für", "Handhabung", "Feldlast"],
          rows: [
            ["<b>Typ 1</b>", "seltenen Trommelwechsel", "Trommel mittig einsetzen, Achse mit Stellring oder Zentrierstücken", "bis 4.000 / 5.500 kg"],
            ["<b>Typ 2</b>", "häufigen Trommelwechsel", "Trommel rollt auf Kunststoffrollen selbstständig in die Lagerposition; Achse mit Zentrierstücken und Kunststoffrollen nötig", "bis 4.000 / 5.500 kg"],
            ["<b>Typ 3 (A-Ständer)</b>", "übersichtliche Lagerung und Präsentation, z. B. im Elektro-Großhandel", "Auflage bis 750 kg je Paar", "1.500 bis 3.000 kg"],
          ],
          numCols: [3],
          hideMobile: [2],
          caption: "Typ 2 und Typ 3 sind rein zur manuellen Abwicklung geeignet. Bei einer Kernbohrung der Trommel über 80 mm immer die Achse mit 60 mm Durchmesser verwenden. Höchstlasten gelten ab 4 Feldern.",
        },
      ],
      example: {
        title: "Beispiel: Kabeltrommellager mit 4 Feldern",
        sub: "Typ 1 · Fachbreite 1.300 mm · Höhe 2.700 mm · 2 Ebenen je Feld · Achsen Ø 60 mm",
        lines: [
          { qty: 1, number: "4026212393835", label: "Kabeltrommelregal Grundregal 2.700 × 1.300 × 1.100 mm" },
          { qty: 3, number: "4026212393842", label: "Kabeltrommelregal Anbauregal 2.700 × 1.300 × 1.100 mm" },
          { qty: 8, number: "4026212142761", label: "Kabeltrommel-Achse Ø 60 × 1.300 mm mit Zentrierstücken" },
        ],
        info: "8 Achsplätze · Bodenanker im Lieferumfang",
        warn: "<b>Achse nach Trommel wählen:</b> Durchmesser und Länge richten sich nach Trommelgewicht, Trommelbreite und Kernbohrung.",
        cta: "Diese Zusammenstellung in den Warenkorb",
      },
    },
    productsTitle: "Bewährte Regale für Handwerksbetriebe",
    products: [
      { number: "4026212394337", use: "Kabel", title: "META MULTIPAL Kabeltrommelregal · Typ 2", spec: "2.700 × 1.300 × 1.100 mm · Feldlast 4.000 kg · verzinkt" },
      { number: "4026212142716", use: "Kabel", title: "META MULTIPAL Kabeltrommel-Achse", spec: "Ø 42 × 900 mm · Typ 1/3 · mit Zentrierstücken" },
      { number: "4026212128666", use: "Profile", title: "META MINI-RACK Profillagerregal", spec: "2.500 × 1.400 × 500 mm · RAL 7035" },
      { number: "4026212118698", use: "Rohre", title: "META MULTISTRONG L Kragarmregal", spec: "2.000 × 1.000 × 500 mm · Armlast 175 kg · einseitig" },
      { number: "4026212266535", use: "Kartonware", title: "META CLIP S3 Schrägbodenregal", spec: "2.000 × 1.000 × 500 mm · 8 Ebenen · 230 kg" },
      { number: "4026212234138", use: "Kleinteile", title: "META CLIP S3 Sichtlagerkastenregal", spec: "2.000 × 1.000 × 300 mm · 60 Kästen · 10 Ebenen" },
      { number: "4026212260250", use: "Material", title: "META CLIP S3 Fachbodenregal", spec: "2.000 × 1.000 × 600 mm · 5 Ebenen · 150 kg" },
      { number: "4026212327175", use: "Schutzausrüstung", title: "META CLIP Arbeitsschutzregal", spec: "2.000 × 1.000 × 600 mm · mit Kleiderstange" },
    ],
    duties: {
      meta: [
        "Lastangaben je Fach, Feld und Kragarm bei gleichmäßig verteilter Last",
        "Bodenanker bei Kabeltrommel- und Palettenregalen im Lieferumfang",
        "Abrolldorne gegen das Herausrollen von Rundmaterial",
        "Montageanleitung; auf Wunsch Montage und Regalinspektion durch META",
      ],
      operator: [
        "Kragarm- und Fachbodenregale ab Höhe : Tiefe über 4 : 1 mit Fuß- oder Wandverankerung sichern",
        "Nur intakte Kabeltrommeln einlagern",
        ...OPERATOR_COMMON,
      ],
      hint: DUTY_HINT,
    },
    why: WHY_CLIP,
    project: {
      eyebrow: "Elektro-Großhandel oder SHK-Fachhandel?",
      title: "Lager, Abholmarkt und Theke aus einer Hand",
      text: "Für den Fachgroßhandel plant META komplette Kabeltrommellager, Profillager und Fachmarkteinrichtungen – zum Beispiel für Elektro Schröder mit Kabeltrommelregal und Theke.",
      cta: "Projektanfrage stellen",
      link: { label: "Branchenseite Elektro & Sanitär", href: "https://www.meta-online.com/de-DE/loesungen/elektro-sanitaer" },
    },
    docs: [{ label: "Broschüre „Lagerlösungen für Sanitär-, Heizungs- und Klimamaterial“", where: "Blätterkatalog" }, ...DOCS_COMMON],
    faqTitle: "Regale im Handwerksbetrieb",
    faq: [
      { q: "Welcher Kabeltrommelauflage-Typ passt zu meinem Betrieb?", a: "Typ 1 ist für seltenen Trommelwechsel gedacht: Die Trommel wird mittig eingesetzt. Bei Typ 2 rollt die Trommel auf Kunststoffrollen selbstständig in die Lagerposition – das lohnt sich bei häufigem Wechsel. Typ 3 mit A-Ständer eignet sich für eine übersichtliche Lagerung und Präsentation, zum Beispiel im Elektro-Großhandel." },
      { q: "Welche Kabeltrommel-Achse brauche ich?", a: "Die Achse wird separat bestellt und richtet sich nach Trommelgewicht, Trommelbreite und Fachbreite. Bei einer Kernbohrung über 80 mm muss immer die Achse mit 60 mm Durchmesser eingesetzt werden. Für die Auflage Typ 2 gibt es eigene Achsen mit Kunststoffrollen." },
      { q: "Kann ich Kabel direkt im Regal abwickeln?", a: "Ja. Die Kabeltrommelregale sind dafür gebaut; die Auflagen Typ 2 und Typ 3 sind rein zur manuellen Abwicklung geeignet." },
      { q: "Wie lagere ich Rohre, ohne dass sie herausrollen?", a: "Im MULTISTRONG Kragarmregal werden Abrolldorne in die Kragarme gesteckt. Zusätzlich erhalten die Kragarme durch Anziehen der Stellschraube eine leichte Vorneigung, sodass Rundmaterial in Richtung Ständer rollt." },
      { q: "Wie viel trägt ein Kragarm?", a: "Beim MULTISTRONG LIGHT trägt ein Kragarm 220 kg bei 400 mm Armlänge, 175 kg bei 500 mm und 140 kg bei 600 mm – jeweils bei gleichmäßig verteilter Last." },
      { q: "Wofür ist ein Schrägbodenregal gut?", a: "Die Böden sind um 12° geneigt, dadurch gleitet die Ware zur Entnahmeseite. Das ist ideal für Kartonware wie Schraubenpäckchen oder Kunststoffkästen mit loser Ware und gibt einen guten Überblick über die Bestände." },
      FAQ_INSPECTION,
    ],
    advice: { title: "Sie richten Lager oder Werkstatt neu ein?", text: "Sagen Sie uns, was Sie lagern – Kabeltrommeln, Rohre, Kleinteile – und wie viel Platz Sie haben. Wir stellen die passenden Regale und das Zubehör zusammen." },
    notes: {
      facts: { text: "Kennzahlen nur zum abgebildeten Kabeltrommelregal: Feldlast mit 3 Holmen, Auflagen Typ 1–3, Fachbreiten und Achsdurchmesser (Shop-Artikel).", src: "Katalog S. 148–153; Shop-Artikel Kabeltrommelregal und -Achsen" },
      nav: { text: "URL /branchen/handwerk-werkstatt. Suchbegriffe: Kabeltrommelregal, Regal für Rohre, Werkstattregal. Ersetzt die fehlerhafte Kampagne /metaxecommerce nicht – die geht an „Handel & Versand“." },
      hero: { text: "„Made in Germany“ nur mit Systemnamen, weil MULTISTRONG laut Katalog nicht darunter fällt. Bild: Kabeltrommelregal, weil Elektro die größte Handwerksgruppe im Shop ist (26 von 105 Firmen).", src: "Katalog S. 14, 148–151; Bestellspiegel Shop DE" },
      areas: { text: "Profillagerregal: Katalog beschreibt die stehende Lagerung beim MULTIPAL-Profillagerregal; im Shop gibt es MINI-RACK- und MULTIPAL-Profillagerregale. Arbeitsschutzregal: Kleiderstange 60 kg, Fachböden 100 kg.", src: "Katalog S. 57, 58, 61, 147, 158–161" },
      planning: { text: "Material-Tabelle aus Katalog und Shop-Artikeln; „ab“-Preise sind die kleinsten Grundregale im Shop. Beispiel mit 4 Feldern, weil die Höchstlasten erst ab 4 Feldern gelten. Achsen-Anzahl = Ebenen je Feld.", src: "Katalog S. 58, 147–153, 158, 163", checks: ["2 Ebenen je Feld = 2 Achsen je Feld?", "„ab“-Preise = günstigstes Grundregal je System im Shop (Kabeltrommel: Typ 1/2; Typ 3 ab 965 € ist günstiger)"] },
      products: { text: "Kabeltrommel-Achse als eigene Karte, weil sie separat bestellt werden muss.", src: "Live-Shop 15.10.2026" },
      duties: NOTE_DUTIES,
      why: NOTE_WHY,
      project: { text: "Elektro Schröder ist eine META-Referenz (Kabeltrommelregal und Theke). Theken gibt es nicht im Shop – deshalb als Projekt.", src: "META-Referenzen, Branchenseite Elektro & Sanitär" },
      faq: { text: "Fragen aus den Suchbegriffen „kabeltrommelregal“, „regal für rohre“, „werkstattregal“.", src: "Katalog S. 58, 148–153, 160–163" },
      advice: { text: "Gleicher Beratungskasten wie auf allen Branchenseiten." },
    },
  },

  // ───────────────────────────── Industrie ─────────────────────────────
  {
    key: "industrie",
    name: "Industrie & Produktion",
    short: "Industrie & Produktion",
    tagline: "Ersatzteil- und Palettenlager",
    teaser: { goods: "Ersatzteile, Betriebsmittel, Paletten und Gefahrstoffe", fact: "Palettenregale mit RAL-Gütezeichen und GS" },
    url: "/branchen/industrie-produktion",
    metaTitle: "Regale für Industrie: Ersatzteil- & Palettenlager | META",
    metaDescription:
      "Fachboden-, Paletten- und Weitspannregale für Ersatzteilmagazin, Betriebsmittel, Paletten und Gefahrstoffe – mit Planungshilfe nach Palettengewicht.",
    eyebrow: "Branchenlösung Industrie",
    h1: "Regale für Industrie und Produktion – Ersatzteillager, Betriebsmittel, Paletten",
    lead:
      "Ersatzteile für die Instandhaltung, Werkzeuge und Betriebsmittel, Paletten mit Material, schwere Einzelteile und Gefahrstoffe: META liefert Fachboden-, Paletten- und Weitspannregale aus einem Haus – die Palettenregale gütegesichert nach RAL und mit GS-Zeichen.",
    proof: ["Made in Germany", "MULTIPAL mit RAL-Gütezeichen und GS", "5 Jahre META-Qualitätsgarantie*", "Kostenloser Versand"],
    ctaPrimary: "Palettenregal planen",
    ctaSecondary: "Alle Industrie-Regale",
    hero: { number: "4026212334678", tag: "META MULTIPAL Palettenregal", alt: "META MULTIPAL Palettenregal, Grundregal 4400 x 2700 x 1100 mm, verzinkt" },
    facts: [
      { value: "bis 1.120 kg", label: "Tragkraft je Palette" },
      { value: "9 oder 12", label: "Europaletten je Feld (2.700 mm)" },
      { value: "2.700–5.500 mm", label: "Regalhöhen" },
      { value: "50 mm", label: "Raster der Holme" },
    ],
    areasTitle: "Was in Produktion und Instandhaltung gelagert wird",
    areasIntro: "Sechs Lagerbereiche vom Kleinteil bis zur Palette – jeweils mit dem passenden META-System.",
    areas: [
      { icon: "grid", title: "Ersatzteilmagazin", text: "Viele Artikel auf wenig Fläche: Fachböden mit Fachteilern, im 25-mm-Raster an das Lagergut angepasst.", solution: "CLIP Fachbodenregal · Fachböden im 50-mm-Raster gelocht für Fachteiler", linkLabel: "Fachbodenregale ansehen", linkTarget: "/clip-grundregale" },
      { icon: "cabinet", title: "Werkzeuge und Betriebsmittel", text: "Verschließbar und in bestehende Fachbodenanlagen integrierbar.", solution: "CLIP Schrankmodul · Schubladen bis 70 kg · Türen", linkLabel: "Schrankmodule ansehen", linkTarget: "Schrankmodul" },
      { icon: "pallet", title: "Paletten und Gitterboxen", text: "Europaletten längs eingelagert; Gitterboxen sicher auf Winkelauflagen.", solution: "MULTIPAL Palettenregal · Holme im 50-mm-Raster · Winkelauflagerahmen", linkLabel: "Palettenregale ansehen", linkTarget: "/multipal-grundregale" },
      { icon: "heavy", title: "Schwere Einzelteile", text: "Großes und schweres Einzelgut liegend oder stehend, auf großen Fachflächen.", solution: "MINI-RACK Weitspannregal · 600 kg Fachlast · MULTIPAL Großfachregal", linkLabel: "Weitspannregale ansehen", linkTarget: "/mini-rack-grundregale" },
      { icon: "pipes", title: "Langgut und Platten", text: "Stangen, Rohre, Profile und Plattenware liegend auf Kragarmen.", solution: "MULTISTRONG Kragarmregal · LIGHT und MEDIUM", linkLabel: "Kragarmregale ansehen", linkTarget: "/multistrong-grundregale" },
      { icon: "warning", title: "Gefahrstoffe", text: "Fässer auf Euro- oder Chemiepaletten in Regalen mit Auffangwannen nach WHG.", solution: "MULTIPAL Gefahrstoffregal · Wannen separat", linkLabel: "Gefahrstoffregale ansehen", linkTarget: "Gefahrstoffregal" },
    ],
    planning: {
      title: "Palettenregal nach Palettengewicht wählen",
      stacked: true,
      intro: "Entscheidend sind Hallenhöhe, Feldlänge und das Gewicht je Palette. Die Tabelle zeigt die Palettenregale im Shop für Europaletten (1.200 × 800 mm) bei 1.100 mm Tiefe.",
      tables: [
        {
          head: ["Höhe · Feldlänge", "Ebenen · Plätze je Feld", "Tragkraft je Palette", "Grundregal", "Anbauregal"],
          rows: [
            ["<b>2.700 · 2.700 mm</b>", "3 · 9", "490 / 780 / 990 kg", "{p:4026212248722} / {p:4026212249842} / {p:4026212292435}", "{p:4026212323450} / {p:4026212323658} / {p:4026212323771}"],
            ["<b>3.300 · 2.700 mm</b>", "3 · 9", "480 / 780 / 980 kg", "{p:4026212248746} / {p:4026212132267} / {p:4026212334623}", "{p:4026212323481} / {p:4026212323672} / {p:4026212323795}"],
            ["<b>3.300 · 2.700 mm</b>", "4 · 12", "490 / 790 / 980 kg", "{p:4026212334692} / {p:4026212334708} / {p:4026212334715}", "{p:4026212323542} / {p:4026212323719} / {p:4026212323856}"],
            ["<b>3.300 · 1.825 mm</b>", "3 · 6", "1.100 kg", "{p:4026212348187}", "{p:4026212358568}"],
            ["<b>4.400 · 2.700 mm</b>", "3 · 9", "470 / 770 / 960 kg", "{p:4026212334654} / {p:4026212334661} / {p:4026212334678}", "{p:4026212323511} / {p:4026212323696} / {p:4026212323825}"],
          ],
          numCols: [3, 4],
          hideMobile: [4],
          caption: "Ebenen und Plätze inklusive Bodenlagerebene. Die Werte gelten ab 4 Feldern nebeneinander; bei weniger Feldern werden die Belastungswerte abgemindert. Preise verzinkt, zzgl. MwSt.",
        },
      ],
      example: {
        title: "Beispiel: 36 Palettenplätze bis 780 kg",
        sub: "Hallenhöhe ab 3,3 m · Feldlänge 2.700 mm · 3 Ebenen inkl. Boden · 4 Felder",
        lines: [
          { qty: 1, number: "4026212132267", label: "Palettenregal Grundregal 3.300 × 2.700 × 1.100 mm" },
          { qty: 3, number: "4026212323672", label: "Palettenregal Anbauregal 3.300 × 2.700 × 1.100 mm" },
          { qty: 2, number: "4026212056846", label: "Rammschutzecke für die äußeren Ständer" },
        ],
        perLabel: { divisor: 36, unit: "Palettenplatz", extra: "Bodenanker im Lieferumfang" },
        warn: "<b>Untergrund:</b> Palettenregale werden auf Beton der Mindestgüte C20/25 (ca. 200 mm stark) aufgestellt und mit Ankern fixiert.",
        cta: "Diese Zusammenstellung in den Warenkorb",
      },
    },
    productsTitle: "Bewährte Regale für Produktion und Instandhaltung",
    products: [
      { number: "4026212015201", use: "Ersatzteile", title: "META CLIP Fachbodenregal · Grundregal", spec: "2.000 × 1.000 × 500 mm · 5 Ebenen · 230 kg · verzinkt" },
      { number: "4026212434217", use: "Ersatzteile", title: "META CLIP Fachteiler freistehend", spec: "150 × 500 mm · verzinkt · 10 Stück" },
      { number: "4026212281392", use: "Betriebsmittel", title: "META CLIP Schrankmodul mit Schubladen", spec: "2.000 × 1.000 × 500 mm · RAL 7035" },
      { number: "4026212334678", use: "Paletten", title: "META MULTIPAL Palettenregal · Grundregal", spec: "4.400 × 2.700 × 1.100 mm · 3 Ebenen · 9 Paletten" },
      { number: "4026212132519", use: "Großteile", title: "META MULTIPAL Großfachregal", spec: "2.200 × 2.700 × 800 mm · 3 Ebenen · Stahlpaneele" },
      { number: "4026212057867", use: "Großteile", title: "META MINI-RACK Weitspannregal", spec: "2.200 × 2.200 × 800 mm · 600 kg · Stahlpaneele" },
      { number: "4026212348460", use: "Gefahrstoffe", title: "META MULTIPAL Gefahrstoffregal", spec: "2.700 × 1.825 × 1.100 mm · 2 Ebenen · ohne Wannen" },
      { number: "4026212056846", use: "Anfahrschutz", title: "META MULTIPAL Rammschutzecke", spec: "RAL 1003" },
    ],
    duties: {
      meta: [
        "MULTIPAL gütegesichert nach RAL-RG 614/2, mit GS-Zeichen, statischer Nachweis nach DIN EN 15512",
        "Bodenanker bei Palettenregalen im Lieferumfang",
        "Rammschutzecken und Winkelauflagen als Zubehör",
        "Montageanleitung; auf Wunsch Montage und Regalinspektion durch META",
      ],
      operator: [
        "Palettenregale auf Beton mind. C20/25 aufstellen und verankern",
        "Äußere Ständer an Ecken und Durchfahrten mit Rammschutzecken schützen",
        "Gefahrstoffe nur mit Auffangwannen nach WHG lagern",
        ...OPERATOR_COMMON,
      ],
      hint: DUTY_HINT,
    },
    why: WHY_CLIP,
    project: {
      eyebrow: "Größeres Lager geplant?",
      title: "Verschieberegale, Bühnen und Lagerautomatisierung",
      text: "Für größere Lager plant META verfahrbare Regalanlagen, Stahlbaubühnen und mit META-ILS auch automatisierte Fördertechnik – vor Ort aufgenommen und als CAD-Planung.",
      cta: "Projektanfrage stellen",
      link: { label: "Branchenseite Industrie & Produktion", href: "https://www.meta-online.com/de-DE/loesungen/industrie-produktion" },
    },
    docs: DOCS_COMMON,
    faqTitle: "Regale für Industrie und Produktion",
    faq: [
      { q: "Wie viele Europaletten passen in ein Regalfeld?", a: "Bei 2.700 mm Feldlänge stehen drei Europaletten nebeneinander: mit 3 Lagerebenen sind das 9 Palettenplätze, mit 4 Lagerebenen 12 – jeweils inklusive Bodenlagerebene. Bei 1.825 mm Feldlänge sind es 6 beziehungsweise 8 Plätze." },
      { q: "Warum gelten die Lastangaben erst ab 4 Feldern?", a: "Die Fach- und Feldlasten der MULTIPAL-Palettenregale gelten für Regalzeilen mit mindestens 4 Feldern und mindestens 2 Holmpaaren. Bei weniger Feldern werden die Belastungswerte abgemindert." },
      { q: "Kann ich Gitterboxen ins Palettenregal stellen?", a: "Gitterboxpaletten lassen sich wegen ihrer Winkelfüße nur schlecht direkt einlagern. Winkelauflagen führen die Füße sicher auf die Holme." },
      { q: "Welcher Boden ist für Palettenregale nötig?", a: "Palettenregale werden auf Beton der Mindestgüte C20/25 mit etwa 200 mm Stärke aufgestellt und zur Lage- und Kippsicherung mit Ankern fixiert. Die Bodenanker sind im Lieferumfang." },
      { q: "Wie lagere ich Gefahrstoffe im Palettenregal?", a: "Das MULTIPAL Gefahrstoffregal wird mit Regal-Bodenwannen nach WHG kombiniert. So lassen sich wassergefährdende Stoffe der GHS-Kategorien 1 bis 4 und entzündbare Flüssigkeiten der GHS-Kategorien 1 bis 3 lagern. Die Regale werden ohne Wannen geliefert." },
      { q: "Lässt sich ein Ersatzteilregal später umbauen?", a: "Ja. Die CLIP-Fachböden sind im 25-mm-Raster höhenverstellbar und im 50-mm-Raster für Fachteiler gelocht (außer bei 80-kg-Fachböden). Mit Anbauregalen wird die Regalzeile verlängert." },
      FAQ_INSPECTION,
    ],
    advice: { title: "Sie planen ein Ersatzteil- oder Palettenlager?", text: "Schicken Sie uns Hallenmaße, Palettengewichte und Artikelzahl – wir stellen die passenden Regale zusammen oder planen die Anlage mit Ihnen vor Ort." },
    notes: {
      facts: { text: "Kennzahlen nur zum abgebildeten MULTIPAL-Palettenregal: höchste Tragkraft je Palette im Shop (3.300 × 1.825 mm, 4 Ebenen), Plätze je 2.700-mm-Feld, Regalhöhen der Shop-Artikel (1.100 mm tief), Holmraster.", src: "Katalog S. 121, 131; Shop-Artikel MULTIPAL Palettenregal" },
      nav: { text: "URL /branchen/industrie-produktion. Größte Käufergruppe im Shop (322 Firmen, CLIP 46 %, MULTIPAL 42 %)." },
      hero: { text: "RAL-RG 614/2, GS und DIN EN 15512 für MULTIPAL laut Katalog S. 121. „bis 1.120 kg Tragkraft je Palette“ = höchster Wert im Shop (3.300 × 1.825, 4 Ebenen).", src: "Katalog S. 14, 121, 131", checks: ["Shop-Artikelnamen nennen die Tragkraft je Palette als „Fachlast“ (z. B. 980 kg, Eigenschaft „max. Fachlast“ 2.930 kg) – Namen korrigieren?"] },
      areas: { text: "Ersatzteilmagazine laut Katalog S. 19 ausdrücklich für Industrie und Handwerk. Gitterbox/Winkelauflagen S. 210; Winkelauflagerahmen im Shop vorhanden.", src: "Katalog S. 19, 48, 111, 144, 158, 210" },
      planning: { text: "Werte „Tragkraft je Palette“ aus Katalog S. 131 und Shop-Artikelnamen (identisch). Beispiel mit 4 Feldern wegen Abminderung bei weniger Feldern; Rammschutzecken laut S. 135 an Ecken Pflicht.", src: "Katalog S. 125, 131, 135", checks: ["Rammschutzecke: 2 Stück für eine freistehende Zeile ausreichend?"] },
      products: { text: "Gefahrstoffregal ausdrücklich „ohne Wannen“ – einzelne Regal-Bodenwannen gibt es im Shop nicht, nur das Komplettset „Gefahrstoff-KTC komplett“.", src: "Live-Shop 15.10.2026", checks: ["Regal-Bodenwannen nach WHG in den Shop aufnehmen oder auf Anfrage verweisen?"] },
      duties: NOTE_DUTIES,
      why: NOTE_WHY,
      project: { text: "Verschieberegale (MULTIBLOC), Stahlbau und META-ILS laut Katalog S. 5, 182–199 – nicht im Shop, deshalb Projekt-Brücke.", src: "Katalog S. 5, 11, 182–199" },
      faq: { text: "Antworten nur mit Katalogwerten.", src: "Katalog S. 19, 125, 131, 135, 144, 210" },
      advice: { text: "Gleicher Beratungskasten wie auf allen Branchenseiten." },
    },
  },

  // ───────────────────────────── Büro / Archiv ─────────────────────────────
  {
    key: "buero",
    name: "Büro, Archiv & Verwaltung",
    short: "Büro, Archiv & Verwaltung",
    tagline: "Ordner, Akten, Behörden",
    teaser: { goods: "Ordner, Akten und Archivkartons", fact: "Bis 105 Ordner je Regalfeld" },
    url: "/branchen/buero-archiv-verwaltung",
    metaTitle: "Büroregale & Archivregale für Ordner und Akten | META",
    metaDescription:
      "Büro- und Archivregale für Ordner, Akten und Archivkartons – für Verwaltungen, Kanzleien, Schulen und Kommunen. Mit Ordnerkapazität und Kauf auf Rechnung.",
    eyebrow: "Branchenlösung Büro & Verwaltung",
    h1: "Regale für Büro, Archiv und Verwaltung – Ordner, Akten, Archivkartons",
    lead:
      "Für Verwaltungen, Kanzleien, Schulen, Hochschulen und Kommunen: META COMPACT Büroregale für Ordner und Akten, CLIP Fachbodenregale für Archivkartons und Material, Weitspannregale für Hausmeister- und Bauhoflager.",
    proof: ["Steckmontage ohne Werkzeug", "5 Jahre META-Qualitätsgarantie*", "Kauf auf Rechnung", "Kostenloser Versand"],
    ctaPrimary: "Ordnerkapazität berechnen",
    ctaSecondary: "Alle Büroregale",
    hero: { number: "4026212287875", tag: "META COMPACT Büro-Steckregal", alt: "META CLIP COMPACT S3 Büro-Steckregal, Grundregal 2500 x 1000 x 300 mm, verzinkt" },
    facts: [
      { value: "bis 105", label: "Ordner je Regalfeld (300 mm tief)" },
      { value: "80 kg", label: "Fachlast je Boden" },
      { value: "1.850–2.500", label: "Regalhöhen in mm" },
      { value: "25 mm", label: "Raster der Fachböden" },
    ],
    areasTitle: "Was in Büro, Archiv und Verwaltung gelagert wird",
    areasIntro: "Vom Ordner im Büro bis zum Material im Bauhof – sechs Bereiche mit dem passenden META-Regal.",
    areas: [
      { icon: "folder", title: "Ordnerablage im Büro", text: "Ordner und Akten griffbereit, Fachböden mit Endanschlag.", solution: "COMPACT Büro-Steckregal · 300 mm tief · bis 7 Böden", linkLabel: "Büroregale ansehen", linkTarget: "/compact-grundregale" },
      { icon: "archive", title: "Aktenarchiv", text: "Doppelseitig bedienbare Regale mit 600 mm Tiefe nehmen doppelt so viele Ordner auf.", solution: "COMPACT doppelseitig · Längsriegel · Mittelanschlag", linkLabel: "Doppelregale ansehen", linkTarget: "COMPACT Doppel" },
      { icon: "box", title: "Archivkartons und Materialien", text: "Kartons, Druckerpapier, Verbrauchsmaterial auf tragfähigen Fachböden.", solution: "CLIP Fachbodenregal · 150 kg je Fachboden", linkLabel: "Fachbodenregale ansehen", linkTarget: "/clip-grundregale" },
      { icon: "lock", title: "Ablage hinter Türen", text: "Personalakten und Vertrauliches hinter Vorsatztüren – die COMPACT-Vorsatztüren sind verschieden schließend.", solution: "Vorsatztüren für COMPACT und CLIP", linkLabel: "Vorsatztüren ansehen", linkTarget: "Vorsatztür" },
      { icon: "heavy", title: "Hausmeister-, Bauhof- und Materiallager", text: "Sperriges und Schweres auf großen Fachflächen.", solution: "SPEED-RACK Weitspannregal · bis 500 kg Fachlast", linkLabel: "Weitspannregale ansehen", linkTarget: "/speed-rack-komplettregale" },
      { icon: "move", title: "Platz sparen im Archiv", text: "Verfahrbare Regale nutzen die Gänge als Lagerfläche – für große Akten- und Bücherarchive.", solution: "MULTIBLOC verfahrbare Regale · als Projekt", linkLabel: "Projekt anfragen", linkTarget: "#beratung" },
    ],
    planning: {
      title: "Wie viele Ordner passen ins Regal?",
      intro: "Die Ordnerkapazität hängt von Höhe und Länge des Regals ab. Bei 600 mm Tiefe (doppelseitig) passen doppelt so viele Ordner hinein.",
      tables: [
        {
          head: ["Höhe · Böden", "750 mm lang", "1.000 mm lang", "1.250 mm lang"],
          rows: [
            ["<b>1.850 mm</b> · 5 Böden", "45 Ordner", "60 Ordner", "75 Ordner"],
            ["<b>2.200 mm</b> · 6 Böden", "54 Ordner", "72 Ordner", "90 Ordner"],
            ["<b>2.500 mm</b> · 7 Böden", "63 Ordner", "84 Ordner", "105 Ordner"],
          ],
          numCols: [1, 2, 3],
          caption: "COMPACT bei 300 mm Tiefe ohne Abdeckboden. Fachlast 80 kg je Boden bei gleichmäßig verteilter Last.",
        },
        {
          head: ["Preis je Feld (netto, verzinkt)", "750 mm", "1.000 mm", "1.250 mm"],
          rows: [
            ["1.850 mm · Grund- / Anbauregal", "{p:4026212287738} / {p:4026212287745}", "{p:4026212287752} / {p:4026212287769}", "{p:4026212287776} / {p:4026212287783}"],
            ["2.200 mm · Grund- / Anbauregal", "{p:4026212287790} / {p:4026212287806}", "{p:4026212287813} / {p:4026212287820}", "{p:4026212287837} / {p:4026212287844}"],
            ["2.500 mm · Grund- / Anbauregal", "{p:4026212287851} / {p:4026212287868}", "{p:4026212287875} / {p:4026212287882}", "{p:4026212287899} / {p:4026212287905}"],
          ],
          numCols: [1, 2, 3],
          caption: "META CLIP COMPACT S3, 300 mm tief, verzinkt, zzgl. MwSt. Auch in RAL 7035 lichtgrau erhältlich.",
        },
      ],
      example: {
        title: "Beispiel: Archiv für 650 Ordner",
        sub: "Raumhöhe ab 2,5 m · 1.000 mm Länge · 7 Böden → 84 Ordner je Feld → 8 Felder",
        lines: [
          { qty: 1, number: "4026212287875", label: "COMPACT Grundregal 2.500 × 1.000 × 300 mm" },
          { qty: 7, number: "4026212287882", label: "COMPACT Anbauregal 2.500 × 1.000 × 300 mm" },
          { qty: 1, number: "4026212303179", label: "Wandbefestigungsset für Grundregal" },
          { qty: 7, number: "4026212109764", label: "Wandbefestigungsset für Anbauregal" },
        ],
        perLabel: { divisor: 672, unit: "Ordnerplatz", extra: "672 Ordner · Zeilenlänge ca. 8 m" },
        warn: "<b>Pflicht:</b> Einseitige COMPACT-Regale gegen Kippen sichern – die Regalhöhe beträgt mehr als das 4-Fache der Tiefe.",
        cta: "Diese Zusammenstellung in den Warenkorb",
      },
    },
    productsTitle: "Bewährte Regale für Büro und Archiv",
    products: [
      { number: "4026212287875", use: "Ordner", title: "META COMPACT Büro-Steckregal · Grundregal", spec: "2.500 × 1.000 × 300 mm · 7 Ebenen · verzinkt" },
      { number: "4026212287882", use: "Ordner", title: "META COMPACT Büro-Steckregal · Anbauregal", spec: "2.500 × 1.000 × 300 mm · 7 Ebenen · verzinkt" },
      { number: "4026212285871", use: "Archiv", title: "META COMPACT Doppel-Grundregal", spec: "2.500 × 1.250 × 600 mm · 100 kg · Mittelanschlag" },
      { number: "4026212153668", use: "Büro", title: "META COMPACT Büro-Steckregal · RAL 7035", spec: "2.200 × 1.000 × 300 mm · 6 Ebenen · lichtgrau" },
      { number: "4026212281491", use: "Archivkartons", title: "META CLIP Fachbodenregal · Grundregal", spec: "2.000 × 1.000 × 400 mm · 5 Ebenen · 150 kg" },
      { number: "4026212260250", use: "Material", title: "META CLIP S3 Fachbodenregal", spec: "2.000 × 1.000 × 600 mm · 5 Ebenen · 150 kg" },
      { number: "4026212204926", use: "Hausmeister", title: "META SPEED-RACK Weitspannregal", spec: "1.970 × 1.700 × 600 mm · 500 kg · Stahlpaneele" },
      { number: "4026212057867", use: "Bauhof", title: "META MINI-RACK Weitspannregal", spec: "2.200 × 2.200 × 800 mm · 600 kg · Stahlpaneele" },
    ],
    duties: {
      meta: [
        "Fachlast je Boden: 80 kg (100 kg bei 1.250 × 600 mm mit Mittelanschlag)",
        "Dübelfähige Stahlfüße, Wandbefestigungs- und Fußverdübelungs-Sets",
        "Montageanleitung; auf Wunsch Montage durch geschulte META-Teams",
        "Regalinspektion durch META als Service",
      ],
      operator: ["Einseitige Büroregale gegen Kippen sichern (Höhe über 4-fache Tiefe)", ...OPERATOR_COMMON],
      hint: DUTY_HINT,
    },
    why: [
      { title: "Steckmontage", text: "COMPACT und CLIP ohne Werkzeug aufgebaut" },
      { title: "5 Jahre Garantie*", text: "META-Qualitätsgarantie zusätzlich zur gesetzlichen Gewährleistung" },
      { title: "Kauf auf Rechnung", text: "Zahlung 30 Tage nach Rechnung" },
      { title: "Erweiterbar", text: "Anbauregale und Zubehör aus demselben System" },
      { title: "Montageservice", text: "Geschulte Montageteams auf Anfrage" },
      { title: "Nur B2B", text: "Kostenloser Versand an Gewerbekunden und Einrichtungen" },
    ],
    project: {
      eyebrow: "Großes Archiv geplant?",
      title: "Bis zu 100 % mehr Lagerkapazität mit verfahrbaren Regalen",
      text: "Verfahrbare Fachbodenregale von META nutzen die Gänge als Lagerfläche. Sie eignen sich laut META besonders für Büro- und Bücherarchive, Aktenlagerung sowie Pendel- und Hängeregister und werden per Kurbel oder Handgriff bewegt.",
      cta: "Projektanfrage stellen",
    },
    docs: [{ label: "Angebot als PDF für Ihre Beschaffung anfordern", where: "per E-Mail" }, ...DOCS_COMMON],
    faqTitle: "Büroregale und Archivregale",
    faq: [
      { q: "Wie viele Ordner passen in ein COMPACT-Büroregal?", a: "Bei 300 mm Tiefe passen in ein 2.500 mm hohes Regal mit 7 Böden 63 Ordner (750 mm Länge), 84 Ordner (1.000 mm) oder 105 Ordner (1.250 mm). Bei 600 mm Tiefe sind es doppelt so viele." },
      { q: "Wie viel trägt ein Fachboden im Büroregal?", a: "Ein COMPACT-Fachboden trägt 80 kg bei gleichmäßig verteilter Last. Bei 1.250 × 600 mm mit Mittelanschlag sind es 100 kg." },
      { q: "Muss ein Büroregal an der Wand befestigt werden?", a: "Einseitige COMPACT-Regale müssen gegen Kippen gesichert werden, weil die Regalhöhe mehr als das 4-Fache der Regaltiefe beträgt. Dafür gibt es Wandbefestigungs- und Fußverdübelungs-Sets." },
      { q: "Was ist der Unterschied zwischen einseitigem und doppelseitigem Regal?", a: "Einseitige Regale werden an der Rückseite mit Diagonalstreben ausgesteift und stehen an der Wand. Doppelseitige Regale werden mit Längsriegeln ausgesteift und sind von beiden Seiten nutzbar." },
      { q: "Kann ich auf Rechnung kaufen?", a: "Ja, im Shop ist der Kauf auf Rechnung mit 30 Tagen Zahlungsziel möglich. Für Ihre Beschaffung erstellen wir auch ein Angebot." },
      { q: "Gibt es die Regale auch in Lichtgrau?", a: "Ja. COMPACT gibt es verzinkt mit zerlegten S3-Rahmen oder in RAL 7035 lichtgrau mit vorgefertigten Rahmen." },
      FAQ_INSPECTION,
    ],
    advice: { title: "Sie richten ein Archiv oder Büro ein?", text: "Nennen Sie uns Raummaße und Ordnerzahl – wir stellen die passenden Regale zusammen und erstellen Ihnen ein Angebot für die Beschaffung." },
    notes: {
      nav: { text: "URL /branchen/buero-archiv-verwaltung. Spricht Einrichtungen an (Kommunen, Schulen, Hochschulen, Kliniken: zusammen 215 Firmen im Shop) – bisher nirgends angesprochen. Suchbegriffe: regal für ordner, archivregal." },
      hero: { text: "Kein „Made in Germany“, weil COMPACT im Katalog nicht darunter genannt ist. Kauf auf Rechnung: 2026 die häufigste Zahlungsart im Shop.", src: "Katalog S. 14, 99–101; Bestellspiegel Shop DE", checks: ["Bedingungen für Rechnungskauf (Bonitätsprüfung, Mindestbetrag) für Behörden"] },
      areas: { text: "Vorsatztüren gibt es im Shop, aber ohne Produktbild – deshalb keine Produktkarte. MULTIBLOC nur als Projekt.", src: "Katalog S. 99–101, 106, 182–184", checks: ["Produktbilder für COMPACT- und CLIP-Vorsatztüren fehlen im Shop"] },
      planning: { text: "Ordnerkapazität 1:1 aus Katalog S. 101. Beispiel 8 Felder = 672 Ordner für „650 Ordner“. CLIP-Wandbefestigungssets im Beispiel – der Katalog führt für COMPACT eigene Set-Nummern.", src: "Katalog S. 100, 101", checks: ["CLIP-Wandbefestigungsset 4026212303179/-764 auch für COMPACT geeignet?", "Zeilenlänge ca. 8 m (8 × 1.000 mm + Rahmen)"] },
      products: { text: "Weitspannregale für Hausmeister und Bauhof (öffentliche Hand kauft zu 13 % Weitspann).", src: "Live-Shop 15.10.2026; Bestellspiegel" },
      duties: NOTE_DUTIES,
      why: { text: "Eigene Vorteilsleiste mit „Kauf auf Rechnung“ statt „Made in Germany“ (gilt nicht für COMPACT).", src: "Katalog S. 14; Shop-Zahlungsarten" },
      project: { text: "„Bis zu 100 % mehr Lagerkapazität“ und Einsatzgebiete laut Katalog S. 182 und 184.", src: "Katalog S. 182, 184" },
      faq: { text: "E-Rechnung bewusst nicht erwähnt, solange nicht geklärt.", src: "Katalog S. 100, 101", checks: ["E-Rechnung (XRechnung/ZUGFeRD) im Shop möglich?", "Fachlast 600 mm tief: Katalog 80 kg (750/1.000 mm) bzw. 100 kg (1.250 mm), Shop-Artikel nennen 100 kg für alle Längen"] },
      advice: { text: "Gleicher Beratungskasten; Angebot für die Beschaffung betont." },
    },
  },

  // ───────────────────────────── Handel ─────────────────────────────
  {
    key: "handel",
    name: "Handel, Versand & E-Commerce",
    short: "Handel & Versand",
    tagline: "Kommissionieren, Packen",
    teaser: { goods: "Kommissionierlager, Packplatz und Paletten-Nachschub", fact: "Kommissionierregale beidseitig bedienbar" },
    url: "/branchen/handel-versand",
    metaTitle: "Lagerregale für Handel, Versand & E-Commerce | META",
    metaDescription:
      "Kommissionierregale, Packtische, Weitspann- und Palettenregale für Online-Handel, Großhandel und Versand – Lager und Packplatz direkt vom Hersteller.",
    eyebrow: "Branchenlösung Handel & Versand",
    h1: "Regale für Handel und Versand – Kommissionierlager und Packplatz",
    lead:
      "Kleinteile kommissionieren, Pakete packen, Kartonware und Paletten-Nachschub lagern: Mit META CLIP Fachbodenregalen, SPEED-RACK Packtischen und MULTIPAL Palettenregalen richten Sie Lager und Versand aus einem Shop ein.",
    proof: ["Made in Germany", "5 Jahre META-Qualitätsgarantie*", "Erweiterbar mit Anbauregalen", "Kostenloser Versand"],
    ctaPrimary: "Lager und Packplatz planen",
    ctaSecondary: "Alle Lagerregale",
    hero: { number: "4026212324228", tag: "META CLIP mit Längsriegeln", alt: "META CLIP S3 Fachbodenregal mit Längsriegeln, Grundregal 2000 x 1000 x 400 mm, verzinkt" },
    facts: [
      { value: "beidseitig", label: "bedienbar mit Längsriegeln" },
      { value: "150 / 230 kg", label: "Fachlast je Fachboden" },
      { value: "25 mm", label: "Raster der Fachböden" },
      { value: "50 mm", label: "Lochung für Fachteiler" },
    ],
    areasTitle: "Was in Lager und Versand gebraucht wird",
    areasIntro: "Vom Kommissionierlager bis zum Packplatz – sechs Bereiche mit dem passenden META-Regal.",
    areas: [
      { icon: "grid", title: "Kommissionierlager Kleinteile", text: "Viele Artikel übersichtlich in Griffhöhe; doppelseitige Regale sind von beiden Gängen aus erreichbar.", solution: "CLIP Fachbodenregal · mit Längsriegeln doppelseitig bedienbar", linkLabel: "Fachbodenregale ansehen", linkTarget: "/clip-grundregale" },
      { icon: "package", title: "Packplatz", text: "Arbeitsfläche in 970 mm Höhe mit Ablagen für Kartons und Packmaterial.", solution: "SPEED-RACK Packtisch · 2 oder 4 Ebenen · Fachlast 400 kg", linkLabel: "Packtische ansehen", linkTarget: "Packtisch" },
      { icon: "box", title: "Kartonware und Stapelkästen", text: "Große Kartons und Stapelkästen auf breiten Fachebenen.", solution: "SPEED-RACK Weitspannregal · 1.700 mm Länge für Stapelkästen", linkLabel: "Weitspannregale ansehen", linkTarget: "/speed-rack-komplettregale" },
      { icon: "heavy", title: "Großvolumige Ware", text: "Sperrige und schwere Artikel auf großen Fachflächen.", solution: "MINI-RACK Weitspannregal · 600 kg Fachlast", linkLabel: "MINI-RACK ansehen", linkTarget: "/mini-rack-grundregale" },
      { icon: "pallet", title: "Paletten-Nachschub", text: "Ware auf Europaletten für den Nachschub ins Kommissionierlager.", solution: "MULTIPAL Palettenregal · 9 oder 12 Plätze je Feld", linkLabel: "Palettenregale ansehen", linkTarget: "/multipal-grundregale" },
      { icon: "store", title: "Verkaufsraum und Fachmarkt", text: "Lager- und Präsentationstechnik für den Fachhandel, zum Beispiel Werkzeug- und Sanitärhandel.", solution: "META Fachmarkteinrichtung · als Projekt", linkLabel: "Projekt anfragen", linkTarget: "#beratung" },
    ],
    planning: {
      title: "Fachlast und Packtisch richtig wählen",
      intro: "Für das Kommissionierlager entscheidet die Fachlast: Ab 150 kg sind die CLIP-Fachböden für Fachteiler gelocht. Für den Packplatz gibt es den SPEED-RACK Packtisch in vier Größen.",
      tables: [
        {
          head: ["CLIP-Fachlast", "Fachteiler möglich", "Grundregal 2.000 × 1.000 × 500 mm"],
          rows: [
            ["<b>150 kg</b>", "ja", "{p:4026212281514}"],
            ["<b>230 kg</b>", "ja", "{p:4026212015201}"],
            ["<b>330 kg</b>", "ja", "{p:4026212017526}"],
          ],
          numCols: [2],
          caption: "META CLIP, 5 Ebenen, verzinkt, zzgl. MwSt. 80-kg-Fachböden sind nicht für Fachteiler gelocht. Fachlasten bei gleichmäßig verteilter Last.",
        },
        {
          head: ["SPEED-RACK Packtisch", "Ebenen", "Feldlast", "Preis (netto)"],
          rows: [
            ["<b>970 × 2.000 × 800 mm</b>", "2", "800 kg", "{p:4026212272161}"],
            ["<b>970 × 2.500 × 800 mm</b>", "2", "800 kg", "{p:4026212272178}"],
            ["<b>1.970 × 2.000 × 800 mm</b>", "4", "1.200 kg", "{p:4026212272185}"],
            ["<b>1.970 × 2.500 × 800 mm</b>", "4", "1.200 kg", "{p:4026212272192}"],
          ],
          numCols: [1, 2, 3],
          caption: "Arbeitshöhe 970 mm, Fachlast bis 400 kg (Ablageböden mit 400 mm Tiefe bis 200 kg). Verzinkt, Steckmontage.",
        },
      ],
      example: {
        title: "Beispiel: Packplatz mit Kommissionierzeile",
        sub: "1 Packtisch mit Ablage · 4 Felder CLIP mit Längsriegeln · 400 mm tief · Fachteiler",
        lines: [
          { qty: 1, number: "4026212272185", label: "SPEED-RACK Packtisch 1.970 × 2.000 × 800 mm" },
          { qty: 1, number: "4026212324228", label: "CLIP S3 Grundregal 2.000 × 1.000 × 400 mm, Längsriegel" },
          { qty: 3, number: "4026212328066", label: "CLIP S3 Anbauregal 2.000 × 1.000 × 400 mm, Längsriegel" },
          { qty: 2, number: "4026212434200", label: "Fachteiler freistehend 150 × 400 mm, 10 Stück" },
        ],
        info: "Packtisch und Regale verzinkt, Steckmontage",
        warn: "<b>Kippsicherung:</b> Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 mit Wand- oder Fußverankerung sichern.",
        cta: "Diese Zusammenstellung in den Warenkorb",
      },
    },
    productsTitle: "Bewährte Regale für Lager und Versand",
    products: [
      { number: "4026212324228", use: "Kommissionieren", title: "META CLIP S3 Fachbodenregal mit Längsriegeln", spec: "2.000 × 1.000 × 400 mm · 5 Ebenen · 150 kg" },
      { number: "4026212281866", use: "Kommissionieren", title: "META CLIP Doppel-Anbauregal", spec: "2.000 × 1.000 × 600 mm · 5 Ebenen · 150 kg" },
      { number: "4026212434217", use: "Ordnung", title: "META CLIP Fachteiler freistehend", spec: "150 × 500 mm · verzinkt · 10 Stück" },
      { number: "4026212272185", use: "Packen", title: "META SPEED-RACK Packtisch mit Ablage", spec: "1.970 × 2.000 × 800 mm · 4 Ebenen" },
      { number: "4026212272161", use: "Packen", title: "META SPEED-RACK Packtisch", spec: "970 × 2.000 × 800 mm · 2 Ebenen" },
      { number: "4026212204926", use: "Kartons", title: "META SPEED-RACK Weitspannregal", spec: "1.970 × 1.700 × 600 mm · 500 kg · Stahlpaneele" },
      { number: "4026212057867", use: "Großvolumig", title: "META MINI-RACK Weitspannregal", spec: "2.200 × 2.200 × 800 mm · 600 kg · Stahlpaneele" },
      { number: "4026212334623", use: "Paletten", title: "META MULTIPAL Palettenregal · Grundregal", spec: "3.300 × 2.700 × 1.100 mm · 3 Ebenen · 9 Paletten" },
    ],
    duties: {
      meta: [
        "Lastangaben je Fach und Feld bei gleichmäßig verteilter Last",
        "Wandbefestigungs- und Fußverdübelungs-Sets für CLIP",
        "Bodenanker bei Palettenregalen im Lieferumfang",
        "Montageanleitung; auf Wunsch Montage und Regalinspektion durch META",
      ],
      operator: ["Regale ab Höhe : Tiefe über 4 : 1 mit Wand- oder Fußverankerung sichern", ...OPERATOR_COMMON],
      hint: DUTY_HINT,
    },
    why: WHY_CLIP,
    project: {
      eyebrow: "Wachsendes Lager?",
      title: "Mehr Ebenen, mehr Plätze, mehr Tempo",
      text: "Wenn das Lager wächst, plant META Lagerbühnen, verfahrbare Regalanlagen und mit META-ILS auch Fördertechnik – aufgenommen vor Ort und als CAD-Planung.",
      cta: "Projektanfrage stellen",
      link: { label: "Branchenseite E-Commerce", href: "https://www.meta-online.com/de-DE/loesungen/e-commerce" },
    },
    docs: DOCS_COMMON,
    faqTitle: "Regale für Lager und Versand",
    faq: [
      { q: "Welche Fachlast brauche ich im Kommissionierlager?", a: "Das hängt vom Gewicht je Fachboden ab. META CLIP gibt es mit 80, 150, 200, 230 und 330 kg Fachlast, jeweils bei gleichmäßig verteilter Last. Wer Fachteiler einsetzen will, wählt mindestens 150 kg – die 80-kg-Fachböden sind nicht dafür gelocht." },
      { q: "Was ist der Vorteil von Regalen mit Längsriegeln?", a: "Regale mit Längsriegeln sind doppelseitig bedienbar. Bei Doppelregalen kann Lagergut durchgelagert werden, deshalb eignen sie sich auch für Langgut." },
      { q: "Wie hoch ist die Arbeitsfläche am Packtisch?", a: "Die Arbeitshöhe des SPEED-RACK Packtischs beträgt 970 mm. Die Version mit 1.970 mm Höhe hat zusätzliche Ablageebenen über der Arbeitsfläche." },
      { q: "Welches Regal eignet sich für Stapelkästen?", a: "Das SPEED-RACK Weitspannregal mit 1.700 mm Länge eignet sich besonders für den Einsatz von Stapelkästen." },
      { q: "Lassen sich die Fachböden umstellen, wenn sich das Sortiment ändert?", a: "Ja. Die CLIP-Fachböden sind im 25-mm-Raster höhenverstellbar, die SPEED-RACK-Fachebenen im 50-mm-Raster." },
      FAQ_INSPECTION,
    ],
    advice: { title: "Sie richten ein Lager oder einen Versand ein?", text: "Nennen Sie uns Fläche, Artikelzahl und Versandmenge – wir stellen Regale und Packplatz zusammen und planen bei Bedarf die größere Anlage." },
    notes: {
      facts: { text: "Kennzahlen nur zum abgebildeten CLIP-Regal mit Längsriegeln: beidseitig bedienbar, Fachlasten der Längsriegel-Regale im Shop, Raster und Fachteiler-Lochung.", src: "Katalog S. 19, 23; Shop-Artikel CLIP S3 mit Längsriegeln" },
      nav: { text: "URL /branchen/handel-versand. Ersetzt die Kampagne /metaxecommerce (301): Überschrift E-Commerce, Inhalt Handwerk, zweifelhafte Aussage „MINI-RACK Bereitstellregal mit Rollenbahnen“." },
      hero: { text: "„Made in Germany“ belegt für CLIP, SPEED-RACK, MINI-RACK und MULTIPAL – alle Systeme der Seite. Handel: 61 Firmen, aber ein Online-Händler = 47 % des Umsatzes.", src: "Katalog S. 14, 19, 106, 108; Bestellspiegel Shop DE" },
      areas: { text: "Fachmarkteinrichtung und Beispiele (Werkzeug-/Maschinenhandel, Sanitär-Fachgroßhandel) laut Katalog S. 88 – nicht im Shop, deshalb Projekt. Transport-Stapelkästen gibt es im Shop, aber ohne Produktbild.", src: "Katalog S. 19, 23, 88, 106, 108, 177", checks: ["Produktbilder für Transport-Stapelkästen fehlen im Shop"] },
      planning: { text: "Fachteiler-Lochung im 50-mm-Raster außer bei 80-kg-Böden (Katalog S. 19). Packtisch-Werte aus S. 108. Das Beispiel hat keine Kennzahl je Stellplatz, weil Packplatz und Lager gemischt sind.", src: "Katalog S. 19, 21, 108", checks: ["200-kg-Fachböden im Shop für 2.000 × 1.000 × 500 mm nicht vorhanden – Tabelle ohne 200 kg"] },
      products: { text: "Packtisch in zwei Größen, weil Packplätze ohne und mit Ablage gefragt sind.", src: "Live-Shop 15.10.2026" },
      duties: NOTE_DUTIES,
      why: NOTE_WHY,
      project: { text: "Bühnen, MULTIBLOC und META-ILS laut Katalog S. 5, 182–199; E-Commerce-Seite der Unternehmensseite als Projekt-Brücke.", src: "Katalog S. 5, 11; meta-online.com" },
      faq: { text: "Antworten nur mit Katalogwerten.", src: "Katalog S. 19, 21, 23, 106, 108" },
      advice: { text: "Gleicher Beratungskasten wie auf allen Branchenseiten." },
    },
  },
];

/** Platzhalter {p:<Artikelnummer>} durch formatierten Netto-Preis ersetzen. */
export function fillPrices(text: string, priceOf: (number: string) => number | undefined): string {
  return text.replace(/\{p:([0-9A-Z-]+)\}/g, (_m, num: string) => {
    const p = priceOf(num);
    if (p === undefined) throw new Error(`Preis fehlt für Artikel ${num}`);
    return formatEuro(p);
  });
}

/** Netto-Preis deutsch formatiert; `cents` erzwingt zwei Nachkommastellen (Beispielrechnungen). */
export function formatEuro(value: number, cents = false): string {
  const digits = cents || value % 1 !== 0 ? 2 : 0;
  return `${value.toLocaleString("de-DE", { minimumFractionDigits: digits, maximumFractionDigits: digits })} €`;
}

/** Alle Artikelnummern, die eine Seite braucht (Produkte, Held, Tabellen, Beispiel). */
export function referencedNumbers(page: IndustryPage): string[] {
  const nums = new Set<string>([page.hero.number, ...page.products.map((p) => p.number)]);
  for (const t of page.planning.tables) for (const r of t.rows) for (const c of r) for (const m of c.matchAll(/\{p:([0-9A-Z-]+)\}/g)) nums.add(m[1]);
  for (const l of page.planning.example?.lines ?? []) nums.add(l.number);
  return [...nums];
}
