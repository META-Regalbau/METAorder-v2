# E2E Playwright (Sprint 8)

## Struktur

- `config/` zentrale Umgebungs-/Selector-Konfiguration
- `fixtures/` gemeinsame Fixtures und A11y-Helfer
- `pages/` Page Objects
- `tests/` Spezifikationen

## Lokale Ausführung

1. App starten (`npm run dev` oder Docker Compose).
2. Optional Browser installieren: `npx playwright install`.
3. Smoke ausführen: `npm run test:e2e:smoke`.

## Wichtige Variablen

- `PLAYWRIGHT_BASE_URL` (Default `http://127.0.0.1:5000`)
- `E2E_USERNAME` (Default `admin`)
- `E2E_PASSWORD` (Default `admin123`)

## TODO verify

- TODO verify: Staging-User mit stabilen Rechten für CI hinterlegen.
- TODO verify: CPQ Seed-Daten für deterministische BOM-Ergebnisse bereitstellen.
