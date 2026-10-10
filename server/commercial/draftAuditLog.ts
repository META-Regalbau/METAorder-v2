/**
 * Vorgangsprotokoll der Entwurfs-Automatik (Systemprotokoll, Bereich „Entwürfe“).
 *
 * Jede Zeile hat einen festen Ereigniscode (`event`), Entwurfsart und -ID sowie — wenn ein
 * Mensch gehandelt hat — `userId`/`username`. So lässt sich im Systemprotokoll nach der
 * Entwurfs-ID suchen und der ganze Weg eines Entwurfs nachlesen. Beträge (DB, Aufschlag,
 * Herstellkosten) stehen mit drin: das Systemprotokoll sehen nur Administratoren.
 */
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftAuditLog" });

export type DraftAuditEvent =
  | "draft.created"
  | "draft.updated"
  | "draft.deleted"
  | "draft.db.calculated"
  | "draft.db.verdict_changed"
  | "draft.db.frozen"
  | "draft.price.changed"
  | "draft.price.reset"
  | "draft.margin.approval_requested"
  | "draft.margin.approved"
  | "draft.margin.rejected"
  | "draft.margin.create_blocked"
  | "draft.discount.blocked"
  | "draft.discount.justification_missing"
  | "draft.discount.approval_recorded"
  | "draft.create.started"
  | "draft.create.succeeded"
  | "draft.create.failed"
  | "draft.create.rejected"
  | "draft.creation.released"
  | "draft.auto_create.evaluated";

export type DraftAuditFields = {
  draftKind: "order" | "offer";
  draftId: string;
  tenantId?: string | null;
  userId?: string | null;
  username?: string | null;
  [key: string]: unknown;
};

type Level = "debug" | "info" | "warn" | "error";

/** Eine Zeile Vorgangsprotokoll; Felder ohne Wert (undefined) entfallen. */
export function logDraftEvent(level: Level, event: DraftAuditEvent, fields: DraftAuditFields, msg: string): void {
  const clean: Record<string, unknown> = { event };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) clean[key] = value;
  }
  if (clean.tenantId == null) delete clean.tenantId;
  log[level](clean, msg);
}

/** Benutzer aus req.user für das Protokoll (n8n/Integration: Schlüsselbenutzer). */
export function auditUser(user: unknown): { userId: string | null; username: string | null } {
  const u = user as { id?: string; username?: string } | undefined;
  return { userId: u?.id ?? null, username: u?.username ?? null };
}
