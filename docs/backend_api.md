# Backend & API

## Einstiegspunkt und Routen

- Einstieg: `server/index.ts`
- Routen: `server/routes.ts`
- Datenmodelle und Zod-Schemas: `shared/schema.ts`

Diese Doku ist **nicht vollstaendig**. Die komplette Liste steht in `server/routes.ts`.

### OpenAPI / Swagger

- **Swagger UI:** `GET /api/docs` — nur fuer **angemeldete** Nutzer (`requireAuth`); zuerst in der App einloggen, dann die URL im gleichen Browser aufrufen (Cookies `auth_token` / `csrf_token`).
- **Rohe Spezifikation:** `GET /api/openapi.json` (ebenfalls nur angemeldet).
- **Pfadliste aktualisieren:** `npm run openapi:generate` erzeugt `server/openapi/openapi.paths.ts` aus `server/routes.ts`, `server/cpq/cpqRoutes.ts` und `server/publicOfferRoutes.ts`. Der Befehl laeuft automatisch zu Beginn von `npm run build`.

## Authentifizierung & Sicherheit

- Session-basierte Auth mit httpOnly-Cookies.
- CSRF-Protection fuer alle aendernden Requests (ausgenommen Login).
- Rollen-/Permission-Checks via Middleware (z. B. `requireManageUsers`).
- Rate-Limits fuer Login und AI/semantic Endpoints.
- Uebersicht **OpenAI/KI-Features und Grenzen**: [ki-funktionen.md](ki-funktionen.md).

## API-Gruppen (Auszug)

### Auth

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`

### Orders

- `GET /api/orders`
- `GET /api/orders/:id`
- `PATCH /api/orders/:id/shipping`
- `PATCH /api/orders/:id/documents`
- `GET /api/orders/ticket-counts`
- `GET /api/orders/delayed`
- `GET /api/orders/:orderId/documents` — Shopware-Belege; Einträge können optional `amountGross` enthalten (Brutto-Bestellsumme zum Dokument-Zeitpunkt via `orderVersionId` und `GET /api/order/:id` mit Header `Sw-Version-Id`)

### Teilzahlung / Installment plans

Speicherung in Postgres (`installment_plans`, `installment_invoices`); Rechnungs-PDFs in Shopware sind separat anzulegen.

- `GET /api/orders/:orderId/installment-plans` — Liste inkl. Rechnungspositionen (angemeldet; Bestellung muss wie bei `GET /api/orders/:orderId` sichtbar sein)
- `POST /api/orders/:orderId/installment-plans` — Plan anlegen (Body: `createInstallmentPlanBodySchema`) (`manageDocuments`)
- `GET /api/installment-plans/:planId` — Detail (angemeldet; Zugriff über zugehörige Bestellung/Kanäle wie oben)
- `PATCH /api/installment-plans/:planId` — nur Entwurf: `customerName` / `customerEmail` (`manageDocuments`)
- `DELETE /api/installment-plans/:planId` — nur Entwurf (`manageDocuments`)
- `POST /api/installment-plans/:planId/send-agreement` — PDF-Vereinbarung, Status `pending_confirmation` (`manageDocuments`)
- `POST /api/installment-plans/:planId/confirm` — Body `{ confirmedBy }`, Status `active` (`manageDocuments`)
- `POST /api/installment-plans/:planId/invoices/:invoiceId/mark-paid` — Rate bezahlt; Plan `completed` wenn alle bezahlt (`manageDocuments`)
- `GET /api/installment-plans/:planId/agreement-pdf` — PDF-Download (wie GET Plan)

### Abschlussrechnung (METAorder-PDF)

- `POST /api/orders/:orderId/settlement-invoice/pdf` — Response: PDF (`application/pdf`). Body: `settlementInvoicePdfBodySchema` (`settlementInvoiceNumber`, `originalInvoiceNumber`, `originalAmountGross`, `stornoInvoiceNumber`, `stornoAmountGross`, optional `invoiceDate` als ISO-Datum). Bruttobetrag zahlbar = Ursprung minus Storno. Zugriff wie Ratenpläne (`assertInstallmentOrderAccess`) plus `manageDocuments`. Kein Shopware-Dokument, kein DB-Eintrag.

### Nachberechnung (METAorder-PDF + Shopware)

- `POST /api/orders/:orderId/additional-invoice` — Response: JSON `{ ok, documentId, documentNumber }`. Body: `additionalInvoiceBodySchema` (`invoiceNumber`, optional `invoiceDate`, `referenceInvoiceNumber`, `note`, `items[]` mit `description`, `quantity`, `unitNetPrice`, `vatRate` 0|7|19). Erzeugt PDF und lädt es als Shopware-Rechnungsdokument hoch. Zugriff wie Ratenpläne (`assertInstallmentOrderAccess`) plus `manageDocuments` und CSRF.

### Products & Bundles

- `GET /api/products`
- `GET /api/products/:id`
- `GET /api/products/:id/cross-selling`
- `GET /api/products/:id/cross-selling-suggestions`
- `GET /api/bundles`
- `POST /api/bundles`

### Offers & Offer Drafts

- `GET /api/offers`
- `GET /api/offers/:id`
- `GET /api/offers/:id/pdf` — Standard-PDF (Shopware/B2B, sofern konfiguriert)
- `GET /api/offers/:id/config-pdf` — METAorder-PDF mit personalisierter Einleitung, Schnellübersicht, Versand/Montage/MwSt., Konfigurationsbild und Stückliste (MetaCalc); abschließende Hinweise (regalsystem-spezifisch + Standard). Texte aus Setting `offer_config_pdf_texts` bzw. Defaults (`server/offerConfigPdfTexts.ts`). Query `download=true` für Download (`viewOffers`)
- `GET /api/offers/:id/export.csv` — ERP-Import: CSV (UTF-8 mit BOM, Semikolon), Kopf- und Positionsdaten in jeder Zeile; `lineType`: `product` \| `shipping` \| `bom` (Stücklistenzeilen mit `parentLineIndex`) (`viewOffers`)
- `GET /api/offers/:id/export.xml` — ERP-Import: XML, Namespace `https://meta-online.com/ns/metaorder/erp-export/1`, `documentKind=quotation` (Kunde mappt im ERP auf Anfrage/Auftrag) (`viewOffers`)
- `GET /api/settings/offer-config-pdf-texts` — `{ effective, defaults, stored }` für Konfigurations-PDF-Texte (`manageSettings`)
- `POST /api/settings/offer-config-pdf-texts` — Body wie `offerConfigPdfTextsPayloadSchema` (introTemplate, systemInfoTitle, systemInfoByKey, standardClosingTitle, standardClosing); speichert unter `offer_config_pdf_texts` (`manageSettings`)
- `GET /api/offer-drafts`
- `POST /api/offer-drafts/upload`

