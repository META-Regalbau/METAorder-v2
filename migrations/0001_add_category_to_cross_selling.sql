-- Erweiterung cross_selling_rules (Kategorie). Auf leerer DB kein Fehler: Tabelle kommt i. d. R. von Drizzle (npm run db:push).
DO $migrate$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'cross_selling_rules'
  ) THEN
    ALTER TABLE "cross_selling_rules"
      ADD COLUMN IF NOT EXISTS "category" varchar(50);
  END IF;
END
$migrate$;
