import { decrypt } from "../../encryption";
import { erpStorage } from "../erpStorage";
import { SendcloudShippingLabelProvider } from "./sendcloudProvider";
import { StubShippingLabelProvider } from "./stubProvider";
import type { ShippingLabelProvider } from "./types";

export const SENDCLOUD_PROVIDER = "sendcloud";

function safeDecrypt(value: string | null | undefined): string {
  const v = String(value || "").trim();
  if (!v) return "";
  try {
    return decrypt(v);
  } catch {
    // Legacy / plain text fallback during first save
    return v;
  }
}

export async function getSendcloudSettingsDecrypted(tenantId: string) {
  const row = await erpStorage.getShippingProviderSettings(tenantId, SENDCLOUD_PROVIDER);
  if (!row) return null;
  return {
    ...row,
    publicKey: safeDecrypt(row.publicKey),
    secretKey: safeDecrypt(row.secretKey),
  };
}

export async function getLabelProvider(tenantId: string): Promise<ShippingLabelProvider> {
  const settings = await getSendcloudSettingsDecrypted(tenantId);
  const hasKeys =
    !!settings?.enabled &&
    !!String(settings.publicKey || "").trim() &&
    !!String(settings.secretKey || "").trim();

  if (hasKeys && settings) {
    return new SendcloudShippingLabelProvider({
      publicKey: settings.publicKey,
      secretKey: settings.secretKey,
      sandboxMode: settings.sandboxMode,
      defaultShippingMethodId: settings.defaultShippingMethodId,
      defaultShippingMethodCode: settings.defaultShippingMethodCode,
      senderAddressId: settings.senderAddressId,
    });
  }
  return new StubShippingLabelProvider();
}
