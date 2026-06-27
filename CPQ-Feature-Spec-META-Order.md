# CPQ-Modul für META Order – Feature-Spezifikation

> **Zweck:** Dieses Dokument beschreibt die Anforderungen für ein CPQ-Modul (Configure, Price, Quote), das in die bestehende META Order Anwendung integriert wird. Es dient als Arbeitsgrundlage für die Entwicklung in Cursor.
>
> **Stand:** Februar 2026
> **Autor:** Olli / Claude

---

## 1. Kontext & Ausgangslage

META Order ist eine bestehende Anwendung, die bereits mit Shopware 6 integriert ist. Folgendes ist bereits vorhanden:

- **Shopware-API-Anbindung** – Produktdaten (Preise, technische Eigenschaften, Texte, Medien) werden aus dem Shop geladen und sind immer synchron mit der PIM
- **Cross-Selling-System** – Bestehende Logik für Produktempfehlungen
- **Produktkatalog** – Alle Artikel sind im Shop gepflegt inkl. Custom Fields und Properties
- **GLB-Dateien** – 3D-Modelle der Artikel sind als GLB vorhanden (über Shopware Media)

Das CPQ-Modul ergänzt META Order um eine **Konfigurations- und Regelschicht**, die auf den bestehenden Shopware-Daten aufsetzt.

---

## 2. Zielsetzung

Das CPQ-Modul soll:

1. Ein **Regelsystem** für Regalkonfigurationen bereitstellen (welche Teile passen zusammen, was ist technisch zulässig, welche Mengen ergeben sich)
2. Einen **visuellen Konfigurator** bieten, mit dem Kunden Regalzeilen zusammenstellen können
3. Das bestehende **Cross-Selling intelligent machen**, indem es auf die CPQ-Regeln zugreift statt auf statische Zuordnungen
4. Eine **3D-Vorschau** des konfigurierten Regals ermöglichen (unter Nutzung der vorhandenen GLB-Dateien)
5. Eine **Admin-Oberfläche** für die Pflege von Regeln und Komponentenbeziehungen bereitstellen

---

## 3. Datenmodell

### 3.1 Grundprinzip

Die Produktstammdaten (Preise, Beschreibungen, Eigenschaften, Medien) kommen ausschließlich aus Shopware. Das CPQ-Modul fügt eine **Beziehungs- und Regelschicht** hinzu, die in einer eigenen Datenbank liegt.

### 3.2 Entitäten

#### System (`cpq_systems`)

Die oberste Gruppierungsebene. Ein System (z.B. "META CLIP", "META FIX", "Palettenregal") definiert, welche Komponenten miteinander kompatibel sind.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| name | String | Anzeigename (z.B. "META CLIP") |
| slug | String | URL-freundlicher Bezeichner |
| description | Text | Beschreibung des Systems |
| status | Enum | `active`, `draft`, `archived` |
| created_at | Timestamp | Erstelldatum |
| updated_at | Timestamp | Letzte Änderung |

#### Komponententyp (`cpq_component_types`)

Definiert die Rollen innerhalb eines Systems. Jeder Komponententyp hat spezifische Attribute.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| system_id | UUID → cpq_systems | Zugehöriges System |
| name | String | Typname (z.B. "Steher", "Traverse", "Fachboden") |
| role | Enum | `frame`, `beam`, `shelf`, `accessory`, `connector` |
| required | Boolean | Pflichtkomponente in jeder Konfiguration? |
| sort_order | Integer | Reihenfolge im Konfigurator |
| icon | String | Icon-Bezeichner für die UI |
| attribute_schema | JSON | Definiert die technischen Attribute dieses Typs |

**Beispiel `attribute_schema` für Steher:**
```json
{
  "height": { "type": "number", "unit": "mm", "label": "Höhe" },
  "depth": { "type": "number", "unit": "mm", "label": "Tiefe" },
  "load_capacity": { "type": "number", "unit": "kg", "label": "Tragfähigkeit" },
  "hole_pattern_start": { "type": "number", "unit": "mm", "label": "Lochraster Start" },
  "hole_pattern_pitch": { "type": "number", "unit": "mm", "label": "Lochraster Abstand" }
}
```

#### Produktzuordnung (`cpq_product_mapping`)

Verknüpft Shopware-Produkte mit CPQ-Komponenten. Das ist die zentrale Brücke zwischen Shop und CPQ.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| shopware_product_id | String | Shopware Produkt-ID |
| shopware_product_number | String | Artikelnummer (für schnelle Zuordnung) |
| system_id | UUID → cpq_systems | Zugehöriges System |
| component_type_id | UUID → cpq_component_types | Komponententyp |
| attributes | JSON | Technische Attribute gemäß attribute_schema |
| status | Enum | `active`, `inactive`, `pending_review` |

