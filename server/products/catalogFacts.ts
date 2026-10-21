// Belegte Aussagen aus dem META-Bestellkatalog „Lagersysteme“ (01_-_META_Bestellkatalog.pdf, Stand 10/2026)
// als zweite Faktenquelle fuer Kategorie- und Landingpage-Texte (User 15.10.2026: Katalog als Faktenquelle).
// Jede Aussage ist am Katalogtext geprueft, Seitenzahl dabei. Nur Systeminformationen, keine
// Bestelldaten (SAP-Nummern, Preise, Lieferzeiten) und nichts fuer Haendler (Portal, Schulungen).
// Katalogwerte beschreiben das META-System; das Shop-Sortiment kann kleiner sein.

export type CatalogFact = { text: string; page: number };
export type CatalogSystem = {
  key: string;
  label: string;
  match: RegExp;
  facts: CatalogFact[];
  /** Systemwerte laut Katalog (Bemaßungsvarianten, Lasten) fuer Masstabelle und Kennzahlen; Seite in page */
  spans?: { page: number; rows: Array<[string, string]> };
  /** Shop-Eigenschaften, die dem Katalog widersprechen und deshalb nicht als Fakt gelten (z. B. "Aufbauart: Schraubregal" bei eingehaengten Holmen) */
  ignoreShopFeatures?: string[];
};

export const CATALOG_SOURCE = "META Bestellkatalog Lagersysteme";

/** Gilt fuer alle META-Regalsysteme. */
export const GENERAL_CATALOG_FACTS: CatalogFact[] = [
  { text: "Die Regale sind für eine reine Innenaufstellung konzipiert.", page: 17 },
  { text: "Regale unterliegen nach § 14 Betriebssicherheitsverordnung der Prüfpflicht; Inspektionen sind im Abstand von höchstens 12 Monaten durch eine fachkundige Person durchzuführen.", page: 16 },
  { text: "Fach- und Feldlasten gelten bei gleichmäßig verteilter Last.", page: 25 },
  { text: "Die Regale werden grundsätzlich zerlegt angeliefert.", page: 17 },
  { text: "Wer die Regale nicht selbst durch fachkundiges Personal aufbauen kann, kann den META-Montageservice nutzen: Geschulte Montageteams installieren die Lagereinrichtung.", page: 11 },
];

/**
 * META-Sicherheitshinweise (Heft 9900006907, Stand 02.2024, liegt jeder Lieferung bei) – Teil Deutsch, S. 2–3.
 * Das Heft nennt noch die DGUV Regel 108-007; die ist zurückgezogen (ersetzt durch DGUV Information 208-061)
 * und wird deshalb nicht übernommen.
 */
export const SAFETY_SOURCE = "META Sicherheitshinweise 02.2024";
export const SAFETY_FACTS: CatalogFact[] = [
  { text: "Montage-, Inspektions- und Demontagearbeiten nur durch Personal, das mit dem Produkt, den Sicherheitshinweisen und den Unfallverhütungsvorschriften vertraut ist.", page: 2 },
  { text: "Vor der Montage den Lieferumfang anhand des Lieferscheins auf Vollständigkeit prüfen.", page: 2 },
  { text: "Während der Montage auf die Kippgefahr des Regals und einzelner Elemente achten und sie vor dem nächsten Arbeitsschritt sichern.", page: 2 },
  { text: "Das Regal erst nach vollständig abgeschlossener Montage und Sicherung beladen.", page: 2 },
  { text: "Regale gut sichtbar mit dem entsprechenden Typenschild kennzeichnen.", page: 2 },
  { text: "Regal und Bauteile wie Fachböden, Holme oder Rahmen niemals besteigen.", page: 3 },
  { text: "Beim Beladen auf gleichmäßige Lastverteilung achten, Stoß-, Anprall- und Schiebelasten vermeiden und die Fach- und Feldlasten nie überschreiten.", page: 3 },
  { text: "Beschädigte oder verformte Bauteile sofort ersetzen.", page: 3 },
  { text: "Umbauen oder Umstellen nur in unbeladenem Zustand und nach Rücksprache mit META.", page: 3 },
  { text: "Neben der Inspektion durch eine Fachkraft mindestens alle 12 Monate sind wöchentliche Sichtprüfungen durchzuführen.", page: 3 },
];

