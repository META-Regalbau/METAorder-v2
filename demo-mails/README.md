# Demo-Mails für Präsentation (n8n-Fake)

Drei vorbereitete `.eml`-Dateien für den Commercial-Agent-Workflow.  
**Ziel:** In der Präsentation wirkt es wie Gmail → n8n → METAorder; technisch ladest du die Mail per Upload oder Skript hoch.

## Die drei Szenarien

| Datei | Story | Erwartung im UI |
|-------|--------|-----------------|
| `01-demo-komplett.eml` | Vollständige Anfrage: Firma, Adresse, Kontakt, 3 GTINs (inkl. 6-stellige Suffixe) | Alle Positionen gemappt, hohe Konfidenz, Kundendaten gut gefüllt |
| `02-demo-teilweise-gemappt.eml` | 1× klare GTIN + 1× nur Produktbezeichnung (ohne Nummer) | Position 1 matched; Position 2 **unsicher/nicht gefunden** mit **Alternativvorschlägen** |
| `03-demo-ohne-artikel.eml` | Nur Freitext (Palettenplätze, Höhe) — keine `1x …`-Zeilen | **Keine** extrahierten Artikelpositionen → manuelle Nachbearbeitung |

## Ablauf für morgen (empfohlen)

### Variante A — „Mail verschickt, dann Import“ (sichtbar für Publikum)

1. **Vorher:** Die drei `.eml` in dein Mailprogramm importieren (Outlook: Datei → Öffnen, oder Thunderbird: Import).
2. **Live:** Mail **an dich selbst** (oder an das Postfach, das später abgefragt wird) **weiterleiten** — oder aus Entwurf senden.
3. **Parallel / direkt danach:** In METAorder importieren (Variante B), während du erklärst: *„n8n würde das gleiche automatisch machen.“*

### Variante B — Upload wie n8n (zuverlässig für Demo)

```bash
cd METAorder-v2

# Integration-Key aus docker.env oder Admin → Integration
export METAORDER_INTEGRATION_KEY="dein-key"
export METAORDER_BASE_URL="http://localhost:5001"

./scripts/import-demo-mail.sh demo-mails/01-demo-komplett.eml
./scripts/import-demo-mail.sh demo-mails/02-demo-teilweise-gemappt.eml
./scripts/import-demo-mail.sh demo-mails/03-demo-ohne-artikel.eml
```

Oder in der **METAorder-UI**: Commercial Drafts → Datei hochladen → `.eml` wählen.

### Was du in der Präsentation sagen kannst

> „Die Mail landet in Gmail, n8n klassifiziert sie und schickt die `.eml` an `POST /api/commercial-drafts/upload` — genau das machen wir hier mit dem gleichen Endpunkt.“

n8n-Workflow-Referenz: [`n8n-workflows/gmail-to-metaorder.json`](../n8n-workflows/gmail-to-metaorder.json)

## Voraussetzungen

- Docker-Stack läuft (`docker compose up -d`)
- `COMMERCIAL_AGENT_ENABLED=true`
- Shopware verbunden (Katalog-Matching)
- Optional OpenAI für bessere Intent-Erkennung; **ohne KI** funktionieren die Mails trotzdem über lokale Extraktion + Heuristik

## Demo-Artikel in Shopware Dev anlegen

Die GTINs aus Mail 01/02 müssen im **Dev**-Shopware (`Tenant „Dev“`) existieren. Einmalig:

```bash
# Im App-Container (nach Image-Build) oder lokal mit DATABASE_URL auf Postgres:
TENANT_ID=c49bfa7e-06a8-452a-9d47-c490629aca4a npm run seed:demo-products

# Danach Product-Cache in der laufenden App aktualisieren:
# Einstellungen → Shopware → Cache aktualisieren, oder App-Container neu starten
```

Legt an: `4026212259957`, `4026212259964`, `4026212264814`, `4026212011036` (Letzteres für Alternativen bei Mail 02).

## Demo-Kunden in Shopware Dev anlegen

Für Strikt-Auto-Create und Kunden-Match (Mail 01 Happy Path) einmalig:

```bash
TENANT_ID=c49bfa7e-06a8-452a-9d47-c490629aca4a npm run seed:demo-customers
```

Legt an:

| Mail | Firma | E-Mail |
|------|-------|--------|
| 01 | Mustermann Logistik GmbH | einkauf@mustermann-logistik.at |
| 02 | Technik Service Neumayer KG | t.keller@technik-neumayer.at |
| 03 | Wolf & Partner Handels GmbH | s.wolf@wolf-partner.at |

## Reihenfolge in der Demo

1. **03** zuerst — zeigt Grenzen (keine Artikel)
2. **02** — zeigt KI + Alternativen
3. **01** — Happy Path zum Abschluss

## Anpassungen

- Absender-Domains sind fiktiv — nach `seed:demo-customers` existieren passende Shopware-Kunden für den Happy Path (Mail 01).
- GTINs in Mail 01 entsprechen dem bekannten META-Katalog (wie `Mail-Anhang-4.eml`).