#### Geometriedaten (`cpq_geometry`)

Speichert die 3D-Ankerpunkte und Geometrie-Metadaten für die visuelle Zusammensetzung.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| product_mapping_id | UUID → cpq_product_mapping | Zugehörige Produktzuordnung |
| origin | JSON | Ursprungspunkt `{ x, y, z }` |
| anchor_points | JSON | Array von Ankerpunkten mit Typ und Position |
| bounding_box | JSON | `{ width, height, depth }` in mm |
| glb_asset_url | String | URL zur GLB-Datei (aus Shopware Media) |
| lod_levels | JSON | Optional: URLs für verschiedene Detail-Level |

**Beispiel `anchor_points` für einen Steher:**
```json
[
  { "id": "top", "position": { "x": 0, "y": 2000, "z": 0 }, "type": "connector" },
  { "id": "bottom", "position": { "x": 0, "y": 0, "z": 0 }, "type": "floor" },
  { "id": "beam_left", "position": { "x": -25, "y": 0, "z": 0 }, "type": "beam_slot", "pattern": "repeat_y", "start": 50, "pitch": 25 },
  { "id": "beam_right", "position": { "x": 25, "y": 0, "z": 0 }, "type": "beam_slot", "pattern": "repeat_y", "start": 50, "pitch": 25 }
]
```

#### Regeln (`cpq_rules`)

Das Herzstück des CPQ – alle Beziehungen und Bedingungen.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| system_id | UUID → cpq_systems | Zugehöriges System |
| name | String | Interner Regelname |
| type | Enum | `compatibility`, `physical`, `configuration`, `business` |
| priority | Integer | Auswertungsreihenfolge (niedrig = zuerst) |
| condition | JSON | Bedingungsausdruck |
| action | JSON | Aktion bei erfüllter Bedingung |
| fallback | JSON | Optional: Aktion bei nicht erfüllter Bedingung |
| message | String | Nutzer-sichtbare Nachricht |
| status | Enum | `active`, `draft`, `disabled` |
| version | Integer | Versionsnummer |
| created_by | String | Ersteller |
| created_at | Timestamp | Erstelldatum |
| updated_at | Timestamp | Letzte Änderung |

#### Regelversionen (`cpq_rule_versions`)

Versionierung für Audit-Trail und Rollback.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| rule_id | UUID → cpq_rules | Zugehörige Regel |
| version | Integer | Versionsnummer |
| condition | JSON | Bedingung dieser Version |
| action | JSON | Aktion dieser Version |
| changed_by | String | Wer hat geändert |
| changed_at | Timestamp | Wann wurde geändert |
| change_note | Text | Optional: Änderungsnotiz |

#### Konfigurationen (`cpq_configurations`)

Gespeicherte Kundenkonfigurationen.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| system_id | UUID → cpq_systems | Verwendetes System |
| customer_id | String | Shopware Kunden-ID (optional) |
| name | String | Name der Konfiguration |
| config_data | JSON | Komplette Konfiguration (Felder, Ebenen, Artikel, Mengen) |
| validation_status | Enum | `valid`, `warnings`, `errors` |
| total_price | Decimal | Berechneter Gesamtpreis |
| created_at | Timestamp | Erstelldatum |
| updated_at | Timestamp | Letzte Änderung |

---

## 4. Regelwerk (Constraint Engine)

### 4.1 Regeltypen

#### Kompatibilitätsregeln

Definieren, welche Komponenten zusammenpassen. Diese Regeln werden sowohl im Konfigurator als auch für das Cross-Selling verwendet.

**Beispiel:** "Traverse 1300mm ist kompatibel mit allen CLIP-Stehern der Tiefe 400mm und 500mm"

```json
{
  "type": "compatibility",
  "condition": {
    "source": { "component_type": "beam", "attribute": "width", "value": 1300 },
    "target": { "component_type": "frame", "attribute": "depth", "operator": "in", "value": [400, 500] }
  },
  "action": { "type": "allow" }
}
```

#### Physikalische Regeln

Technische Grenzwerte und Sicherheitsvorschriften.

**Beispiel:** "Wandverankerung erforderlich ab 2500mm Höhe"

```json
{
  "type": "physical",
  "condition": {
    "component_type": "frame",
    "attribute": "height",
    "operator": ">",
    "value": 2500
  },
  "action": { "type": "require_component", "target_type": "accessory", "target_attribute": "subtype", "target_value": "wall_anchor" },
  "message": "Ab 2500mm Regalhöhe ist eine Wandverankerung vorgeschrieben"
}
```

#### Konfigurationsregeln

Automatische Mengenberechnung und Stücklistenlogik.

**Beispiel:** "Anzahl Steher = Felder + 1"

