# Frontend & UI

## UI-Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- Routing: Wouter
- i18n: i18next, Sprachen Deutsch (Rueckfall), Englisch, Spanisch (`client/src/i18n/locales/*.json`; Spanisch mit „usted“)

Designprinzipien: siehe `design_guidelines.md`.

## App-Shell

- **TopBar**: Global Search, Tenant-Auswahl, Sprache, Benachrichtigungen, User-Menue.
- **Sidebar**: Hauptnavigation nach Bereichen.
- **Main Content**: Seiteninhalte (Tabellen, Cards, Filter, Formulare).

## Seiten (Pages)

Aus `client/src/pages/`:

- **DashboardPage**: Einstieg und Uebersicht.
- **OrdersPage**: Bestellungen, Filter, Tabelle, Detailmodal.
- **DelayedOrdersPage**: Verspaetete Bestellungen.
- **DunningPreviewPage**: Mahnwesen-Vorschau und Versand.
- **ShippingPage**: Versandstatus und Tracking.
- **ProductsPage**: Produktliste und Suche (Shopware).
- **BundlesPage**: Bundle-Management.
- **TicketsPage**: Ticketliste, Filter, Detailmodal.
- **CrmPage**: CRM-Bereich (Kunden, Interaktionen).
- **TicketRulesPage**: Ticket-Zuweisungsregeln.
- **AutomationRulesPage**: Automationsregeln.
- **CrossSellingRulesPage**: Cross-Selling Regeln (manuell/AI/staging).
- **TemplatesPage**: Ticket-Templates.
- **OrderDraftsPage**: Bestellentwuerfe aus Dokumenten (AI).
- **OffersPage**: Angebote und Offer Drafts.
- **ExportPage**: Exporte/Reports.
- **AnalyticsPage**: KPI- und Chart-Ansichten.
- **SemanticSearchPage**: Globale semantische Suche.
- **UsersPage**: Benutzerverwaltung.
- **RolesPage**: Rollenverwaltung.
- **SettingsPage**: Einstellungen (Shopware, E-Mail, Webhooks, etc.).
- **WebhookLogsPage**: Webhook-Log-Ansicht.
- **ProfilePage**: Benutzerprofil.
- **AccountingPage**: Accounting/Abgleich.
- **LoginPage**: Login.
- **not-found**: 404.

## Typische UI-Flows

- **Order Flow**: Liste -> Detailmodal -> Versand/Docs update.
- **Ticket Flow**: Liste -> Detail -> Kommentar/Anhang -> Statuswechsel.
- **Draft Flow**: Upload (Order/Offer Draft) -> Review -> Erstellen.
- **Cross-Sell Flow**: Regeln erstellen -> Lernen (AI) -> Staging -> Aktivieren.

## Uebersetzung

- **Texte nur ueber `t("...")`:** Fest deutsche Texte in Komponenten findet `tests/unit/noGermanUiTexts.test.ts` (TS-Parser). Bewusste Ausnahmen sind dort mit Grund gelistet: die Kundenansicht des Angebots und die oeffentlichen Kundenseiten (durchgehend deutsch), der META-CLIP-Konfigurator (eigenes DE/EN-Textpaket) und Vorlagen-Inhalte (Benachrichtigungen, Mahn-E-Mail).
- **Vollstaendigkeit:** `tests/unit/i18nKeys.test.ts` verlangt fuer jeden verwendeten Schluessel einen deutschen Text; Englisch und Spanisch muessen jeden deutschen Schluessel mit denselben Platzhaltern enthalten. Plural mit `_one`/`_other` plus Basisschluessel.
- **Fehlermeldungen vom Server:** `apiRequest` wirft `ApiError` (`client/src/lib/apiError.ts`). Die Meldung kommt in der Sprache der Oberflaeche aus dem Katalog `apiErrors` (Code, fester Servertext, sonst „Serverfehler: …“ bzw. eine Meldung je Status). Jeder feste Fehlertext des Servers braucht einen Eintrag in `apiErrors.messages` (de/en/es); `tests/unit/apiError.test.ts` nennt fehlende mit Datei und Zeile. Pruefungen auf bestimmte Servertexte nutzen `apiErrorRaw`/`isNotConfiguredError`, nicht `error.message`. Eigene `fetch`-Aufrufe werfen `apiErrorFromBody`.
- **Zahlen, Betraege, Daten:** ueber `useLocaleFormat()` (`client/src/lib/localeFormat.ts`) in der Sprache der Oberflaeche, nie fest `de-DE` (`tests/unit/noFixedFormats.test.ts`).
