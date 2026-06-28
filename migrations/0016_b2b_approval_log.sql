CREATE TABLE IF NOT EXISTS b2b_approval_log (
  id VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id VARCHAR REFERENCES tenants(id),
  shopware_reference_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  action TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  actor_user_id VARCHAR REFERENCES users(id),
  comment TEXT,
  payload JSONB,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS b2b_approval_log_tenant_created_idx
  ON b2b_approval_log (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS b2b_approval_log_reference_idx
  ON b2b_approval_log (shopware_reference_id, reference_type);
