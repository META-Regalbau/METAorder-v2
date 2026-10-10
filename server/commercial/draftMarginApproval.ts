/**
 * Freigabe roter Entwürfe (DB unter der Warnschwelle).
 *
 * - Die Anlage (Prüffenster, n8n, Automatik) ist bei Rot gesperrt, bis jemand mit Recht
 *   „DB-Werte sehen“ freigegeben hat (checkMarginGateForCreate in den Anlage-Funktionen).
 * - Sachbearbeiter fordern mit Begründung an; Freigebende bekommen eine Benachrichtigung.
 * - Eine Freigabe gilt für den Stand aus Positionen, Mengen und Preisen (fingerprint).
 *   Ändert sich der Entwurf danach, muss neu freigegeben werden.
 */
import type { IStorage } from "../storage";
import type { CommercialDraftMarginApproval, InsertNotification } from "@shared/schema";
import type { DraftProfitability } from "@shared/draftProfitability";
import type {
  DraftMarginApprovalEntry,
  DraftMarginApprovalView,
} from "@shared/draftMarginApproval";
import { refreshDraftProfitability, type DraftForProfitability, type DraftKind } from "./draftProfitability";
import { notificationEvents } from "../lib/events";
import { logger } from "../lib/logger";

const log = logger.child({ component: "commercial/draftMarginApproval" });

export const MIN_APPROVAL_REASON_LENGTH = 10;
export const MARGIN_APPROVAL_REQUIRED_CODE = "margin_approval_required";

/** Stand des Entwurfs, für den eine Freigabe gilt: je Position Menge und Netto-Stückpreis. */
export function profitabilityFingerprint(snapshot: DraftProfitability): string {
  return snapshot.lines
    .map((line) => `${line.index}:${line.quantity}:${line.unitPriceNet ?? "-"}`)
    .join("|");
}

function toEntry(row: CommercialDraftMarginApproval, canViewDetails: boolean): DraftMarginApprovalEntry {
  return {
    id: row.id,
    status: row.status as DraftMarginApprovalEntry["status"],
    reason: row.reason,
    requestedByName: row.requestedByName,
    requestedAt: row.requestedAt.toISOString(),
    decidedByName: row.decidedByName ?? null,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    decisionComment: row.decisionComment ?? null,
    marginPercent: canViewDetails ? (row.marginPercent ?? null) : null,
    db1Total: canViewDetails ? (row.db1Total ?? null) : null,
  };
}

/** Reiner Zustand aus aktueller DB-Berechnung und Verlauf (neueste zuerst). */
export function evaluateMarginApproval(
  snapshot: DraftProfitability | null,
  approvals: CommercialDraftMarginApproval[],
  canViewDetails: boolean,
): DraftMarginApprovalView {
  const required = snapshot?.summary.crmVerdict === "red";
  const latestRow = approvals[0];
  const latest = latestRow ? toEntry(latestRow, canViewDetails) : null;
  const history = approvals.slice(0, 10).map((row) => toEntry(row, canViewDetails));

  let state: DraftMarginApprovalView["state"] = "not_required";
  if (required) {
    if (!latestRow) state = "missing";
    else if (latestRow.fingerprint !== profitabilityFingerprint(snapshot!)) state = "stale";
    else state = latestRow.status as "requested" | "approved" | "rejected";
  }
  return { required, state, canCreate: !required || state === "approved", latest, history };
}

export async function loadMarginApprovalView(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  snapshot: DraftProfitability | null;
  canViewDetails: boolean;
}): Promise<DraftMarginApprovalView> {
  const approvals = await params.storage.getDraftMarginApprovals(params.kind, params.draftId, params.tenantId);
  return evaluateMarginApproval(params.snapshot, approvals, params.canViewDetails);
}

/**
 * Sperre vor der Anlage: frische DB-Berechnung; bei Rot nur mit passender Freigabe.
 * Lässt sich die DB nicht berechnen, wird nicht gesperrt (Anzeige ist nie Voraussetzung).
 */
