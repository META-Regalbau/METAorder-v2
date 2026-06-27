# Frontend & UI

## UI-Stack

- React 18 + TypeScript
- Vite
- Tailwind CSS + shadcn/ui
- Routing: Wouter
- i18n: i18next

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
