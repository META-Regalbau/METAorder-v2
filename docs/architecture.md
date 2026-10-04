# Architekturueberblick

## Systemkomponenten

- **Frontend**: React + TypeScript (Vite), Routing via Wouter, UI via Tailwind + shadcn/ui.
- **Backend**: Express.js (TypeScript) als API und SPA-Server.
- **Datenbank**: PostgreSQL mit Drizzle ORM; pgvector fuer semantische Suche.
- **Dateispeicher**: Uploads unter `uploads/` (Docker-Volume, u. a. `installment-agreements/`).
- **Docker**: Image und Compose-Beispiel im Projektroot; Details [docker.md](docker.md).
- **Integrationen**:
  - Shopware 6 API (Bestellungen, Produkte, Angebote)
  - B2B Sellers Suite (Angebote)
  - E-Mail (IMAP/SMTP, optional M365)
  - Google Analytics/Ads KPIs
  - Webhooks (n8n/Zapier u. a.)

## High-Level Datenfluss

```mermaid
flowchart LR
  user[User] --> ui[React_UI]
  ui --> api[Express_API]
  api --> db[(Postgres_pgvector)]
  api --> shopware[Shopware_API]
  api --> mail[Email_IMAP_SMTP_M365]
  api --> google[Google_GA4_Ads]
  api --> webhook[Webhook_Service]
  api --> storage[Uploads_ObjectStorage]
```

## Ordnerstruktur Backend (`server/`)

Direkt unter `server/` liegen nur App-Einstieg und Infrastruktur: `index.ts`, `routes.ts`, `vite.ts`, `db.ts`, `storage.ts`/`dbStorage.ts`, `uploadsRoot.ts`, `seedData.ts`. `db.ts` und `uploadsRoot.ts` lösen Pfade relativ zu `server/` auf (`..` = Projektroot) und müssen deshalb dort bleiben.

| Ordner | Inhalt |
|---|---|
| `ai/` | LLM-/OpenAI-Clients, KI-Einstellungen |
| `analytics/` | Auswertungen, NL-Analytics, Prognosen, GA/Ads-KPIs, Profitabilität |
| `auth/` | Login/Session, Kunden-Auth, JWT |
| `b2b/` | B2B-Sellers-Suite: Client, Admin, Portal-Benutzer |
| `commercial/` | KI-Pipeline für eingehende Anfragen/Bestellungen (Drafts, Agent, Bestätigungen) |
| `cpq/`, `cpq-core/` | Konfigurator, Preisfindung, Raumplaner |
| `cross-selling/` | Cross-Selling-Regeln, Ranking, Lernen |
| `email/` | IMAP/SMTP/M365, Parsing, Klassifikation, Routing |
| `erp/` | Warenwirtschaft, Lager, Versand |
| `extraction/` | Dokument-Extraktion (PDF/E-Mail → strukturierte Daten), Normalisierung |
| `invoicing/` | Rechnungen, Teilzahlung, Mahnwesen, Mondu, Buchhaltungsabgleich |
| `lib/` | Querschnitt: Mandantenkontext, Verschlüsselung, Webhooks, Object Storage, Caches |
| `offers/` | Angebote: PDF, öffentliche Angebotsseite, ERP-Export |
| `pdf/` | Gemeinsames Briefpapier und Logo für alle PDFs |
| `products/` | Produktcache, Matching, Preise, Herstellpreise |
| `semantic/` | Embeddings, semantische Suche, FAQ |
| `sftp/` | SFTP-Server und Upload |
| `shopware/` | Shopware-API-Client, Spiegelung, Token-Cache |
| `tickets/` | Ticket-KI, Automatisierung |

### Shopware-Client (`server/shopware/`)

`ShopwareClient` (`shopware.ts`) enthält nur den Kern: Felder, Konstruktor, Authentifizierung, `makeAuthenticatedRequest` und generische Helfer (`searchEntity`, Fingerprints, Nummernkreise). Die fachlichen Methoden liegen je Ressource in `client/*.ts` als Funktionen mit `this: ShopwareClient` und werden am Ende von `shopware.ts` am Prototyp installiert (für TypeScript per Interface-Merging deklariert). Für Aufrufer ändert sich nichts: weiter `new ShopwareClient(settings)` und `client.fetchOrders(…)`.

