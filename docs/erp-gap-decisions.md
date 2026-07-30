# ERP Gap — Architekturentscheidungen

Stand: 2026-07-25 (Umsetzung der ERP-Gap-Roadmap)

## 1. Bestandsführung: META Order führend

**Entscheidung:** Bestände werden in META Order geführt (`erp_stock_levels` / `erp_stock_movements`). Shopware bleibt Verkaufskanal und Auftragsquelle.

**Abgleich (Stand 2026-07-25):**
- **Initial:** Diff-UI unter Warenwirtschaft → Abgleich; Übernahme Shopware-`stock` (Mirror) → Default-Lager als `adjustment` (`referenceType: shopware_reconcile`) — Button **Shopware → ERP**.
- **Inventur / ERP führend:** Nach abgeschlossener Inventur (oder manuell im Abgleich) schreibt **ERP → Shopware** den ERP-Bestand als absolute Shopware-Menge (`PATCH`/`sync` auf `product.stock`) und aktualisiert den Mirror. Endpunkte: `POST /api/erp/stock/reconcile/push-to-shopware`, `POST /api/erp/inventory-counts/:id/push-to-shopware`.
- **Laufend:** Shopware-Verkäufe werden als ERP-`issue` gebucht (`referenceType: shopware_order`, idempotent). Stornos als einmalige `receipt`-Korrektur (`shopware_order_cancel`). Auslöser: manueller Sync + nach Order-Cache-Reload.
- Push ERP → Shopware ist **manuell** (kein Dauer-Job); nach Inventur explizit „Nach Shopware schreiben“.
- Doppelbuchung: Picklisten-Complete überspringt Positionen, die bereits als `shopware_order` gebucht sind (und umgekehrt).

**Konsequenz:**
- Wareneingang, Inventur, Retoure (Restock), Produktion und Picklisten buchen lokal in META Order (System of Record).
- Shopware ist Verkaufskanal; Bestand dort muss nach Inventur/Abgleich bewusst nachgezogen werden.

## 2. Finanzbuchhaltung: Export-first (DATEV), kein volles FIBU-System

**Entscheidung:** META Order führt Offene Posten (Debitoren/Kreditoren) und Zahlungseingänge/-ausgänge sowie einen **DATEV-CSV-Export** und eine einfache USt-/BWA-Schätzung. Eine vollständige doppelte Buchführung mit Kontenrahmen, Periodenabschluss und GuV-Engine wird **nicht** gebaut.

**Konsequenz:**
- Bestehender Bankabgleich unter `/accounting` bleibt ergänzend.
- Steuerberater/DATEV bleibt System of Record für die eigentliche Buchhaltung.

## 3. Eigenfertigung / Produktion: relevant (leichtgewichtig)

**Entscheidung:** Produktion ist aktiviert. Fertigungsaufträge entnehmen Material und buchen Fertigware auf Lager; MRP zeigt Fehlmengen. **Stücklisten-Stamm** (`erp_boms` / `erp_bom_lines`): ein aktiver BOM-Kopf pro Mandant + Fertigartikel; Zeilenmengen gelten pro 1 Fertigteil. UI: Produktion → Tab „Stücklisten“. Beim Anlegen eines Fertigungsauftrags wird die aktive BOM geladen und skaliert (`requiredQty = line.qty × FA.qty`).

**Lieferanten-Preislisten** (`erp_supplier_price_lists` / `_lines`): eine aktive Liste pro Lieferant; Excel/CSV mit Spalten `Artikelnummer` + `Preis` (Dry-Run/Apply). UI: Einkauf → Lieferant → Preisliste. BA-Dialog füllt `unitPrice` aus der Liste. BOM-Dialog: Assistent „Aus Lieferanten-Preisliste“ (Multi-Select, Menge default 1).

**Konsequenz:**
- Keine Kapazitäts-/Maschinenplanung in v1.
- BOM-Stamm manuell pflegbar; FA-Create kann BOM vorausfüllen oder Materialien manuell erfassen.
- Nicht in v1: CPQ-Import, mehrstufige/phantom-BOMs, Versionshistorie, Preislisten-Historie.