### Order Drafts

- `GET /api/order-drafts`
- `POST /api/order-drafts/upload`

### Tickets

- `GET /api/tickets`
- `POST /api/tickets`
- `PATCH /api/tickets/:id`
- `POST /api/tickets/:id/comments`
- `POST /api/tickets/:id/attachments`
- `GET /api/ticket-templates`
- `POST /api/ticket-templates`

### CRM & Customers

- `GET /api/customers`
- `POST /api/customers`
- `POST /api/customers/:id/interactions`
- `POST /api/order-assignments`
- `POST /api/discount-requests`

### Automation

- `GET /api/automation-rules`
- `POST /api/automation-rules`
- `PATCH /api/automation-rules/:id`
- `GET /api/automation-executions`

### Analytics & Reporting

- `GET /api/analytics/summary`
- `GET /api/analytics/order-status`
- `GET /api/analytics/payment-status`
- `GET /api/analytics/product-overview`
- `GET /api/analytics/sales-trend`
- `POST /api/orders/export`

### Semantische Suche & FAQ

- `POST /api/semantic/search`
- `POST /api/semantic/faq`
- `POST /api/semantic/search/feedback`

### Settings

- `GET /api/settings`
- `POST /api/settings`
- `GET /api/settings/dunning`
- `POST /api/settings/dunning`
- `GET /api/settings/email-inbound`
- `POST /api/settings/email-inbound`

### Webhooks & Notifications

- `GET /api/webhooks`
- `POST /api/webhooks`
- `GET /api/webhooks/logs`
- `GET /api/notifications`

## Datenmodelle (Kurzreferenz)

Relevant fuer Request/Response:

- `User`, `Role`, `Tenant`
- `Order`, `OrderItem`
- `Product`, `Bundle`
- `Offer`, `OfferDraft`
- `Ticket`, `TicketComment`, `TicketAttachment`
- `AutomationRule`, `AutomationExecution`
- `CrossSellingRule`
- `SemanticDocument`
- `InstallmentPlan`, `InstallmentInvoice` (Teilzahlung)

Details siehe `shared/schema.ts`.
