# Docker-Deployment

## Mittwald Container Hosting

Fuer einen reproduzierbaren Deployment-Prozess auf Mittwald siehe `docs/mittwald-deployment.md`.
Dort sind Release-Tagging, Registry-Push, Host-Deploy und Rollback beschrieben.

## Image bauen

`npm ci` im Docker-Build nutzt die Projekt-**`.npmrc`** (`legacy-peer-deps=true`), weil sonst ein Peer-Konflikt zwischen `@google/model-viewer` und `three` den Build abbricht (wie bei lokalem `npm ci` ohne diese Option). **Word .docx**-Text für KI-Entwürfe läuft über **`mammoth`** (rein JavaScript, keine zusätzlichen Systempakete im Image).

```bash
cd METAorder-v2
docker build -t metaorder-v2 .
```

**Build bricht mit `ENOSPC` / „no space left on device“ ab:** Docker (VM oder BuildKit) hat nicht genug freien Speicher — oft nach vielen Images/Layern. Auf dem Host: **`docker system prune -a`** (oder in Docker Desktop *Clean / Purge data*) und ggf. **Disk image size** vergrössern. Das Dockerfile ist als **ein Stage** gebaut: nur **ein** `npm ci`, danach `npm prune --omit=dev` und **kein** zweites Auspacken/Kopieren von `node_modules` in eine zweite Stage — das reduziert die Spitzenlast. Zusaetzlich werden nach dem Build **ueberfluessige** `@napi-rs/canvas-*` Pakete entfernt (Kommen ueber **pdf-parse**; npm legt sonst Binaer fuer alle Plattformen inkl. musl ab — oft mehrere hundert MB.) Wenn die Docker-Disk trotzdem voll ist, muss Platz geschaffen werden, sonst schlägt jeder Build fehl.

## Compose (Beispiel mit Postgres + pgvector)

```bash
export SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up --build
```

**Neues Frontend im Browser:** Nach `docker compose build` muss der **App-Container das neue Image nutzen** — z. B. `docker compose up -d --build --force-recreate app`. Nur `build` ohne neuen Container laeuft weiter mit dem alten Image. Zum Test ohne Layer-Cache: `docker compose build --no-cache app`.

**Cross-Selling Bulk:** `docker-compose.yml` reicht **`CROSS_SELL_BULK_ENABLED`** aus der Host-Umgebung (z. B. `.env` neben Compose) an den App-Container durch. Siehe Tabelle **Umgebungsvariablen** unten (`false` sperrt `POST /api/cross-selling-rules/execute-bulk`).

**Cross-Sell LLM-Re-Rank:** Optional **`CROSS_SELL_LLM_RERANK_ENABLED`**, **`CROSS_SELL_LLM_RERANK_TOPK`**, **`CROSS_SELL_LLM_RERANK_TTL_HOURS`** — steuern GPT-4o-Re-Ranking und Cache fuer interaktive Vorschlaege (siehe Tabelle unten).

**Angebots-Modal (Tab „PDF“, Konfigurations-PDF):** Diese UI steckt in der gebauten SPA unter `dist/public` (Vite-Build im Dockerfile). Fehlt der Tab im Browser trotz aktuellem Quellcode, liegt es fast immer an einem **veralteten Image** oder daran, dass der Build-Kontext **nicht** der Ordner `METAorder-v2/` mit der aktuellen `client/`-Version ist. Nach dem Deploy: Hard-Reload / privates Fenster (siehe naechster Absatz).

**Einstellungen (7 Tabs):** Mandanten, Shopware, Angebote, Tickets, E-Mail, Marketing und KI sind in der SPA unter `/settings` gruppiert. Es gibt **keine** neuen Pflicht-Umgebungsvariablen, **keine** SQL-Migrationen und **kein** zusaetzliches Volume — nur Image neu bauen und den App-Container mit `--force-recreate` starten (wie bei anderen reinen Frontend-Aenderungen).