```json
{
  "type": "configuration",
  "calculation": "config.frame_quantity = config.field_count + 1",
  "description": "Stückzahl Steher ergibt sich aus der Anzahl Felder plus eins"
}
```

**Beispiel:** "Pro Ebene 2 Traversen (vorne/hinten) pro Feld"

```json
{
  "type": "configuration",
  "calculation": "config.beam_quantity = config.level_count * config.field_count * 2",
  "description": "Jede Ebene benötigt zwei Traversen pro Feld"
}
```

**Beispiel:** "Feldlast = Minimum aus Traversentragfähigkeit und Bodentragfähigkeit"

```json
{
  "type": "configuration",
  "calculation": "config.max_field_load = min(selected_beam.load_capacity, selected_shelf.load_capacity)",
  "description": "Die maximale Feldlast wird vom schwächsten Bauteil bestimmt"
}
```

#### Geschäftsregeln

Vertriebssteuerung und Bestelllogik.

**Beispiel:** "Sonderhöhen nur auf Anfrage"

```json
{
  "type": "business",
  "condition": {
    "component_type": "frame",
    "attribute": "height",
    "operator": "not_in",
    "value": [1800, 2000, 2200, 2500, 3000]
  },
  "action": { "type": "set_mode", "value": "inquiry" },
  "message": "Sonderhöhen sind nur auf Anfrage verfügbar"
}
```

### 4.2 Regelauswertung

Die Engine wertet Regeln in dieser Reihenfolge aus:

1. **Kompatibilitätsregeln** – Filtert zulässige Komponenten
2. **Physikalische Regeln** – Validiert technische Grenzen
3. **Konfigurationsregeln** – Berechnet Mengen und abgeleitete Werte
4. **Geschäftsregeln** – Wendet Vertriebslogik an

Bei jedem Änderungsschritt im Konfigurator werden alle relevanten Regeln neu ausgewertet. Die UI aktualisiert sich entsprechend (ungültige Optionen ausgrauen, Warnungen anzeigen, Mengen aktualisieren).

### 4.3 Regelauswertung für Cross-Selling

Das bestehende Cross-Selling-System in META Order soll die CPQ-Regeln als Datenquelle nutzen. Der Cross-Selling-Service erhält den aktuellen Warenkorb-Inhalt und gibt zurück:

- **Pflicht-Artikel** – Aus physikalischen Regeln abgeleitet (z.B. Wandverankerung bei hohen Regalen). Anzeige als dringende Empfehlung mit Begründung.
- **Passende Ergänzungen** – Aus Kompatibilitätsregeln abgeleitet (z.B. passende Fachböden zur gewählten Traverse). Anzeige als "Passt zu Ihrer Auswahl".
- **Optionales Zubehör** – Aus Geschäftsregeln abgeleitet (z.B. Beschriftung, Rückwände). Anzeige als "Häufig dazu bestellt".

Die API dafür:

```
POST /api/cpq/cross-selling
Body: { "cart_items": [{ "product_id": "...", "quantity": 1 }] }

Response: {
  "required": [{ "product_id": "...", "reason": "...", "rule_id": "..." }],
  "recommended": [{ "product_id": "...", "reason": "...", "compatibility_score": 0.95 }],
  "optional": [{ "product_id": "...", "category": "Zubehör" }]
}
```

Zusätzlich kann der Cross-Selling-Service den Warenkorb **validieren**:

```
POST /api/cpq/validate-cart
Body: { "cart_items": [...] }

Response: {
  "valid": false,
  "errors": [{ "type": "missing_component", "message": "Keine Fußplatten im Warenkorb", "suggestion": {...} }],
  "warnings": [{ "type": "suboptimal", "message": "Wandverankerung empfohlen bei dieser Höhe" }]
}
```

---

## 5. Konfigurator (Wizard)

### 5.1 Ablauf

Der Konfigurator führt den Benutzer in Schritten durch die Regalplanung:

**Schritt 1 – System wählen**
- Zeigt alle verfügbaren Regalsysteme
- Optional: Bedarfsermittlung ("Was möchten Sie lagern?" → System-Empfehlung)
- Nach Auswahl werden alle weiteren Optionen durch das gewählte System gefiltert

**Schritt 2 – Grundmaße definieren**
- Höhe des Regals (Dropdown oder Eingabe, validiert gegen verfügbare Steher)
- Tiefe des Regals (Dropdown, gefiltert nach System)
- Anzahl Felder nebeneinander (1–n)
- Feldweite pro Feld (gefiltert nach kompatiblen Traversen)
- Die Constraint Engine validiert in Echtzeit und zeigt Hinweise

**Schritt 3 – Ebenen konfigurieren**
- Anzahl der Fachebenen
- Bodentyp pro Ebene (gefiltert nach Kompatibilität mit gewählter Traverse)
- Fachlast pro Ebene (validiert gegen berechnete max. Feldlast)
- Höhenverteilung der Ebenen (gleichmäßig oder individuell)

