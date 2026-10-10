# Postfach → METAorder → Shopware (lokal mit Docker + n8n)

Schritt-für-Schritt für den vollautomatischen Pfad: Mail abrufen, klassifizieren, an METAorder übergeben, bei **Strikt-Regel erfüllt** direkt in Shopware anlegen — sonst Entwurf zur manuellen Bearbeitung.

Für **Gmail** und **Microsoft 365 / Exchange** liegt je ein fertiger Workflow bereit; ab
Schritt 2 ist der Ablauf identisch.

## Architektur

1. **n8n** (Gmail- oder Outlook-Trigger, alle 60 s) → Quick-Classifier (Regex) → `intentHint`
2. **METAorder** `POST /api/commercial-drafts/upload` (.eml + `intentHint`)
3. Mail **auspacken**: ein Entwurf je handelsrelevantem Anhang ([`commercialEmailUploadIngest.ts`](../server/commercial/commercialEmailUploadIngest.ts))
4. Finale Intent-Klassifikation + Extraktion + Katalog-Match
5. **Strikt-Regel** (`commercialStrictAutoCreate.ts`) — nur bei 100 %-Treffer → Auto-Create
6. Sonst: Draft-Status `review_required` + `strictAutoCreateTrace.reasons[]` im Entwurf

## Voraussetzungen

- Docker Compose: `app`, `db`, optional `n8n`
- `COMMERCIAL_AGENT_ENABLED=true` (siehe `docker.env`)
- Integrations-Schlüssel: METAorder → Einstellungen → n8n → Schlüssel anlegen, mit **„Arbeitet als Benutzer“** = einem Benutzer des Mandanten mit „Angebote verwalten“ und „Bestellentwürfe verwalten“ (empfohlen: eigener technischer Benutzer, z. B. `n8n`). Der Status am Schlüssel zeigt, ob n8n damit durchkommt. Alternativ der globale `METAORDER_INTEGRATION_API_KEY` (nur Ein-Mandanten-Installation).
- Shopware + B2B Sellers konfiguriert; für Auto-Angebote: `B2B_SELLERS_DEFAULT_SALES_CHANNEL` oder `autoCreateSalesChannelId`
- OpenAI/Anthropic für Klassifikation und Extraktion

## Docker starten

```bash
cd METAorder-v2
# docker.env anpassen (N8N_*, METAORDER_INTEGRATION_API_KEY, COMMERCIAL_AGENT_*)
docker compose --env-file docker.env up -d --build
```

> **`--env-file docker.env` ist zwingend.** Compose lädt von sich aus nur `.env` aus dem
> Projektordner. Ohne den Schalter greifen die Vorgabewerte aus `docker-compose.yml` —
> unter anderem `COMMERCIAL_AGENT_ENABLED=false`, d. h. der Commercial Agent läuft dann
> gar nicht, obwohl in `docker.env` `true` steht. Prüfen lässt sich das mit:
>
> ```bash
> docker compose exec app sh -c 'env | grep COMMERCIAL_AGENT'
> ```

- METAorder: `http://localhost:5001` (oder `HOST_PORT`)
- n8n: `http://localhost:5678` (Basic Auth aus `N8N_ADMIN_USER` / `N8N_ADMIN_PASSWORD`)

## Google Cloud / Gmail OAuth für n8n *(nur Gmail-Variante)*

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
| `m365-to-metaorder.json` | **Microsoft 365 / Exchange**: E-Mail-Eingang mit Erkennung „Sonstiges“, Weiterleitung, Problem-Tickets, Zielordner |
| `metaorder-auto-create-webhook.json` | Optional: Webhook für `commercial.auto_*_created` |

Import in n8n → **einen** der beiden Postfach-Workflows aktivieren → Credentials zuweisen:

- Postfach: Gmail OAuth2 bzw. Microsoft Outlook OAuth2 (siehe unten)
- **METAorder Integration-Key** (Typ **Header Auth**): Name `X-METAORDER-Integration-Key`, Wert = der Schlüssel aus METAorder. Als n8n-Credential liegt er verschlüsselt; Umgebungsvariablen (`$env`) nutzen die Vorlagen nicht mehr, weil n8n Cloud den Zugriff darauf sperrt.
- Die Upload-URL zeigt auf Produktion (`https://p-bbpye5.project.space/api/commercial-drafts/upload`); lokal auf `http://host.docker.internal:5001/api/commercial-drafts/upload` ändern.

Der Workflow `gmail-to-metaorder.json` holt die Nachricht per Gmail API (`format=raw`) und baut daraus die Binary **`.eml`** (inkl. Anhänge) für den Upload.

