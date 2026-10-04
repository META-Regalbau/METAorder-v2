/**
 * Unit checks for Sendcloud status → label mapping (no network).
 * Ausführung: npm test
 */
import { describe, it } from "vitest";
import {
  mapCarrierStatusToLabelStatus,
  shouldSyncShopware,
} from "../../server/erp/shipping/sendcloudWebhook";
import type { ErpShippingLabel } from "../../shared/schema";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

// Aus scripts/testSendcloudWebhookStatus.ts uebernommen: Pruefungen unveraendert, je Pruefung ein Vitest-Fall.
describe("SendcloudWebhookStatus", () => {
  const baseLabel = {
    id: "l1",
    shopwareOrderId: "sw1",
    labelStatus: "created",
  } as ErpShippingLabel;

  it("Status-IDs werden richtig zugeordnet", () => {
    assert(mapCarrierStatusToLabelStatus(1) === "created", "1 announced → created");
    assert(mapCarrierStatusToLabelStatus(1000) === "created", "1000 ready_to_send → created");
    assert(mapCarrierStatusToLabelStatus(3) === "in_transit", "3 en route → in_transit");
    assert(mapCarrierStatusToLabelStatus(5) === "in_transit", "5 sorted → in_transit");
    assert(mapCarrierStatusToLabelStatus(7) === "in_transit", "7 being sorted → in_transit (NOT delivered)");
    assert(mapCarrierStatusToLabelStatus(11) === "delivered", "11 delivered");
    assert(mapCarrierStatusToLabelStatus(4) === "in_transit", "4 delayed → in_transit (already with carrier)");
  });

  it("Rückfall auf den Meldungstext: 'Delivery delayed' ist nicht zugestellt", () => {
    assert(
      mapCarrierStatusToLabelStatus(undefined, "Delivery delayed") === "delayed" ||
        mapCarrierStatusToLabelStatus(undefined, "Delivery delayed") === "in_transit" ||
        mapCarrierStatusToLabelStatus(undefined, "Delivery delayed") === undefined,
      "Delivery delayed must not be delivered",
    );
    assert(
      mapCarrierStatusToLabelStatus(undefined, "Delivery delayed") !== "delivered",
      "Delivery delayed ≠ delivered",
    );
    assert(mapCarrierStatusToLabelStatus(undefined, "Delivered") === "delivered", "Delivered ok");
    assert(
      mapCarrierStatusToLabelStatus(undefined, "Ready to send") === "created",
      "Ready to send → created",
    );
  });

  it("Shopware-Sync nicht bei created/ready-to-send, nur beim ersten Wechsel", () => {
    assert(!shouldSyncShopware(baseLabel, "created"), "no sync on created");
    assert(shouldSyncShopware(baseLabel, "in_transit"), "sync on first in_transit");
    assert(shouldSyncShopware(baseLabel, "delivered"), "sync on delivered from created");
    assert(
      !shouldSyncShopware({ ...baseLabel, labelStatus: "in_transit" } as ErpShippingLabel, "delivered"),
      "no second sync once already in_transit",
    );
  });
});
