import { sql } from "drizzle-orm";
import { db } from "../db";
import type { NlUsageStore } from "./nlQueryLimit";

const toCount = (row: unknown) => Number((row as { count?: unknown } | undefined)?.count ?? 0) || 0;

/** Zaehler in nl_query_usage (migrations/0042_nl_query_usage.sql) */
export const nlUsageStore: NlUsageStore = {
  async userCount(tenantId, userId, day) {
    const r = await db.execute(sql`
      SELECT count FROM nl_query_usage WHERE tenant_id = ${tenantId} AND user_id = ${userId} AND usage_date = ${day}::date
    `);
    return toCount(r.rows[0]);
  },
  async tenantCount(tenantId, day) {
    const r = await db.execute(sql`
      SELECT COALESCE(SUM(count), 0)::int AS count FROM nl_query_usage WHERE tenant_id = ${tenantId} AND usage_date = ${day}::date
    `);
    return toCount(r.rows[0]);
  },
  async incrementIfBelow(tenantId, userId, day, limit) {
    // atomar: neue Zeile mit 1, sonst +1 nur solange unter der Grenze; keine Zeile zurueck = Grenze erreicht
    const r = await db.execute(sql`
      INSERT INTO nl_query_usage (tenant_id, user_id, usage_date, count)
      VALUES (${tenantId}, ${userId}, ${day}::date, 1)
      ON CONFLICT (tenant_id, user_id, usage_date)
      DO UPDATE SET count = nl_query_usage.count + 1, updated_at = now()
      WHERE nl_query_usage.count < ${limit}
      RETURNING count
    `);
    return r.rows.length ? toCount(r.rows[0]) : null;
  },
};
