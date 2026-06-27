# CPQ – Manuelle E2E-Prüfliste

Diese Checkliste dient zur Verifikation des CPQ-Moduls von Konfigurator bis Angebot und Freigabe.

## Voraussetzungen

- DB erreichbar (kein "No space left on device"), Schema/Migrationen aktuell (`npm run db:push`).
- Shopware erreichbar, **Produkt-Cache einmal befüllt** (Admin → Einstellungen → Shopware). Ohne Cache liefert die Stückliste keine Positionen („Produkt nicht im Katalog gefunden“).
- Mindestens ein CPQ-System mit Komponententypen (Rollen z. B. frame, beam, shelf) und aktiven Produkt-Mappings.
- **3D-Vorschau:** GLB-Dateien in `client/public/cpq-models` ablegen oder `CPQ_GLB_PATH` setzen (Docker: `/app/cpq-models`). Namenskonvention: z. B. nach Hersteller-Nr. (`10023_VZK.glb`) oder `GTIN_ManufNr_*.glb`. Alternativ in der CPQ-Admin pro Mapping Geometrie/GLB-URL pflegen.

---

## 1. CPQ Admin

- [ ] System anlegen/bearbeiten (Tab Systeme).
- [ ] Komponententypen mit Rollen **frame**, **beam**, **shelf** anlegen (Tab Produkt-Mappings → Komponententyp).
- [ ] Produkt-Mappings zuordnen (Shopware-Produkte den Komponententypen zuweisen).
- [ ] Mindestens eine **Konfigurationsregel** anlegen, z. B.:
  - `frame_quantity = field_count + 1`
  - `beam_quantity = level_count * field_count * 2`
  - `shelf_quantity = level_count * field_count`
- [ ] **Rabattstufen** anlegen (Tab Rabatt-Ampel), z. B.:
  - 0–10 %: grün, approval none
  - 10–18 %: gelb, department_lead
  - 18–25 %: orange, management
  - 25 %+: rot, blocked

---

## 2. Konfigurator

- [ ] **System wählen** → Maße (Höhe, Tiefe, Felder, Breite) → Ebenen → Zubehör → **Zusammenfassung**.
- [ ] Prüfen: **Stückliste** wird geladen, Positionen und **Gesamtpreis** sichtbar.
- [ ] Optional: **3D-Vorschau** (wenn Geometrie/GLB vorhanden).
- [ ] **„Als Angebot speichern“** klicken → Redirect zu Angebote, **neuer Entwurf** erscheint in der Liste.

---

## 3. Angebotsentwurf

- [ ] Entwurf öffnen: **Alle Positionen aus CPQ** sichtbar, Preise/Rabatt editierbar.
- [ ] **Kunde zuordnen**: Suche, Treffer auswählen, Assign.
- [ ] **Rabatt ändern**: Ampel aktualisiert sich (Grün → Gelb → Orange → Rot).
- [ ] Bei **Gelb/Orange**: Begründung eingeben, **„Angebot erstellen“** → Angebot in Shopware, danach request-approval; Freigabe-Status prüfbar.
- [ ] Bei **Rot (blocked)**: **„Angebot erstellen“** nicht klickbar (Button disabled), Hinweistext sichtbar.

---

## 4. Freigabe (bei Gelb/Orange)

- [ ] Nutzer mit Berechtigung **„Freigabe CPQ-Angebote“**: Angebot **freigeben** oder **ablehnen** (CpqApprovalPanel bzw. entsprechende UI).

---

## 5. Reporting

- [ ] `GET /api/cpq/reporting/discount-overview?from=...&to=...` (oder Admin-UI falls vorhanden): Daten aus `cpq_quote_log` sichtbar.

---

## BOM-Test (automatisiert)

```bash
cd METAorder-v2 && npm run test:bom
```

Erwartung: Mindestens ein System, Komponententypen, Mappings; Product Cache befüllt; Stückliste mit Positionen und Gesamtpreis, keine kritischen Fehler.  
Hinweis: Läuft gegen lokale DB (z. B. `docker.env` mit `PGHOST=localhost` wenn DB außerhalb Docker läuft, oder aus dem Container heraus).
