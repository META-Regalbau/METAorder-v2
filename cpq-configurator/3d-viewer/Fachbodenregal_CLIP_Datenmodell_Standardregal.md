# Fachbodenregal CLIP – Datenmodell & Business Rules (Standardregal)

Stand: konsolidiert aus META-Sicherheitshinweise (00), META CLIP Systemkomponenten (01, S. 1–160) und dem interaktiven Geometrie-Dummy. Zubehör (Rückwände, Kragarme, Compact/Clip-Schranktüren, Schubladen etc.) ist **bewusst ausgeklammert** und folgt in einem zweiten Schritt.

---

## 1. Produktstruktur

Ein Regal besteht aus einer **Zeile** (Row) von einem oder mehreren **Feldern** (Bays):

- **Grundfeld** – erstes Feld, hat zwei eigene Ständerpaare (4 Ständer gesamt für ein einfeldriges Regal).
- **Anbaufeld** – jedes weitere Feld teilt sich einen Ständer mit dem Nachbarfeld (Rahmen-Sharing möglich, siehe Dummy-Option „sharedFrame").

Jedes Feld hat:
- eine Breite `fieldWidth` (Nennbreite, z. B. 1000 mm),
- eine Tiefe (Regal-Tiefe, i. d. R. für die ganze Zeile einheitlich),
- eine Anzahl Ebenen `levels`,
- pro Ebene einen Fachboden-Typ mit Nennmaß und Dicke.

**Wichtig fürs Datenmodell:** Ein Fachboden ist nicht nur durch Breite × Tiefe definiert, sondern durch **Breite × Tiefe × Verstärkungstyp** – siehe Abschnitt 3. Gleiche Nennmaße können unterschiedliche Traglasten haben, je nachdem welche Aussteifungsschiene(n) verbaut sind.

---

## 2. Geometrie & Formeln (Ständer, Böden, Raster)

| Parameter | Wert | Quelle |
|---|---|---|
| Ständer-/T-Strich-Breite | 50 mm | User + Dummy |
| T-Strich-Tiefe (außerhalb Boden) | 5 mm | User-Korrektur |
| Steg-Breite (zwischen/unter Böden) | 5 mm | User-Korrektur |
| Steg-Tiefe (zwischen/unter Böden) | 45 mm | User-Korrektur |
| Kappe oben | 2 mm, macht obersten Boden bündig | User, jetzt auch dimensional bestätigt |
| Fuß (Nivellierfuß, separates Zubehörteil) | 2 mm hoch | User – **nicht** identisch mit der Fußplatte, die im Ständerrahmen-GLB enthalten ist (siehe 2.1) |
| Lochraster (Höhe) | 25 mm | User, bestätigt in Zubehör-PDF (mehrfach referenziert, z. B. S. 94–96, 152) |
| Einhängehöhe unterster Boden | 100 mm ab Boden | User |
| Formel Feldtiefe ↔ Fachbodentiefe | d1 = Fd + 45 mm (bei korrektem CLIP-Bügel) | Systemkomponenten S. 1–80, **jetzt zusätzlich an zwei realen GLBs bestätigt** (siehe 2.1) |
| H:d-Kippsicherheits-Regel | H : d ≥ 4 : 1, sonst Bodenanker/Wandhalter (P/E) Pflicht | Systemkomponenten S. 92–93, 114, 132 |

Das T-Profil sitzt so, dass der breite T-Strich (50×5 mm) **außerhalb** der Bodenkante liegt (Vorder-/Rückseite), der schmale Steg (5×45 mm) **unter/zwischen** den Böden – siehe Dummy, korrigiert nach Nutzer-Feedback.

**Offener Punkt:** Die technische Ständer-/T-Profil-Zeichnung selbst wurde in den gelesenen 160 Seiten nicht als eigener Bauteil-Anhang gefunden – die obigen Maße stammen aus deiner verbalen Beschreibung. Aus einem echten GLB eines Ständerrahmens gemessen ergibt sich für die reine Profiltiefe (T-Strich+Steg zusammen) ca. 39,6 mm statt der rechnerisch erwarteten 50 mm (5+45 mm) – Ursache noch nicht geklärt (Biegeradien vs. abweichende Aufteilung). Bleibt offen, siehe Abschnitt 9.

### 2.1 Validierung an echten META-GLB-Bauteilen

Am 29.07. wurden zwei reale, Draco-komprimierte GLB-Bauteile ausgewertet (Ständerrahmen + passender Fachboden), direkt aus der glTF-Struktur (Bounding Box je Mesh/Node), nicht nur geschätzt:

| Bauteil | Gemessene Maße | Abgleich |
|---|---|---|
| **Ständerrahmen H≈2000** (2 Ständer + Diagonalen + Fußplatten + Kopfstücke) | Gesamt-BBox 76 × 2002 × 545 mm (B×H×T); Ständerprofil selbst 50,0 × 1994,0 × 39,6 mm je Ständer; **2 feste Diagonalstreben** (unten ~Y 175–324 mm, oben ~Y 1675–1824 mm) | Ständerbreite 50 mm ✅ bestätigt; Rahmentiefe 545 mm = Fd(500) + 45 mm ✅ Formel bestätigt |
| **Ständerrahmen H≈2500** (29.07., zweites GLB) | Gesamt-BBox 76 × 2501,5 × 545 mm (B×H×T); Ständerprofil 50,0 × 2494,0 × 39,5 mm je Ständer; **3 feste Diagonalstreben** (Y-Mitte ≈ 249 / 999 / 2249 mm) | Ständerbreite 50 mm ✅, Rahmentiefe 545 mm ✅ identisch zum H≈2000-Rahmen (gleiche Fd-Klasse 500 mm) – nur Höhe und Diagonalstreben-Anzahl unterscheiden sich |
| **Fachboden** (Name im GLB: „…MS150_1") | 1000,0 × 500,0 × 42,25 mm (FL × Fd × Profilhöhe) | FL/Fd passen exakt zum obigen Rahmen; Typ „MS150" bestätigt Zuordnung zur Traglast-Tabelle in 3.2 (150 kg bei FL×Fd 1000×500) |

**Neuer Fund – feste Diagonalstreben im Rahmen, jetzt bestätigt als Standard:** Beide Ständerrahmen (H≈2000 und H≈2500) enthalten werksseitig feste, kurze Diagonalstreben – der H≈2000-Rahmen hat 2 Stück, der H≈2500-Rahmen hat 3 Stück. Das bestätigt: **die Grundaussteifung ist Teil jedes Standardrahmens**, unabhängig von der konkreten Höhe, und die Anzahl skaliert mit der Rahmenhöhe. Die separat erhältliche Spannschloss-Diagonalstrebe (Zubehör K, Abschnitt 5) ist damit eine **zusätzliche** Verstärkung on top der werksseitigen Grundaussteifung, kein Ersatz dafür. Offen ist noch die genaue Formel für „Anzahl Diagonalstreben je Rahmenhöhe" – die gemessenen Positionen (249 / 999 / 2249 mm bei H=2500) sind nicht exakt gleichmäßig verteilt (Abstände 750 mm bzw. 1250 mm), das genaue Platzierungsraster ist noch unklar (siehe offene Punkte).

**Praktischer Fund:** Der Fachboden-GLB trägt den Produkttyp direkt im Node-Namen (z. B. „…MS150_1"). Falls das in der gesamten GLB-Bibliothek so gepflegt ist, lässt sich daraus eine SKU→Typ→Maße-Zuordnungstabelle weitgehend automatisiert statt manuell aufbauen.

**GLB↔Artikel-Verknüpfung geklärt (Nutzer-Feedback, 29.07.):** Die GLB-Dateinamen beginnen immer mit der **GTIN** – entweder der GTIN des kompletten Regals oder der GTIN des Einzelteils (z. B. Ständer, Boden). Stichprobe an allen 4 bisher erhaltenen GLBs bestätigt: `4026212149722_20082724_RAL_7035.glb`, `4026212286502_VZK.glb`, `4026212307597_200182321.glb`, `4026212286571_200177608_VZK.glb` – alle vier beginnen mit einer 13-stelligen GTIN, gefolgt optional von Artikelnummer und/oder Farbcode. Damit ist der Join-Key für die spätere Plugin-Integration klar: **GTIN aus dem PIM-Export ↔ GTIN-Präfix im GLB-Dateinamen**. Das löst offenen Punkt (c) aus Abschnitt 11.

**Wichtige Einschränkung, aktuell:** Die bisher verfügbaren GLBs sind **nur generische Einzelteile** (Ständer, Boden) – **noch nicht** als fertig zusammengesetzte, komplette Grundregal-/Anbauregal-SKUs vorhanden. Das bestätigt, dass unser Werkzeug den richtigen Ansatz verfolgt: Regale werden aus Einzelteil-GLBs **zusammengebaut** (Rahmen + Böden per Code positioniert), nicht als vorgefertigtes Komplett-GLB pro Artikel geladen. Die GTIN-Verknüpfung (siehe oben) gilt also in der Praxis primär für die Einzelteile, nicht für die kompletten Regal-SKUs selbst – die vollständige Regal-Ansicht bleibt eine Komposition aus mehreren Einzelteil-GLBs, gesteuert durch die Attribute der jeweiligen Regal-SKU (H, FL, Fd, Aussteifung, Traglast).

**Ständer-Typen vereinfacht: T1N / T2N (Nutzer-Feedback, 29.07.):** Trotz vieler unterschiedlicher Ständer-GTINs (je nach Fd, Farbe, Traglast, Aussteifung) reduziert sich die eigentliche 3D-Formfamilie auf nur zwei Typen: **T1N** und **T2N**, wobei **Höhe > 2000 mm → T2N**, sonst T1N. Die beiden bisher vorliegenden Rahmen-GLBs (H≈2000 und H≈2500) entsprechen also exakt T1N und T2N. Für weitere Höhen oberhalb 2000 mm (2250, 2500, 2750, 3000 mm …) reicht damit möglicherweise **ein** T2N-Referenz-GLB, aus dem die anderen Höhen durch reine Skalierung/Neupositionierung der Lochraster-Punkte abgeleitet werden könnten – muss aber noch geprüft werden, ob T2N wirklich pro Höhe identisch geformt ist oder nur die Profilquerschnitts-*Familie* gleich bleibt (Länge variiert natürlich mit H).

### 2.2 Einzelteil-Komponentenkatalog (29.07., PIM-Export „Einzelkomponenten im Shop", 97 Artikel)

Der Export bestätigt und erweitert das T1N/T2N-Bild deutlich:

| Ständer-Familie | Bedeutung | Verfügbare Höhen im Export | Fd-Werte |
|---|---|---|---|
| **T1N** (+ „S3 T1N") | Standard-Ständerrahmen, wie in unseren beiden GLBs gemessen | 2000 mm | 300/400/500/600/800 |
| **T2N** (+ „S3 T2N") | Standard-Ständerrahmen, hohe Ausführung | 2500 mm (plain CLIP), **2200 / 2500 / 3000 mm (S3-Linie!)** | 300/400/500/600/800 |
| **VW1N / VW2N** | „Vollwand"-Ständerrahmen (geschlossene Rückwand statt offener Streben) | VW1N: 2000 mm, VW2N: 2500 mm | 300/400/500/600/800 |
| **LW1N / LW3N** | „Eurolochung"-Ständerrahmen (Euro-Lochraster für Zubehör/Haken) | LW1N: 2000 mm, LW3N: 2500 mm | 300/400/500/600/800 |

**Wichtige Korrektur/Erweiterung:** Die 2-Typen-Vereinfachung (T1N/T2N nur nach Höhe) gilt offenbar **innerhalb einer Ständer-Familie**, aber es gibt mindestens **drei** Familien (T = Standard, VW = Vollwand, LW = Eurolochung), die strukturell unterschiedlich sind – nicht nur zwei. Für unser aktuelles CPQ (Grundregal/Anbauregal-Katalog aus Abschnitt 11) sind bislang **nur T1N/T2N relevant**, da die dortigen SKU-Namen keine Vollwand-/Eurolochung-Hinweise enthalten – VW/LW scheinen für andere Produktkontexte (Sichtschutz, Zubehör-Montage) im Sortiment zu sein. **Offen:** Werden VW/LW jemals als komplette Grundregal/Anbauregal-SKUs verkauft, oder nur als Einzelteil-Tausch/-Sonderbau? Für den ersten CPQ-Wurf können wir uns auf T1N/T2N beschränken.

**Datenqualitäts-Fund:** In der älteren (nicht-S3) CLIP-Linie hat das Feld „Onlineshop-Name" bei 10 von 20 T2N-Rahmen einen Copy-Paste-Fehler – es steht „Ständerrahmen T1N" obwohl Kurztext und Pfad eindeutig T2N sagen (z. B. GTIN 4026212073997 = „CL T2N Rahmen 2500 500 vzk", aber Onlineshop-Name nennt „T1N"). Die **S3-Linie hat diesen Fehler nicht**. **Praktische Konsequenz fürs Parsing:** Für die Ständer-Typ-Erkennung ist der Kurztext (oder der Pfad-Ordner) zuverlässiger als der Onlineshop-Name.

**Aussteifung neu eingeordnet – wichtige Korrektur:** Die separat verkauften Komponenten „Diagonalstab" (5 × FL × 5 mm, erhältlich für FL 1000/1300/1500/1700 mm) und „Längsriegel" (40 × FL × 47 mm, erhältlich für FL 1000/1300 mm) sind **nach Regalbreite (FL) bemessen, nicht nach Rahmentiefe (Fd)**. Das zeigt: Diagonalstab/Längsriegel sind **zeilenlange, zwischen den Rahmen montierte Bauteile** (identisch mit dem „Zubehör-Typ K" aus Abschnitt 5), **nicht** die kurzen, tiefenorientierten Streben, die wir in den beiden Rahmen-GLBs selbst gemessen haben (die liefen entlang der Rahmentiefe Z, ca. 520 mm, unabhängig von FL). Das heißt: **die feste Verstrebung im Rahmen-GLB bleibt in jedem Fall vorhanden**, unabhängig von der Aussteifungswahl – „Aussteifung: Diagonalstab | Längsriegel" ist eine **zusätzliche, zeilenlange Komponente**, kein Tausch des Rahmens selbst. Das korrigiert offenen Punkt 9 aus Abschnitt 9 (kein „dritter Rahmentyp" nötig, sondern nur zwei zusätzliche Bauteil-GLBs). GLBs für Diagonalstab und Längsriegel stehen noch aus.

**GTIN-Rückverfolgung unserer beiden Rahmen-GLBs bestätigt:** GTIN 4026212286502 = „CL S3 T1N Rahmen 2000 500 vzk" (Artikelnummer IFS 200177601), GTIN 4026212286571 = „CL S3 T2N Rahmen 2500 500 vzk" (Artikelnummer IFS 200177608) – exakter Abgleich mit dem Komponenten-Export, GTIN-Präfix-Regel aus Abschnitt 2.1 damit doppelt bestätigt.

**Außerhalb des CLIP-Scopes:** Der Export enthält auch 8 „FIX"-Winkelprofile (ML35/ML40, System-Tag „FIX,COMPACT" statt „CLIP") – vermutlich ein anderes META-Regalsystem, das im selben PIM-Ordner mitgeführt wird. Für unser CLIP-Datenmodell nicht relevant, nur zur Vollständigkeit vermerkt.

Ein Aufbau aus diesen echten Bauteilen liegt als interaktive HTML-Datei vor. Aktuellster Stand: `Fachbodenregal_CLIP_Regalzeile_v4.html` – unterstützt eine ganze **Regalzeile mit mehreren Feldern**, wählbar entweder über die **Feldanzahl** (Menge) oder über die **Ziellänge der Zeile** (wird auf ganze 1000-mm-Felder abgerundet, nie länger als eingegeben, da bisher nur diese FL-Größe als echtes GLB vorliegt) – beide Eingaben sind synchronisiert. Anbaufelder teilen sich, wie im Datenmodell beschrieben, jeweils einen Ständerrahmen mit dem Nachbarfeld (N Felder → N+1 Rahmen, nicht 2×N). **Seit 29.07. ist die Regalhöhe echt auswählbar (2000 mm / 2500 mm)**, beide Rahmenhöhen sind als reale GLBs eingebaut; die Ebenen-Positionen (Lochraster 25 mm, 100 mm Einhängehöhe unterste Ebene, Kappenabzug oben) werden dynamisch aus der gewählten Rahmenhöhe berechnet. Weitere Höhen (z. B. 1000/1250/1500/1750/2200/2750/3000 mm) können nach demselben Muster ergänzt werden, sobald GLBs vorliegen – **2200 mm und 3000 mm sind laut Komponenten-Export bereits als reale T2N-Artikel im Sortiment**, auch wenn uns die GLBs dafür noch fehlen. Kappe bleibt vorerst ein 2-mm-Platzhalter.

**Neu (29.07.): Diagonalstab (Zubehör K) als echtes GLB eingebaut.** Aus dem GLB-Backup-Ordner (Abschnitt 2.3) geladen, dekomprimiert und per Dropdown „Aussteifung" ein-/ausschaltbar. Die **Platzierung ist aktuell eine Näherung**: Das Bauteil (4 Meshes – Hauptstab + 3 Spannschloss-Kleinteile) hat eine kombinierte lokale Bounding-Box von ca. 1,011 × 1,005 × 0,026 m; wir mappen die lokale X-Achse auf die Feldbreite (FL) und die lokale Y-Achse auf die Höhe ab der Einhängehöhe, positioniert an der Rückseite des Rahmens (Z nahe der Rahmen-Rückkante). Das ergibt eine plausible, aber **nicht META-exakte** Platzierung – die tatsächliche Regel aus Abschnitt 5 (850-mm-Höhenmodul + variabler Versatz DH) ist weiterhin offen und müsste nachgezogen werden, sobald die genauen Referenzwerte vorliegen.

**Verteilungsmuster geklärt (Nutzer-Feedback, 29.07.):** Erstes Feld bekommt immer ein **Kreuz aus 2 Streben** (beide Diagonalrichtungen), jedes weitere Feld genau **1 Strebe mit alternierender Ausrichtung** – von vorne gesehen abwechselnd „links oben → rechts unten" und „rechts oben → links unten". Technisch umgesetzt über eine 180°-Rotation um die lokale X-Achse für die jeweils andere Ausrichtung (spiegelt Y und Z korrekt, ohne die Flächen-Normalen zu invertieren, wie es eine reine Skalierungs-Spiegelung tun würde).

**Montageposition korrigiert (Nutzer-Feedback, 29.07.):** Die Streben werden **außen an der Rückseite** angebracht, nicht innerhalb der Rahmentiefe. Z-Position im Tool entsprechend von „25 mm innerhalb der Rückkante" auf „13 mm außerhalb/hinter der Rückkante" (`FRAME_Z_MIN - 0.013`) geändert – die Strebe liegt jetzt hinter dem Rahmen, nicht zwischen den Ständern. Aktuell im Tool (`Fachbodenregal_CLIP_Regalzeile_v6.html`).

**Bodenraster überarbeitet:** Von 0,25-m- auf 1×1-m-Kästen umgestellt (`GridHelper(20, 20, ...)`) und deutlich dezenter eingefärbt (Farbtöne nah am Hintergrund, zusätzlich mit 35 % Deckkraft).

### 2.3 GLB-Backup-Ordner durchsucht (29.07., Ordner „GLB Backup", 2.666 Dateien)

Der Nutzer hat einen lokalen Backup-Ordner mit GLB-Dateien freigegeben. Abgleich per GTIN-Präfix gegen alle 641 bekannten Artikel aus den drei PIM-Exporten (Grundregal, Anbauregal, Komponenten):

- **Komplette Grundregal-/Anbauregal-SKUs: so gut wie nicht vorhanden** (nur 1 von 544 Artikeln hat eine passende GLB-Datei – eine „Doppel-Grundregal"-Ausnahme). Bestätigt endgültig: GLBs existieren praktisch nur auf **Einzelteil-Ebene**, komplette Regale müssen im Tool weiterhin aus Einzelteilen zusammengebaut werden.
- **85 von 97 aktuell im Shop genutzten Komponenten gefunden**, darunter:
  - ~~Diagonalstab: alle 4 Breiten (1000/1300/1500/1700 mm) vorhanden~~ – **eingebaut (29.07.):** 1000-mm-Variante (GTIN 4026212036336) im Tool integriert, siehe Abschnitt 2.2 unten.
  - **Längsriegel: alle 4 Artikel fehlen** (weder verzinkt noch RAL 7035, weder 1000 noch 1300 mm) – für die Aussteifungs-Alternative „Längsriegel" haben wir also weiterhin kein reales GLB.
  - **Zusätzliche T2N-Rahmenhöhen 2200 mm und 3000 mm: vollständig vorhanden** (alle Fd-Varianten bei 2200 mm, Fd=300 mm bei 3000 mm, jeweils verzinkt und RAL 7035) – damit könnten wir die Höhenauswahl im Tool direkt um 2200 mm erweitern, ohne auf weitere Zulieferung zu warten.
  - Die 8 fehlenden „FIX"-Winkelprofile sind ohnehin außerhalb unseres CLIP-Scopes (siehe Abschnitt 2.2), nicht relevant.
- **Kappe und Fuß weiterhin nicht auffindbar** – da wir deren GTIN/Artikelnummer nicht kennen (sie waren nicht Teil des Komponenten-Exports aus Abschnitt 2.2), können wir sie im Backup-Ordner nicht gezielt suchen. Der Ordner enthält ca. 2.580 Dateien außerhalb unserer bekannten 641 Artikel-GTINs (u. a. viele Artikel mit anderen RAL-Farben wie RAL 5010/2001, vermutlich andere Produktlinien/Farbvarianten) – Kappe/Fuß könnten darunter sein, sind aber ohne Artikel-/GTIN-Referenz nicht sicher identifizierbar (Dateinamen enthalten nur GTIN/Artikelnummer + Farbcode, keine Produktbezeichnung).

(Technischer Hinweis: Die GLBs mussten dafür von Draco-komprimiert auf unkomprimiert umgewandelt werden, da der Draco-Decoder im Vorschau-Kontext nicht zuverlässig nachlud – dadurch ist die Datei deutlich größer (~19 MB), lädt aber ohne Web-Worker-Abhängigkeit.)

---

## 3. Fachboden-Typen & Traglast-Matrix

Das ist der wichtigste Fund für die Preis-/Konfigurationslogik: **dieselbe Nennbreite/-tiefe hat unterschiedliche Traglast, je nach verbauter Aussteifung.**

### 3.1 Produktlinien (Übersicht)

| Typ | Charakteristik | Traglast-Prinzip |
|---|---|---|
| **L 80 Compact** | Basis-Fachboden, keine Aussteifungsschiene | Flach 80 kg, unabhängig von FL×Fd (750–1250 × 300–600 mm) |
| **MS 150-III** | Boden ohne zusätzliche Mittelschiene (Stufe I) oder mit einer Mittelschiene (Stufe II) | 150 kg durchgängig (I und II identisch) |
| **MS 230-III** | Boden mit Mittelschiene (Stufe II) | 230 kg |
| **MS 330-III** | Boden mit diagonaler/verstärkter Aussteifungsschiene (Stufe III) | bis 330 kg, je nach FL×Fd |
| **MS 200-IV** | Schwerlast-Variante mit umlaufendem Kastenprofil | flach 200 kg (FL 1500–1700 × Fd 400–600 mm) |
| **Typ L (Gitterboden)** | Gitter-/Rost-Fachboden | 150 kg (FL 1000/1300 × Fd 400–800 mm) |
| **AC-Kragarm-Fachboden** | Konsolboden ohne Rückwand, Bügel-Halterung | flach 400 kg (FL 1000/1300/2000 × Fd 800 mm) |

### 3.2 Traglast-Tabelle MS150-III / MS230-III / MS330-III (FL × Fd in mm)

Die drei Aussteifungsstufen (I = keine/Randprofil, II = eine Mittelschiene, III = diagonale/zusätzliche Schiene) bestimmen zusammen mit der Nennbreite/-tiefe die zulässige Traglast F in kg:

| FL × Fd | Stufe I (MS150 / MS230) | Stufe II (MS150 / MS230) | Stufe III (MS150 / MS330) |
|---|---|---|---|
| 750 × 300–600 | 150 / – | 150 / – | – / 150 (nur 400–600) |
| 1000 × 300 | 150 / 230 | 150 / 230 | – / – |
| 1000 × 400–600 | 150 / 230 | 150 / 230 | 150 / 330 |
| 1000 × 800 | – / 230 | – / 230 | – / 330 |
| 1300 × 300 | – / 230 | – / 230 | – / – |
| 1300 × 400–800 | – / 230 | – / 230 | – / 330 |

Zusätzliche Randbedingung von META: **F (MS230-III / MS330-III) ≤ 200 kg**, wenn der Boden als **Abdeckboden** (oberster Abschlussboden des Feldes) eingesetzt wird. Grund: Der Abdeckboden nutzt einen anderen Fachbodenträger (die Halterung/Auflager im Regal) als ein regulärer Zwischenboden, und dieser Trägertyp ist unabhängig von der Aussteifung des Bodens selbst auf max. 200 kg ausgelegt. Die Deckelung kommt also nicht vom Fachboden (der könnte strukturell mehr), sondern vom Trägerbauteil.

**Business Rule fürs CPQ:** Die Traglast-Prüfung muss die Position der Ebene im Feld kennen – „ist dies die oberste Ebene / der Abdeckboden?" Wenn ja, gilt unabhängig vom Fachboden-Typ ein harter Deckel von 200 kg, auch wenn die FL×Fd×Typ-Tabelle (Abschnitt 3.2) einen höheren Wert (230/330 kg) ausweisen würde. Der Fachbodenträger ist damit selbst eine eigene, positionsabhängige Komponente im Datenmodell (`Fachbodenträger{Position: Zwischenboden | Abdeckboden, maxLast}`), nicht nur ein Montagedetail.

**Fd-Kompatibilität pro Typ** (welche Tiefe passt zu welcher Schiene):
- Fd 400/500 mm → MS150-III **und** MS230-III möglich
- Fd 600 mm → MS150-III **und** MS330-III möglich
- Fd 800 mm → **nur** MS330-III

### 3.3 Weitere Traglast-Tabellen

- **L 80 Compact:** 80 kg flach, FL 750/1000/1250 × Fd 300/400/500/600 mm.
- **MS 200-IV:** 200 kg flach, FL 1500/1700 × Fd 400/500/600 mm (ein- oder zweiteiliger Boden "1 St.").
- **Gitterboden Typ L:** 150 kg, FL 1000/1300 × Fd 400/500/600/800 mm (1000×300 nicht verfügbar).

### 3.4 Summenlast-Regeln pro Feld/Ständerpaar

Neben der Traglast pro Ebene gibt es eine **Summenlast-Obergrenze pro Feld**, unabhängig davon wie viele Ebenen einzeln ausgereizt werden:

| Regal-Variante | ΣF max |
|---|---|
| Compact 300 mm tief | ≤ 900 kg |
| Compact 600 mm tief | ≤ 900 kg |
| Schrägboden-Regal (Z, LR 14°/VK50) | ≤ 1800 kg (5 Ebenen × ≤200 kg je Ebene) |
| Schrägboden-Regal L80 Compact (AA, LR40/LR-Z) | ≤ 1200 kg |
| Eckregal MS150-III, Grundfeld (GR) | 1000–1400 kg (höhenabhängig, 2000–3000 mm) |
| Eckregal MS150-III, Anbaufeld (AR) | 1650–2400 kg (höhenabhängig) |

**Business Rule fürs CPQ:** Bei der Preis-/Machbarkeits-Validierung müssen zwei Prüfungen parallel laufen – (a) Einzelboden-Traglast pro Ebene gegen die FL×Fd×Typ-Tabelle, und (b) Summenlast über alle Ebenen eines Feldes gegen ΣF. Eine Konfiguration kann (a) erfüllen und trotzdem an (b) scheitern.

---

## 4. Traglast-Warnhinweis (wiederkehrendes Icon in der PDF)

Auf praktisch jeder Traglast-Seite erscheint dieselbe Grafik: durchgestrichenes Bild mit **Last punktuell in der Mitte** eines Bodens vs. Häkchen-Bild mit **gleichmäßig verteilter Last** (4 Symbole pro Ebene). Das ist keine reine Sicherheitshinweis-Deko, sondern eine explizite Bedingung dafür, dass die Tabellenwerte überhaupt gelten: **F gilt nur bei gleichmäßig verteilter Last**, nicht bei Punktlast. Für den Konfigurator heißt das: die Traglastangabe im Angebot sollte immer mit dem Hinweis „gleichmäßig verteilt" versehen werden.

---

## 5. Aussteifung / Diagonalstrebe (Zubehör-Typ K)

Auch wenn K formal ein Zubehörteil ist, ist es für die Statik des **Standardregals** so zentral, dass ich es hier aufnehme:

- Diagonalstrebe mit Spannschloss (Turnbuckle), always paarweise über Kreuz montiert.
- Positionierung ist **nicht frei wählbar**, sondern an feste Referenzpunkte gebunden: ein Modul von 850 mm Höhe plus ein variabler Versatz `DH` ab Unterkante – d. h. die Streben sitzen an bestimmten Rasterpositionen, nicht irgendwo.
- Ausrichtung ist eindeutig vorgegeben (✗/✗/✓-Grafik auf mehreren Seiten wiederholt) – falsches Überkreuzen ist explizit verboten.
- Nur handfest anziehen, **keine Zange** verwenden (S. 149).
- Ab bestimmter Regalhöhe/Konfiguration ist die Strebe nicht optional, sondern strukturell notwendig (z. B. bei den Eckregal- und Compact-Varianten wird K wiederholt referenziert, wenn die H:d-Grenze überschritten wird oder die Zeile eine gewisse Länge hat).

**Für die Business Rules:** K sollte im Datenmodell nicht als „optionales Zubehör" sondern als **bedingt-pflichtige Komponente** modelliert werden, deren Notwendigkeit von H, d, FL und Zeilenlänge abhängt.

**Möglicher Zusammenhang mit „Diagonalstab" (Abschnitt 2.2, 29.07.):** Die im Komponenten-Export gefundene „Diagonalstab"-Komponente (erhältlich für Regalbreite 1000/1300/1500/1700 mm) könnte identisch mit diesem Zubehör K sein – beide sind zeilenlange Diagonalstreben. Unklar/noch zu prüfen: passt die hier beschriebene „bedingt-pflichtig ab bestimmter H/d/FL/Zeilenlänge"-Regel aus dem PDF zusammen mit der Aussage „Aussteifung (Diagonalstab/Längsriegel) ist frei wählbar" aus Abschnitt 11 – oder ist die freie Wahl nur zwischen den beiden *Typen* (Diagonalstab vs. Längsriegel), während irgendeine Form der zeilenlangen Aussteifung ab gewissen Bedingungen trotzdem verpflichtend bleibt? In den 544 Grundregal/Anbauregal-SKUs hat ohnehin jede Konfiguration eine der beiden – insofern evtl. akademisch, aber für die Business-Rule-Logik relevant, falls es doch Konfigurationen ganz ohne diese Aussteifung geben sollte.

**Lochraster-Kopplung & Kollisionsvermeidung (29.07., 2. Korrektur im 3D-Tool):** Nach Referenzbild-Feedback des Nutzers steht fest, dass die Streben real in der Lochung des Ständerprofils eingehängt werden (die kleine „Nase" am Streben-Ende hakt im Loch ein) und sich zwei Streben niemals dasselbe Loch teilen dürfen – das gilt insbesondere an den geteilten Rahmen zwischen zwei benachbarten Feldern, wo z. B. das obere Ende der Kreuz-Strebe aus Feld 1 und das obere Ende der alternierenden Strebe aus Feld 2 sonst rechnerisch im selben Loch landen würden. Im 3D-Tool (v7/v8) wurde das wie folgt umgesetzt:
  - Die gemessene BBox-Höhenspanne der Diagonalstab-Komponente (≈1005mm inkl. Spannschloss-Überstand) wird auf ein ganzzahliges Vielfaches des Lochraster gerundet, sodass jede Strebe zwei exakte Loch-Positionen (Rahmen-Index + Raster-Schritt ab Einhängehöhe) als Endpunkte hat.
  - Ein zeilenweites „belegte Löcher"-Set wird bei jedem Rebuild neu aufgebaut; jede Strebe wird der Reihe nach (Feld 0 zuerst, dann aufsteigend) platziert.
  - Kollidiert eine Strebe an einem ihrer beiden Endpunkte mit einer bereits platzierten Strebe, wird die gesamte starre Strebe (beide Enden gemeinsam, Form bleibt erhalten) um ganze Raster-Schritte vertikal verschoben, bis beide Endpunkte frei sind.
  - Verifiziert per Standalone-Simulation für 1/2/3/5-Felder-Zeilen: keine doppelt belegten Löcher, das erste Feld bildet weiterhin ein sauberes Kreuz aus 4 unterschiedlichen Eck-Löchern, jede Kollision an einem gemeinsamen Rahmen wird durch einen Raster-Versatz der jeweils zweiten Strebe aufgelöst.
  - Weiterhin offen: das exakte 850mm-Modul+DH-Platzierungsraster aus der PDF (Abschnitt oben) ist eine andere, noch nicht reproduzierte Regel für die *Grundhöhe* der ersten Strebenreihe – die aktuelle Umsetzung startet weiterhin an der Einhängehöhe (100mm) und weicht nur bei Kollision aus; das ist eine Näherung, keine exakte Nachbildung der META-Montagevorschrift.

**Lochraster-Abstand korrigiert (29.07., 3. Korrektur, v8):** Ein zweites Referenzbild (Nahaufnahme T-Profil mit zwei markierten Löchern) zeigt, dass der reale Lochabstand im T-Profil **50mm** beträgt, nicht 25mm wie zunächst angenommen. `RASTER` wurde im 3D-Tool von 0.025 auf 0.05 korrigiert (betrifft sowohl die Diagonalstab-Lochpositionen als auch die Rundung der Fachboden-Ebenenhöhen). Die gerundete Diagonalstab-Höhenspanne bleibt dabei weiterhin exakt 1000mm (jetzt 20×50mm statt 40×25mm), die Kollisionsvermeidungs-Logik selbst ist unverändert korrekt, nur der Rasterabstand wurde angepasst. Offen: ob der reale 25mm/50mm-Lochabstand über die gesamte Ständerlänge konstant ist oder ob es (wie bei manchen Lochungssystemen üblich) einen feineren Sub-Raster nur für bestimmte Zwecke (z. B. Fachboden-Feinjustierung) zusätzlich zum 50mm-Struktur-Raster gibt – dafür bräuchten wir entweder ein weiteres Referenzbild mit Maßangabe oder die reale Lochposition aus der Rahmen-GLB-Geometrie selbst (bisher nicht ausgewertet).

**Zwei weitere Geometrie-Fehler behoben (29.07., 4. Korrektur, v9) – diesmal per Screenshot-Verifikation statt nur Zahlen-Rechnung geprüft:** Der Nutzer meldete, dass die Streben weiterhin sichtbar zu weit vom Regal entfernt sind und nicht in den Löchern stecken, und dass bei den Streben mit Ausrichtung „rechts oben nach links unten" die Haken-Nase in die falsche Richtung zeigt (müsste nach vorne zeigen). Beide Ursachen wurden diesmal nicht nur rechnerisch, sondern durch Rendern des Tools mit Playwright/Chromium (lokal im Sandbox-Container, drei.js aus dem npm-Cache statt CDN, da CDN-Zugriff hier blockiert ist) und Auswertung von Screenshots sowie exakten Three.js-Weltkoordinaten (`Box3().setFromObject(...)`) gefunden:
  - **Falsche Nasen-Richtung:** Die bisherige Spiegelung von Ausrichtung „B" per `rotation.x = Math.PI` (180°-Rotation um die X-Achse) dreht zwangsläufig sowohl Y als auch Z um – Y wie gewollt (für die umgekehrte Diagonalrichtung), Z aber ungewollt, wodurch die Haken-Nase am Streben-Ende nach hinten statt nach vorne zeigte. Eine reine 180°-Rotation um eine einzelne Achse kann eine „/"-Diagonale nie in eine „\"-Diagonale verwandeln, ohne dabei zwangsweise auch eine zweite Achse zu drehen – das ist geometrisch unvermeidbar. Lösung: statt Rotation wird jetzt eine reine Y-Spiegelung (`scale.set(1,-1,1)`) verwendet, die Z unangetastet lässt. Three.js korrigiert die dadurch invertierte Dreiecks-Wicklung automatisch (Rendering wurde per Screenshot auf Schatten-/Normalen-Artefakte geprüft, keine gefunden).
  - **Zu großer Abstand zur Lochung:** Die Referenz-Z-Position der Strebe war an `FRAME_Z_MIN` (der Fußplatten-BBox des Rahmens) verankert, nicht an der tatsächlichen Rückfläche des lochungstragenden Ständerprofils. Durch direkte Analyse der Rahmen-GLB-Geometrie (`frame_plain.glb`/`frame2500_plain.glb`, per-Mesh-BBox) wurde die reale äußerste Z-Fläche des hinteren Pfostens mit **Z = −0,536m** gemessen (bei beiden Regalhöhen identisch) – das ist der neue Referenzwert (`BACK_POST_OUTER_Z`), mit 3mm Überlappung, damit die Nase sichtbar in die Lochung „einhakt" statt nur stumpf anzuliegen.
  - **Zusätzlich gefunden und mitkorrigiert:** Die Strebe lief X/Y-seitig systematisch ca. 11mm über das nominale 1000mm-Feld hinaus (die reale BBox misst 1011×1005mm statt exakt 1000×1000mm), wodurch die Endpunkte nie exakt auf der Rahmen-Mittellinie bzw. dem Raster-Loch lagen. Die Strebe wird jetzt minimal (~1%) in X und Y skaliert, sodass beide Enden rechnerisch exakt auf Rahmen-Mittellinie und exaktem Raster-Y treffen (per Weltkoordinaten-Messung verifiziert: Endpunkte liegen jetzt exakt bei X=0/1/2/3m und Y=0,1m/1,1m usw., vorher bei X=0/1,011/2,011m).
  - **Methodik-Hinweis:** Ab dieser Korrektur wird jede geometrische Platzierungs-Änderung vor Auslieferung per Playwright-Rendering (Screenshots aus mehreren Winkeln + exakte Weltkoordinaten-Messung der Objekt-BBoxen) verifiziert, nicht mehr nur anhand von Zahlen am Papier geprüft – das hätte diesen Fehler früher gefangen.

**Feinjustierung Lochungs-Abstand (29.07., 5. Korrektur, v10) – teilweise zurückgenommen:** Trotz der 4. Korrektur meldete der Nutzer nach eigener Sichtprüfung, dass die Strebe noch sichtbar vom Pfosten absteht ("müssen noch 2cm tiefer"), sowie dass die Haken "zum Regal zeigen" müssten. Die Überlappung (`DIAGSTAB_Z_OVERLAP`) wurde daraufhin von 3mm auf 23mm erhöht. Für die Haken-Richtung wurde testweise eine Z-Spiegelung (`scale.z=-1`) verglichen; bei 23mm Überlappung war im Screenshot kein Unterschied zur unveränderten Variante erkennbar, weshalb die Spiegelung zunächst **nicht** übernommen wurde.

**Korrektur zurückgenommen + Haken-Richtung tatsächlich behoben (29.07., 6. Korrektur, v11):** Der Nutzer meldete, dass v10 die Position wieder kaputt gemacht hat ("wieder wie am Anfang, im Regal drin") und dass die Positionierung aus v9 (3mm Überlappung) bereits richtig war – nur die Haken-Richtung war noch falsch. Das erklärt auch, warum die Z-Spiegelung in der 5. Korrektur keinen sichtbaren Unterschied zeigte: bei 23mm Überlappung steckte die Strebe bereits so tief im Pfosten, dass die unterschiedliche Hakenform kaum noch sichtbar war – das war ein Artefakt der falschen Referenz-Überlappung, kein Beleg dafür, dass die Spiegelung wirkungslos ist. Mit `DIAGSTAB_Z_OVERLAP` zurückgesetzt auf 3mm (bestätigter v9-Wert) und der Z-Spiegelung erneut per Screenshot-Vergleich (Seitenansicht) geprüft: diesmal zeigte sich ein klar sichtbarer Unterschied – die gespiegelte Variante zeigt eine gebogene Hakenform statt eines geraden Stifts. Diese Kombination (3mm Überlappung + Z-Spiegelung bei beiden Ausrichtungen A und B) ist jetzt in v11 umgesetzt. Lehre daraus: bei mehreren gleichzeitig geänderten Parametern kann einer den visuellen Effekt des anderen überdecken – Parameter sollten möglichst einzeln verändert und verglichen werden, nicht gebündelt.
  - Offen: die exakte Geometrie des Hakens selbst (welcher Teil der Spannschloss-Baugruppe genau "in die Lochung eingreift") wurde nicht einzeln vermessen, nur die Gesamt-BBox-Ausrichtung. Für eine maßstäblich exakte Nachbildung wäre eine Detailaufnahme oder Zeichnung des Hakenprofils hilfreich.

**Lochungs-Phasenversatz gefunden und behoben (29.07., 7. Korrektur, v12):** Der Nutzer bestätigte, dass die Haken-Richtung aus v11 jetzt korrekt ist, meldete aber zwei verbleibende Positionsfehler anhand zweier annotierter Referenzbilder: die Höhe der Streben stimmt nicht (Bild 1, Loch-Positionen vs. tatsächliche Haken-Position markiert) und der Abstand zum T-Profil stimmt ebenfalls nicht – der Haken müsse sichtbar im Profil „verschwinden" (Bild 2, Lücke gelb markiert). Per Marker-Vergleichs-Experiment (farbige Kugeln bei probeweisen Loch-Y-Positionen direkt im gerenderten Rahmen platziert und mit der tatsächlichen Lochgeometrie des GLB visuell verglichen) wurde die eigentliche Ursache für **beide** Symptome gefunden: die bisherige Annahme, dass die realen Loch-Mittelpunkte bei Vielfachen von 50mm ab Y=0 liegen, war falsch – sie liegen tatsächlich um 25mm phasenversetzt (`Y = 0,025 + k·0,05`). Eine Strebe, deren Haken auf massivem Profilmaterial zwischen zwei echten Löchern landet (weil sie nach der alten, unphasierten Rechnung positioniert wurde), sieht optisch exakt wie ein „schwebender", nicht eingehakter Haken mit sichtbarem Spalt aus – das erklärt beide vom Nutzer gemeldeten Symptome durch einen einzigen Fehler.
  - Fix: neue Konstante `HOLE_PHASE = 0,025` und Hilfsfunktion `holeY(step) = HOLE_PHASE + step·RASTER` ersetzen die bisherige rohe Vielfache-von-RASTER-Rechnung für alle Diagonalstab-Endpunkte (`DIAG_BASE_STEP` ersetzt `HANG_HEIGHT_STEPS` als Ausgangspunkt der Kollisionsvermeidungs-Suche). Die Kollisionsvermeidungs-Logik selbst (ganzzahlige Raster-Schritte pro Rahmen/Feld, „belegte Löcher"-Set) ist von der Phasenverschiebung nicht betroffen, da sie nur mit den ganzzahligen Schritt-Indizes rechnet, nicht mit absoluten Y-Werten.
  - Bewusst **nicht** angetastet: das Fachboden-Ebenenraster/`HANG_HEIGHT` selbst – das stammt aus einer früheren, separaten realen Messung und war nicht Teil dieser Nutzer-Rückmeldung.
  - Verifiziert per Playwright: (a) 3-Felder-Zeile mit korrekt phasierten grünen Marker-Kugeln – Haken beider Ausrichtungen landen jetzt exakt auf den Markern und wirken sichtbar eingehakt/„verschwunden" statt schwebend; (b) 4-Felder-Zeile, Nahaufnahme am geteilten Rahmen zwischen Feld 1 und Feld 2 – Kollisionsvermeidung funktioniert weiterhin korrekt, keine doppelt belegten Löcher, beide Streben haken sauber in denselben Pfosten ein.
  - Vom Nutzer re-bestätigt: die Höhe passt jetzt (Phasen-Korrektur allein hat dieses Symptom vollständig behoben). Verbleibend war nur noch der Z-Tiefen-Abstand, siehe nächste Korrektur.

**Z-Tiefe nachjustiert (29.07., 8. Korrektur, v13):** Der Nutzer bestätigte, dass die Höhe jetzt passt, meldete aber "auf der z-achse -20mm" als letzten verbleibenden Fehler – der Haken/das Spannschloss steckt bei der bisherigen 3mm-Überlappung (`DIAGSTAB_Z_OVERLAP`, unverändert seit v9) zwar korrekt in der richtigen Lochreihe, aber optisch noch sichtbar vor der Pfostenfläche statt darin "verschwunden". Per Playwright-Screenshot-Vergleich (identischer Kamerawinkel, nur `DIAGSTAB_Z_OVERLAP` von 0,003 auf 0,023 erhöht) eindeutig verifiziert: bei 23mm Überlappung verschwindet die komplette Haken-/Spannschloss-Baugruppe sichtbar in der ca. 40mm dicken Pfostenwand (nur die Strebe selbst bleibt sichtbar, wo sie ins Loch eintritt), bei 3mm ragt die Baugruppe noch deutlich heraus. `DIAGSTAB_Z_OVERLAP` wurde entsprechend von 0,003 auf 0,023 erhöht (in v13 umgesetzt).
  - Abgrenzung zur 5. Korrektur (v10, dort verworfen): Dort wurde derselbe Zielwert (23mm) bereits einmal ausprobiert, aber zusammen mit dem noch falschen Lochraster (vor der 7. Korrektur) getestet – dort erschien die Strebe dadurch "wieder wie am Anfang, im Regal drin", weil die Höhe gleichzeitig falsch war und die beiden Fehler sich überlagerten. Mit korrekter Höhe (7. Korrektur, v12) als Basis ist derselbe Tiefenwert jetzt eindeutig richtig – bestätigt die in v11 dokumentierte Lehre, Parameter einzeln zu verändern und zu vergleichen.

**Feinjustierung Z-Tiefe (29.07., 9. Korrektur, v14):** Der Nutzer meldete, die 20mm aus der 8. Korrektur seien "zuviel geschätzt" gewesen, und bat um eine kleine Korrektur von +5mm auf der Z-Achse in die Gegenrichtung, diesmal ohne aufwändige Verifikationsrunde. `DIAGSTAB_Z_OVERLAP` wurde entsprechend von 0,023 auf 0,018 reduziert (23mm → 18mm, netto weiterhin +15mm gegenüber dem ursprünglichen v9-Wert von 3mm). Per einzelnem Kontroll-Screenshot (Seitenansicht, gleicher Winkel wie bei der 8. Korrektur) knapp bestätigt: Haken/Spannschloss bleiben bei 18mm weiterhin vollständig im Profil verborgen, kein sichtbarer Unterschied zur 23mm-Variante an dieser Stelle erkennbar.

---

## 6. Verankerung (Kippsicherheit)

Zwei Mechanismen, beide an die H:d-Regel (≥4:1) gekoppelt:

1. **Wandhalter (Zubehör P):** Anbindung an eine Wand, zwei Montagearten – Dübel Ø6×30 mm mit Schraube Ø5×70 mm (Direktmontage in Ständerloch, korrekt: langer Schrauben-Kopf sitzt direkt im Ständer, **nicht** über die volle Unterlegscheiben-/Mutternkombination wie im „falsch"-Bild) oder Bohrung 75 mm tief ins Mauerwerk. Kein Bohrlochkleber verwenden (durchgestrichenes Kleber-Icon).
2. **Bodenanker:** ab bestimmter Regalhöhe/Auskragung Pflicht (siehe auch die frühere Anker-Spezifikation aus dem Zubehör-Handbuch: C20/25-Beton, ⌀10×110 mm Bohrung, ≤100 Nm).

**Trigger-Regel fürs CPQ:** Wenn H:d < 4:1 **oder** H ≥ 2500 mm (bei manchen Compact-Varianten explizit genannt), muss automatisch eine Verankerungs-Position (P oder Bodenanker) ins Angebot – nicht optional, sondern Pflichtfeld/Warnung.

---

## 7. Montage-Komplexitäts-Schwellenwert (Service-Pflicht)

Eine wiederkehrende Regel, die ich an mehreren Stellen unabhängig gefunden habe (z. B. S. 96, 101, 153 im Systemkomponenten-Dokument, und schon vorher bei den Clip-Schubladen im Zubehör-Dokument):

> **H1 ≤ 100 mm:** selbst montierbar.
> **H1 > 200 mm** (Abstand einer Ebene zur darunterliegenden bzw. Bodenanschluss-Versatz): Montage durch Fachpersonal empfohlen, mit Telefonnummer (+49 2932 9570).

Das ist eine generische Schwellenwert-Regel für „ungewöhnliche" Ebenenabstände, nicht nur ein Einzelfall. Fürs CPQ: sobald ein Nutzer eine Ebene mit einem stark vom Standardraster abweichenden Abstand zur nächsten Ebene konfiguriert, sollte ein Hinweis/Zusatzposten „Montageservice empfohlen" ausgelöst werden.

---

## 8. Eckregal-Konfiguration (L-Form)

Existiert als offizielle Standard-Variante (Grundfeld GR + Anbaufeld AR im rechten Winkel), nutzt dieselben Fachboden-/Rückwand-/K-Komponenten wie die gerade Zeile, hat aber eigene Summenlast-Tabellen (siehe 3.4). Empfehlung: für V1 des Konfigurators zurückstellen (gerade Zeilen zuerst), aber Datenmodell so anlegen, dass „Zeilen-Geometrie" (gerade vs. L-Form) später erweiterbar ist, ohne das Fachboden-/Traglast-Modell neu bauen zu müssen.

---

## 9. Offene Punkte / zu validierende Annahmen

1. **T-Profil-Tiefe stimmt nicht exakt mit dem GLB überein** – rechnerisch 50 mm (5 mm T-Strich + 45 mm Steg), gemessen am echten Ständerrahmen-GLB nur 39,6 mm (bei beiden Rahmenhöhen identisch: 39,6 mm bzw. 39,5 mm). Noch ungeklärt, ob das an Biegeradien liegt oder die Aufteilung angepasst werden muss – **wartet auf Rückmeldung**.
2. ~~„F (MS230-III/MS330-III) ≤ 200 kg"-Zusatzklausel~~ – **geklärt (Nutzer-Feedback):** Der Deckel gilt, wenn der Boden als Abdeckboden (oberste Ebene) verbaut wird, weil dafür ein anderer, auf 200 kg begrenzter Fachbodenträger verwendet wird – unabhängig von der eigentlichen Aussteifung des Bodens. Siehe Abschnitt 3.2.
3. **Reifenregal (S. 129) und weitere Sonderanwendungen** – im Dokument als Anwendungsbeispiel gezeigt, aber nicht als eigener Produkttyp mit vollem Regelwerk. Vermutlich kein eigenständiges CPQ-Produkt, sondern nur eine Konfiguration des Standardregals – zur Sicherheit trotzdem vermerkt.
4. **Lastableitung bei Mehrfeld-Zeilen (Derating 80/90/100 % nach Zeilenlänge)** – war im ersten Auszug (S. 1–80) bereits als Regel notiert, aber die exakten Prozentsätze und Schwellen-Feldanzahlen habe ich in dieser Konsolidierung nicht erneut mit Seitenverweis geprüft. Vor Implementierung nochmal gegen die Originalquelle verifizieren.
5. **Ecklösungen und Schrägboden-Varianten (Z/AA)** – vollständig dokumentiert, aber vermutlich Nice-to-have für spätere Ausbaustufen, nicht für den ersten CPQ-Wurf.
6. ~~Feste Diagonalstreben im Ständerrahmen-GLB vs. separates Zubehör K~~ – **geklärt (GLB-Vergleich H≈2000 vs. H≈2500):** Beide Rahmenhöhen haben werksseitig feste Diagonalstreben (2 Stück bei H≈2000, 3 Stück bei H≈2500) → Grundaussteifung ist Standard bei jedem Rahmen, Zubehör K ist eine zusätzliche Verstärkung. **Neu offen:** Das genaue Platzierungsraster der Diagonalstreben (Anzahl/Position je Rahmenhöhe) ist noch nicht abgeleitet – gemessene Abstände bei H=2500 sind ungleichmäßig (750 mm / 1250 mm), müsste an einer dritten Höhe (z. B. 1000, 1500 oder 3000 mm) plausibilisiert werden, sobald verfügbar.
7. **Fuß-Zubehörteil (2 mm) vs. Fußplatte im Rahmen-GLB (20,7 mm)** – der Nutzer hat klargestellt, dass der eigentliche „Fuß" (Nivellierfuß) 2 mm hoch ist und noch als eigenes GLB nachgereicht wird; die im Rahmen-GLB enthaltene, deutlich höhere Fußplatte (76×20,7×58 mm) ist vermutlich ein Rahmen-eigenes Abschlussteil, kein Ersatz dafür. Kappe (2 mm) ebenfalls noch als eigenes GLB ausstehend – beide sind im Zwischenaufbau (`Fachbodenregal_CLIP_echte_GLBs.html`) nur als Platzhalter enthalten.
8. ~~Zweite Rahmenhöhe (2500 mm) liegt jetzt als reales GLB vor~~ – **umgesetzt (29.07.):** Höhenauswahl 2000/2500 mm ist im Tool aktiv, siehe `Fachbodenregal_CLIP_Regalzeile_v3.html`. Weitere Höhen können nach demselben Muster ergänzt werden, sobald GLBs vorliegen.
9. ~~Längsriegel-Rahmen (dritter Rahmentyp) – GLB steht noch aus~~ – **korrigiert (29.07., Komponenten-Export):** Kein dritter Rahmentyp nötig. Diagonalstab und Längsriegel sind **eigenständige, zeilenlange Zusatzbauteile** (bemessen nach FL, nicht nach Fd/Rahmenhöhe), montiert zwischen den Rahmen entlang der Zeile – identisch zum „Zubehör-Typ K" aus Abschnitt 5. Der Ständerrahmen selbst (T1N/T2N) bleibt in beiden Fällen unverändert, inklusive seiner eigenen, tiefenorientierten Werksverstrebung. Für die 3D-Darstellung fehlen also zwei zusätzliche Bauteil-GLBs (Diagonalstab, Längsriegel), kein zusätzlicher Rahmen-GLB. **Auswahlregel geklärt (Nutzer-Entscheidung): Aussteifung wird frei wählbar**, d. h. `Aussteifung: Diagonalstab | Längsriegel` ist ein eigenständiger Konfigurationsparameter im CPQ, gleichrangig zu H/Fd/Traglast/Farbe/doppelseitig.

---

## 10. Vorschlag für nächsten Schritt

Sobald du das oben bestätigst oder korrigierst, würde ich daraus ein konkretes Datenmodell-Schema ableiten (Entitäten: `Regalzeile`, `Feld`, `Fachboden{FL, Fd, Typ, Traglast}`, `Ständerpaar`, `Diagonalstrebe`, `Verankerung`) plus die Validierungsregeln als Pseudocode/Entscheidungsbaum, damit es 1:1 in die CPQ-Logik übersetzbar ist.

---

## 11. Integration in den Produktkatalog (Shopware: Grundregal / Anbauregal)

**Ausgangslage:** Die realen Produktdaten kommen später aus Shopware (Plugin-Integration → Datenbank-Zugriff). Damit das CPQ von Anfang an mit echten, bestellbaren Einheiten statt mit frei kombinierbaren Einzelteilen arbeitet, muss die bisherige Feld-Logik (Abschnitt 1/2) auf die reale Shop-Struktur "Grundregal" + "Anbauregal" abgebildet werden, nicht umgekehrt.

**29.07., aktualisiert – Analyse eines echten PIM-Exports (544 Artikel: 272 Grundregale + 272 Anbauregale, jeweils Onlineshop-Name strukturiert ausgewertet).** Das ersetzt die vorherige, nur auf Suchindex-Snippets basierende Schätzung durch belastbare Zahlen:

**1. Struktur bestätigt, 1:1-Symmetrie:** Zu jeder der 272 Grundregal-Konfigurationen existiert exakt eine Anbauregal-Konfiguration mit identischen Attributen (H, FL, Fd, Traglast, Ebenen, Farbe, doppelseitig, Längsriegel) – vollständig symmetrischer Katalog. Bestätigt unser Grundfeld/Anbaufeld-Konzept 1:1: Grundregal = Startfeld (2 Rahmen), Anbauregal = Erweiterungsfeld (1 zusätzlicher Rahmen, teilt sich den zweiten mit dem Nachbarfeld).

**2. Reale Wertebereiche (aktueller Exportstand, nur Produktlinie „S3"):**

| Attribut | Werte im Export |
|---|---|
| Regalhöhe H | 2000 / 2500 mm (deckt sich mit unseren beiden GLBs) |
| Feldbreite FL | 1000 / 1300 mm (Traglast 150/230) sowie 1500 / 1700 mm (nur Traglast 200, „MS200-IV"-Linie) |
| Feldtiefe Fd | 300 / 400 / 500 / 600 mm (bei FL 1000/1300); 400 / 500 / 600 mm (bei FL 1500/1700) |
| Fachlast/Traglast | 150 / 200 / 230 kg – **330 kg fehlt in diesem Export komplett** (siehe offene Punkte) |
| Ebenen (Bodenanzahl) | 4, 5 oder 6 – **überwiegend fest an H gekoppelt** (H=2000 → 5, H=2500 → 6), aber **nicht immer**: bei FL 1500/1700 (200 kg) gibt es bei H=2500 echte Wahl zwischen 4 und 5 Ebenen als zwei separate SKUs; bei FL 1300 + Traglast 230 + Längsriegel ist die Ebenenzahl 1 niedriger als der H-Standard (4 statt 5 bzw. 5 statt 6). |
| Oberfläche/Farbe | verzinkt / RAL 7035 (genau 2 Optionen, sonst nichts) |
| doppelseitig | ja/nein, als vollwertiges eigenes Attribut bestätigt (68 bzw. 68 von 272 Grundregalen sind doppelseitig, ohne/mit Längsriegel je 56 zusätzlich) |

**3. „Längsriegel" – geklärt (Nutzer-Feedback, 29.07., präzisiert durch Komponenten-Export):** Der Längsriegel ist eine **Alternative** zur zeilenlangen Diagonalstab-Verstrebung (Zubehör-Typ K, Abschnitt 5) – **bei Längsriegel-Ausführung wird kein Diagonalstab verbaut**. Beide sind eigenständige, nach FL bemessene Zusatzbauteile zwischen den Rahmen, **nicht** die werksseitige Verstrebung innerhalb eines einzelnen Rahmens (die bleibt in jedem Fall bestehen, siehe Abschnitt 2.2). Damit hat jede Regal-SKU genau eine von zwei zeilenlangen Aussteifungsvarianten, „Diagonalstab" oder „Längsriegel" – der Ständerrahmen selbst (T1N/T2N) ist davon unabhängig. **Erkennung ebenfalls geklärt:** Das Attribut ist immer direkt aus den Produktdaten ablesbar – im Onlineshop-Namen ausgeschrieben („Längsriegel") bzw. im Kurztext als Kürzel „LR" – **keine Ableitung aus anderen Attributen nötig**, unser bisheriges Parsing (Abschnitt 11) deckt das schon korrekt ab. **Auswahlregel geklärt (29.07.): Aussteifung ist frei wählbar.** Damit wird `Aussteifung` ein vollwertiger, eigenständiger Konfigurationsparameter (wie Farbe oder doppelseitig), keine abgeleitete/erzwungene Regel.

**Neue Anforderung – Varianten-Wechsel auf der Shop-Produktseite (Nutzer, 29.07.):** Von einer Grundregal-/Anbauregal-Produktseite (z. B. Diagonalstrebe-Ausführung) soll direkt zur passenden Längsriegel-Ausführung desselben Produkts gesprungen werden können (gleiches H/FL/Fd/Traglast/Farbe/doppelseitig/Ebenen, nur Aussteifung unterschiedlich) – wie ein klassischer Varianten-Switch (Farbe/Größe) im Shop. Die Aussteifung liegt dafür schon als **Eigenschaftsfeld im PIM** vor. Zwei mögliche Umsetzungswege, je nachdem wie Shopware die Produkte aktuell modelliert:

- ~~Weg A – echte Shopware-Varianten~~ (verworfen, Umbau zu groß für aktuelles Setup)
- **Weg B – leichtgewichtige Querverlinkung (Entscheidung, 29.07.):** Produkte bleiben eigenständig, wie aktuell im PIM-Export (eigene GTIN/IFS/SAP je Artikel). Pro Produkt wird das „Aussteifungs-Pendant" ermittelt und referenziert. Zwei Umsetzungsoptionen dafür, noch offen welche:
  - **B1 – Laufzeit-Matching:** Beim Rendern der Produktseite wird im Katalog nach einem Artikel mit identischem H/FL/Fd/Traglast/Farbe/doppelseitig/Ebenen, aber umgekehrter Aussteifung gesucht (genau die Matching-Logik aus Abschnitt 11, Punkt 2, nur mit Aussteifung als Unterscheidungsmerkmal statt als Filter). Kein zusätzliches PIM-Feld nötig, dafür Matching-Code an zwei Stellen (Produktseite + CPQ) konsistent halten.
  - **B2 – vorab im PIM verknüpft:** Ein neues Referenzfeld pro Artikel („Aussteifungs-Pendant-GTIN"), einmalig beim PIM-Import berechnet und gepflegt. Produktseite liest nur das Feld, kein Matching zur Laufzeit. Robuster gegen Dateninkonsistenzen (z. B. falls doch mal kein exaktes Pendant existiert), aber ein zusätzliches Pflegefeld im PIM.
  - Für den ersten Wurf reicht vermutlich B1 (dieselbe Matching-Logik brauchen wir ohnehin für den CPQ-Katalogabgleich, siehe unten) – B2 wäre eine spätere Optimierung, falls Laufzeit-Matching zu langsam oder fehleranfällig wird.

Dasselbe Muster (Pendant-Suche über Gleichheit aller Attribute bis auf eines) gilt vermutlich auch für Farbe (verzinkt ↔ RAL 7035) und doppelseitig – die Matching-Logik lässt sich also generisch für „finde Pendant, das sich nur in Attribut X unterscheidet" bauen, nicht Aussteifung-spezifisch.

**4. Traglast/Fd/FL-Matrix stimmt mit Abschnitt 3.2/3.3 überein:** 230 kg bei Fd 300–800 (FL 1000/1300), 150 kg bei Fd 300–600 (FL 1000/1300), 200 kg bei Fd 400–600 (FL 1500/1700) – deckt sich mit der aus dem Systemkomponenten-PDF abgeleiteten Tabelle. **330 kg ist im Grundregal/Anbauregal-Katalog nicht vertreten** – möglicherweise nur für Zwischenboden-Nachrüstung, nicht als komplettes Regal, vertrieben.

**5. Identifikatoren pro SKU vollständig vorhanden:** Artikelnummer IFS, GTIN und SAP-Nummer sind bei allen 544 Zeilen gefüllt – gute Basis für den späteren Datenbank-Join. Das Feld „GLB-Datei" ist dagegen in diesem Export bei **allen** Zeilen leer – die GLB-Zuordnung pro SKU ist also (noch) nicht im PIM gepflegt und muss separat geklärt werden (evtl. über eine andere Objektklasse/Beziehung im PIM).

**Vorgeschlagene Ziel-Architektur fürs Plugin (angepasst an die realen Daten):**

1. **Katalog-Sync:** Aus der Shopware-/PIM-Datenbank wird pro Artikel ein normalisierter Datensatz gelesen: `{sku (Artikelnummer IFS/GTIN/SAP), typ: Grundregal|Anbauregal, doppelseitig, laengsriegel, H, FL, Fd, traglast, ebenen, farbe, glbDatei?, preis, verfügbarkeit}`.
2. **Konfigurator-Eingabe** (Zielhöhe, Zieltiefe, Ziel-Zeilenlänge, Traglastklasse, Farbe, einseitig/doppelseitig, **Aussteifung: Diagonalstrebe | Längsriegel, frei wählbar**) wird gegen den echten Katalog gematcht:
   - Schritt 1: passende **Grundregal-SKU** für H/Fd/Traglast/Farbe/doppelseitig/Aussteifung finden (liefert Startfeld inkl. 2 Rahmen + die für diese Kombination hinterlegte feste Ebenenzahl – bzw. bei H=2500+FL1500/1700 eine Auswahl zwischen zwei Ebenenzahlen).
   - Schritt 2: restliche Ziellänge mit **Anbauregal-SKUs** derselben Klasse auffüllen – FL kann 1000 **oder** 1300 mm sein (bzw. 1500/1700 in der 200-kg-Linie), d. h. **echtes Bin-Packing über die verfügbaren FL-Werte**, nicht mehr die einfache Floor-Division des aktuellen Dummy-Tools.
   - Schritt 3: keine exakte Kombination erreicht Ziellänge → nächstkleinere erreichbare Länge anbieten (nie länger als eingegeben), optional nächstgrößere als Alternative.
3. **Geometrie-/GLB-Modell (Abschnitt 2) bleibt für die 3D-Visualisierung gültig** – es beschreibt weiterhin, *wie* ein Feld aus Rahmen+Böden aufgebaut ist. Die GLB-pro-SKU-Zuordnung fehlt aber noch (siehe Punkt 5 oben) und muss vor einer echten Plugin-Integration geklärt werden.

**Offen/klärungsbedürftig aus diesem Export:** (a) ~~Was genau ist „Längsriegel" technisch, Auswahlregel, Varianten-Switch-Weg~~ – **vollständig geklärt:** Alternative zur Diagonalstrebe, immer direkt im Namen/Kurztext erkennbar, frei wählbar, Varianten-Switch über Weg B (Querverlinkung), Umsetzungsdetail B1 vs. B2 siehe oben. (b) Warum fehlt die 330-kg-Traglast im Grundregal/Anbauregal-Katalog – ist das Absicht? (c) ~~Wie wird GLB↔SKU im PIM tatsächlich verknüpft~~ – **geklärt (siehe Abschnitt 2.1):** GLB-Dateiname beginnt immer mit der GTIN (des Regals oder des Einzelteils). Zusätzlich geklärt: aktuell existieren GLBs nur als generische Einzelteile (Ständer, Boden), noch nicht als fertige Komplett-SKU; Ständer-Geometrie reduziert sich auf zwei Typen T1N (H≤2000mm) / T2N (H>2000mm). (d) Dieser Export enthält nur die Produktlinie „S3" – gibt es weitere Linien (Standard-CLIP ohne „S3", CLIP SPLIT) mit eigenen Grundregal/Anbauregal-Katalogen, die ebenfalls relevant sind?

---

## 12. Vorschlag für nächsten Schritt (Katalog-Anbindung)

Mit dem PIM-Export (Abschnitt 11) ist die Werte-Matrix jetzt belastbar bekannt. Sinnvolle nächste Schritte, sobald du dazu Rückmeldung hast:

1. Klärung der verbleibenden offenen Punkte aus Abschnitt 11: Auswahlregel Diagonalstrebe/Längsriegel (frei wählbar oder vorgeschrieben?), fehlende 330-kg-SKUs, weitere Produktlinien außer „S3". Die GLB↔SKU-Verknüpfung (GTIN-Präfix) und die Ständer-Vereinfachung (T1N/T2N) sind geklärt, siehe Abschnitt 2.1.
2. Die Bin-Packing-Logik für die Zeilenlänge (Kombination aus 1000er/1300er bzw. 1500er/1700er Anbauregal-SKUs) als konkreten Algorithmus/Pseudocode ausformulieren und im Tool testen, sobald geklärt ist, ob innerhalb einer Zeile unterschiedliche FL gemischt werden dürfen oder ob eine Zeile immer eine einheitliche FL hat.
3. Preis- und Verfügbarkeitsfelder liegen im aktuellen Export nicht vor – falls die CPQ-Logik auch Preisberechnung/Verfügbarkeitsprüfung übernehmen soll, bräuchten wir einen ergänzenden Export mit diesen Feldern.
