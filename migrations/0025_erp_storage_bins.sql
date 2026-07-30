-- Lagerplätze: Regaltypen (Hersteller) + Hierarchie an erp_warehouse_locations
-- Date: 2026-07-28
-- Description: erp_shelf_types (META-Regaltypen) und Erweiterung der Lagerplätze
--   um Regalzeile / Regalfeld / Regalfach / Regalplatz

CREATE TABLE IF NOT EXISTS erp_shelf_types (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  manufacturer TEXT NOT NULL DEFAULT 'META',
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS erp_shelf_types_tenant_code_unique
  ON erp_shelf_types(tenant_id, code);
CREATE INDEX IF NOT EXISTS erp_shelf_types_tenant_idx
  ON erp_shelf_types(tenant_id);

ALTER TABLE erp_warehouse_locations
  ADD COLUMN IF NOT EXISTS shelf_type_id VARCHAR REFERENCES erp_shelf_types(id) ON DELETE SET NULL;
ALTER TABLE erp_warehouse_locations
  ADD COLUMN IF NOT EXISTS regalzeile TEXT;
ALTER TABLE erp_warehouse_locations
  ADD COLUMN IF NOT EXISTS regalfeld TEXT;
ALTER TABLE erp_warehouse_locations
  ADD COLUMN IF NOT EXISTS regalfach TEXT;
ALTER TABLE erp_warehouse_locations
  ADD COLUMN IF NOT EXISTS regalplatz TEXT;

CREATE INDEX IF NOT EXISTS erp_warehouse_locations_shelf_type_idx
  ON erp_warehouse_locations(shelf_type_id);

-- META-Standard-Regaltypen je bestehendem Tenant (idempotent)
INSERT INTO erp_shelf_types (tenant_id, manufacturer, code, name, description, active)
SELECT t.id, 'META', v.code, v.name, v.description, true
FROM tenants t
CROSS JOIN (
  VALUES
    ('PAL', 'Palettenregal', 'META Palettenregal für Europaletten'),
    ('FB', 'Fachbodenregal', 'META Fachbodenregal für Kommissionierung'),
    ('KA', 'Kragarmregal', 'META Kragarmregal für Langgut'),
    ('WS', 'Weitspannregal', 'META Weitspannregal für großvolumige Ware')
) AS v(code, name, description)
WHERE NOT EXISTS (
  SELECT 1 FROM erp_shelf_types st
  WHERE st.tenant_id = t.id AND st.code = v.code
);
