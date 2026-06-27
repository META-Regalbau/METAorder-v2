# Sprint 8 Compliance Audit Checklist

Stand: Sprint 8 (UAT/Performance/Compliance/Monitoring/Go-Live).  
Scope: `METAorder-v2` inkl. CPQ-Core, API, Storefront/UI, Deploy- und Betriebsartefakte.

## 1) Governance und Nachvollziehbarkeit

- [ ] Jira/Ticket-Referenz pro Change dokumentiert.
- [ ] Verantwortliche Owner für UAT, Security, Performance und Go-Live benannt.
- [ ] Release-Kandidat inkl. Build-Hash/Version dokumentiert.
- [ ] TODO verify Punkte vor Go-Live explizit akzeptiert oder geschlossen.

## 2) Datenschutz und Zugriff

- [ ] Authentifizierte Endpunkte nutzen `requireAuth`.
- [ ] Berechtigungen über `requirePermission(...)` geprüft.
- [ ] Tenant-Isolation (Mandantentrennung) für tenant-sensible Storage-Zugriffe bestätigt.
- [ ] Keine Secrets in Frontend-Code/Repo committed.
- [ ] Cookies/Session/CSRF-Konzept im Zielsystem (Staging/Prod) verifiziert.  
  - TODO verify: Reverse-Proxy/CORS/Cookie-Flags gegen reale Domain prüfen.

## 3) Eingabevalidierung und Integrität

- [ ] Relevante API-Payloads via Zod validiert.
- [ ] Fehlerfälle liefern sichere und nachvollziehbare Fehlermeldungen.
- [ ] Datei-Upload-Pfade und Dateityp-/Größenrestriktionen geprüft.
- [ ] SQL/Query-Pfade nutzen parametrisierte ORM-Operationen (keine Query-String-Konkatenation).

## 4) Security Baseline Scans

- [ ] OWASP ZAP Baseline-Konfiguration vorhanden: `tests/security/zap-baseline.yaml`.
- [ ] Security-Scan in CI/Release-Pipeline integriert (oder dokumentiert manuell ausführbar).
- [ ] Kritische Findings blockieren Release.
- [ ] Medium/Low Findings sind triagiert (Fix, Accept Risk oder Follow-up Ticket).
- [ ] TODO verify: Authenticated ZAP-Crawl gegen Staging mit validen Nutzerrollen.

## 5) Accessibility (A11y)

- [ ] Axe-Core Integration in Playwright aktiv.
- [ ] Kritische Violations (`impact=critical`) führen zu Test-Fail.
- [ ] Tastatur-Navigation/Kontrast für zentrale Flows manuell geprüft.
- [ ] Skip-to-content und Screenreader-relevante Landmarken validiert.

## 6) Performance/SLA

- [ ] k6-Suite vorhanden unter `tests/performance/scenarios/*`.
- [ ] SLA-Thresholds in `tests/performance/thresholds.js` gepflegt.
- [ ] p95/p99 und Fehlerquote gegen Zielwerte ausgewertet.
- [ ] Performance-Regressionen im Vergleich zu Sprint 7 bewertet.
- [ ] TODO verify: Lasttests gegen Staging mit realistischen Shopware-/CPQ-Daten.

## 7) Observability und Incident Readiness

- [ ] Sentry-Basisintegration Backend vorhanden.
- [ ] Sentry-Basisintegration Frontend vorhanden.
- [ ] CPQ MetricsCollector-Service liefert Snapshot-Daten.
- [ ] Dashboards/Alerting-Handbook dokumentiert.
- [ ] TODO verify: DSN/Release-Tagging/Alert-Routing in Zielumgebung aktiv.

## 8) Deployment-/Betriebspfad (Docker)

- [ ] Docker-Build weiterhin erfolgreich (`docker build`).
- [ ] Neue Runtime-Anforderungen (Env Vars) dokumentiert.
- [ ] Migrationen enthalten und Startpfad (`scripts/run-migrations.mjs`) unverändert lauffähig.
- [ ] Persistente Upload-Pfade/Volumes weiterhin korrekt.

## 9) UAT-Freigabe

- [ ] UAT-Testskripte vollständig ausgeführt.
- [ ] Abnahmekriterien dokumentiert/abgehakt.
- [ ] Kritische Defekte = 0, High Defekte mit Go-Live-Entscheid dokumentiert.
- [ ] Stakeholder-Signoff (PO/Tech Lead/Operations) vorhanden.
