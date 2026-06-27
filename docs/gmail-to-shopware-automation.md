# Gmail → METAorder → Shopware (lokal mit Docker + n8n)

Schritt-für-Schritt für den vollautomatischen Pfad: Gmail-Mail abrufen, klassifizieren, an METAorder übergeben, bei **Strikt-Regel erfüllt** direkt in Shopware anlegen — sonst Entwurf zur manuellen Bearbeitung.

## Architektur

1. **n8n** (Gmail Trigger, alle 60 s) → Quick-Classifier (Regex) → `intentHint`
2. **METAorder** `POST /api/commercial-drafts/upload` (.eml + `intentHint`)
3. Finale Intent-Klassifikation + Extraktion + Katalog-Match
4. **Strikt-Regel** (`commercialStrictAutoCreate.ts`) — nur bei 100 %-Treffer → Auto-Create
5. Sonst: Draft-Status `review_required` + `strictAutoCreateTrace.reasons[]` im Entwurf

## Voraussetzungen

- Docker Compose: `app`, `db`, optional `n8n`
- `COMMERCIAL_AGENT_ENABLED=true` (siehe `docker.env`)
- Integrations-API-Key: Admin → Einstellungen → Integration **oder** `METAORDER_INTEGRATION_API_KEY`
- Shopware + B2B Sellers konfiguriert; für Auto-Angebote: `B2B_SELLERS_DEFAULT_SALES_CHANNEL` oder `autoCreateSalesChannelId`
- OpenAI/Anthropic für Klassifikation und Extraktion

## Docker starten

```bash
cd METAorder-v2
# docker.env anpassen (N8N_*, METAORDER_INTEGRATION_API_KEY, COMMERCIAL_AGENT_*)
docker compose up -d --build
```

- METAorder: `http://localhost:5001` (oder `HOST_PORT`)
- n8n: `http://localhost:5678` (Basic Auth aus `N8N_ADMIN_USER` / `N8N_ADMIN_PASSWORD`)

## Google Cloud / Gmail OAuth für n8n

1. [Google Cloud Console](https://console.cloud.google.com/) → Projekt
2. **APIs & Services** → Gmail API aktivieren
3. **OAuth consent screen** (External, Testnutzer = deine Gmail-Adresse)
4. **Credentials** → OAuth 2.0 Client ID (Web application)
   - Authorized redirect URI: `http://localhost:5678/rest/oauth2-credential/callback`
5. In n8n: **Credentials** → **Gmail OAuth2** → Client ID/Secret → Connect

## Workflows importieren

Dateien unter [`n8n-workflows/`](../n8n-workflows/):

| Datei | Zweck |
|-------|--------|
| `gmail-to-metaorder.json` | Gmail → Classifier → Upload → Mark Read |
| `metaorder-auto-create-webhook.json` | Optional: Webhook für `commercial.auto_*_created` |

Import in n8n → Workflow aktivieren → Gmail-Credential zuweisen.

Der Workflow `gmail-to-metaorder.json` holt die Nachricht per Gmail API (`format=raw`) und baut daraus die Binary **`.eml`** (inkl. Anhänge) für den Upload.

Umgebungsvariablen im n8n-Container (bereits in `docker-compose.yml`):

- `METAORDER_BASE_URL=http://host.docker.internal:5001`
- `METAORDER_INTEGRATION_KEY=<Ihr Key>`

## Strikt-Regel („100 %“)

Alle Bedingungen müssen erfüllt sein (`strictAutoCreateOnly`, Default **true**):

| Prüfung | Bedingung |
|---------|-----------|
| Intent | ≠ `unclear`, Konfidenz ≥ `strictMinIntentConfidence` (Default **0.95**) |
| Adresse | `company`, `street`, `zipCode`, `city`, `country` + E-Mail **oder** Telefon |
| Kunde | `shopwareCustomerId`, Match-Score ≥ **95**, **nicht** per Auto-Create neu angelegt |
| Positionen | Jede Zeile: Katalog-Match mit **confidence = 100**, nicht `skipCatalogMatching` |
| Review | Keine `addressReviewHints`, kein Intent/Upload-Mismatch, keine schwache Firmen-Heuristik |
| Angebot | Sales Channel gesetzt |

Trace im Entwurf: `extractedData.strictAutoCreateTrace` mit `allowed` und `reasons[]`.

Env-Overrides: `COMMERCIAL_AGENT_STRICT_AUTO_CREATE`, `COMMERCIAL_AGENT_STRICT_MIN_INTENT`, `COMMERCIAL_AGENT_STRICT_MIN_CUSTOMER`.

## `intentHint` (n8n-Vorschlag)

Multipart-Feld **`intentHint`**: `offer` | `order` | `unclear`

- n8n setzt per Regex (Quick Classifier)
- METAorder wendet **+0.05** an, wenn LLM übereinstimmt, oder hebt bei `unclear`/niedriger Konfidenz sanft an
- **Überschreibt das LLM nie** bei klarem Widerspruch

## Tests lokal

```bash
npm run test:strict-auto-create
npm run test:gmail-ingest-hint
```

## Smoke-Test

1. Test-Mail mit bekannter SKU, bestehendem Shopware-Kunden, klarer Angebots-/Bestell-Sprache
2. In n8n Execution prüfen: Upload 200, `strictAutoCreate.shopwareCreated: true`
3. Zweite Mail mit unbekannter SKU → Draft im UI, `strictAutoCreate.reasons` enthält z. B. `line_1_not_matched`

## Siehe auch

- [`n8n-commercial-integration.md`](n8n-commercial-integration.md) — API-Details und Webhooks
- [`docker.md`](docker.md) — Env-Variablen
