/**
 * Unit checks for Sendcloud status → label mapping (no network).
 * Run: npx tsx scripts/testSendcloudWebhookStatus.ts
 */
import {
  mapCarrierStatusToLabelStatus,
  shouldSyncShopware,
} from "../server/erp/shipping/sendcloudWebhook";
import type { ErpShippingLabel } from "../shared/schema";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const baseLabel = {
  id: "l1",
  shopwareOrderId: "sw1",
  labelStatus: "created",
} as ErpShippingLabel;

// Correct IDs
assert(mapCarrierStatusToLabelStatus(1) === "created", "1 announced → created");
assert(mapCarrierStatusToLabelStatus(1000) === "created", "1000 ready_to_send → created");
assert(mapCarrierStatusToLabelStatus(3) === "in_transit", "3 en route → in_transit");
assert(mapCarrierStatusToLabelStatus(5) === "in_transit", "5 sorted → in_transit");
assert(mapCarrierStatusToLabelStatus(7) === "in_transit", "7 being sorted → in_transit (NOT delivered)");
assert(mapCarrierStatusToLabelStatus(11) === "delivered", "11 delivered");
assert(mapCarrierStatusToLabelStatus(4) === "in_transit", "4 delayed → in_transit (already with carrier)");

// Message fallback must not treat "Delivery delayed" as delivered
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

// Shopware sync: not on created/ready-to-send
assert(!shouldSyncShopware(baseLabel, "created"), "no sync on created");
assert(shouldSyncShopware(baseLabel, "in_transit"), "sync on first in_transit");
assert(shouldSyncShopware(baseLabel, "delivered"), "sync on delivered from created");
assert(
  !shouldSyncShopware({ ...baseLabel, labelStatus: "in_transit" } as ErpShippingLabel, "delivered"),
  "no second sync once already in_transit",
);

console.log("testSendcloudWebhookStatus: ok");
