-- Migration: Cross-Selling-Ereignisse je Entwurf
-- Date: 2026-10-09
-- Description:
--   Bestell- und Angebotsentwuerfe erfassen Impressionen und Hinzufuegen von Cross-Selling-
--   Vorschlaegen hoechstens einmal je Entwurf und Paar (recordCrossSellEventsOncePerDraft).
--   Der Index macht die Pruefung auf bereits erfasste Ereignisse schnell. Idempotent.

CREATE INDEX IF NOT EXISTS cross_sell_events_tenant_draft_evt_idx
  ON public.cross_sell_events (tenant_id, draft_id, event_type);
