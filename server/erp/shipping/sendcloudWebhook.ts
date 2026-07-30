import crypto from "crypto";
import type { ErpShippingLabel } from "@shared/schema";
import { storage } from "../../storage";
import { ShopwareClient } from "../../shopware";
import { erpStorage } from "../erpStorage";
import { getSendcloudSettingsDecrypted } from "./getLabelProvider";

/**
 * Sendcloud Parcel-Status-IDs (API v2 /parcels/statuses).
 * Wichtig: ID 7 = „Being sorted“, ID 11 = „Delivered“ — nicht vertauschen.
 * @see https://sendcloud.dev/api/v2/parcel-statuses/retrieve-a-list-of-parcel-statuses
 */
const STATUS_ID_MAP: Record<number, string> = {
  1: "announced",
  3: "en_route_to_sorting",
  4: "delayed",
  5: "sorted",
  6: "not_sorted",
  7: "being_sorted",
  8: "delivery_attempt_failed",
  11: "delivered",
  12: "awaiting_customer_pickup",
  13: "announced_not_collected",
  15: "at_sorting_centre",
  22: "customs",
  80: "cancelled",
  91: "returning",
  92: "returned",
  93: "cancelled",
  999: "ready_to_send",
  1000: "ready_to_send",
  1001: "being_announced",
  1002: "announcement_failed",
  1998: "cancelled",
  1999: "cancelled",
  2000: "cancelled",
};

/** Carrier hat das Paket — Shopware-Lieferstatus „Versandt“ ist sinnvoll. */
const WITH_CARRIER_STATUSES = new Set([
  "en_route_to_sorting",
  "sorted",
  "not_sorted",
  "being_sorted",
  "at_sorting_centre",
  "out_for_delivery",
  "in_transit",
  "delayed",
  "customs",
  "delivery_attempt_failed",
  "awaiting_customer_pickup",
]);

/** Noch im Lager / nur Label — kein Shopware-„Versandt“. */
const PRE_SHIP_STATUSES = new Set([
  "announced",
  "announced_not_collected",
  "ready_to_send",
  "being_announced",
  "announcement_failed",
]);

export type ParsedSendcloudParcel = {
  parcelId?: string;
  trackingNumber?: string;
  orderNumber?: string;
  statusId?: number;
  statusMessage?: string;
  carrier?: string;
  timestamp?: string;
  raw: Record<string, unknown>;
};

export function verifySendcloudSignature(
  rawBody: Buffer | string,
  signatureHeader: string | undefined,
  secretKey: string,
): boolean {
  if (!signatureHeader || !secretKey) return false;
  const payload = typeof rawBody === "string" ? rawBody : rawBody.toString("utf8");
  const expected = crypto.createHmac("sha256", secretKey).update(payload).digest("hex");
  const received = String(signatureHeader).trim().toLowerCase();
  const expectedNorm = expected.toLowerCase();
  if (!/^[0-9a-f]+$/.test(received) || received.length !== expectedNorm.length) {
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(received, "utf8"), Buffer.from(expectedNorm, "utf8"));
  } catch {
    return false;
  }
}

export function parseSendcloudWebhookBody(body: unknown): ParsedSendcloudParcel {
  const root = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const parcel = (root.parcel && typeof root.parcel === "object"
    ? root.parcel
    : root) as Record<string, unknown>;

  const statusObj =
    parcel.status && typeof parcel.status === "object"
      ? (parcel.status as Record<string, unknown>)
      : null;

  const statusIdRaw = statusObj?.id ?? parcel.status_id ?? parcel.statusId;
  const statusId =
    statusIdRaw != null && Number.isFinite(Number(statusIdRaw)) ? Number(statusIdRaw) : undefined;

  const statusMessage = String(
    statusObj?.message || statusObj?.status || parcel.status_message || parcel.status || "",
  ).trim() || undefined;

  const carrier =
    (parcel.carrier && typeof parcel.carrier === "object"
      ? String((parcel.carrier as any).code || (parcel.carrier as any).name || "")
      : String(parcel.carrier || "")) || undefined;

  return {
    parcelId: parcel.id != null ? String(parcel.id) : undefined,
    trackingNumber: String(
      parcel.tracking_number || parcel.tracking_number_str || parcel.trackingNumber || "",
    ).trim() || undefined,
    orderNumber: String(parcel.order_number || parcel.orderNumber || "").trim() || undefined,
    statusId,
    statusMessage,
    carrier: carrier?.trim() || undefined,
    timestamp: String(parcel.timestamp || root.timestamp || "").trim() || undefined,
    raw: root,
  };
}

export function mapCarrierStatusToLabelStatus(
  statusId: number | undefined,
  statusMessage?: string,
): string | undefined {
  if (statusId != null && STATUS_ID_MAP[statusId]) {
    const mapped = STATUS_ID_MAP[statusId];
    if (mapped === "delivered") return "delivered";
    if (mapped === "cancelled") return "void";
    if (mapped === "returned" || mapped === "returning") return "returned";
    if (PRE_SHIP_STATUSES.has(mapped)) return "created";
    if (WITH_CARRIER_STATUSES.has(mapped)) return "in_transit";
    return mapped;
  }

  const msg = (statusMessage || "").toLowerCase();
  // Kein substring "deliver" — sonst wird „Delivery delayed“ fälschlich zu delivered.
  if (/\bdelivered\b/.test(msg) && !/delay|fail|attempt/.test(msg)) return "delivered";
  if (msg.includes("cancel")) return "void";
  if (msg.includes("return")) return "returned";
  if (
    msg.includes("ready to send") ||
    msg.includes("being announced") ||
    (msg.includes("announced") && !msg.includes("en route"))
  ) {
    return "created";
  }
  if (
    msg.includes("en route") ||
    msg.includes("sorted") ||
    msg.includes("transit") ||
    msg.includes("out for delivery") ||
    msg.includes("customs") ||
    msg.includes("awaiting customer pickup")
  ) {
    return "in_transit";
  }
  if (msg.includes("delay")) return "delayed";
  return undefined;
}

