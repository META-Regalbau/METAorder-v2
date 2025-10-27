# METAorder

Ein internes Bestellverwaltungssystem für die Verarbeitung und Verfolgung von E-Commerce-Bestellungen aus Shopware 6.

## Übersicht

METAorder bietet eine zentralisierte Oberfläche für Mitarbeiter und Administratoren zur Verwaltung von Shopware-Bestellungen mit folgenden Hauptfunktionen:

- 📦 **Bestellverwaltung**: Anzeige, Filterung und Aktualisierung von Bestellungen
- 🔐 **Rollenbasierte Zugriffskontrolle**: Granulare Berechtigungen für verschiedene Benutzerrollen
- 🌍 **Mehrsprachigkeit**: Deutsch (Standard), Englisch, Spanisch
- 📊 **Export-Funktionalität**: CSV, Excel und JSON-Exporte mit rollenbasierten Filtern
- 🎯 **Cross-Selling Management**: Automatisierte Produktempfehlungen mit Regel-Engine
- 💰 **B2B-optimiert**: Netto/Brutto-Preisanzeige mit korrekter Steuerberechnung

## Technologie-Stack

### Frontend
- React 18 mit TypeScript
- Vite als Build-Tool
- Tailwind CSS + shadcn/ui (Material Design)
- TanStack Query für Server-State-Management
- Wouter für Routing
- i18next für Internationalisierung

### Backend
- Node.js mit Express.js
- TypeScript
- PostgreSQL mit Drizzle ORM
- Passport.js für Authentifizierung
- Session-basierte Auth mit bcrypt

## Voraussetzungen

- Node.js 18+ 
- PostgreSQL-Datenbank
- Shopware 6 API-Zugang

## Installation

### 1. Repository klonen

```bash
git clone <repository-url>
cd metaorder
```

### 2. Abhängigkeiten installieren

```bash
npm install
```

### 3. Umgebungsvariablen konfigurieren

Erstellen Sie eine `.env`-Datei im Projektverzeichnis oder setzen Sie die folgenden Secrets in Replit:

```env
# Datenbank
DATABASE_URL=postgresql://user:password@host:port/database
PGHOST=your-db-host
PGPORT=5432
PGUSER=your-db-user
PGPASSWORD=your-db-password
PGDATABASE=your-db-name

# Session
SESSION_SECRET=your-secure-random-secret-here

# Environment
NODE_ENV=development
PORT=5000
```

### 4. Datenbank initialisieren

Das Schema wird automatisch mit Drizzle ORM synchronisiert:

```bash
npm run db:push
```

Bei Daten-Konflikten können Sie mit `--force` erzwingen:

```bash
npm run db:push --force
```

### 5. Shopware API-Konfiguration

Nach dem ersten Start müssen Sie die Shopware-Verbindung in der Anwendung konfigurieren:

1. Starten Sie die Anwendung (siehe unten)
2. Melden Sie sich mit den Standard-Zugangsdaten an (siehe "Erste Schritte")
3. Navigieren Sie zu **Einstellungen**
4. Geben Sie Ihre Shopware-API-Credentials ein:
   - **API URL**: `https://ihr-shop.de`
   - **Client ID**: Ihre Shopware OAuth Client-ID
   - **Client Secret**: Ihr Shopware OAuth Client-Secret

Die Anwendung verwendet OAuth 2.0 Client Credentials Flow für die Shopware-Authentifizierung.

## Entwicklung

### Anwendung starten

```bash
npm run dev
```

Die Anwendung ist verfügbar unter: `http://localhost:5000`

### Erste Schritte

Bei der ersten Initialisierung werden automatisch folgende Testbenutzer angelegt:

**Administrator:**
- Benutzername: `admin`
- Passwort: `admin123`

**Mitarbeiter:**
- Benutzername: `employee`
- Passwort: `employee123`

**⚠️ Wichtig:** Ändern Sie diese Passwörter sofort nach der ersten Anmeldung!

### Datenbank-Migrationen

Das Projekt verwendet **Drizzle ORM** mit einem schema-first Ansatz. Ändern Sie das Schema in `shared/schema.ts` und führen Sie dann aus:

```bash
npm run db:push
```

**Wichtig:** Schreiben Sie niemals manuelle SQL-Migrationen. Verwenden Sie immer `db:push`.

## Produktion

### Build erstellen

```bash
npm run build
```

### Produktionsserver starten

```bash
NODE_ENV=production npm start
```

### Deployment auf Replit

1. Klicken Sie auf den **"Publish"**-Button in Replit
2. Warten Sie, bis die Veröffentlichung abgeschlossen ist
3. Ihre App ist verfügbar unter: `https://ihr-projekt.replit.app`

**Wichtige Hinweise für Production:**
- Setzen Sie `NODE_ENV=production`
- Verwenden Sie ein sicheres `SESSION_SECRET`
- Konfigurieren Sie die PostgreSQL-Datenbank
- Stellen Sie sicher, dass alle Shopware-API-Credentials korrekt gesetzt sind

## Funktionen im Detail

### Bestellverwaltung
- Übersicht aller Shopware-Bestellungen
- Filterung nach Status, Zahlungsstatus, Datum und Verkaufskanal
- Detailansicht mit Produkten, Kunde und Lieferadresse
- Aktualisierung von Versandinformationen (Tracking-Code, Lieferdatum)
- Automatische Statusaktualisierung in Shopware beim Eintragen von Versandinfo

