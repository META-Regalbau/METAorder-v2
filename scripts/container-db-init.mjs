#!/usr/bin/env node
/**
 * Full DB setup inside the production container (Mittwald/Docker):
 * 1) pgvector extension
 * 2) Drizzle schema push (only if base tables missing)
 * 3) SQL files in migrations/
 */
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const drizzleKitBin = path.join(appRoot, "node_modules", ".bin", "drizzle-kit");

function run(label, command, args) {
  console.log(`[container-db-init] ${label}...`);
  const result = spawnSync(command, args, {
    cwd: appRoot,
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

async function hasBaseTables(databaseUrl) {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    const result = await client.query(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'tenants'`,
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    await client.end();
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("[container-db-init] DATABASE_URL not set");
    process.exit(1);
  }

  run("Step 1/3: pgvector", "node", ["scripts/ensure-pgvector.mjs"]);

  const baseTablesExist = await hasBaseTables(databaseUrl);
  if (baseTablesExist) {
    console.log("[container-db-init] Step 2/3: Basistabellen vorhanden, Drizzle push übersprungen");
  } else {
    if (!existsSync(drizzleKitBin)) {
      console.error(
        "[container-db-init] drizzle-kit fehlt in node_modules/.bin — Image-Build pruefen (Dockerfile: drizzle-kit@0.30.6)",
      );
      process.exit(1);
    }
    // Nicht npx: laedt drizzle-kit aus dem Cache, drizzle.config.ts braucht aber /app/node_modules/drizzle-kit
    run("Step 2/3: Drizzle schema push", drizzleKitBin, ["push", "--force"]);
  }

  run("Step 3/3: SQL migrationen", "node", ["scripts/run-migrations.mjs"]);

  console.log("[container-db-init] Fertig.");
}

main().catch((err) => {
  console.error("[container-db-init] Error:", err);
  process.exit(1);
});
