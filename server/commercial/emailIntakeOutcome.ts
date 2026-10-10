/**
 * Was passiert mit einer Mail nach der Verarbeitung (rein, testbar)?
 * Ergebnis: Ausgang, Outlook-Kategorien, Weiterleitung und die Probleme, für die ein Ticket entsteht.
 */
import {
  EMAIL_INTAKE_CATEGORIES,
  EMAIL_INTAKE_OTHER_TYPE_LABELS,
  isValidIntakeEmail,
  type EmailIntakeOtherType,
  type EmailIntakeOutcome,
  type EmailIntakeProblemReason,
  type EmailIntakeResponse,
  type EmailIntakeSettings,
} from "@shared/emailIntake";
import type { CommercialAgentProcessOutcome } from "./commercialAgentOrchestrator";
import type { EmailTriageResult } from "./emailIntakeTriage";

/** Werden nicht weitergeleitet, nur markiert und verschoben */
export const NOT_FORWARDED: readonly EmailIntakeOtherType[] = ["auto_reply", "spam"];

export type PlannedProblem = {
  reason: EmailIntakeProblemReason;
  draft: { kind: "order" | "offer"; id: string } | null;
  error: string | null;
};

export type EmailIntakePlan = {
  outcome: EmailIntakeOutcome;
  categories: string[];
  forward: EmailIntakeResponse["forward"];
  other: EmailIntakeResponse["other"];
  problems: PlannedProblem[];
};

const SKIP_REASON_TEXT: Record<string, string> = {
  agent_disabled: "Die Entwurfs-Automatik (Commercial Agent) ist ausgeschaltet.",
  not_processable: "Kein verwertbarer Anhang und kein auswertbarer Mailtext.",
};

export function buildForwardComment(triage: Extract<EmailTriageResult, { kind: "other" }>): string {
  const label = EMAIL_INTAKE_OTHER_TYPE_LABELS[triage.otherType];
  const text = triage.reason.trim();
  const reason = text ? ` Begründung: ${text}${/[.!?]$/.test(text) ? "" : "."}` : "";
  return (
    `METAorder hat diese E-Mail weder als Bestellung noch als Angebotsanfrage erkannt ` +
    `(Einordnung: ${label}, Sicherheit ${Math.round(triage.confidence * 100)} %).${reason} ` +
    `Sie wurde automatisch weitergeleitet. Antworten gehen direkt an den ursprünglichen Absender.`
  );
}

export function planEmailIntake(input: {
  skippedAsOther: boolean;
  triage: EmailTriageResult | null;
  outcomes: Array<{ filename: string; outcome: CommercialAgentProcessOutcome }>;
  /** Bei Wiederholung: Art des vorhandenen Entwurfs */
  existingDraftKind: "order" | "offer" | null;
  settings: Pick<EmailIntakeSettings, "forwardOtherTo" | "ticketOnFailure" | "ticketOnShopwareError" | "ticketOnMarginRed">;
}): EmailIntakePlan {
  const { settings } = input;

  if (input.skippedAsOther && input.triage?.kind === "other") {
    const to = settings.forwardOtherTo.trim();
    // Abwesenheitsnotizen und Spam nur markieren und verschieben (Entscheidung 10.10.2026)
    const forwardable = !NOT_FORWARDED.includes(input.triage.otherType);
    return {
      outcome: "other",
      categories: [EMAIL_INTAKE_CATEGORIES.other],
      forward: forwardable && to && isValidIntakeEmail(to) ? { to, comment: buildForwardComment(input.triage) } : null,
      other: { type: input.triage.otherType, confidence: input.triage.confidence, reason: input.triage.reason },
      problems: [],
    };
  }

  const created = input.outcomes.flatMap((o) => (o.outcome.status === "created" ? [o.outcome.result] : []));
  const failed = input.outcomes.filter((o) => o.outcome.status === "failed");
  const duplicates = input.outcomes.filter((o) => o.outcome.status === "skipped" && o.outcome.reason === "duplicate");
  const otherSkips = input.outcomes.flatMap((o) =>
    o.outcome.status === "skipped" && o.outcome.reason !== "duplicate" ? [o.outcome.reason] : [],
  );

  const problems: PlannedProblem[] = [];
  for (const result of created) {
    const strict = result.strict;
    if (!strict) continue;
    const draft = { kind: result.draftKind, id: result.draftId };
    if (settings.ticketOnShopwareError && strict.strictAllowed && !strict.shopwareCreated && strict.shopwareError) {
      problems.push({ reason: "shopware_failed", draft, error: strict.shopwareError });
    }
    if (settings.ticketOnMarginRed && strict.strictReasons.includes("margin_below_minimum")) {
      problems.push({ reason: "margin_red", draft, error: null });
    }
  }

  const kinds = new Set(created.map((r) => r.draftKind));
  let outcome: EmailIntakeOutcome;
  if (kinds.has("order") && kinds.has("offer")) outcome = "mixed";
  else if (kinds.has("order")) outcome = "order";
  else if (kinds.has("offer")) outcome = "offer";
  else if (failed.length === 0 && otherSkips.length === 0 && (duplicates.length > 0 || input.existingDraftKind)) outcome = "duplicate";
  else outcome = "failed";

  // Teilweise gescheitert zählt auch: ein verlorener Anhang wäre sonst unbemerkt
  if (settings.ticketOnFailure && (failed.length > 0 || outcome === "failed")) {
    const errors = [
      ...failed.map((f) => `${f.filename}: ${f.outcome.status === "failed" ? f.outcome.error : ""}`),
      ...otherSkips.map((reason) => SKIP_REASON_TEXT[reason] ?? reason),
    ];
    problems.push({
      reason: "processing_failed",
      draft: null,
      error: errors.join("\n") || "Kein Entwurf entstanden.",
    });
  }

  const categories: string[] = [];
  if (outcome === "order" || outcome === "mixed") categories.push(EMAIL_INTAKE_CATEGORIES.order);
  if (outcome === "offer" || outcome === "mixed") categories.push(EMAIL_INTAKE_CATEGORIES.offer);
  if (outcome === "duplicate" && input.existingDraftKind) {
    categories.push(input.existingDraftKind === "order" ? EMAIL_INTAKE_CATEGORIES.order : EMAIL_INTAKE_CATEGORIES.offer);
  }
  if (outcome === "failed") categories.push(EMAIL_INTAKE_CATEGORIES.failed);

  return { outcome, categories, forward: null, other: null, problems };
}
