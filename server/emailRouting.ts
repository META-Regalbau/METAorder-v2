import type { EmailRoutingRule, EmailRoutingSettings, TicketCategory, TicketPriority } from "@shared/schema";
import type { IStorage } from "./storage";
import type { EmailClassification } from "./emailClassifier";

export type EmailRoutingResult = {
  category: TicketCategory;
  priority: TicketPriority;
  skill?: string;
  confidence: number;
  assigneeUserId?: string | null;
  source: "classification" | "fallback" | "default";
};

export const DEFAULT_EMAIL_ROUTING_SETTINGS: EmailRoutingSettings = {
  enabled: true,
  confidenceThreshold: 0.65,
  defaultCategory: "general",
  defaultPriority: "normal",
  defaultSkill: "",
  fallbackRules: [],
};

export async function getEmailRoutingSettings(storage: IStorage): Promise<EmailRoutingSettings> {
  const stored = await storage.getSetting("email_routing_settings");
  return {
    ...DEFAULT_EMAIL_ROUTING_SETTINGS,
    ...stored,
    fallbackRules: Array.isArray(stored?.fallbackRules) ? stored.fallbackRules : [],
  };
}

function normalize(value: string) {
  return value.toLowerCase();
}

function ruleMatches(rule: EmailRoutingRule, input: { subject: string; body: string; from?: string }) {
  const targetText =
    rule.target === "subject"
      ? input.subject
      : rule.target === "from"
        ? input.from || ""
        : rule.target === "body"
          ? input.body
          : `${input.subject}\n${input.body}\n${input.from || ""}`;

  try {
    const regex = new RegExp(rule.pattern, "i");
    return regex.test(targetText);
  } catch {
    return normalize(targetText).includes(normalize(rule.pattern));
  }
}

function applyRule(rule: EmailRoutingRule, settings: EmailRoutingSettings) {
  return {
    category: rule.category || settings.defaultCategory,
    priority: rule.priority || settings.defaultPriority,
    skill: rule.skill || settings.defaultSkill,
  };
}

async function selectAssigneeBySkill(storage: IStorage, skill?: string) {
  if (!skill) return null;
  const [users, roles, tickets] = await Promise.all([
    storage.getAllUsers(),
    storage.getAllRoles(),
    storage.getAllTickets(),
  ]);

  const eligibleUsers = users.filter((user) => {
    if (!user.roleId) return false;
    const role = roles.find((r) => r.id === user.roleId);
    if (!role?.permissions?.manageTickets) return false;
    const skills = (user.skills || []).map((value) => value.toLowerCase());
    return skills.includes(skill.toLowerCase());
  });

  if (eligibleUsers.length === 0) return null;

  const counts = new Map<string, number>();
  for (const user of eligibleUsers) {
    counts.set(user.id, 0);
  }

  for (const ticket of tickets) {
    if (!ticket.assignedToUserId) continue;
    if (!counts.has(ticket.assignedToUserId)) continue;
    if (ticket.status === "resolved" || ticket.status === "closed") continue;
    counts.set(ticket.assignedToUserId, (counts.get(ticket.assignedToUserId) || 0) + 1);
  }

  let minAssignments = Infinity;
  let selectedUserId: string | null = null;
  for (const user of eligibleUsers) {
    const count = counts.get(user.id) || 0;
    if (count < minAssignments) {
      minAssignments = count;
      selectedUserId = user.id;
    }
  }

  return selectedUserId;
}

export async function routeIncomingEmail(
  storage: IStorage,
  input: { subject: string; body: string; from?: string },
  classification: EmailClassification,
  settings: EmailRoutingSettings
): Promise<EmailRoutingResult> {
  if (!settings.enabled) {
    return {
      category: settings.defaultCategory,
      priority: settings.defaultPriority,
      skill: settings.defaultSkill,
      confidence: 0,
      assigneeUserId: null,
      source: "default",
    };
  }

  let result: EmailRoutingResult = {
    category: classification.category,
    priority: classification.priority,
    skill: classification.skill || settings.defaultSkill,
    confidence: classification.confidence,
    assigneeUserId: null,
    source: "classification",
  };

  if (classification.confidence < settings.confidenceThreshold) {
    const matchingRule = settings.fallbackRules.find((rule) => ruleMatches(rule, input));
    if (matchingRule) {
      const applied = applyRule(matchingRule, settings);
      result = {
        category: applied.category,
        priority: applied.priority,
        skill: applied.skill,
        confidence: settings.confidenceThreshold,
        assigneeUserId: null,
        source: "fallback",
      };
    } else {
      result = {
        category: settings.defaultCategory,
        priority: settings.defaultPriority,
        skill: settings.defaultSkill,
        confidence: classification.confidence,
        assigneeUserId: null,
        source: "default",
      };
    }
  }

  result.assigneeUserId = await selectAssigneeBySkill(storage, result.skill);
  return result;
}