**Nachberechnung (Bestelldetail, Tab „Nachberechnung“):** Freie Rechnungspositionen (z. B. Versandkosten), PDF im META-Briefpapier und Upload als Shopware-**Rechnungsdokument** (`POST /api/orders/:orderId/additional-invoice`, Rechte `manageDocuments` + CSRF). Es gibt **keine** neuen Pflicht-Umgebungsvariablen, **keine** SQL-Migrationen und **kein** zusaetzliches Volume — nur Image neu bauen und den App-Container mit `--force-recreate` starten. Voraussetzung: gueltige **Shopware-API-Zugangsdaten** im Mandanten (wie fuer andere Dokument-Uploads).

**„Sehe trotzdem die alte Oberflaeche“:** Haeufig **Browser- oder Proxy-Cache** auf `index.html` (alte Seite verweist noch auf alte JS-Hashes). Hard-Reload / Cache leeren, privates Fenster, oder Reverse-Proxy so setzen, dass HTML nicht aggressiv gecacht wird. Die Produktions-App setzt `Cache-Control: no-store` fuer die SPA-`index.html` und lange Caches nur fuer `/assets/*` (gehashte Dateien).

**Port / „address already in use“ auf Port 5000:** Unter macOS nutzt hauefig **AirPlay-Empfang** (Control Center) den Port **5000**. Compose mappt deshalb standardmaessig **`HOST_PORT` → Container 5000** (Default **`5001`**): im Browser **http://localhost:5001**. Anderen Host-Port: `HOST_PORT=8080 docker compose up`. Container-intern bleibt die App auf **5000** (`PORT`).

**Frontend leer / laedt nicht:** Zuerst **richtige URL** (bei Compose meist **:5001**, nicht :5000). Dann Browser-Konsole (F12) auf Fehler pruefen. Startet der Node-Prozess nicht: `LISTEN_REUSE_PORT=false` in der `environment`-Sektion der App versuchen. Ohne gebaute SPA schlaegt `npm start` fehl — vorher `npm run build` oder Docker-Image bauen.

Vor dem Start fuehrt der Entrypoint **`scripts/run-migrations.mjs`** aus — damit werden alle Dateien unter `migrations/*.sql` in Sortierreihenfolge angewendet (u. a. **Teilzahlung** `0005_installment_plans.sql`, **Anzahlung %** `0006_add_deposit_percent.sql`, **Commercial-Agent-Lernen** `0007_commercial_agent_learning.sql`, **öffentliche Angebots-Links** `0008_offer_public_links.sql`, **Commercial-Webhook-Eventtypen** `0009_webhook_commercial_events.sql`, **Integrations-API-Keys pro Mandant** `0010_tenant_integration_api_keys.sql`, **Indizes** `0011_tenant_query_indexes.sql`, **Angebots-Entwürfe / Shopware** `0012_offer_drafts_shopware_offer_id_idx.sql`, **CPQ-Review-Queue** `0014_cpq_review_queue_sprint2.sql`, **Cross-Sell-Events (Lernen)** `0015_cross_sell_events.sql`). `extracted_data` in Angebots-/Bestell-Entwürfen bleibt JSONB — z. B. optionale Adressfelder wie `phone` brauchen **keine** eigene SQL-Migration.

**Angebots-/Bestell-Entwurf Review (strengeres Matching, Klärungsbedarf, Rückfrage-Vorschau):** Läuft vollständig in der gebauten SPA + API im selben Image. Es gibt **keine** neuen Pflicht-Umgebungsvariablen und **keinen** Versand von E-Mail aus dem Container — nur lesende Endpunkte `GET /api/offer-drafts/:id/clarification-email` und `GET /api/order-drafts/:id/clarification-email`. Nach Deploy wie gewohnt: Image neu bauen, App-Container mit `--force-recreate` starten (siehe Absatz zu SPA-Cache oben).

### Leere Postgres-DB: `relation ... does not exist`

Die SQL-Dateien unter `migrations/` ergaenzen ein **bestehendes** Schema (Spalten, zusaetzliche Tabellen). Die **Haupttabellen** (u. a. `tenants`, `users`, `cross_selling_rules`) kommen aus **`shared/schema.ts`** und muessen zuerst per **Drizzle** angelegt werden:

1. **`docker compose up -d db`** und warten bis **healthy**. Compose mappt Postgres standardmaessig auf **`127.0.0.1:5433`** (nicht 5432), damit nicht versehentlich die **lokale** PostgreSQL-Installation auf dem Mac angesprochen wird — dort gibt es oft **keine** Rolle `metaorder`, daher der Fehler *role "metaorder" does not exist*, wenn die URL noch `:5432` nutzt.
2. Vom Rechner im Ordner **`METAorder-v2`** (mit `node_modules`). **`npm run db:push`** legt zuerst die Erweiterung **`vector`** an (pgvector), danach synchronisiert Drizzle das Schema — ohne Extension schlaegt Push mit *type \"vector\" does not exist* fehl. Image **pgvector/pgvector** (wie in Compose) ist Pflicht.

   ```bash
   export DATABASE_URL="postgresql://metaorder:metaorder@127.0.0.1:5433/metaorder"
   npm run db:push
   ```

   Anderer Host-Port: in Compose `POSTGRES_PUBLISH_PORT=5434` setzen und dieselbe Portnummer in der URL verwenden.

3. Danach **`docker compose up -d --build`** (App startet, SQL-Migrationen laufen durch).

In Produktion die **`ports:`-Zeile bei `db` entfernen** (oder nur hinter Firewall), wenn die Datenbank nicht vom Entwicklerrechner aus erreichbar sein soll.

Ohne diesen Schritt schlagen Migrationen fehl, sobald sie Tabellen referenzieren, die es noch nicht gibt (Fehler **42P01**). Die Datei **`0001_add_category_to_cross_selling.sql`** ist so geschrieben, dass sie auf leerer DB **nichts tut** (kein Fehler), sobald die Tabelle existiert, wird die Spalte `category` ergaenzt.

## Wichtige Umgebungsvariablen

| Variable | Beschreibung |
|----------|----------------|
| `DATABASE_URL` | PostgreSQL-Connection-String (ohne diesen Wert startet die App nicht) |
| `SESSION_SECRET` | In Produktion setzen (nicht Default) |
| `PORT` | Im Container standardmaessig **5000** (nur Host-Mapping aendern, nicht zwingend diese Variable) |
| `PUBLIC_APP_URL` | Optional: kanonische öffentliche Basis-URL (ohne Slash am Ende), z. B. `https://auftraege.example.com` — für **Kundenlinks** zu `/angebot/...` beim Erzeugen im Angebots-Modal. Ohne Angabe: URL wird aus der aktuellen Host-Header-Anfrage abgeleitet. |
| `CPQ_GLB_PATH` | Optional: absoluter Pfad zum GLB-Ordner. Standard: zuerst `dist/public/cpq-models` (Produktion), sonst `client/public/cpq-models` (Entwicklung). |
| `CPQ_PRESENTATION_PLACEHOLDER_GLB` | Optional: Dateiname des **Präsentations-Placeholder-GLB** im GLB-Ordner (Default `_metaorder-presentation-placeholder.glb`). Wird genutzt, wenn kein produktspezifisches GLB gefunden wird. |
| `HOST_PORT` | Nur **Compose**: Host-Port fuer `HOST_PORT:5000` (Default **5001**, wegen macOS / AirPlay auf 5000) |
| `POSTGRES_PUBLISH_PORT` | Host-Port fuer Postgres (**Default 5433**), nur **127.0.0.1** — fuer `db:push` / psql |
| `UPLOADS_DIR` | Absoluter Pfad zum Upload-Verzeichnis; im Image standardmaessig **`/app/uploads`**. Ohne diese Variable leitet die App den Pfad aus dem Installationsort ab (`dist/` → ein Verzeichnis darüber + `uploads/`). **Wichtig bei Docker:** `UPLOADS_DIR` muss **derselbe Pfad** sein wie das Compose-Volume (z. B. `metaorder_uploads:/app/uploads` → `UPLOADS_DIR=/app/uploads`). Sonst schreibt der Prozess bei abweichendem Arbeitsverzeichnis ins Dateisystem des Containers statt ins Volume. |
| **MinIO / S3 (Compose)** | Siehe Abschnitt **Object Storage (MinIO)** unten. Ohne `S3_*` nutzt die App **lokale** Ticket-Anhänge unter `uploads/ticket-attachments/`. |
| `METAORDER_PDF_LOGO_PATH` | Optional: absoluter Pfad zu einer PNG-/JPEG-Datei fuer Firmenlogo in PDFs (Konfigurations-Angebot, Teilzahlungsrechnung). Ohne Angabe: zuerst **`META_at_all_levels_RGB.png`** (cwd, dann **`/app/server/pdfAssets/META_at_all_levels_RGB.png`**, App-Root, Legacy **`meta-logo.png`**). Kaputte Dateien werden uebersprungen. |

