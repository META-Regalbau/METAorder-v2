/**
 * CPQ Discount Evaluator - evaluates discount against discount levels (Rabatt-Ampel)
 * Supports context-dependent levels via cpq_discount_level_rules (system, customer_group, order_value).
 */

import { cpqStorage } from "./cpqStorage";
import type { CpqDiscountLevel, CpqDiscountLevelRule } from "@shared/schema";

export type DiscountLevelResult = {
  levelId: string;
  name: string;
  color: string;
  icon?: string | null;
  message: string;
  approvalType: string;
  justificationRequired: boolean;
  revenueLoss?: number;
  listPrice?: number;
  discountedPrice?: number;
};

function ruleMatchesContext(
  rule: CpqDiscountLevelRule,
  context: { systemId?: string | null; customerGroup?: string | null; orderValue?: number | null }
): boolean {
  const type = (rule.contextType || "").toLowerCase();
  const value = rule.contextValue?.trim() ?? "";
  if (type === "default") return true;
  if (type === "system" && context.systemId && value === context.systemId) return true;
  if (type === "customer_group" && context.customerGroup && value === context.customerGroup) return true;
  if (type === "order_value" && context.orderValue != null && value !== "") {
    const threshold = parseFloat(value);
    if (!Number.isNaN(threshold) && context.orderValue >= threshold) return true;
  }
  return false;
}

/**
 * Evaluate discount percentage against discount levels; uses context rules (cpq_discount_level_rules)
 * so that the most specific matching level set wins (spezifischste Regel zuerst).
 */
export async function evaluateDiscountLevel(
  discountPercent: number,
  context: {
    systemId?: string | null;
    customerGroup?: string | null;
    orderValue?: number | null;
  },
  tenantId: string | null
): Promise<DiscountLevelResult | null> {
  const [levels, rules] = await Promise.all([
    cpqStorage.getDiscountLevels(tenantId),
    cpqStorage.getDiscountLevelRules(tenantId),
  ]);
  if (levels.length === 0) return null;

  const rulesByLevel = new Map<string, CpqDiscountLevelRule[]>();
  for (const r of rules) {
    if (!r.discountLevelId) continue;
    const list = rulesByLevel.get(r.discountLevelId) ?? [];
    list.push(r);
    rulesByLevel.set(r.discountLevelId, list);
  }

  const discount = Math.max(0, Math.min(100, discountPercent));

  function levelPriority(level: CpqDiscountLevel): number {
    const levelRules = rulesByLevel.get(level.id) ?? [];
    if (levelRules.length === 0) return 0;
    const matching = levelRules.filter((r) => ruleMatchesContext(r, context));
    if (matching.length === 0) return -1;
    return Math.max(...matching.map((r) => r.priority ?? 0));
  }

  const applicable = levels.filter((l) => levelPriority(l) >= 0);
  const sorted = [...applicable].sort((a, b) => {
    const pa = levelPriority(a);
    const pb = levelPriority(b);
    if (pa !== pb) return pb - pa;
    const amax = parseFloat(String(a.discountMax));
    const bmax = parseFloat(String(b.discountMax));
    return amax - bmax;
  });

  for (const level of sorted) {
    const min = parseFloat(String(level.discountMin));
    const max = parseFloat(String(level.discountMax));
    if (discount >= min && discount <= max) {
      const message = (level.messageTemplate || "")
        .replace(/\{verlust\}/g, "")
        .replace(/\{marge\}/g, "")
        .replace(/\{rabatt\}/g, String(discount))
        .replace(/\{max_rabatt\}/g, String(max));
      return {
        levelId: level.id,
        name: level.name,
        color: level.color,
        icon: level.icon,
        message,
        approvalType: level.approvalType,
        justificationRequired: level.justificationRequired ?? false,
      };
    }
  }

  return null;
}
