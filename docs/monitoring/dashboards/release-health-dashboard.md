# Dashboard Blueprint: Release Health

## Ziel

Technische Release-Gesundheit aus Endnutzer- und Plattformsicht überwachen.

## Panel-Vorschläge

1. **Frontend Error Events (Sentry)**
   - Filter: `environment`, `release`, `level:error`
2. **Backend Exceptions (Sentry)**
   - Filter: Route-Gruppierung `/api/*`
3. **Core Web Vitals (Lighthouse CI)**
   - FCP, TTI, CLS Trend
4. **Auth/Login Fail Rate**
   - Anteil fehlgeschlagener `/api/auth/login` Requests
5. **API p95 / p99**
   - Aus Request-Logs/Collector
6. **Security Baseline Status**
   - Letzter ZAP Baseline Run: Pass/Fail

## Alert-Empfehlungen

- Neuer Frontend Error Spike > 2x Baseline (15min)
- Backend 5xx > 2% (10min)
- Lighthouse Performance-Score < 0.8

## TODO verify

- TODO verify: Sentry DSN und Release-Tags in Frontend/Backend gesetzt.
- TODO verify: CI veröffentlicht Lighthouse-Artefakte pro Build.
