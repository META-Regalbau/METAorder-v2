/**
 * CPQ → MetaCalc-Payload Hilfsfunktionen
 * Ausführung: npx tsx scripts/testCpqMetaCalcPayload.ts
 */

import {
  buildMetaCalcConfigurationPayloadFromCpqBom,
  buildShopwareLinePayloadFromCpqSource,
  enrichMappedOfferItemsWithCpqPayload,
} from "../server/cpq/cpqMetaCalcPayload";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

console.log("=== CPQ MetaCalc Payload Tests ===\n");

const bom = [
  { productId: "p1", productNumber: "111", name: "Steher", quantity: 4, componentType: "frame" },
  { productId: "p2", productNumber: "222", name: "Fußplatte", quantity: 8, componentType: "accessory" },
];

const { metaCalcConfigurationPayload } = buildMetaCalcConfigurationPayloadFromCpqBom(bom);
assert(metaCalcConfigurationPayload.partsList.length === 1, "partsList: 1 frame");
assert(metaCalcConfigurationPayload.accessoryList.length === 1, "accessoryList: 1 accessory");
assert(metaCalcConfigurationPayload.partsList[0]!.productId === "p1", "part id");
console.log("  buildMetaCalcConfigurationPayloadFromCpqBom: OK");

const cpq = {
  systemId: "sys-1",
  systemName: "META CLIP",
  config: { height: 2000 },
  billOfMaterials: { items: bom, totalPrice: 1234.5 },
};
const payload = buildShopwareLinePayloadFromCpqSource(cpq);
assert(
  typeof (payload as any).metaCalcConfigurationPayload?.description === "string",
  "description string",
);
assert((payload as any).metaCalcConfigurationName === "CPQ Regalkonfiguration", "config name");
console.log("  buildShopwareLinePayloadFromCpqSource: OK");

const items = [{ productId: "x", quantity: 1, type: "product", payload: {} }];
const enriched = enrichMappedOfferItemsWithCpqPayload(items, cpq);
assert(
  (enriched[0] as any).payload?.metaCalcConfigurationPayload?.partsList?.length === 1,
  "enriched first line",
);
console.log("  enrichMappedOfferItemsWithCpqPayload: OK");

console.log("\nAll CPQ MetaCalc payload tests passed.");
