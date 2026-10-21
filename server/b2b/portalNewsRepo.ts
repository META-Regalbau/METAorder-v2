/**
 * Portal-Neuigkeiten: Datenbank (migrations/0069_portal_news.sql).
 */
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { portalNewsPosts, type InsertPortalNewsPostRow, type PortalNewsPostRow } from "@shared/schema";
import type { PortalNewsEvent, PortalNewsStatus } from "@shared/portalNews";

const tenantIs = (tenantId: string | null) => (tenantId ? eq(portalNewsPosts.tenantId, tenantId) : isNull(portalNewsPosts.tenantId));

export type PortalNewsRepo = typeof portalNewsRepo;

export const portalNewsRepo = {
  async findByMessageId(tenantId: string | null, messageId: string): Promise<PortalNewsPostRow | null> {
    const rows = await db
      .select()
      .from(portalNewsPosts)
      .where(and(tenantIs(tenantId), eq(portalNewsPosts.messageId, messageId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async get(tenantId: string | null, id: string): Promise<PortalNewsPostRow | null> {
    const rows = await db
      .select()
      .from(portalNewsPosts)
      .where(and(tenantIs(tenantId), eq(portalNewsPosts.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },

  /** Neueste zuerst (Datum über dem Beitrag, dann Eingang) */
  async list(tenantId: string | null, status?: PortalNewsStatus): Promise<PortalNewsPostRow[]> {
    return db
      .select()
      .from(portalNewsPosts)
      .where(status ? and(tenantIs(tenantId), eq(portalNewsPosts.status, status)) : tenantIs(tenantId))
      .orderBy(desc(portalNewsPosts.postDate), desc(portalNewsPosts.receivedAt))
      .limit(500);
  },

  /** null = Message-ID gab es schon (gleichzeitiger zweiter Upload) */
  async insert(row: InsertPortalNewsPostRow): Promise<PortalNewsPostRow | null> {
    const rows = await db.insert(portalNewsPosts).values(row).onConflictDoNothing().returning();
    return rows[0] ?? null;
  },

  async update(
    tenantId: string | null,
    id: string,
    patch: Partial<InsertPortalNewsPostRow>,
    newEvents: PortalNewsEvent[] = [],
  ): Promise<PortalNewsPostRow | null> {
    const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (newEvents.length) {
      set.events = sql`${portalNewsPosts.events} || ${JSON.stringify(newEvents)}::jsonb`;
    }
    const rows = await db
      .update(portalNewsPosts)
      .set(set)
      .where(and(tenantIs(tenantId), eq(portalNewsPosts.id, id)))
      .returning();
    return rows[0] ?? null;
  },

  async remove(tenantId: string | null, id: string): Promise<boolean> {
    const rows = await db
      .delete(portalNewsPosts)
      .where(and(tenantIs(tenantId), eq(portalNewsPosts.id, id)))
      .returning({ id: portalNewsPosts.id });
    return rows.length > 0;
  },
};
