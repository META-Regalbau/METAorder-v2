-- Optionaler Service-User pro Integration-Key: erlaubt es, verschiedenen Automatisierungs-
-- Clients (n8n, META Agents, ...) eigene, unterscheidbare Identitäten/Audit-Trails zu geben,
-- statt dass requireAuthOrIntegrationKey immer denselben globalen Fallback-User verwendet.
-- Nullable + kein Default: bestehende Keys bleiben unverändert (Fallback auf altes Verhalten).
ALTER TABLE tenant_integration_api_keys
  ADD COLUMN IF NOT EXISTS user_id varchar;

-- ON DELETE CASCADE (fail-closed): Wird der gebundene User gelöscht, stirbt der Key mit —
-- statt (wie bei SET NULL) still auf die globale n8n-Fallback-Identität mit anderen Rechten
-- zu wechseln. Drop+Add, damit auch eine früher mit SET NULL angelegte Constraint korrigiert
-- wird (Migrationen laufen bei jedem Boot; Tabelle ist klein, Re-Validierung unkritisch).
ALTER TABLE tenant_integration_api_keys
  DROP CONSTRAINT IF EXISTS tenant_integration_api_keys_user_id_fkey;
ALTER TABLE tenant_integration_api_keys
  ADD CONSTRAINT tenant_integration_api_keys_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
