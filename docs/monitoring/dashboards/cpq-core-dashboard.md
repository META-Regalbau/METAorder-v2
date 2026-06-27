# Dashboard Blueprint: CPQ Core

## Ziel

Früherkennung von Regressions in CPQ Validate/Price/Submit inkl. Review-Quote und Transfer-Problemen.

## Panel-Vorschläge

1. **CPQ Request Volume**
   - Source: `GET /api/cpq-core/monitoring/snapshot`
   - Metrik: `totals.requests`
2. **CPQ Error Rate**
   - Source: `snapshot.totals.errors / snapshot.totals.requests`
3. **CPQ Endpoint p95**
   - Source: Collector-Snapshot (`/api/cpq-core/monitoring/collector`)
   - Metrik: `cpq.totals.p95LatencyMs`
4. **Class-C Share**
   - Source: `GET /api/cpq-core/kpis/report`
   - Metrik: `ratios.classCShare`
5. **Review-Required Quote**
   - Source: `kpis.report.ratios.submitToReviewRequiredQuote`
6. **Transfer Blocked Share**
   - Source: `kpis.report.ratios.transferBlockedShare`

## Alert-Empfehlungen

- Error Rate > 3% über 10 Minuten -> Warning
- Error Rate > 5% über 5 Minuten -> Critical
- p95 Latenz > 1800ms über 10 Minuten -> Warning
- transferBlockedShare > 0.25 über 30 Minuten -> Investigate

## TODO verify

- TODO verify: Dashboard in Zieltool (Grafana/Datadog/Sentry Metrics) anlegen.
- TODO verify: Tenant-basierte Filter in Alert-Regeln berücksichtigen.
