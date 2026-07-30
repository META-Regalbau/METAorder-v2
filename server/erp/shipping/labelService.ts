import type { Order } from "@shared/schema";
import { storage } from "../../storage";
import { ShopwareClient } from "../../shopware";
import { erpStorage } from "../erpStorage";
import { getLabelProvider } from "./getLabelProvider";
import { writeLabelPdf } from "./labelFiles";
import type { CreateShippingLabelInput, ShippingLabelRecipient } from "./types";

function recipientFromOrder(order: Order): ShippingLabelRecipient {
  const addr = order.shippingAddress || order.billingAddress;
  const name = [addr?.firstName, addr?.lastName].filter(Boolean).join(" ").trim() || order.customerName;
  return {
    name,
    company: addr?.company,
    street: addr?.street,
    postalCode: addr?.zipCode,
    city: addr?.city,
    country: addr?.country || "DE",
    email: order.customerEmail,
    phone: addr?.phoneNumber || order.customerPhone,
  };
}

function recipientFromRecord(rec?: Record<string, string>): ShippingLabelRecipient {
  if (!rec) return {};
  return {
    name: rec.name || rec.customerName,
    company: rec.company,
    street: rec.street,
    houseNumber: rec.houseNumber,
    postalCode: rec.postalCode || rec.zipCode,
    city: rec.city,
    country: rec.country || "DE",
    email: rec.email,
    phone: rec.phone || rec.telephone,
  };
}

export async function createShippingLabelForTenant(
  tenantId: string,
  body: {
    shopwareOrderId?: string;
    orderNumber?: string;
    carrierCode?: string;
    packageWeight?: number;
    packageCount?: number;
    recipient?: Record<string, string>;
    shippingMethodId?: string;
    shippingMethodCode?: string;
    createdBy?: string;
  },
) {
  let order: Order | null = null;
  if (body.shopwareOrderId) {
    const settings = await storage.getShopwareSettings(tenantId);
    if (!settings) throw new Error("Shopware settings not configured");
    const client = new ShopwareClient(settings);
    order = await client.fetchOrderById(body.shopwareOrderId, null);
    if (!order) throw new Error("Order not found");
  }

  const recipient = order
    ? recipientFromOrder(order)
    : recipientFromRecord(body.recipient);

  if (!recipient.name && !recipient.company) {
    throw new Error("Recipient address required (select a Shopware order or provide recipient)");
  }
  if (!recipient.street || !recipient.postalCode || !recipient.city) {
    if (!order) {
      throw new Error("Recipient street, postal code and city are required");
    }
  }

  const provider = await getLabelProvider(tenantId);
  const input: CreateShippingLabelInput = {
    orderNumber: order?.orderNumber || body.orderNumber,
    shopwareOrderId: order?.id || body.shopwareOrderId,
    carrierCode: body.carrierCode || (provider.name === "sendcloud" ? "SENDCLOUD" : "STUB"),
    packageWeightKg: body.packageWeight ?? 1,
    packageCount: body.packageCount ?? 1,
    recipient,
    shippingMethodId: body.shippingMethodId,
    shippingMethodCode: body.shippingMethodCode,
  };

  const result = await provider.createLabel(input);

  const label = await erpStorage.createShippingLabel(
    {
      shopwareOrderId: order?.id || body.shopwareOrderId,
      orderNumber: order?.orderNumber || body.orderNumber,
      carrierCode: result.carrierCode,
      packageWeight: body.packageWeight ?? 1,
      packageCount: body.packageCount ?? 1,
      recipient: {
        name: recipient.name || "",
        company: recipient.company || "",
        street: recipient.street || "",
        houseNumber: recipient.houseNumber || "",
        postalCode: recipient.postalCode || "",
        city: recipient.city || "",
        country: recipient.country || "",
        email: recipient.email || "",
        phone: recipient.phone || "",
      },
      trackingNumber: result.trackingNumber,
      labelStatus: "created",
      provider: result.provider,
      externalParcelId: result.externalParcelId,
      shippingMethodCode: result.shippingMethodCode,
      rawResponse: result.rawResponse,
      createdBy: body.createdBy,
    },
    tenantId,
  );

  const filePath = await writeLabelPdf(label.id, result.labelPdf);
  const pdfUrl = `/api/erp/shipping-labels/${label.id}/pdf`;
  const updated = await erpStorage.updateShippingLabel(
    label.id,
    {
      labelFilePath: filePath,
      labelUrl: pdfUrl,
    },
    tenantId,
  );
  return updated || { ...label, labelFilePath: filePath, labelUrl: pdfUrl };
}

export async function voidShippingLabelForTenant(tenantId: string, id: string) {
  const label = await erpStorage.getShippingLabel(id, tenantId);
  if (!label) return undefined;
  if (label.labelStatus === "void") return label;

  if (label.externalParcelId && label.provider && label.provider !== "stub") {
    const provider = await getLabelProvider(tenantId);
    if (provider.name === label.provider) {
      try {
        await provider.voidLabel(label.externalParcelId);
      } catch (e: any) {
        // Local void still applied; surface message in rawResponse
        await erpStorage.updateShippingLabel(
          id,
          {
            rawResponse: {
              ...(typeof label.rawResponse === "object" && label.rawResponse
                ? (label.rawResponse as object)
                : {}),
              voidError: e?.message || String(e),
            },
          },
          tenantId,
        );
      }
    }
  }
  return erpStorage.voidShippingLabel(id, tenantId);
}
