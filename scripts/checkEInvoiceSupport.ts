/**
 * Prueft (nur lesend), ob der Shop E-Rechnungen (ZUGFeRD) erzeugen kann:
 * Shopware-Version + vorhandene Dokumenttypen.
 * Usage: npx tsx scripts/checkEInvoiceSupport.ts [tenantId]
 */
import { storage } from "../server/storage";
import { ShopwareClient, ZUGFERD_EMBEDDED_INVOICE_TYPE } from "../server/shopware";

const tenantId = process.argv[2]?.trim() || process.env.METAORDER_TENANT_ID || null;
const settings = await storage.getShopwareSettings(tenantId);
if (!settings) {
  console.error("Shopware settings not configured");
  process.exit(1);
}

const client = new ShopwareClient(settings) as any;
const request = async (path: string, init: RequestInit = {}) => {
  const response = await client.makeAuthenticatedRequest(`${client.baseUrl}${path}`, {
    method: "GET",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    ...init,
  });
  return response.json();
};

const config = await request("/api/_info/config");
const types = await request("/api/search/document-type", {
  method: "POST",
  body: JSON.stringify({ limit: 100 }),
});
const names: string[] = (types.data ?? []).map(
  (item: any) => item.technicalName ?? item.attributes?.technicalName,
);

console.log(`Shopware-Version: ${config.version ?? "unbekannt"}`);
console.log(`Dokumenttypen:    ${names.join(", ")}`);
console.log(
  names.includes(ZUGFERD_EMBEDDED_INVOICE_TYPE)
    ? `✓ ${ZUGFERD_EMBEDDED_INVOICE_TYPE} vorhanden – Rechnungen werden als E-Rechnung erstellt.`
    : `✗ ${ZUGFERD_EMBEDDED_INVOICE_TYPE} fehlt – es wird auf die klassische PDF-Rechnung zurueckgefallen.`,
);
process.exit(0);
