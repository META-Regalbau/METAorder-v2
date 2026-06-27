#!/usr/bin/env node
/**
 * Vor drizzle-kit push ausführen: frische Postgres-DBs haben den Typ "vector" noch nicht.
 */
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[ensure-pgvector] DATABASE_URL not set");
  process.exit(1);
}

const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  await client.query("CREATE EXTENSION IF NOT EXISTS vector");
  console.log("[ensure-pgvector] CREATE EXTENSION vector OK");
} catch (err) {
  console.error("[ensure-pgvector] failed:", err.message);
  process.exit(1);
} finally {
  await client.end();
}
