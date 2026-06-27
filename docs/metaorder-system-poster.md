# METAorder: System-Poster (Architektur)

Ein zusammenhaengendes Ueberblicksdiagramm fuer Praesentationen, Onboarding und Reviews. Fuer Details siehe [architecture.md](architecture.md) und [docker.md](docker.md).

**Rendering:** Mermaid wird in GitHub, GitLab, vielen Markdown-Viewern und in Cursor unterstuetzt. Bei sehr kleinem Viewer-Fenster horizontal scrollen oder Zoom nutzen.

---

## Gesamtarchitektur (ein Diagramm)

```mermaid
flowchart TB
  subgraph users [Nutzer]
    staff[Mitarbeitende und Admins]
    guest[Kunden mit oeffentlichem Angebotslink]
  end

  subgraph process [Anwendung ein Node Prozess]
    direction TB
    spa["React SPA<br/>Vite · Wouter · TanStack Query · i18n · Tailwind shadcn"]
    exp["Express Server<br/>API · Session · CSRF · Security Headers"]
    jobs["Hintergrundjobs<br/>Cross-Sell-Learning · Offer-Learning · E-Mail-Polling · Mahnwesen"]
    spa <-->|HTTPS gleiche Origin| exp
    exp --- jobs
  end

  subgraph code [Code-Einstieg und Aufteilung]
    direction LR
    idx["server/index.ts<br/>Start · Middleware · Jobs starten"]
    routes["server/routes.ts<br/>Haupt-REST API"]
    cpq["server/cpq/cpqRoutes.ts<br/>CPQ API"]
    pub["server/publicOfferRoutes.ts<br/>oeffentliche Angebote"]
    idx --> routes
    idx --> cpq
    idx --> pub
    routes --- cpq
    routes --- pub
  end

  subgraph shared [Gemeinsame Basis]
    sch["shared/schema.ts<br/>Drizzle · Zod · Typen"]
  end

  exp --> idx
  routes --> sch
  cpq --> sch
  pub --> sch

  subgraph data [Persistenz und Dateien]
    direction TB
    pg[("PostgreSQL<br/>pgvector · Migrationen migrations/")]
    vol["Lokale Uploads<br/>UPLOADS_DIR z. B. /app/uploads<br/>Docker-Volume"]
    obj["Object Storage S3-kompatibel<br/>z. B. MinIO in docker-compose"]
  end

  exp --> pg
  exp --> vol
  exp --> obj

  subgraph ext [Externe Systeme und APIs]
    direction TB
    sw["Shopware 6<br/>Bestellungen Produkte Dokumente"]
    b2b["B2B Sellers Suite<br/>Angebote"]
    mail["E-Mail<br/>IMAP SMTP"]
    m365["Microsoft 365<br/>optional"]
    ggl["Google<br/>Analytics und Ads KPIs"]
    wh["Webhooks<br/>n8n Zapier u. a."]
    llm["LLM APIs<br/>OpenAI Anthropic u. a."]
  end

  exp <--> sw
  exp <--> b2b
  exp <--> mail
  exp <--> m365
  exp <--> ggl
  exp --> wh
  exp <--> llm

  staff --> spa
  guest --> exp

  domains["Backend-Funktionsbereiche in routes.ts und Modulen<br/>Bestellungen Versand Export Mahnung Ratenzahlung Mondu Proforma<br/>Tickets Vorlagen SLA Automation E-Mail · Produkte Bundles Cross-Selling<br/>Semantik Suche FAQ · Angebote ERP PDF Commercial Agent<br/>CPQ BOM Rabatte Quotes · CRM Buchhaltung Analytics · User Rollen Settings Webhooks"]

  routes -.-> domains

  subgraph compose [Typischer Deploy-Stack docker-compose.yml]
    direction LR
    c_app["Service app<br/>PORT 5000 im Container"]
    c_db["Service db<br/>PostgreSQL 16 pgvector"]
    c_minio["Service minio<br/>S3 API"]
    c_init["minio-init<br/>Bucket"]
    c_app --> c_db
    c_app --> c_minio
    c_init --> c_minio
  end

  exp -.->|gleicher Stack| c_app
```

Die gestrichelte Linie `exp -.-> c_app` ist eine **Zuordnung** (logischer Prozess zum Compose-Service **app**), kein technischer Aufruf innerhalb eines Containers.

Zusaetzlich: Die **logische** Anwendung (Prozess) entspricht dem **app**-Service; **db** und **minio** sind die im Compose abgebildeten Abhaengigkeiten.

---

## Funktionslandkarte UI (Orientierung)

Die Oberflaeche liegt unter `client/src/pages/` und spricht die gleichen `/api/...`-Endpunkte an wie der Knoten **Backend-Funktionsbereiche** im Diagramm.

| Bereich (Beispiele) | Seiten (Auszug) |
|---------------------|-----------------|
| Bestellungen & Logistik | `OrdersPage`, `DelayedOrdersPage`, `ShippingPage`, `ExportPage` |
| Dokumente & Zahlung | `DunningPreviewPage`, Ratenzahlung ueber Bestell-API |
| Angebote | `OffersPage`, `OfferPreviewPage`, `PublicOfferPage` |
| CPQ | `CPQConfiguratorPage`, `CPQAdminPage` |
| Verkauf & Daten | `ProductsPage`, `BundlesPage`, `CrossSellingRulesPage` |
| Support & Automatisierung | `TicketsPage`, `TicketRulesPage`, `TemplatesPage`, `AutomationRulesPage` |
| Steuerung & Compliance | `UsersPage`, `RolesPage`, `SettingsPage`, `WebhookLogsPage` |
| Analyse & KI | `AnalyticsPage`, `SemanticSearchPage`, `CrmPage`, `AccountingPage` |

---

## Build und Laufzeit (Kurz)

| Befehl | Bedeutung |
|--------|-----------|
| `npm run dev` | Entwicklung: `tsx server/index.ts`, SPA via Vite-Middleware |
| `npm run build` | OpenAPI, Vite-Client, esbuild-Server nach `dist/` |
| `npm start` | Production: `node dist/index.js` |
| `npm run db:migrate` | SQL unter `migrations/` (u. a. Container-Start) |

Docker: siehe [docker.md](docker.md) — persistent **`/app/uploads`** und DB-Volume wie im Compose-File.
