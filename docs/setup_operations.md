# Setup & Betrieb

## Voraussetzungen

- Node.js 18+
- PostgreSQL (empfohlen: pgvector)
- Shopware 6 API-Zugang

## Lokale Entwicklung

1. Abhaengigkeiten installieren:
   - `npm install`
2. Datenbank-Schema synchronisieren:
   - `npm run db:push`
3. App starten:
   - `npm run dev`
4. Zugriff:
   - `http://localhost:5000`

## Docker (lokal)

Docker-Setup basiert auf `docker-compose.yml` und `docker.env`.

1. Konfiguration prüfen/anpassen:
   - `docker.env` (keine echten Secrets committen)
   - Shopware- und B2B-Sellers-Suite-Einstellungen (in UI nach erstem Start)
2. Container bauen und starten:
   - `docker compose up --build`
3. Zugriff:
   - `http://localhost:5001`
4. Stoppen:
   - `docker compose down`

### Docker Services

- **db**: `pgvector/pgvector:pg16` auf `5432`
- **app**: Node 22 Bookworm Slim, Build aus `Dockerfile`, mapped auf `5001 -> 5000`. Startet mit `db:push`, `db:migrate` (inkl. CPQ-Schema) und `node dist/index.js`
- Volumes: `metaorder_db`, `metaorder_uploads`

### B2B-Sellers-Suite

Angebote werden über die B2B-Sellers-Suite Admin API erstellt und verwaltet. Optionale Env-Vars in `docker.env`:
- `B2B_SELLERS_OFFER_PDF_ACTION` – PDF-Endpoint für Angebote
- `B2B_SELLERS_DEFAULT_SALES_CHANNEL` – Standard-Sales-Channel für neue Angebote (falls Nutzer keinen zugewiesen hat)

### CPQ-Modul im Docker

Das CPQ-Modul (Regalsysteme, Rabatt-Ampel, Produkt-Mappings, Warenkorb-Transfer) nutzt dieselbe PostgreSQL-Datenbank. Die Migration `0003_cpq_schema.sql` wird beim App-Start automatisch ausgeführt. Manuelle E2E-Prüfliste: [docs/cpq_e2e_checklist.md](cpq_e2e_checklist.md). Automatisierte Tests: `npm run test:bom`, `npm run test:cpq-units`.

#### Konfigurator: Stückliste und 3D-Vorschau

- **Stückliste (Zusammenfassung):** Benötigt gefüllten **Produkt-Cache** (Shopware-Sync einmal ausführen: Admin → Einstellungen → Shopware) sowie mindestens ein CPQ-System mit **Komponententypen** (Rollen frame, beam, shelf) und **Produkt-Mappings**. Fehlende Produkte im Katalog führen zu Fehlermeldungen in der Zusammenfassung.
- **3D-Vorschau:** GLB-Modelle werden aus dem Ordner `CPQ_GLB_PATH` geladen (Standard: `client/public/cpq-models`). Das Verzeichnis muss existieren, damit die Route `/cpq-models` statisch bereitgestellt wird. Alternativ: Umgebungsvariable `CPQ_GLB_PATH` setzen (z. B. Docker: `/app/cpq-models`). Dateinamen können nach Hersteller-/Produktnummer benannt sein (z. B. `10023_VZK.glb`, `4026212007886_10023_xyz.glb`). Zusätzlich kann pro Produkt-Mapping in der CPQ-Admin eine **Geometrie/GLB-URL** hinterlegt werden (Tab Produkt-Mappings → Mapping bearbeiten → Geometrie).

## Umgebungsvariablen (Ueberblick)

Die Doku enthaelt **nur die Schluessel**, keine Werte:

- App: `NODE_ENV`, `PORT`, `APP_URL`, `SESSION_SECRET`, `ENCRYPTION_KEY`, `SESSION_TIMEOUT`
- Datenbank: `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`
- Shopware: `SHOPWARE_INTERNAL_URL`, `SHOPWARE_PUBLIC_URL`
- B2B Sellers Suite: `B2B_SELLERS_*`
- Customer JWT: `CUSTOMER_JWT_*`
- Web Push: `VAPID_*`

## Erstkonfiguration (Shopware)

Nach dem ersten Start:

- In der UI zu **Einstellungen** navigieren.
- Shopware URL, Client ID und Client Secret setzen.

## Standard-Logins (nur initial)

Beim Seeding werden Testnutzer angelegt:

- Admin: `admin` / `admin123`
- Employee: `employee` / `employee123`

**Wichtig:** Nach dem ersten Login sofort aendern.

## Produktion

- Build: `npm run build`
- Start: `NODE_ENV=production npm start`
- Sicherstellen:
  - `SESSION_SECRET` und `ENCRYPTION_KEY` gesetzt
  - DB erreichbar
  - Shopware-Credentials konfiguriert

## Hinweise zur Datenbank

- Schema ist in `shared/schema.ts` definiert.
- Migrationen: `npm run db:push` (Drizzle) und `npm run db:migrate` (SQL-Dateien in `migrations/`, inkl. CPQ-Schema).
