/**
 * CPQ Cross-Selling Provider - intelligent recommendations based on CPQ rules
 */

import { cpqStorage } from "./cpqStorage";
import { evaluateRules } from "./constraintEngine";
import type { ShopwareClient } from "../shopware";

export type CartItem = {
  product_id: string;
  product_number?: string;
  quantity: number;
};

export type CpqCrossSellResult = {
  required: Array<{ product_id: string; reason: string; rule_id?: string }>;
  recommended: Array<{ product_id: string; reason: string; compatibility_score?: number }>;
  optional: Array<{ product_id: string; category?: string }>;
};

export type CpqValidateCartResult = {
  valid: boolean;
  errors: Array<{ type: string; message: string; suggestion?: Record<string, unknown> }>;
  warnings: Array<{ type: string; message: string }>;
};

/**
 * Get cross-selling recommendations for cart items based on CPQ rules
 */
export async function getCpqCrossSelling(
  cartItems: CartItem[],
  tenantId: string | null,
  shopwareClient?: ShopwareClient
): Promise<CpqCrossSellResult> {
  const result: CpqCrossSellResult = { required: [], recommended: [], optional: [] };

  if (cartItems.length === 0) return result;

  for (const item of cartItems) {
    const mapping = await cpqStorage.getProductMappingByProductId(item.product_id, tenantId);
    if (!mapping || mapping.status !== "active") continue;

    const rules = await cpqStorage.getRulesBySystem(mapping.systemId, tenantId);
    const config: Record<string, unknown> = {
      selected_frame: { attributes: mapping.attributes },
      selected_beam: {},
      selected_shelf: {},
      field_count: 1,
      level_count: 1,
    };

    const ruleResult = evaluateRules(rules, config);

    for (const req of ruleResult.requiredComponents) {
      if (req.type && req.value) {
        const mappings = await cpqStorage.getProductMappingsBySystem(mapping.systemId, tenantId);
        const matching = mappings.filter(
          (m) => m.status === "active" && m.attributes && (m.attributes as Record<string, unknown>)[req.attribute || ""] === req.value
        );
        for (const m of matching) {
          result.required.push({
            product_id: m.shopwareProductId,
            reason: ruleResult.messages[0] || "Pflicht bei dieser Konfiguration",
          });
        }
      }
    }

    for (const msg of ruleResult.warnings) {
      result.recommended.push({
        product_id: item.product_id,
        reason: msg,
        compatibility_score: 0.8,
      });
    }
  }

  return result;
}

/**
 * Validate cart against CPQ rules
 */
export async function validateCpqCart(
  cartItems: CartItem[],
  tenantId: string | null
): Promise<CpqValidateCartResult> {
  const result: CpqValidateCartResult = { valid: true, errors: [], warnings: [] };

  if (cartItems.length === 0) return result;

  for (const item of cartItems) {
    const mapping = await cpqStorage.getProductMappingByProductId(item.product_id, tenantId);
    if (!mapping || mapping.status !== "active") continue;

    const rules = await cpqStorage.getRulesBySystem(mapping.systemId, tenantId);
    const config: Record<string, unknown> = {
      selected_frame: { attributes: mapping.attributes },
      selected_beam: {},
      selected_shelf: {},
      field_count: 1,
      level_count: 1,
    };

    const ruleResult = evaluateRules(rules, config);

    for (const err of ruleResult.errors) {
      result.errors.push({ type: "validation", message: err });
      result.valid = false;
    }
    for (const warn of ruleResult.warnings) {
      result.warnings.push({ type: "suboptimal", message: warn });
    }
  }

  return result;
}