**Schritt 4 – Zubehör**
- Pflicht-Zubehör wird automatisch vorausgewählt (aus Regelwerk)
- Optionales Zubehör wird als Empfehlung angezeigt
- Fußplatten, Rückwände, Seitenverkleidungen, Beschriftung, Anfahrschutz

**Schritt 5 – Zusammenfassung**
- Vollständige Stückliste mit Mengen und Preisen
- Gesamtpreis (ggf. mit Mengenstaffeln)
- 3D-Vorschau des konfigurierten Regals
- Aktionen: In den Warenkorb, Als Angebot speichern, PDF exportieren, Konfiguration speichern

### 5.2 Live-Vorschau

Neben dem Wizard wird das Regal in Echtzeit aufgebaut. Die Vorschau nutzt die GLB-Dateien und die Geometrie-Daten:

- Bei jedem Konfigurationsschritt aktualisiert sich die 3D-Ansicht
- Die Komponenten werden anhand der Ankerpunkte korrekt positioniert
- Der Benutzer kann die Ansicht drehen, zoomen und schwenken
- Einfache WebGL-Darstellung (three.js / model-viewer), keine fotorealistische Qualität nötig

---

## 6. Admin-Oberfläche (Regel-Verwaltung)

### 6.1 Systemübersicht

- Listet alle Regalsysteme mit Status (Aktiv/Entwurf/Archiviert)
- Zeigt pro System: Anzahl Komponenten, Anzahl Regeln, letzter Sync-Status mit Shopware
- Button zum Erstellen eines neuen Systems

### 6.2 Beziehungsgraph

- Interaktive Visualisierung des gewählten Systems
- Zentraler Knoten = System, darum gruppiert die Komponententypen, außen die einzelnen Artikel
- Verbindungslinien zeigen Kompatibilität (durchgezogen = immer, gestrichelt = bedingt)
- Klick auf einen Knoten: zeigt Detailpanel mit Stammdaten, CPQ-Daten und aktiven Regeln
- Klick auf eine Regel: hebt alle betroffenen Knoten und Verbindungen im Graphen hervor (Dependency Map)
- Zoom, Pan, Suchfunktion

### 6.3 Regel-Editor

Zwei Modi:

**Geführter Modus:**
- WENN → Komponententyp → Eigenschaft → Operator → Wert
- DANN → Aktion → Ziel
- SONST → Alternative Aktion (optional)
- UND/ODER-Verknüpfung mehrerer Bedingungen
- Die Dropdown-Optionen passen sich kontextbezogen an (wenn "Steher" gewählt, zeigt Eigenschaft nur Steher-Attribute)

**Experten-Modus:**
- Editierbarer JSON-Editor mit Syntax-Highlighting
- Validierung des JSON gegen das Regelschema
- Für komplexe Berechnungen und verschachtelte Bedingungen

### 6.4 Sicherheitsmechanismen

- **Impact-Analyse vor dem Speichern** – Zeigt an, wie viele Konfigurationen und Angebote von einer Regeländerung betroffen wären
- **Staging/Entwurf** – Regeländerungen gehen erst in den Status `draft` und können von einem zweiten Nutzer freigegeben werden
- **Versionierung** – Jede Änderung wird versioniert mit Benutzer, Zeitstempel und optionaler Notiz
- **Rollback** – Jede Regel kann auf eine vorherige Version zurückgesetzt werden
- **Validierung** – Beim Speichern prüft das System auf Regelkonflikte (widersprüchliche Regeln, Zirkelbezüge)

### 6.5 Massenoperationen

- Beim Hinzufügen eines neuen Artikels: automatische Erkennung, welche Regeln greifen könnten (basierend auf Typ und Attributen)
- Bulk-Zuweisung: "Dieser neue Steher ist kompatibel mit allen Traversen, die Eigenschaft X haben"
- Import/Export von Regelsets als JSON

---

## 7. APIs

### 7.1 Konfigurator-API

```
GET  /api/cpq/systems                           → Liste aller aktiven Systeme
GET  /api/cpq/systems/:id/components             → Alle Komponenten eines Systems
GET  /api/cpq/systems/:id/options?step=2&config={} → Verfügbare Optionen für Schritt X basierend auf bisheriger Konfiguration
POST /api/cpq/configure                          → Konfiguration validieren & Stückliste berechnen
POST /api/cpq/configurations                     → Konfiguration speichern
GET  /api/cpq/configurations/:id                 → Gespeicherte Konfiguration laden
```

### 7.2 Cross-Selling-API

```
POST /api/cpq/cross-selling                      → Intelligente Empfehlungen basierend auf Warenkorb
POST /api/cpq/validate-cart                       → Warenkorb gegen Regeln validieren
```