Shopware, E-Mail, optionale Dienste: wie bisher ueber `.env` / Compose `environment` ergaenzen (siehe betriebliche Doku).

| Variable (optional) | Beschreibung |
|---------------------|--------------|
| `COMMERCIAL_AGENT_ENABLED` | `true` schaltet den Commercial Agent serverseitig an (zusaetzlich UI-Einstellungen). |
| `COMMERCIAL_AGENT_LEARNING` | `false` deaktiviert das Speichern/Few-Shot-Lernen aus Dokumenten. Curated `.eml`-Sammlungen koennen einmalig per **`npm run commercial-agent:import-eml`** in `commercial_agent_exemplars` importiert werden (siehe `training/commercial-agent/README.md`; im Container `DATABASE_URL` + Host-Pfade oder JSONL-Export vom Host). |
| `COMMERCIAL_AGENT_SUBAGENTS` | `false` deaktiviert den PDF-Sub-Agent bei der Intent-Erkennung. |
| `COMMERCIAL_AGENT_EXEMPLARS_MAX` | Max. Exemplare im Intent-Prompt (1–12). |
| `COMMERCIAL_AGENT_INTENT_REVIEW_MIN_CONFIDENCE` | Optional: 0–1 — Intent unterhalb → Entwurf mindestens „Review“ (Default in `aiConfig`, siehe `intentReviewMinConfidence`). |
| `COMMERCIAL_AGENT_CUSTOMER_MATCH_AUTO_MIN` | Optional: 0–100 — Mindest-Confidence für **automatisches Angebot/Bestellung** nach Shopware-Kundenzuordnung oder -anlage (Default `customerMatchAutoMinConfidence`, typisch 72). |
| `COMMERCIAL_AGENT_CUSTOMER_AUTO_CREATE_MIN` | Optional: 0–100 — Mindest-Score für **automatische Shopware-Kundenanlage** bei fehlendem Match, getrennt von der Anzeige-Confidence (Default `customerAutoCreateMinConfidence`, typisch 50). |
| `COMMERCIAL_AGENT_MIN_RANKED_EMAIL_SCORE` | Optional: Mindest-Heuristik-Score der Top-E-Mail für Auto-Anlage (Default `minRankedEmailScoreForAutoCreate`, typisch 12). |
| `COMMERCIAL_AGENT_SIGNATURE_VISION` | `true` / `false` — Firmenname aus Signatur-Grafiken per Vision (OpenAI), nur wenn UI/Setting aktiv und Firma noch leer. |
| `COMMERCIAL_AGENT_WEB_VERIFY` | `true` / `false` überschreibt die UI-Einstellung **Webprüfung (Impressum)**: bei `true` ruft die Angebots-/Bestell-Pipeline nach der Extraktion bis zu drei HTTPS-Seiten der Kunden-Domain ab (z. B. `/impressum`) und legt nur Hinweise unter `extractedData.webDomainVerification` ab — **keine** automatische Korrektur der Adresse. Outbound-HTTPS wie bei OpenAI; keine extra Container-Pakete. |
| `COMMERCIAL_AGENT_DEBUG` | `true` / `1`: strukturierte Debug-Zeilen (`[CommercialAgent:debug]` + NDJSON) für Intent-Pipeline (Orchestrator, Klassifikation, Sub-Agenten). Jede Zeile enthält bei E-Mail-Verarbeitung dieselbe **`traceId`** (RFC Message-ID bzw. interne `messageId` / manueller Upload-Id). Filtern z. B. mit `jq -c 'select(.traceId=="…")'`. |
| `COMMERCIAL_AGENT_DEBUG_FILE` | Optional: absoluter Pfad z. B. `/app/uploads/commercial-agent-debug.ndjson` — jede Zeile ein JSON-Objekt (Volume `metaorder_uploads` mounten). Ohne Variable: nur stdout → `docker logs`. |
| `COMMERCIAL_AGENT_DEBUG_VERBOSE` | `true`: längere Textausschnitte in Logs (**PII** möglich — nur kurzzeitig in Testumgebungen). |
| `COMMERCIAL_AGENT_STRICT_AUTO_CREATE` | `true` (Default): nur Strikt-Regel für Auto-Create; `false` = alter Schwellen-Pfad (Intent/Match). |
| `COMMERCIAL_AGENT_STRICT_MIN_INTENT` | Mindest-Intent für Strikt-Auto-Create (Default `0.95`). |
| `COMMERCIAL_AGENT_STRICT_MIN_CUSTOMER` | Mindest-Kunden-Match-Score für Strikt (Default `95`). |
| `N8N_ADMIN_USER` / `N8N_ADMIN_PASSWORD` | Basic Auth für n8n-UI (Service `n8n` in Compose). |
| `METAORDER_BASE_URL` | Basis-URL für n8n-HTTP-Nodes (z. B. `http://host.docker.internal:5001`). |
| `METAORDER_INTEGRATION_API_KEY` | Key für `X-METAORDER-Integration-Key` in n8n-Workflows. |
| `LLM_DEBUG` | `true` / `1`: pro `chatCompletion` eine Zeile `[LLM_DEBUG]` (Provider, Modell, ms, Antwortlänge) — gilt für **alle** Chat-KI-Aufrufe, nicht nur Commercial Agent. |
| `AI_MODE` | z. B. `openai_optional` / `openai_only` — siehe `server/aiConfig.ts`. |
| `METAORDER_INTEGRATION_API_KEY` | Optional: **ein** gemeinsames Secret für **Integrations-Auth** (n8n, Skripte). Header **`X-METAORDER-Integration-Key`**. Für **eine Instanz mit mehreren Mandanten** besser **mandantenspezifische Keys** über die API anlegen (`POST /api/settings/integration-api-keys`), siehe [multitenant-security.md](multitenant-security.md). |
| `METAORDER_INTEGRATION_USER_ID` | Optional: UUID eines Benutzers, unter dem Integrations-Requests laufen. Wenn nicht gesetzt, wird **`n8n-service`** verwendet. Der Benutzer muss dem jeweiligen Mandanten in **`tenant_users`** zugeordnet sein. |
| `METAORDER_STRICT_TENANT` | `true`: Nach JWT-Auth ist für fast alle `/api/*`-Routen ein **gewählter Mandant** Pflicht (Ausnahmen: Mandantenliste, Profil, Token). Empfohlen für Shared-SaaS. |
| `METAORDER_INTEGRATION_TENANT_ID` | Bei `METAORDER_STRICT_TENANT=true` **und** Nutzung des **globalen** `METAORDER_INTEGRATION_API_KEY`: UUID des Mandanten, unter dem Integrations-Requests laufen sollen. |
| `REQUEST_LOG_SLOW_MS` | Optional: Zahl in ms — API-Requests ab dieser Dauer erzeugen **`[slow-request]`** in den Logs (siehe `server/index.ts`). |
| `PG_POOL_MAX` | Optional: Max. Verbindungen im **node-postgres**-Pool (Default **20**), nur bei klassischem `DATABASE_URL` ohne Neon-Treiber. |
| `CROSS_SELL_BULK_ENABLED` | Optional: `false` deaktiviert **`POST /api/cross-selling-rules/execute-bulk`** (Massen-Anlage von Cross-Selling-Gruppen in Shopware). Ohne Variable oder jeder andere Wert: Endpunkt aktiv. |
| `CROSS_SELL_LLM_RERANK_ENABLED` | Optional: `false` / `0` schaltet **GPT-4o Re-Rank** fuer Cross-Sell-Vorschlaege aus (rein heuristischer Hybrid-Score). Default in der App: **an**, wenn OpenAI konfiguriert ist. |
| `CROSS_SELL_LLM_RERANK_TOPK` | Optional: Zahl — wie viele Hybrid-Kandidaten maximal an das LLM gehen (Default **25**). |
| `CROSS_SELL_LLM_RERANK_TTL_HOURS` | Optional: Cache-TTL in Stunden fuer LLM-Re-Rank pro Quellartikel (Default **24**). |
| `METAORDER_GTIN_ARTICLE_PREFIX` | Optional: Nur Ziffern — gemeinsamer Anfang firmeneigener GTIN/EAN (Default **4026212**). Steuert 6-stellige Artikelnummern als GTIN-Fragment sowie synthetische GTIN (`Präfix + 6 Ziffern`) im Katalog-Matching; überschreibbar pro Installation. Typische Anfrage-Schreibweise **„4026212 073492“** (Leerzeichen zwischen Präfix und Suffix) wird erkannt; ohne dieses Muster gelten sechsstellige Suffixe nur ab **200000**, damit nicht jede 6er-Zahl als Artikel gilt. |
| `SENTRY_DSN_BACKEND` | Optional: Backend-DSN fuer Sprint-8 Monitoring Basisintegration. |
| `SENTRY_ENVIRONMENT` | Optional: Sentry Environment (`staging`, `production`, ...). |
| `SENTRY_RELEASE` | Optional: Release-Tag (z. B. Image-Tag/Commit). |
| `SENTRY_TRACES_SAMPLE_RATE` | Optional: Sampling fuer Backend Tracing (Default `0.1`). |
| `VITE_SENTRY_DSN_FRONTEND` | Optional: Frontend-DSN fuer Storefront/UI Monitoring. |
| `VITE_SENTRY_ENVIRONMENT` | Optional: Frontend Environment-Tag. |
| `VITE_SENTRY_RELEASE` | Optional: Frontend Release-Tag. |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | Optional: Sampling fuer Frontend Tracing (Default `0.1`). |