export async function checkMarginGateForCreate(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  draft: DraftForProfitability;
}): Promise<{ ok: true } | { ok: false; error: string; statusCode: number; code: string }> {
  const snapshot = await refreshDraftProfitability(params);
  if (!snapshot || snapshot.summary.crmVerdict !== "red") return { ok: true };
  const view = await loadMarginApprovalView({ ...params, snapshot, canViewDetails: false });
  if (view.canCreate) return { ok: true };
  return {
    ok: false,
    statusCode: 409,
    code: MARGIN_APPROVAL_REQUIRED_CODE,
    error: "DB zu niedrig: Anlage erst nach Freigabe durch jemanden mit Recht „DB-Werte sehen“",
  };
}

type ApprovalUser = { id: string; username: string };

function draftLink(kind: DraftKind, draftId: string): string {
  return kind === "order" ? `/order-drafts?draftId=${draftId}` : `/offers?draftId=${draftId}`;
}

function draftLabel(kind: DraftKind, fileName: string | null | undefined): string {
  return `${kind === "order" ? "Bestellentwurf" : "Angebotsentwurf"} ${fileName ?? ""}`.trim();
}

async function notify(
  storage: IStorage,
  tenantId: string | null,
  userIds: string[],
  title: string,
  message: string,
  link: string,
): Promise<void> {
  for (const userId of userIds) {
    try {
      const notification: InsertNotification = {
        userId,
        type: "draft_margin_approval",
        title,
        message,
        link,
        ticketId: null,
        ticketNumber: null,
        read: 0,
      };
      notificationEvents.emitNotificationCreated(await storage.createNotification(notification, tenantId));
    } catch (error) {
      log.warn({ err: error, userId }, "[MarginApproval] Benachrichtigung nicht erstellt");
    }
  }
}

export type MarginApprovalActionResult =
  | { ok: true; profitability: DraftProfitability; approval: CommercialDraftMarginApproval }
  | { ok: false; error: string; statusCode: number };

/** Sachbearbeiter: Freigabe mit Begründung anfordern; Freigebende werden benachrichtigt. */
export async function requestMarginApproval(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  draft: DraftForProfitability & { originalFileName?: string | null; status?: string | null };
  user: ApprovalUser;
  reason: string;
}): Promise<MarginApprovalActionResult> {
  const reason = params.reason.trim();
  if (reason.length < MIN_APPROVAL_REASON_LENGTH) {
    return { ok: false, statusCode: 400, error: "Bitte eine Begründung angeben (mindestens 10 Zeichen)" };
  }
  const snapshot = await refreshDraftProfitability(params);
  if (!snapshot) return { ok: false, statusCode: 500, error: "DB-Berechnung fehlgeschlagen" };
  const view = await loadMarginApprovalView({ ...params, snapshot, canViewDetails: true });
  if (!view.required) return { ok: false, statusCode: 409, error: "Freigabe nicht nötig: DB ist nicht rot" };
  if (view.state === "requested" || view.state === "approved") {
    return { ok: false, statusCode: 409, error: "Freigabe ist bereits angefordert bzw. erteilt" };
  }

  const approval = await params.storage.createDraftMarginApproval(
    {
      draftKind: params.kind,
      draftId: params.draftId,
      status: "requested",
      reason,
      fingerprint: profitabilityFingerprint(snapshot),
      verdict: snapshot.summary.crmVerdict,
      marginPercent: snapshot.summary.marginPercent,
      db1Total: snapshot.summary.db1Total,
      requestedByUserId: params.user.id,
      requestedByName: params.user.username,
    },
    params.tenantId,
  );

  const recipients = await params.storage.getUsersWithPermissionInTenant("viewMarginDetails", params.tenantId, {
    includeAdministrators: true,
  });
  // Benachrichtigung auf Deutsch wie die übrigen Servertexte: Dezimalkomma
  const margin =
    snapshot.summary.marginPercent != null
      ? ` (Aufschlag ${String(snapshot.summary.marginPercent).replace(".", ",")} %)`
      : "";
  await notify(
    params.storage,
    params.tenantId,
    recipients.map((u) => u.id).filter((id) => id !== params.user.id),
    "DB-Freigabe angefordert",
    `${draftLabel(params.kind, params.draft.originalFileName)}${margin} von ${params.user.username}: ${reason}`,
    draftLink(params.kind, params.draftId),
  );
  return { ok: true, profitability: snapshot, approval };
}

