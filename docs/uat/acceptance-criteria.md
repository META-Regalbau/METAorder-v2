# Sprint 8 Acceptance Criteria

## 1) E2E Test Automation

- [ ] Playwright-Konfiguration vorhanden und ausführbar.
- [ ] `tests/e2e` enthält `config`, `fixtures`, `pages`, `tests`.
- [ ] `happy-path.spec.ts` deckt Login -> CPQ -> Offers Kernfluss ab.
- [ ] Weitere zentrale Spezifikationen für Auth, Offers, Monitoring und A11y vorhanden.
- [ ] Selektoren in Specs basieren auf `data-testid`.

## 2) Performance

- [ ] k6-Szenarien für Happy Path, Auth-Burst, CPQ-Core vorhanden.
- [ ] SLA-Thresholds zentral definiert.
- [ ] JSON Summary Reporter erzeugt artefaktfähige Reports.
- [ ] Abweichungen von SLA werden als Fail/Warn behandelt.

## 3) Security und Accessibility

- [ ] ZAP Baseline-Konfiguration im Repository enthalten.
- [ ] Axe-Core ist in Playwright integriert.
- [ ] Kritische A11y-Verstöße lassen Tests fehlschlagen.

## 4) Compliance und Betrieb

- [ ] Audit-Checklist vollständig dokumentiert.
- [ ] UAT-Testskripte und Abnahmekriterien dokumentiert.
- [ ] Go-Live Runbook ist vollständig.
- [ ] Monitoring-Dashboards/Run-Information vorhanden.

## 5) Monitoring

- [ ] Backend-Sentry Basis-Setup vorhanden.
- [ ] Frontend-Sentry Basis-Setup vorhanden.
- [ ] CPQ MetricsCollector-Service liefert verwertbare Snapshot-Daten.
- [ ] TODO verify Punkte für DSN/Alert-Routing sind dokumentiert.

## 6) Definition of Done

Sprint 8 gilt als abgeschlossen, wenn:

1. Alle Pflichtartefakte committed (ohne Core-Feature-Neuentwicklung),
2. `npm run check` erfolgreich ist,
3. Mindestens ein E2E-Smoke und ein statischer Plausibilitätscheck für neue Artefakte durchgeführt wurden,
4. Offene externe Abhängigkeiten als `TODO verify` markiert und in Go-Live Entscheidung berücksichtigt sind.