KI-Schluessel (OpenAI / Anthropic) werden in der Regel **in der App unter Einstellungen** gesetzt (verschluesselt in der DB), nicht zwingend als Container-Env.

## Persistente Daten

| Pfad / Volume | Inhalt |
|---------------|--------|
| Postgres-Volume (`metaorder_pgdata` in Compose) | Datenbank inkl. `installment_plans` / `installment_invoices` |
| **`/app/uploads`** (Volume `metaorder_uploads`) | u. a. `installment-agreements/` (PDF Teilzahlungsvereinbarung), `dunning/`, **`ticket-attachments/`** (E-Mail-Anhänge ohne Google Object Storage), `commercial-agent-incoming/` (Commercial Agent PDFs), optional Debug-Logdatei wenn `COMMERCIAL_AGENT_DEBUG_FILE` darauf zeigt |
| **`/app/server/pdfAssets/`** (im Image, ohne Volume) | Standard-PDF-Logo **`META_at_all_levels_RGB.png`** — durch eigenes META-Firmenlogo ersetzen (Custom-Image bauen) oder `METAORDER_PDF_LOGO_PATH` setzen. |

Ohne Volume fuer `uploads` gehen generierte PDFs nach Container-Neustart verloren.

## Object Storage (MinIO)

Das Compose-Beispiel startet **MinIO** (S3-kompatible API) und setzt in der **App** die Variablen `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_FORCE_PATH_STYLE=true`. Dann landen **Ticket-Anhänge aus dem E-Mail-Eingang** (und manuelle Uploads mit Object-Storage-Pfad) im Bucket **`metaorder`** statt nur lokal.

