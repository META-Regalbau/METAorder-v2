/**
 * CPQ Constraint Engine - evaluates rules in order and produces RuleResult
 */

import type { CpqRule } from "@shared/schema";
import { evaluateCondition, evaluateCalculation, type CpqCondition, type CpqAction, type ConfigContext } from "./ruleEvaluator";

export type RuleResult = {
  valid: boolean;
  config: ConfigContext;
  messages: string[];
  requiredComponents: Array<{ type: string; attribute?: string; value?: string | number }>;
  errors: string[];
  warnings: string[];
};

/**
 * Evaluate all rules for a given config
 * Order: compatibility -> physical -> configuration -> business
 */
export function evaluateRules(rules: CpqRule[], config: ConfigContext): RuleResult {
  const result: RuleResult = {
    valid: true,
    config: { ...config },
    messages: [],
    requiredComponents: [],
    errors: [],
    warnings: [],
  };

  const byType = {
    compatibility: rules.filter((r) => r.type === "compatibility").sort((a, b) => a.priority - b.priority),
    physical: rules.filter((r) => r.type === "physical").sort((a, b) => a.priority - b.priority),
    configuration: rules.filter((r) => r.type === "configuration").sort((a, b) => a.priority - b.priority),
    business: rules.filter((r) => r.type === "business").sort((a, b) => a.priority - b.priority),
  };

  // 1. Compatibility rules - filter allowed components (informational for now)
  for (const rule of byType.compatibility) {
    if (rule.status !== "active") continue;
    const cond = rule.condition as CpqCondition | null;
    const matches = evaluateCondition(cond, result.config);
    if (!matches && rule.fallback) {
      result.warnings.push(rule.message || "Kompatibilitätseinschränkung");
    }
  }

  // 2. Physical rules - validate and collect required components
  for (const rule of byType.physical) {
    if (rule.status !== "active") continue;
    const cond = rule.condition as CpqCondition | null;
    const matches = evaluateCondition(cond, result.config);
    const action = rule.action as CpqAction | null;
    if (matches && action) {
      if (action.type === "require_component") {
        result.requiredComponents.push({
          type: action.target_type || "",
          attribute: action.target_attribute,
          value: action.target_value as string | number | undefined,
        });
        result.messages.push(rule.message || "Pflichtkomponente erforderlich");
      }
    }
    if (!matches && rule.fallback) {
      const fallback = rule.fallback as CpqAction;
      if (fallback.type === "require_component") {
        result.requiredComponents.push({
          type: fallback.target_type || "",
          attribute: fallback.target_attribute,
          value: fallback.target_value as string | number | undefined,
        });
        result.warnings.push(rule.message || "Empfohlene Komponente");
      }
    }
  }

  // 3. Configuration rules - calculate quantities
  for (const rule of byType.configuration) {
    if (rule.status !== "active") continue;
    const calc = (rule.condition as { calculation?: string })?.calculation || (rule.action as { calculation?: string })?.calculation;
    if (calc) {
      result.config = evaluateCalculation(calc, result.config);
    }
  }

  // 4. Business rules - set mode, validate
  for (const rule of byType.business) {
    if (rule.status !== "active") continue;
    const cond = rule.condition as CpqCondition | null;
    const matches = evaluateCondition(cond, result.config);
    const action = rule.action as CpqAction | null;
    if (matches && action) {
      if (action.type === "set_mode" && action.value === "inquiry") {
        result.warnings.push(rule.message || "Nur auf Anfrage verfügbar");
      }
      if (action.type === "block") {
        result.valid = false;
        result.errors.push(rule.message || "Konfiguration nicht zulässig");
      }
    }
  }

  if (result.errors.length > 0) {
    result.valid = false;
  }

  return result;
}