### 7.3 Admin-API

```
GET    /api/cpq/admin/rules?system_id=...        → Alle Regeln eines Systems
POST   /api/cpq/admin/rules                      → Neue Regel erstellen
PUT    /api/cpq/admin/rules/:id                  → Regel aktualisieren (erstellt neue Version)
DELETE /api/cpq/admin/rules/:id                  → Regel deaktivieren
GET    /api/cpq/admin/rules/:id/versions         → Versionsverlauf einer Regel
POST   /api/cpq/admin/rules/:id/rollback/:version → Rollback auf Version
POST   /api/cpq/admin/rules/:id/impact           → Impact-Analyse durchführen
POST   /api/cpq/admin/mappings                   → Shopware-Produkt dem CPQ zuordnen
GET    /api/cpq/admin/sync-status                → Status der Shopware-Synchronisation
```

### 7.3 3D-Vorschau-API

```
POST /api/cpq/preview/scene                      → Szene-Daten für eine Konfiguration (Positionen, GLB-URLs, Transformationen)
```

---

## 8. Integration mit bestehendem Cross-Selling

Das vorhandene Cross-Selling-System in META Order wird um eine **CPQ-Quelle** erweitert:

1. **Neue Datenquelle registrieren** – Das CPQ-Modul meldet sich als Cross-Selling-Provider an
2. **Priorisierung** – CPQ-basierte Empfehlungen haben Vorrang vor statischen Zuordnungen, da sie kontextbezogen sind
3. **Fallback** – Wenn für ein Produkt keine CPQ-Zuordnung existiert, greift das bestehende Cross-Selling
4. **UI-Erweiterung** – CPQ-Empfehlungen zeigen zusätzlich eine Begründung an ("Pflicht bei dieser Konfiguration", "Passt zu Ihrer Traverse")

---

## 9. 3D-Vorschau – Technische Anforderungen

### 9.1 Modularer Aufbau

Jede Komponente wird als eigenständiges GLB-Modell geladen. Der Viewer setzt die Szene anhand der Konfigurationsdaten zusammen:

- Position jeder Komponente ergibt sich aus den Ankerpunkten und der Konfigurationslogik
- Steher werden in gleichmäßigen Abständen (= Feldweite) platziert
- Traversen werden auf der gewählten Höhe zwischen zwei Stehern eingehängt
- Böden werden auf die Traversen aufgelegt

### 9.2 Performance

- **Instancing** – Gleiche Modelle (z.B. alle Steher) nur einmal laden und per GPU-Instancing vervielfältigen
- **Draco-Kompression** – GLB-Dateien sollten Draco-komprimiert sein
- **Progressive Loading** – Erst Bounding Boxes zeigen, dann GLB nachladen
- **LOD** – Bei großen Konfigurationen (>20 Felder) auf vereinfachte Modelle wechseln

### 9.3 Viewer-Features

- Orbit-Controls (Drehen, Zoomen, Schwenken)
- Maßangaben einblendbar (Gesamthöhe, Feldweiten)
- Einzelne Ebenen/Felder hervorheben bei Hover im Konfigurator
- Screenshot-Funktion für PDF-Export

---

## 10. Rabatt-Ampel (Angebotsbewertung)

### 10.1 Zweck

Sachbearbeiter und Außendienstler sollen beim Erstellen eines Angebots **sofort visuell erkennen**, ob der gewährte Rabatt wirtschaftlich vertretbar ist. Die Ampel macht Umsatzverluste sichtbar und gibt direktes Feedback – ohne dass jedes Angebot manuell vom Vertriebsleiter geprüft werden muss.

### 10.2 Funktionsweise

Die Ampel wird **neben dem Preis/Rabattfeld** im Angebot angezeigt und aktualisiert sich in Echtzeit bei jeder Rabattänderung. Sie zeigt:

- **Ampelfarbe** – Grün, Gelb, Orange, Rot (oder weitere Stufen, je nach Admin-Konfiguration)
- **Klartext-Label** – z.B. "Zielrabatt", "Grenzbereich", "Verlustzone"
- **Umsatzverlust-Anzeige** – Differenz zum Listenpreis in € und %, damit der Sachbearbeiter den konkreten Betrag sieht
- **Marge-Indikator** – Optional: Anzeige der verbleibenden Marge in %

### 10.3 Admin-konfigurierbare Stufen

Der Admin definiert die Ampelstufen über die Admin-Oberfläche. Jede Stufe hat:

| Feld | Beschreibung |
|------|--------------|
| Name | Anzeigename (z.B. "Zielrabatt", "Erhöht", "Kritisch", "Verlustzone") |
| Farbe | Hex-Farbwert für die Ampel |
| Icon | Optional: Emoji oder Icon |
| Rabatt von / bis | Prozent-Bereich, für den diese Stufe gilt |
| Nachricht | Text, der dem Sachbearbeiter angezeigt wird |
| Freigabe erforderlich | Boolean: Muss ein Vorgesetzter freigeben? |
| Benachrichtigung | Optional: E-Mail/Notification an Vertriebsleitung |

**Beispiel-Konfiguration:**

| Stufe | Farbe | Rabatt-Bereich | Nachricht | Freigabe |
|-------|-------|---------------|-----------|----------|
| Optimal | 🟢 Grün | 0 – 10% | "Standardrabatt – Angebot kann direkt raus" | Keine Prüfung |
| Erhöht | 🟡 Gelb | 10 – 18% | "Erhöhter Rabatt – Freigabe durch Abteilungsleiter erforderlich" | Abteilungsleiter |
| Kritisch | 🟠 Orange | 18 – 25% | "Kritischer Rabatt – Umsatzverlust: {verlust}€ – Freigabe durch GF erforderlich" | Geschäftsführung |
| Gesperrt | 🔴 Rot | 25%+ | "Rabatt nicht zulässig – Angebot kann nicht erstellt werden" | Nicht freigabefähig |

### 10.4 Freigabe-Workflow

Die Ampelfarbe bestimmt automatisch den Freigabeprozess:

**🟢 Grün – Keine Prüfung**
- Sachbearbeiter/Außendienstler kann das Angebot direkt versenden
- Keine Freigabe nötig, keine Wartezeit
- Angebot wird automatisch protokolliert

**🟡 Gelb – Prüfung durch Abteilungsleiter**
1. Sachbearbeiter erstellt Angebot → Ampel zeigt Gelb
2. Sachbearbeiter gibt **Begründung** ein (Pflichtfeld)
3. Angebot geht in Status **"Wartet auf Freigabe (AL)"**
4. Abteilungsleiter erhält Benachrichtigung mit: Ampelstatus, Rabatthöhe, Umsatzverlust, Begründung, Link zum Angebot
5. Abteilungsleiter kann: **Freigeben** (Angebot wird versandbereit), **Ablehnen** mit Kommentar (zurück an Sachbearbeiter), oder **Rabatt anpassen** und dann freigeben
6. Sachbearbeiter wird über Ergebnis benachrichtigt

**🟠 Orange – Prüfung durch Geschäftsführung**
1. Sachbearbeiter erstellt Angebot → Ampel zeigt Orange
2. Sachbearbeiter gibt **Begründung** ein (Pflichtfeld, ausführlicher: Warum ist dieser Rabatt strategisch notwendig?)
3. Angebot geht in Status **"Wartet auf Freigabe (GF)"**
4. Geschäftsführung erhält Benachrichtigung mit vollständiger Übersicht: Ampelstatus, Rabatthöhe, Umsatzverlust, Marge, Kundendaten, Begründung
5. Geschäftsführung kann: **Freigeben**, **Ablehnen** mit Kommentar, oder **Rabatt anpassen** und freigeben
6. Bei Freigabe oder Ablehnung: Sachbearbeiter und Abteilungsleiter werden benachrichtigt

**🔴 Rot – Nicht freigabefähig**
- Das Angebot kann mit diesem Rabatt **nicht erstellt** werden
- Der Rabatt-Regler/Eingabefeld wird blockiert oder das Speichern verhindert
- Der Sachbearbeiter sieht eine klare Meldung: "Dieser Rabatt überschreitet die maximal zulässige Grenze. Bitte reduzieren Sie den Rabatt auf maximal {max_rabatt}%."
- Optional: Der Sachbearbeiter kann eine **Ausnahme-Anfrage** stellen, die als gesonderter Prozess an die Geschäftsführung geht (kein normaler Freigabeprozess, sondern explizite Sonderfreigabe mit erhöhter Dokumentationspflicht)

### 10.5 Freigabe-Eskalation und Fristen

- **Erinnerung** – Wenn eine Freigabe nach X Stunden (admin-konfigurierbar, z.B. 4h) nicht bearbeitet wurde, geht eine Erinnerung an den Freigebenden
- **Eskalation** – Wenn nach Y Stunden (z.B. 24h) keine Reaktion erfolgt, wird die nächsthöhere Ebene benachrichtigt (Gelb: eskaliert an GF, Orange: Erinnerung an GF)
- **Vertretungsregelung** – Für Urlaub/Abwesenheit kann ein Stellvertreter pro Freigabe-Rolle hinterlegt werden

### 10.6 Kontextabhängige Ampelregeln

Die Ampelstufen können **kontextabhängig** definiert werden:

- **Pro Produktgruppe/System** – Regalsysteme mit höherer Marge können großzügigere Rabattstufen haben als margenschwache Produkte
- **Pro Kundengruppe** – Großkunden haben ggf. andere Schwellwerte als Einzelbestellungen
- **Pro Auftragswert** – Ab einem bestimmten Auftragswert können die Schwellen angepasst werden (z.B. bei >50.000€ gelten andere Stufen)
- **Kombination** – Regeln können kombiniert werden: "Für System META CLIP, Kundengruppe A, Auftragswert >10.000€ gilt Ampelschema X"

Die Regel-Auswertung folgt einer Prioritätskette: spezifischste Regel zuerst. Gibt es keine spezifische Regel, greift die Standard-Ampel.

### 10.7 Reporting & Auswertung

Die Ampeldaten werden für Auswertungen gespeichert:

- **Rabatt-Verteilung** – Wie viele Angebote fallen in welche Ampelstufe? Trend über Zeit.
- **Umsatzverlust-Übersicht** – Aggregierter Umsatzverlust durch Rabatte pro Monat/Quartal, aufgeschlüsselt nach Sachbearbeiter, Kundengruppe, Produktgruppe
- **Freigabe-Quote** – Wie viele Angebote brauchten Freigabe, wie viele wurden genehmigt/abgelehnt?
- **Sachbearbeiter-Vergleich** – Durchschnittlicher Rabatt und Ampelverteilung pro Sachbearbeiter (für Coaching-Gespräche, nicht als Kontrollinstrument)

### 10.8 Datenmodell-Erweiterung

#### Ampelstufen (`cpq_discount_levels`)

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| name | String | Stufenname ("Optimal", "Erhöht", "Kritisch", "Gesperrt") |
| color | String | Hex-Farbwert |
| icon | String | Optional: Icon/Emoji |
| discount_min | Decimal | Rabatt ab (%) |
| discount_max | Decimal | Rabatt bis (%) |
| message_template | String | Nachricht mit Platzhaltern ({verlust}, {marge}, {rabatt}, {max_rabatt}) |
| approval_type | Enum | `none`, `department_lead`, `management`, `blocked` |
| justification_required | Boolean | Begründung Pflichtfeld? |
| notify_roles | JSON | Array von Rollen, die benachrichtigt werden |
| escalation_hours | Integer | Stunden bis zur Erinnerung (null = keine Eskalation) |
| sort_order | Integer | Reihenfolge |
| status | Enum | `active`, `draft` |

#### Ampel-Regelzuordnung (`cpq_discount_level_rules`)

Für kontextabhängige Stufen – ordnet Ampelschemata bestimmten Kontexten zu.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| discount_level_id | UUID → cpq_discount_levels | Zugehörige Ampelstufe |
| context_type | Enum | `system`, `customer_group`, `order_value`, `default` |
| context_value | String | Wert des Kontexts (z.B. System-ID, Kundengruppen-ID) |
| priority | Integer | Auswertungsreihenfolge (spezifisch vor allgemein) |

#### Angebotsprotokoll (`cpq_quote_log`)

Speichert die Ampelbewertung pro Angebot für Reporting.

| Feld | Typ | Beschreibung |
|------|-----|--------------|
| id | UUID | Primärschlüssel |
| configuration_id | UUID → cpq_configurations | Zugehörige Konfiguration |
| user_id | String | Sachbearbeiter/Außendienstler |
| discount_percent | Decimal | Gewährter Rabatt in % |
| discount_level_id | UUID → cpq_discount_levels | Eingerastete Ampelstufe |
| list_price | Decimal | Listenpreis des Angebots |
| discounted_price | Decimal | Angebotspreis nach Rabatt |
| revenue_loss | Decimal | Umsatzverlust in € |
| justification | Text | Begründung (Pflicht bei Gelb/Orange) |
| approval_type | Enum | `none`, `department_lead`, `management`, `blocked`, `exception_request` |
| approval_status | Enum | `not_required`, `pending`, `approved`, `rejected`, `blocked` |
| approved_by | String | Freigebender Nutzer |
| approval_comment | Text | Kommentar des Freigebenden |
| approved_at | Timestamp | Zeitpunkt der Freigabe |
| escalated | Boolean | Wurde die Freigabe eskaliert? |
| created_at | Timestamp | Erstelldatum |

### 10.9 APIs

```
GET    /api/cpq/discount-levels                    → Alle aktiven Ampelstufen (mit Kontext-Auflösung)
GET    /api/cpq/discount-levels/evaluate?discount=15&system_id=...&customer_group=...&order_value=...
                                                   → Ampelstufe für konkreten Rabatt berechnen
POST   /api/cpq/admin/discount-levels              → Neue Ampelstufe anlegen
PUT    /api/cpq/admin/discount-levels/:id          → Ampelstufe bearbeiten
DELETE /api/cpq/admin/discount-levels/:id          → Ampelstufe deaktivieren
POST   /api/cpq/quotes/:id/request-approval        → Freigabe anfordern
PUT    /api/cpq/quotes/:id/approve                 → Freigabe erteilen/ablehnen
GET    /api/cpq/reporting/discount-overview?from=...&to=...  → Rabatt-Reporting
```