## 4. Versand-Labels: Sendcloud-first (+ Stub ohne Keys)

**Entscheidung:** Labels laufen über ein **Provider-Interface**. v1: **Sendcloud** (Aggregator). Ohne Keys bleibt der **Stub** aktiv und schreibt ein lokales PDF unter `uploads/shipping-labels/` (Druck-/Download-Flow testbar). Mit Public/Secret Key (mandantenspezifisch, verschlüsselt in `erp_shipping_provider_settings`) erzeugt der Sendcloud-Adapter Parcels + PDF.

**Konsequenz:**
- UI: Versand-Ops → Tab „Anbieter“ (Sendcloud) + Label erzeugen aus Versandbestellung.
- **Label-PDF:** Sendcloud **`label_printer`** (Thermodrucker) bevorzugt, Fallback `normal_printer`. Druck: PDF öffnen **oder** „Zebra“ → Browser Print / PDF Direct (`POST /api/erp/shipping-labels/:id/print`).
- **Mobile Picking:** Button „Versandlabels“ erzeugt Labels für alle `orderRefs` und versucht Zebra-Druck (sonst PDF).
- **Pickliste aus Bestellungen** (`GET /api/shipping`): bezahlt/autorisiert und Bestellstatus `open` **oder** `in_progress` (nicht nur „In Bearbeitung“). Shopware-`authorized` wird korrekt gemappt (vorher fälschlich als `open`).
- **Mobile Picking** (`/mobile/picking`): Vollbild-UI ohne Sidebar; Dauer-Kamera + ±1; Scan-API `delta`; optional Abschließen. PWA später.
- **Webhook:** `POST /api/erp/shipping/webhooks/sendcloud/:tenantId` — Parcel-Status von Sendcloud (HMAC `Sendcloud-Signature` mit Secret Key). Aktualisiert Tracking/Carrier-Status lokal; Shopware `updateOrderShipping` (Lieferstatus **Versandt**) erst, wenn das Paket beim Carrier ist (`in_transit` / `delivered`) — **nicht** bei Ready-to-send / Announced. Status-IDs: 7 = Being sorted, 11 = Delivered.
- URL in der UI kopierbar; in Sendcloud unter Integrations → Webhook feedback eintragen ([Doku](https://sendcloud.dev/api/v3/webhooks/parcel-status-changed)).
- Shipcloud / Direkt-Carrier: später als weitere Adapter am gleichen Interface.
- Keine Carrier-Keys als Pflicht-Env-Vars; Keys in der DB (AES via `ENCRYPTION_KEY`). Öffentliche Basis-URL für die Webhook-Anzeige: `PUBLIC_APP_URL` bzw. `METAORDER_BASE_URL`.

## 5. Docker / Persistenz

- Migrationen u. a.: `0020_erp_core_modules.sql`, `0021_shipping_provider_settings.sql`, `0022_sendcloud_webhook_status.sql`, `0023_erp_boms.sql`, `0024_erp_supplier_price_lists.sql` (läuft über `scripts/run-migrations.mjs`).
- Gutschrift-Stubs unter `uploads/credit-notes/` → Volume `/app/uploads`.

## 6. Sicherheit (v1-Härtung)

- Alle ERP-Mutationen: `requireAuth` + `requireCsrf` + RBAC.
- **Tenant Pflicht:** ohne aktiven Mandanten → `403` (`TENANT_REQUIRED`); keine Cross-Tenant-Listen mehr.
- Ownership-Checks für Lager, Lagerorte, Inventurzeilen, Wareneingang (PO + Warehouse), Lieferantenrechnungen, Retouren, Produktion, Picklisten.
- Doppelbuchungs-Schutz: Inventur, Retouren-Restock, Fertigungsabschluss, Picklisten.
- Zahlungen: Betrag darf offenen OP-Betrag nicht überschreiten.
- DATEV-Export: CSV-Injection-Schutz (`sanitizeDatevField`).
- Credit-Note-Pfade: Basename-Whitelist gegen Path Traversal.
- Tests: `npm run test:erp` (`scripts/testErpCore.ts`).
- Bestehende Rollen erhalten fehlende ERP-Permissions beim Seed (`mergeErpPermissions`).
