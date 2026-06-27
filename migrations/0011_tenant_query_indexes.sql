-- Häufige Mandanten-Filter (Listen / Reporting)
CREATE INDEX IF NOT EXISTS "tickets_tenant_id_idx" ON "tickets" ("tenant_id");
CREATE INDEX IF NOT EXISTS "cross_selling_rules_tenant_id_idx" ON "cross_selling_rules" ("tenant_id");
