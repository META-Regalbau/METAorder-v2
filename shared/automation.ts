/**
 * Automatisierungsregeln: gemeinsamer Katalog fuer Server (Pruefung, Auswertung) und Editor
 * (Auswahllisten, Formulare). Eine Regel = Ausloeser + Bedingungen (alle muessen zutreffen) +
 * Aktionen (der Reihe nach). Gespeichert als JSON-Arrays in automation_rules.conditions/.actions.
 */

export const TICKET_STATUSES = ["open", "in_progress", "waiting_for_customer", "waiting_for_internal", "resolved", "closed"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_CATEGORIES = ["general", "order_issue", "product_inquiry", "technical_support", "complaint", "feature_request", "discount_request", "other"] as const;
export const SENTIMENTS = ["positive", "neutral", "negative"] as const;

// ---------------------------------------------------------------------------
// Ausloeser
// ---------------------------------------------------------------------------

export const AUTOMATION_TRIGGER_TYPES = [
  "ticket_created",
  "ticket_status_changed",
  "order_created",
  "order_status_changed",
  "order_payment_changed",
  "scheduled",
] as const;
export type AutomationTriggerTypeId = (typeof AUTOMATION_TRIGGER_TYPES)[number];

/** available=false: im Editor sichtbar, aber noch nicht waehlbar (folgt in einer spaeteren Ausbaustufe). */
export const AUTOMATION_TRIGGERS: Record<AutomationTriggerTypeId, { entity: "ticket" | "order"; available: boolean }> = {
  ticket_created: { entity: "ticket", available: true },
  ticket_status_changed: { entity: "ticket", available: true },
  order_created: { entity: "order", available: false },
  order_status_changed: { entity: "order", available: false },
  order_payment_changed: { entity: "order", available: false },
  scheduled: { entity: "order", available: false },
};

// ---------------------------------------------------------------------------
// Bedingungen
// ---------------------------------------------------------------------------

export const AUTOMATION_OPERATORS = ["equals", "notEquals", "contains", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"] as const;
export type AutomationOperator = (typeof AUTOMATION_OPERATORS)[number];

export type AutomationFieldType = "enum" | "text" | "number" | "boolean";

export const OPERATORS_BY_FIELD_TYPE: Record<AutomationFieldType, readonly AutomationOperator[]> = {
  enum: ["equals", "notEquals"],
  text: ["contains", "equals", "notEquals"],
  number: ["equals", "notEquals", "greaterThan", "lessThan", "greaterThanOrEqual", "lessThanOrEqual"],
  boolean: ["equals"],
};

export type AutomationFieldDef = {
  type: AutomationFieldType;
  options?: readonly string[];
  /** Nur bei diesen Ausloesern verfuegbar */
  triggers: readonly AutomationTriggerTypeId[];
  /** Wird erst bei Bedarf ermittelt (z. B. per KI) */
  computed?: boolean;
};

const TICKET_TRIGGERS = ["ticket_created", "ticket_status_changed"] as const;

export const AUTOMATION_FIELDS: Record<string, AutomationFieldDef> = {
  "ticket.priority": { type: "enum", options: TICKET_PRIORITIES, triggers: TICKET_TRIGGERS },
  "ticket.category": { type: "enum", options: TICKET_CATEGORIES, triggers: TICKET_TRIGGERS },
  "ticket.status": { type: "enum", options: TICKET_STATUSES, triggers: TICKET_TRIGGERS },
  "ticket.previousStatus": { type: "enum", options: TICKET_STATUSES, triggers: ["ticket_status_changed"] },
  "ticket.title": { type: "text", triggers: TICKET_TRIGGERS },
  "ticket.description": { type: "text", triggers: TICKET_TRIGGERS },
  "ticket.customerEmail": { type: "text", triggers: TICKET_TRIGGERS },
  "ticket.customerName": { type: "text", triggers: TICKET_TRIGGERS },
  "ticket.orderNumber": { type: "text", triggers: TICKET_TRIGGERS },
  "ticket.isAssigned": { type: "boolean", triggers: TICKET_TRIGGERS },
  "ticket.fromEmail": { type: "boolean", triggers: TICKET_TRIGGERS },
  "ticket.sentiment": { type: "enum", options: SENTIMENTS, triggers: TICKET_TRIGGERS, computed: true },
};

export function fieldsForTrigger(trigger: AutomationTriggerTypeId): string[] {
  return Object.entries(AUTOMATION_FIELDS)
    .filter(([, def]) => def.triggers.includes(trigger))
    .map(([key]) => key);
}

export type AutomationConditionInput = { field: string; operator: string; value: string | number | boolean };

export type AutomationFacts = Record<string, string | number | boolean | null | undefined>;

function toBool(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (v === "true" || v === 1 || v === "1") return true;
  if (v === "false" || v === 0 || v === "0") return false;
  return null;
}

/** Eine Bedingung gegen die Fakten pruefen. Unbekannte Felder/Operatoren treffen nie zu. */
export function evaluateCondition(condition: AutomationConditionInput, facts: AutomationFacts): boolean {
  const def = AUTOMATION_FIELDS[condition.field];
  if (!def || !OPERATORS_BY_FIELD_TYPE[def.type].includes(condition.operator as AutomationOperator)) return false;
  const actual = facts[condition.field];
  const expected = condition.value;

  switch (def.type) {
    case "boolean": {
      const a = toBool(actual), e = toBool(expected);
      return a !== null && e !== null && a === e;
    }
    case "number": {
      const a = typeof actual === "number" ? actual : Number(actual);
      const e = typeof expected === "number" ? expected : Number(expected);
      if (actual === null || actual === undefined || actual === "" || Number.isNaN(a) || Number.isNaN(e)) return false;
      switch (condition.operator) {
        case "equals": return a === e;
        case "notEquals": return a !== e;
        case "greaterThan": return a > e;
        case "lessThan": return a < e;
        case "greaterThanOrEqual": return a >= e;
        case "lessThanOrEqual": return a <= e;
        default: return false;
      }
    }
    case "enum":
    case "text": {
      const a = actual === null || actual === undefined ? "" : String(actual).trim().toLowerCase();
      const e = String(expected ?? "").trim().toLowerCase();
      switch (condition.operator) {
        case "equals": return a === e;
        case "notEquals": return a !== e;
        case "contains": return e !== "" && a.includes(e);
        default: return false;
      }
    }
  }
}

/** Alle Bedingungen muessen zutreffen; keine Bedingungen = trifft immer zu. */
export function evaluateConditions(conditions: AutomationConditionInput[], facts: AutomationFacts): boolean {
  return conditions.every((c) => evaluateCondition(c, facts));
}

// ---------------------------------------------------------------------------
// Aktionen
// ---------------------------------------------------------------------------

export const AUTOMATION_ACTION_TYPES = [
  "assign_ticket",
  "update_ticket_priority",
  "send_notification",
  "send_email",
  "run_ai_analysis",
  "create_ticket",
  "update_order_status",
] as const;
export type AutomationActionTypeId = (typeof AUTOMATION_ACTION_TYPES)[number];

export type AutomationParamDef =
  | { kind: "user"; required: boolean }
  | { kind: "enum"; options: readonly string[]; required: boolean }
  | { kind: "text"; required: boolean; multiline?: boolean; placeholders?: boolean }
  | { kind: "email"; required: boolean; placeholders?: boolean }
  | { kind: "boolean" };

export type AutomationActionDef = {
  available: boolean;
  /** Nur sinnvoll, wenn der Ausloeser ein Ticket liefert */
  needsTicket?: boolean;
  params: Record<string, AutomationParamDef>;
};

export const AUTOMATION_ACTIONS: Record<AutomationActionTypeId, AutomationActionDef> = {
  assign_ticket: { available: true, needsTicket: true, params: { userId: { kind: "user", required: true } } },
  update_ticket_priority: { available: true, needsTicket: true, params: { priority: { kind: "enum", options: TICKET_PRIORITIES, required: true } } },
  send_notification: {
    available: true,
    params: {
      userId: { kind: "user", required: true },
      title: { kind: "text", required: true, placeholders: true },
      message: { kind: "text", required: true, multiline: true, placeholders: true },
    },
  },
  send_email: {
    available: true,
    params: {
      to: { kind: "email", required: true, placeholders: true },
      subject: { kind: "text", required: true, placeholders: true },
      body: { kind: "text", required: true, multiline: true, placeholders: true },
    },
  },
  run_ai_analysis: {
    available: true,
    needsTicket: true,
    params: { applyCategory: { kind: "boolean" }, escalateNegative: { kind: "boolean" } },
  },
  create_ticket: {
    available: true,
    params: {
      title: { kind: "text", required: true, placeholders: true },
      description: { kind: "text", required: true, multiline: true, placeholders: true },
      priority: { kind: "enum", options: TICKET_PRIORITIES, required: false },
      category: { kind: "enum", options: TICKET_CATEGORIES, required: false },
    },
  },
  // Status in Shopware aendern - bewusst noch nicht freigegeben
  update_order_status: { available: false, params: {} },
};

export type AutomationActionInput = { type: string; params: Record<string, unknown> };

// ---------------------------------------------------------------------------
// Platzhalter in Texten: {{ticket.ticketNumber}}, {{ticket.title}}, ...
// ---------------------------------------------------------------------------

export const AUTOMATION_PLACEHOLDERS: Record<"ticket" | "order", readonly string[]> = {
  ticket: ["ticket.ticketNumber", "ticket.title", "ticket.status", "ticket.previousStatus", "ticket.priority", "ticket.category", "ticket.customerName", "ticket.customerEmail", "ticket.orderNumber"],
  order: [],
};

/** Ersetzt {{feld}} durch den Wert aus den Fakten; unbekannte Platzhalter werden leer. */
export function interpolate(template: string, facts: AutomationFacts): string {
  return template.replace(/\{\{\s*([a-zA-Z][\w.]*)\s*\}\}/g, (_m, key: string) => {
    const v = facts[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

// ---------------------------------------------------------------------------
// Regel pruefen (Server beim Speichern, Editor fuer Hinweise)
// ---------------------------------------------------------------------------

/** Lesbare Namen fuer Meldungen der Regelpruefung */
const PARAM_LABELS: Record<string, string> = {
  userId: "Benutzer", title: "Titel", message: "Nachricht", to: "Empfänger", subject: "Betreff",
  body: "Text", priority: "Priorität", category: "Kategorie", description: "Beschreibung",
};
const paramLabel = (name: string) => PARAM_LABELS[name] ?? name;

const EMAIL_OR_PLACEHOLDER = /^(\{\{\s*[\w.]+\s*\}\}|[^\s@]+@[^\s@]+\.[^\s@]+)$/;

export function validateAutomationRule(rule: {
  triggerType: string;
  conditions?: AutomationConditionInput[] | null;
  actions: AutomationActionInput[];
}): string[] {
  const errors: string[] = [];
  const trigger = AUTOMATION_TRIGGERS[rule.triggerType as AutomationTriggerTypeId];
  if (!trigger) return [`Unbekannter Auslöser: ${rule.triggerType}`];
  if (!trigger.available) errors.push(`Auslöser "${rule.triggerType}" ist noch nicht verfügbar`);

  (rule.conditions ?? []).forEach((c, i) => {
    const def = AUTOMATION_FIELDS[c.field];
    if (!def) return void errors.push(`Bedingung ${i + 1}: unbekanntes Feld "${c.field}"`);
    if (!def.triggers.includes(rule.triggerType as AutomationTriggerTypeId)) errors.push(`Bedingung ${i + 1}: Feld "${c.field}" passt nicht zum Auslöser`);
    if (!OPERATORS_BY_FIELD_TYPE[def.type].includes(c.operator as AutomationOperator)) errors.push(`Bedingung ${i + 1}: Operator "${c.operator}" passt nicht zum Feld`);
    if (def.type === "enum" && def.options && !def.options.includes(String(c.value))) errors.push(`Bedingung ${i + 1}: Wert "${c.value}" ist nicht erlaubt`);
    if (def.type === "number" && Number.isNaN(Number(c.value))) errors.push(`Bedingung ${i + 1}: Zahl erwartet`);
    if (def.type === "boolean" && toBool(c.value) === null) errors.push(`Bedingung ${i + 1}: ja/nein erwartet`);
    if (def.type === "text" && String(c.value ?? "").trim() === "") errors.push(`Bedingung ${i + 1}: Wert fehlt`);
  });

  if (rule.actions.length === 0) errors.push("Mindestens eine Aktion ist nötig");
  rule.actions.forEach((a, i) => {
    const def = AUTOMATION_ACTIONS[a.type as AutomationActionTypeId];
    if (!def) return void errors.push(`Aktion ${i + 1}: unbekannter Typ "${a.type}"`);
    if (!def.available) errors.push(`Aktion ${i + 1}: "${a.type}" ist noch nicht verfügbar`);
    if (def.needsTicket && trigger.entity !== "ticket") errors.push(`Aktion ${i + 1}: braucht einen Ticket-Auslöser`);
    for (const [name, p] of Object.entries(def.params)) {
      const v = a.params?.[name];
      const empty = v === undefined || v === null || String(v).trim() === "";
      if ("required" in p && p.required && empty) { errors.push(`Aktion ${i + 1}: ${paramLabel(name)} fehlt`); continue; }
      if (empty) continue;
      if (p.kind === "enum" && !p.options.includes(String(v))) errors.push(`Aktion ${i + 1}: ${paramLabel(name)} hat einen ungültigen Wert`);
      if (p.kind === "email" && !EMAIL_OR_PLACEHOLDER.test(String(v).trim())) errors.push(`Aktion ${i + 1}: ${paramLabel(name)} ist keine E-Mail-Adresse`);
    }
  });
  return errors;
}