METAorder packt die hochgeladene `.eml` serverseitig aus und legt **einen Entwurf je
handelsrelevantem Anhang** an — inklusive PDF-Vision für gescannte Bestellungen und
Signaturbild-Erkennung. Details: [`n8n-commercial-integration.md`](n8n-commercial-integration.md).

### Microsoft 365 / Exchange

Seit Oktober 2026 ist [`m365-to-metaorder.json`](../n8n-workflows/m365-to-metaorder.json) der
**E-Mail-Eingang**: Abruf per Zeitplan statt Outlook-Trigger, Erkennung „weder Bestellung noch Angebot“
mit Weiterleitung, Problem-Tickets und Zielordner für erledigte Mails. Einrichtung und Ablauf:
[`n8n-commercial-integration.md` → E-Mail-Eingang](n8n-commercial-integration.md#e-mail-eingang-microsoft-365).

Der lokale n8n-Container bekommt aus `docker-compose.yml` zusätzlich `METAORDER_BASE_URL` und `METAORDER_INTEGRATION_KEY` — für eigene Workflows; die Vorlagen nutzen Credential und feste URL.

## Strikt-Regel („100 %“)

Alle Bedingungen müssen erfüllt sein (`strictAutoCreateOnly`, Default **true**):

| Prüfung | Bedingung |
|---------|-----------|
| Intent | ≠ `unclear`, Konfidenz ≥ `strictMinIntentConfidence` (Default **0.95**) |
| Adresse | `company`, `street`, `zipCode`, `city`, `country` + E-Mail **oder** Telefon |
| Kunde | `shopwareCustomerId`, Match-Score ≥ **95**, **nicht** per Auto-Create neu angelegt |
| Positionen | Jede Zeile: Katalog-Match mit **confidence = 100**, nicht `skipCatalogMatching` |
| Review | Keine `addressReviewHints`, kein Intent/Upload-Mismatch, keine schwache Firmen-Heuristik |
| Verkaufskanal | Angebot **und** Bestellung: `autoCreateSalesChannelId`, `B2B_SELLERS_DEFAULT_SALES_CHANNEL` **oder** an den Shopware-Kunden gebundener Kanal — kein Rückfall auf den ersten aktiven Kanal |
| Dubletten | Kein anderer Entwurf derselben Art mit gleicher Kunden-Belegnummer und gleichem Shopware-Kunden (`duplicate_buyer_document_number`) |
| Preise (nur Bestellung) | Jede Position: Stückpreis im Dokument vorhanden und innerhalb `strictPriceTolerancePercent` (Default **1 %**) des für den Kunden ermittelten Preises: kundenindividueller B2Bsellers-Preis → Kundenrabatt → Listenpreis. Ein im Review manuell gesetzter Preis überstimmt den Abgleich. Ergebnis je Zeile unter `strictAutoCreateTrace.priceChecks` |

Trace im Entwurf: `extractedData.strictAutoCreateTrace` mit `allowed` und `reasons[]`.

Env-Overrides: `COMMERCIAL_AGENT_STRICT_AUTO_CREATE`, `COMMERCIAL_AGENT_STRICT_MIN_INTENT`, `COMMERCIAL_AGENT_STRICT_MIN_CUSTOMER`, `COMMERCIAL_AGENT_STRICT_PRICE_TOLERANCE`.

Die Shopware-Anlage (Angebot wie Bestellung) nutzt dieselbe Preisbasis wie der Abgleich (`server/commercial/commercialCustomerPricing.ts`); der Verkaufskanal wird in beiden Pfaden zuerst am Kunden gesucht.

## `intentHint` (n8n-Vorschlag)

Multipart-Feld **`intentHint`**: `offer` | `order` | `unclear`

- n8n setzt per Regex (Quick Classifier)
- METAorder wendet **+0.05** an, wenn LLM übereinstimmt, oder hebt bei `unclear`/niedriger Konfidenz sanft an
- **Überschreibt das LLM nie** bei klarem Widerspruch

## Tests lokal

```bash
npx vitest run tests/unit/commercialStrictAutoCreate.test.ts
npx vitest run tests/unit/gmailIntentHintIngest.test.ts
npx vitest run tests/unit/commercialEmailUploadIngest.test.ts
```

## Smoke-Test

1. Test-Mail mit bekannter SKU, bestehendem Shopware-Kunden, klarer Angebots-/Bestell-Sprache
2. In n8n Execution prüfen: Upload 200, `strictAutoCreate.shopwareCreated: true`
3. Zweite Mail mit unbekannter SKU → Draft im UI, `strictAutoCreate.reasons` enthält z. B. `line_1_not_matched`

## Siehe auch

- [`n8n-commercial-integration.md`](n8n-commercial-integration.md) — API-Details und Webhooks
- [`docker.md`](docker.md) — Env-Variablen