/**
 * Freigebende (Recht „DB-Werte sehen“, prüft die Route): offene Anforderung freigeben bzw.
 * ablehnen, oder ohne Anforderung direkt mit Begründung freigeben.
 */
export async function decideMarginApproval(params: {
  storage: IStorage;
  tenantId: string | null;
  kind: DraftKind;
  draftId: string;
  draft: DraftForProfitability & { originalFileName?: string | null };
  user: ApprovalUser;
  decision: "approve" | "reject";
  comment?: string | null;
}): Promise<MarginApprovalActionResult> {
  const comment = params.comment?.trim() || null;
  const snapshot = await refreshDraftProfitability(params);
  if (!snapshot) return { ok: false, statusCode: 500, error: "DB-Berechnung fehlgeschlagen" };
  const approvals = await params.storage.getDraftMarginApprovals(params.kind, params.draftId, params.tenantId);
  const view = evaluateMarginApproval(snapshot, approvals, true);
  if (!view.required) return { ok: false, statusCode: 409, error: "Freigabe nicht nötig: DB ist nicht rot" };
  if (view.state === "approved") return { ok: false, statusCode: 409, error: "Freigabe ist bereits erteilt" };

  const pending = view.state === "requested" ? approvals[0]! : null;
  if (!pending) {
    if (params.decision === "reject") {
      return { ok: false, statusCode: 409, error: "Keine offene Anforderung zum Ablehnen" };
    }
    if (!comment || comment.length < MIN_APPROVAL_REASON_LENGTH) {
      return { ok: false, statusCode: 400, error: "Bitte eine Begründung angeben (mindestens 10 Zeichen)" };
    }
    const approval = await params.storage.createDraftMarginApproval(
      {
        draftKind: params.kind,
        draftId: params.draftId,
        status: "approved",
        reason: comment,
        fingerprint: profitabilityFingerprint(snapshot),
        verdict: snapshot.summary.crmVerdict,
        marginPercent: snapshot.summary.marginPercent,
        db1Total: snapshot.summary.db1Total,
        requestedByUserId: params.user.id,
        requestedByName: params.user.username,
        decidedByUserId: params.user.id,
        decidedByName: params.user.username,
        decidedAt: new Date(),
        decisionComment: null,
      },
      params.tenantId,
    );
    return { ok: true, profitability: snapshot, approval };
  }

  const approval = await params.storage.updateDraftMarginApproval(
    pending.id,
    {
      status: params.decision === "approve" ? "approved" : "rejected",
      decidedByUserId: params.user.id,
      decidedByName: params.user.username,
      decidedAt: new Date(),
      decisionComment: comment,
    },
    params.tenantId,
  );
  if (!approval) return { ok: false, statusCode: 404, error: "Anforderung nicht gefunden" };

  if (pending.requestedByUserId && pending.requestedByUserId !== params.user.id) {
    const verb = params.decision === "approve" ? "freigegeben" : "abgelehnt";
    await notify(
      params.storage,
      params.tenantId,
      [pending.requestedByUserId],
      `DB-Freigabe ${verb}`,
      `${draftLabel(params.kind, params.draft.originalFileName)} von ${params.user.username} ${verb}${comment ? `: ${comment}` : ""}`,
      draftLink(params.kind, params.draftId),
    );
  }
  return { ok: true, profitability: snapshot, approval };
}
