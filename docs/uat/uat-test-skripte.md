# UAT Test-Skripte (Sprint 8)

## Ziel

Sicherstellen, dass die End-to-End Kernprozesse (Login, CPQ, Angebote, Monitoring) stabil, reproduzierbar und releasefähig sind.

## Rahmenbedingungen

- Basis-URL: `http://127.0.0.1:5000` oder Staging-URL
- Test-User: `admin` / `admin123` (lokaler Seed)
- Browser: Chromium
- Optional: Playwright mit `npm run test:e2e:smoke`

## UAT-01 Login und Session

1. Login-Seite öffnen.
2. Mit gültigen Credentials anmelden.
3. Prüfen, dass Navigation sichtbar ist.
4. Neu laden und verifizieren, dass Session bestehen bleibt.

Erwartet:
- Login erfolgreich.
- Keine 401-Fehler bei initialen API-Calls nach Login.

## UAT-02 CPQ Happy Path

1. `/configurator` öffnen.
2. System auswählen.
3. Schritte bis Zusammenfassung durchgehen.
4. `Validate (CPQ Core)` und `Price (CPQ Core)` ausführen.
5. Wenn Stückliste vorhanden: Angebotsentwurf erstellen.

Erwartet:
- Keine Frontend-Fehler.
- Klassifizierung (A/B/C) wird angezeigt.
- Preisvorschau wird angezeigt.
- Bei aktivem Mapping: Redirect auf `/offers`.

## UAT-03 Offers Flow

1. `/offers` öffnen.
2. Suche ausführen.
3. Filter aktualisieren.
4. Angebotsliste und Actions sichtbar.

Erwartet:
- Seite lädt ohne Hard-Error.
- Filter und Refresh funktionieren.

## UAT-04 Monitoring/KPI

1. `/api/cpq-core/monitoring/snapshot` aufrufen (authentifiziert).
2. `/api/cpq-core/kpis/report` aufrufen.
3. `/api/cpq-core/monitoring/collector` aufrufen.

Erwartet:
- HTTP 200.
- Antwort enthält KPI-/Snapshot-Struktur.

## UAT-04a Cross-Selling (optional)

1. Als Admin `/cross-selling-rules` öffnen — Seite lädt (`data-testid="page-rules"`).
2. Tab „Manuelle Regeln“ / „Staging“ wechseln (keine harten Daten nötig).
3. Produktdetail: Cross-Selling-Bereich sichtbar; mit Berechtigung `manageCrossSellingGroups` erscheint „Cross-Selling verwalten“.
4. Optional: Angebotsentwurf mit gematchten Produkten öffnen — CPQ-Empfehlungen und/oder Shopware-Vorschläge ohne doppelte Produktkarten (nach CPQ-Dedupe).

Erwartet:
- Keine 403/500 auf den genannten Seiten für berechtigten Benutzer.
- `POST /api/cross-selling-rules/execute-bulk` ist in Produktion ggf. per `CROSS_SELL_BULK_ENABLED=false` abgeschaltet — dann HTTP 403 mit Hinweistext (bewusst).

## UAT-05 A11y Smoke

1. Axe-Playwright Smoke auf Login und Offers ausführen.
2. Kritische Verstöße prüfen.

Erwartet:
- Keine kritischen Verstöße.

## UAT-06 Security Baseline

1. ZAP Baseline gegen Zielsystem starten.
2. Findings reviewen.

Erwartet:
- Keine High-Findings ohne dokumentierte Ausnahme.

## Dokumentation der Ergebnisse

Pro Testfall dokumentieren:

- Datum/Uhrzeit
- Umgebung (lokal, staging)
- Build/Commit-Hash
- Ergebnis (Pass/Fail)
- Befunde / Tickets
- TODO verify Punkte (falls extern blockiert)