### Produktverwaltung
- Server-seitige Suche in Shopware-Produktdatenbank
- Detailansicht mit allen Produktinformationen
- Cross-Selling-Verwaltung (Shopware + eigene Regel-Engine)
- Rollenbasierte Sichtbarkeit (Mitarbeiter sehen nur zugewiesene Verkaufskanäle)

### Cross-Selling Regel-Engine
- Automatisierte Produktempfehlungen basierend auf Regeln
- Bedingungen: Kategorie, Name, Dimensionen, etc.
- Kriterien-Kombination mit AND-Logik
- sameProperty-Matching für identische Produkteigenschaften

### Benutzer- und Rollenverwaltung
- Granulare Berechtigungen (viewOrders, editOrders, manageUsers, etc.)
- Rollenbasierte Verkaufskanal-Zuweisung
- CRUD-Operationen für Benutzer und Rollen (nur für Admins)

### Export-Funktionalität
- CSV, Excel (XLSX) und JSON-Formate
- Anpassbare Spaltenauswahl
- Datumsbereich-Filter
- Rollenbasierte Verkaufskanal-Filterung
- UTF-8 BOM für Excel-Kompatibilität

### Mehrsprachigkeit
- Deutsch (Standard)
- Englisch
- Spanisch
- Währung: Euro (€)

## Projektstruktur

```
metaorder/
├── client/                 # Frontend React-Anwendung
│   ├── src/
│   │   ├── components/    # React-Komponenten
│   │   ├── pages/         # Seiten-Komponenten
│   │   ├── lib/           # Utilities und Helpers
│   │   └── hooks/         # Custom React Hooks
├── server/                # Backend Express-Server
│   ├── index.ts           # Server-Einstiegspunkt
│   ├── routes.ts          # API-Routen
│   ├── auth.ts            # Passport-Authentifizierung
│   ├── storage.ts         # Storage-Abstraktionsschicht
│   ├── dbStorage.ts       # PostgreSQL-Implementierung
│   ├── shopware.ts        # Shopware-API-Client
│   ├── ruleEngine.ts      # Cross-Selling-Regel-Engine
│   └── seedData.ts        # Datenbank-Seeding
├── shared/                # Geteilter Code (Frontend + Backend)
│   └── schema.ts          # Drizzle-Schema und Zod-Validierung
└── public/                # Statische Assets
```

## API-Endpunkte

### Authentifizierung
- `POST /api/auth/login` - Benutzer-Login
- `POST /api/auth/logout` - Benutzer-Logout
- `GET /api/auth/me` - Aktueller Benutzer

### Bestellungen
- `GET /api/orders` - Alle Bestellungen (mit Filterung)
- `GET /api/orders/:id` - Einzelne Bestellung
- `PATCH /api/orders/:id/shipping` - Versandinfo aktualisieren

### Produkte
- `GET /api/products` - Alle Produkte (mit Suche)
- `GET /api/products/:id` - Einzelnes Produkt
- `GET /api/products/:id/cross-selling` - Shopware Cross-Selling
- `GET /api/products/:id/cross-selling-suggestions` - Regel-basierte Vorschläge

### Benutzer & Rollen
- `GET /api/users` - Alle Benutzer
- `POST /api/users` - Benutzer erstellen
- `PATCH /api/users/:id` - Benutzer aktualisieren
- `DELETE /api/users/:id` - Benutzer löschen
- `GET /api/roles` - Alle Rollen
- `POST /api/roles` - Rolle erstellen
- `PATCH /api/roles/:id` - Rolle aktualisieren
- `DELETE /api/roles/:id` - Rolle löschen

### Export
- `POST /api/orders/export` - Bestellungen exportieren

### Einstellungen
- `GET /api/settings` - Shopware-Konfiguration abrufen
- `POST /api/settings` - Shopware-Konfiguration speichern

## Sicherheit

- Session-basierte Authentifizierung mit httpOnly-Cookies
- Passwort-Hashing mit bcryptjs
- Permission-basierte Zugriffskontrolle
- CSRF-Schutz durch SameSite-Cookies
- Trust-Proxy für Production (Replit)

## Troubleshooting

### Auth-Fehler in Production
**Problem:** 401-Fehler bei Produkten, Benutzern, Rollen nach Deployment.  
**Lösung:** `trust proxy` ist aktiviert. Stellen Sie sicher, dass die App neu veröffentlicht wurde.

### Datenbank-Verbindungsfehler
**Problem:** Kann keine Verbindung zur Datenbank herstellen.  
**Lösung:** Überprüfen Sie `DATABASE_URL` und alle `PG*`-Umgebungsvariablen.

### Shopware API-Fehler
**Problem:** "Unauthorized" bei Shopware-Anfragen.  
**Lösung:** Überprüfen Sie Client-ID und Client-Secret in den Einstellungen.

### Cross-Selling zeigt falsche Produkte
**Problem:** Produkte mit falschen Dimensionen werden vorgeschlagen.  
**Lösung:** Prüfen Sie die Regel-Konfiguration. Die Engine verwendet AND-Logik für alle Kriterien.

## Lizenz

Proprietär - Nur für internen Gebrauch.

## Support

Bei Fragen oder Problemen wenden Sie sich an das Entwicklungsteam.