| Service | Port (Host, Default) | Hinweis |
|---------|----------------------|---------|
| MinIO API | `127.0.0.1:9002` → Container `9000` | Nur bei Bedarf vom Host testen; die App spricht `http://minio:9000`. |
| MinIO Console | `127.0.0.1:9003` → `9001` | Web-UI mit denselben Zugangsdaten wie `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD`. |

**Zugangsdaten (Compose-Defaults):** `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` (siehe `docker-compose.yml`, per `.env` überschreiben). Der **Einmal-Job** `minio-init` legt den Bucket `metaorder` an. Die **App** wartet auf `minio-init` (`service_completed_successfully`) — dafür **Docker Compose v2.20+** empfohlen. Bei älterem Compose: `minio-init`-Abhängigkeit bei `app` entfernen und einmalig `docker compose run --rm minio-init` ausführen.

| Variable (App) | Beschreibung |
|----------------|--------------|
| `S3_ENDPOINT` | z. B. `http://minio:9000` (Container-Netz) |
| `S3_BUCKET` | Bucket-Name, z. B. `metaorder` |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Gleich `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` bei MinIO |
| `S3_REGION` | Beliebig bei MinIO, z. B. `us-east-1` |
| `S3_FORCE_PATH_STYLE` | `true` für MinIO (Default in Compose) |
| `S3_OBJECT_PREFIX` | Optional: Schlüssel-Präfix vor `ticket-attachments/` |

