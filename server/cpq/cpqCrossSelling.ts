/**
 * CPQ Cross-Selling Provider - intelligent recommendations based on CPQ rules
 */

import { cpqStorage } from "./cpqStorage";
import { evaluateRules } from "./constraintEngine";
import type { ShopwareClient } from "../shopware";
import type { CpqProductMapping, CpqRule } from "@shared/schema";

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

  // Batch statt N+1: alle Produkt-Mappings in einer Query, Regeln + System-Mappings je
  // eindeutigem System nur einmal laden (mehrere Cart-Items teilen sich oft dasselbe System).
  const productIds = [...new Set(cartItems.map((i) => i.product_id))];
  const mappings = await cpqStorage.getProductMappingsByProductIds(productIds, tenantId);
  const mappingByProductId = new Map(mappings.map((m) => [m.shopwareProductId, m]));

  const activeItems = cartItems
    .map((item) => ({ item, mapping: mappingByProductId.get(item.product_id) }))
    .filter(
      (x): x is { item: CartItem; mapping: CpqProductMapping } => !!x.mapping && x.mapping.status === "active",
    );

  const systemIds = [...new Set(activeItems.map((x) => x.mapping.systemId))];
  const [rulesEntries, systemMappingsEntries] = await Promise.all([
    Promise.all(systemIds.map(async (systemId) => [systemId, await cpqStorage.getRulesBySystem(systemId, tenantId)] as const)),
    Promise.all(systemIds.map(async (systemId) => [systemId, await cpqStorage.getProductMappingsBySystem(systemId, tenantId)] as const)),
  ]);
  const rulesBySystem = new Map<string, CpqRule[]>(rulesEntries);
  const systemMappingsBySystem = new Map<string, CpqProductMapping[]>(systemMappingsEntries);

  for (const { item, mapping } of activeItems) {
    const rules = rulesBySystem.get(mapping.systemId) ?? [];
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
        const systemMappings = systemMappingsBySystem.get(mapping.systemId) ?? [];
        const matching = systemMappings.filter(
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

  const productIds = [...new Set(cartItems.map((i) => i.product_id))];
  const mappings = await cpqStorage.getProductMappingsByProductIds(productIds, tenantId);
  const mappingByProductId = new Map(mappings.map((m) => [m.shopwareProductId, m]));

  const activeMappings = cartItems
    .map((item) => mappingByProductId.get(item.product_id))
    .filter((m): m is CpqProductMapping => !!m && m.status === "active");

  const systemIds = [...new Set(activeMappings.map((m) => m.systemId))];
  const rulesEntries = await Promise.all(
    systemIds.map(async (systemId) => [systemId, await cpqStorage.getRulesBySystem(systemId, tenantId)] as const),
  );
  const rulesBySystem = new Map<string, CpqRule[]>(rulesEntries);

  for (const mapping of activeMappings) {
    const rules = rulesBySystem.get(mapping.systemId) ?? [];
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
