import { storage } from "../storage";
import { B2BSellersClient } from "../b2bSellersClient";
import { validateCpqCart, type CartItem } from "./cpqCrossSelling";

type PrepareCpqCartTransferParams = {
  cartItems: CartItem[];
  tenantId: string | null;
  customerId?: string;
  salesChannelId?: string;
  createOffer?: boolean;
};

export type CpqCartTransferResult = {
  success: true;
  message: string;
  cartItems: number;
  lineItems: Array<{ productId: string; quantity: number; productNumber?: string }>;
  customerId?: string;
  salesChannelId?: string;
  offerId?: string;
  adminOfferUrl: string;
};

export async function prepareCpqCartTransfer(
  params: PrepareCpqCartTransferParams
): Promise<CpqCartTransferResult> {
  const { cartItems, tenantId, customerId, salesChannelId, createOffer } = params;

  if (!Array.isArray(cartItems) || cartItems.length === 0) {
    throw new Error("cart_items required as non-empty array");
  }

  const normalizedCartItems = cartItems.map((item) => {
    const productId = String(item.product_id ?? "").trim();
    const quantity = Number(item.quantity ?? 1);
    const productNumber = item.product_number ? String(item.product_number).trim() : undefined;
    if (!productId) {
      throw new Error("cart_items.product_id required");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("cart_items.quantity must be positive integer");
    }
    return {
      product_id: productId,
      quantity,
      product_number: productNumber && productNumber.length > 0 ? productNumber : undefined,
    };
  });

  const validation = await validateCpqCart(normalizedCartItems, tenantId);
  if (!validation.valid) {
    const wrapped = new Error("Warenkorb entspricht nicht den CPQ-Regeln");
    (wrapped as Error & { details?: unknown }).details = validation;
    throw wrapped;
  }

  const settings = await storage.getShopwareSettings(tenantId);
  if (!settings) {
    throw new Error("Shopware-Einstellungen nicht konfiguriert");
  }

  const lineItems = normalizedCartItems.map((item) => ({
    productId: item.product_id,
    quantity: item.quantity ?? 1,
    productNumber: item.product_number,
  }));

  const baseUrl = settings.shopwareUrl.replace(/\/$/, "");
  const adminOfferUrl = `${baseUrl}/admin`;
  const shouldCreate = !!createOffer && !!customerId && !!salesChannelId;

  let offerId: string | undefined;
  if (shouldCreate) {
    const statusMapping = await storage.getSetting("b2b.offerStatusMapping");
    const client = new B2BSellersClient(settings, { statusMapping });
    const created = await client.createOffer({
      customerId,
      salesChannelId,
      lineItems: lineItems.map((lineItem) => ({
        productId: lineItem.productId,
        quantity: lineItem.quantity,
      })),
    });
    offerId = created.id;
  }

  return {
    success: true,
    message: offerId
      ? "Angebot in B2B-Sellers-Suite erstellt."
      : "Warenkorb für Transfer vorbereitet. Setzen Sie create_offer=true sowie customer_id und sales_channel_id, um ein Angebot zu erstellen.",
    cartItems: normalizedCartItems.length,
    lineItems,
    customerId: customerId ?? undefined,
    salesChannelId: salesChannelId ?? undefined,
    offerId: offerId ?? undefined,
    adminOfferUrl,
  };
}
