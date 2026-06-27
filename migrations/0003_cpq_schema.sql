-- Migration: CPQ Schema - Configure, Price, Quote module
-- Date: 2026-02-14
-- Description: CPQ tables for rules, configurations, discount levels

CREATE SCHEMA IF NOT EXISTS cpq;

CREATE TABLE IF NOT EXISTS cpq.cpq_systems (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_component_types (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  system_id VARCHAR NOT NULL REFERENCES cpq.cpq_systems(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  required BOOLEAN NOT NULL DEFAULT false,
  sort_order INTEGER NOT NULL DEFAULT 0,
  icon TEXT,
  attribute_schema JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_product_mapping (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_product_id TEXT NOT NULL,
  shopware_product_number TEXT NOT NULL,
  system_id VARCHAR NOT NULL REFERENCES cpq.cpq_systems(id) ON DELETE CASCADE,
  component_type_id VARCHAR NOT NULL REFERENCES cpq.cpq_component_types(id) ON DELETE CASCADE,
  attributes JSONB,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_geometry (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  product_mapping_id VARCHAR NOT NULL REFERENCES cpq.cpq_product_mapping(id) ON DELETE CASCADE,
  origin JSONB,
  anchor_points JSONB,
  bounding_box JSONB,
  glb_asset_url TEXT,
  lod_levels JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_rules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  system_id VARCHAR NOT NULL REFERENCES cpq.cpq_systems(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  condition JSONB,
  action JSONB,
  fallback JSONB,
  message TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  version INTEGER NOT NULL DEFAULT 1,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_rule_versions (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id VARCHAR NOT NULL REFERENCES cpq.cpq_rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  condition JSONB,
  action JSONB,
  changed_by TEXT,
  changed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  change_note TEXT
);

CREATE TABLE IF NOT EXISTS cpq.cpq_configurations (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  system_id VARCHAR NOT NULL REFERENCES cpq.cpq_systems(id) ON DELETE CASCADE,
  customer_id TEXT,
  name TEXT NOT NULL,
  config_data JSONB,
  validation_status TEXT NOT NULL DEFAULT 'valid',
  total_price DECIMAL(12,2),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_discount_levels (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  icon TEXT,
  discount_min DECIMAL(5,2) NOT NULL DEFAULT 0,
  discount_max DECIMAL(5,2) NOT NULL,
  message_template TEXT,
  approval_type TEXT NOT NULL DEFAULT 'none',
  justification_required BOOLEAN NOT NULL DEFAULT false,
  notify_roles JSONB,
  escalation_hours INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_discount_level_rules (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  discount_level_id VARCHAR REFERENCES cpq.cpq_discount_levels(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  context_value TEXT,
  priority INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cpq.cpq_quote_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  configuration_id VARCHAR REFERENCES cpq.cpq_configurations(id) ON DELETE SET NULL,
  offer_id TEXT,
  user_id TEXT NOT NULL,
  discount_percent DECIMAL(5,2) NOT NULL,
  discount_level_id VARCHAR REFERENCES cpq.cpq_discount_levels(id) ON DELETE SET NULL,
  list_price DECIMAL(12,2) NOT NULL,
  discounted_price DECIMAL(12,2) NOT NULL,
  revenue_loss DECIMAL(12,2) NOT NULL,
  justification TEXT,
  approval_type TEXT NOT NULL,
  approval_status TEXT NOT NULL,
  approved_by TEXT,
  approval_comment TEXT,
  approved_at TIMESTAMP,
  escalated BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS cpq_product_mapping_shopware_product_id_idx ON cpq.cpq_product_mapping(shopware_product_id);
CREATE INDEX IF NOT EXISTS cpq_product_mapping_system_id_idx ON cpq.cpq_product_mapping(system_id);
CREATE INDEX IF NOT EXISTS cpq_rules_system_id_idx ON cpq.cpq_rules(system_id);
CREATE INDEX IF NOT EXISTS cpq_configurations_system_id_idx ON cpq.cpq_configurations(system_id);

-- Add CPQ permissions to roles (merge new keys into existing permissions)
UPDATE roles SET permissions = permissions || '{"viewCPQ": false, "manageCPQ": false, "manageCPQDiscountLevels": false, "approveCPQQuotes": false}'::jsonb;
UPDATE roles SET permissions = jsonb_set(jsonb_set(jsonb_set(jsonb_set(COALESCE(permissions, '{}'::jsonb), '{viewCPQ}', 'true'), '{manageCPQ}', 'true'), '{manageCPQDiscountLevels}', 'true'), '{approveCPQQuotes}', 'true') WHERE name = 'Administrator';
