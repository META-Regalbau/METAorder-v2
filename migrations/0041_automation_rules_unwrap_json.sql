-- Automatisierungsregeln: doppelt JSON-kodierte Bedingungen/Aktionen entpacken.
-- Route und Speicher haben frueher beide JSON.stringify angewendet; gespeichert war dann ein
-- JSON-Text, der den JSON-Text enthaelt ("[{\"field\":...}]"). Die Engine hat solche Regeln
-- uebersprungen. Laeuft bei jedem Start erneut (idempotent: entpackt nur Werte, die mit " beginnen)
-- und bricht nie ab: nicht lesbare Werte bleiben unveraendert.
DO $$
DECLARE r RECORD;
BEGIN
  IF to_regclass('public.automation_rules') IS NULL THEN
    RETURN;
  END IF;
  FOR r IN
    SELECT id, conditions, actions FROM automation_rules
    WHERE left(coalesce(conditions, ''), 1) = '"' OR left(coalesce(actions, ''), 1) = '"'
  LOOP
    BEGIN
      UPDATE automation_rules SET
        conditions = CASE WHEN left(coalesce(r.conditions, ''), 1) = '"' THEN r.conditions::jsonb #>> '{}' ELSE r.conditions END,
        actions = CASE WHEN left(coalesce(r.actions, ''), 1) = '"' THEN r.actions::jsonb #>> '{}' ELSE r.actions END
      WHERE id = r.id;
    EXCEPTION WHEN others THEN
      RAISE NOTICE 'automation_rules %: JSON nicht entpackbar, unveraendert', r.id;
    END;
  END LOOP;
END $$;
