#!/usr/bin/env node
/**
 * Run SQL migrations in order.
 * Used by Docker startup to apply migrations (incl. CPQ schema) before app start.
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "..", "migrations");

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[run-migrations] DATABASE_URL not set, skipping migrations");
    return;
  }

  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const files = fs.readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, "utf8");
      console.log(`[run-migrations] Running ${file}...`);
      try {
        await client.query(sql);
        console.log(`[run-migrations] ${file} done`);
      } catch (err) {
        const msg = err.message || "";
        const code = err.code || "";
        if (msg.includes("already exists") || code === "42P07" || msg.includes("duplicate key")) {
          console.log(`[run-migrations] ${file} skipped (already applied)`);
        } else if (code === "42P01" && msg.includes("does not exist")) {
          console.error(`[run-migrations] ${file} error:`, err.message);
          console.error(
            "[run-migrations] Leere oder unvollständige Datenbank: Basistabellen fehlen. Im Container ausführen:\n" +
              "  node scripts/container-db-init.mjs\n" +
              "  (oder mw container exec metaorder-app /app/scripts/mittwald-db-init.sh)\n" +
              "Danach Container neu starten.",
          );
          throw err;
        } else {
          console.error(`[run-migrations] ${file} error:`, err.message);
          throw err;
        }
      }
    }
  } finally {
    await client.end();
  }
}

runMigrations().catch((err) => {
  console.error("[run-migrations] Error:", err);
  process.exit(1);
});
