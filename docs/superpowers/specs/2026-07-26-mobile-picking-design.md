# Mobile Picking — Design Spec

**Datum:** 2026-07-26  
**Status:** freigegeben (Ansatz 1)  
**Scope:** v1 — eigene Mobile-Route; PWA/Offline (Ansatz 3) später

## 1. Ziel

Am iPhone (Regal) eine Pickliste auswählen und Artikel per Dauer-Kamera-Scan (QR/Barcode) als gepickt buchen — inkl. manueller ±1-Korrektur und optionalem Abschluss. Desktop Versand-Ops bleibt unverändert nutzbar.

## 2. Entscheidungen (fixiert)

| Thema | Wahl |
|--------|------|
| Einstieg | **C:** Desktop Versand-Ops + eigene Route `/mobile/picking` + Sidebar-Link |
| Scan-UX | **C:** Kamera dauerhaft offen + manuell +1/−1 |
| Abschluss | **C:** Abschließen am Handy optional; Desktop parallel möglich |
| Architektur | **Ansatz 1:** neue Page, bestehende APIs; Ansatz 3 (PWA) später |

## 3. Nutzerfluss

```
Sidebar / URL → /mobile/picking (Login + Tenant + Recht)
       ↓
Listenansicht: offene Picklisten (status = open)
       ↓ Tippen
Detail: Kamera (dauerhaft) + Positionen + Fortschritt
       ↓ Scan / ±1
POST scan (delta) → UI aktualisieren (Toast/Feedback)
       ↓ optional
POST complete (Bestätigung bei Untermenge) → zurück zur Liste
```

## 4. UI / Layout

### 4.1 Shell

- Route ohne normale App-Sidebar (Vollbild / schmale Chrome: Zurück, Titel, ggf. User minimal).
- Große Touch-Targets; eine Hand bedienbar.
- Sicheres Kontext-Hinweis, wenn keine Kamera (HTTP): bestehender `barcodeScan.httpsRequired`-Text.

### 4.2 Listenansicht (`/mobile/picking`)

- Nur Picklisten mit `status === "open"`.
- Pro Karte: Lager-Code/Name, Bestellnummern (kurz), Fortschritt `Summe picked / Summe quantity`, Erstelldatum.
- Tippen → Detail `/mobile/picking/:id` (oder Client-State auf derselben Route — **Entscheidung v1:** Unterroute `/:id` für Deep-Link/Refresh).

### 4.3 Detailansicht

- **Oben:** Live-Kamera (Dauerbetrieb), nicht nur Dialog.
- **Darunter:** scrollbare Positionen — SKU, Label (falls vorhanden via `useErpProductLabels`), `pickedQuantity / quantity`, Buttons **+** / **−**.
- Visueller Zustand: Zeile fertig = grün/abgehakt; aktiv = hervorgehoben.
- Footer/Sticky: Fortschritt der Liste; Button **Abschließen**; Zurück zur Liste.
- Scan-Feedback: kurzer Erfolgston/Haptik wenn verfügbar (`navigator.vibrate`); Fehler (SKU nicht auf Liste) rot/Toast, Kamera bleibt an.

## 5. Technik

### 5.1 Client

| Datei / Einheit | Verantwortung |
|-----------------|---------------|
| `client/src/pages/MobilePickingPage.tsx` | Liste + Detail, Mutations, Layout |
| `client/src/components/BarcodeLiveScanner.tsx` (neu) | Dauer-Scanner (html5-qrcode); Dialog kann darauf aufbauen oder parallel bleiben |
| `client/src/components/BarcodeScannerDialog.tsx` | Desktop/Inventur unverändert oder dünner Wrapper um Live-Scanner |
| `client/src/App.tsx` | Route `/mobile/picking` und `/mobile/picking/:id`; Layout ohne Sidebar |
| `client/src/components/AppSidebar.tsx` | Link „Mobile Picking“ → `/mobile/picking` (Permission wie Versand-Ops: `manageShippingLabels`) |
| i18n `de` / `en` / `es` | Keys unter `erp.mobilePicking.*` |

Auth: gleiche Session wie Desktop (Cookie). Kein separater Mobile-Login in v1.

### 5.2 Server / API

Bestehend:

- `GET /api/erp/pick-lists` — Liste inkl. Lines
- `POST /api/erp/pick-lists/:id/scan` — bisher nur +1
- `POST /api/erp/pick-lists/:id/complete`

**Erweiterung v1 (für −1):**

- Body `POST …/scan`: `{ productNumber: string, delta?: 1 | -1 }` (Default `1`).
- `erpStorage.scanPickListProduct`: `pickedQuantity` um `delta` anpassen, Clamp `0 … quantity`.
- Bei `delta: -1` und `pickedQuantity === 0`: no-op, Zeile unverändert zurück (kein Fehler).
- Unbekannte SKU: weiterhin Fehler „Product not on this pick list“.
- Rechte/CSRF unverändert (`manageShippingLabels` / Admin).

Manuelles **+** auf einer Zeile: gleicher Scan-Endpoint mit `productNumber` der Zeile und `delta: 1` (kein zweiter Endpoint nötig).

### 5.3 Abschließen

- Button ruft bestehendes `complete` auf.
- Wenn irgendeine Zeile `pickedQuantity < quantity`: Confirm-Dialog („Untermenge — trotzdem abschließen?“).
- Nach Erfolg: Navigation zurück zur Listenansicht; Query invalidieren.

## 6. Fehler & Edge Cases

| Fall | Verhalten |
|------|-----------|
| HTTP (kein Secure Context) | Kamera-Hinweis; ±1 weiter nutzbar |
| SKU nicht auf Liste | Fehler-Toast; kein Mengenwechsel |
| Liste nicht mehr `open` | Fehler; zurück zur Liste |
| Doppelscan | Dedup ~1,5 s (wie Dialog) |
| Cap erreicht | +1 no-op / `completedLine`; UI zeigt fertig |
| Kein Tenant | wie übrige ERP-Routen (403) |

## 7. Explizit nicht in v1

- PWA / Service Worker / Offline-Queue (Ansatz 3)
- Lagerplatz-Sortierung / Wegeoptimierung
- Multi-User Live-Sync (Polling der Liste nach Scan reicht; Invalidate nach Mutation)
- Etikettendruck / Sendcloud vom Handy
- Abbrechen der Pickliste am Handy (bleibt Desktop)
- Neues RBAC-Recht (nutzt `manageShippingLabels`)

## 8. Docs & Deploy

- Kurzhinweis in `docs/docker.md`: Mobile Picking braucht HTTPS für Kamera (wie Inventur).
- Optional ein Satz in `docs/erp-gap-decisions.md` unter Versand.
- Docker: nur Client/Server-Code im Image; keine neuen Volumes/Env-Pflichtvariablen.

## 9. Testplan (Abnahme)

1. Desktop: Versand-Ops unverändert; Pickliste anlegen.
2. iPhone (HTTPS): `/mobile/picking` → offene Liste sichtbar.
3. Detail: Kamera startet; Artikel-Etikett scannen → `picked` +1.
4. Falsche SKU → Fehler, Zähler unverändert.
5. −1 und +1 Tippen funktioniert und synced mit Desktop nach Refresh.
6. Abschließen mit voller und mit Untermenge (Confirm).
7. Image-Build: `docker compose up -d --build app` weiterhin grün.

## 10. Erfolgskriterien

- Am Regal ohne Desktop-UI eine offene Pickliste durchscannen und abschließen können.
- Desktop und Mobile teilen denselben Datenbestand ohne Doppelbuchungs-Sonderlogik über die bestehende Picklisten-API hinaus.
