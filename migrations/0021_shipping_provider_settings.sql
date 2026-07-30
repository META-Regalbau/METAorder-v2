-- Sendcloud / shipping provider settings + label metadata

CREATE TABLE IF NOT EXISTS erp_shipping_provider_settings (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR NOT NULL REFERENCES tenants(id),
  provider TEXT NOT NULL,
  public_key TEXT,
  secret_key TEXT,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sandbox_mode BOOLEAN NOT NULL DEFAULT TRUE,
  default_shipping_method_id TEXT,
  default_shipping_method_code TEXT,
  sender_address_id TEXT,
  raw_config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT erp_shipping_provider_settings_tenant_provider_unique UNIQUE (tenant_id, provider)
);

CREATE INDEX IF NOT EXISTS erp_shipping_provider_settings_tenant_idx
  ON erp_shipping_provider_settings(tenant_id);

ALTER TABLE erp_shipping_labels
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS external_parcel_id TEXT,
  ADD COLUMN IF NOT EXISTS label_file_path TEXT,
  ADD COLUMN IF NOT EXISTS shipping_method_code TEXT;