---

## 11. Shopware-Sync

### 11.1 Datenfluss

```
Shopware (PIM) → Shopware API → META Order → CPQ-Modul
                                     ↓
                              Produkt-Cache (lokal)
                                     +
                              CPQ-Regeldaten (eigene DB)
```

### 11.2 Sync-Strategie

- **Produktdaten:** Werden aus Shopware geladen, wenn sie benötigt werden (on-demand mit Cache). Kein separater Sync-Job nötig, da META Order bereits die Shopware-API nutzt.
- **Preise:** Immer live aus Shopware (kundenspezifische Preise, Staffeln). Kein Caching von Preisen.
- **GLB-Dateien:** URLs aus Shopware Media. Die Dateien selbst werden vom Browser geladen (CDN-fähig).
- **CPQ-Zuordnungen:** Wenn in Shopware ein Produkt gelöscht oder deaktiviert wird, sollte das CPQ-Mapping als `inactive` markiert werden.

---

## 12. Phasenplan

### Phase 1 – Datenmodell & Regelwerk
- Datenbank-Tabellen anlegen (inkl. Rabatt-Ampel-Tabellen)
- Admin-API für Regeln und Mappings
- Grundlegende Regelauswertung (Constraint Engine)
- Manuelles Mapping von Pilot-Produkten eines Systems (z.B. META CLIP Fachbodenregal)

### Phase 2 – Admin-Oberfläche
- Beziehungsgraph (Visualisierung der Systeme und Komponenten)
- Regel-Editor (geführt + Experte)
- Impact-Analyse und Versionierung
- Massenoperationen
- **Ampelstufen-Verwaltung** (Stufen definieren, Kontextregeln anlegen)

### Phase 3 – Cross-Selling-Integration & Rabatt-Ampel
- CPQ als Cross-Selling-Datenquelle anbinden
- Warenkorb-Validierung
- UI-Erweiterung mit Begründungen
- **Rabatt-Ampel im Angebotsprozess** (Live-Bewertung, Umsatzverlust-Anzeige)
- **Freigabe-Workflow** (Benachrichtigungen, Genehmigung/Ablehnung)

### Phase 4 – Konfigurator
- Wizard-UI mit Schrittlogik
- Live-Validierung gegen Regelwerk
- Stücklisten- und Preisberechnung
- Konfigurationen speichern/laden

### Phase 5 – 3D-Vorschau
- WebGL-Viewer mit GLB-Rendering
- Modularer Szenenaufbau aus Konfigurationsdaten
- Ankerpunkt-basierte Positionierung
- Performance-Optimierung (Instancing, LOD)

### Phase 6 – Erweiterungen
- PDF-Angebotsgenerierung
- Interaktive Angebotslinks
- Warenkorb-Transfer nach Shopware
- Mehrere Systeme parallel
- **Rabatt-Reporting & Dashboards** (Auswertungen, Sachbearbeiter-Vergleich, Trends)

---

## 13. Technische Festlegungen

1. **Datenbank:** PostgreSQL mit pgvector-Erweiterung (bestehende META Order DB). Die CPQ-Tabellen werden als eigenes Schema (`cpq`) in der vorhandenen Datenbank angelegt. pgvector kann perspektivisch für semantische Produktsuche und intelligente Regel-Vorschläge genutzt werden (z.B. ähnliche Produkte finden, die denselben Regeln unterliegen könnten).
2. **GLB-Optimierung:** Die GLB-Dateien werden über den bestehenden GLB Converter von META verarbeitet (STEP → KeyShot/Blender → optimiertes GLB). Die Ausgabe des Converters wird in Shopware Media abgelegt und vom CPQ-Viewer direkt referenziert. Keine zusätzliche Build-Pipeline nötig.

## 14. Offene Entscheidungen

Die folgenden Punkte sollten während der Entwicklung geklärt werden:

1. **Geometriedaten-Pflege** – Sollen die Ankerpunkte manuell in der Admin-UI gepflegt werden oder aus Blender-Exporten automatisch übernommen werden? Eine Kombination wäre denkbar: automatischer Import der Grundgeometrie aus Blender, manuelle Feinabstimmung der Ankerpunkte in der Admin-UI.
2. **Mandantenfähigkeit** – Soll das CPQ-Modul nur für META Online oder perspektivisch auch für andere Shops nutzbar sein?
3. **Offline-Fähigkeit** – Soll der Konfigurator auch ohne Netzwerkverbindung funktionieren (z.B. auf Messen)?
