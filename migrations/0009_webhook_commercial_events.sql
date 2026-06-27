-- Erweitere webhook_configs.event_type um Commercial-/n8n-Events
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN (
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE t.relname = 'webhook_configs' AND c.contype = 'c'
  ) LOOP
    EXECUTE format('ALTER TABLE webhook_configs DROP CONSTRAINT IF EXISTS %I', r.conname);
  END LOOP;
END $$;

ALTER TABLE webhook_configs ADD CONSTRAINT webhook_configs_event_type_check CHECK (event_type IN (
  'ticket.created',
  'ticket.updated',
  'ticket.commented',
  'ticket.assigned',
  'ticket.customer_replied',
  'ticket.agent_replied',
  'order.ready_to_ship',
  'document.created',
  'commercial.draft_created',
  'commercial.draft_review_required',
  'commercial.auto_offer_created',
  'commercial.auto_order_created'
));
