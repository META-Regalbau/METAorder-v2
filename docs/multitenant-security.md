# Mandantenfähigkeit und Sicherheit

## Architektur kurz

- Mandanten: Tabelle `tenants`, Zuordnung über `tenant_users`, aktiver Mandant am User als `active_tenant_id`.
- Request-Kontext: [`server/tenantContext.ts`](../server/tenantContext.ts) (AsyncLocalStorage), gesetzt nach Auth.
- DB-Zugriff: [`server/dbStorage.ts`](../server/dbStorage.ts) filtert viele Tabellen über `tenantFilterFor`: mit Mandant nur Zeilen dieses Mandanten; **ohne** Mandant nur Zeilen mit `tenant_id IS NULL` (Legacy).

## Strikter Mandanten-Modus (Shared-SaaS)

Setze **`METAORDER_STRICT_TENANT=true`**, damit nach JWT-Auth für fast alle `/api/*`-Routen ein gültiger Mandant erforderlich ist (siehe [`server/auth.ts`](../server/auth.ts): `isTenantOptionalApiPath`).

Ausnahmen (ohne Pflicht-Mandant): u. a. `GET /api/auth/me`, `GET /api/tenants`, `POST /api/tenants/select`, `GET /api/auth/token`, `PUT /api/profile`, `PUT /api/profile/password`.

Ohne strikten Modus bleibt das bisherige Verhalten (ein Mandanten-weicher Modus für Legacy/Einzelinstallation).

## Integration / n8n

### Pro Mandant (empfohlen für eine Instanz, viele Firmen)

1. Als Admin anmelden, Mandant wählen.
2. Unter **Einstellungen** Integration-Keys verwalten (API) oder `POST /api/settings/integration-api-keys` mit Namen – der **Klartext-Key** wird nur einmal zurückgegeben.
3. Header bei Automation: `X-METAORDER-Integration-Key: <mo_...>`  
   Der Server bildet SHA-256 und löst den Mandanten über `tenant_integration_api_keys` auf.

Der Integrations-User (`n8n-service` oder `METAORDER_INTEGRATION_USER_ID`) muss der **tenant_users**-Zuordnung für diesen Mandanten angehören.

### Globaler Key (eine Installation pro Firma)

Weiterhin möglich: `METAORDER_INTEGRATION_API_KEY`. Bei **`METAORDER_STRICT_TENANT=true`** zusätzlich **`METAORDER_INTEGRATION_TENANT_ID`** setzen (UUID des Mandanten), damit der Kontext eindeutig ist.

## Behobene Risiken (Cross-Selling)

Früher gab es API-Fallbacks „Tenant-Zeile nicht gefunden → erneut mit `tenant_id IS NULL`“. Das ermöglichte bei Kenntnis einer UUID ein Überschreiben **globaler** Regeln. Diese Fallbacks sind entfernt; Mandantenregeln sind strikt getrennt.

## Performance-Hinweise

- `REQUEST_LOG_SLOW_MS`: Requests ab dieser Dauer (ms) werden als `[slow-request]` geloggt (siehe [`server/index.ts`](../server/index.ts)).
- `PG_POOL_MAX`: optional, Standard 20 (siehe [`server/db.ts`](../server/db.ts)).
- Migration [`0011_tenant_query_indexes.sql`](../migrations/0011_tenant_query_indexes.sql): Indizes auf `tickets.tenant_id` und `cross_selling_rules.tenant_id`.

## Weiterführend

- [architecture.md](architecture.md), [docker.md](docker.md), [metaorder-system-poster.md](metaorder-system-poster.md)
