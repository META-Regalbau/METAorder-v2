/**
 * Was passiert mit einer Mail nach der Verarbeitung (rein, testbar)?
 * Ergebnis: Ausgang, Outlook-Kategorien, Weiterleitung und die Probleme, für die ein Ticket entsteht.
 */
import {
  EMAIL_INTAKE_CATEGORIES,
  EMAIL_INTAKE_OTHER_TYPE_LABELS,
  isForwardTargetIntakeMailbox,
  isValidIntakeEmail,
  METAORDER_FORWARD_MARKER,
  type EmailIntakeOtherType,
  type EmailIntakeOutcome,
  type EmailIntakeProblemReason,
  type EmailIntakeResponse,
  type EmailIntakeSettings,
  type EmailIntakeFilterRule,
  type EmailIntakeMailboxMode,
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
  /** In den Verarbeitet-Ordner verschieben (nie im persönlichen Postfach, nie aussortierte Mails) */
  move: boolean;
  filter: EmailIntakeResponse["filter"];
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
    `${METAORDER_FORWARD_MARKER} ` +
    `(Einordnung: ${label}, Sicherheit ${Math.round(triage.confidence * 100)} %).${reason} ` +
    `Sie wurde automatisch weitergeleitet. Antworten gehen direkt an den ursprünglichen Absender.`
  );
}

export function planEmailIntake(input: {
  /** Art des Postfachs; persönlich = nur Kategorien, nichts verschieben oder weiterleiten */
  mailboxMode?: EmailIntakeMailboxMode;
  /** Vom Filter aussortiert */
  ignoredByFilter?: { rule: EmailIntakeFilterRule; reason: string } | null;
  skippedAsOther: boolean;
  triage: EmailTriageResult | null;
  outcomes: Array<{ filename: string; outcome: CommercialAgentProcessOutcome }>;
  /** Bei Wiederholung: Art des vorhandenen Entwurfs */
  existingDraftKind: "order" | "offer" | null;
  settings: Pick<EmailIntakeSettings, "forwardOtherTo" | "ticketOnFailure" | "ticketOnShopwareError" | "ticketOnMarginRed"> & {
    /** Angebundene Postfächer: dorthin wird nie weitergeleitet (Schleife) */
    mailboxes?: EmailIntakeSettings["mailboxes"];
  };
}): EmailIntakePlan {
  const plan = planByOutcome(input);
  const personal = input.mailboxMode === "personal";
  // Im persönlichen Postfach ist die Kategorie die einzige Markierung „erledigt“: ohne sie holt
  // n8n die Mail beim nächsten Lauf erneut
  if (personal && plan.categories.length === 0) plan.categories.push(EMAIL_INTAKE_CATEGORIES.other);
  return {
    ...plan,
    move: plan.outcome !== "ignored" && !personal,
    forward: personal ? null : plan.forward,
  };
}

function planByOutcome(input: Parameters<typeof planEmailIntake>[0]): Omit<EmailIntakePlan, "move"> {
  const { settings } = input;
  if (input.ignoredByFilter) {
    return {
      outcome: "ignored",
      categories: [EMAIL_INTAKE_CATEGORIES.ignored],
      forward: null,
      other: null,
      problems: [],
      filter: { rule: input.ignoredByFilter.rule, reason: input.ignoredByFilter.reason },
    };
  }

  if (input.skippedAsOther && input.triage?.kind === "other") {
    const to = settings.forwardOtherTo.trim();
    // Abwesenheitsnotizen und Spam nur markieren und verschieben (Entscheidung 10.10.2026).
    // Nie an ein angebundenes Postfach: dort käme die Mail wieder an und würde erneut weitergeleitet.
    const forwardable =
      !NOT_FORWARDED.includes(input.triage.otherType) &&
      !isForwardTargetIntakeMailbox({ forwardOtherTo: to, mailboxes: settings.mailboxes ?? [] });
    return {
      outcome: "other",
      categories: [EMAIL_INTAKE_CATEGORIES.other],
      forward: forwardable && to && isValidIntakeEmail(to) ? { to, comment: buildForwardComment(input.triage) } : null,
      other: { type: input.triage.otherType, confidence: input.triage.confidence, reason: input.triage.reason },
      problems: [],
      filter: null,
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

  return { outcome, categories, forward: null, other: null, problems, filter: null };
}
