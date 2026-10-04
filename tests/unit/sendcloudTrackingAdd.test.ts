/**
 * Sendcloud-Webhook (je Paket ein Aufruf): die Sendungsnummer des Pakets wird in Shopware ergaenzt,
 * nicht als einzige Nummer gesetzt - sonst blieb bei mehreren Paketen nur das letzte uebrig.
 * Echter Handler; Einstellungen, Label-Speicher und Shopware-Aufruf gemockt.
 * Ausführung: npm test
 */
import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/erp/shipping/getLabelProvider", () => ({
  getSendcloudSettingsDecrypted: async () => ({ secretKey: "geheim" }),
}));
vi.mock("../../server/erp/erpStorage", () => {
  const label = { id: "l1", shopwareOrderId: "o1", labelStatus: "created", carrierCode: "dpd", trackingNumber: null, externalParcelId: "p2", lastWebhookAt: null };
  return {
    erpStorage: {
      findShippingLabelByExternalParcelId: async () => label,
      findShippingLabelByTracking: async () => undefined,
      findShippingLabelByOrderNumber: async () => undefined,
      updateShippingLabel: async (_id: string, patch: Record<string, unknown>) => ({ ...label, ...patch }),
    },
  };
});

import { storage } from "../../server/storage";
import { ShopwareClient } from "../../server/shopware/shopware";
import { handleSendcloudWebhook } from "../../server/erp/shipping/sendcloudWebhook";

describe("Sendcloud-Webhook: Sendungsnummer je Paket", () => {
  it("wird beim Versand in Shopware ergaenzt (trackingMode add)", async () => {
    vi.spyOn(storage, "getShopwareSettings").mockResolvedValue({ shopwareUrl: "https://shop.invalid", apiKey: "k", apiSecret: "s" } as any);
    const update = vi.spyOn(ShopwareClient.prototype as any, "updateOrderShipping").mockResolvedValue(undefined);
    const body = { parcel: { id: "p2", tracking_number: "PAKET-2", status: { id: 3, message: "En route to sorting center" }, carrier: { code: "dpd" } } };
    const raw = Buffer.from(JSON.stringify(body));
    const signature = crypto.createHmac("sha256", "geheim").update(raw).digest("hex");

    const result = await handleSendcloudWebhook("tenant-a", raw, signature, body);

    expect(result).toMatchObject({ ok: true, status: 200 });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update.mock.calls[0][0]).toBe("o1");
    expect(update.mock.calls[0][1]).toMatchObject({ trackingNumber: "PAKET-2" });
    expect(update.mock.calls[0][2]).toEqual({ trackingMode: "add" });
  });
});
