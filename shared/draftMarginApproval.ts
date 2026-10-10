/** Freigabe roter Entwürfe — Zustand für Prüffenster und Listen. */

export type DraftMarginApprovalEntry = {
  id: string;
  status: "requested" | "approved" | "rejected";
  reason: string;
  requestedByName: string;
  requestedAt: string;
  decidedByName: string | null;
  decidedAt: string | null;
  decisionComment: string | null;
  /** nur mit Recht „DB-Werte sehen“ */
  marginPercent: number | null;
  db1Total: number | null;
};

export type DraftMarginApprovalState =
  /** DB nicht rot */
  | "not_required"
  /** rot, noch nie angefordert */
  | "missing"
  | "requested"
  | "approved"
  | "rejected"
  /** rot, letzte Anforderung/Freigabe galt einem anderen Stand (Preise/Mengen geändert) */
  | "stale";

export type DraftMarginApprovalView = {
  required: boolean;
  state: DraftMarginApprovalState;
  /** Anlage erlaubt (nicht rot oder für diesen Stand freigegeben) */
  canCreate: boolean;
  latest: DraftMarginApprovalEntry | null;
  history: DraftMarginApprovalEntry[];
};