| Datei | Inhalt |
|---|---|
| `client/orders.ts` | Bestellungen lesen/anlegen, Status-Mapping, Fingerprints, Auswertungsdaten |
| `client/delivery.ts` | Versand (Lieferstatus, Versandmeldung), Mondu-Transaktionen |
| `client/documents.ts` | Rechnung, Lieferschein, Proforma, Mahnung, PDFs, Rechnungsversand |
| `client/products.ts` | Produkte, Suche, Datenqualität, Aktiv/Bestand/Preise, Kategorien, Kanäle, 3D-Modell |
| `client/crossSelling.ts` | Produkt-Cross-Selling in Shopware |
| `client/customers.ts` | Kunden, B2B-Portal-Benutzer, Storefront-Login |
| `client/pricing.ts` | Kundenpreise, Rabatte, Herstellpreise, Währungen, Individualpreis-Index |
| `client/offers.ts` | Angebote (B2B Sellers) |
| `client/masterData.ts` | Verkaufskanäle, Kategorien, Felder, Lieferzeiten, Standardwerte, Länder |
| `client/types.ts`, `client/mapping.ts` | Typen bzw. Mapping-/Normalisierungsfunktionen und Konstanten |

Neue Shopware-Methoden: als `export async function name(this: ShopwareClient, …)` im passenden `client/*.ts` anlegen und im `interface ShopwareClient` am Ende von `shopware.ts` eintragen.

### API-Routen (`server/routes/`)

`server/routes.ts` registriert nur noch die Bereichsmodule; die Routen liegen je Bereich in einer Datei mit einer `register…Routes(app)`-Funktion. Neue Routen gehören in das passende Modul (Reihenfolge-Hinweise stehen im Kopfkommentar von `routes.ts`).

| Datei | Pfade |
|---|---|
| `authRoutes.ts` | `/api/auth` (ohne M365), `/api/profile` |
| `userRoutes.ts` | `/api/users`, `/api/roles`, `/api/tenants` |
| `settingsRoutes.ts` | `/api/settings` |
| `orderRoutes.ts` | `/api/orders`, `/api/installment-plans` |
| `offerRoutes.ts` | `/api/offers` |
| `draftRoutes.ts` | `/api/order-drafts`, `/api/offer-drafts`, `/api/commercial-drafts`, `/api/commercial-agent` |
| `productRoutes.ts` | `/api/products`, `/api/bundles` |
| `crossSellingRoutes.ts` | `/api/cross-selling`, `/api/cross-selling-rules` |
| `crmRoutes.ts` | `/api/crm` |
| `ticketRoutes.ts` | `/api/tickets`, `/api/portal`, `/api/templates`, `/api/ticket-assignment-rules`, `/api/automation-rules`, `/api/attachments`, `/api/parse-email` |
| `aiRoutes.ts` | `/api/ai`, `/api/semantic` |
| `analyticsRoutes.ts` | `/api/analytics`, `/api/dashboard` |
| `notificationRoutes.ts` | `/api/notifications` |
| `masterDataRoutes.ts` | `/api/sales-channels`, `/api/categories`, `/api/search`, `/api/b2b` (Nachschlagewerte) |
| `integrationRoutes.ts` | `/api/email`, `/api/m365`, `/api/auth/m365`, `/api/webhooks`, `/api/cpq/public/offer-request` |
| `invoicingRoutes.ts` | `/api/dunning`, `/api/accounting` |
| `operationsRoutes.ts` | `/api/shipping`, `/api/carriers`, `/api/process-updates`, `/api/erp-automation`, `/api/debug` |
| `routeHelpers.ts` | gemeinsame Helfer (Verkaufskanal-Filter, Ticket-Zuweisung/-SLA, Anhang-Pfade, Bestell-Cache) |

