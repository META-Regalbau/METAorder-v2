-- Cross-Selling Funnel-Events (Impression/Klick/Add/Remove/Return) fuer Quality-Ranker & Learning
CREATE TABLE IF NOT EXISTS public.cross_sell_events (
  id varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id varchar REFERENCES public.tenants(id),
  event_type text NOT NULL,
  source_product_number text NOT NULL,
  target_product_number text NOT NULL,
  context text,
  draft_id varchar,
  user_id varchar REFERENCES public.users(id),
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cross_sell_events_tenant_src_tgt_evt_idx
  ON public.cross_sell_events (tenant_id, source_product_number, target_product_number, event_type);

CREATE INDEX IF NOT EXISTS cross_sell_events_tenant_created_idx
  ON public.cross_sell_events (tenant_id, created_at DESC);
