import { config as loadEnv } from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import pg from "pg";
import type { Pool as PgPoolType } from "pg";
import ws from "ws";
import * as schema from "../shared/schema";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, "..", "docker.env") });
loadEnv({ path: path.resolve(__dirname, "..", ".env") });
loadEnv({ path: path.resolve(__dirname, "..", ".env.local") });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is not set");
}

const configuredDriver = (process.env.DATABASE_DRIVER || "").toLowerCase();
const useNeon =
  configuredDriver === "neon" ||
  (!configuredDriver && databaseUrl.includes("neon.tech"));

if (useNeon) {
  neonConfig.webSocketConstructor = ws;
}

const { Pool: PgPool } = pg;

const pgPoolMax = Math.max(1, Number(process.env.PG_POOL_MAX || "20"));

const pool = useNeon
  ? new NeonPool({ connectionString: databaseUrl })
  : new PgPool({ connectionString: databaseUrl, max: pgPoolMax });

export const db = useNeon
  ? drizzleNeon(pool as NeonPool, { schema })
  : drizzlePg(pool as PgPoolType, { schema });

export async function ensureVectorExtension(): Promise<void> {
  try {
    const queryText = "CREATE EXTENSION IF NOT EXISTS vector";
    await (pool as { query: (text: string) => Promise<unknown> }).query(queryText);
  } catch (error) {
    console.warn("[DB] Unable to ensure pgvector extension:", error);
  }
}
