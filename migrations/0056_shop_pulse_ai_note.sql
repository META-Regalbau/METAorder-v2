-- Migration: Shop-Puls, KI-Text an der Meldung (Konzept Stufe 1, Abschnitt 5; PR F)
-- Date: 2026-10-18
-- Description:
--   ai_note: von der KI des Mandanten formulierter Text zur Meldung, mit Schwere, Zeitpunkt und
--     geschaetztem Verlust. Hoechstens ein KI-Aufruf je Schwere und Vorfall; auch ein verworfener
--     Versuch (Zahl nicht belegt, leer, zu lang, Fehler, Zeitueberschreitung) steht hier, damit der
--     naechste Takt nicht erneut fragt. NULL = noch kein KI-Versuch.
--   Idempotent.

ALTER TABLE shop_pulse_signals ADD COLUMN IF NOT EXISTS ai_note JSONB;
