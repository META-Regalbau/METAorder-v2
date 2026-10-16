/**
 * Portal-Registrierungen: Datenbank (migrations/0053_portal_registrations.sql).
 * Eigene Schicht statt IStorage: der Bereich ist in sich geschlossen.
 */
import { and, asc, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  portalRegistrationOutbox,
  portalRegistrations,
  salesRepAssignments,
  type InsertPortalRegistrationRow,
  type PortalRegistrationOutboxRow,
  type PortalRegistrationRow,
} from "@shared/schema";
import type {
  PortalRegistrationEvent,
  PortalRegistrationOutboxKind,
  PortalRegistrationStatus,
  SalesRepAssignment,
} from "@shared/portalRegistrations";

const tenantIs = (column: typeof portalRegistrations.tenantId | typeof portalRegistrationOutbox.tenantId | typeof salesRepAssignments.tenantId, tenantId: string | null) =>
  tenantId ? eq(column, tenantId) : isNull(column);

export type PortalRegistrationRepo = typeof portalRegistrationRepo;

export const portalRegistrationRepo = {
  async findByMessageId(tenantId: string | null, messageId: string): Promise<PortalRegistrationRow | null> {
    const rows = await db
      .select()
      .from(portalRegistrations)
      .where(and(tenantIs(portalRegistrations.tenantId, tenantId), eq(portalRegistrations.messageId, messageId)))
      .limit(1);
    return rows[0] ?? null;
  },

  async get(tenantId: string | null, id: string): Promise<PortalRegistrationRow | null> {
    const rows = await db
      .select()
      .from(portalRegistrations)
      .where(and(tenantIs(portalRegistrations.tenantId, tenantId), eq(portalRegistrations.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },

  /** null = Message-ID gab es schon (gleichzeitiger zweiter Upload) */
  async insert(row: InsertPortalRegistrationRow): Promise<PortalRegistrationRow | null> {
    const rows = await db.insert(portalRegistrations).values(row).onConflictDoNothing().returning();
    return rows[0] ?? null;
  },

  async update(
    tenantId: string | null,
    id: string,
    patch: Partial<InsertPortalRegistrationRow>,
    newEvents: PortalRegistrationEvent[] = [],
  ): Promise<PortalRegistrationRow | null> {
    const set: Record<string, unknown> = { ...patch, updatedAt: new Date() };
    if (newEvents.length) {
      set.events = sql`${portalRegistrations.events} || ${JSON.stringify(newEvents)}::jsonb`;
    }
    const rows = await db
      .update(portalRegistrations)
      .set(set)
      .where(and(tenantIs(portalRegistrations.tenantId, tenantId), eq(portalRegistrations.id, id)))
      .returning();
    return rows[0] ?? null;
  },

  async list(
    tenantId: string | null,
    filter: { statuses?: PortalRegistrationStatus[]; limit?: number },
  ): Promise<PortalRegistrationRow[]> {
    const conditions = [tenantIs(portalRegistrations.tenantId, tenantId)];
    if (filter.statuses?.length) conditions.push(inArray(portalRegistrations.status, filter.statuses));
    return db
      .select()
      .from(portalRegistrations)
      .where(and(...conditions))
      .orderBy(desc(portalRegistrations.receivedAt))
      .limit(Math.min(filter.limit ?? 200, 500));
  },

  async countByStatus(tenantId: string | null): Promise<Record<string, number>> {
    const rows = await db
      .select({ status: portalRegistrations.status, count: sql<number>`count(*)::int` })
      .from(portalRegistrations)
      .where(tenantIs(portalRegistrations.tenantId, tenantId))
      .groupBy(portalRegistrations.status);
    return Object.fromEntries(rows.map((r) => [r.status, Number(r.count)]));
  },

  /** Wartende Anmeldungen, die länger als `olderThan` nicht geprüft wurden */
  async dueForRecheck(tenantId: string | null, olderThan: Date, limit: number): Promise<PortalRegistrationRow[]> {
    return db
      .select()
      .from(portalRegistrations)
      .where(
        and(
          tenantIs(portalRegistrations.tenantId, tenantId),
          eq(portalRegistrations.status, "waiting_master_data"),
          or(isNull(portalRegistrations.lastCheckedAt), lt(portalRegistrations.lastCheckedAt, olderThan)),
        ),
      )
      .orderBy(asc(portalRegistrations.lastCheckedAt))
      .limit(limit);
  },

  // ---- Postausgang ----

  async enqueueMail(row: {
    tenantId: string | null;
    registrationId: string;
    kind: PortalRegistrationOutboxKind;
    to: string[];
    cc: string[];
    subject: string;
    html: string;
    attachOriginal: boolean;
  }): Promise<PortalRegistrationOutboxRow> {
    const rows = await db
      .insert(portalRegistrationOutbox)
      .values({
        tenantId: row.tenantId,
        registrationId: row.registrationId,
        kind: row.kind,
        toAddresses: row.to,
        ccAddresses: row.cc,
        subject: row.subject,
        html: row.html,
        attachOriginal: row.attachOriginal,
      })
      .returning();
    return rows[0];
  },

  /**
   * Offene Mails für n8n holen und als „in Arbeit“ markieren. Eine Mail, deren Rückmeldung nach
   * 15 Minuten fehlt (n8n abgebrochen), wird erneut ausgegeben.
   */
  async claimPendingMails(tenantId: string | null, limit: number, now = new Date()): Promise<PortalRegistrationOutboxRow[]> {
    const staleBefore = new Date(now.getTime() - 15 * 60 * 1000);
    const candidates = await db
      .select({ id: portalRegistrationOutbox.id })
      .from(portalRegistrationOutbox)
      .where(
        and(
          tenantIs(portalRegistrationOutbox.tenantId, tenantId),
          eq(portalRegistrationOutbox.status, "pending"),
          or(isNull(portalRegistrationOutbox.claimedAt), lt(portalRegistrationOutbox.claimedAt, staleBefore)),
        ),
      )
      .orderBy(asc(portalRegistrationOutbox.createdAt))
      .limit(limit);
    if (!candidates.length) return [];
    return db
      .update(portalRegistrationOutbox)
      .set({ claimedAt: now, attempts: sql`${portalRegistrationOutbox.attempts} + 1` })
      .where(
        and(
          inArray(
            portalRegistrationOutbox.id,
            candidates.map((c) => c.id),
          ),
          eq(portalRegistrationOutbox.status, "pending"),
          or(isNull(portalRegistrationOutbox.claimedAt), lt(portalRegistrationOutbox.claimedAt, staleBefore)),
        ),
      )
      .returning();
  },

  async getMail(tenantId: string | null, id: string): Promise<PortalRegistrationOutboxRow | null> {
    const rows = await db
      .select()
      .from(portalRegistrationOutbox)
      .where(and(tenantIs(portalRegistrationOutbox.tenantId, tenantId), eq(portalRegistrationOutbox.id, id)))
      .limit(1);
    return rows[0] ?? null;
  },

  async markMail(
    tenantId: string | null,
    id: string,
    patch: { status: "pending" | "sent" | "failed"; lastError?: string | null; sentAt?: Date | null; claimedAt?: Date | null; attempts?: number },
  ): Promise<void> {
    await db
      .update(portalRegistrationOutbox)
      .set(patch)
      .where(and(tenantIs(portalRegistrationOutbox.tenantId, tenantId), eq(portalRegistrationOutbox.id, id)));
  },

  async mailsForRegistration(tenantId: string | null, registrationId: string): Promise<PortalRegistrationOutboxRow[]> {
    return db
      .select()
      .from(portalRegistrationOutbox)
      .where(and(tenantIs(portalRegistrationOutbox.tenantId, tenantId), eq(portalRegistrationOutbox.registrationId, registrationId)))
      .orderBy(asc(portalRegistrationOutbox.createdAt));
  },

  // ---- Außendienst-Zuordnung ----

  async findSalesRep(tenantId: string | null, customerNumber: string): Promise<SalesRepAssignment | null> {
    const rows = await db
      .select()
      .from(salesRepAssignments)
      .where(and(tenantIs(salesRepAssignments.tenantId, tenantId), eq(salesRepAssignments.customerNumber, customerNumber.trim())))
      .limit(1);
    const r = rows[0];
    return r ? { customerNumber: r.customerNumber, repName: r.repName, repEmail: r.repEmail, updatedAt: r.updatedAt.toISOString() } : null;
  },

  async listSalesReps(tenantId: string | null): Promise<SalesRepAssignment[]> {
    const rows = await db
      .select()
      .from(salesRepAssignments)
      .where(tenantIs(salesRepAssignments.tenantId, tenantId))
      .orderBy(asc(salesRepAssignments.customerNumber));
    return rows.map((r) => ({ customerNumber: r.customerNumber, repName: r.repName, repEmail: r.repEmail, updatedAt: r.updatedAt.toISOString() }));
  },

  /** Liste ersetzen (replace) oder ergänzen/überschreiben je Kundennummer (merge) */
  async importSalesReps(tenantId: string | null, rows: SalesRepAssignment[], mode: "replace" | "merge"): Promise<number> {
    return db.transaction(async (tx) => {
      if (mode === "replace") {
        await tx.delete(salesRepAssignments).where(tenantIs(salesRepAssignments.tenantId, tenantId));
      }
      const now = new Date();
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500).map((r) => ({
          tenantId,
          customerNumber: r.customerNumber,
          repName: r.repName,
          repEmail: r.repEmail,
          updatedAt: now,
        }));
        await tx
          .insert(salesRepAssignments)
          .values(chunk)
          .onConflictDoUpdate({
            target: [salesRepAssignments.tenantId, salesRepAssignments.customerNumber],
            set: { repName: sql`excluded.rep_name`, repEmail: sql`excluded.rep_email`, updatedAt: now },
          });
      }
      return rows.length;
    });
  },

  async deleteSalesRep(tenantId: string | null, customerNumber: string): Promise<void> {
    await db
      .delete(salesRepAssignments)
      .where(and(tenantIs(salesRepAssignments.tenantId, tenantId), eq(salesRepAssignments.customerNumber, customerNumber)));
  },
};
