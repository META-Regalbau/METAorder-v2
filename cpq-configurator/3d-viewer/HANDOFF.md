# Handoff: echte 3D-Ansicht für den META CLIP Web-Konfigurator

Dieser Ordner enthält den aktuellen Stand des Diagonalstab/Fachbodenregal-3D-Prototyps
aus der Cowork-Session, aufbereitet zur Weiterarbeit mit Claude Code direkt in diesem
Repo. Ziel: den `image-slot`/`viewport`-Platzhalter in `../index.html` (aktuell eine
SVG-Linienzeichnung, siehe `schematic()` ab Zeile ~512) durch eine echte Three.js-3D-Ansicht
mit realen META-GLB-Bauteilen ersetzen oder ergänzen.

## Was hier liegt

```
3d-viewer/
├── viewer.html                                  ← eigenständiger Prototyp (Three.js r128, vanilla JS)
├── assets/glb/
│   ├── frame_plain.glb           (2000 mm Ständerrahmen, unkomprimiert)
│   ├── frame2500_plain.glb       (2500 mm Ständerrahmen, unkomprimiert)
│   ├── shelf_plain.glb           (Fachboden MS150, unkomprimiert)
│   └── diagonalstab_plain.glb    (Diagonalstrebe inkl. Spannschloss/Haken, unkomprimiert)
└── Fachbodenregal_CLIP_Datenmodell_Standardregal.md   ← komplette Datenmodell-/Geometrie-Doku
```

`viewer.html` lädt die vier GLBs jetzt als **externe Dateien** (`assets/glb/*.glb` via
`GLTFLoader.load(...)`), nicht mehr als Base64 eingebettet wie in den Cowork-Zwischenständen
(`Fachbodenregal_CLIP_Regalzeile_v14.html`) – das war dort nur ein Trick, um in der Cowork-Chat-
Auslieferung eine einzelne, selbstständige Datei verschicken zu können. Für dieses Repo ist die
externe Variante die richtige: kleinere Diffs, normales Caching, kein 25-MB-HTML-Blob im Git-Log.
Alle vier GLBs waren zuvor mit `gltf-transform` von Draco-Kompression auf reines/uncompressed
glTF-Binary konvertiert worden (der Browser lädt sie sonst ohne extra Decoder/Worker nicht).

`viewer.html` selbst ist funktional identisch mit dem zuletzt an dich ausgelieferten Stand
(v14): 2000/2500-mm-Rahmen, Fachböden, Diagonalstrebe korrekt im Lochraster eingehängt (50 mm-
Raster, 25 mm-Phasenversatz, Hakenrichtung und Z-Tiefe per Nutzer-Feedback iterativ korrigiert –
volle Historie in der `.md`-Datei, Abschnitt 5 "Aussteifung / Diagonalstrebe").

## Integrationspunkt in `index.html`

- Der Platzhalter ist die `schematic(c)`-Funktion (ca. Zeile 512–599) und wird in `render()`
  (ca. Zeile 665) als `'<div class="viewport">' + schematic(c) + ...` eingesetzt.
- State-Objekt `s` (ca. Zeile 360ff) hat aktuell: `felder` (Bays), `hoehe` (2000/2500),
  `breite` (Feldbreite/FL), `tiefe` (Fd), `boeden` (Ebenen), `last` (Traglastklasse),
  `rear` (Rückwand ja/nein), `surface` (Farbe/Beschichtung).
- Mapping zu `viewer.html`s Parametern (siehe dort `#fieldCount`, `#heightSelect`,
  `#levels`, `#aussteifungSelect`):
  - `s.felder` → `fieldCount`
  - `s.hoehe` → `heightSelect` (2000/2500, beide bereits als echtes GLB vorhanden)
  - `s.boeden` → `levels`
  - `s.breite` → aktuell im Viewer fix auf 1000 mm (`FL`-Konstante); nur eine Feldbreite
    real vermessen, siehe "Offene Punkte" unten
  - `s.tiefe`, `s.last`, `s.rear`, `s.surface` → im Viewer noch **nicht** abgebildet
    (Rahmen-GLB ist aktuell nur für Fd=500 mm vermessen, Rückwand/Beschichtung haben keine
    eigene GLB-Variante)
  - Aussteifung (Diagonalstab) existiert im Viewer, aber **nicht** als Konfigurator-Attribut
    in `index.html`/`s` – müsste dort als neues Feld ergänzt werden, siehe Datenmodell-Doku
    Abschnitt 11 ("Aussteifung ist frei wählbar, gleichrangig zu Farbe/doppelseitig").

## Naheliegender nächster Schritt

1. `viewer.html`s Rebuild-Logik (Funktionen `rebuild()`, `makeDiagonal()`, `placeDiagonal()` etc.)
   aus einer eigenen `<script>`+Panel-UI in ein Modul umbauen, das nur eine `THREE.Scene`/Renderer
   liefert und Parameter als Funktionsargumente statt über DOM-`<input>`-Elemente entgegennimmt –
   damit lässt es sich sauber aus `index.html`s bestehendem `s`-State-Objekt heraus ansteuern statt
   über ein eigenes Formular.
2. Diese Scene-Erzeugung anstelle von (oder als Toggle neben) `schematic(c)` in den `viewport`-Div
   rendern; ggf. dafür `<canvas>` statt SVG in `render()` einsetzen.
3. Fehlende Zuordnungen aus der Mapping-Liste oben klären, sobald weitere Fd-/Farb-/Rückwand-Varianten
   als GLB vorliegen.

## Offene Punkte (siehe Datenmodell-Doku für Details)

- Nur eine Feldbreite (1000 mm) und eine Feldtiefe (500 mm) sind aktuell als echtes GLB vermessen;
  der Konfigurator erlaubt aber mehr Kombinationen (Abschnitt 11 der `.md`).
- Kappe oben (2 mm) ist im Viewer noch ein Platzhalter-Mesh, kein echtes GLB.
- Rückwand, Beschichtung/Farbe und Längsriegel (Alternative zum Diagonalstab) haben noch keine
  3D-Repräsentation.
- Exaktes META-Platzierungsraster der Diagonalstrebe (850-mm-Modul + Versatz DH) ist weiterhin nur
  angenähert (siehe `.md`, Abschnitt 5) – aktuelle Logik hängt an der Einhängehöhe + Lochraster-
  Kollisionsvermeidung, nicht an der offiziellen Montagevorschrift.

Diese Datei ist ein reiner Übergabe-Vermerk aus der Cowork-Session, kein Teil der eigentlichen
Konfigurator-Doku – kann bei Bedarf gelöscht/zusammengeführt werden, sobald die Integration steht.