**Replit / Google Cloud Storage:** Unverändert über **`PRIVATE_OBJECT_DIR`** im Format `/bucket-name/optional/prefix` (ohne gleichzeitige `S3_ENDPOINT`+`S3_BUCKET`+Keys — S3 hat Vorrang).

Persistenz: Volume **`metaorder_minio`**.

## Onboarding: neue Firma (Checkliste)

**Spur A — eigene Installation pro Kunde (ein Mandant oder wenige in einer DB):**

1. Image/Compose wie oben; `SESSION_SECRET`, `ENCRYPTION_KEY`, `DATABASE_URL` setzen.
2. Einmalig Schema: `npm run db:push` (oder bestehende DB), danach Container-Start (Migrationen `0010`/`0011` u. a.).
3. Admin anlegen / Seed prüfen; unter **Einstellungen** Mandant wählen (falls mehrere).
4. **Shopware**-Zugang pro Mandant in den Einstellungen speichern; Verbindungstest nutzen.
5. Volumes: **`metaorder_pgdata`** (Backup-Strategie), **`metaorder_uploads`** (PDFs, Anhänge).
6. Optional **n8n**: Integrations-User (`n8n-service` oder `METAORDER_INTEGRATION_USER_ID`) dem Mandanten zuordnen; API-Key per `POST /api/settings/integration-api-keys` erzeugen (oder globalen Key nur bei klarer Ein-Mandanten-Installation).

**Spur B — eine Instanz, viele Firmen:** `METAORDER_STRICT_TENANT=true` setzen; pro Firma Mandant + Benutzer + Shopware; **kein** globaler Integrations-Key ohne `METAORDER_INTEGRATION_TENANT_ID`. Details: [multitenant-security.md](multitenant-security.md).

## Einmalige Wartungs-Skripte

### regulationPrice (günstigster Preis 30 Tage) zurücksetzen

Entfernt bei **allen** Shopware-Produkten des Mandanten den Streichpreis (`regulationPrice` im `price`-Array auf `null`). Verkaufspreise (`gross`/`net`) bleiben unverändert.

Nach Code-Aenderung am Skript: **Image neu bauen** (`docker compose build app` und App neu starten). Das Skript liegt gebündelt unter `dist/scripts/` (ohne `tsx` im Produktions-Image).

```bash
# Dry-Run (nur zählen + Beispiele, keine Shopware-Schreibzugriffe)
docker compose exec app npm run reset:regulation-price -- <tenantId>

# Tatsächlich anwenden
docker compose exec app npm run reset:regulation-price -- <tenantId> --apply
```

Live-Mandant (Beispiel aus lokaler Seed-DB): `8df98804-492e-4ed0-9699-a2f7036dea98`

Lokal mit `tsx` (ohne vorherigen `npm run build`):

```bash
npm run reset:regulation-price:dev -- <tenantId> --apply
```

Lokal gegen Docker-Postgres: dieselbe `ENCRYPTION_KEY` wie in `docker-compose.yml` setzen, sonst schlaegt die Entschluesselung der Shopware-Keys fehl.

Optional: `--batch-size=500` steuert die Such-Pagination; Sync erfolgt in Batches à 100 Produkte.

## Teilzahlung / neue Migration

Nach einem Deployment mit aktuellem Image laufen Migrationen beim **naechsten Container-Start** automatisch. Bestehende manuelle Deployments: sicherstellen, dass der Startbefehl `node scripts/run-migrations.mjs` (oder der mitgelieferte **docker-entrypoint**) ausgefuehrt wird, bevor `node dist/index.js` startet.