Weitere Routen-Module liegen bei ihrer Domäne: `erp/erpRoutes.ts`, `cpq/cpqRoutes.ts`, `cpq-core/cpqCoreRoutes.ts`, `b2b/b2bAdminRoutes.ts`, `offers/publicOfferRoutes.ts`, `sftp/sftpRoutes.ts`, `commercial/commercialAcknowledgementRoutes.ts`. Die OpenAPI-Pfade erzeugt `scripts/generate-openapi-paths.mjs` beim Build aus `routes.ts`, allen Dateien in `server/routes/` sowie den CPQ- und Public-Offer-Routen.

## Backend-Start und Hintergrundjobs

Aus `server/index.ts`:

- Session- und CSRF-Setup, Security-Header.
- Registrierung der API-Routen und SPA-Fallback.
- **Hintergrundjobs**:
  - Cross-Selling Learning (regelmaessig)
  - Offer Learning (regelmaessig)
  - E-Mail Polling (regelmaessig)
  - Dunning/Mahnwesen (regelmaessig)

## Authentifizierung & Berechtigungen

- Session-basierte Auth mit httpOnly-Cookies.
- CSRF-Schutz (Double-Submit Cookie Pattern).
- Rollen und Permissions auf API-Ebene enforced (siehe `server/auth/auth.ts` und `shared/schema.ts`).

## Datenmodelle (Kurzueberblick)

Zentrale Typen/Tabellen in `shared/schema.ts`:

- **User/Roles/Tenants**: Mehrmandantenfaehigkeit mit Rollenrechten.
- **Orders/Offers/Products**: Shopware-Abbildungen fuer UI/Reporting.
- **Tickets**: Ticketing, Kommentare, Anhänge, Regeln, Aktivitaet.
- **Automation**: Regeln, Ausfuehrungshistorie.
- **Cross-Selling**: Regeln, AI-Regeln, Staging, Co-Occurrences.
- **Semantic**: Dokumente mit Embeddings fuer Suche/FAQ.

## Semantische Suche

- Texte werden in `semantic_documents` gespeichert.
- Embeddings via `semanticEmbeddings` erzeugt.
- Suche und FAQ ueber dedizierte API-Endpunkte.

## System-Poster (Gesamtdiagramm)

Ein zusammenhaengendes Mermaid-Poster (Nutzer, Stack, Persistenz, Integrationen, Docker): [metaorder-system-poster.md](metaorder-system-poster.md).

## Mandanten, Integration, Strikter Modus

Siehe [multitenant-security.md](multitenant-security.md) (Cross-Selling-Fallbacks, `METAORDER_STRICT_TENANT`, API-Keys pro Mandant, Performance-Hinweise).

## Logging

- **Zentraler Logger:** `server/lib/logger.ts` (pino). Produktion: eine JSON-Zeile je Eintrag; Entwicklung: lesbare Zeilen. Steuerung über `LOG_LEVEL` / `LOG_FORMAT` (siehe [docker.md](docker.md)).
- **Kontext automatisch:** Jede Zeile während einer Anfrage trägt `requestId` (auch im Antwort-Header `X-Request-Id`) und – nach der Anmeldung – `tenantId` (`server/lib/requestContext.ts`, `server/lib/tenantContext.ts`). Hinter multer stellt `restoreTenantContext` beides wieder her.
- **Bestehende `console.*`-Aufrufe** leitet `server/lib/consoleBridge.ts` in den Logger um (Text wie bei `console`, Fehlerobjekte als Feld `err` mit Stacktrace). **Neuer Code** nutzt direkt `logger` mit Feldern: `logger.info({ orderId }, "Bestellung angelegt")`, `logger.error({ err }, "Versand fehlgeschlagen")`.
- **Request-Log und Fehler-Handler:** `server/lib/httpLogging.ts` — eine Zeile je API-Anfrage (Methode, Pfad, Status, Dauer, IDs), **ohne Antwort-Inhalt**; unbehandelte Fehler mit Stacktrace und `requestId`.
- **Schwärzung:** Felder wie `password`, `token`, `apiKey`, `apiSecret`, `authorization`, `cookie` sowie der Roh-Body kaputter JSON-Anfragen (`err.body`) werden als `[REDACTED]` geloggt.
