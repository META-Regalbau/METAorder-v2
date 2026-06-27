# CPQ Betriebs-Runbook (Sprint 4)

Dieses Runbook beschreibt den Incident- und Betriebsablauf fuer CPQ-Core inkl. Monitoring, KPI-Tracking und Datenqualitaetschecks.

## 1. Scope und kritische Endpunkte

Die folgenden Endpunkte sind fuer die Sprint-4-Beobachtbarkeit instrumentiert:

- `POST /api/cpq-core/validate`
- `POST /api/cpq-core/price`
- `POST /api/cpq-core/submit`
- `POST /api/cpq-core/adapter/submit-transfer`

Observability-Endpunkte:

- `GET /api/cpq-core/monitoring/snapshot` (Latenz, Erfolgs-/Fehlerzaehler je Endpunkt)
- `GET /api/cpq-core/kpis/report` (KPI-MVP Report)
- `GET /api/cpq-core/data-quality/check` (Datenqualitaetsreport, Management-Recht erforderlich)

Hinweis: Alle drei Endpunkte sind tenant-gebunden und liefern nur Daten fuer `req.tenantId`.

## 2. Wo finde ich Logs und Metriken?

- Strukturierte Runtime-Metriken werden als JSON-Logs mit `event=cpq_core_endpoint_metric` geschrieben.
- Snapshot und KPI-Werte sind in-memory und damit sofort verfuegbar, aber nach Serverneustart wieder leer.
- Fuer ad-hoc CLI-Pruefungen:
  - `npm run check:cpq-data-quality -- <tenantId>`
  - `npm run test:cpq-core`

## 3. KPI-MVP (aktuell)

Folgende Kennzahlen sind enthalten:

- Nutzung: `configuratorUsage`, `validateCalls`, `priceCalls`, `submitCalls`
- Qualitaet/Outcome: `submitAccepted`, `submitReviewRequired`
- Transfer: `transferPrepared`, `transferBlocked`, `transferSkipped`
- Klassifizierung: `classificationA`, `classificationB`, `classificationC`
- Quoten:
  - `classCShare`
  - `submitToReviewRequiredQuote`
  - `submitConversionRate`
  - `transferBlockedShare`

## 4. Standard-Checks bei Incident

1. Tenant verifizieren (ohne Tenant sind Reports nicht aussagekraeftig).
2. Snapshot abrufen:
   - `GET /api/cpq-core/monitoring/snapshot`
   - auf `serverErrors`, `avgLatencyMs`, `lastError` achten.
3. KPI-Drift pruefen:
   - `GET /api/cpq-core/kpis/report`
   - auffaellige Spruenge bei `classCShare` oder `submitToReviewRequiredQuote` markieren.
4. Datenqualitaet pruefen:
   - `GET /api/cpq-core/data-quality/check`
   - alternativ CLI-Script.
5. Bei Shopware-Transfer-Problemen explizit auf:
   - `adapter_submit_transfer` Fehlerrate,
   - `transferBlockedShare`,
   - Fehlertexte mit Hinweis auf Shopware-Einstellungen.

## 5. Haeufige Fehlerbilder und Recovery

- **Hohe 4xx-Rate in `validate`/`price`**
  - Ursache: Payload-Drift oder Frontend-Regression.
  - Recovery: Beispielpayload aus letzter funktionierender Session gegen Zod-Schema pruefen.

- **Sprunghafter Anstieg `submitReviewRequired`**
  - Ursache: Klassifizierungsregeln triggern zu streng (z. B. Klasse C).
  - Recovery: Regelstand im CPQ-Admin pruefen, Datenqualitaetscheck ausfuehren.

- **`adapter_submit_transfer` liefert 400 mit Shopware-Hinweis**
  - Ursache: Shopware-Konfiguration fehlt/ungueltig.
  - Recovery: Shopware-Settings im Tenant pruefen und Transfer erneut testen.

- **Latenzanstieg einzelner Endpunkte**
  - Ursache: Lastspitze, langsame externe Abhaengigkeiten, DB-Issue.
  - Recovery: Endpunkt-spezifische Latenzen im Snapshot isolieren, danach App-/DB-Logs korrelieren.

## 6. Datenqualitaetscheck (Interpretation)

Der Check meldet `error` und `warning`, u. a.:

- Systeme ohne Komponententypen
- Systeme ohne aktive Produkt-Mappings
- Doppelte aktive Produktnummer-Mappings
- Aktive Regeln ohne Condition/Action
- Konfigurationen mit unvollstaendigem `configData`

Empfehlung:

- `error`: vor produktivem Rollout beheben
- `warning`: innerhalb des naechsten Betriebszyklus bereinigen und nachpruefen

## 7. Betrieb nach Restart/Deploy

Da Monitoring und KPI-Speicher in-memory sind:

- Nach Neustart sind Snapshot/KPIs initial leer.
- Erwartetes Verhalten: Werte bauen sich mit Live-Traffic wieder auf.
- Bei Bedarf koennen Werte spaeter in eine persistente Time-Series- oder SQL-Tabelle ueberfuehrt werden.
