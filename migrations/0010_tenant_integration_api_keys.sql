-- API-Schlüssel für Automation (n8n etc.) pro Mandant (SHA-256 des übergebenen Keys)
CREATE TABLE IF NOT EXISTS "tenant_integration_api_keys" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" varchar NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "key_hash" text NOT NULL UNIQUE,
  "name" text NOT NULL DEFAULT '',
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "tenant_integration_api_keys_tenant_id_idx"
  ON "tenant_integration_api_keys" ("tenant_id");
