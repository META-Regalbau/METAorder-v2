# Go-Live Runbook (Sprint 8)

## 0) Zweck und Scope

Runbook für den Release von Sprint 8 mit Fokus auf UAT, Performance, Compliance, Monitoring und Betriebsbereitschaft.

## 1) Voraussetzungen

- Docker-Deploymentpfad ist intakt (`Dockerfile`, `docker-compose.yml`).
- DB-Migrationen sind im Stand der Zielversion.
- Release-Owner + Incident-Owner sind benannt.
- Credentials/Secrets in Zielumgebung vorhanden.

## 2) Pre-Flight Checklist

- [ ] `npm run check` erfolgreich.
- [ ] Playwright Smoke (`npm run test:e2e:smoke`) erfolgreich oder begründet blockiert.
- [ ] k6 Smoke (mind. 1 Szenario) durchgeführt.
- [ ] ZAP Baseline durchgeführt.
- [ ] Lighthouse CI ausgeführt.
- [ ] Compliance Checklist final abgehakt.

## 3) Deployment Steps (Docker)

1. Image bauen:  
   `docker build -t metaorder:$(date +%Y%m%d-%H%M) .`
2. Migrationen im Container-Startpfad verifizieren (`scripts/run-migrations.mjs`).
3. Compose/Orchestrator mit neuem Image aktualisieren.
4. Healthcheck prüfen: `GET /healthz`.

## 4) Post-Deploy Smoke

1. Login als Admin
2. CPQ Configurator öffnen
3. Validate/Price Trigger
4. Offers-Seite öffnen
5. Optional: `/cross-selling-rules` laden (Cross-Selling-Admin, Tab-Wechsel).
6. Monitoring-Endpunkte prüfen:
   - `/api/cpq-core/monitoring/snapshot`
   - `/api/cpq-core/kpis/report`
   - `/api/cpq-core/monitoring/collector`

## 5) Monitoring Watch (erste 60 Minuten)

- Error Rate API
- p95/p99 Latenz
- Sentry Error-Spikes (Frontend + Backend)
- CPQ Class-C Share und Transfer Blocked Share

Rollback Trigger (einer reicht):

- >5% API 5xx über 5 Minuten
- Kritischer Security Incident
- Kernfunktion Login/CPQ/O offers nicht nutzbar

## 6) Rollback

1. Vorheriges stabiles Image deployen.
2. Kurz-Smoke (Login + Health + Offers) erneut ausführen.
3. Incident + Ursache + nächste Schritte dokumentieren.

## 7) Kommunikationsplan

- T-30m: Go/No-Go Meeting
- T-0: Deployment Start Meldung
- T+15m: Erste Health-Meldung
- T+60m: Stabilitätsfreigabe oder Incident-Status

## 8) TODO verify (extern)

- TODO verify: Staging/Prod DSNs für Sentry gesetzt.
- TODO verify: k6 Lasttest gegen produktionsnahe Daten durchgeführt.
- TODO verify: ZAP Authenticated Baseline gegen Staging mit gültigem Session-Handling.
- TODO verify: Alerting-Kanäle (On-Call, Slack, E-Mail) funktionsfähig.
