-- Sendcloud webhook: carrier status on shipping labels

ALTER TABLE erp_shipping_labels
  ADD COLUMN IF NOT EXISTS carrier_status TEXT,
  ADD COLUMN IF NOT EXISTS carrier_status_message TEXT,
  ADD COLUMN IF NOT EXISTS carrier_status_id INTEGER,
  ADD COLUMN IF NOT EXISTS last_webhook_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS last_webhook_payload JSONB;

CREATE INDEX IF NOT EXISTS erp_shipping_labels_external_parcel_idx
  ON erp_shipping_labels(tenant_id, external_parcel_id);

CREATE INDEX IF NOT EXISTS erp_shipping_labels_tracking_idx
  ON erp_shipping_labels(tenant_id, tracking_number);