/** Shopware erst setzen, wenn das Paket den Carrier erreicht hat — nicht schon bei Label/Ready-to-send. */
export function shouldSyncShopware(prev: ErpShippingLabel, nextLabelStatus?: string): boolean {
  if (!nextLabelStatus) return false;
  if (!prev.shopwareOrderId) return false;
  if (nextLabelStatus !== "in_transit" && nextLabelStatus !== "delivered") return false;
  const prevStatus = prev.labelStatus;
  if (prevStatus === "in_transit" || prevStatus === "delivered") return false;
  return true;
}

export async function handleSendcloudWebhook(
  tenantId: string,
  rawBody: Buffer,
  signatureHeader: string | undefined,
  body: unknown,
): Promise<{
  ok: boolean;
  status: number;
  error?: string;
  labelId?: string;
  updated?: boolean;
}> {
  const settings = await getSendcloudSettingsDecrypted(tenantId);
  if (!settings?.secretKey) {
    return { ok: false, status: 400, error: "Sendcloud secret key not configured for tenant" };
  }

  if (!verifySendcloudSignature(rawBody, signatureHeader, settings.secretKey)) {
    return { ok: false, status: 401, error: "Invalid Sendcloud-Signature" };
  }

  const parsed = parseSendcloudWebhookBody(body);

  // Test-Webhook ohne Parcel-Daten: trotzdem 200, damit Sendcloud „OK“ zeigt
  if (!parsed.parcelId && !parsed.trackingNumber && !parsed.orderNumber) {
    console.log(`[SendcloudWebhook] tenant=${tenantId} test/empty payload accepted`);
    return { ok: true, status: 200, updated: false };
  }

  let label: ErpShippingLabel | undefined;
  if (parsed.parcelId) {
    label = await erpStorage.findShippingLabelByExternalParcelId(tenantId, parsed.parcelId);
  }
  if (!label && parsed.trackingNumber) {
    label = await erpStorage.findShippingLabelByTracking(tenantId, parsed.trackingNumber);
  }
  if (!label && parsed.orderNumber) {
    label = await erpStorage.findShippingLabelByOrderNumber(tenantId, parsed.orderNumber);
  }

  if (!label) {
    console.warn(
      `[SendcloudWebhook] tenant=${tenantId} no label for parcel=${parsed.parcelId} tracking=${parsed.trackingNumber}`,
    );
    // 200 verhindert endlose Retries; Payload ist gültig, nur unbekanntes Parcel
    return { ok: true, status: 200, updated: false };
  }

  // Out-of-order: neuer Timestamp muss neuer sein als lastWebhookAt
  if (parsed.timestamp && label.lastWebhookAt) {
    const incoming = Date.parse(parsed.timestamp);
    const previous = label.lastWebhookAt.getTime();
    if (Number.isFinite(incoming) && incoming < previous) {
      console.log(`[SendcloudWebhook] ignore stale webhook for label=${label.id}`);
      return { ok: true, status: 200, labelId: label.id, updated: false };
    }
  }

  const carrierStatus =
    parsed.statusId != null
      ? STATUS_ID_MAP[parsed.statusId] || `status_${parsed.statusId}`
      : parsed.statusMessage || null;
  const nextLabelStatus = mapCarrierStatusToLabelStatus(parsed.statusId, parsed.statusMessage);

  const patch: Parameters<typeof erpStorage.updateShippingLabel>[1] = {
    carrierStatus: carrierStatus || null,
    carrierStatusMessage: parsed.statusMessage || null,
    carrierStatusId: parsed.statusId ?? null,
    lastWebhookAt: parsed.timestamp && Number.isFinite(Date.parse(parsed.timestamp))
      ? new Date(parsed.timestamp)
      : new Date(),
    lastWebhookPayload: parsed.raw,
  };
  if (parsed.trackingNumber) patch.trackingNumber = parsed.trackingNumber;
  if (parsed.parcelId && !label.externalParcelId) patch.externalParcelId = parsed.parcelId;
  // Manuell voidete Labels nicht wieder öffnen; Cancel vom Carrier → void
  if (nextLabelStatus) {
    if (label.labelStatus === "void" && nextLabelStatus !== "void") {
      // keep void
    } else {
      patch.labelStatus = nextLabelStatus;
    }
  }

  const updated = await erpStorage.updateShippingLabel(label.id, patch, tenantId);

  if (updated && shouldSyncShopware(label, nextLabelStatus) && updated.shopwareOrderId) {
    try {
      const sw = await storage.getShopwareSettings(tenantId);
      if (sw) {
        const client = new ShopwareClient(sw);
        await client.updateOrderShipping(updated.shopwareOrderId, {
          carrier: parsed.carrier || updated.carrierCode,
          trackingNumber: updated.trackingNumber || undefined,
          shippedDate: new Date().toISOString().slice(0, 10),
        });
      }
    } catch (e: any) {
      console.warn(`[SendcloudWebhook] Shopware sync failed: ${e?.message || e}`);
    }
  }

  return { ok: true, status: 200, labelId: label.id, updated: true };
}
