/**
 * Aktion „Newsletter-Willkommensrabatt“: Code, den das Exit-Intent-Modal nach der Newsletter-Anmeldung zeigt
 * (shopware/storefront-snippets/exit-intent.js, CONFIG.code muss gleich sein).
 *
 * 10 % auf den Warenkorb, nur im Onlineshop META Regalbau DE, einmal pro Kunde und nur ohne frühere
 * Bestellung (Regel „Anzahl Bestellungen = 0“). Nicht mit anderen Aktionen kombinierbar – wie die übrigen
 * Code-Aktionen (z. B. SUMMER10). Geschrieben von scripts/writeExitIntentPromotion.ts.
 */
import { exitIntentPromotionId } from "./shopEntityIds";

export const EXIT_INTENT_CODE = "WILLKOMMEN10";
export const EXIT_INTENT_DISCOUNT_PERCENT = 10;
export const EXIT_INTENT_PROMOTION_NAME = "Newsletter-Willkommensrabatt 10 % (METAorder)";
export const EXIT_INTENT_RULE_NAME = "METAorder: Noch keine Bestellung (Newsletter-Rabatt)";

export const EXIT_INTENT_IDS = {
  promotion: exitIntentPromotionId("promotion"),
  discount: exitIntentPromotionId("discount"),
  salesChannel: exitIntentPromotionId("sales-channel"),
  rule: exitIntentPromotionId("rule"),
  ruleOr: exitIntentPromotionId("rule-or"),
  ruleAnd: exitIntentPromotionId("rule-and"),
  ruleOrderCount: exitIntentPromotionId("rule-order-count"),
};

/** Regel: Kunde hat noch keine Bestellung (Bedingungen als Baum wie im Regel-Editor) */
export function exitIntentRulePayload() {
  const ids = EXIT_INTENT_IDS;
  return {
    id: ids.rule,
    name: EXIT_INTENT_RULE_NAME,
    priority: 1,
    description: "Von METAorder verwaltet (scripts/writeExitIntentPromotion.ts) – Voraussetzung für den Newsletter-Willkommensrabatt.",
    conditions: [
      { id: ids.ruleOr, type: "orContainer", position: 0, value: {} },
      { id: ids.ruleAnd, type: "andContainer", parentId: ids.ruleOr, position: 0, value: {} },
      { id: ids.ruleOrderCount, type: "customerOrderCount", parentId: ids.ruleAnd, position: 0, value: { operator: "=", count: 0 } },
    ],
  };
}

export function exitIntentPromotionPayload(salesChannelId: string) {
  const ids = EXIT_INTENT_IDS;
  return {
    id: ids.promotion,
    name: EXIT_INTENT_PROMOTION_NAME,
    active: true,
    validFrom: null,
    validUntil: null,
    useCodes: true,
    useIndividualCodes: false,
    code: EXIT_INTENT_CODE,
    useSetGroups: false,
    customerRestriction: false,
    preventCombination: true,
    exclusive: false,
    priority: 1,
    maxRedemptionsGlobal: null,
    maxRedemptionsPerCustomer: 1,
    salesChannels: [{ id: ids.salesChannel, salesChannelId, priority: 1 }],
    personaRules: [{ id: ids.rule }],
    discounts: [{
      id: ids.discount,
      scope: "cart",
      type: "percentage",
      value: EXIT_INTENT_DISCOUNT_PERCENT,
      considerAdvancedRules: false,
      applierKey: "ALL",
      usageKey: "ALL",
      sorterKey: "PRICE_ASC",
    }],
  };
}
