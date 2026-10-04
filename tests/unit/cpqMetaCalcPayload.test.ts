/**
 * CPQ → MetaCalc-Payload Hilfsfunktionen
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import {
  buildMetaCalcConfigurationPayloadFromCpqBom,
  buildShopwareLinePayloadFromCpqSource,
  enrichMappedOfferItemsWithCpqPayload,
} from "../../server/cpq/cpqMetaCalcPayload";

function assert(cond: boolean, message: string) {
  if (!cond) throw new Error(message);
}

// Aus scripts/testCpqMetaCalcPayload.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("CpqMetaCalcPayload", () => {
  const bom = [
    { productId: "p1", productNumber: "111", name: "Steher", quantity: 4, componentType: "frame" },
    { productId: "p2", productNumber: "222", name: "Fußplatte", quantity: 8, componentType: "accessory" },
  ];

  const cpq = {
    systemId: "sys-1",
    systemName: "META CLIP",
    config: { height: 2000 },
    billOfMaterials: { items: bom, totalPrice: 1234.5 },
  };

  it("buildMetaCalcConfigurationPayloadFromCpqBom", () => {
    const { metaCalcConfigurationName: fallbackName, metaCalcConfigurationPayload } = buildMetaCalcConfigurationPayloadFromCpqBom(bom);
    assert(metaCalcConfigurationPayload.partsList.length === 1, "partsList: 1 frame");
    assert(metaCalcConfigurationPayload.accessoryList.length === 1, "accessoryList: 1 accessory");
    assert(metaCalcConfigurationPayload.partsList[0]!.productId === "p1", "part id");
    assert(fallbackName === "CPQ Regalkonfiguration", "fallback config name ohne systemName");
  });

  it("buildMetaCalcConfigurationPayloadFromCpqBom mit systemName", () => {
    const { metaCalcConfigurationName: namedName } = buildMetaCalcConfigurationPayloadFromCpqBom(bom, null, "META CLIP");
    assert(namedName === "META CLIP Regalkonfiguration", "config name mit systemName (kein doppeltes META)");
  });

  it("buildShopwareLinePayloadFromCpqSource", () => {
    const payload = buildShopwareLinePayloadFromCpqSource(cpq);
    assert(
      typeof (payload as any).metaCalcConfigurationPayload?.description === "string",
      "description string",
    );
    assert((payload as any).metaCalcConfigurationName === "META CLIP Regalkonfiguration", "config name aus systemName");
  });

  it("enrichMappedOfferItemsWithCpqPayload", () => {
    const items = [{ productId: "x", quantity: 1, type: "product", payload: {} }];
    const enriched = enrichMappedOfferItemsWithCpqPayload(items, cpq);
    assert(
      (enriched[0] as any).payload?.metaCalcConfigurationPayload?.partsList?.length === 1,
      "enriched first line",
    );
  });
});
