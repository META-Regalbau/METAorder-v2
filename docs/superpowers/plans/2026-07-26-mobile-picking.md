# Mobile Picking Implementation Plan

> **For agentic workers:** Execute task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Prefer inline execution in this session (user: „mach weiter“).

**Goal:** iPhone-taugliche Route `/mobile/picking` zum Auswählen offener Picklisten und Scannen am Regal (±1, optional Abschließen).

**Architecture:** Bestehende Picklisten-API erweitern um `delta` am Scan-Endpoint; neuer Dauer-Scanner `BarcodeLiveScanner`; Page ohne Sidebar-Chrome; Desktop Versand-Ops unverändert.

**Tech Stack:** React + wouter, TanStack Query, html5-qrcode, Express/Drizzle ERP, i18n.

**Spec:** `docs/superpowers/specs/2026-07-26-mobile-picking-design.md`

## Global Constraints

- Nur `METAorder-v2/`
- Docker deploybar; HTTPS-Hinweis für Kamera
- Recht: `manageShippingLabels` (wie Versand-Ops)
- Kein PWA/Offline in v1
- Keine unaufgeforderten Git-Commits

---

### Task 1: Scan-API `delta`

**Files:**
- Modify: `server/erp/erpStorage.ts` (`scanPickListProduct`)
- Modify: `server/erp/erpRoutes.ts` (body zod)
- Modify: `scripts/testErpCore.ts` (Logik-Asserts via shared helper optional; Storage-Logik in Unit-Test schwer ohne DB — Asserts für Clamp-Helfer wenn extrahiert)

**Interfaces:**
- `scanPickListProduct(pickListId, productNumber, tenantId?, delta?: 1 | -1)`
- POST body: `{ productNumber: string, delta?: 1 | -1 }` default 1

- [x] Clamp `pickedQuantity` auf `0…quantity`; delta -1 bei 0 = no-op
- [x] Route parse delta
- [x] `npm run test:erp` (bestehende Tests + neue Clamp-Helper-Tests wenn extrahiert)

### Task 2: `BarcodeLiveScanner`

**Files:**
- Create: `client/src/components/BarcodeLiveScanner.tsx`
- Keep: `BarcodeScannerDialog.tsx` (unverändert funktionsfähig; optional später refactor)

- [x] Props: `active: boolean`, `onScan: (code: string) => void`, `className?`
- [x] Dedup 1500ms, normalizeScanCode, Secure-Context-Fehler
- [x] Unique element id (z. B. `metaorder-barcode-live-scanner`)

### Task 3: `MobilePickingPage` + Routes + Sidebar

**Files:**
- Create: `client/src/pages/MobilePickingPage.tsx`
- Modify: `client/src/App.tsx` (lazy route, layout ohne Sidebar auf `/mobile/picking*`)
- Modify: `client/src/components/AppSidebar.tsx` + nav i18n

- [x] Liste open pick lists; Detail mit Live-Scanner, ±1, complete + confirm
- [x] Mobile shell: kein AppSidebar/TopBar/RightSidebar

### Task 4: i18n + Docs + Docker rebuild

**Files:**
- Modify: `client/src/i18n/locales/{de,en,es}.json`
- Modify: `docs/docker.md`, optional `docs/erp-gap-decisions.md`

- [x] Keys `erp.mobilePicking.*`, `nav.mobilePicking`
- [x] HTTPS-Hinweis Mobile Picking
- [x] `docker compose up -d --build app`

---

## Spec coverage

| Spec | Task |
|------|------|
| Route / Layout ohne Sidebar | 3 |
| Liste open | 3 |
| Dauer-Kamera | 2+3 |
| ±1 / delta | 1+3 |
| Complete + Confirm | 3 |
| Sidebar-Link | 3+4 |
| Docs HTTPS | 4 |
| PWA out of scope | — |