export const CATALOG_SYSTEMS: CatalogSystem[] = [
  {
    key: "clip",
    label: "META CLIP Fachbodenregale",
    // nicht COMPACT (eigenes System im Katalog), nicht die Laendervarianten anderer Systeme
    match: /^(?!.*COMPACT).*(\bCLIP\b|Fachboden)/i,
    spans: {
      page: 21,
      rows: [
        ["Höhen", "1.500 bis 3.000 mm (1.000 und 3.500 bis 4.500 mm auf Anfrage)"],
        ["Fachbodenlängen", "750, 1.000, 1.250, 1.300, 1.500, 1.700 mm"],
        ["Tiefen", "300, 400, 500, 600, 800 mm"],
        ["Fachlasten", "80, 150, 200, 230, 330 kg"],
        ["Feldlast", "bis 4.400 kg"],
        ["Rahmen", "zerlegt (S3) oder vorgefertigt (geclincht)"],
        ["Oberflächen", "verzinkt oder RAL 7035 lichtgrau"],
        ["Verstellraster", "25 mm"],
      ],
    },
    facts: [
      { text: "META CLIP ist ein Fachbodenregalsystem aus zwei Systembausteinen (Rahmen und Fachböden) für alle Anwendungen der Kleinteilelagerung, z. B. Ersatzteilmagazine in Industrie und Handwerk.", page: 19 },
      { text: "Steckmontage ohne Werkzeug.", page: 19 },
      { text: "Fachböden im Raster von 25 mm höhenverstellbar; Fachböden im 50-mm-Raster gelocht zur Aufnahme von Fachteilern oder Trenngittern (Ausnahme: 80-kg-Fachböden).", page: 19 },
      { text: "Zwei Rahmenvarianten: zerlegter S3-Rahmen, der ohne Werkzeug zusammengesteckt wird, und vorgefertigter, maschinell geclinchter Rahmen, der fertig montiert geliefert wird.", page: 28 },
      { text: "Geclinchte Rahmen tragen bis zu über 70 % mehr als zerlegte Rahmen; beim Steckregal mit Diagonalverstrebung Feldlasten bis 1.650 kg mit S3-Rahmen und bis 2.400 kg mit geclinchten Rahmen.", page: 29 },
      { text: "Durch das CLIP-EASY-Verfahren ist ein falsches Zusammenstecken nicht möglich.", page: 28 },
      { text: "Systemspanne: Standardhöhen 1.500 bis 3.000 mm (1.000 sowie 3.500 bis 4.500 mm auf Anfrage), Fachbodenlängen 750 bis 1.700 mm, Tiefen 300 bis 800 mm, Fachlasten 80, 150, 200, 230 und 330 kg, Feldlast bis 4.400 kg.", page: 21 },
      { text: "Regale mit Diagonalverstrebung sind einseitig bedienbar und ideal zur Aufstellung an Wänden; Ausrichtung mit Spannschlössern an den Diagonalverstrebungen.", page: 23 },
      { text: "Regale mit Längsriegeln sind doppelseitig bedienbar; Lagergut kann bei Doppelregalen durchgelagert werden, daher auch für Langgut geeignet. Längsriegel gibt es mit zerlegten S3-Rahmen.", page: 23 },
      { text: "Doppelzeilige Regale: beide Zeilen rückseitig fest verbunden, Zugriff von beiden Seiten, Aufbau Rückseite an Rückseite.", page: 29 },
      { text: "Großfachregal mit 1.500 oder 1.700 mm Fachlänge für großvolumiges Lagergut und die liegende Lagerung langer, sperriger Waren, mit zerlegten S3-Rahmen.", page: 42 },
      { text: "Oberflächen: sendzimirverzinkt oder zusätzlich kunststoffbeschichtet RAL 7035 lichtgrau; bei zerlegten S3-Rahmen sind die Tiefensteifen immer verzinkt.", page: 25 },
      { text: "Fachboden-Kantenhöhe 40 mm; Abdeckboden höchstens 200 kg.", page: 25 },
      { text: "Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 mit Wand- oder Fußverankerung gegen Kippen sichern; Feldlastangaben gelten für Regalzeilen mit 3 und mehr Feldern; Reifenregale und Regale mit Schubladen immer mit Fußverankerung sichern; nur für Handbedienung.", page: 25 },
      { text: "Schranktüren und Schubladen sind nicht durch das GS-Zeichen abgedeckt.", page: 14 },
      { text: "Planmaße einzeilig: Grundregal Nennlänge + 56 mm, Anbauregal Nennlänge + 6 mm, Tiefe Nenntiefe + 36 mm; doppelzeilig Tiefe 2 x Nenntiefe + 75 mm.", page: 25 },
      { text: "Außenmaß an den Fußplatten in Längsrichtung: Grundregal Nennlänge + 82 mm, Anbauregal Nennlänge + 41 mm; Nennlänge = Fachbodenlänge, Nenntiefe = Fachbodentiefe.", page: 26 },
      { text: "Wandbefestigungssets und Fußverdübelungssets gibt es jeweils für Grundregal und Anbauregal.", page: 81 },
      { text: "Die Rammschutzwand (300 mm hoch, inklusive Bodenanker) schützt die stirnseitigen Rahmen und ist nachrüstbar.", page: 81 },
    ],
  },
  {
    key: "compact",
    label: "META COMPACT Büroregale",
    match: /COMPACT|Büro/i,
    spans: {
      page: 99,
      rows: [
        ["Höhen", "1.850, 2.200, 2.500 mm"],
        ["Längen", "750, 1.000, 1.250 mm"],
        ["Tiefen", "300, 600 mm"],
        ["Fachlasten", "80 bis 100 kg"],
        ["Ordnerkapazität (300 mm tief)", "45 bis 105 Ordner"],
        ["Oberflächen", "verzinkt oder RAL 7035 lichtgrau"],
        ["Verstellraster", "25 mm"],
      ],
    },
    facts: [
      { text: "META COMPACT ist ein Büro-Steckregal für Büro, Meisterbüro und Archiv; Steckmontage ohne Werkzeug.", page: 99 },
      { text: "Höhen 1.850, 2.200 und 2.500 mm, Längen 750, 1.000 und 1.250 mm, Tiefen 300 und 600 mm.", page: 99 },
      { text: "Fachlast 80 kg; bei 1.250 x 600 mm 100 kg (mit Mittelanschlag).", page: 100 },
      { text: "Verzinkt mit zerlegten S3-Rahmen oder RAL 7035 lichtgrau mit vorgefertigten (geclinchten) Rahmen.", page: 100 },
      { text: "Fachböden mit End- und Mittelanschlag (Abdeckboden ohne), im 25-mm-Raster verstellbar; dübelfähige Stahlfüße.", page: 100 },
      { text: "Einseitige Regale werden durch Diagonalstreben an der Rückseite ausgesteift, doppelseitige Regale durch Längsriegel.", page: 101 },
      { text: "Ordnerkapazität bei 300 mm Tiefe: 45, 60 oder 75 Ordner bei 1.850 mm Höhe (5 Böden), 54, 72 oder 90 bei 2.200 mm (6 Böden) und 63, 84 oder 105 bei 2.500 mm (7 Böden), jeweils für 750, 1.000 oder 1.250 mm Länge; bei 600 mm Tiefe doppelt so viele.", page: 101 },
      { text: "Das einseitige Regal muss gegen Kippen gesichert werden, da die Regalhöhe mehr als das 4-Fache der Regaltiefe beträgt; Wandbefestigungs- und Fußverdübelungssets sind erhältlich.", page: 100 },
      { text: "Fach- und Feldlasten gelten bei gleichmäßig verteilter Last und mindestens 3 Feldern; nur für Handbedienung.", page: 100 },
      { text: "Grundregal: 2 Rahmen mit Stahlfüßen, Fachböden und Montagezubehör; Anbauregal mit 1 Rahmen.", page: 100 },
      { text: "Planmaße: Grundregal Nennlänge + 56 mm, Anbauregal Nennlänge + 6 mm, Tiefe Nenntiefe + 36 mm.", page: 100 },
    ],
  },
  {
    key: "multipal",
    label: "META MULTIPAL Palettenregale",
    match: /MULTIPAL|Paletten/i,
    spans: {
      page: 123,
      rows: [
        ["Höhen (Ständerrahmen)", "2.200 bis 12.000 mm verzinkt, bis 6.000 mm in RAL 5010"],
        ["Holmlängen", "1.825, 2.225, 2.700, 3.300, 3.600 mm"],
        ["Tiefen", "800, 1.100 mm"],
        ["Fachlast", "bis 5,5 t"],
        ["Feldlast", "bis 25 t"],
        ["Lagerebenen", "Holme im 50-mm-Raster frei einhängbar"],
        ["Oberflächen", "Ständer verzinkt oder RAL 5010, Holme RAL 2001"],
        ["Andere Abmessungen", "auf Anfrage"],
      ],
    },
    facts: [
      { text: "META MULTIPAL ist ein Palettenregalsystem für die Paletten- und Stückgutlagerung; Längs- und Quereinlagerung möglich.", page: 121 },
      { text: "Die Holme im Kastenprofil werden mit der 4-Haken-Agraffe im 50-mm-Raster höhenverstellbar eingehängt und mit Sicherungsstiften gesichert.", page: 121 },
      { text: "Ständerrahmen aus kaltverformten Profilen mit verschraubter Ausfachung (diagonale und horizontale C-Profile); die Ständerrahmen werden zerlegt geliefert.", page: 121 },
      { text: "Gütegesichert nach RAL-RG 614/2 mit GS-Zeichen; statische Nachweisführung nach DIN EN 15512:2021; die DIBt-Zulassung erlaubt die Verwendung im Sinne der Landesbauordnungen.", page: 121 },
      { text: "Systemspanne: Ständerrahmenhöhen verzinkt 2.200 bis 12.000 mm, Tiefen 800 und 1.100 mm, Holmlängen bis 3.600 mm, Einzel-Fachlasten bis 5,5 t, Feldlasten bis 25 t.", page: 123 },
      { text: "Oberflächen: Ständerprofile verzinkt oder RAL 5010 enzianblau, Ausfachung verzinkt, Holme RAL 2001 rotorange.", page: 123 },
      { text: "Die Fach- und Feldlasten gelten für Regalzeilen mit mindestens 4 Regalfeldern und mindestens 2 Holmpaaren; bei weniger als 4 Feldern werden die Belastungswerte abgemindert.", page: 125 },
      { text: "Grundregal mit 2 Ständerrahmen inklusive Bodenanker, Anbauregal mit 1 Ständerrahmen inklusive Bodenanker.", page: 130 },
      { text: "Für Europaletten (1.200 x 800 mm): bei 2.700 mm Feldlänge 9 Palettenplätze mit 3 Lagerebenen oder 12 mit 4 Lagerebenen, bei 1.825 mm Feldlänge 6 oder 8 – jeweils inklusive Bodenlagerebene.", page: 131 },
      { text: "Palettenregale werden auf Beton der Mindestgüte C20/25 (ca. 200 mm stark) aufgestellt und zur Lage- und Kippsicherung mit Ankern fixiert.", page: 135 },
      { text: "Äußere Ständer im Eckbereich und an Durchfahrten sind mit Rammschutzecken gegen Anprall zu schützen; nicht zur Be- und Entladung vorgesehene Seiten müssen gegen Herabfallen von Lagergut gesichert sein.", page: 135 },
      { text: "Gitterboxpaletten lassen sich wegen ihrer Winkelfüße nur schlecht direkt einlagern; Winkelauflagen führen die Füße sicher auf die Holme.", page: 210 },
      { text: "Lastangaben dienen der Orientierung und ersetzen keine statische Auslegung im Einzelfall.", page: 135 },
      { text: "Permanente Werksprüfung nach DIN EN ISO 9001; Qualitätsmerkmale entsprechend DGUV Information 208-061.", page: 125 },
      { text: "Planmaße: Grundregal Nennlänge + 170 mm (Ständer 85/20), + 200 mm (100/20) bzw. + 240 mm (120/20 und 120/25); Anbauregal Nennlänge + 85, + 100 bzw. + 120 mm; Gesamttiefe = Rahmentiefe.", page: 128 },
      { text: "Planungsweg: erforderliche Fachlast ermitteln, Fachhöhe und Anzahl Ebenen festlegen, nutzbare Fachlast aus der Tabelle wählen, Holm-/Ständerkombination ablesen, Artikel auswählen.", page: 128 },
      { text: "Ladungsmaße können die Nennmaße überschreiten; Hubhöhe des Bediengeräts = Oberkante oberster Holm plus 200 mm; stirnseitige Rahmen mindestens 500 mm höher als die oberste Ablage wählen.", page: 128 },
      { text: "Längseinlagerung von Europaletten: 1.200 mm Palettentiefe auf 1.100 mm tiefem Rahmen, 50 mm Überstand je Seite; 3 Paletten à 800 mm nebeneinander.", page: 128 },
      { text: "Für die Quereinlagerung von Europaletten sind Tiefenauflagen erforderlich (Tragkraft je Paar 1.100 bzw. 1.500 kg).", page: 143 },
      { text: "Stahlpaneel-Böden sind für Kartonware und Kleingebinde gedacht, nicht für Palettenlagerung und Staplerbedienung.", page: 143 },
      { text: "Ständerrahmen werden zerlegt und inklusive 4 Bodenanker geliefert; pro Holm müssen zwei Sicherungsstifte eingesetzt werden.", page: 134 },
      { text: "Maßgebend ist der kleinere Wert aus Fach- und Feldlast; vorausgesetzt werden gleichmäßige Lastverteilung und gleichmäßige Bauweise.", page: 132 },
      { text: "Palettenregale sind generell mit 2 Ankern pro Fußplatte zu sichern.", page: 211 },
      { text: "An Verkehrswegen und Arbeitsbereichen sind Regale nach DGUV Information 208-061 mit Rückwandgittern gegen das Herabfallen von Lagergut zu sichern.", page: 136 },
    ],
    ignoreShopFeatures: ["Aufbauart"], // Holme eingehaengt, Rahmen verschraubt – kein reines Schraubregal
  },
  {
    key: "multistrong",
    label: "META MULTISTRONG Kragarmregale",
    match: /MULTISTRONG|Kragarm/i,
    spans: {
      page: 158,
      rows: [
        ["Höhen", "2.000, 2.500, 3.000 mm"],
        ["Achsmaße", "1.030, 1.330 mm"],
        ["Kragarmtiefen", "LIGHT 400 bis 600 mm, MEDIUM 400 bis 800 mm"],
        ["Armlast", "LIGHT bis 220 kg, MEDIUM bis 535 kg"],
        ["Ständerlast", "LIGHT bis 1.750 kg (doppelseitig 3.500 kg), MEDIUM bis 2.880 kg (doppelseitig 5.760 kg)"],
        ["Verstellraster Kragarme", "100 mm"],
      ],
    },
    facts: [
      { text: "META MULTISTRONG für die liegende Langgutlagerung sowie Tafel- und Plattenware, als LIGHT für leichte und MEDIUM für mittlere Belastungen; im Shop als MULTISTRONG L und M bezeichnet.", page: 162 },
      { text: "MULTISTRONG LIGHT: Ständer IPE 120, Kragarm-Querschnitt 40 x 30 mm, Höhen 2.000, 2.500 und 3.000 mm, Achsmaße 1.030 und 1.330 mm, Kragarmtiefen 400, 500 und 600 mm, Kragarmbelastung bis 220 kg, Ständerlast einseitig bis 1.750 kg, doppelseitig bis 3.500 kg.", page: 158 },
      { text: "MULTISTRONG MEDIUM: Ständer IPE 140, Kragarm-Querschnitt 70 x 30 mm, Höhen 2.000, 2.500 und 3.000 mm, Achsmaße 1.030 und 1.330 mm, Kragarmtiefen 400 bis 800 mm, Kragarmbelastung bis 535 kg, Ständerlast einseitig bis 2.880 kg, doppelseitig bis 5.760 kg.", page: 159 },
      { text: "Die Armlast sinkt mit der Armlänge: LIGHT 220, 175 und 140 kg bei 400, 500 und 600 mm; MEDIUM 535, 430, 355 und 250 kg bei 400, 500, 600 und 800 mm.", page: 163 },
      { text: "Eingesteckte Kragarme mit Feststellschraube, im Raster von 100 mm jederzeit höhenverstellbar; eine Aushebesicherung sichert die Kragarme gegen unbeabsichtigtes Ausheben beim Ein- und Auslagern.", page: 160 },
      { text: "Durch Anziehen der Stellschraube erhalten die Kragarme eine gleichmäßige Vorneigung, Rundmaterial rollt so Richtung Ständer.", page: 160 },
      { text: "Ständerprofile beidseitig gelocht für den nachträglichen Umbau von einseitig zu doppelseitig – nur das Fußteil wird getauscht.", page: 158 },
      { text: "Die Fußlagerebene ist wie ein Kragarm belastbar (Fußlast = Armlast); Ausfachung in jedem Feld nach der Grundregal/Anbauregal-Systematik.", page: 158 },
      { text: "Abrolldorne werden in die Kragarme gesteckt; bei Rundmaterial verhindern sie ein unbeabsichtigtes Herausrollen.", page: 161 },
      { text: "Wenn das Höhen-/Tiefenverhältnis über 4 : 1 liegt oder die betrieblichen Bedingungen es erfordern, sind Fußverankerungen zu verwenden; nur für Handbedienung.", page: 162 },
      { text: "Gütesicherung RAL-RG 614/5 für Kragarmregale LIGHT und MEDIUM.", page: 14 },
      { text: "Länge Grundregal: LIGHT Achsmaß + 64 mm, MEDIUM Achsmaß + 73 mm; Tiefe einseitig Nenntiefe + 210 mm (LIGHT) bzw. + 230 mm (MEDIUM).", page: 162 },
      { text: "Fachböden erhöhen die Tragkraft der Kragarme nicht.", page: 168 },
      { text: "Abrolldorne sind bei der Einlagerung von Rundmaterial Vorschrift (DGUV Information 208-061).", page: 210 },
    ],
    ignoreShopFeatures: ["Aufbauart"], // Kragarme eingesteckt mit Feststellschraube
  },
  {
    key: "atlas",
    label: "META ATLAS ST Kragarmregale",
    match: /ATLAS|Kragarm/i,
    spans: {
      page: 156,
      rows: [
        ["Höhen", "2.000 mm"],
        ["Achsmaße", "1.350 mm"],
        ["Kragarmtiefen", "500 mm je Seite"],
        ["Armlast", "200 kg"],
        ["Regallängen", "2.700 bis 6.750 mm (2 bis 5 Felder)"],
      ],
    },
    facts: [
      { text: "META ATLAS ST für die liegende Lagerung langer Ware: geschweißte Kragarmständer aus warm- und kaltgewalzten Stahlprofilen, Kragarme mit gleicher Armlänge, für leichte Belastungen, Tragkraft 200 kg pro Arm.", page: 156 },
      { text: "ATLAS ST: Höhe 2.000 mm, Nutztiefe der Arme 500 mm je Seite, Achsmaß 1.350 mm, ein- und doppelseitig, RAL 5010 enzianblau, nur für Handbedienung.", page: 156 },
    ],
    ignoreShopFeatures: ["Aufbauart"], // geschweisste Kragarmstaender
  },
  {
    key: "speedrack",
    label: "META SPEED-RACK Weitspannregale",
    match: /SPEED-?RACK|Weitspann/i,
    spans: {
      page: 104,
      rows: [
        ["Höhen", "1.970, 2.470, 2.970 mm"],
        ["Fachlängen", "1.700, 2.000, 2.500 mm"],
        ["Tiefen", "400, 600, 800 mm"],
        ["Fachlast", "bis 500 kg (bei 2.500 mm Länge 400 kg)"],
        ["Feldlast", "bis 3.000 kg"],
        ["Bauweise", "Komplettregal, gesteckt"],
      ],
    },
    facts: [
      { text: "META SPEED-RACK: konstruktiv einfaches Weitspannregal mit Winkelprofilen, Aufbau durch Steckmontage, nur in Grundregalbauweise als Komplettregal; Nennmaße = Istmaße.", page: 106 },
      { text: "SPEED-RACK: Höhen 1.970, 2.470 und 2.970 mm, Tiefen 400, 600 und 800 mm, Fachlängen 1.700, 2.000 und 2.500 mm; Fachlast bis 500 kg, bei 2.500 mm Länge 400 kg; Feldlast bis 3.000 kg, bei 2.500 mm Länge 2.800 kg.", page: 106 },
      { text: "SPEED-RACK: umlaufender Kantenschutz der Böden durch Versenkung im Stufenholm, zwei Unterzüge je Fachebene, Böden aus 19-mm-Spanplatte oder Stahlpaneel, Profile und Holme verzinkt.", page: 106 },
      { text: "Die SPEED-RACK-Länge 1.700 mm eignet sich besonders für Stapelkästen.", page: 106 },
      { text: "Fachebenen im Raster von 50 mm höhenverstellbar; SPEED-RACK nur für Handbedienung; Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 gegen Kippen sichern.", page: 106 },
      { text: "Mehrere SPEED-RACK-Regale werden mit Profilverbindern verbunden; Verdübelungsset 4 Stück je Regal.", page: 109 },
    ],
  },
  {
    key: "minirack",
    label: "META MINI-RACK Weitspannregale",
    match: /MINI-?RACK|Weitspann/i,
    spans: {
      page: 111,
      rows: [
        ["Höhen", "2.200, 2.500, 3.000 mm"],
        ["Fachlängen", "1.400, 1.800, 2.200, 2.600 mm"],
        ["Tiefen", "650, 800, 1.050 mm"],
        ["Fachlast", "bis 600 kg (bei 2.600 mm Länge 490 kg)"],
        ["Feldlast", "bis 4.600 kg"],
        ["Bauweise", "Grund- und Anbauregal, verschraubte Rahmen"],
      ],
    },
    facts: [
      { text: "META MINI-RACK: Weitspannregal für großes und schweres Einzelgut, Einlagerung liegend oder stehend; die Rahmen werden aus Stützenprofilen, diagonalen und horizontalen Profilen und Fußplatten verschraubt.", page: 111 },
      { text: "MINI-RACK: Höhen 2.200, 2.500 und 3.000 mm, Tiefen 650, 800 und 1.050 mm, Fachlängen 1.400, 1.800, 2.200 und 2.600 mm; Fachlast 600 kg bei 1.400 bis 2.200 mm Länge, 490 kg bei 2.600 mm.", page: 114 },
      { text: "MINI-RACK: Böden aus Spanplatte natur oder Stahlpaneel, Stufenholme im 200-mm-Raster gelocht für Trennbügel, Oberfläche sendzimirverzinkt.", page: 114 },
      { text: "MINI-RACK: Fach- und Feldlasten gelten ab Regalzeilen mit 4 und mehr Feldern; pro Rahmen werden 2 Bodenanker benötigt; Regale mit einem Höhen-/Tiefenverhältnis über 4 : 1 gegen Kippen sichern; nur für Handbedienung.", page: 114 },
      { text: "MINI-RACK Planmaße: Grundregal = Nennlänge + 107 mm, Anbauregal = Nennlänge + 51 mm.", page: 114 },
      { text: "MINI-RACK Grundregal: 2 Rahmen (zerlegt), 3 Einlegeböden, Montagezubehör; Anbauregal mit 1 Rahmen.", page: 112 },
      { text: "MINI-RACK Stufenholme sind 70 mm hoch, haben eine 19 mm hohe Stufe für die Einlegeböden und kommen mit Sicherungsstiften; Unterzüge werden in die Holmpaare eingeschoben und haben eine statische Funktion.", page: 118 },
      { text: "Bei MINI-RACK-Doppelzeilen werden 100 mm lange Distanzstücke eingebaut.", page: 118 },
    ],
  },
];

/** Systeme mit Systemwerten fuer eine Kategorie/Landingpage. */
export function catalogSystemsFor(name: string): CatalogSystem[] {
  return CATALOG_SYSTEMS.filter((s) => s.match.test(name));
}

/** Shop-Eigenschaften, die fuer diese Kategorie/Landingpage nicht als Fakt gelten. */
export function ignoredShopFeaturesFor(name: string): Set<string> {
  return new Set(CATALOG_SYSTEMS.filter((s) => s.match.test(name)).flatMap((s) => s.ignoreShopFeatures ?? []));
}

/** Katalogaussagen fuer eine Kategorie/Landingpage (Name entscheidet). Leer, wenn kein System passt. */
export function catalogFactsFor(name: string): Array<CatalogFact & { system: string }> {
  const systems = CATALOG_SYSTEMS.filter((s) => s.match.test(name));
  if (systems.length === 0) return [];
  return [...systems.flatMap((s) => s.facts.map((f) => ({ ...f, system: s.label }))), ...GENERAL_CATALOG_FACTS.map((f) => ({ ...f, system: "alle META-Regale" }))];
}
